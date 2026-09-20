#!/usr/bin/env python3
"""
Real, re-runnable verification for the two fixes in this pass:

  B1 — a mint created in step 1 must never be silently abandoned if
       step 2 (minting its supply) fails. The address must be shown and
       recoverable, and a retry must resume the SAME mint, never create
       a second one.

  B2 — invalid supply (empty, zero, negative-shaped, decimal, non-numeric,
       or below the 100,000,000 minimum) must never allow buildCreateTx
       to run — checked independently in launch-solana.js itself, not
       assumed from wizard.js having already validated.

Same honesty scope as the other files in this directory: the stub
modules in ./stubs/ replace @solana/web3.js and @solana/spl-token with
fakes that record what they're called with. This proves
apps/web/src/client/launch-solana.js's own orchestration and validation
logic — not the real Solana libraries' behavior, which can't be verified
without installing them (no internet in this sandbox). No real
transaction has ever been submitted to any network from this project.

Run with: python3 apps/web/tests/supply-validation-and-recovery.test.py
Requires: a built apps/web/dist and Python's `playwright` package.
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


def start_server():
    os.chdir(DIST_DIR)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def route_stubs(page):
    page.route(
        "https://esm.sh/@solana/web3.js@1.95.3",
        lambda r: r.fulfill(path=os.path.join(STUBS_DIR, "web3.js"), content_type="application/javascript"),
    )
    page.route(
        "**/esm.sh/@solana/spl-token@0.4.9**",
        lambda r: r.fulfill(path=os.path.join(STUBS_DIR, "spl-token.js"), content_type="application/javascript"),
    )


def fill_wizard_to_review(page, supply_value, name="Test Token", symbol="TST"):
    page.goto(f"http://localhost:{PORT}/create", wait_until="networkidle")
    page.click('.wizard-step[data-step="0"] [data-chain="solana"]')
    page.click('.wizard-step[data-step="0"] [data-action="next"]')
    page.fill('.wizard-step[data-step="1"] #tk-name', name)
    page.fill('.wizard-step[data-step="1"] #tk-symbol', symbol)
    page.click('.wizard-step[data-step="1"] [data-action="next"]')
    # Fill with a KNOWN-VALID value first so the wizard's own "next"
    # button enables — we tamper with window.launchpadWizard.supply
    # directly afterward to reach launch-solana.js's independent check,
    # deliberately bypassing wizard.js's own gate the way stale state,
    # a bug in that file, or any other path into this same button would.
    page.fill('.wizard-step[data-step="2"] #tk-supply', "1000000000")
    page.click('.wizard-step[data-step="2"] [data-action="next"]')
    page.evaluate(f"window.launchpadWizard.supply = {supply_value!r};")


def main():
    if not os.path.isdir(DIST_DIR):
        print(f"ERROR: {DIST_DIR} does not exist — run the build first.")
        sys.exit(1)

    httpd = start_server()
    time.sleep(0.3)
    print("supply-validation-and-recovery.test.py\n")

    creator_wallet = "SupplyTestWallet111111111111111111111111"

    # =====================================================================
    # B2 — invalid supply must never reach buildCreateTx
    # =====================================================================
    invalid_cases = [
        ("", "empty"),
        ("0", "zero"),
        ("-100000000", "negative"),
        ("100000000.5", "decimal"),
        ("abc", "non-numeric"),
        ("1e9", "exponential notation"),
        ("1,000,000,000", "commas"),
        ("99999999", "one below the minimum"),
    ]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for supply_value, description in invalid_cases:
            page = browser.new_page()
            route_stubs(page)
            page.add_init_script(f"""
              window.__t = {{}};
              window.SIGNAL_PLATFORM_WALLET = 'FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19';
              window.solana = {{
                isPhantom: true,
                connect: async () => ({{ publicKey: {{ toBase58: () => '{creator_wallet}' }} }}),
                signTransaction: async (tx) => {{ tx.serialize = () => new Uint8Array([1]); return tx; }},
              }};
            """)
            fill_wizard_to_review(page, supply_value)
            page.click('#mainnetConnectBtn')
            page.check('#mainnetAck')
            page.click('#mainnetLaunchBtn')
            page.wait_for_timeout(400)

            state = page.evaluate("window.__t")
            result_text = page.text_content('#launch-result') or ""
            page.close()

            check(
                f"B2: supply={description!r} ({supply_value!r}) never reaches createInitializeTransferFeeConfigInstruction",
                "transferFeeConfigCall" not in state,
            )
            check(
                f"B2: supply={description!r} shows a real error message, not a silent failure",
                "Failed" in result_text,
            )

        # Boundary: exactly the minimum must be ACCEPTED
        page = browser.new_page()
        route_stubs(page)
        page.add_init_script(f"""
          window.__t = {{}};
              window.SIGNAL_PLATFORM_WALLET = 'FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19';
          window.solana = {{
            isPhantom: true,
            connect: async () => ({{ publicKey: {{ toBase58: () => '{creator_wallet}' }} }}),
            signTransaction: async (tx) => {{ tx.serialize = () => new Uint8Array([1]); return tx; }},
          }};
        """)
        fill_wizard_to_review(page, "100000000")  # exactly the minimum
        page.click('#mainnetConnectBtn')
        page.check('#mainnetAck')
        page.click('#mainnetLaunchBtn')
        page.wait_for_timeout(400)
        state = page.evaluate("window.__t")
        page.close()
        check("B2: supply exactly at the minimum (100,000,000) is ACCEPTED, not rejected", "transferFeeConfigCall" in state)

        browser.close()

    # =====================================================================
    # B1 — partial-launch recovery: step 1 succeeds, step 2 fails, then
    # a retry must resume the SAME mint, never create a second one.
    # =====================================================================
    print()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        route_stubs(page)
        page.add_init_script(f"""
          window.__t = {{ failConfirmOnCall: 2, failConfirmError: 'simulated: user rejected supply-mint signature' }};
              window.SIGNAL_PLATFORM_WALLET = 'FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19';
          window.solana = {{
            isPhantom: true,
            connect: async () => ({{ publicKey: {{ toBase58: () => '{creator_wallet}' }} }}),
            signTransaction: async (tx) => {{ tx.serialize = () => new Uint8Array([1]); return tx; }},
          }};
          localStorage.removeItem('signal_pending_launch_v1');
          localStorage.removeItem('signal_real_launches_v1');
        """)
        fill_wizard_to_review(page, "1000000000", name="Recovery Test", symbol="RCV")
        page.click('#mainnetConnectBtn')
        page.check('#mainnetAck')
        page.click('#mainnetLaunchBtn')
        page.wait_for_timeout(500)

        result_after_failure = page.text_content('#launch-result') or ""
        pending_after_failure = page.evaluate("localStorage.getItem('signal_pending_launch_v1')")
        button_text_after_failure = page.text_content('#mainnetLaunchBtn')
        mint_after_first_attempt = page.evaluate("(window.__t.transferFeeConfigCall || {}).mint")

        check("B1: the mint address IS shown in the UI even though step 2 failed", "Mint created:" in result_after_failure)
        check("B1: a pending-launch record is saved to localStorage", pending_after_failure is not None)
        check("B1: the button now reads a resume label, not generic 'Retry'", "Finish minting supply" in (button_text_after_failure or ""))

        pending_record = json.loads(pending_after_failure) if pending_after_failure else {}
        check("B1: the pending record's mint matches the one actually created on-chain", pending_record.get("mint") == mint_after_first_attempt)

        # Now let the retry succeed, and click again — this must NOT
        # create a second mint (i.e. must NOT call createInitializeTransferFeeConfigInstruction again).
        page.evaluate("window.__t.failConfirmOnCall = null; window.__t.transferFeeConfigCallCountBefore = 1;")
        page.click('#mainnetLaunchBtn')
        page.wait_for_timeout(500)

        mint_after_second_attempt = page.evaluate("(window.__t.transferFeeConfigCall || {}).mint")
        final_result_text = page.text_content('#launch-result') or ""
        pending_after_success = page.evaluate("localStorage.getItem('signal_pending_launch_v1')")
        real_launches = page.evaluate("JSON.parse(localStorage.getItem('signal_real_launches_v1') || '[]')")

        browser.close()

    check(
        "B1: the SAME mint (not a second, different one) is used to complete the launch",
        mint_after_second_attempt == mint_after_first_attempt,
    )
    check(
        "B1: the completed launch is recorded under that SAME mint address",
        len(real_launches) == 1 and real_launches[0]["mint"] == mint_after_first_attempt,
    )
    check("B1: the pending-launch record is cleared after the resume succeeds", pending_after_success is None)
    check("B1: the final UI shows the real completion", "Done." in final_result_text)

    # =====================================================================
    # B1 (continued) — cross-RELOAD recovery: a pending record already in
    # localStorage BEFORE the page even loads (simulating the user having
    # closed the tab after step 1 and come back later), with no in-memory
    # state at all. This exercises the page-load path
    # (getPendingLaunch/refreshLaunchButton), not the same-session retry
    # path already covered above — genuinely different code.
    # =====================================================================
    print()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        route_stubs(page)
        preexisting_mint = "PreexistingMintFromEarlierSession1111111"
        page.add_init_script(f"""
          window.__t = {{}};
              window.SIGNAL_PLATFORM_WALLET = 'FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19';
          window.solana = {{
            isPhantom: true,
            connect: async () => ({{ publicKey: {{ toBase58: () => '{creator_wallet}' }} }}),
            signTransaction: async (tx) => {{ tx.serialize = () => new Uint8Array([1]); return tx; }},
          }};
          localStorage.setItem('signal_pending_launch_v1', JSON.stringify({{
            mint: '{preexisting_mint}', name: 'Reloaded Token', symbol: 'RLD',
            supply: '500000000', decimals: 6,
            creatorAddress: '{creator_wallet}', createdAt: new Date().toISOString(),
          }}));
          localStorage.removeItem('signal_real_launches_v1');
        """)
        # A fresh page load — NOT going through the wizard at all, since
        # recovery must work independent of wizard state and chain
        # selection (this is the whole point of the fix: the notice
        # lives outside the wizard-step hidden system entirely).
        page.goto(f"http://localhost:{PORT}/create", wait_until="networkidle")

        notice_text = page.text_content('#pending-launch-notice') or ""
        check("B1 (reload): the incomplete-launch notice appears on page load, before any click", preexisting_mint in notice_text)

        page.click('#pendingResumeConnect')
        page.wait_for_timeout(500)

        mint_used = page.evaluate("(window.__t.transferFeeConfigCall || {}).mint")
        real_launches_reload = page.evaluate("JSON.parse(localStorage.getItem('signal_real_launches_v1') || '[]')")
        browser.close()

    check("B1 (reload): buildCreateTx was NEVER called for the recovered mint (no transferFeeConfigCall at all)", mint_used is None)
    check(
        "B1 (reload): the recovered launch completes using the PRE-EXISTING mint from before the reload",
        len(real_launches_reload) == 1 and real_launches_reload[0]["mint"] == preexisting_mint,
    )

    print(f"\n{passed} passed, {failed} failed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
