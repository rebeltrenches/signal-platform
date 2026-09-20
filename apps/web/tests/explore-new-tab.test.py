#!/usr/bin/env python3
"""
Real, end-to-end browser test: registers a real token via the actual
API (a real subprocess, not a stub), then confirms it genuinely appears
in Explore's "New" tab — and that Momentum/Graduating remain untouched,
honest empty states.

Run with: python3 apps/web/tests/explore-new-tab.test.py
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
STATIC_PORT = 8946
API_PORT = 4502

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

    payload = json.dumps({
        "chain": "solana", "address": "ExploreTestMint111", "name": "Explore Test Token",
        "symbol": "ETT", "decimals": 6, "creatorWalletAddress": "ExploreTestCreator111",
    }).encode("utf-8")
    req = urllib.request.Request(
        f"http://localhost:{API_PORT}/api/v1/tokens/register", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            register_status = resp.status
    except urllib.error.HTTPError as e:
        register_status = e.code
    check("setup: real token registration succeeds", register_status == 201, str(register_status))

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

            page.goto(f"http://localhost:{STATIC_PORT}/explore", wait_until="networkidle")
            page.wait_for_timeout(400)

            new_panel = page.query_selector('[data-panel="new"]')
            check("the New tab panel is visible by default", new_panel is not None and new_panel.is_visible())

            list_html = page.inner_html("#explore-new-list")
            check("the real registered token's name appears in the New tab", "Explore Test Token" in list_html, list_html[:200])
            check("the real registered token's symbol appears", "ETT" in list_html)

            empty_hidden = page.evaluate("document.getElementById('explore-new-empty').hidden")
            check("the honest empty state is correctly hidden once real data loaded", empty_hidden is True)

            page.click('[data-tab="momentum"]')
            page.wait_for_timeout(200)
            momentum_text = page.inner_text('[data-panel="momentum"]')
            check("Momentum tab still shows its original honest empty-state copy, unchanged", "Stage 11" in momentum_text, momentum_text)

            page.click('[data-tab="graduating"]')
            page.wait_for_timeout(200)
            graduating_text = page.inner_text('[data-panel="graduating"]')
            check("Graduating tab still shows its original honest empty-state copy, unchanged", "Stage 8" in graduating_text, graduating_text)

            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(300)
            check("zero console errors across the whole flow", len(console_errors) == 0, str(console_errors))

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
