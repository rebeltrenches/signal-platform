#!/usr/bin/env python3
"""
Explore page token logos (apps/web/src/client/explore.js, token-logo.js):

  - external tokens show the logo DEX Screener provides (info.imageUrl);
  - Signal launches show the logo from their on-chain metadata (metadata
    account via the RPC proxy -> metadata JSON on Arweave -> `image`);
  - logos are only ever <img> elements set through DOM properties, only
    for https URLs, with fixed size, lazy loading and no referrer;
  - a missing, non-https or broken logo shows a neutral placeholder;
  - malicious names and logo URLs never run or render as HTML.

Every network source is answered locally (no real network): the Signal
API, the RPC proxy, Arweave, DEX Screener, image hosts and the PumpPortal
websocket. The real bundled @solana/web3.js derives the metadata address.

Run with: python3 apps/web/tests/explore-logos.test.py
Requires: a Mainnet (default) build of apps/web/dist and Python's
`playwright` package with Chromium installed.
"""
import base64
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
PORT = 8098
METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"

# Two Signal launches and their Metaplex metadata accounts (PDA
# ["metadata", program, mint], derived with @solana/web3.js).
SIGNAL_GOOD = "8NPCV3YrcQbxYXE8jTBA37LsuZL6muMPjdVdspuPyVsZ"
SIGNAL_GOOD_PDA = "EADC4YJoWXoauAe66KFNTMBRsyVLMD5cETfUCutyGFY2"
SIGNAL_BAD = "3mwznTzZ5LJic9nvBCMLkXgw7scA6HnX1GNuQwmUf4Ar"
SIGNAL_BAD_PDA = "Drod8Htcndf7kMvHaSqi2qbLiqFJ7JWHSoRFXiCo6ErP"

GOOD_IMAGE = "https://arweave.net/IMG_SIGNAL_GOOD"
DEX_IMAGE = "https://cdn.dexscreener.test/good.png"
BROKEN_IMAGE = "https://cdn.dexscreener.test/missing.png"
BREAKOUT_IMAGE = 'https://cdn.dexscreener.test/x.png" onerror="window.xss=3'

passed = 0
failed = 0


def check(name, condition):
    global passed, failed
    if condition:
        print(f"  ok  - {name}")
        passed += 1
    else:
        print(f"  FAIL - {name}")
        failed += 1


def png_1x1():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\x7c\x5c\xff\xff")) + chunk(b"IEND", b""))


