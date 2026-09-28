#!/usr/bin/env python3
"""
Token workspace market data (apps/web/src/client/token-detail.js):
price, market cap, liquidity, holders, bonding-curve progress, source and
logo from /api/solana/token-market, answered locally with the endpoint's
real response shapes (no network).

  - real values are shown, with their source;
  - anything the endpoint couldn't read stays "Unavailable" with the reason;
  - a failed or rate-limited lookup leaves every stat "Unavailable";
  - the logo follows logo-image.js rules (https only, <img> via DOM,
    placeholder otherwise), and hostile names/reasons are only text;
  - the page asks once per view (no polling).

Run with: python3 apps/web/tests/token-market-page.test.py
Requires: a built apps/web/dist and Python's `playwright` package.
"""
import http.server
import json
import os
import socketserver
import struct
import sys
import threading
import time
import zlib

from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.dirname(os.path.abspath(__file__)) + "/../../.."
DIST_DIR = os.path.join(REPO_ROOT, "apps/web/dist")
PORT = 8099
MINT = "HTPcjEKdLMRoAjPrPv7aj5thXndWJXLSYTis5PGfpump"
LOGO = "https://ipfs.io/ipfs/LOGO"

passed = 0
failed = 0


def check(name, condition):
    global passed, failed
    print(f"  {'ok  ' if condition else 'FAIL'} - {name}")
    if condition:
        passed += 1
    else:
        failed += 1


def png_1x1():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\x7c\x5c\xff\xff")) + chunk(b"IEND", b""))


# The endpoint's response for an active pump.fun curve (values as the live
# coin had them, holders from a full DAS page).
CURVE_RESPONSE = {
    "mint": MINT, "source": "pump.fun bonding curve", "name": "magic 🪄", "symbol": "piip",
    "logo": {"url": LOGO, "source": "on-chain metadata"}, "decimals": 6,
    "supply": {"value": 2_000_000_000, "unit": "tokens"},
    "price": {"sol": {"value": 3.178267488420085e-8, "unit": "SOL"}, "usd": {"value": 0.000003784605029325744, "unit": "USD"}},
    "marketCap": {"sol": {"value": 63.565349768401695, "unit": "SOL"}, "usd": {"value": 7569.210058651487, "unit": "USD"}},
    "liquidity": {"sol": {"value": 1.25, "unit": "SOL"}, "usd": {"value": 148.75, "unit": "USD"}},
    "curveProgress": {"value": 0.08425756743159753, "unit": "%"},
    "holders": {"count": 1000, "capped": True, "source": "Helius"},
}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def open_page(browser, market_status=200, market_body=None, path=None):
    page = browser.new_page()
    state = {"market_requests": 0}
    page.route(lambda url: not url.startswith(f"http://localhost:{PORT}/"), lambda r: r.abort())

    def market(route):
        state["market_requests"] += 1
        route.fulfill(status=market_status, content_type="application/json", body=json.dumps(market_body if market_body is not None else CURVE_RESPONSE))
    page.route("**/api/solana/token-market?**", market)
    page.route("**/api/solana/swap/quote", lambda r: r.fulfill(status=200, content_type="application/json", body='{"quoteEnabled": false}'))
    page.route("**/api/v1/**", lambda r: r.fulfill(status=404, body="{}"))
    page.route("https://ipfs.io/ipfs/LOGO", lambda r: r.fulfill(status=200, content_type="image/png", body=png_1x1()))
    page.goto(f"http://localhost:{PORT}{path or f'/token/example/?mint={MINT}&chain=solana'}", wait_until="domcontentloaded")
    page.state = state
    return page


def stat_text(page, name):
    return page.evaluate(f"(() => {{ const s = document.querySelector('[data-stat=\"{name}\"]'); return s ? s.innerText : null; }})()")


