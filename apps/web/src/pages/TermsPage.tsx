import React from 'react';

type Entry = { name: string; note?: string; warning?: string };
export type Restrictions = {
  termsVersion: string;
  levels: {
    blocked: { countries: Record<string, Entry>; regions: Record<string, Entry | string> };
    regulated: { countries: Record<string, Entry> };
  };
};

/**
 * Terms and risks, in plain English. DRAFT pending legal review. The
 * regions listed come from config/restrictions.json (the same file the
 * Worker enforces), so this page can't drift from what's actually applied.
 * Every point here is one of the boxes visitors tick at wallet connect
 * (apps/web/src/client/compliance.js).
 */
export function TermsPage({ restrictions }: { restrictions: Restrictions }) {
  const blocked = Object.values(restrictions.levels.blocked.countries).map((c) => c.name);
  const regions = Object.entries(restrictions.levels.blocked.regions)
    .filter(([key]) => key !== '$comment')
    .map(([, value]) => (value as Entry).name);
  const regulated = Object.values(restrictions.levels.regulated.countries);

  return (
    <div className="container-narrow" style={{ paddingTop: 36, paddingBottom: 80 }}>
      <div className="page-head" style={{ display: 'block', paddingTop: 0 }}>
        <p className="badge badge-placeholder" id="terms-draft-label" style={{ marginBottom: 12 }}>
          Draft pending legal review
        </p>
        <h1>Terms and risks</h1>
        <p>
          Please read this before connecting a wallet. It's written in plain English, and it is a draft that hasn't been
          reviewed by a lawyer yet. Version <span id="terms-version">{restrictions.termsVersion}</span>: when this version
          changes, everyone is asked to accept it again.
        </p>
      </div>

      <section className="tax-box terms-section">
        <h2>Who can use Signal</h2>
        <ul>
          <li>You must be <strong>18 or older</strong>.</li>
          <li>
            You must not be in a region where Signal is unavailable: {blocked.join(', ')}, and the regions of{' '}
            {regions.join(', ')}. Hong Kong, Macau and Taiwan are not restricted.
          </li>
          <li>You must not be a sanctioned person, or act for one.</li>
          <li>
            Don't use a VPN or proxy to get around these limits. We check location from your internet connection, which can be
            wrong or bypassed, so these rules are also yours to follow.
          </li>
        </ul>
      </section>

      <section className="tax-box terms-section">
        <h2>Not financial advice</h2>
        <p>
          Nothing on Signal is financial, investment, legal or tax advice. Signal shows data and lets you use your own wallet;
          it doesn't recommend buying, selling or launching anything.
        </p>
      </section>

      <section className="tax-box terms-section">
        <h2>Meme coins are extremely risky</h2>
        <p>
          Meme coins can lose all their value, very quickly, and many do. Prices can swing wildly, liquidity can disappear, and
          scams are common. <strong>Only use money you can afford to lose completely.</strong>
        </p>
      </section>

      <section className="tax-box terms-section">
        <h2>Signal never holds your funds</h2>
        <p>
          Signal is non-custodial. Your wallet (such as Phantom) holds your keys and funds; Signal never does, and can't move
          them. Every transaction is one you approve in your own wallet.
        </p>
      </section>

      <section className="tax-box terms-section">
        <h2>You're responsible for your wallet and transactions</h2>
        <p>
          You're responsible for keeping your wallet and recovery phrase safe, for checking every transaction before you approve
          it, and for any taxes. Transactions on a blockchain can't be reversed.
        </p>
      </section>

      <section className="tax-box terms-section">
        <h2>Extra warnings for some regions</h2>
        <p>If you're in one of these places, you'll be asked to read and accept its warning as well:</p>
        {regulated.map((entry) => (
          <div key={entry.name} className="review-row" style={{ display: 'block' }}>
            <strong>{entry.name}</strong>
            <p className="hint" style={{ textTransform: 'none', marginTop: 4 }}>{entry.warning}</p>
          </div>
        ))}
      </section>

      <section className="tax-box terms-section">
        <h2>Sanctions screening</h2>
        <p>
          When you connect a wallet, and again before a token launch is listed or a trade is built, we check the wallet address
          against sanctions lists (using Chainalysis). A wallet that appears on a sanctions list can't launch or trade on
          Signal. If the check can't be completed, launching and trading pause until it can.
        </p>
      </section>
    </div>
  );
}
