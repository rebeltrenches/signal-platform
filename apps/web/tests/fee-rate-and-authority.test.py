#!/usr/bin/env python3
"""
Real, re-runnable verification that the confirmed fee model — 3% total
Transfer Fee, 100% to the creator, 0% anything else — is actually
encoded in the real Solana instruction the Create flow builds, not just
displayed in the UI or asserted in a comment.

Complements apps/web/tests/collect-fees.test.py, which verifies the
HARVEST + WITHDRAWAL side (fees already withheld -> creator's wallet).
This file verifies the other end of the chain: token/mint CREATION,
where the 3% rate and the fee authorities are first written into the
mint's TransferFeeConfig extension.

Same honesty scope as collect-fees.test.py: the stub modules replace
@solana/web3.js and @solana/spl-token with fakes that record what
they're called with. This proves apps/web/src/client/launch-solana.js's
OWN orchestration logic is correct — which values it passes to the real
instruction constructors — not that the real Solana libraries themselves
behave as documented (impossible to verify without installing them,
which needs internet this sandbox doesn't have). No real transaction has
ever been submitted to any network from this project.

Run with: python3 apps/web/tests/fee-rate-and-authority.test.py
Requires: a built apps/web/dist and Python's `playwright` package.
"""
import http.server
import socketserver
import threading
import sys
import time
import os
from playwright.sync_api import sync_playwright

REPO_ROOT = os.path.dirname(os.path.abspath(__file__)) + "/../../.."
DIST_DIR = os.path.join(REPO_ROOT, "apps/web/dist")
STUBS_DIR = os.path.join(REPO_ROOT, "apps/web/tests/stubs")
PORT = 8098

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


def start_server():
    os.chdir(DIST_DIR)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    if not os.path.isdir(DIST_DIR):
        print(f"ERROR: {DIST_DIR} does not exist — run the build first.")
        sys.exit(1)

    httpd = start_server()
    time.sleep(0.3)
    print("fee-rate-and-authority.test.py\n")

    creator_wallet = "RealCreatorWallet1111111111111111111111"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        page.route(
            "https://esm.sh/@solana/web3.js@1.95.3",
            lambda r: r.fulfill(path=os.path.join(STUBS_DIR, "web3.js"), content_type="application/javascript"),
        )
        page.route(
            "**/esm.sh/@solana/spl-token@0.4.9**",
            lambda r: r.fulfill(path=os.path.join(STUBS_DIR, "spl-token.js"), content_type="application/javascript"),
        )
        page.add_init_script(f"""
          window.__t = {{}};
          window.solana = {{
            isPhantom: true,
            connect: async () => ({{ publicKey: {{ toBase58: () => '{creator_wallet}' }} }}),
            signTransaction: async (tx) => {{ tx.serialize = () => new Uint8Array([1]); return tx; }},
          }};
        """)

        page.goto(f"http://localhost:{PORT}/create", wait_until="networkidle")
        page.click('.wizard-step[data-step="0"] [data-chain="solana"]')
        page.click('.wizard-step[data-step="0"] [data-action="next"]')
        page.fill('.wizard-step[data-step="1"] #tk-name', 'Fee Rate Test')
        page.fill('.wizard-step[data-step="1"] #tk-symbol', 'FRT')
        page.click('.wizard-step[data-step="1"] [data-action="next"]')
        page.fill('.wizard-step[data-step="2"] #tk-supply', '1000000000')
        page.click('.wizard-step[data-step="2"] [data-action="next"]')

        page.click('#mainnetConnectBtn')
        page.check('#mainnetAck')
        page.click('#mainnetLaunchBtn')
        page.wait_for_timeout(600)

        state = page.evaluate("window.__t")
        cfg_call = state.get("transferFeeConfigCall") or state.get("cfgCall")
        # The shared stub (apps/web/tests/stubs/spl-token.js) records this
        # under whichever key its createInitializeTransferFeeConfigInstruction
        # stub uses — read both possible names defensively.
        browser.close()

    httpd.shutdown()

    # --- The actual assertions ---
    print("Captured call to createInitializeTransferFeeConfigInstruction:")
    print(" ", cfg_call)
    print()

    if cfg_call is None:
        check("createInitializeTransferFeeConfigInstruction was actually called", False)
    else:
        bps = cfg_call.get("bps")
        cfg_auth = cfg_call.get("cfgAuth")
        withdraw_auth = cfg_call.get("withdrawAuth")

        check("1/2. The rate encoded in the real instruction is exactly 300 bps (3.00%)", bps == 300)
        check("3/7. transferFeeConfigAuthority equals the connecting creator wallet", cfg_auth == creator_wallet)
        check("3/7. withdrawWithheldAuthority equals the connecting creator wallet", withdraw_auth == creator_wallet)
        check("4/6. transferFeeConfigAuthority is NOT the known former platform-wallet address", cfg_auth != "FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19")
        check("5/6. withdrawWithheldAuthority is NOT the known former platform-wallet address", withdraw_auth != "FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19")
        check("7. Both authority slots are the SAME address — one destination, not two", cfg_auth == withdraw_auth)

    # --- Worked numeric example: does 300bps actually mean 3%, and does
    #     the whole fee land as creatorTax with nothing left over? ---
    print()
    sys.path.insert(0, REPO_ROOT)
    import subprocess
    node_check = subprocess.run(
        ["npx", "tsx", "-e", """
import { computeTaxSplit } from '@launchpad/utils';
import { DEFAULT_TAX_CONFIG } from '@launchpad/types';
const r = computeTaxSplit(100_000_000_000n, DEFAULT_TAX_CONFIG);
console.log(JSON.stringify({
  totalTax: r.totalTax.toString(),
  creatorTax: r.creatorTax.toString(),
  netAmount: r.netAmount.toString(),
  ratePercent: Number(r.totalTax * 10000n / r.grossAmount) / 100,
}));
"""],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    import json
    try:
        result = json.loads(node_check.stdout.strip().splitlines()[-1])
        print("Worked example — 100,000,000,000 base units transferred:")
        print(f"  totalTax (fee withheld):   {result['totalTax']}")
        print(f"  creatorTax (to creator):   {result['creatorTax']}")
        print(f"  netAmount (to recipient):  {result['netAmount']}")
        print(f"  effective rate:            {result['ratePercent']}%")
        check("Worked example: effective rate is exactly 3.0%", result["ratePercent"] == 3.0)
        check("Worked example: 100% of the withheld fee is attributed to the creator (creatorTax == totalTax)", result["creatorTax"] == result["totalTax"])
    except Exception as e:
        check(f"Worked numeric example ran and parsed (error: {e})", False)

    print(f"\n{passed} passed, {failed} failed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
