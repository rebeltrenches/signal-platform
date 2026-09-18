#!/usr/bin/env python3
"""
Real, re-runnable verification for apps/web/src/client/collect-fees.js
and its authorization gating in apps/web/src/client/dashboard.js.

WHY PYTHON, NOT `npx tsx ...test.ts` (the convention used everywhere
else in this repo): collect-fees.js is browser-only code (uses `window`,
`document`, dynamic DOM) that imports @solana/web3.js and
@solana/spl-token from a CDN URL — it cannot run under plain Node, and
neither the `playwright` nor `@playwright/test` npm packages are
installed in the sandbox this was built in (no internet access to
install them; confirmed directly before writing this file). Python's
Playwright IS available here, so this is a real, actually-runnable test,
not a theoretical one — just in a different language than the rest of
this repo's tests, for a concrete, disclosed environmental reason.

WHAT THIS PROVES: the ORCHESTRATION logic in collect-fees.js — which
wallet ends up as the transaction's authority and destination, whether a
transaction is sent at all, how errors and the zero-fees case are
handled. The two stub modules in ./stubs/ replace @solana/web3.js and
@solana/spl-token with minimal fakes that record what they're called
with — this does NOT verify that the REAL Solana libraries behave as
expected (impossible to check without installing them, which requires
internet this sandbox doesn't have). Real behavior against a real
network has never been executed, same as every other Solana-touching
file in this project.

Run with: python3 apps/web/tests/collect-fees.test.py
Requires: a built apps/web/dist (run apps/web/scripts/build.tsx first)
          and the `playwright` Python package with chromium installed.
"""
import http.server
import socketserver
import threading
import sys
import time
import os
from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.dirname(os.path.abspath(__file__)) + "/../../.."
DIST_DIR = os.path.join(REPO_ROOT, "apps/web/dist")
STUBS_DIR = os.path.join(REPO_ROOT, "apps/web/tests/stubs")
PORT = 8099

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
    handler = http.server.SimpleHTTPRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", PORT), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def run_collect(page, wallet_address, mint_address, fixture_accounts_js, extra_init_js=""):
    page.route(
        "https://esm.sh/@solana/web3.js@1.95.3",
        lambda r: r.fulfill(path=os.path.join(STUBS_DIR, "web3.js"), content_type="application/javascript"),
    )
    page.route(
        "**/esm.sh/@solana/spl-token@0.4.9**",
        lambda r: r.fulfill(path=os.path.join(STUBS_DIR, "spl-token.js"), content_type="application/javascript"),
    )
    page.add_init_script(f"""
      window.__t = {{ fixtureAccounts: {fixture_accounts_js} }};
      {extra_init_js}
      window.solana = {{
        isPhantom: true,
        connect: async () => ({{ publicKey: {{ toString: () => '{wallet_address}' }} }}),
        signTransaction: async (tx) => {{ tx.serialize = () => new Uint8Array([1]); return tx; }},
      }};
      localStorage.setItem('signal_real_launches_v1', JSON.stringify([
        {{ name: 'Test', symbol: 'TST', mint: '{mint_address}', creatorAddress: '{wallet_address}', decimals: 6, launchedAt: new Date().toISOString() }}
      ]));
    """)
    page.goto(f"http://localhost:{PORT}/dashboard", wait_until="networkidle")
    page.evaluate("""
      document.querySelectorAll('[data-dashboard-state="disconnected"]').forEach(el => el.hidden = true);
      document.querySelectorAll('[data-dashboard-state="connected"]').forEach(el => el.hidden = false);
    """)
    page.evaluate(f"""
      window.launchpadWallet = {{ address: '{wallet_address}' }};
      document.dispatchEvent(new CustomEvent('launchpad:wallet-connected'));
    """)
    page.wait_for_timeout(200)
    btn = page.query_selector('[data-collect-mint]')
    if btn:
        page.click('[data-collect-mint]')
        page.wait_for_timeout(500)
    return btn is not None


