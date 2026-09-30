// Token page: "Sell on Jupiter ↗". Sells happen on Jupiter, an external
// exchange, with this token as the input and SOL as the output. Signal
// builds no sell transaction and charges no fee on sells.
//
// Shown only for a Solana token mint: the address (from the URL, like
// token-detail.js) must look like one, and the page's token-market lookup
// (made once by token-detail.js, shared as "signal:token-market") must not
// answer MINT_NOT_FOUND, which it does for wallets, programs and token
// accounts. If that lookup fails or never answers, the link is still shown:
// it's only a link to an exchange, and Jupiter checks the token itself.
(function () {
  const link = document.getElementById('trade-sell-link');
  const note = document.getElementById('trade-sell-note');
  if (!link) return;
  const params = new URLSearchParams(window.location.search);
  const chain = (params.get('chain') || 'solana').toLowerCase();
  const mint = params.get('mint') || window.location.pathname.split('/').filter(Boolean).pop() || '';
  if (chain !== 'solana' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;

  const show = () => {
    link.href = 'https://jup.ag/swap/' + encodeURIComponent(mint) + '-SOL';
    link.hidden = false;
    if (note) note.hidden = false;
  };
  let decided = false;
  const decide = (market) => {
    if (decided) return;
    decided = true;
    if (market && market.status === 404 && market.code === 'MINT_NOT_FOUND') return; // not a token mint
    show();
  };
  if (window.signalTokenMarket) decide(window.signalTokenMarket);
  else {
    document.addEventListener('signal:token-market', (event) => decide(event.detail), { once: true });
    setTimeout(() => decide(null), 10_000);
  }
})();
