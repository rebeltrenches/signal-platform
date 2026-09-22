#!/usr/bin/env python3
"""Static regression guard for the current Solana fee model."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
launch = (ROOT / "apps/web/src/client/launch-solana.js").read_text()
collector = (ROOT / "apps/web/src/client/collect-fees.js").read_text()
create_page = (ROOT / "apps/web/src/pages/CreatePage.tsx").read_text()

assert "SIGNAL_LAUNCH_FEE_LAMPORTS = 1_000_000" in launch
assert "SystemProgram.transfer" in launch
assert "TOKEN_2022_PROGRAM_ID" not in launch
assert "createInitializeTransferFeeConfigInstruction" not in launch
assert "SIGNAL_LEGACY_TOKEN_FEE_COLLECTION_DISABLED" in collector
assert "createWithdrawWithheldTokensFromMintInstruction" not in collector
assert "Creator trading fee" in create_page
assert "0.001 SOL" in create_page
print("fee model regression guards passed")
