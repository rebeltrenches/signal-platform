#!/usr/bin/env python3
"""
Re-runnable verification of apps/web/src/client/launch-solana.js's own
orchestration and validation logic:

  B1 — a mint created in step 1 must never be silently abandoned if
       step 2 (minting its supply) fails. The address must be shown and
       recoverable, a retry must resume the SAME mint, and a new launch
       must not start (and must not erase the record) while an
       incomplete one is saved.

  B2 — invalid supply or decimals (empty, zero, negative-shaped, decimal,
       non-numeric, below the 100,000,000 minimum, or above what fits in
       a u64 at the chosen decimals) must never allow buildCreateTx to
       run — checked independently in launch-solana.js itself, not
       assumed from wizard.js having already validated.

  C1 — both transactions carry their own compute budget, are simulated
       as the exact message that is signed, and are never submitted if
       the wallet changes that message.

  C3 — mint authority is always revoked in the same transaction as
       mintTo, read back afterwards, and "Supply locked" is only shown
       when the chain confirms it.

The stub modules in ./stubs/ replace @solana/web3.js and
@solana/spl-token with fakes that record what they're called with. This
proves launch-solana.js's own logic, not the real Solana libraries'
behavior; the real flow has been exercised on Solana Devnet separately.

Run with: python3 apps/web/tests/supply-validation-and-recovery.test.py
Requires: a Mainnet (default) build of apps/web/dist and Python's
`playwright` package with Chromium installed.
"""
import http.server
import socketserver
import threading
import sys
import time
import os
import json
from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.dirname(os.path.abspath(__file__)) + "/../../.."
DIST_DIR = os.path.join(REPO_ROOT, "apps/web/dist")
STUBS_DIR = os.path.join(REPO_ROOT, "apps/web/tests/stubs")
PORT = 8097
FEE_WALLET = "HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg"
CREATOR_WALLET = "SupplyTestWallet111111111111111111111111"
PENDING_KEY = "signal_pending_launch_v1"
LAUNCHES_KEY = "signal_real_launches_v1"
U64_MAX = 2**64 - 1

passed = 0
failed = 0


def check(name, condition):
    global passed, failed
    if condition:
        print(f"  ok  - {name}")
        passed += 1
    else:
        print(f"  FAIL - {name}")
        failed += 1


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_server():
    handler = lambda *a, **kw: QuietHandler(*a, directory=DIST_DIR, **kw)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def new_page(browser, init_t="{}", sign_js="async (tx) => tx", storage_js=""):
    page = browser.new_page()
    # The wallet libraries are bundled locally (scripts/build.tsx); swap the
    # bundles for the recording stubs.
    page.route(
        "**/client/vendor/solana-web3.js",
        lambda r: r.fulfill(path=os.path.join(STUBS_DIR, "web3.js"), content_type="application/javascript"),
    )
    page.route(
        "**/client/vendor/spl-token.js",
        lambda r: r.fulfill(path=os.path.join(STUBS_DIR, "spl-token.js"), content_type="application/javascript"),
    )
    # The registration call is best-effort; answer it so nothing hangs.
    page.route("**/api/v1/tokens/register", lambda r: r.fulfill(status=503, body="{}"))
    page.add_init_script(f"""
      window.__t = {init_t};
      window.solana = {{
        isPhantom: true,
        connect: async () => ({{ publicKey: {{ toBase58: () => '{CREATOR_WALLET}', toJSON: () => '{CREATOR_WALLET}' }} }}),
        signTransaction: {sign_js},
        signMessage: async (bytes) => {{
          (window.__t.signedMessages = window.__t.signedMessages || []).push(new TextDecoder().decode(bytes));
          return {{ signature: new Uint8Array(64).fill(7) }};
        }},
      }};
      if (!sessionStorage.getItem('__seeded')) {{
        sessionStorage.setItem('__seeded', '1');
        localStorage.removeItem('{PENDING_KEY}');
        localStorage.removeItem('{LAUNCHES_KEY}');
        {storage_js}
      }}
    """)
    return page


def fill_wizard_to_review(page, name="Test Token", symbol="TST"):
    page.goto(f"http://localhost:{PORT}/create/", wait_until="networkidle")
    page.click('.wizard-step[data-step="0"] [data-chain="solana"]')
    page.click('.wizard-step[data-step="0"] [data-action="next"]')
    page.fill('.wizard-step[data-step="1"] #tk-name', name)
    page.fill('.wizard-step[data-step="1"] #tk-symbol', symbol)
    page.click('.wizard-step[data-step="1"] [data-action="next"]')
    page.fill('.wizard-step[data-step="2"] #tk-supply', "1000000000")
    # The Decimals field starts empty; the creator must type it.
    page.fill('.wizard-step[data-step="2"] #tk-decimals', "6")
    page.click('.wizard-step[data-step="2"] [data-action="next"]')


