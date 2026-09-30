"""Token page "Sell on Jupiter ↗" link (apps/web/src/client/sell-link.js):
it opens this token on Jupiter (token → SOL) in a new tab, Signal builds
no sell transaction, and it fits a phone screen.

Run after building: python apps/web/tests/sell-link.test.py
"""
import http.server
import os
import socketserver
import sys
import threading
import time

from playwright.sync_api import sync_playwright
from browser_stubs import stub_pages

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DIST_DIR = os.path.join(REPO_ROOT, "apps/web/dist")
PORT = 8219
MINT = "98kfF7rmsg1QDUEoCqNE7g7M1FdrTt92TEp2CLzypump"
NOTE = "Sells happen on Jupiter, an external exchange. Signal doesn't charge a fee on sells."

results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"  {'ok  ' if ok else 'FAIL'} - {name}{f' ({detail})' if detail and not ok else ''}")


def run():
    if not os.path.isdir(DIST_DIR):
        print("ERROR: build apps/web first")
        return False
    os.chdir(DIST_DIR)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)
    try:
        with sync_playwright() as p:
            browser = stub_pages(p.chromium.launch(), DIST_DIR)

            page = browser.new_page(viewport={"width": 1280, "height": 900})
            swap_requests = []
            page.on("request", lambda r: swap_requests.append(r.url) if "/api/solana/swap" in r.url else None)
            page.context.route("https://jup.ag/**", lambda route: route.fulfill(status=200, content_type="text/html", body="<title>Jupiter</title>"))
            page.goto(f"http://localhost:{PORT}/token/example/?mint={MINT}&chain=solana", wait_until="domcontentloaded")
            link = page.locator("#trade-sell-link")
            check("the Sell link is shown for a Solana token", link.is_visible())
            check("it is labelled 'Sell on Jupiter ↗'", link.inner_text().strip() == "Sell on Jupiter ↗", link.inner_text())
            check("it opens this token on Jupiter with SOL as the output", link.get_attribute("href") == f"https://jup.ag/swap/{MINT}-SOL", link.get_attribute("href"))
            check("it opens in a new tab", link.get_attribute("target") == "_blank")
            rel = link.get_attribute("rel") or ""
            check("the new tab can't reach back into Signal (noopener noreferrer)", "noopener" in rel and "noreferrer" in rel, rel)
            check("the note explains sells happen on Jupiter with no Signal fee", page.inner_text("#trade-sell-note").strip() == NOTE)
            check("the old disabled Sell button is gone", page.locator("#trade-terminal button[disabled]", has_text="Sell").count() == 0)
            page.wait_for_timeout(300)
            swap_requests.clear()  # the Buy panel checks quote availability on load; only clicks count
            with page.context.expect_page() as popup_info:
                link.click()
            popup = popup_info.value
            popup.wait_for_load_state()
            check("clicking opens Jupiter in a new tab at this token", popup.url == f"https://jup.ag/swap/{MINT}-SOL", popup.url)
            page.wait_for_timeout(300)
            check("clicking Sell makes Signal build no transaction (no swap request)", not swap_requests, str(swap_requests))
            page.close()

            for name, url in (
                ("without a mint", f"http://localhost:{PORT}/token/example/"),
                ("for a non-Solana token", f"http://localhost:{PORT}/token/example/?mint={MINT}&chain=base"),
                ("for an invalid mint", f"http://localhost:{PORT}/token/example/?mint=not-a-mint&chain=solana"),
            ):
                page = browser.new_page()
                page.goto(url, wait_until="domcontentloaded")
                page.wait_for_timeout(200)
                check(f"no Sell link {name}", not page.locator("#trade-sell-link").is_visible() and not page.locator("#trade-sell-note").is_visible())
                page.close()

            page = browser.new_page(viewport={"width": 375, "height": 812})
            page.goto(f"http://localhost:{PORT}/token/example/?mint={MINT}&chain=solana", wait_until="domcontentloaded")
            box = page.locator("#trade-sell-link").bounding_box()
            check("on a phone the Sell link is visible and inside the screen", box is not None and box["x"] >= 0 and box["x"] + box["width"] <= 375, str(box))
            overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            check("on a phone the page doesn't scroll sideways", overflow <= 0, f"{overflow}px")
            page.close()
            browser.close()
    finally:
        httpd.shutdown()
    return all(results)


if __name__ == "__main__":
    ok = run()
    print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed.")
    sys.exit(0 if ok else 1)
