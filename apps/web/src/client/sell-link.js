// Token page: "Sell on Jupiter ↗". Sells happen on Jupiter, an external
// exchange, with this token as the input and SOL as the output. Signal
// builds no sell transaction and charges no fee on sells. The link is only
// shown for a valid Solana mint (taken from the URL, like token-detail.js).
(function () {
  const link = document.getElementById('trade-sell-link');
  const note = document.getElementById('trade-sell-note');
  if (!link) return;
  const params = new URLSearchParams(window.location.search);
  const chain = (params.get('chain') || 'solana').toLowerCase();
  const mint = params.get('mint') || window.location.pathname.split('/').filter(Boolean).pop() || '';
  if (chain !== 'solana' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;
  link.href = 'https://jup.ag/swap/' + encodeURIComponent(mint) + '-SOL';
  link.hidden = false;
  if (note) note.hidden = false;
})();
