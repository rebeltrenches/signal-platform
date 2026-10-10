"""Isolated scanner browser checks using the actual HomePage form and client.
Run node apps/web/tests/wallet-xray-function.test.mjs first to generate its fixture.
Does not require the unrelated site/vendor build dependencies.
"""
import copy
import json
import pathlib
import shutil
import re
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[3]
data = json.loads(pathlib.Path('/tmp/wallet-xray-fixture.json').read_text())
source = (ROOT / 'apps/web/src/pages/HomePage.tsx').read_text()
markup = re.search(r'<section className="container xray-home".*?</section>', source, re.S).group()
markup = markup.replace('className=', 'class=').replace('htmlFor=', 'for=').replace('noValidate', 'novalidate').replace('spellCheck={false}', 'spellcheck="false"')
markup = markup.replace('<div id="xray-results" class="xray-results" aria-live="polite" />', '<div id="xray-results" class="xray-results" aria-live="polite"></div>')
script = (ROOT / 'apps/web/src/client/xray.js').read_text()
styles = (ROOT / 'apps/web/src/styles/components.css').read_text()
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which("chromium") or None)
    page = browser.new_page(viewport={"width": 390, "height": 844})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('https://signal.test/**', lambda route: route.fulfill(content_type='text/html', body=markup))
    requests = []
    def reply(route):
        requests.append(route.request.url)
        route.fulfill(content_type='application/json', body=json.dumps(data))
    page.route('**/api/xray?*', reply)
    page.goto('https://signal.test/')
    page.add_style_tag(content=styles)
    page.add_script_tag(content=script)
    page.fill('#xray-mint', 'invalid')
    page.click('#xray-form button[type=submit]')
    assert not requests and 'coin or wallet address' in page.inner_text('#xray-results')
    page.fill('#xray-mint', data['address'])
    page.click('#xray-form button[type=submit]')
    page.wait_for_selector('.xray-wallet-map svg')
    assert requests[-1].endswith('?address=' + data['address'])
    assert 'Wallet' in page.inner_text('.xray-title')
    assert 'Available SOL: 2.5 SOL' in page.inner_text('#xray-results')
    assert page.locator('.xray-map-peer').count() == 1
    assert page.locator('a[href*="solscan.io/tx/"]').count() >= 4
    page.get_by_text('Price unavailable (1)', exact=True).click()
    assert '9007199.254741' in page.inner_text('#xray-results')
    assert page.locator('.xray-wallet-map svg').bounding_box()['width'] <= 390
    assert page.locator('#xray-results[aria-busy]').count() == 0
    assert page.get_by_role('link', name='Report an error').get_attribute('href') == '/support'
    page.locator('.xray-map-peer').click()
    assert data['connections'][0]['address'] in page.inner_text('.xray-map-panel')
    assert page.locator('.xray-map-panel .xray-address').get_attribute('data-address') == data['connections'][0]['address']
    page.get_by_role('button', name='X-Ray coin').click()
    page.wait_for_selector('.xray-wallet-map svg')
    assert '?mint=' in requests[-1]
    page.locator('.xray-wallet-map details summary').click()
    page.get_by_role('button', name='X-Ray wallet').click()
    page.wait_for_selector('.xray-wallet-map svg')
    assert '?address=' in requests[-1]
    malicious = copy.deepcopy(data)
    malicious['tokens'][0]['name'] = '<img src=x onerror=window.__xss=1>'
    page.evaluate('(data) => window.signalXray.render(document.getElementById("xray-results"), data)', malicious)
    assert page.locator('#xray-results img').count() == 0
    assert page.evaluate('window.__xss') is None
    unavailable = copy.deepcopy(data)
    unavailable.update(tokens=[], tokenDataComplete=False, transactions=[], connections=[], history={"available": False})
    page.evaluate('(data) => window.signalXray.render(document.getElementById("xray-results"), data)', unavailable)
    assert 'Transfer data unavailable' in page.inner_text('#xray-results')
    assert 'History unavailable' in page.inner_text('#xray-results')
    assert 'No non-zero token balances' not in page.inner_text('#xray-results')
    assert not errors, errors
    browser.close()
print('Wallet scanner browser checks passed: unified input, balances, map evidence, drilldown, mobile, XSS, unavailable data.')
