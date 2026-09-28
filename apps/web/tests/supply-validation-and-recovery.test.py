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


# What Phantom does on Mainnet: returns a NEW transaction object with a
# higher compute-unit price and a Lighthouse assertion appended.
PHANTOM_MAINNET_SIGN_JS = """async (tx) => {
  const signed = new tx.constructor();
  signed.recentBlockhash = tx.recentBlockhash;
  signed.lastValidBlockHeight = tx.lastValidBlockHeight;
  signed.feePayer = tx.feePayer;
  const price = new Uint8Array(9); price[0] = 3; new DataView(price.buffer).setBigUint64(1, 250000n, true);
  signed.instructions = tx.instructions.map((ix) => ix.type === 'computeUnitPrice'
    ? { ...ix, microLamports: 250000, data: price } : ix);
  signed.instructions.push({ type: 'lighthouse', programId: { toBase58: () => 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95' }, keys: [], data: new Uint8Array([4, 1]) });
  return signed;
}"""
# A wallet that returns a new transaction with an extra transfer out.
PHANTOM_ADDS_TRANSFER_SIGN_JS = """async (tx) => {
  const signed = new tx.constructor();
  signed.recentBlockhash = tx.recentBlockhash;
  signed.lastValidBlockHeight = tx.lastValidBlockHeight;
  signed.feePayer = tx.feePayer;
  signed.instructions = [...tx.instructions, { type: 'transfer', programId: { toBase58: () => '11111111111111111111111111111111' }, keys: [], data: new Uint8Array([2, 9]) }];
  return signed;
}"""


TURBO_DEPOSIT = "HepiT2k93CFQaSB7i3ZNXhybZKn5MeWiv3UkLsaJKk4i"
# A minimal valid PNG header; the rest is padding up to the wanted size.
def png_bytes(size=2048):
    header = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    return header + bytes(size - len(header))


def data_item_fields(body):
    """Parses what the page uploaded (an ANS-104 data item, signature
    type 4): its id, tags and data."""
    import hashlib, base64
    sig_type = int.from_bytes(body[0:2], "little")
    signature = body[2:66]
    owner = body[66:98]
    o = 98
    o += 1 + (32 if body[o] else 0)
    o += 1 + (32 if body[o] else 0)
    tag_count = int.from_bytes(body[o:o + 8], "little"); o += 8
    tag_len = int.from_bytes(body[o:o + 8], "little"); o += 8
    tag_bytes = body[o:o + tag_len]; o += tag_len

    def read_long(buf, i):
        n, shift = 0, 0
        while True:
            b = buf[i]; i += 1
            n |= (b & 0x7F) << shift; shift += 7
            if not b & 0x80:
                return (n >> 1) ^ -(n & 1), i
    tags, i = {}, 0
    if tag_bytes:
        count, i = read_long(tag_bytes, i)
        for _ in range(count):
            ln, i = read_long(tag_bytes, i); name = tag_bytes[i:i + ln].decode(); i += ln
            ln, i = read_long(tag_bytes, i); value = tag_bytes[i:i + ln].decode(); i += ln
            tags[name] = value
    item_id = base64.urlsafe_b64encode(hashlib.sha256(signature).digest()).decode().rstrip("=")
    return {"type": sig_type, "id": item_id, "owner": owner, "tag_count": tag_count, "tags": tags, "data": body[o:]}


def fake_turbo(page, free=True, balance=None, deposit=TURBO_DEPOSIT, upload_error=None):
    """ArDrive Turbo, answered locally (no network). free=False refuses
    free uploads with 402 until the wallet's paid balance covers them."""
    turbo = {"uploads": [], "refused": 0, "submitted": [], "balance": balance, "free": free, "upload_error": upload_error}
    winc_per_byte, winc_per_lamport = 1000, 10

    def upload(route):
        if turbo["upload_error"]:
            return route.fulfill(status=500, body=turbo["upload_error"])
        body = route.request.post_data_buffer
        item = data_item_fields(body)
        price = len(body) * winc_per_byte
        if turbo["free"]:
            turbo["uploads"].append(item)
        elif (turbo["balance"] or 0) >= price:
            turbo["balance"] -= price
            turbo["uploads"].append(item)
        else:
            turbo["refused"] += 1
            return route.fulfill(status=402, body="Insufficient balance")
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": item["id"]}))

    def payment(route):
        url = route.request.url
        if "/v1/price/bytes/" in url:
            n = int(url.rsplit("/", 1)[1])
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"winc": str(n * winc_per_byte)}))
        if "/v1/price/solana/" in url:
            n = int(url.rsplit("/", 1)[1])
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"winc": str(n * winc_per_lamport)}))
        if url.endswith("/v1/info"):
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"addresses": {"solana": deposit}}))
        if "/v1/account/balance/solana" in url and route.request.method == "POST":
            turbo["submitted"].append(json.loads(route.request.post_data)["tx_id"])
            # Credit the payment (the amount sent is checked from the
            # page's recorded transfer instead).
            turbo["balance"] = (turbo["balance"] or 0) + 10**12
            return route.fulfill(status=200, content_type="application/json", body="{}")
        if "/v1/account/balance/solana" in url:
            if turbo["balance"] is None:
                return route.fulfill(status=404, body="User Not Found")
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"winc": str(turbo["balance"])}))
        route.fulfill(status=500, body="unexpected")

    page.route("https://upload.ardrive.io/**", upload)
    page.route("https://payment.ardrive.io/**", payment)
    return turbo


