#!/usr/bin/env python3
"""
Real browser tests for apps/web/src/client/evm-wallet.js against a
mocked window.ethereum (a real browser, real module execution, a fake
wallet provider — no real MetaMask/extension exists in this sandbox to
test against, and no internet exists to reach a real EVM RPC endpoint
either way). This proves the module's own connection/chain-mapping/
event-handling logic, not that a real wallet extension behaves exactly
like the mock — stated precisely, same as every other real-vs-mocked
boundary in this project.

Requires: a built apps/web/dist and Python's `playwright` package.
Run with: python3 apps/web/tests/evm-wallet.test.py
"""
import http.server
import os
import socketserver
import threading
import time

from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
DIST_DIR = os.path.join(REPO_ROOT, "apps/web/dist")
PORT = 8934

passed = 0
failed = 0


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        print(f"  ok  - {name}")
        passed += 1
    else:
        print(f"  FAIL - {name}{f' ({detail})' if detail else ''}")
        failed += 1


MOCK_ETHEREUM_JS = """
window.ethereum = {
  _handlers: {},
  _chainId: '0x2105', // Base mainnet
  _accounts: ['0xAbC1230000000000000000000000000000dEaD'],
  _shouldReject: false,
  request: async function(args) {
    if (window.ethereum._shouldReject) throw new Error('User rejected the request.');
    if (args.method === 'eth_requestAccounts') return window.ethereum._accounts;
    if (args.method === 'eth_chainId') return window.ethereum._chainId;
    throw new Error('Unexpected method: ' + args.method);
  },
  on: function(event, handler) { window.ethereum._handlers[event] = handler; },
  _fireAccountsChanged: function(accounts) { window.ethereum._handlers['accountsChanged']?.(accounts); },
  _fireChainChanged: function(chainId) { window.ethereum._handlers['chainChanged']?.(chainId); },
};
"""


def run():
    if not os.path.isdir(DIST_DIR):
        print(f"ERROR: {DIST_DIR} does not exist — run the build first.")
        return False

    os.chdir(DIST_DIR)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", PORT), http.server.SimpleHTTPRequestHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.3)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            # --- Successful connection, correct chain ---
            page = browser.new_page()
            page.add_init_script(MOCK_ETHEREUM_JS)
            page.goto(f"http://localhost:{PORT}/create")
            result = page.evaluate("""
              async () => {
                const mod = await import('/client/evm-wallet.js');
                return await mod.connectEvmWallet();
              }
            """)
            check("connectEvmWallet returns the real mocked address", result["address"] == "0xAbC1230000000000000000000000000000dEaD")
            check("connectEvmWallet maps chain id 0x2105 to 'base' correctly", result["chainName"] == "base")

            state = page.evaluate("window.launchpadEvmWallet")
            check("window.launchpadEvmWallet is set after connecting", state["address"] is not None)

            solana_state = page.evaluate("window.launchpadWallet")
            check("window.launchpadWallet (Solana) is untouched by an EVM connection — kept namespaced separately", solana_state is None or solana_state.get("address") is None)

            # --- BNB chain mapping ---
            page2 = browser.new_page()
            page2.add_init_script(MOCK_ETHEREUM_JS + "window.ethereum._chainId = '0x38';")
            page2.goto(f"http://localhost:{PORT}/create")
            result2 = page2.evaluate("""
              async () => {
                const mod = await import('/client/evm-wallet.js');
                return await mod.connectEvmWallet();
              }
            """)
            check("chain id 0x38 maps to 'bnb' correctly", result2["chainName"] == "bnb")

            # --- Unknown chain never fabricated as base/bnb ---
            page3 = browser.new_page()
            page3.add_init_script(MOCK_ETHEREUM_JS + "window.ethereum._chainId = '0x1';")  # Ethereum mainnet
            page3.goto(f"http://localhost:{PORT}/create")
            result3 = page3.evaluate("""
              async () => {
                const mod = await import('/client/evm-wallet.js');
                return await mod.connectEvmWallet();
              }
            """)
            check("an unrecognized chain id (Ethereum mainnet) maps to null, never fabricated as base/bnb", result3["chainName"] is None)

            # --- User rejection is a real thrown error, never a fake success ---
            page4 = browser.new_page()
            page4.add_init_script(MOCK_ETHEREUM_JS + "window.ethereum._shouldReject = true;")
            page4.goto(f"http://localhost:{PORT}/create")
            rejected = page4.evaluate("""
              async () => {
                const mod = await import('/client/evm-wallet.js');
                try { await mod.connectEvmWallet(); return false; }
                catch { return true; }
              }
            """)
            check("a rejected connection throws — never resolves as a fake success", rejected)

            # --- No wallet extension at all ---
            page5 = browser.new_page()
            page5.goto(f"http://localhost:{PORT}/create")
            no_wallet = page5.evaluate("""
              async () => {
                const mod = await import('/client/evm-wallet.js');
                if (mod.isEvmWalletAvailable()) return 'FAIL: reported available with none present';
                try { await mod.connectEvmWallet(); return 'FAIL: connected with no wallet'; }
                catch (e) { return 'ok'; }
              }
            """)
            check("with no window.ethereum at all, isEvmWalletAvailable() is honestly false and connect() throws", no_wallet == "ok", no_wallet)

            # --- Real reactivity: accountsChanged / chainChanged ---
            page6 = browser.new_page()
            page6.add_init_script(MOCK_ETHEREUM_JS)
            page6.goto(f"http://localhost:{PORT}/create")
            page6.evaluate("""
              async () => {
                const mod = await import('/client/evm-wallet.js');
                await mod.connectEvmWallet();
                mod.watchEvmWalletChanges();
                window.ethereum._fireAccountsChanged(['0xNewAccount000000000000000000000000000000']);
              }
            """)
            new_state = page6.evaluate("window.launchpadEvmWallet")
            check("accountsChanged updates window.launchpadEvmWallet to the new real address", new_state["address"] == "0xNewAccount000000000000000000000000000000")

            page6.evaluate("window.ethereum._fireAccountsChanged([])")
            disconnected_state = page6.evaluate("window.launchpadEvmWallet")
            check("accountsChanged with zero accounts is treated as a real disconnect, not left stale", disconnected_state["address"] is None)

            browser.close()
    finally:
        httpd.shutdown()

    print(f"\n{passed} passed, {failed} failed.")
    return failed == 0


if __name__ == "__main__":
    success = run()
    exit(0 if success else 1)
