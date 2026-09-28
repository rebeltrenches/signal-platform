#!/usr/bin/env python3
"""
Regional restrictions, terms acceptance and sanctions screening across the
site (apps/web/src/client/compliance.js, wallet-connect.js, swap-execute.js,
the /terms page). /api/geo and /api/wallet-screen are answered locally
(the Worker side has its own tests: compliance-functions.test.mjs); the
launch flow is covered in supply-validation-and-recovery.test.py (G).

  - blocked regions: notice on every page, header connect disabled
  - the terms screen appears at wallet connect (never on page load), and
    again when the terms version changes or the visitor moves into a new
    Level 2 region; acceptance is stored per browser with the version
  - silent reconnects only happen when nothing needs to be shown
  - trading is refused for sanctioned wallets and when screening fails,
    before any trade is built
  - the terms page, marked draft, lists regions from the config
  - text from the location answer is only ever text

Run with: python3 apps/web/tests/compliance-page.test.py
Requires: a built apps/web/dist and Python's `playwright` package.
"""
import http.server
import json
import os
import socketserver
import sys
import threading
import time

from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.dirname(os.path.abspath(__file__)) + "/../../.."
DIST_DIR = os.path.join(REPO_ROOT, "apps/web/dist")
PORT = 8101
WALLET = "HKpjLnQ7TZpxDxD77LK4AkyorsDPNLTQWH95Cs9o6ryg"
MINT = "BM2k8mJUbMthHoioykyUm2NjMrXvLBYhoXruwYLpump"
EVM_WALLET = "0xabc1230000000000000000000000000000de0d00"
RESTRICTIONS = json.load(open(os.path.join(REPO_ROOT, "config/restrictions.json"), encoding="utf-8"))
TERMS = RESTRICTIONS["termsVersion"]
ALLOWED = {"country": "DE", "region": None, "level": "allowed", "termsVersion": TERMS}
BLOCKED = {"country": "IR", "region": None, "level": "blocked", "name": "Iran", "notice": RESTRICTIONS["levels"]["blocked"]["notice"], "termsVersion": TERMS}
GB = {"country": "GB", "region": None, "level": "regulated", "name": "United Kingdom", "warning": RESTRICTIONS["levels"]["regulated"]["countries"]["GB"]["warning"], "termsVersion": TERMS}

passed = 0
failed = 0


