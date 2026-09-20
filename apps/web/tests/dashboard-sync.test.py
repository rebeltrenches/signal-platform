#!/usr/bin/env python3
"""
Real, end-to-end cross-device test for Dashboard's "Your launches" sync.
Registers a real token via the actual API (a real subprocess), then
opens Dashboard in a genuinely SEPARATE browser context (isolated
storage, not just a new tab — Playwright's real mechanism for this)
with no local cache for that token, and confirms it appears from real
backend data. Separately confirms an existing local-only entry (one
the backend doesn't know about) survives the sync, never silently lost.

Run with: python3 apps/web/tests/dashboard-sync.test.py
Requires: a built apps/web/dist and Python's `playwright` package.
"""
import http.server
import os
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request
import json

from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
DIST_DIR = os.path.join(REPO_ROOT, "apps/web/dist")
STATIC_PORT = 8948
API_PORT = 4505

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


def register(api_port, address, name, symbol, creator):
    payload = json.dumps({
        "chain": "solana", "address": address, "name": name,
        "symbol": symbol, "decimals": 6, "creatorWalletAddress": creator,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"http://localhost:{api_port}/api/v1/tokens/register", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status


def run():
    if not os.path.isdir(DIST_DIR):
        print(f"ERROR: {DIST_DIR} does not exist — run the build first.")
        return False

    env = dict(os.environ)
    env["PORT"] = str(API_PORT)
    api_proc = subprocess.Popen(
        ["npx", "tsx", "apps/api/src/server.ts"],
        cwd=REPO_ROOT, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    time.sleep(1.5)

    creator = "DashboardSyncCreator111"

    status = register(API_PORT, "DashboardSyncMintAAA", "Cross Device Token", "XDT", creator)
    check("setup: a real token registered via the actual API (simulating device A's launch)", status == 201, str(status))

    os.chdir(DIST_DIR)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", STATIC_PORT), http.server.SimpleHTTPRequestHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.3)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            context_b = browser.new_context()
            page_b = context_b.new_page()
            page_b.add_init_script(f"""
              window.SIGNAL_API_BASE_URL = 'http://localhost:{API_PORT}';
              window.launchpadWallet = {{ address: '{creator}' }};
            """)
            page_b.goto(f"http://localhost:{STATIC_PORT}/dashboard", wait_until="networkidle")
            page_b.evaluate("""
              document.querySelectorAll('[data-dashboard-state="disconnected"]').forEach(el => el.hidden = true);
              document.querySelectorAll('[data-dashboard-state="connected"]').forEach(el => el.hidden = false);
              document.dispatchEvent(new CustomEvent('launchpad:wallet-connected'));
            """)
            page_b.wait_for_timeout(600)

            list_html = page_b.inner_html("#launches-list")
            check(
                "the token registered on 'device A' genuinely appears on 'device B', which had zero local cache for it",
                "Cross Device Token" in list_html, list_html[:200],
            )

            synced_to_local = page_b.evaluate("""
              JSON.parse(localStorage.getItem('signal_real_launches_v1') || '[]')
                .some(l => l.mint === 'DashboardSyncMintAAA')
            """)
            check("the synced token was actually written into device B's own local cache, not just rendered transiently", synced_to_local)

            context_b.close()

            context_c = browser.new_context()
            page_c = context_c.new_page()
            page_c.add_init_script(f"""
              window.SIGNAL_API_BASE_URL = 'http://localhost:{API_PORT}';
              window.launchpadWallet = {{ address: '{creator}' }};
              localStorage.setItem('signal_real_launches_v1', JSON.stringify([
                {{ name: 'Local Only Token', symbol: 'LOT', mint: 'NeverRegisteredLocalOnlyMint', creatorAddress: '{creator}', decimals: 6, launchedAt: new Date().toISOString() }}
              ]));
            """)
            page_c.goto(f"http://localhost:{STATIC_PORT}/dashboard", wait_until="networkidle")
            page_c.evaluate("""
              document.querySelectorAll('[data-dashboard-state="disconnected"]').forEach(el => el.hidden = true);
              document.querySelectorAll('[data-dashboard-state="connected"]').forEach(el => el.hidden = false);
              document.dispatchEvent(new CustomEvent('launchpad:wallet-connected'));
            """)
            page_c.wait_for_timeout(600)

            list_html_c = page_c.inner_html("#launches-list")
            check("a pre-existing LOCAL-ONLY entry (unknown to the backend) is still shown after syncing — never silently dropped", "Local Only Token" in list_html_c, list_html_c[:200])
            check("the backend-known token ALSO appears alongside it — merge, not replace", "Cross Device Token" in list_html_c, list_html_c[:200])

            local_after_sync = page_c.evaluate("JSON.parse(localStorage.getItem('signal_real_launches_v1') || '[]')")
            check("both entries genuinely coexist in local storage after the merge", len(local_after_sync) == 2, str(local_after_sync))

            context_c.close()
            browser.close()
    finally:
        httpd.shutdown()
        api_proc.terminate()
        api_proc.wait(timeout=5)

    print(f"\n{passed} passed, {failed} failed.")
    return failed == 0


if __name__ == "__main__":
    success = run()
    sys.exit(0 if success else 1)
