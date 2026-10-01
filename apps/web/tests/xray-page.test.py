"""Signal X-Ray on the site: the front page's "X-Ray any token" box and the
token page's Signal Check tab (apps/web/src/client/xray.js), against a
stubbed /api/xray answer in the server's real shape.

Run after building: python apps/web/tests/xray-page.test.py
"""
import http.server
import json
import os
import re
import socketserver
import sys
import threading
import time

from playwright.sync_api import sync_playwright
from browser_stubs import stub_pages

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DIST_DIR = os.path.join(REPO_ROOT, "apps/web/dist")
PORT = 8217
MINT = "3mwznTzZ5LJic9nvBCMLkXgw7scA6HnX1GNuQwmUf4Ar"
FREEZE_AUTHORITY = "2apBGMsS6ti9RyF5TwQTDswXBWskiJP2LD4cUEDqYJjk"
HOLDER = "HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg"
BANNED = re.compile(r"\bsafe\b|not a honeypot|honeypot-free|rug-?free|\bscore\b", re.I)

results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"  {'ok  ' if ok else 'FAIL'} - {name}{f' ({detail})' if detail and not ok else ''}")


def item(id, label, value, status, why, **extra):
    return {"id": id, "label": label, "value": value, "status": status, "why": why, **extra}


XRAY = {
    "mint": MINT, "name": "Signal Test", "symbol": "SIGTEST", "program": "SPL Token",
    "generatedAt": "2026-09-30T12:00:00.000Z", "cacheSeconds": 300,
    "sections": [
        {"id": "facts", "title": "Hard facts", "items": [
            item("signal-registered", "Registered on Signal", "Yes (mint authority revoked)", "ok", "Signal only lists tokens whose mint authority is revoked, so the supply can't grow."),
            item("mint-authority", "Mint authority", "Revoked", "ok", "No one can ever mint more of this token."),
            item("freeze-authority", "Freeze authority", "Active (2apB…YJjk)", "warn", "Whoever holds this key can freeze any holder's tokens so they can't be sold or moved.", addresses=[FREEZE_AUTHORITY]),
            item("metadata", "Metadata", "<img src=x onerror=window.__xss=1>", "info", "Shown as text, never as HTML."),
        ]},
        {"id": "holders", "title": "Holders and liquidity", "items": [
            item("top10", "Top 10 holders", "18% of supply (not counting PumpSwap pool)", "ok", "A few wallets holding a large share can move the price sharply when they sell."),
            item("lp", "LP tokens", "Unavailable", "unavailable", "LP tokens are the claim on the pool's liquidity.", reason="The pool account couldn't be read."),
        ]},
        {"id": "honeypot", "title": "Honeypot checks", "items": [
            item("sell-simulation", "Sell simulation", "Succeeded right now for a holder (HKpj…6ryg) selling 800,000 tokens", "ok", "A small sell from a real holder was simulated just now (nothing was sent). Conditions can change at any time.", addresses=[HOLDER]),
            item("recent-sells", "Recent sells", "2 successful sells by 2 non-creator wallets in the last 4 pool transactions", "ok", "Recent successful sells by other wallets show that selling has worked lately."),
        ]},
    ],
    "holders": [
        {"owner": "Pool1111111111111111111111111111111111111111", "percent": 50, "label": "PumpSwap pool", "excluded": True},
        {"owner": "HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg", "percent": 8.5, "label": None, "excluded": False},
        {"owner": None, "percent": 3, "label": None, "excluded": False},
        {"owner": "Incomp1ete111111111111111111111111111111111", "percent": None, "label": None, "excluded": False},
    ],
    "usage": {"rpcCalls": 12}, "note": "Facts, not a verdict. Conditions can change at any time.",
}


def serve():
    os.chdir(DIST_DIR)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)
    return httpd


def stub_xray(page, status=200, body=None):
    requests = []

    def handle(route):
        requests.append(route.request.url)
        route.fulfill(status=status, content_type="application/json", body=json.dumps(XRAY if body is None else body))
    page.route("**/api/xray?*", handle)
    return requests


def xray_text(page, selector):
    return page.eval_on_selector(selector, "el => el.innerText")


