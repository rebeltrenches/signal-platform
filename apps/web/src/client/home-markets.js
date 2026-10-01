(() => {
  const grid = document.getElementById('home-markets-grid');
  const status = document.getElementById('home-markets-status');
  const message = document.getElementById('home-markets-message');
  const provider = document.getElementById('home-markets-provider');
  if (!grid || !status || !message) return;
  let snapshot = null;
  let failed = false;
  let loading = false;
  const maxAge = (source) => ['CoinPaprika', 'CoinLore'].includes(source) ? 600000 : 300000;
  const usd = (price) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
    maximumFractionDigits: price < 1 ? 6 : price < 10 ? 4 : 2,
  }).format(price);

  function node(tag, className, content) {
    const el = document.createElement(tag);
    el.className = className;
    if (content !== undefined) el.textContent = content;
    return el;
  }
  function render() {
    const fragment = document.createDocumentFragment();
    snapshot.coins.forEach((coin) => {
      const card = node('li', 'home-market');
      const identity = node('div', 'home-market-identity');
      try {
        const url = new URL(coin.image);
        if (url.protocol === 'https:' && ['coin-images.coingecko.com', 'assets.coingecko.com', 'static.coinpaprika.com', 'www.coinlore.com'].includes(url.hostname)) {
          const logo = node('img', 'home-market-logo');
          logo.src = url.href; logo.alt = ''; logo.width = 26; logo.height = 26;
          logo.loading = 'lazy'; logo.referrerPolicy = 'no-referrer';
          logo.addEventListener('error', () => { logo.hidden = true; });
          identity.append(logo);
        }
      } catch { /* A missing logo never hides the coin or price. */ }
      const name = node('div', 'home-market-name');
      const fullName = node('strong', '', coin.name); fullName.title = coin.name;
      name.append(fullName, node('small', '', coin.symbol));
      identity.append(name, node('span', 'home-market-rank', `#${coin.rank}`));
      const price = node('strong', 'home-market-price', usd(coin.price));
      const change = node('span', 'home-market-change', coin.change24h === null ? '24h unavailable' : `${coin.change24h > 0 ? '+' : ''}${coin.change24h.toFixed(2)}% · 24h`);
      change.dataset.direction = coin.change24h === null || coin.change24h === 0 ? 'flat' : coin.change24h > 0 ? 'up' : 'down';
      card.append(identity, price, change);
      fragment.append(card);
    });
    grid.replaceChildren(fragment);
    if (provider) { provider.textContent = snapshot.source; provider.href = snapshot.source === 'CoinPaprika' ? 'https://coinpaprika.com/' : snapshot.source === 'CoinLore' ? 'https://www.coinlore.com/' : 'https://www.coingecko.com/'; }
    updateAge();
  }
  function updateAge() {
    if (!snapshot) return;
    const age = Date.now() - Date.parse(snapshot.updatedAt);
    if (age > maxAge(snapshot.source)) {
      grid.replaceChildren(); snapshot = null;
      message.hidden = false; message.textContent = 'Current prices are temporarily unavailable. Reconnecting automatically…';
      status.dataset.state = 'delayed'; status.textContent = 'Feed unavailable';
      return;
    }
    const delayed = failed || snapshot.delayed || age > (['CoinPaprika', 'CoinLore'].includes(snapshot.source) ? 360000 : 120000);
    status.dataset.state = delayed ? 'delayed' : 'fresh';
    const ago = age < 60000 ? 'just now' : `${Math.floor(age / 60000)}m ago`;
    status.textContent = delayed ? `Delayed · updated ${ago}` : `Updated ${ago}`;
    status.title = `Provider update: ${new Date(snapshot.updatedAt).toLocaleString()}`;
    message.hidden = true;
  }
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    try {
      const response = await fetch('/api/markets/top10', { cache: 'no-store', signal: AbortSignal.timeout(40000) });
      if (!response.ok) throw new Error('Market feed unavailable');
      const data = await response.json();
      if (data.currency !== 'USD' || !['CoinGecko', 'CoinPaprika', 'CoinLore'].includes(data.source) || !Array.isArray(data.coins) || data.coins.length !== 10 ||
          !Number.isFinite(Date.parse(data.updatedAt)) || Date.now() - Date.parse(data.updatedAt) > maxAge(data.source) ||
          Date.parse(data.updatedAt) - Date.now() > 60000 ||
          data.coins.some((coin) => typeof coin.name !== 'string' || typeof coin.symbol !== 'string' ||
            !Number.isFinite(coin.price) || coin.price <= 0 || (coin.change24h !== null && !Number.isFinite(coin.change24h)))) throw new Error('Invalid market feed');
      snapshot = data; failed = false; render();
    } catch {
      failed = true;
      if (snapshot) updateAge();
      else {
        status.textContent = 'Feed unavailable'; status.dataset.state = 'delayed';
        message.hidden = false; message.textContent = 'Current prices are temporarily unavailable. Reconnecting automatically…';
      }
    } finally { loading = false; grid.setAttribute('aria-busy', 'false'); }
  }
  refresh();
  setInterval(refresh, 60000);
  setInterval(updateAge, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateAge(); refresh(); } });
  window.addEventListener('online', refresh);
})();