def metadata_account(uri):
    """A Metaplex metadata account (key 4) in the real layout."""
    def padded(value, size):
        raw = value.encode()
        return struct.pack("<I", size) + raw + bytes(size - len(raw))
    return (bytes([4]) + bytes(32) + bytes(32) + padded("Token", 32) + padded("TKN", 10)
            + padded(uri, 200) + bytes([0, 0, 0, 0, 0]))


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    if not os.path.isdir(DIST_DIR):
        print(f"ERROR: {DIST_DIR} does not exist — run the build first.")
        sys.exit(1)
    handler = lambda *a, **kw: QuietHandler(*a, directory=DIST_DIR, **kw)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)
    print("explore-logos.test.py\n")

    png = png_1x1()
    image_requests = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Nothing leaves the machine: anything not answered below is refused.
        page.route(lambda url: not url.startswith(f"http://localhost:{PORT}/client/")
                   and not url.startswith(f"http://localhost:{PORT}/styles/")
                   and not url.startswith(f"http://localhost:{PORT}/assets/")
                   and url.rstrip("/") != f"http://localhost:{PORT}/explore",
                   lambda r: r.abort())

        page.route("**/api/v1/tokens?limit=50", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"tokens": [
            {"name": '<img src=x onerror="window.xss=1">', "symbol": "SIGGOOD", "address": SIGNAL_GOOD, "chain": "solana", "createdAt": "2026-09-28T01:00:00Z"},
            {"name": "Signal Bad Image", "symbol": "SIGBAD", "address": SIGNAL_BAD, "chain": "solana", "createdAt": "2026-09-28T00:00:00Z"},
        ]})))

        def rpc(route):
            body = json.loads(route.request.post_data)
            address = body["params"][0]
            uri = {SIGNAL_GOOD_PDA: "https://arweave.net/META_GOOD", SIGNAL_BAD_PDA: "https://arweave.net/META_BAD"}.get(address)
            value = None if uri is None else {"owner": METADATA_PROGRAM, "data": [base64.b64encode(metadata_account(uri)).decode(), "base64"]}
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": {"value": value}}))
        page.route("**/api/solana/rpc", rpc)

        page.route("https://arweave.net/META_GOOD", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"name": "x", "image": GOOD_IMAGE})))
        page.route("https://arweave.net/META_BAD", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"name": "x", "image": "javascript:window.xss=5"})))

        def image(route):
            image_requests.append({"url": route.request.url, "referer": route.request.headers.get("referer")})
            if route.request.url in (GOOD_IMAGE, DEX_IMAGE):
                route.fulfill(status=200, content_type="image/png", body=png)
            else:
                route.fulfill(status=404, body="")
        page.route("https://arweave.net/IMG_*", image)
        page.route("https://cdn.dexscreener.test/**", image)

        profiles = [{"chainId": "solana", "tokenAddress": f"Ext{letter}1111111111111111111111111111111111"} for letter in "ABCD"]
        page.route("https://api.dexscreener.com/token-profiles/latest/v1", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(profiles)))

        def pair(letter, name, image_url):
            return {
                "chainId": "solana", "dexId": "raydium", "pairCreatedAt": 1_000 + ord(letter),
                "baseToken": {"address": f"Ext{letter}1111111111111111111111111111111111", "name": name, "symbol": f"EX{letter}"},
                "url": f"https://dexscreener.com/solana/ext{letter}", "info": {"imageUrl": image_url},
            }
        pairs = [
            pair("A", "<b class=injected>Good Logo Coin</b>", DEX_IMAGE),
            pair("B", "Javascript Logo Coin", "javascript:window.xss=2"),
            pair("C", "Broken Logo Coin", BROKEN_IMAGE),
            pair("D", "Breakout Logo Coin", BREAKOUT_IMAGE),
        ]
        page.route("https://api.dexscreener.com/tokens/v1/**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(pairs)))

        # PumpPortal: a new token with an HTML name and no image in the message.
        def pump(ws):
            ws.on_message(lambda message: ws.send(json.dumps({
                "txType": "create", "mint": "PumpMint111111111111111111111111111111111111",
                "name": '<img src=x onerror="window.xss=4">', "symbol": "PMP", "marketCapSol": 30,
            })))
        page.route_web_socket("wss://pumpportal.fun/**", pump)

        page.goto(f"http://localhost:{PORT}/explore/", wait_until="domcontentloaded")
        # Wait for all four DEX tokens, both Signal tokens and the pump token,
        # and for the Signal logo to resolve from its on-chain metadata.
        page.wait_for_function("() => document.querySelectorAll('#explore-new-list .review-row').length >= 7", timeout=15000)
        page.wait_for_function(f"() => !!document.querySelector('#explore-new-list img[src=\"{GOOD_IMAGE}\"]')", timeout=15000)
        page.wait_for_timeout(500)  # let broken images fail over to placeholders

        info = page.evaluate("""() => [...document.querySelectorAll('#explore-new-list .review-row')].map((row) => {
          const logo = row.querySelector('.token-logo');
          return {
            text: row.querySelector('strong').textContent,
            tag: logo && logo.tagName,
            placeholder: !!logo && logo.classList.contains('token-logo-placeholder'),
            src: logo && logo.tagName === 'IMG' ? logo.getAttribute('src') : null,
            width: logo && logo.getAttribute('width'), height: logo && logo.getAttribute('height'),
            loading: logo && logo.getAttribute('loading'), referrer: logo && logo.getAttribute('referrerpolicy'),
            loaded: logo && logo.tagName === 'IMG' ? logo.complete && logo.naturalWidth > 0 : false,
            onerrorAttr: logo && logo.hasAttribute('onerror'),
          };
        })""")
        by_name = {row["text"]: row for row in info}
        ran = page.evaluate("window.xss")
        injected = page.evaluate("document.querySelectorAll('#explore-new-list img[src=\"x\"], #explore-new-list .injected').length")
        all_img_https = page.evaluate("[...document.querySelectorAll('#explore-new-list img')].every((img) => img.src.startsWith('https://'))")
        page.close()
        browser.close()
    httpd.shutdown()

    good_dex = by_name.get("<b class=injected>Good Logo Coin</b> (EXA)", {})
    check("external token: DEX Screener's logo is shown as an <img>", good_dex.get("tag") == "IMG" and good_dex.get("src") == DEX_IMAGE and good_dex.get("loaded"))
    check("the logo has a fixed size, lazy loading and no referrer",
          good_dex.get("width") == "32" and good_dex.get("height") == "32" and good_dex.get("loading") == "lazy" and good_dex.get("referrer") == "no-referrer")
    check("logo requests carry no Referer", image_requests and all(not r["referer"] for r in image_requests))

    signal_good = by_name.get('<img src=x onerror="window.xss=1"> (SIGGOOD)', {})
    check("Signal launch: the logo comes from its on-chain metadata (metadata account -> JSON -> image)", signal_good.get("tag") == "IMG" and signal_good.get("src") == GOOD_IMAGE and signal_good.get("loaded"))
    check("Signal launch whose metadata image isn't https: placeholder", by_name.get("Signal Bad Image (SIGBAD)", {}).get("placeholder"))

    check("a javascript: logo URL is never used: placeholder", by_name.get("Javascript Logo Coin (EXB)", {}).get("placeholder"))
    check("a logo that fails to load falls back to the placeholder", by_name.get("Broken Logo Coin (EXC)", {}).get("placeholder"))
    breakout = by_name.get("Breakout Logo Coin (EXD)", {})
    check("a URL trying to break out of the src attribute can't add attributes (and falls back)", breakout.get("placeholder") and not breakout.get("onerrorAttr"))
    check("a pump.fun token without an image gets the placeholder", by_name.get('<img src=x onerror="window.xss=4"> (PMP)', {}).get("placeholder"))

    check("malicious token names are shown literally", '<img src=x onerror="window.xss=1"> (SIGGOOD)' in by_name and "<b class=injected>Good Logo Coin</b> (EXA)" in by_name)
    check("no name or logo URL ever ran script or created elements", ran is None and injected == 0)
    check("every logo image in the list is https", all_img_https)

    print(f"\n{passed} passed, {failed} failed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