def new_page(browser, init_t="{}", sign_js="async (tx) => tx", storage_js="", turbo_free=True, turbo_balance=None, turbo_upload_error=None):
    page = browser.new_page()
    page.turbo = fake_turbo(page, free=turbo_free, balance=turbo_balance, upload_error=turbo_upload_error)
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
      const creatorBytes = new Uint8Array(32);
      creatorBytes.set(new TextEncoder().encode('{CREATOR_WALLET}').slice(0, 32));
      window.solana = {{
        isPhantom: true,
        connect: async () => ({{ publicKey: {{ toBase58: () => '{CREATOR_WALLET}', toJSON: () => '{CREATOR_WALLET}', toBytes: () => creatorBytes }} }}),
        signTransaction: {sign_js},
        signMessage: async (bytes) => {{
          const text = new TextDecoder().decode(bytes);
          (window.__t.signedMessages = window.__t.signedMessages || []).push(text);
          // Deterministic per message, like ed25519: same file, same id.
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', bytes));
          return {{ signature: digest }};
        }},
      }};
      // Records the order of uploads and transaction sends.
      const realFetch = window.fetch.bind(window);
      window.fetch = (url, init) => {{
        if (String(url).includes('upload.ardrive.io')) (window.__t.events = window.__t.events || []).push('upload');
        return realFetch(url, init);
      }};
      if (!sessionStorage.getItem('__seeded')) {{
        sessionStorage.setItem('__seeded', '1');
        localStorage.removeItem('{PENDING_KEY}');
        localStorage.removeItem('{LAUNCHES_KEY}');
        {storage_js}
      }}
    """)
    return page


def fill_wizard_to_review(page, name="Test Token", symbol="TST", description="A test token.", logo=None):
    page.goto(f"http://localhost:{PORT}/create/", wait_until="networkidle")
    page.click('.wizard-step[data-step="0"] [data-chain="solana"]')
    page.click('.wizard-step[data-step="0"] [data-action="next"]')
    page.fill('.wizard-step[data-step="1"] #tk-name', name)
    page.fill('.wizard-step[data-step="1"] #tk-symbol', symbol)
    page.fill('.wizard-step[data-step="1"] #tk-desc', description)
    page.set_input_files('#tk-logo', files=[{"name": "logo.png", "mimeType": "image/png", "buffer": logo or png_bytes()}])
    page.wait_for_function("() => !document.querySelector('.wizard-step[data-step=\"1\"] [data-action=\"next\"]').disabled", timeout=5000)
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
    page.wait_for_function("() => document.getElementById('mainnetConnectBtn').textContent === 'Connected'", timeout=5000)
    page.check('#metadataAck')
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
        page.set_input_files('#tk-logo', files=[{"name": "logo.png", "mimeType": "image/png", "buffer": png_bytes()}])
        page.wait_for_function("() => !document.getElementById('tk-logo-preview').hidden", timeout=5000)
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
        page.set_input_files('#tk-logo', files=[{"name": "logo.png", "mimeType": "image/png", "buffer": png_bytes()}])
        page.wait_for_function("() => !document.getElementById('tk-logo-preview').hidden", timeout=5000)
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

        # A wallet that edits our transaction in place with an unknown
        # instruction must be refused (checked against the pre-signing snapshot).
        page = new_page(
            browser,
            sign_js="async (tx) => { tx.instructions.unshift({ type: 'walletPriorityFee' }); return tx; }",
        )
        fill_wizard_to_review(page)
        launch(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        page.close()
        check("C1: a wallet-modified transaction is refused", "Wallet changed the transaction" in result_text)
        check("C1: and nothing is submitted", "submittedCount" not in state)

        # Phantom on Mainnet returns a new transaction with its own compute
        # budget and Lighthouse assertions appended: accepted on both steps,
        # re-signed by the mint on step 1, and simulated again as signed.
        page = new_page(browser, sign_js=PHANTOM_MAINNET_SIGN_JS)
        fill_wizard_to_review(page, name="Phantom Mainnet", symbol="PHM")
        launch(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        page.close()
        signed_sims = [s for s in state.get("simulations", []) if s["replaceRecentBlockhash"] is False and "lighthouse" in s["types"]]
        check("C1: Phantom's Mainnet safety/compute-budget additions are accepted", "Supply locked." in result_text and state.get("submittedCount") == 2)
        check("C1: both steps are simulated again exactly as Phantom signed them", len(signed_sims) == 2)
        check("C1: the new mint re-signs Phantom's changed step 1 message", state.get("partialSigns") == 2)

        # A new transaction object with an extra transfer is still refused.
        page = new_page(browser, sign_js=PHANTOM_ADDS_TRANSFER_SIGN_JS)
        fill_wizard_to_review(page)
        launch(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        page.close()
        check("C1: an added transfer is refused even from a new transaction object", "Wallet changed the transaction (added instruction" in result_text)
        check("C1: and nothing is submitted for it", "submittedCount" not in state)

        # A signature that doesn't verify stops before sending.
        page = new_page(browser, init_t="{ missingSignature: true }")
        fill_wizard_to_review(page)
        launch(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        page.close()
        check("C1: a missing or invalid signature is refused before sending", "signature is missing" in result_text and "submittedCount" not in state)

        # "Blockhash not found" from an RPC node that is briefly behind.
        page = new_page(browser, init_t="{ blockhashNotFoundOnce: true, sendBlockhashNotFoundOnce: true }")
        fill_wizard_to_review(page)
        launch(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        page.close()
        check("C1: Blockhash not found (simulation, then send) is retried and the launch completes", "Supply locked." in result_text and state.get("submittedCount") == 2)
        check("C1: the send was retried with the same signed transaction", state.get("sendAttempts") == 3)

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
        pending_after_listed = page.evaluate(f"localStorage.getItem('{PENDING_KEY}')")
        page.close()
        mint_address = (state.get("initMintCalls") or [{}])[0].get("mint")
        signed = state.get("signedMessages") or []
        check("C2: after launch, the creator wallet signs the server's sign-in message", signed[-1:] == [f"signal-auth|{CREATOR_WALLET}|solana|n1|1"])
        check("C2: the only other signed messages are the two Arweave uploads", len(signed) == 3 and all(len(m) == 96 for m in signed[:2]))
        check("C2: registration is sent with that session as a Bearer token", len(calls) == 1 and calls[0]["authorization"] == "Bearer session-1")
        check("C2: it registers the launched mint", len(calls) == 1 and calls[0]["body"]["address"] == mint_address)
        check("C2: it does not send a creator field (the server takes it from the session)", len(calls) == 1 and "creatorWalletAddress" not in calls[0]["body"])
        check("C2: success is shown", "Listed on Signal" in result_text)
        check("C2: once Signal confirms the listing, the pending record is cleared", pending_after_listed is None)

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
        check("C2: an expired session (401) signs in once more and retries", len(calls) == 2 and len([m for m in state.get("signedMessages") or [] if m.startswith("signal-auth|")]) == 2)
        check("C2: and then succeeds", "Listed on Signal" in result_text)

        # =================================================================
        # M — on-chain metadata: Arweave upload, then metadata in the mint tx
        # =================================================================
        print()
        page = new_page(browser)
        fill_wizard_to_review(page, name="Meta Coin", symbol="meta", description="Permanent test.")
        review_name = page.text_content('#rv-name')
        review_symbol = page.text_content('#rv-symbol')
        review_logo = page.get_attribute('#rv-logo', 'src') or ""
        launch_disabled_without_ack = True
        page.click('#mainnetConnectBtn')
        page.wait_for_function("() => document.getElementById('mainnetConnectBtn').textContent === 'Connected'", timeout=5000)
        page.check('#mainnetAck')
        launch_disabled_without_ack = page.is_disabled('#mainnetLaunchBtn')
        page.check('#metadataAck')
        launch_enabled_with_ack = not page.is_disabled('#mainnetLaunchBtn')
        page.click('#mainnetLaunchBtn')
        wait_for_result(page)
        page.wait_for_function("() => /Metadata locked|Metadata check failed|couldn't be read back yet/.test(document.querySelector('#launch-result').textContent)", timeout=10000)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        meta_state = page.text_content('[data-launch-step="meta"] [data-state]')
        uploads = page.turbo["uploads"]
        page.close()
        check("M: the review shows the metadata preview (logo, name, upper-case symbol)", review_name == "Meta Coin" and review_symbol == "META" and review_logo.startswith("blob:"))
        check("M: launch stays disabled until the metadata preview is confirmed", launch_disabled_without_ack and launch_enabled_with_ack)
        check("M: two files are uploaded, logo first, both signed by the creator (type 4)", len(uploads) == 2 and all(u["type"] == 4 for u in uploads) and uploads[0]["owner"].startswith(CREATOR_WALLET.encode()[:32]))
        logo_item, json_item = (uploads + [{}, {}])[:2]
        check("M: the logo is stored with its detected content type", logo_item.get("tags", {}).get("Content-Type") == "image/png" and logo_item.get("data") == png_bytes())
        meta_json = json.loads(json_item.get("data") or b"{}") if json_item else {}
        check(
            "M: the metadata JSON has the name, symbol, description and the logo's Arweave URL",
            json_item.get("tags", {}).get("Content-Type") == "application/json"
            and meta_json.get("name") == "Meta Coin" and meta_json.get("symbol") == "META"
            and meta_json.get("description") == "Permanent test."
            and meta_json.get("image") == f"https://arweave.net/{logo_item.get('id')}",
        )
        check("M: the wallet signed exactly the two uploads before listing", len([m for m in state.get("signedMessages") or [] if len(m) == 96]) == 2)
        events = state.get("events") or []
        check("M: both uploads finish before any transaction is sent", events[:2] == ["upload", "upload"] and "send" in events)
        mint_sim = [s for s in state.get("simulations", []) if s["replaceRecentBlockhash"] is False][0]["types"]
        check("M: the mint transaction creates the metadata right after initializing the mint", mint_sim[2:] == ["transfer", "createAccount", "initMint", "createMetadata"])
        create_meta = (state.get("createMetadataCalls") or [{}])[0]
        new_mint = (state.get("initMintCalls") or [{}])[0].get("mint")
        check(
            "M: CreateMetadataAccountV3 for the new mint with the previewed name, symbol and metadata URI",
            create_meta.get("discriminator") == 33 and create_meta.get("mint") == new_mint
            and create_meta.get("name") == "Meta Coin" and create_meta.get("symbol") == "META"
            and create_meta.get("uri") == f"https://arweave.net/{json_item.get('id')}",
        )
        check(
            "M: the metadata is immutable, with no royalties, creators, collection or uses",
            create_meta.get("isMutable") is False and create_meta.get("sellerFeeBasisPoints") == 0
            and [create_meta.get(k) for k in ("creators", "collection", "uses", "collectionDetails")] == [0, 0, 0, 0]
            and create_meta.get("trailing") == 0,
        )
        check("M: the creator signs as mint authority, payer and update authority", [k[1] for k in create_meta.get("keys", [])] == [False, False, True, True, True, False] and create_meta.get("keys", [[]] * 3)[2][0] == CREATOR_WALLET)
        check("M: the supply lock is unchanged: mintTo + revoke in the next transaction", "Supply locked." in result_text and state.get("submittedCount") == 2)
        check("M: the metadata is read back and shown locked", "Metadata locked." in result_text and meta_state == "metadata locked")

        # The real gate in launch-solana.js, independent of wizard.js.
        for field, value, expected in [
            ("name", "x" * 33, "at most 32 bytes"),
            ("symbol", "TOOLONGSYMB", "at most 10 bytes"),
            ("symbol", "TWO WORDS", "can't contain spaces"),
            ("description", "d" * 501, "at most 500 characters"),
            ("logoFile", None, "Choose a logo"),
        ]:
            page = new_page(browser)
            fill_wizard_to_review(page)
            page.evaluate(f"window.launchpadWizard[{json.dumps(field)}] = {json.dumps(value)};")
            launch(page)
            state = page.evaluate("window.__t")
            result_text = page.text_content('#launch-result') or ""
            uploads = page.turbo["uploads"]
            page.close()
            check(f"M: a tampered {field} is refused before any upload or transaction", expected in result_text and not uploads and "initMintCalls" not in state and "signedMessages" not in state)

        page = new_page(browser)
        fill_wizard_to_review(page)
        page.evaluate("window.launchpadWizard.logoFile = new File([new TextEncoder().encode('<svg xmlns=\"http://www.w3.org/2000/svg\"/>')], 'x.png', { type: 'image/png' });")
        launch(page)
        result_text = page.text_content('#launch-result') or ""
        uploads = page.turbo["uploads"]
        page.close()
        check("M: a logo that isn't really an image (SVG named .png) is refused by its bytes", "PNG, JPEG, GIF or WebP" in result_text and not uploads)

        # wizard.js mirrors the rules for immediate feedback.
        page = new_page(browser)
        page.goto(f"http://localhost:{PORT}/create/", wait_until="networkidle")
        page.click('.wizard-step[data-step="0"] [data-chain="solana"]')
        page.click('.wizard-step[data-step="0"] [data-action="next"]')
        next_btn = '.wizard-step[data-step="1"] [data-action="next"]'
        page.fill('#tk-name', "Good Name")
        page.fill('#tk-symbol', "GOOD")
        disabled_without_logo = page.is_disabled(next_btn)
        page.set_input_files('#tk-logo', files=[{"name": "big.png", "mimeType": "image/png", "buffer": png_bytes(100 * 1024 + 1)}])
        page.wait_for_function("() => document.getElementById('tk-logo-error').textContent.length > 0", timeout=5000)
        big_error = page.text_content('#tk-logo-error') or ""
        disabled_big = page.is_disabled(next_btn)
        page.set_input_files('#tk-logo', files=[{"name": "fake.png", "mimeType": "image/png", "buffer": b"<svg xmlns='http://www.w3.org/2000/svg'/>"}])
        page.wait_for_function("() => /PNG, JPEG/.test(document.getElementById('tk-logo-error').textContent)", timeout=5000)
        disabled_svg = page.is_disabled(next_btn)
        page.set_input_files('#tk-logo', files=[{"name": "ok.png", "mimeType": "image/png", "buffer": png_bytes(100 * 1024)}])
        page.wait_for_function("() => !document.getElementById('tk-logo-preview').hidden", timeout=5000)
        enabled_ok = not page.is_disabled(next_btn)
        page.fill('#tk-name', "é" * 17)
        name_error = page.text_content('#tk-name-error') or ""
        disabled_long_name = page.is_disabled(next_btn)
        page.fill('#tk-name', "Good Name")
        page.fill('#tk-symbol', "A B")
        symbol_error = page.text_content('#tk-symbol-error') or ""
        disabled_symbol = page.is_disabled(next_btn)
        page.close()
        check("M (wizard): Continue needs a logo", disabled_without_logo)
        check("M (wizard): a logo over 100 KB is refused with its size", disabled_big and "maximum is 100 KB" in big_error)
        check("M (wizard): a non-image renamed .png is refused", disabled_svg)
        check("M (wizard): a 100 KB PNG is accepted and previewed", enabled_ok)
        check("M (wizard): a name over 32 bytes (17 × 'é') is refused with the byte limit", disabled_long_name and "32 bytes" in name_error)
        check("M (wizard): a symbol with a space is refused", disabled_symbol and "spaces" in symbol_error)

        # Retrying after the mint transaction fails reuses the stored files:
        # no new signatures, no new uploads (and so never a second payment).
        page = new_page(browser, init_t="{ failConfirmOnCall: 1, failConfirmError: 'simulated mint failure' }")
        fill_wizard_to_review(page)
        launch(page)
        page.evaluate("window.__t.failConfirmOnCall = null;")
        page.click('#mainnetLaunchBtn')
        wait_for_text_count = page.wait_for_function("() => document.querySelector('#launch-result').textContent.includes('Done.')", timeout=15000)
        state = page.evaluate("window.__t")
        uploads = page.turbo["uploads"]
        page.close()
        check("M: a retry after a failed mint transaction doesn't re-sign or re-upload the files", len(uploads) == 2 and len([m for m in state.get("signedMessages") or [] if len(m) == 96]) == 2)
        check("M: and the retried mint transaction uses the same metadata URI", len({c["uri"] for c in state.get("createMetadataCalls") or []}) == 1)

        # A read-back that doesn't match is reported; the launch stays final.
        page = new_page(browser, init_t="{ metadataMutable: true }")
        fill_wizard_to_review(page)
        launch(page)
        page.wait_for_function("() => /Metadata check failed/.test(document.querySelector('#launch-result').textContent)", timeout=10000)
        result_text = page.text_content('#launch-result') or ""
        button_text = page.text_content('#mainnetLaunchBtn') or ""
        page.close()
        check("M: mutable metadata on-chain is reported as a failed metadata check", "marked mutable" in result_text and "Metadata locked." not in result_text)
        check("M: and the launch is still final", button_text == "Launched")

        page = new_page(browser, init_t="{ metadataNameOnChain: '<img src=x onerror=xss=1>' }")
        fill_wizard_to_review(page)
        launch(page)
        page.wait_for_function("() => /Metadata check failed/.test(document.querySelector('#launch-result').textContent)", timeout=10000)
        result_text = page.text_content('#launch-result') or ""
        xss = page.evaluate("window.xss")
        page.close()
        check("M: a different on-chain name is reported, as text (never HTML)", "name is" in result_text and "<img" in result_text and xss is None)

        # =================================================================
        # P — free storage refused: automatic, approved, paid fallback
        # =================================================================
        print()

        def start_paid_launch(page):
            fill_wizard_to_review(page)
            page.click('#mainnetConnectBtn')
            page.wait_for_function("() => document.getElementById('mainnetConnectBtn').textContent === 'Connected'", timeout=5000)
            page.check('#metadataAck')
            page.check('#mainnetAck')
            page.click('#mainnetLaunchBtn')
            page.wait_for_selector('#storagePayApprove', timeout=15000)

        page = new_page(browser, turbo_free=False)
        start_paid_launch(page)
        prompt_text = page.text_content('#storage-payment') or ""
        before_approval = page.evaluate("window.__t")
        page.click('#storagePayApprove')
        wait_for_result(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        turbo = page.turbo
        page.close()
        paid = [t for t in state.get("transferCalls") or [] if t["to"] == TURBO_DEPOSIT]
        shown = prompt_text.split("costs ")[1].split(" SOL")[0] if "costs " in prompt_text else ""
        check("P: a refused free upload shows the exact SOL cost and Turbo's reason", "Insufficient balance" in prompt_text and shown != "" and "Nothing has been sent yet" in prompt_text)
        check("P: nothing is sent or signed as a transaction before the creator approves", "submittedCount" not in before_approval and "initMintCalls" not in before_approval)
        check("P: after approval, exactly the shown amount goes to Turbo's deposit address", len(paid) == 1 and paid[0]["lamports"] / 1e9 == float(shown))
        check("P: the payment is reported to Turbo, then both files are uploaded", turbo["submitted"] == ["sig-1"] and len(turbo["uploads"]) == 2)
        check("P: and the launch completes (payment + mint + supply = 3 transactions)", "Supply locked." in result_text and state.get("submittedCount") == 3)
        payment_sim = [s for s in state.get("simulations", []) if s["replaceRecentBlockhash"] is False][0]["types"]
        check("P: the payment transaction is budgeted and simulated like the launch transactions", payment_sim == ["computeUnitLimit", "computeUnitPrice", "transfer"])

        page = new_page(browser, turbo_free=False)
        start_paid_launch(page)
        page.click('#storagePayDecline')
        page.wait_for_function("() => /Launch cancelled/.test(document.querySelector('#launch-result').textContent)", timeout=10000)
        state = page.evaluate("window.__t")
        button_text = page.text_content('#mainnetLaunchBtn') or ""
        uploads = page.turbo["uploads"]
        page.close()
        check("P: declining cancels the launch before anything is sent", "submittedCount" not in state and "initMintCalls" not in state and not uploads)
        check("P: and the launch can be started again", button_text == "Retry")

        # The payment is sent but confirming it times out. It is recorded
        # the moment it's sent, so Retry finds it on-chain and applies it
        # instead of asking for (and sending) a second payment.
        page = new_page(browser, turbo_free=False, init_t="{ unconfirmedOnCall: 1 }")
        start_paid_launch(page)
        page.click('#storagePayApprove')
        wait_for_result(page)
        first_text = page.text_content('#launch-result') or ""
        record = json.loads(page.evaluate(f"localStorage.getItem('signal_turbo_payment_{CREATOR_WALLET}')") or "null")
        first_state = page.evaluate("window.__t")
        submitted_before_retry = list(page.turbo["submitted"])
        page.click('#mainnetLaunchBtn')
        wait_for_result(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        prompt_on_retry = page.query_selector('#storage-payment') is not None
        record_after = page.evaluate(f"localStorage.getItem('signal_turbo_payment_{CREATOR_WALLET}')")
        submitted = list(page.turbo["submitted"])
        page.close()
        deposits = [t for t in state.get("transferCalls") or [] if t["to"] == TURBO_DEPOSIT]
        check("P: an unconfirmed payment fails the attempt, saying Retry won't charge again", "was sent but couldn't be confirmed" in first_text and "won't charge you again" in first_text)
        check("P: its signature was recorded when it was sent, before confirmation failed", record is not None and record.get("signature") == "sig-1" and "initMintCalls" not in first_state)
        check("P: it isn't reported to Turbo until it has confirmed on-chain", submitted_before_retry == [])
        check("P: Retry looks the payment up on-chain and applies it", state.get("historyLookups") == ["sig-1"] and submitted == ["sig-1"])
        check("P: without a new prompt or a second transfer", not prompt_on_retry and len(deposits) == 1)
        check("P: and the launch completes, clearing the payment record", "Supply locked." in result_text and record_after is None)

        # A Turbo balance that already covers the files is used silently.
        page = new_page(browser, turbo_free=False, turbo_balance=10**9)
        fill_wizard_to_review(page)
        launch(page)
        state = page.evaluate("window.__t")
        prompt_shown = page.query_selector('#storage-payment') is not None
        page.close()
        check("P: an existing Turbo balance is used without a prompt or payment", not prompt_shown and state.get("submittedCount") == 2)

        # =================================================================
        # X — third-party and user text is shown as text, never run as HTML
        # =================================================================
        print()

        def injected(page):
            """True if any payload ran or created an element."""
            return page.evaluate("window.xss !== undefined || document.querySelector('img[src=\"x\"], b.injected') !== null")

        # A malicious Turbo error body (the P1 in PR review).
        payload = '<img src=x onerror="window.xss=1"><b class=injected>bold</b>'
        page = new_page(browser, turbo_upload_error=payload)
        fill_wizard_to_review(page)
        launch(page)
        result_text = page.text_content('#launch-result') or ""
        ran = injected(page)
        state = page.evaluate("window.__t")
        page.close()
        check("X: a Turbo error body with HTML is shown literally in the failure message", "Failed:" in result_text and payload in result_text)
        check("X: and never runs or creates elements", not ran)
        check("X: nothing was sent", "submittedCount" not in state)

        # A malicious token name, symbol and description: through the review,
        # the launch log, the on-chain read-back, and the recovery notice.
        name = "<img src=x onerror=xss=2>"
        symbol = "<B>X</B>"
        description = '<b class=injected>desc</b><img src=x onerror="window.xss=3">'
        page = new_page(browser)
        stub_api(page, [503])
        fill_wizard_to_review(page, name=name, symbol=symbol, description=description)
        review = [page.text_content(s) for s in ('#rv-name', '#rv-symbol', '#rv-description')]
        ran_review = injected(page)
        launch(page)
        wait_for_listing(page)
        result_text = page.text_content('#launch-result') or ""
        state = page.evaluate("window.__t")
        ran_launch = injected(page)
        page.reload(wait_until="networkidle")
        notice_text = page.text_content('#pending-launch-notice') or ""
        ran_notice = injected(page)
        page.close()
        create_meta = (state.get("createMetadataCalls") or [{}])[0]
        check("X: a name/symbol/description with HTML is previewed literally", review == [name, symbol, description] and not ran_review)
        check("X: it goes on-chain exactly as typed", create_meta.get("name") == name and create_meta.get("symbol") == symbol)
        check("X: the launch completes and verifies without running it", "Metadata locked." in result_text and not ran_launch)
        check("X: the recovery notice after a reload shows it literally", name in notice_text and symbol in notice_text and not ran_notice)

        # A malicious signature string from the RPC in the ✓ log line.
        rpc_payload = "<img src=x onerror=xss=4>"
        page = new_page(browser, init_t=f"{{ rpcSignature: {json.dumps(rpc_payload)} }}")
        fill_wizard_to_review(page)
        launch(page)
        result_text = page.text_content('#launch-result') or ""
        link = page.get_attribute('#launch-result a[href*="explorer.solana.com/tx/"]', 'href') or ""
        ran = injected(page)
        page.close()
        check("X: a signature returned by the RPC is shown as text in the log", f"mint: {rpc_payload}" in result_text and not ran)
        check("X: and URL-encoded in its Explorer link", "%3Cimg" in link and "<" not in link)

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
        check(
            "B1: after the resume succeeds, the record moves to 'listing' until Signal confirms (no API here)",
            pending_after_success is not None and json.loads(pending_after_success).get("stage") == "listing" and json.loads(pending_after_success).get("mint") == first_mint,
        )

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
        check(
            "B1 (reload): the record moves to 'listing' until Signal confirms (no API here)",
            pending_after_reload_finish is not None and json.loads(pending_after_reload_finish).get("stage") == "listing",
        )
        check(
            "C3 (reload): finishing a recovered launch also revokes mint authority",
            (state.get("setAuthorityCalls") or [{}])[0].get("account") == preexisting_mint,
        )
        check("C3 (reload): and shows 'Supply locked'", "Supply locked." in resume_status)

        # Finishing an existing mint (e.g. step 1 confirmed on Mainnet, step 2
        # refused by the old check) works with Phantom's Mainnet additions.
        page = new_page(browser, storage_js=seed_pending, sign_js=PHANTOM_MAINNET_SIGN_JS)
        page.goto(f"http://localhost:{PORT}/create/", wait_until="networkidle")
        page.click('#pendingResumeConnect')
        page.wait_for_function(
            "() => /Failed|Supply locked\\.|Supply lock check failed|couldn't be read back/"
            ".test(document.querySelector('#pendingResumeStatus').textContent)",
            timeout=20000,
        )
        resume_status = page.text_content('#pendingResumeStatus') or ""
        state = page.evaluate("window.__t")
        page.close()
        check("B1 (resume): finishing an existing mint works with Phantom's Mainnet additions", "Supply locked." in resume_status)
        check("B1 (resume): no new mint, supply minted to the existing one", "initMintCalls" not in state and (state.get("mintToCalls") or [{}])[0].get("mint") == preexisting_mint)

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

        # =================================================================
        # L — a launch stays recoverable until Signal confirms the listing
        # =================================================================
        print()

        def wait_for_text(page, selector, pattern):
            page.wait_for_function(
                f"() => /{pattern}/.test(document.querySelector({json.dumps(selector)}).textContent)",
                timeout=20000,
            )

        # The listing fails (API down), the page reloads, and the box offers
        # "List on Signal", which succeeds without any new transaction.
        page = new_page(browser)
        calls = stub_api(page, [503, 201])
        fill_wizard_to_review(page, name="Listing Later", symbol="LTR")
        launch(page)
        wait_for_listing(page)
        launched_mint = page.evaluate("window.__t.initMintCalls[0].mint")
        record = json.loads(page.evaluate(f"localStorage.getItem('{PENDING_KEY}')") or "null")
        page.reload(wait_until="networkidle")
        notice_text = page.text_content('#pending-launch-notice') or ""
        button_text = page.text_content('#pendingResumeConnect') or ""
        page.click('#pendingResumeConnect')
        wait_for_text(page, '#pending-launch-notice', "Listed on Signal|Not listed on Signal yet")
        after_text = page.text_content('#pending-launch-notice') or ""
        state_after = page.evaluate("window.__t")
        record_after = page.evaluate(f"localStorage.getItem('{PENDING_KEY}')")
        page.close()
        check("L: a failed listing keeps the record, now at stage 'listing'", record is not None and record.get("stage") == "listing" and record.get("mint") == launched_mint)
        check("L: after a reload, the box says it's launched but not listed", "not yet listed on Signal" in notice_text and button_text == "Connect wallet to list on Signal")
        check("L: listing from the box succeeds", "Listed on Signal" in after_text and len(calls) == 2 and calls[1]["body"]["address"] == launched_mint)
        check("L: and sends no transaction", "submittedCount" not in state_after and "initMintCalls" not in state_after)
        check("L: the record is cleared only once Signal confirms", record_after is None)

        # While a listing is pending, a new launch is refused (so its record
        # can't be overwritten), and dismissing it asks first.
        seed_listing = f"""localStorage.setItem('{PENDING_KEY}', JSON.stringify({{
            mint: 'ListingPendingMint1111111111111111111111', name: 'Pending Listing', symbol: 'PLS',
            supply: '500000000', decimals: 6, stage: 'listing',
            creatorAddress: '{CREATOR_WALLET}', createdAt: new Date().toISOString(),
        }}));"""
        page = new_page(browser, storage_js=seed_listing)
        fill_wizard_to_review(page, name="Second", symbol="SND")
        launch(page)
        state = page.evaluate("window.__t")
        result_text = page.text_content('#launch-result') or ""
        page.close()
        check("L: a new launch is refused while a listing is pending", "initMintCalls" not in state and "isn't listed on Signal yet" in result_text)

        page = new_page(browser, storage_js=seed_listing)
        page.goto(f"http://localhost:{PORT}/create/", wait_until="networkidle")
        dialog_text = []
        page.once("dialog", lambda d: (dialog_text.append(d.message), d.accept()))
        page.click('#pendingDismiss')
        cleared = page.evaluate(f"localStorage.getItem('{PENDING_KEY}')")
        page.close()
        check("L: dismissing a pending listing points to 'List an existing token'", cleared is None and dialog_text and "List an existing token" in dialog_text[0])

        # =================================================================
        # E — "List an existing token" by mint address
        # =================================================================
        print()
        EXISTING_MINT = "3mwznTzZ5LJic9nvBCMLkXgw7scA6HnX1GNuQwmUf4Ar"

        def list_existing(page, mint=EXISTING_MINT, name="Sig Test", symbol="sigtest"):
            page.goto(f"http://localhost:{PORT}/create/", wait_until="networkidle")
            page.click('#list-existing summary')
            page.fill('#le-mint', mint)
            page.fill('#le-name', name)
            page.fill('#le-symbol', symbol)
            page.click('#le-submit')

        page = new_page(browser)
        calls = stub_api(page, [201])
        list_existing(page)
        wait_for_text(page, '#le-result', "Listed on Signal|Not listed")
        result_text = page.text_content('#le-result') or ""
        state = page.evaluate("window.__t")
        page.close()
        body = calls[0]["body"] if calls else {}
        check("E: an existing mint is listed after the wallet signs in", "Listed on Signal" in result_text and len(state.get("signedMessages") or []) == 1)
        check("E: it registers that mint with the on-chain decimals and the typed name/symbol", body.get("address") == EXISTING_MINT and body.get("decimals") == 6 and body.get("name") == "Sig Test" and body.get("symbol") == "SIGTEST")
        check("E: the creator comes from the session, not the request", "creatorWalletAddress" not in body and (calls[0]["authorization"] or "").startswith("Bearer "))
        check("E: it reads the mint on-chain and sends no transaction", state.get("getMintCalls", 0) >= 1 and "submittedCount" not in state)

        page = new_page(browser, init_t="{ mintAuthorityAfter: 'StillTheCreator1111111111111111111111111' }")
        calls = stub_api(page, [201])
        list_existing(page)
        wait_for_text(page, '#le-result', "Listed on Signal|Not listed")
        result_text = page.text_content('#le-result') or ""
        page.close()
        check("E: a mint whose authority is still active is refused before registering", "authority is still active" in result_text and len(calls) == 0)

        page = new_page(browser)
        calls = stub_api(page, [201])
        list_existing(page, mint="not-a-mint")
        result_text = page.text_content('#le-result') or ""
        state = page.evaluate("window.__t")
        page.close()
        check("E: an invalid address is refused without connecting or registering", "valid Solana mint address" in result_text and len(calls) == 0 and "getMintCalls" not in state)

        page = new_page(browser)
        calls = stub_api(page, [409])
        list_existing(page)
        wait_for_text(page, '#le-result', "Listed on Signal|Not listed")
        result_text = page.text_content('#le-result') or ""
        has_retry = page.is_visible('#le-result button:has-text("Try again")')
        page.close()
        check("E: a refusal from the server (e.g. already registered) is shown with Try again", "already registered" in result_text and has_retry)

        # Listing via this form also clears a matching pending-listing record.
        seed_existing = seed_listing.replace("ListingPendingMint1111111111111111111111", EXISTING_MINT)
        page = new_page(browser, storage_js=seed_existing)
        calls = stub_api(page, [201])
        list_existing(page)
        wait_for_text(page, '#le-result', "Listed on Signal|Not listed")
        cleared = page.evaluate(f"localStorage.getItem('{PENDING_KEY}')")
        page.close()
        check("E: listing a mint here also clears its pending-listing record", cleared is None)

        browser.close()

    httpd.shutdown()
    print(f"\n{passed} passed, {failed} failed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
