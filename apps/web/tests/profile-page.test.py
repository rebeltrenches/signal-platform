#!/usr/bin/env python3
"""Actual browser -> wallet signature -> API -> profile save/read/privacy.
Test-only memory storage; PostgreSQL persistence is checked separately.
"""
import functools
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import threading
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from browser_stubs import stub_pages, wait_for_api
ROOT = Path(__file__).resolve().parents[3]
DIST = ROOT / 'apps/web/dist'
API_PORT, STATIC_PORT = 4517, 8957


def b58(data):
    n = int.from_bytes(data, 'big'); result = ''; alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    while n:
        n, remainder = divmod(n, 58); result = alphabet[remainder] + result
    return '1' * (len(data) - len(data.lstrip(b'\x00'))) + result


def api(path, data=None, token=None, method=None):
    request = urllib.request.Request(f'http://localhost:{API_PORT}' + path, data=json.dumps(data).encode() if data is not None else None,
                                    method=method, headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def run():
    private = Ed25519PrivateKey.generate()
    address = b58(private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))
    environment = {**os.environ, 'PORT': str(API_PORT), 'AUTH_SECRET': 'profile-browser-test-only-secret', 'CHAT_STORAGE': 'memory'}
    process = subprocess.Popen([shutil.which('node') or 'node', '--import', 'tsx', 'apps/api/tests/support/test-server.ts'], cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    wait_for_api(API_PORT, process)
    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    server = socketserver.ThreadingTCPServer(('localhost', STATIC_PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = stub_pages(playwright.chromium.launch(), str(DIST))
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
            page.expose_function('__signProfile', lambda text: list(private.sign(text.encode())))
            page.add_init_script(f"""
                window.SIGNAL_API_BASE_URL = 'http://localhost:{API_PORT}';
                window.launchpadWallet = {{address: '{address}'}};
                window.solana = {{isPhantom: true, signMessage: async (bytes) => ({{signature: new Uint8Array(await window.__signProfile(new TextDecoder().decode(bytes)))}})}};
            """)
            page.goto(f'http://localhost:{STATIC_PORT}/profile/', wait_until='domcontentloaded')
            # Sign-in must work BEFORE required username/name fields are filled.
            page.click('#profile-sign-in')
            page.wait_for_function("document.getElementById('profile-sign-in').hidden === true")
            assert not page.is_checked('#profile-is-public')
            page.fill('#profile-username', 'richard_browser')
            page.fill('#profile-name', 'Richard Browser')
            page.fill('#profile-bio-input', 'Building a community on Signal')
            page.check('input[name="roles"][value="creator"]')
            page.select_option('#profile-theme', 'ocean')
            assert page.text_content('#profile-display-name') == 'Richard Browser'
            assert page.get_attribute('#profile-card', 'data-theme') == 'ocean'
            page.click('#profile-save')
            page.wait_for_function("document.getElementById('profile-save-status').textContent.includes('Private profile saved')")
            token = page.evaluate('window.signalAuth.getSessionToken()')
            assert api('/api/v1/profiles/me', token=token)['profile']['username'] == 'richard_browser'
            # Reload reads the actual API rather than an unsaved browser draft.
            page.reload(wait_until='domcontentloaded')
            page.wait_for_function("document.getElementById('profile-username').value === 'richard_browser'")
            assert page.input_value('#profile-bio-input') == 'Building a community on Signal'
            visitor = browser.new_page()
            visitor.add_init_script(f"window.SIGNAL_API_BASE_URL = 'http://localhost:{API_PORT}'")
            visitor.goto(f'http://localhost:{STATIC_PORT}/u/example/?username=richard_browser', wait_until='domcontentloaded')
            visitor.wait_for_selector('#profile-public-error:not([hidden])')
            assert visitor.is_hidden('#profile-card')
            # Seed a real registered project through the test-only API entrypoint.
            mint = 'ProfileBrowserMint1111111111111111111111'
            api('/__test/seed-token', {'chain': 'SOLANA', 'address': mint, 'name': 'Profile Token', 'symbol': 'PFT', 'decimals': 6, 'creatorWalletAddress': address})
            page.reload(wait_until='domcontentloaded')
            page.wait_for_selector(f'#profile-featured option[value="{mint}"]', state='attached')
            page.select_option('#profile-featured', mint)
            page.check('#profile-show-projects')
            page.check('#profile-is-public')
            page.click('#profile-save')
            page.wait_for_function("document.getElementById('profile-save-status').textContent.includes('Public profile saved')")
            visitor.reload(wait_until='domcontentloaded')
            visitor.wait_for_function("document.getElementById('profile-display-name').textContent === 'Richard Browser'")
            assert visitor.is_hidden('#profile-wallet')
            assert 'Profile Token' in visitor.text_content('#profile-projects')
            assert 'Featured' in visitor.text_content('#profile-projects')
            payload = api('/api/v1/profiles/richard_browser')
            assert 'ownerWalletAddress' not in payload['profile']
            assert 'walletAddress' not in payload['profile']
            assert 'holdings' not in payload and 'watchlist' not in payload
            page.check('#profile-show-wallet'); page.click('#profile-save')
            page.wait_for_function("document.getElementById('profile-save-status').textContent.includes('Public profile saved')")
            visitor.reload(wait_until='domcontentloaded')
            visitor.wait_for_function("!document.getElementById('profile-wallet').hidden")
            assert address in visitor.text_content('#profile-wallet')
            # Text stays text; it cannot create DOM elements.
            page.fill('#profile-name', '<img src=x onerror=alert(1)>')
            assert page.text_content('#profile-display-name') == '<img src=x onerror=alert(1)>'
            assert page.locator('#profile-display-name img').count() == 0
            page.fill('#profile-name', 'Richard Browser')
            # Uploaded images are resized and saved as raster data.
            import base64
            pixel = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=')
            page.set_input_files('#profile-avatar-upload', {'name': 'avatar.png', 'mimeType': 'image/png', 'buffer': pixel})
            page.wait_for_function("document.getElementById('profile-avatar-image').getAttribute('src')?.startsWith('data:image/jpeg;')")
            page.click('#profile-save')
            page.wait_for_function("document.getElementById('profile-save-status').textContent.includes('Public profile saved')")
            assert api('/api/v1/profiles/me', token=token)['profile']['avatar'].startswith('data:image/jpeg;')
            # Wallet switching clears the previous owner's preview and controls.
            page.evaluate("window.launchpadWallet.address = 'DifferentWallet'; document.dispatchEvent(new CustomEvent('launchpad:wallet-connected'))")
            assert page.input_value('#profile-username') == ''
            assert page.is_hidden('#profile-delete-section')
            assert page.is_disabled('#profile-save')
            page.evaluate(f"window.launchpadWallet.address = '{address}'; document.dispatchEvent(new CustomEvent('launchpad:wallet-connected'))")
            page.wait_for_function("document.getElementById('profile-username').value === 'richard_browser'")
            # Phone layouts must stay within the viewport.
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            visitor.set_viewport_size({'width': 390, 'height': 844})
            assert visitor.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            # Unpublish removes public access immediately.
            page.uncheck('#profile-is-public'); page.click('#profile-save')
            page.wait_for_function("document.getElementById('profile-save-status').textContent.includes('Private profile saved')")
            visitor.reload(wait_until='domcontentloaded')
            visitor.wait_for_selector('#profile-public-error:not([hidden])')
            page.locator('#profile-delete-section summary').click()
            page.once('dialog', lambda dialog: dialog.accept())
            page.click('#profile-delete')
            page.wait_for_function("document.getElementById('profile-save-status').textContent.includes('deleted')")
            assert api('/api/v1/profiles/me', token=token)['profile'] is None
            assert not errors, errors
            browser.close()
            print('Profile browser flow passed: real signing, private saves, reloads, publishing, ownership, projects, image uploads, wallet switching, mobile layout, unpublishing and deletion.')
    finally:
        server.shutdown(); server.server_close(); process.terminate(); process.wait(timeout=5)

if __name__ == '__main__':
    run()
