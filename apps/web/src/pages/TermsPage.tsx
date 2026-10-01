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
            {regions.join(', ')}. Under the current configuration, Hong Kong, Macau and Taiwan are not in Signal's blocked list.
          </li>
          <li>You must not be a sanctioned person, or use Signal on behalf of a sanctioned person or entity.</li>
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
        <h2>Crypto assets, including meme coins, are extremely risky</h2>
        <p>
          Crypto assets can lose all or substantially all of their value, sometimes very quickly. Prices can move sharply,
          liquidity can disappear, smart contracts and trading venues can fail or be exploited, and fraud or misleading project
          claims can occur. Only use funds you can afford to lose.
        </p>
      </section>

      <section className="tax-box terms-section">
        <h2>Signal never holds your funds</h2>
        <p>
          Signal is non-custodial. Your wallet (such as Phantom) holds your keys and funds; Signal does not hold your private
          keys and cannot move your funds without a transaction you approve in your own wallet.
        </p>
      </section>

      <section className="tax-box terms-section">
        <h2>You're responsible for your wallet and transactions</h2>
        <p>
          You're responsible for keeping your wallet and recovery phrase safe, checking every transaction before you approve it,
          and understanding any tax or legal obligations that apply to you. Confirmed blockchain transactions generally cannot be
          reversed by Signal.
        </p>
      </section>

      <section className="tax-box terms-section">
        <h2>Extra notices for some regions</h2>
        <p>If you're in one of these places, you'll be asked to read and acknowledge its notice as well:</p>
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
          against the US Treasury's OFAC sanctions list (its published digital currency addresses). A wallet that appears on a sanctions list can't launch or trade on
          Signal. If the check can't be completed, launching and trading pause until it can.
        </p>
      </section>
    </div>
  );
}