def run():
    if not os.path.isdir(DIST_DIR):
        print("ERROR: build apps/web first")
        return False
    httpd = serve()
    try:
        with sync_playwright() as p:
            browser = stub_pages(p.chromium.launch(), DIST_DIR)

            # ---- front page ----
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            requests = stub_xray(page)
            page.goto(f"http://localhost:{PORT}/", wait_until="domcontentloaded")
            check("the front page has the 'X-Ray any token' box", page.is_visible("#xray-form") and "X-Ray any token" in page.inner_text("#xray-heading"))
            page.fill("#xray-mint", "not a mint")
            page.click("#xray-form button[type=submit]")
            check("an invalid address is refused without a request", "Enter a Solana token mint address" in page.inner_text("#xray-results") and not requests)
            page.fill("#xray-mint", MINT)
            page.click("#xray-form button[type=submit]")
            page.wait_for_selector("#xray-results .xray-item")
            text = xray_text(page, "#xray-results")
            check("it asks the server for that mint", requests and requests[0].endswith(f"/api/xray?mint={MINT}"), str(requests))
            check("sections are shown with their titles", all(t in text.lower() for t in ["hard facts", "holders and liquidity", "honeypot checks"]))
            check("each fact shows a ✅ or ⚠️ marker", page.eval_on_selector('[data-check="mint-authority"] .xray-marker', "e => e.textContent") == "✅" and page.eval_on_selector('[data-check="freeze-authority"] .xray-marker', "e => e.textContent") == "⚠️")
            check("each fact has its one-line why", page.eval_on_selector_all(".xray-item .xray-why", "els => els.length") == 8)
            check("the Signal registry line is shown", "Registered on Signal: Yes (mint authority revoked)" in text)
            check("unavailable data says Unavailable, with the reason", "LP tokens: Unavailable" in text and "The pool account couldn't be read." in text)
            check("the sell check reads 'Succeeded right now', not a verdict", "Sell simulation: Succeeded right now" in text)
            check("no overall verdict words anywhere in the X-Ray", not BANNED.search(text), BANNED.search(text).group(0) if BANNED.search(text) else "")
            check("values are shown as text, never as HTML", "<img src=x" in text and page.evaluate("window.__xss") is None and page.query_selector("#xray-results img") is None)
            page.click(".xray-holders summary")
            rows = page.eval_on_selector_all(".xray-holder", "els => els.map(e => ({percent: e.querySelector('.xray-holder-percent')?.textContent, address: e.querySelector('.xray-address, .xray-holder-address')?.textContent, text: e.innerText}))")
            check("every largest-holder row shows a percentage and a short address", len(rows) == 2 and all(r["percent"] and r["address"] for r in rows), str(rows))
            check("percentages in the holder list have two decimals", [r["percent"] for r in rows] == ["50.00%", "8.50%"], str(rows))
            check("the pool row is labelled as not counted", "PumpSwap pool · not counted" in rows[0]["text"], rows[0]["text"])
            check("rows with a missing address or percentage are left out", "Incomp" not in xray_text(page, ".xray-holders"))
            home_text = text
            page.close()

            # ---- addresses: tap to copy the full address; Solscan links ----
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=f"http://localhost:{PORT}")
            stub_xray(page)
            page.goto(f"http://localhost:{PORT}/", wait_until="domcontentloaded")
            page.fill("#xray-mint", MINT)
            page.click("#xray-form button[type=submit]")
            page.wait_for_selector("#xray-results .xray-item")
            freeze = page.locator('[data-check="freeze-authority"] .xray-address')
            check("a shortened address in a line is a copy button showing the short form", freeze.inner_text() == "2apB…YJjk")
            check("hovering shows the full address", freeze.get_attribute("title") == FREEZE_AUTHORITY)
            freeze.click()
            page.wait_for_function("document.querySelector('[data-check=freeze-authority] .xray-address').textContent === 'Copied'", timeout=3000)
            check("tapping copies the FULL address", page.evaluate("navigator.clipboard.readText()") == FREEZE_AUTHORITY)
            page.wait_for_function("document.querySelector('[data-check=freeze-authority] .xray-address').textContent === '2apB…YJjk'", timeout=4000)
            check("the 'Copied' confirmation is brief, then the short address returns", True)
            solscan = page.locator('[data-check="freeze-authority"] .xray-solscan')
            check("each shortened address has a Solscan link to its account", solscan.get_attribute("href") == f"https://solscan.io/account/{FREEZE_AUTHORITY}")
            check("Solscan opens in a new tab (noopener noreferrer)", solscan.get_attribute("target") == "_blank" and "noopener" in (solscan.get_attribute("rel") or "") and "noreferrer" in (solscan.get_attribute("rel") or ""))
            check("the simulated holder in the sell line is copyable too", page.locator('[data-check="sell-simulation"] .xray-address').get_attribute("data-address") == HOLDER)
            check("the surrounding text stays intact", "Succeeded right now for a holder (HKpj…6ryg) selling 800,000 tokens" in page.inner_text('[data-check="sell-simulation"] .xray-value').replace(" Solscan ↗", ""))
            page.click(".xray-holders summary")
            holder_row = page.locator(".xray-holder", has_text="8.50%")
            check("largest-holder rows copy the full address and link to Solscan", holder_row.locator(".xray-address").get_attribute("data-address") == HOLDER and holder_row.locator(".xray-solscan").get_attribute("href") == f"https://solscan.io/account/{HOLDER}")
            holder_row.locator(".xray-address").click()
            page.wait_for_timeout(200)
            check("tapping a holder copies its full address", page.evaluate("navigator.clipboard.readText()") == HOLDER)
            page.close()

            page = browser.new_page(viewport={"width": 375, "height": 812})
            stub_xray(page)
            page.goto(f"http://localhost:{PORT}/", wait_until="domcontentloaded")
            page.fill("#xray-mint", MINT)
            page.click("#xray-form button[type=submit]")
            page.wait_for_selector("#xray-results .xray-item")
            page.click(".xray-holders summary")
            overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            right = page.evaluate("Math.max(...[...document.querySelectorAll('#xray-results .xray-address, #xray-results .xray-solscan')].map(e => e.getBoundingClientRect().right))")
            check("on a phone the copy buttons and Solscan links fit the screen", overflow <= 0 and right <= 375, f"overflow {overflow}, rightmost {right}")
            height = page.locator('[data-check="freeze-authority"] .xray-address').bounding_box()["height"]
            check("copy buttons are big enough to tap", height >= 22, str(height))
            page.close()

            # ---- no holder data: no empty list ----
            page = browser.new_page()
            stub_xray(page, 200, {**XRAY, "holders": [{"owner": None, "percent": None, "label": None, "excluded": False}]})
            page.goto(f"http://localhost:{PORT}/", wait_until="domcontentloaded")
            page.fill("#xray-mint", MINT)
            page.click("#xray-form button[type=submit]")
            page.wait_for_selector("#xray-results .xray-item")
            check("without usable holder data, the Largest holders list isn't shown", page.query_selector("#xray-results .xray-holders") is None)
            page.close()

            # ---- error states ----
            for status, expected in ((404, "isn't a Solana token mint"), (429, "try again in a minute"), (502, "unavailable right now")):
                page = browser.new_page()
                stub_xray(page, status, {"code": "X"})
                page.goto(f"http://localhost:{PORT}/", wait_until="domcontentloaded")
                page.fill("#xray-mint", MINT)
                page.click("#xray-form button[type=submit]")
                page.wait_for_selector(".xray-status-error")
                check(f"HTTP {status} shows a plain message", expected in page.inner_text("#xray-results"), page.inner_text("#xray-results"))
                page.close()

            # ---- token page: the Signal Check tab ----
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            requests = stub_xray(page)
            page.goto(f"http://localhost:{PORT}/token/example/?mint={MINT}&chain=solana", wait_until="domcontentloaded")
            page.wait_for_timeout(500)
            check("nothing is fetched until the Signal Check tab is opened", not requests)
            page.click('[data-tab="Signal Check"]')
            page.wait_for_selector("#xray-token-results .xray-item")
            token_text = xray_text(page, "#xray-token-results")
            check("the tab X-Rays this page's mint", requests and requests[0].endswith(f"/api/xray?mint={MINT}"))
            check("the tab shows exactly the same results as the front page", token_text == home_text)
            page.click('[data-tab="Overview"]')
            page.click('[data-tab="Signal Check"]')
            check("reopening the tab doesn't fetch again", len(requests) == 1)
            page.close()

            page = browser.new_page()
            requests = stub_xray(page)
            page.goto(f"http://localhost:{PORT}/token/example/", wait_until="domcontentloaded")
            page.click('[data-tab="Signal Check"]')
            page.wait_for_timeout(300)
            check("the example page without a mint asks for a token instead of fetching", not requests and "Open this tab from a Solana token" in page.inner_text("#xray-token-results"))
            page.close()

            # ---- mobile ----
            page = browser.new_page(viewport={"width": 375, "height": 812})
            stub_xray(page)
            page.goto(f"http://localhost:{PORT}/", wait_until="domcontentloaded")
            page.fill("#xray-mint", MINT)
            page.click("#xray-form button[type=submit]")
            page.wait_for_selector("#xray-results .xray-item")
            overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            check("on a phone the X-Ray fits the screen (no sideways scroll)", overflow <= 0, f"{overflow}px too wide")
            box = page.eval_on_selector("#xray-results", "e => e.getBoundingClientRect().right")
            check("the results stay inside the viewport", box <= 375, str(box))
            page.close()
            browser.close()
    finally:
        httpd.shutdown()
    return all(results)


if __name__ == "__main__":
    ok = run()
    print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed.")
    sys.exit(0 if ok else 1)