def main():
    if not os.path.isdir(DIST_DIR):
        print(f"ERROR: {DIST_DIR} does not exist — run the build first (apps/web/scripts/build.tsx).")
        sys.exit(1)

    httpd = start_server()
    time.sleep(0.3)

    print("collect-fees.test.py\n")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # --- Case 1: dynamic destination + harvest/withdraw construction, wallet A ---
        page = browser.new_page()
        has_btn_a = run_collect(
            page, "WalletAAAA1111111111111111111111111111", "MintForA1111111111111111111111111111111",
            "[{ account: { __unpacked: { withheld: 5000000n } }, pubkey: { toBase58: () => 'HolderA' } }]",
        )
        state_a = page.evaluate("window.__t")
        page.close()

        check("Case 1: button rendered for the wallet that launched this token", has_btn_a)
        check("Case 1: withdraw authority equals the connected wallet", state_a.get("withdrawCall", {}).get("authority") == "WalletAAAA1111111111111111111111111111")
        check("Case 1: destination ATA is derived from the connected wallet", state_a.get("withdrawCall", {}).get("destAta") == "ATA_FOR_WalletAAAA1111111111111111111111111111")
        check("Case 1: a real harvest instruction was built for the withheld account", len(state_a.get("harvestCalls", [])) == 1)
        check("Case 1: two transactions were confirmed (harvest + withdraw)", len(state_a.get("confirmedSignatures", [])) == 2)

        # --- Case 2: a DIFFERENT wallet/mint produces a DIFFERENT destination (proves not hardcoded) ---
        page = browser.new_page()
        run_collect(
            page, "WalletBBBB2222222222222222222222222222", "MintForB2222222222222222222222222222222",
            "[{ account: { __unpacked: { withheld: 5000000n } }, pubkey: { toBase58: () => 'HolderB' } }]",
        )
        state_b = page.evaluate("window.__t")
        page.close()

        check(
            "Case 2: destination differs from Case 1 (proves dynamic, not a fixed address)",
            state_b.get("withdrawCall", {}).get("destAta") != state_a.get("withdrawCall", {}).get("destAta"),
        )
        check("Case 2: destination correctly matches wallet B, not wallet A", state_b.get("withdrawCall", {}).get("destAta") == "ATA_FOR_WalletBBBB2222222222222222222222222222")

        # --- Case 3: authorization — a wallet that did NOT launch the token gets no button ---
        page = browser.new_page()
        page.add_init_script("""
          localStorage.setItem('signal_real_launches_v1', JSON.stringify([
            { name: 'Test', symbol: 'TST', mint: 'SomeMint111111111111111111111111111111', creatorAddress: 'ActualLauncher111111111111111111111111', decimals: 6, launchedAt: new Date().toISOString() }
          ]));
        """)
        page.goto(f"http://localhost:{PORT}/dashboard", wait_until="networkidle")
        page.evaluate("""
          document.querySelectorAll('[data-dashboard-state="disconnected"]').forEach(el => el.hidden = true);
          document.querySelectorAll('[data-dashboard-state="connected"]').forEach(el => el.hidden = false);
          window.launchpadWallet = { address: 'UnrelatedWallet2222222222222222222222' };
          document.dispatchEvent(new CustomEvent('launchpad:wallet-connected'));
        """)
        page.wait_for_timeout(200)
        no_btn_for_wrong_wallet = page.query_selector('[data-collect-mint]') is None

        page.evaluate("""
          window.launchpadWallet = { address: 'ActualLauncher111111111111111111111111' };
          document.dispatchEvent(new CustomEvent('launchpad:wallet-connected'));
        """)
        page.wait_for_timeout(200)
        btn_for_right_wallet = page.query_selector('[data-collect-mint]') is not None
        page.close()

        check("Case 3: no Collect Fees button for a wallet that did not launch the token", no_btn_for_wrong_wallet)
        check("Case 3: Collect Fees button appears for the actual launcher wallet", btn_for_right_wallet)

        # --- Case 4: no withheld fees anywhere — must NOT send any transaction ---
        page = browser.new_page()
        run_collect(page, "WalletC333333333333333333333333333333", "MintC3333333333333333333333333333333333", "[]")
        state_c = page.evaluate("window.__t")
        status_c = page.text_content('[data-collect-status]')
        page.close()

        check("Case 4: zero transactions submitted when nothing is withheld", state_c.get("submittedCount", 0) == 0)
        check("Case 4: status message says no fees, not a false success", "No fees to collect" in (status_c or ""))

        # --- Case 5: a real error during submission must surface honestly, not as success ---
        page = browser.new_page()
        run_collect(
            page, "WalletD444444444444444444444444444444", "MintD4444444444444444444444444444444444",
            "[{ account: { __unpacked: { withheld: 1000n } }, pubkey: { toBase58: () => 'AccX' } }]",
            extra_init_js="window.__t.forceSubmitError = 'RPC rejected: insufficient fee';",
        )
        status_e = page.text_content('[data-collect-status]')
        page.close()

        check("Case 5: a real submission error is shown, not hidden or shown as success", "Failed" in (status_e or "") and "insufficient fee" in (status_e or ""))

        browser.close()

    httpd.shutdown()

    print(f"\n{passed} passed, {failed} failed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