def main():
    if not os.path.isdir(DIST_DIR):
        print(f"ERROR: {DIST_DIR} does not exist — run the build first.")
        sys.exit(1)
    handler = lambda *a, **kw: QuietHandler(*a, directory=DIST_DIR, **kw)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)
    print("token-market-page.test.py\n")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # --- an active bonding curve --------------------------------------
        page = open_page(browser)
        page.wait_for_function("() => !document.querySelector('[data-stat=\"price\"] .data-unavailable')", timeout=10000)
        page.wait_for_function("() => { const img = document.querySelector('img#token-logo-slot'); return img && img.complete && img.naturalWidth > 0; }", timeout=10000)
        price, cap, liquidity, holders, progress = (stat_text(page, n) for n in ("price", "marketCap", "liquidity", "holders", "curveProgress"))
        progress_visible = page.is_visible('[data-stat="curveProgress"]')
        source = page.text_content('#token-market-source') or ""
        name = page.text_content('#token-name') or ""
        logo = page.evaluate("""(() => { const img = document.querySelector('img#token-logo-slot');
          return { src: img.getAttribute('src'), w: img.getAttribute('width'), h: img.getAttribute('height'),
                   lazy: img.getAttribute('loading'), ref: img.getAttribute('referrerpolicy') }; })()""")
        page.wait_for_timeout(3000)
        market_requests = page.state["market_requests"]
        page.close()
        check("price: USD with SOL beneath, small values without scientific notation", "$0.000003785" in price and "0.00000003178 SOL" in price and "e-" not in price)
        check("market cap: USD and SOL", "$7,569.21" in cap and "63.57 SOL" in cap)
        check("liquidity: SOL in the curve, with USD", "1.25 SOL" in liquidity and "$148.75" in liquidity)
        check("holders: an exact count shown as a lower bound when capped", holders.startswith("1,000+"))
        check("bonding-curve progress is shown for curve tokens", progress_visible and "0.08%" in progress)
        check("the source is labelled", source == "Market data source: pump.fun bonding curve · Holders: Helius")
        check("with no name in the URL, the on-chain name and symbol are used", name == "magic 🪄 (piip)")
        check("the logo is an https <img>: 48px, lazy, no referrer", logo == {"src": LOGO, "w": "48", "h": "48", "lazy": "lazy", "ref": "no-referrer"})
        check("the page asks for market data once (no polling)", market_requests == 1)

        # --- pump.fun Mayhem Mode: confirmed, uncertain, and a normal coin ----
        mayhem = json.loads(json.dumps(CURVE_RESPONSE))
        mayhem["marketCap"] = {"sol": {"value": 31.76, "unit": "SOL"}, "usd": {"value": 3782.2, "unit": "USD"}}
        mayhem["marketCapFullSupply"] = {"sol": {"value": 63.57, "unit": "SOL"}, "usd": {"value": 7569.21, "unit": "USD"}}
        mayhem["marketCapBasis"] = "Excludes 1,000,668,247 tokens held by pump.fun's Mayhem wallet (999,331,753 of 2,000,000,000)."
        mayhem["mayhem"] = {"detected": True, "wallet": "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s", "walletBalance": "1000668246767000"}
        page = open_page(browser, market_body=mayhem)
        page.wait_for_function("() => document.getElementById('token-market-source').textContent.length > 0", timeout=10000)
        cap = stat_text(page, "marketCap")
        badge = page.text_content('#token-mayhem-badge') if page.query_selector('#token-mayhem-badge') else None
        page.close()
        check("Mayhem: the headline market cap leaves out the Mayhem wallet, with the basis stated", cap.startswith("$3,782.2") and "Excludes 1,000,668,247 tokens held by pump.fun's Mayhem wallet" in cap)
        check("Mayhem: the full on-chain supply market cap is shown too", "Full on-chain supply: $7,569.21" in cap)
        check("Mayhem: a 'Mayhem Mode' badge is shown", badge == "Mayhem Mode")

        uncertain = json.loads(json.dumps(CURVE_RESPONSE))
        uncertain["marketCapBasis"] = "Full on-chain supply (2,000,000,000). The curve is marked Mayhem Mode, but the Mayhem wallet's holdings couldn't be read."
        uncertain["mayhem"] = {"uncertain": "The curve is marked Mayhem Mode, but the Mayhem wallet's holdings couldn't be read."}
        page = open_page(browser, market_body=uncertain)
        page.wait_for_function("() => document.getElementById('token-market-source').textContent.length > 0", timeout=10000)
        cap = stat_text(page, "marketCap")
        has_badge = page.query_selector('#token-mayhem-badge') is not None
        page.close()
        check("uncertain Mayhem: the full on-chain market cap with the note saying why", cap.startswith("$7,569.21") and "Full on-chain supply (2,000,000,000). The curve is marked Mayhem Mode" in cap)
        check("uncertain Mayhem: no badge and no second market cap line", not has_badge and "Full on-chain supply:" not in cap)

        normal = json.loads(json.dumps(CURVE_RESPONSE))
        normal["marketCap"] = {"sol": {"value": 28.4, "unit": "SOL"}, "usd": {"value": 3380.0, "unit": "USD"}}
        normal["marketCapBasis"] = "Full on-chain supply (1,000,000,000)."
        normal["mayhem"] = {"detected": False}
        page = open_page(browser, market_body=normal)
        page.wait_for_function("() => document.getElementById('token-market-source').textContent.length > 0", timeout=10000)
        cap = stat_text(page, "marketCap")
        has_badge = page.query_selector('#token-mayhem-badge') is not None
        page.close()
        check("normal coin: market cap on the full supply, no Mayhem badge", cap.startswith("$3,380") and "Full on-chain supply (1,000,000,000)." in cap and not has_badge)

        # --- values the endpoint couldn't read stay Unavailable, with the reason
        body = json.loads(json.dumps(CURVE_RESPONSE))
        body["price"]["usd"] = {"unavailable": "Live SOL/USD price unavailable (Jupiter)."}
        body["marketCap"]["usd"] = {"unavailable": "Live SOL/USD price unavailable (Jupiter)."}
        body["holders"] = {"unavailable": "Holder counting needs the Helius RPC (SOLANA_RPC_URL), which isn't configured."}
        body["logo"] = {"unavailable": "Metadata file HTTP 429."}
        page = open_page(browser, market_body=body)
        page.wait_for_function("() => document.getElementById('token-market-source').textContent.length > 0", timeout=10000)
        price, holders = stat_text(page, "price"), stat_text(page, "holders")
        placeholder = page.evaluate("(() => { const el = document.getElementById('token-logo-slot'); return { tag: el.tagName, cls: el.className, text: el.textContent, title: el.title }; })()")
        page.close()
        check("without a SOL/USD price, the price shows in SOL (real), not a guessed USD", price.startswith("0.00000003178 SOL"))
        check("holders that can't be counted stay Unavailable, with the reason", "Unavailable" in holders and "Helius RPC" in holders)
        check("no logo: a neutral placeholder with the reason as its title", placeholder["tag"] == "SPAN" and "token-logo-placeholder" in placeholder["cls"] and placeholder["text"] == "P" and "HTTP 429" in placeholder["title"])

        # --- a rate-limited lookup leaves everything Unavailable with the reason
        page = open_page(browser, market_status=429, market_body={"code": "RATE_LIMITED", "error": "Too many token lookups; try again in a minute."})
        page.wait_for_function("() => document.querySelector('[data-stat=\"price\"]').innerText.includes('Too many')", timeout=10000)
        texts = [stat_text(page, n) for n in ("price", "marketCap", "liquidity", "holders")]
        progress_hidden = not page.is_visible('[data-stat="curveProgress"]')
        page.close()
        check("a rate-limited lookup: every stat Unavailable, with the reason", all("Unavailable" in t and "Too many token lookups" in t for t in texts))
        check("and no curve progress is shown", progress_hidden)

        # --- hostile text and logo URLs from the endpoint are only text ------
        hostile = json.loads(json.dumps(CURVE_RESPONSE))
        hostile["name"] = '<img src=x onerror="window.xss=1">'
        hostile["symbol"] = "<b class=injected>S</b>"
        hostile["logo"] = {"url": "javascript:window.xss=2"}
        hostile["holders"] = {"unavailable": '<img src=x onerror="window.xss=3">'}
        page = open_page(browser, market_body=hostile)
        page.wait_for_function("() => document.getElementById('token-market-source').textContent.length > 0", timeout=10000)
        page.wait_for_timeout(300)
        name = page.text_content('#token-name') or ""
        holders = stat_text(page, "holders")
        ran = page.evaluate("window.xss !== undefined || !!document.querySelector('img[src=\"x\"], .injected')")
        logo_tag = page.evaluate("document.getElementById('token-logo-slot').tagName")
        page.close()
        check("a hostile on-chain name/symbol is shown literally", name == '<img src=x onerror="window.xss=1"> (<b class=injected>S</b>)')
        check("a hostile reason is shown literally", '<img src=x onerror="window.xss=3">' in holders)
        check("a javascript: logo is never used (placeholder)", logo_tag == "SPAN")
        check("nothing hostile ran or created elements", not ran)

        # --- invalid addresses never ask the endpoint ------------------------
        page = open_page(browser, path="/token/example/?mint=not-a-mint&chain=solana")
        page.wait_for_timeout(1500)
        requests = page.state["market_requests"]
        page.close()
        check("an invalid mint in the URL never calls the endpoint", requests == 0)

        browser.close()
    httpd.shutdown()
    print(f"\n{passed} passed, {failed} failed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
