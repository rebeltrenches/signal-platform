"""Shared stubs for the Python browser tests that serve apps/web/dist from a
plain local file server (no Cloudflare Worker, no network).

stub_pages(browser, dist_dir) wraps browser.new_page so every page gets:
- the Worker-only endpoints (/api/geo, /api/wallet-screen, swap quote,
  token market) answered with neutral fixtures, since a file server 404s;
- DEX Screener (fetched by Explore straight from the browser) answered with
  no tokens, and the PumpPortal WebSocket accepted but silent, so results
  don't depend on live market data or network access;
- the large vendor bundle served from disk, since Python's file server can
  reset those connections under parallel page loads.
"""
import json
import mimetypes
import os

WORKER_FIXTURES = {
    "/api/geo": {"country": "DE", "region": None, "level": "allowed", "termsVersion": "browser-test"},
    "/api/solana/swap/quote": {"quoteEnabled": False},
    "/api/solana/token-market": {"marketEnabled": False},
}


def _json(route, body):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def install(page, dist_dir):
    def worker(route):
        path = "/" + route.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?", 1)[0]
        if path == "/api/wallet-screen":
            return _json(route, {"status": "clear"})
        if path in WORKER_FIXTURES:
            return _json(route, WORKER_FIXTURES[path])
        return route.fallback()

    def vendor(route):
        rel = route.request.url.split("/client/vendor/", 1)[1].split("?", 1)[0]
        file = os.path.join(dist_dir, "client", "vendor", *rel.split("/"))
        if not os.path.isfile(file):
            return route.fallback()
        with open(file, "rb") as f:
            route.fulfill(status=200, body=f.read(), content_type=mimetypes.guess_type(file)[0] or "application/javascript")

    for path in [*WORKER_FIXTURES, "/api/wallet-screen"]:
        page.route(f"**{path}*", worker)
    page.route("https://api.dexscreener.com/**", lambda route: _json(route, []))
    # Explore's live PumpPortal feed: accept the socket and send nothing, so
    # offline or restricted runs don't log a connection error.
    page.route_web_socket("wss://pumpportal.fun/**", lambda ws: None)
    page.route("**/client/vendor/**", vendor)
    return page


def stub_pages(browser, dist_dir):
    original = browser.new_page

    def new_page(*args, **kwargs):
        return install(original(*args, **kwargs), dist_dir)

    browser.new_page = new_page
    return browser


def wait_for_api(port, proc, timeout_s=30):
    """Wait until the local API subprocess answers HTTP (any status), instead
    of a fixed sleep that's too short on slower machines."""
    import time
    import urllib.error
    import urllib.request

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"local API exited early (code {proc.returncode})")
        try:
            urllib.request.urlopen(f"http://localhost:{port}/health", timeout=1)
            return
        except urllib.error.HTTPError:
            return
        except (urllib.error.URLError, ConnectionError, OSError):
            time.sleep(0.1)
    raise RuntimeError(f"local API on port {port} did not become ready within {timeout_s}s")
