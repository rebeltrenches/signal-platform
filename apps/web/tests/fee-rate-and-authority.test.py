#!/usr/bin/env python3
"""Static regression guard for the current Signal bonding-curve fee model."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
launch = (ROOT / "apps/web/src/client/launch-solana-curve.js").read_text()
program = (ROOT / "programs/signal-bonding-curve/src/lib.rs").read_text()
collector = (ROOT / "apps/web/src/client/collect-fees.js").read_text()
create_page = (ROOT / "apps/web/src/pages/CreatePage.tsx").read_text()
build = (ROOT / "apps/web/scripts/build.tsx").read_text()

assert "moduleScripts: ['/client/launch-solana-curve.js', '/client/evm-wallet.js']" in build
assert "const INITIAL_REAL_TOKEN_BPS: u128 = 7_931;" in program
assert "const INITIAL_VIRTUAL_TOKEN_BPS: u128 = 10_730;" in program
assert "const INITIAL_VIRTUAL_SOL_RESERVES: u64 = 30_000_000_000" in program
assert "const SIGNAL_FEE_BPS: u128 = 100;" in program
assert "const LAUNCH_FEE_LAMPORTS: u64 = 1_000_000;" in program
assert "TOKEN_2022_PROGRAM_ID" not in launch
assert "createInitializeTransferFeeConfigInstruction" not in launch
assert "SIGNAL_LEGACY_TOKEN_FEE_COLLECTION_DISABLED" in collector
assert "createWithdrawWithheldTokensFromMintInstruction" not in collector
assert "79.31%" in create_page
assert "20.69%" in create_page
assert "creator does not automatically receive the supply" in create_page
assert "0.001 SOL" in create_page
print("Signal bonding-curve fee model regression guards passed")
