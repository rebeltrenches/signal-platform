#!/usr/bin/env python3
"""Regression guard: the superseded browser withheld-token collector stays disabled."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
source = (ROOT / "apps/web/src/client/collect-fees.js").read_text()
build = (ROOT / "apps/web/scripts/build.tsx").read_text()

assert "SIGNAL_LEGACY_TOKEN_FEE_COLLECTION_DISABLED" in source
assert "createHarvestWithheldTokensToMintInstruction" not in source
assert "createWithdrawWithheldTokensFromMintInstruction" not in source
assert "collect-fees.js" not in build
print("legacy fee collection remains disabled")
