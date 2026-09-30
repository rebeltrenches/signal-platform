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
NOT_A_MINT = "11111111111111111111111111111111"  # the System Program: base58, but not a token
SOL_MINT = "So11111111111111111111111111111111111111112"
# Jupiter prefills Sell/Buy from these query parameters (checked in a real browser).
JUPITER_URL = f"https://jup.ag/swap?sell={MINT}&buy={SOL_MINT}"


def stub_market(page, status):
    """The page's token-market lookup (200: a mint; 404: not one). Returns
    the list of lookups made, which should stay at one per page."""
    body = '{"code":"MINT_NOT_FOUND","error":"No token mint exists at this address."}' if status == 404 else '{"mint":"x"}'
    calls = []

    def handle(route):
        calls.append(route.request.url)
        route.fulfill(status=status, content_type="application/json", body=body)
    page.route("**/api/solana/token-market*", handle)
    return calls

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
            market_calls = stub_market(page, 200)
            page.goto(f"http://localhost:{PORT}/token/example/?mint={MINT}&chain=solana", wait_until="domcontentloaded")
            link = page.locator("#trade-sell-link")
            link.wait_for(state="visible")
            page.wait_for_timeout(300)
            check("the Sell link reuses the page's market lookup (one request, not two)", len(market_calls) == 1, str(len(market_calls)))
            check("the Sell link is shown for a Solana token", link.is_visible())
            check("it is labelled 'Sell on Jupiter ↗'", link.inner_text().strip() == "Sell on Jupiter ↗", link.inner_text())
            check("it opens Jupiter with this token as the Sell side and SOL as the Buy side", link.get_attribute("href") == JUPITER_URL, link.get_attribute("href"))
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
            check("clicking opens Jupiter in a new tab at this token", popup.url == JUPITER_URL, popup.url)
            page.wait_for_timeout(300)
            check("clicking Sell makes Signal build no transaction (no swap request)", not swap_requests, str(swap_requests))
            page.close()

            # Wallets, programs and token accounts look like mints but aren't.
            page = browser.new_page()
            stub_market(page, 404)
            page.goto(f"http://localhost:{PORT}/token/example/?mint={NOT_A_MINT}&chain=solana", wait_until="domcontentloaded")
            page.wait_for_timeout(400)
            check("no Sell link when the address isn't a token mint (MINT_NOT_FOUND)", not page.locator("#trade-sell-link").is_visible() and not page.locator("#trade-sell-note").is_visible())
            page.close()

            # The lookup failing (rate limit, outage) doesn't hide the only way to sell.
            page = browser.new_page()
            stub_market(page, 502)
            page.goto(f"http://localhost:{PORT}/token/example/?mint={MINT}&chain=solana", wait_until="domcontentloaded")
            page.locator("#trade-sell-link").wait_for(state="visible", timeout=5000)
            check("if the token lookup is unavailable, the Sell link is still shown", page.locator("#trade-sell-link").get_attribute("href") == JUPITER_URL)
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
            stub_market(page, 200)
            page.goto(f"http://localhost:{PORT}/token/example/?mint={MINT}&chain=solana", wait_until="domcontentloaded")
            page.locator("#trade-sell-link").wait_for(state="visible")
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
