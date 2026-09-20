#!/usr/bin/env python3
"""
Real, end-to-end test for Watchlist registration-status enrichment.
Registers a real token via the actual API (a real subprocess), adds it
plus a genuinely unregistered address to the Watchlist, and confirms
each shows the correct, distinct, real status — never fabricated in
either direction.

Run with: python3 apps/web/tests/watchlist-registration-status.test.py
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
STATIC_PORT = 8949
API_PORT = 4506

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

    status = register(API_PORT, "WatchlistEnrichRegisteredMint", "Watchlist Enrich Token", "WET", "WatchlistEnrichCreator")
    check("setup: a real token registered via the actual API", status == 201, str(status))

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

            page.goto(f"http://localhost:{STATIC_PORT}/dashboard", wait_until="networkidle")
            page.evaluate("""
              document.querySelectorAll('[data-dashboard-state="disconnected"]').forEach(el => el.hidden = true);
              document.querySelectorAll('[data-dashboard-state="connected"]').forEach(el => el.hidden = false);
            """)
            page.wait_for_timeout(200)

            page.fill("#watchlistInput", "WatchlistEnrichRegisteredMint")
            page.click("#watchlistAddBtn")
            page.wait_for_timeout(200)

            page.fill("#watchlistInput", "GenuinelyUnregisteredAddressXYZ")
            page.click("#watchlistAddBtn")
            page.wait_for_timeout(700)

            list_html = page.inner_html("#watchlist-list")
            check("both items appear in the list", "WatchlistEnrichRegisteredMint" in list_html and "GenuinelyUnregisteredAddressXYZ" in list_html, list_html[:300])

            registered_status = page.eval_on_selector('[data-idx="0"] [data-reg-status]', "el => el.textContent")
            unregistered_status = page.eval_on_selector('[data-idx="1"] [data-reg-status]', "el => el.textContent")

            check("the REAL registered token shows the real 'Registered on Signal' status", "Registered on Signal" in registered_status, registered_status)
            check("the genuinely unregistered address shows the honest not-registered status", "Not a registered" in unregistered_status, unregistered_status)
            check("the two statuses are NOT identical — real, distinct results, not a fabricated shared default", registered_status != unregistered_status, f"{registered_status} vs {unregistered_status}")
            check("the registered status does not fabricate holder count, price, or volume", "holder" not in registered_status.lower() and "price" not in registered_status.lower() and "volume" not in registered_status.lower())

            page.click('[data-idx="1"] [data-remove]')
            page.wait_for_timeout(200)
            list_html_after_remove = page.inner_html("#watchlist-list")
            check("existing remove behavior still works — the removed item is gone", "GenuinelyUnregisteredAddressXYZ" not in list_html_after_remove)
            check("the remaining item is unaffected by the removal", "WatchlistEnrichRegisteredMint" in list_html_after_remove)

            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(500)
            # Same filter convention as every other test in this project
            # (e.g. chat-e2e.test.py): esm.sh CDN imports fail in this
            # sandbox because there is no internet access at all — a
            # known, pre-existing, documented environmental limitation,
            # unrelated to this change, not something to newly tolerate
            # here without precedent.
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
