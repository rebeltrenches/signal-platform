// Pure arithmetic guard for Signal's Pump-style curve economics.
// This does not replace runtime tests; it prevents accidental parameter drift
// that would change graduation cost or create a large price discontinuity.

const BPS = 10_000n;
const REAL_BPS = 7_931n;
const VIRTUAL_BPS = 10_730n;
const FEE_BPS = 100n;
const INITIAL_VIRTUAL_SOL = 30_000_000_000n;
const LAMPORTS_PER_SOL = 1_000_000_000n;

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
function ceilDiv(n, d) { return (n + d - 1n) / d; }

function economics(wholeSupply, decimals) {
  const supply = BigInt(wholeSupply) * 10n ** BigInt(decimals);
  const realTokens = supply * REAL_BPS / BPS;
  const virtualTokens = supply * VIRTUAL_BPS / BPS;
  const graduationTokens = supply - realTokens;
  const remainingVirtualTokens = virtualTokens - realTokens;
  const k = virtualTokens * INITIAL_VIRTUAL_SOL;
  const finalVirtualSol = ceilDiv(k, remainingVirtualTokens);
  const netCurveSol = finalVirtualSol - INITIAL_VIRTUAL_SOL;
  const finalFee = ceilDiv(netCurveSol * FEE_BPS, BPS - FEE_BPS);
  const grossCurveSol = netCurveSol + finalFee;
  return {
    supply,
    realTokens,
    virtualTokens,
    graduationTokens,
    remainingVirtualTokens,
    finalVirtualSol,
    netCurveSol,
    finalFee,
    grossCurveSol,
  };
}

const e = economics(100_000_000, 6);

assert(REAL_BPS + (BPS - REAL_BPS) === BPS, 'sale and graduation allocations sum to 100%');
assert(e.realTokens === e.supply * 7_931n / 10_000n, '79.31% of supply is curve inventory');
assert(e.graduationTokens === e.supply * 2_069n / 10_000n, '20.69% of supply is graduation inventory');
assert(e.virtualTokens > e.supply, 'virtual token reserve starts above full supply');
assert(e.remainingVirtualTokens > e.graduationTokens, 'virtual reserve remains above real graduation inventory at completion');

// These exact lamport values are the intended Pump-style shape for any supply
// that scales cleanly by the reserve ratios. If these change, graduation cost
// has changed and must be consciously reviewed rather than drifting silently.
assert(e.netCurveSol === 85_005_359_057n, 'curve reaches 100% at the intended 85.005359057 net SOL');
assert(e.finalFee === 858_639_991n, 'final-fill 1% fee uses exact inverse fee arithmetic');
assert(e.grossCurveSol === 85_863_999_048n, 'gross SOL needed for a complete fresh curve is 85.863999048 SOL');

// The pre-expense Raydium deposit ratio should closely match the terminal
// marginal curve price. Large discontinuity here would create an immediate
// arbitrage jump at graduation. Compare with integer cross multiplication:
// poolPrice = netCurveSol / graduationTokens
// terminalPrice = finalVirtualSol / remainingVirtualTokens
const left = e.netCurveSol * e.remainingVirtualTokens;
const right = e.finalVirtualSol * e.graduationTokens;
const diff = left > right ? left - right : right - left;
// Less than 1 basis point difference before the small Raydium setup costs.
assert(diff * 10_000n < right, 'graduation liquidity ratio stays within 1 bp of terminal curve price before setup costs');

// Supply choice should change token price, not the amount of SOL required to
// move the same percentage of the normalized curve from 0% to 100%.
for (const supply of [120_000_000, 500_000_000, 1_000_000_000]) {
  const other = economics(supply, 6);
  assert(other.netCurveSol === e.netCurveSol, `net graduation SOL is supply-normalized for ${supply} tokens`);
  assert(other.grossCurveSol === e.grossCurveSol, `gross graduation SOL is supply-normalized for ${supply} tokens`);
}

const sol = (lamports) => Number(lamports) / Number(LAMPORTS_PER_SOL);
console.log(`✓ 79.31% curve inventory + 20.69% graduation reserve`);
console.log(`✓ full fresh curve: ${sol(e.netCurveSol).toFixed(9)} net SOL + ${sol(e.finalFee).toFixed(9)} SOL fee = ${sol(e.grossCurveSol).toFixed(9)} SOL gross`);
console.log('✓ terminal curve price and pre-expense Raydium deposit ratio differ by < 1 bp');
console.log('✓ normalized graduation SOL is invariant across supported supply sizes');
console.log('✓ Signal bonding-curve economics test passed');