def launch(page, supply=None, decimals=None):
    # Tamper with window.launchpadWizard directly to reach launch-solana.js's
    # independent check, deliberately bypassing wizard.js's own gate the
    # way stale state, a bug in that file, or any other path would.
    if supply is not None:
        page.evaluate(f"window.launchpadWizard.supply = {json.dumps(supply)};")
    if decimals is not None:
        page.evaluate(f"window.launchpadWizard.decimals = {json.dumps(decimals)};")
    page.click('#mainnetConnectBtn')
    page.check('#mainnetAck')
    page.click('#mainnetLaunchBtn')
    wait_for_result(page)


def wait_for_result(page):
    # A finished launch ends with the supply-lock read-back outcome.
    page.wait_for_function(
        "() => /Failed|Supply locked\\.|Supply lock check failed|couldn't be read back/"
        ".test(document.querySelector('#launch-result').textContent)",
        timeout=20000,
    )


def main():
    if not os.path.isdir(DIST_DIR):
        print(f"ERROR: {DIST_DIR} does not exist — run the build first.")
        sys.exit(1)
    with open(os.path.join(DIST_DIR, "create", "index.html"), encoding="utf-8") as f:
        if "SIGNAL_SOLANA_CLUSTER" in f.read():
            print("ERROR: apps/web/dist is a devnet build — rebuild without SIGNAL_SOLANA_CLUSTER.")
            sys.exit(1)

    httpd = start_server()
    time.sleep(0.3)
    print("supply-validation-and-recovery.test.py\n")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # =================================================================
        # B2 — invalid supply or decimals must never reach buildCreateTx
        # =================================================================
        max_at_6 = U64_MAX // 10**6
        invalid_cases = [
            ("", "6", "empty supply"),
            ("0", "6", "zero"),
            ("-100000000", "6", "negative"),
            ("100000000.5", "6", "decimal"),
            ("abc", "6", "non-numeric"),
            ("1e9", "6", "exponential notation"),
            ("1,000,000,000", "6", "commas"),
            ("99999999", "6", "one below the minimum"),
            (str(max_at_6 + 1), "6", "one above the u64 maximum at 6 decimals"),
            (str(U64_MAX), "9", "u64 max at 9 decimals"),
            ("1000000000", "10", "10 decimals"),
            ("1000000000", "abc", "non-numeric decimals"),
            ("1000000000", "-1", "negative decimals"),
            ("1000000000", "", "empty decimals (no default to 6)"),
            ("1000000000", "   ", "whitespace-only decimals"),
        ]
        for supply, decimals, description in invalid_cases:
            page = new_page(browser)
            fill_wizard_to_review(page)
            launch(page, supply, decimals)
            state = page.evaluate("window.__t")
            result_text = page.text_content('#launch-result') or ""
            page.close()
            check(f"B2: {description} never reaches createInitializeMintInstruction", "initMintCalls" not in state)
            check(f"B2: {description} shows a real error message", "Failed" in result_text)

        for supply, decimals, description in [
            ("100000000", "6", "exactly the minimum"),
            (str(max_at_6), "6", "exactly the u64 maximum at 6 decimals"),
            (str(U64_MAX), "0", "u64 max at 0 decimals"),
        ]:
            page = new_page(browser)
            fill_wizard_to_review(page)
            launch(page, supply, decimals)
            state = page.evaluate("window.__t")
            page.close()
            mint_to = (state.get("mintToCalls") or [{}])[0]
            check(f"B2: {description} is ACCEPTED", "initMintCalls" in state)
            check(
                f"B2: {description} mints supply * 10^decimals exactly",
                mint_to.get("amount") == str(int(supply) * 10 ** int(decimals)),
            )

        # wizard.js mirrors the limit for immediate feedback.
        page = new_page(browser)
        page.goto(f"http://localhost:{PORT}/create/", wait_until="networkidle")
        page.click('.wizard-step[data-step="0"] [data-chain="solana"]')
        page.click('.wizard-step[data-step="0"] [data-action="next"]')
        page.fill('.wizard-step[data-step="1"] #tk-name', "Wizard Limit")
        page.fill('.wizard-step[data-step="1"] #tk-symbol', "WZL")
        page.click('.wizard-step[data-step="1"] [data-action="next"]')
        page.fill('.wizard-step[data-step="2"] #tk-decimals', "6")
        page.fill('.wizard-step[data-step="2"] #tk-supply', str(max_at_6 + 1))
        next_disabled_over = page.is_disabled('.wizard-step[data-step="2"] [data-action="next"]')
        error_over = page.text_content('#tk-supply-error') or ""
        page.fill('.wizard-step[data-step="2"] #tk-decimals', "0")
        next_disabled_at_0 = page.is_disabled('.wizard-step[data-step="2"] [data-action="next"]')
        page.close()
        check("B2 (wizard): supply over the u64 maximum disables Next", next_disabled_over)
        check("B2 (wizard): and shows the maximum", "Maximum supply with 6 decimals" in error_over)
        check("B2 (wizard): lowering decimals to 0 re-validates and enables Next", not next_disabled_at_0)

        # The Decimals field starts empty and nothing ever falls back to 6:
        # the step (and so the Review screen) stays blocked until the
        # creator types a value.
        page = new_page(browser)
        page.goto(f"http://localhost:{PORT}/create/", wait_until="networkidle")
        page.click('.wizard-step[data-step="0"] [data-chain="solana"]')
        page.click('.wizard-step[data-step="0"] [data-action="next"]')
        page.fill('.wizard-step[data-step="1"] #tk-name', "Empty Decimals")
        page.fill('.wizard-step[data-step="1"] #tk-symbol', "EDC")
        page.click('.wizard-step[data-step="1"] [data-action="next"]')
        field_value_at_start = page.input_value('.wizard-step[data-step="2"] #tk-decimals')
        wizard_decimals_at_start = page.evaluate("window.launchpadWizard.decimals")
        hint = page.text_content('#tk-decimals-hint') or ""
        hint_linked = "tk-decimals-hint" in (page.get_attribute('#tk-decimals', 'aria-describedby') or "")
        page.fill('.wizard-step[data-step="2"] #tk-supply', "1000000000")
        next_disabled_untouched = page.is_disabled('.wizard-step[data-step="2"] [data-action="next"]')
        decimals_error = page.text_content('#tk-decimals-error') or ""
        supply_error = page.text_content('#tk-supply-error') or ""
        page.fill('.wizard-step[data-step="2"] #tk-decimals', "6")
        enabled_after_typing = not page.is_disabled('.wizard-step[data-step="2"] [data-action="next"]')
        error_after_typing = page.text_content('#tk-decimals-error') or ""
        page.fill('.wizard-step[data-step="2"] #tk-decimals', "")
        next_disabled_cleared = page.is_disabled('.wizard-step[data-step="2"] [data-action="next"]')
        wizard_decimals_cleared = page.evaluate("window.launchpadWizard.decimals")
        page.close()
        check("B2 (wizard): the Decimals field starts empty, with no pre-filled value", field_value_at_start == "" and wizard_decimals_at_start == "")
        check("B2 (wizard): a hint says most Solana tokens use 6 or 9", "Most Solana tokens use 6 or 9" in hint and hint_linked)
        check("B2 (wizard): with supply entered but Decimals left empty, Review stays disabled", next_disabled_untouched)
        check("B2 (wizard): an empty Decimals field shows a clear error under it", "Enter the number of decimals" in decimals_error)
        check("B2 (wizard): the supply field shows no error for it", supply_error == "")
        check("B2 (wizard): typing a value enables Review and clears the error", enabled_after_typing and error_after_typing == "")
        check("B2 (wizard): clearing it again disables Review and keeps the value empty, not 6", next_disabled_cleared and wizard_decimals_cleared == "")

        # =================================================================
        # C1 — compute budget, exact-message simulation, fee transfer
        # =================================================================
        print()
        page = new_page(browser)
        fill_wizard_to_review(page, name="Budget Test", symbol="BGT")
        launch(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        lock_state = page.text_content('[data-launch-step="lock"] [data-state]')
        page.close()
        final_sims = [s for s in state.get("simulations", []) if s["replaceRecentBlockhash"] is False]
        check("C1: the launch completes", "Done." in result_text)
        check("C1: exactly two transactions are submitted", state.get("submittedCount") == 2)
        check("C1: both signed transactions are simulated first, with their exact blockhash", len(final_sims) == 2)
        check(
            "C1: both start with a compute unit limit and price",
            len(final_sims) == 2 and all(s["types"][:2] == ["computeUnitLimit", "computeUnitPrice"] for s in final_sims),
        )
        check(
            "C1: step 1 pays the 0.001 SOL fee to the platform wallet",
            state.get("transferCall") == {"to": FEE_WALLET, "lamports": 1_000_000},
        )
        check("C1: the mint uses the 6 decimals typed in the Decimals field", (state.get("initMintCalls") or [{}])[0].get("decimals") == 6)

        # C3 — mandatory revoke, in the same transaction as mintTo.
        supply_tx = final_sims[1]["types"] if len(final_sims) == 2 else []
        check(
            "C3: the supply transaction is ATA + mintTo + revoke, in that order",
            supply_tx[2:] == ["createATA", "mintTo", "setAuthority"],
        )
        set_authority = (state.get("setAuthorityCalls") or [{}])[0]
        mint_address = (state.get("initMintCalls") or [{}])[0].get("mint")
        check(
            "C3: it revokes MintTokens on the new mint by setting the authority to none",
            set_authority == {
                "account": mint_address,
                "currentAuthority": CREATOR_WALLET,
                "authorityType": 0,
                "newAuthority": None,
            },
        )
        check("C3: the mint is read back after confirmation", state.get("getMintCalls", 0) >= 1)
        check("C3: success shows 'Supply locked'", "Supply locked." in result_text)
        check("C3: the lock step shows 'supply locked'", lock_state == "supply locked")

        # Read-back shows the authority still set: say so, never claim locked,
        # and never offer to mint again (the supply transaction confirmed).
        page = new_page(browser, init_t="{ mintAuthorityAfter: 'StillTheCreator1111111111111111111111111' }")
        fill_wizard_to_review(page)
        launch(page)
        result_text = page.text_content('#launch-result') or ""
        button_text = page.text_content('#mainnetLaunchBtn') or ""
        page.close()
        check("C3: a mint authority still set on-chain is reported as a failed lock", "Supply lock check failed" in result_text and "NOT locked" in result_text)
        check("C3: and 'Supply locked' is never shown", "Supply locked." not in result_text)
        check("C3: and the launch is still final, not offered again", button_text == "Launched")

        # Read-back impossible (RPC down): don't claim locked, point to Explorer.
        page = new_page(browser, init_t="{ mintReadFails: true }")
        fill_wizard_to_review(page)
        launch(page)
        result_text = page.text_content('#launch-result') or ""
        page.close()
        check("C3: an unreadable mint is reported as not verified yet", "couldn't be read back" in result_text)
        check("C3: and 'Supply locked' is not claimed", "Supply locked." not in result_text)

        # A wallet that adds its own priority fee must be refused.
        page = new_page(
            browser,
            sign_js="async (tx) => { tx.instructions.unshift({ type: 'walletPriorityFee' }); return tx; }",
        )
        fill_wizard_to_review(page)
        launch(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        page.close()
        check("C1: a wallet-modified transaction is refused", "Wallet changed the simulated transaction" in result_text)
        check("C1: and nothing is submitted", "submittedCount" not in state)

        # A failed simulation stops before any signature is requested.
        page = new_page(
            browser,
            init_t="{ failSimulation: { InstructionError: [2, 'Custom'] } }",
            sign_js="async (tx) => { window.__t.signRequested = true; return tx; }",
        )
        fill_wizard_to_review(page)
        launch(page)
        state = page.evaluate("window.__t")
        page.close()
        check("C1: a failed simulation never asks the wallet to sign", "signRequested" not in state)

        # =================================================================
        # C2 — listing on Signal needs a signed-in session of the creator
        # =================================================================
        print()

        def stub_api(page, register_statuses):
            """Fake sign-in and register endpoints; register answers with
            the given statuses in order and records each request."""
            calls = []
            page.route("**/api/v1/auth/challenge**", lambda r: r.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"nonce": "n1", "timestamp": 1, "message": f"signal-auth|{CREATOR_WALLET}|solana|n1|1"}),
            ))
            page.route("**/api/v1/auth/session", lambda r: r.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"sessionToken": f"session-{len(calls) + 1}"}),
            ))

            def register(route):
                request = route.request
                calls.append({"authorization": request.headers.get("authorization"), "body": json.loads(request.post_data)})
                status = register_statuses[min(len(calls), len(register_statuses)) - 1]
                message = "This token is already registered to a different creator." if status == 409 else ""
                route.fulfill(status=status, content_type="application/json", body=json.dumps({"message": message}))
            page.route("**/api/v1/tokens/register", register)
            return calls

        def wait_for_listing(page):
            page.wait_for_function(
                "() => /Listed on Signal|Not listed on Signal yet/.test(document.querySelector('#launch-result').textContent)",
                timeout=10000,
            )

        page = new_page(browser)
        calls = stub_api(page, [201])
        fill_wizard_to_review(page, name="Listed Token", symbol="LST")
        launch(page)
        wait_for_listing(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        page.close()
        mint_address = (state.get("initMintCalls") or [{}])[0].get("mint")
        check("C2: after launch, the creator wallet signs the server's sign-in message", state.get("signedMessages") == [f"signal-auth|{CREATOR_WALLET}|solana|n1|1"])
        check("C2: registration is sent with that session as a Bearer token", len(calls) == 1 and calls[0]["authorization"] == "Bearer session-1")
        check("C2: it registers the launched mint", len(calls) == 1 and calls[0]["body"]["address"] == mint_address)
        check("C2: it does not send a creator field (the server takes it from the session)", len(calls) == 1 and "creatorWalletAddress" not in calls[0]["body"])
        check("C2: success is shown", "Listed on Signal" in result_text)

        page = new_page(browser)
        calls = stub_api(page, [409])
        fill_wizard_to_review(page)
        launch(page)
        wait_for_listing(page)
        result_text = page.text_content('#launch-result') or ""
        has_retry = page.is_visible('#launch-result button:has-text("Try again")')
        button_text = page.text_content('#mainnetLaunchBtn') or ""
        page.clock.install()
        page.clock.fast_forward(2000)
        page.click('#launch-result button:has-text("Try again")')
        page.wait_for_function("() => document.querySelectorAll('#launch-result button').length === 1 && !/Listing on Signal/.test(document.querySelector('#launch-result').textContent)", timeout=10000)
        retried_text = page.text_content('#launch-result') or ""
        page.close()
        check("C2: a refused registration (409) is shown with the server's reason", "Not listed on Signal yet" in result_text and "already registered" in result_text)
        check("C2: with a Try again button", has_retry)
        check("C2: and the launch itself stays final", button_text == "Launched")
        check("C2: Try again really retries the registration", len(calls) == 2)
        check("C2: and a retry that fails the same way still visibly changes the message", retried_text != result_text and "Try again" in retried_text)

        page = new_page(browser)
        calls = stub_api(page, [401, 201])
        fill_wizard_to_review(page)
        launch(page)
        wait_for_listing(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        page.close()
        check("C2: an expired session (401) signs in once more and retries", len(calls) == 2 and len(state.get("signedMessages") or []) == 2)
        check("C2: and then succeeds", "Listed on Signal" in result_text)

        # =================================================================
        # B1 — same-session recovery: step 2 fails, retry resumes SAME mint
        # =================================================================
        print()
        page = new_page(browser, init_t="{ failConfirmOnCall: 2, failConfirmError: 'simulated supply failure' }")
        fill_wizard_to_review(page, name="Recovery Test", symbol="RCV")
        launch(page)
        result_after_failure = page.text_content('#launch-result') or ""
        pending_after_failure = page.evaluate(f"localStorage.getItem('{PENDING_KEY}')")
        button_text_after_failure = page.text_content('#mainnetLaunchBtn') or ""
        first_mint = page.evaluate("window.__t.initMintCalls[0].mint")

        check("B1: the mint address IS shown in the UI even though step 2 failed", "Mint created:" in result_after_failure)
        check("B1: a pending-launch record is saved to localStorage", pending_after_failure is not None)
        check("B1: the button now reads a resume label", "Finish minting supply" in button_text_after_failure)
        pending_record = json.loads(pending_after_failure) if pending_after_failure else {}
        check("B1: the pending record's mint matches the one created", pending_record.get("mint") == first_mint)

        page.evaluate("window.__t.failConfirmOnCall = null;")
        page.click('#mainnetLaunchBtn')
        page.wait_for_function("() => document.querySelector('#launch-result').textContent.includes('Done.')", timeout=5000)
        init_mint_calls = page.evaluate("window.__t.initMintCalls.length")
        mint_to_mint = page.evaluate("window.__t.mintToCalls.at(-1).mint")
        pending_after_success = page.evaluate(f"localStorage.getItem('{PENDING_KEY}')")
        real_launches = page.evaluate(f"JSON.parse(localStorage.getItem('{LAUNCHES_KEY}') || '[]')")
        page.close()

        check("B1: the retry does NOT create a second mint", init_mint_calls == 1)
        check("B1: the retry mints supply to the SAME mint", mint_to_mint == first_mint)
        check(
            "B1: the completed launch is recorded under that SAME mint",
            len(real_launches) == 1 and real_launches[0]["mint"] == first_mint,
        )
        check("B1: the pending record is cleared after the resume succeeds", pending_after_success is None)

        # =================================================================
        # B1 — cross-RELOAD recovery from a record saved before page load
        # =================================================================
        print()
        preexisting_mint = "PreexistingMintFromEarlierSession1111111"
        seed_pending = f"""localStorage.setItem('{PENDING_KEY}', JSON.stringify({{
            mint: '{preexisting_mint}', name: 'Reloaded Token', symbol: 'RLD',
            supply: '500000000', decimals: 6,
            creatorAddress: '{CREATOR_WALLET}', createdAt: new Date().toISOString(),
        }}));"""

        page = new_page(browser, storage_js=seed_pending)
        page.goto(f"http://localhost:{PORT}/create/", wait_until="networkidle")
        notice_text = page.text_content('#pending-launch-notice') or ""
        check("B1 (reload): the incomplete-launch notice appears on page load", preexisting_mint in notice_text)
        page.click('#pendingResumeConnect')
        page.wait_for_function(
            "() => /Failed|Supply locked\\.|Supply lock check failed|couldn't be read back/"
            ".test(document.querySelector('#pendingResumeStatus').textContent)",
            timeout=20000,
        )
        resume_status = page.text_content('#pendingResumeStatus') or ""
        state = page.evaluate("window.__t")
        real_launches_reload = page.evaluate(f"JSON.parse(localStorage.getItem('{LAUNCHES_KEY}') || '[]')")
        pending_after_reload_finish = page.evaluate(f"localStorage.getItem('{PENDING_KEY}')")
        page.close()
        check("B1 (reload): no new mint is created", "initMintCalls" not in state)
        check("B1 (reload): supply is minted to the pre-existing mint", (state.get("mintToCalls") or [{}])[0].get("mint") == preexisting_mint)
        check(
            "B1 (reload): the launch is recorded under the pre-existing mint",
            len(real_launches_reload) == 1 and real_launches_reload[0]["mint"] == preexisting_mint,
        )
        check("B1 (reload): the pending record is cleared", pending_after_reload_finish is None)
        check(
            "C3 (reload): finishing a recovered launch also revokes mint authority",
            (state.get("setAuthorityCalls") or [{}])[0].get("account") == preexisting_mint,
        )
        check("C3 (reload): and shows 'Supply locked'", "Supply locked." in resume_status)

        # The Devnet bug: after a reload, the main Launch button created a
        # new mint and then erased the saved record of the incomplete one.
        page = new_page(browser, storage_js=seed_pending)
        fill_wizard_to_review(page, name="Second Launch", symbol="SEC")
        launch(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        pending_after_blocked = page.evaluate(f"localStorage.getItem('{PENDING_KEY}')")
        page.close()
        check("B1 (reload): the main Launch button does NOT create a new mint while one is incomplete", "initMintCalls" not in state)
        check("B1 (reload): it explains that the incomplete launch must be finished first", "incomplete launch" in result_text)
        check(
            "B1 (reload): the incomplete launch's record is kept",
            pending_after_blocked is not None and json.loads(pending_after_blocked)["mint"] == preexisting_mint,
        )

        # Dismiss is the deliberate way out, and only after confirmation.
        page = new_page(browser, storage_js=seed_pending)
        page.goto(f"http://localhost:{PORT}/create/", wait_until="networkidle")
        page.once("dialog", lambda d: d.dismiss())
        page.click('#pendingDismiss')
        kept_after_cancel = page.evaluate(f"localStorage.getItem('{PENDING_KEY}')")
        page.once("dialog", lambda d: d.accept())
        page.click('#pendingDismiss')
        cleared_after_accept = page.evaluate(f"localStorage.getItem('{PENDING_KEY}')")
        notice_hidden = page.evaluate("document.getElementById('pending-launch-notice').hidden")
        page.close()
        check("B1 (dismiss): cancelling the confirmation keeps the record", kept_after_cancel is not None)
        check("B1 (dismiss): confirming clears the record", cleared_after_accept is None)
        check("B1 (dismiss): and hides the notice", notice_hidden is True)

        browser.close()

    httpd.shutdown()
    print(f"\n{passed} passed, {failed} failed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
