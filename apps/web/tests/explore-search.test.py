#!/usr/bin/env python3
"""
Real, end-to-end browser test: registers real tokens via the actual
API (a real subprocess), then confirms searching in the browser
actually filters to the matching one. Also verifies the small
TokenDetailPage.tsx fix (real "Launched on Signal" check) while a real
server and real registered tokens are already set up, since it's
directly related and cheap to check here.

Run with: python3 apps/web/tests/explore-search.test.py
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
STATIC_PORT = 8947
API_PORT = 4503

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


def register(api_port, address, name, symbol):
    payload = json.dumps({
        "chain": "solana", "address": address, "name": name,
        "symbol": symbol, "decimals": 6, "creatorWalletAddress": "SearchTestCreator",
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

    status_a = register(API_PORT, "SearchableUniqueMintAAA", "Very Unique Falcon", "FLCN")
    status_b = register(API_PORT, "SearchableUniqueMintBBB", "Totally Different Whale", "WHL")
    check("setup: two real tokens registered", status_a == 201 and status_b == 201, f"{status_a}, {status_b}")

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

            list_html_before = page.inner_html("#explore-new-list")
            check("before searching, both tokens appear in the New tab", "Very Unique Falcon" in list_html_before and "Totally Different Whale" in list_html_before)

            page.fill("#exploreSearchInput", "Falcon")
            page.wait_for_timeout(500)
            list_html_after = page.inner_html("#explore-new-list")
            check("searching 'Falcon' shows the matching token", "Very Unique Falcon" in list_html_after, list_html_after[:200])
            check("searching 'Falcon' does NOT show the non-matching token", "Totally Different Whale" not in list_html_after, list_html_after[:200])

            page.fill("#exploreSearchInput", "DefinitelyNotAnyRealToken999")
            page.wait_for_timeout(500)
            empty_visible = page.evaluate("document.getElementById('explore-new-empty').hidden") is False
            empty_text = page.inner_text("#explore-new-empty")
            check("a non-matching search shows the empty state", empty_visible)
            check("the empty state says 'No matches', distinct from the generic 'no launches yet' message", "No matches" in empty_text, empty_text)

            page.fill("#exploreSearchInput", "")
            page.wait_for_timeout(500)
            list_html_cleared = page.inner_html("#explore-new-list")
            check("clearing the search reverts to showing both real tokens again", "Very Unique Falcon" in list_html_cleared and "Totally Different Whale" in list_html_cleared)

            # Uses the real, normally-loaded /token/example/ page directly
            # (no synthetic routing) — this static test server has no
            # wildcard /token/* routing the way a real deployment would,
            # so rather than fake the URL, this tests against the one
            # real page that genuinely exists, in both real states: first
            # BEFORE "example" is registered anywhere (a real 404 from the
            # real API), then AFTER registering a real token at that exact
            # literal address (a real 201, then a real 200 lookup).
            page.goto(f"http://localhost:{STATIC_PORT}/token/example/", wait_until="networkidle")
            page.wait_for_timeout(500)
            badge_text_before = page.inner_text("#signal-launch-badge")
            check("before 'example' is registered anywhere, the real lookup honestly shows 'No'", "No" in badge_text_before, badge_text_before)

            status_example = register(API_PORT, "example", "Example Token", "EX")
            check("setup: a real token registered at the literal address 'example'", status_example == 201, str(status_example))

            page.reload(wait_until="networkidle")
            page.wait_for_timeout(500)
            badge_text_after = page.inner_text("#signal-launch-badge")
            check("after registering it for real, the SAME page now honestly shows 'Yes'", "Yes" in badge_text_after, badge_text_after)

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
