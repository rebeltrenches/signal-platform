import React from 'react';

/** Spec section 33. Content mirrors docs/SECURITY.md — one real source of
 *  truth, two presentations (engineer-facing markdown, user-facing page). */
export function SecurityPage() {
  return (
    <div className="container-narrow" style={{ paddingTop: 40, paddingBottom: 80 }}>
      <h1 style={{ font: 'var(--text-h1)', marginBottom: 8 }}>Security</h1>
      <p style={{ color: 'var(--ink-dim)', marginBottom: 40 }}>
        What's actually true today, not a generic trust page.
      </p>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>Wallets and keys</h2>
        <p style={{ color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          This platform never asks for a seed phrase or private key. Every
          action that moves funds or changes on-chain state is signed in
          your own wallet — Phantom, or an EVM wallet for Base and BNB.
          Nothing here can act on your behalf without that signature.
        </p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>The transfer fee</h2>
        <p style={{ color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          On Solana, the 3% transfer fee is enforced by Token-2022's own
          TransferFeeConfig extension — an existing, audited feature of the
          base program, not custom code written for this platform. 100% of
          the fee goes to the token's own creator, who holds the withdraw
          authority themselves — there is no Signal platform fee and no
          holder-rewards pool taken out of it. On Base and BNB Chain, no
          transfer fee exists yet: writing one would mean a custom
          contract, and we're not shipping that without an independent
          audit first.
        </p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>Creator key security</h2>
        <p style={{ color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          Since the creator holds mint authority, transfer-fee-config authority, and
          withdraw-withheld authority on their own wallet, that wallet's security is
          entirely the creator's own responsibility — no different from holding any
          Solana wallet with real value in it. Hardware wallet for real funds, never
          share a private key, generate fresh keys per project. Signal has nothing to
          store, protect, or lose here — it never sees, requests, or holds any key for
          this mechanism.
        </p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>What "Proof Before You Buy" actually shows</h2>
        <p style={{ color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          Mint authority, freeze authority, holder concentration, and
          liquidity — shown as facts. Never converted into a "safe" verdict
          or a numeric score. What you do with those facts is your call.
        </p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>Current status</h2>
        <div className="empty-state" style={{ textAlign: 'left', padding: 20 }}>
          <p style={{ color: 'var(--ink-dim)', lineHeight: 1.7, maxWidth: 'none', margin: 0 }}>
            This platform is at an early build stage. No contracts have been
            deployed to any network, including testnet. No professional
            audit has happened yet — one is planned before any real funds
            are ever at risk. Nothing on this site currently moves real
            money.
          </p>
        </div>
      </section>
    </div>
  );
}