def check(name, condition):
    global passed, failed
    print(f"  {'ok  ' if condition else 'FAIL'} - {name}")
    if condition:
        passed += 1
    else:
        failed += 1


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def open_page(browser, path="/", geo=ALLOWED, screening="clear", acceptance=None):
    """acceptance: the stored record to start with (None = never accepted)."""
    page = browser.new_page()
    page.calls = {"geo": 0, "screen": [], "build": []}

    def geo_route(route):
        page.calls["geo"] += 1
        route.fulfill(status=200, content_type="application/json", body=json.dumps(geo))
    page.route("**/api/geo", geo_route)

    def screen_route(route):
        page.calls["screen"].append(json.loads(route.request.post_data)["address"])
        message = {"sanctioned": "This wallet appears on a sanctions list. It can't launch or trade on Signal.",
                   "unavailable": "Wallet screening is unreachable. Launching and trading are paused until the check succeeds; please try again in a minute."}.get(screening)
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"status": screening, **({"message": message} if message else {})}))
    page.route("**/api/wallet-screen", screen_route)

    def build_route(route):
        page.calls["build"].append(json.loads(route.request.post_data))
        route.fulfill(status=503, content_type="application/json", body='{"message": "stub: not building"}')
    page.route("**/api/solana/swap/build", build_route)
    page.route("**/api/solana/swap/quote", lambda r: r.fulfill(status=200, content_type="application/json", body='{"quoteEnabled": false}'))
    page.route("**/api/solana/token-market?**", lambda r: r.fulfill(status=503, content_type="application/json", body='{"error": "stub"}'))
    page.route("**/api/v1/**", lambda r: r.fulfill(status=404, body="{}"))
    # The (large) bundled wallet libraries come straight from disk: the local
    # Python server sometimes takes ~20s to serve them, which only delays the
    # trade module and makes the test flaky.
    def vendor(route):
        rel = route.request.url.split(f"localhost:{PORT}/", 1)[1].split("?", 1)[0]
        route.fulfill(path=os.path.join(DIST_DIR, *rel.split("/")), content_type="application/javascript")
    page.route("**/client/vendor/**", vendor)
    page.route(lambda url: not url.startswith(f"http://localhost:{PORT}/"), lambda r: r.abort())
    page.add_init_script(f"""
      window.__connects = [];
      // A Base (EVM) wallet, for the Create page's Base/BNB connect buttons.
      window.__evm = [];
      window.ethereum = {{
        request: async ({{ method }}) => {{
          window.__evm.push(method);
          if (method === 'eth_requestAccounts') return ['{EVM_WALLET}'];
          if (method === 'eth_chainId') return '0x2105';
          return null;
        }},
        on: () => {{}},
      }};
      window.solana = {{
        isPhantom: true,
        publicKey: null,
        connect: async (opts) => {{
          window.__connects.push(opts && opts.onlyIfTrusted ? 'trusted' : 'prompt');
          return {{ publicKey: {{ toString: () => '{WALLET}', toBase58: () => '{WALLET}' }} }};
        }},
        on: () => {{}},
        signTransaction: async (tx) => {{ window.__signed = true; return tx; }},
      }};
      if (!sessionStorage.getItem('__seeded')) {{
        sessionStorage.setItem('__seeded', '1');
        localStorage.removeItem('signal_terms_acceptance');
        {f"localStorage.setItem('signal_terms_acceptance', {json.dumps(json.dumps(acceptance))});" if acceptance else ""}
      }}
    """)
    page.goto(f"http://localhost:{PORT}{path}", wait_until="networkidle")
    return page


def accept_all(page):
    page.wait_for_selector('#terms-acceptance', timeout=5000)
    for box in page.query_selector_all('#terms-acceptance input[type=checkbox]'):
        box.check()
    page.click('#terms-accept')


