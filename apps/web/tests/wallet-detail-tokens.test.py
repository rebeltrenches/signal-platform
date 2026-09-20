#!/usr/bin/env python3
"""
Real, end-to-end test for WalletDetailPage's "Created tokens" tab and
Passport "Tokens launched" count. Registers a real token via the actual
API for the literal creator address "example" (matching the one real,
built /wallet/example page — this static test server has no wildcard
/wallet/* routing, same situation as token-detail's own test), and
confirms both real states: before registration (honest placeholders)
and after (real data).

Run with: python3 apps/web/tests/wallet-detail-tokens.test.py
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
STATIC_PORT = 8950
API_PORT = 4507

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

    os.chdir(DIST_DIR)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", STATIC_PORT), http.server.SimpleHTTPRequestHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.3)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.add_init_script(f"window.SIGNAL_API_BASE_URL = 'http://localhost:{API_PORT}';")

            page.goto(f"http://localhost:{STATIC_PORT}/wallet/example/", wait_until="networkidle")
            page.wait_for_timeout(500)
            page.click('[data-tab="Created tokens"]')
            page.wait_for_timeout(200)
            created_before = page.inner_text('[data-panel="Created tokens"]')
            check("before registering anything, 'Created tokens' honestly shows its original empty state", "No launches indexed" in created_before, created_before)

            page.click('[data-tab="Signal Passport"]')
            page.wait_for_timeout(200)
            passport_before = page.inner_html("#wallet-tokens-launched-row")
            check("before registering anything, the Passport count honestly shows 'Unavailable'", "Unavailable" in passport_before, passport_before)

            status = register(API_PORT, "WalletDetailTestMint111", "Wallet Detail Test Token", "WDT", "example")
            check("setup: a real token registered for creator 'example'", status == 201, str(status))

            page.reload(wait_until="networkidle")
            page.wait_for_timeout(500)

            page.click('[data-tab="Created tokens"]')
            page.wait_for_timeout(300)
            created_after = page.inner_text('[data-panel="Created tokens"]')
            check("AFTER registering, 'Created tokens' shows the real token", "Wallet Detail Test Token" in created_after, created_after)
            check("the empty-state copy is gone once real data loads", "No launches indexed" not in created_after, created_after)

            page.click('[data-tab="Signal Passport"]')
            page.wait_for_timeout(200)
            passport_after = page.inner_text("#wallet-tokens-launched-row")
            check("AFTER registering, the Passport count shows a real '1', not 'Unavailable'", "1" in passport_after and "Unavailable" not in passport_after, passport_after)

            page.click('[data-tab="Holdings"]')
            page.wait_for_timeout(200)
            holdings_text = page.inner_text('[data-panel="Holdings"]')
            check("Holdings tab is untouched — still genuinely blocked on Stage 11", "Stage 11" in holdings_text, holdings_text)

            page.click('[data-tab="Trades"]')
            page.wait_for_timeout(200)
            trades_text = page.inner_text('[data-panel="Trades"]')
            check("Trades tab is untouched — still genuinely blocked on Stage 11", "Stage 11" in trades_text, trades_text)

            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(400)
            real_errors = [e for e in console_errors if 'esm.sh' not in e and 'ERR_FAILED' not in e]
            check(f"zero unexpected console errors (saw {len(console_errors)} total, {len(real_errors)} unexplained)", len(real_errors) == 0, str(real_errors))

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
