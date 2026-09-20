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
          <div className="review-row"><span className="k">Blockchain-derived</span><span className="v" style={{ color: 'var(--up)' }}>Read directly from on-chain state — mint authority, supply, holder balances</span></div>
          <div className="review-row"><span className="k">Signal-verified</span><span className="v" style={{ color: 'var(--brand)' }}>Signal independently confirmed this through its own process</span></div>
          <div className="review-row"><span className="k">Creator-provided</span><span className="v" style={{ color: 'var(--gold)' }}>Supplied by the token's creator — name, description, social links</span></div>
          <div className="review-row"><span className="k">Third-party</span><span className="v">From an external API or data provider Signal doesn't control</span></div>
          <div className="review-row"><span className="k">Community-reported</span><span className="v">Submitted by a user, not verified by Signal</span></div>
        </div>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>What Signal verifies</h2>
        <p style={{ color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          Anything labeled "blockchain-derived" is read live from the chain itself — mint
          authority, freeze authority, holder balances, the transfer-fee configuration. This is
          verifiable by anyone, independently, on any block explorer; Signal doesn't add
          interpretation on top of it.
        </p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>What Signal does NOT verify</h2>
        <p style={{ color: 'var(--ink-dim)', lineHeight: 1.7 }}>
          Creator-provided information (descriptions, social links, project claims) is exactly
          that — provided by whoever created the token, not fact-checked by Signal. Community
          reports are shown as submitted, not confirmed. An audited library or program underneath
          a feature (like Solana's own Token-2022 extension) does not mean Signal itself has been
          audited — those are different claims, and this product does not blur them.
        </p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 10 }}>The Signal Fee, transparently</h2>
        <div className="card">
          <div className="review-row"><span className="k">Signal Fee (on applicable transfers)</span><span className="v">1%</span></div>
          <div className="review-row"><span className="k">Signal platform wallet</span><span className="v">100% → the Signal platform wallet</span></div>
          <div className="review-row"><span className="k">Creator share</span><span className="v" style={{ color: 'var(--ink-faint)' }}>0% — none</span></div>
          <div className="review-row"><span className="k">Holder rewards</span><span className="v" style={{ color: 'var(--ink-faint)' }}>None</span></div>
          <div className="review-row"><span className="k">Launch Fee (one-time, at creation)</span><span className="v">1% of the actual launch payment, when one exists — not charged today</span></div>
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