def main():
    if not os.path.isdir(DIST_DIR):
        print(f"ERROR: {DIST_DIR} does not exist — run the build first.")
        sys.exit(1)
    handler = lambda *a, **kw: QuietHandler(*a, directory=DIST_DIR, **kw)
    socketserver.TCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)
    print("compliance-page.test.py\n")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # --- blocked region: browsing works, connecting doesn't -----------
        for path in ("/", "/explore/", "/dashboard/"):
            page = open_page(browser, path=path, geo=BLOCKED)
            page.wait_for_selector('#region-blocked-notice', timeout=5000)
            notice = page.text_content('#region-blocked-notice') or ""
            button = page.text_content('#wallet-connect-btn') or ""
            disabled = page.is_disabled('#wallet-connect-btn')
            connects = page.evaluate("window.__connects")
            heading = page.text_content('main h1') or ""
            page.close()
            check(f"blocked ({path}): the region notice is shown and the page still renders", "Not available in your region" in notice and "(Iran)" in notice and heading != "")
            check(f"blocked ({path}): the header connect button is disabled and nothing connected", button == "Not available in your region" and disabled and connects == [])

        # --- terms at connect, not on page load; stored per browser --------
        page = open_page(browser, path="/dashboard/")
        dialog_on_load = page.query_selector('#terms-acceptance') is not None
        connects_on_load = page.evaluate("window.__connects")
        page.click('#wallet-connect-btn')
        page.wait_for_selector('#terms-acceptance', timeout=5000)
        page.click('#terms-cancel')
        page.wait_for_timeout(300)
        after_cancel = page.evaluate("window.__connects")
        page.click('#wallet-connect-btn')
        accept_all(page)
        page.wait_for_function("() => window.launchpadWallet && window.launchpadWallet.address", timeout=5000)
        stored = json.loads(page.evaluate("localStorage.getItem('signal_terms_acceptance')") or "{}")
        page.wait_for_timeout(300)
        screened = list(page.calls["screen"])
        page.reload(wait_until="networkidle")
        page.wait_for_function("() => window.launchpadWallet && window.launchpadWallet.address", timeout=5000)
        restored = page.evaluate("window.__connects")
        dialog_after_reload = page.query_selector('#terms-acceptance') is not None
        page.close()
        check("no terms screen and no connect on page load", not dialog_on_load and connects_on_load == [])
        check("the terms screen appears at connect; cancelling doesn't connect", after_cancel == [])
        check("accepting connects and stores the terms version in this browser", stored.get("version") == TERMS)
        check("the connected wallet is screened right away", screened == [WALLET])
        check("after a reload, the accepted visitor reconnects silently (no second terms screen)", restored == ["trusted"] and not dialog_after_reload)

        # --- a new terms version re-prompts everyone -----------------------
        page = open_page(browser, path="/dashboard/", acceptance={"version": "2020-01-01", "regulated": []})
        page.wait_for_timeout(500)
        silent = page.evaluate("window.__connects")
        page.click('#wallet-connect-btn')
        page.wait_for_selector('#terms-acceptance', timeout=5000)
        reprompted = True
        page.close()
        check("with an older accepted version, there's no silent reconnect", silent == [])
        check("and connecting asks again", reprompted)

        # --- Level 2: the region's warning, remembered per region ----------
        page = open_page(browser, path="/dashboard/", geo=GB, acceptance={"version": TERMS, "regulated": []})
        page.wait_for_timeout(500)
        silent = page.evaluate("window.__connects")
        page.click('#wallet-connect-btn')
        page.wait_for_selector('#terms-acceptance', timeout=5000)
        text = page.text_content('#terms-acceptance') or ""
        boxes = page.eval_on_selector_all('#terms-acceptance input[type=checkbox]', 'els => els.length')
        accept_all(page)
        page.wait_for_function("() => window.launchpadWallet && window.launchpadWallet.address", timeout=5000)
        stored = json.loads(page.evaluate("localStorage.getItem('signal_terms_acceptance')") or "{}")
        page.close()
        check("moving into a Level 2 region (UK) re-asks, even with the terms already accepted", silent == [] and GB["warning"] in text and boxes == 8)
        check("the UK warning is then remembered for this terms version", stored.get("version") == TERMS and stored.get("regulated") == ["GB"])

        # --- trading: sanctioned or unscreened wallets get no trade --------
        for status, expected in (("sanctioned", "sanctions list"), ("unavailable", "try again")):
            page = open_page(browser, path=f"/token/example/?mint={MINT}&chain=solana", screening=status, acceptance={"version": TERMS, "regulated": []})
            page.wait_for_function("() => { const b = document.getElementById('trade-execute-btn'); return b.dataset.ready === 'true' && window.launchpadWallet && window.launchpadWallet.address && b.textContent.includes('Review and buy'); }", timeout=30000)
            page.fill('#trade-amount', "0.01")
            page.click('#trade-execute-btn')
            page.wait_for_function(f"() => document.getElementById('trade-status').textContent.includes({json.dumps(expected)})", timeout=8000)
            builds = list(page.calls["build"])
            page.close()
            check(f"trading with a {status} wallet is refused before any trade is built", builds == [])

        page = open_page(browser, path=f"/token/example/?mint={MINT}&chain=solana", screening="clear", acceptance={"version": TERMS, "regulated": []})
        page.wait_for_function("() => { const b = document.getElementById('trade-execute-btn'); return b.dataset.ready === 'true' && window.launchpadWallet && window.launchpadWallet.address && b.textContent.includes('Review and buy'); }", timeout=30000)
        page.fill('#trade-amount', "0.01")
        page.click('#trade-execute-btn')
        page.wait_for_function("() => document.getElementById('trade-status').textContent.includes('stub: not building')", timeout=8000)
        builds = list(page.calls["build"])
        page.close()
        check("a cleared wallet goes on to build the trade (the Worker checks again there)", len(builds) == 1 and builds[0]["taker"] == WALLET)

        # --- Base/BNB (EVM) wallets follow the same rules ---------------------
        def choose_base(page):
            page.click('#chain-grid [data-chain="base"]')
            page.wait_for_selector('#evm-connect-base:not([hidden])', timeout=5000)

        page = open_page(browser, path="/create/", geo=BLOCKED)
        choose_base(page)
        page.click('[data-evm-connect="base"]')
        page.wait_for_timeout(500)
        evm_calls = page.evaluate("window.__evm")
        status = page.text_content('[data-evm-status="base"]') or ""
        page.close()
        check("Base wallet: a blocked region never asks the wallet to connect", evm_calls == [] and "terms accepted" in status)

        page = open_page(browser, path="/create/")
        choose_base(page)
        page.click('[data-evm-connect="base"]')
        page.wait_for_selector('#terms-acceptance', timeout=5000)
        evm_before_accept = page.evaluate("window.__evm")
        accept_all(page)
        page.wait_for_function("() => window.launchpadEvmWallet && window.launchpadEvmWallet.address", timeout=5000)
        page.wait_for_timeout(300)
        screened = list(page.calls["screen"])
        page.close()
        check("Base wallet: the terms screen comes first; the wallet isn't asked before accepting", evm_before_accept == [])
        check("Base wallet: once connected, its address is screened too", screened == [EVM_WALLET])

        # --- the terms page --------------------------------------------------
        page = open_page(browser, path="/terms/")
        text = page.text_content('main') or ""
        draft = page.text_content('#terms-draft-label') or ""
        version = page.text_content('#terms-version') or ""
        footer_link = page.query_selector('footer a[href="/terms"]') is not None
        page.close()
        for phrase in ("18 or older", "Not financial advice", "can lose all their value", "non-custodial", "responsible for keeping your wallet", "sanctioned person"):
            check(f"terms page covers: {phrase}", phrase in text)
        check("terms page is marked draft pending legal review, with its version", "Draft pending legal review" in draft and version == TERMS)
        check("terms page lists the blocked places from the config, and says HK/Macau/Taiwan aren't restricted",
              all(RESTRICTIONS["levels"]["blocked"]["countries"][c]["name"] in text for c in ("CN", "IR", "KP", "CU")) and "Crimea" in text and "Hong Kong, Macau and Taiwan are not restricted" in text)
        check("terms page shows each Level 2 warning from the config", all(e["warning"] in text for e in RESTRICTIONS["levels"]["regulated"]["countries"].values()))
        check("every page links to the terms in its footer", footer_link)

        # --- text in the location answer is only text ------------------------
        hostile = dict(BLOCKED, name='<img src=x onerror="window.xss=1">', notice='<b class=injected>notice</b>')
        page = open_page(browser, path="/", geo=hostile)
        page.wait_for_selector('#region-blocked-notice', timeout=5000)
        notice = page.text_content('#region-blocked-notice') or ""
        ran = page.evaluate("window.xss !== undefined || !!document.querySelector('#region-blocked-notice img, #region-blocked-notice .injected')")
        page.close()
        hostile_gb = dict(GB, name="<b class=injected>UK</b>", warning='<img src=x onerror="window.xss=2">')
        page = open_page(browser, path="/dashboard/", geo=hostile_gb)
        page.click('#wallet-connect-btn')
        page.wait_for_selector('#terms-acceptance', timeout=5000)
        dialog = page.text_content('#terms-acceptance') or ""
        ran_dialog = page.evaluate("window.xss !== undefined || !!document.querySelector('#terms-acceptance img, #terms-acceptance .injected')")
        page.close()
        check("a region name/notice with HTML is shown literally in the notice", '<img src=x onerror="window.xss=1">' in notice and "<b class=injected>notice</b>" in notice and not ran)
        check("a warning with HTML is shown literally in the terms screen", '<img src=x onerror="window.xss=2">' in dialog and not ran_dialog)

        browser.close()
    httpd.shutdown()
    print(f"\n{passed} passed, {failed} failed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
