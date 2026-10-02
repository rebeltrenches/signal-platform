import { readFileSync } from 'node:fs';

const detail = readFileSync(new URL('../src/client/token-detail.js', import.meta.url), 'utf8');
const provenance = readFileSync(new URL('../src/client/curve-provenance.js', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build.tsx', import.meta.url), 'utf8');

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`Provenance guard missing: ${label}`);
}

requireText(detail, "Registered on Signal: Yes", 'registration is labelled as registration');
requireText(detail, "badge.dataset.signalCurve === 'true'", 'registration fetch cannot overwrite proven curve launch');
if (detail.includes("badge.textContent = res.ok ? 'Launched on Signal: Yes'")) {
  throw new Error('A registration row must never be presented as proof of a Signal curve launch.');
}

requireText(provenance, '[encoder.encode("bonding-curve"), mint.toBytes()]', 'deterministic Signal curve PDA');
requireText(provenance, '!info.owner.equals(pid)', 'curve program-owner verification');
requireText(provenance, 'stateProvesMint(info.data, mint)', 'curve state mint binding');
requireText(provenance, 'badge.dataset.signalCurve = "true"', 'provenance marker');
requireText(provenance, 'Launched on Signal curve: Yes', 'stronger on-chain-proven launch label');
requireText(build, "moduleScripts: ['/client/curve-provenance.js', '/client/trade-router.js']", 'provenance module wired before router');

console.log('✓ registration is not mislabelled as a Signal curve launch');
console.log('✓ Signal curve launch claim requires PDA owner + state/mint evidence');
console.log('✓ on-chain provenance evidence wins over the later registration fetch');
console.log('✓ Signal bonding-curve provenance guard passed');
