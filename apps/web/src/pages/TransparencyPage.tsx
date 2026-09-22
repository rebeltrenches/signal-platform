import React from 'react';

/**
 * Transparency Center — master spec section 13. Distinct from /security:
 * Security explains how the platform's mechanisms work in general
 * (wallets, signing, the fee model); this page is about what Signal does
 * and does not verify for any given token, and how to read the evidence
 * labels used throughout the product.
 */
export function TransparencyPage() {
  return (
    <div className="container-narrow" style={{ paddingTop: 40, paddingBottom: 80 }}>
      <h1 style={{ font: 'var(--text-h1)', marginBottom: 8 }}>Transparency Center</h1>
      <p style={{ color: 'var(--ink-dim)', marginBottom: 40 }}>
        What Signal actually verifies for a token, what it doesn't, and how to read the labels
        you'll see throughout the product.
      </p>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>Every fact has a source — here's what each label means</h2>
        <div className="card">
          <div className="review-row"><span className="k">Blockchain-derived</span><span className="v" style={{ color: 'var(--up)' }}>Read from the chain or a traceable indexed on-chain record</span></div>
          <div className="review-row"><span className="k">Signal-verified</span><span className="v" style={{ color: 'var(--brand)' }}>Confirmed through a stated Signal verification process</span></div>
          <div className="review-row"><span className="k">Creator-provided</span><span className="v" style={{ color: 'var(--gold)' }}>Supplied by the token's creator — name, description, social links</span></div>
          <div className="review-row"><span className="k">Third-party</span><span className="v">From an external API or data provider Signal doesn't control</span></div>
          <div className="review-row"><span className="k">Community-reported</span><span className="v">Submitted by a user, not verified by Signal</span></div>
        </div>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>What Signal verifies</h2>
        <p style={{ color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          A blockchain-derived field comes from an RPC response or an indexed on-chain record and
          should include enough context to check independently. Freshness depends on the source and
          indexing delay. Signal does not turn these facts into a promise about value, legitimacy,
          liquidity, or future behavior.
        </p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>What Signal does NOT verify</h2>
        <p style={{ color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          Creator-provided information (descriptions, social links, project claims) is exactly
          that — provided by whoever created the token, not fact-checked by Signal. Community
          reports are shown as submitted, not confirmed. Third-party market data may be delayed or
          incomplete. Use of an established chain program does not mean Signal itself has been
          professionally audited — those are different claims.
        </p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>Fees, transparently</h2>
        <div className="card">
          <div className="review-row"><span className="k">Current Solana launch fee</span><span className="v">0.001 SOL → Signal platform wallet</span></div>
          <div className="review-row"><span className="k">Network costs</span><span className="v">Separate rent and transaction fees shown by the wallet</span></div>
          <div className="review-row"><span className="k">New-token transfer tax</span><span className="v" style={{ color: 'var(--ink-faint)' }}>None</span></div>
          <div className="review-row"><span className="k">Planned creator trading fee</span><span className="v">1% of SOL side → creator, only on future Signal-routed trades</span></div>
          <div className="review-row"><span className="k">Holder rewards</span><span className="v" style={{ color: 'var(--ink-faint)' }}>None promised</span></div>
        </div>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>What works now — and what comes next</h2>
        <div className="card">
          <div className="review-row"><span className="k">Live now</span><span className="v">Solana Mainnet creation, Solana/Base/BNB discovery, wallet portfolio, chat, watchlists</span></div>
          <div className="review-row"><span className="k">External today</span><span className="v">Token purchases and sales open the available source market</span></div>
          <div className="review-row"><span className="k">Planned</span><span className="v">Non-custodial in-app routing with quote, slippage, price impact, and fees shown before signing</span></div>
        </div>
      </section>

      <section>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>No safety scores, ever</h2>
        <p style={{ color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          Signal never converts these facts into a "safe" verdict, a numeric score, or a ranking.
          Facts are shown; what they mean is for you to decide. A warning, when shown, explains
          the specific evidence behind it rather than asserting a conclusion — for example,
          "historical on-chain activity detected that may warrant further investigation," not
          "this is a scam."
        </p>
      </section>
    </div>
  );
}
