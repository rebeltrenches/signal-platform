// Live cross-chain discovery. Signal registrations remain first-party data;
// external markets come from DEX Screener, and new Pump.fun launches arrive
// from PumpPortal's documented realtime websocket.
(function () {
  const tabs = document.querySelectorAll('#explore-tabs [role="tab"]');
  if (tabs.length === 0) return;

  const state = {
    activeTab: 'new', query: '', chains: new Set(), origin: 'all',
    sort: 'newest', signal: [], external: [],
  };
  let searchRequestId = 0;
  const chainMap = { solana: 'solana', base: 'base', bsc: 'bnb' };
  const chainLabel = { solana: 'Solana', base: 'Base', bnb: 'BNB Chain' };
  // One spelling per chain on this page, whatever the source sends: the
  // Signal API returns "SOLANA", DEX Screener "bsc". Every chain value is
  // normalized on the way in and in every comparison.
  function normalizeChain(value) {
    const chain = String(value ?? '').trim().toLowerCase();
    return chainMap[chain] || chain;
  }
  // A token from the Signal API (/api/v1/tokens or /api/v1/search).
  function signalTokenItem(token) {
    return {
      name: token.name, symbol: token.symbol, address: token.address, chain: normalizeChain(token.chain),
      createdAt: Date.parse(token.createdAt), origin: 'Signal', market: 'Signal',
      url: `/token/${encodeURIComponent(token.address)}`,
    };
  }

  function apiPath(path) {
    const base = window.SIGNAL_API_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}${path}` : path;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Logos come from third parties: drawn only by logo-image.js (https only,
  // <img> via DOM properties, placeholder on failure).
  function logoElement(item) {
    return window.signalLogoImage.logoElement({ url: item.logo, label: item.symbol || item.name, size: 32 });
  }
  // Signal launches' logos live in their on-chain metadata; the reader
  // (and the wallet library it needs) is only loaded when there are some.
  let signalLogoReader = null;
  function resolveSignalLogos(items) {
    const solana = items.filter((item) => normalizeChain(item.chain) === 'solana' && !item.logo && item.address);
    if (!solana.length) return;
    signalLogoReader = signalLogoReader || import('/client/token-logo.js').catch(() => null);
    signalLogoReader.then((reader) => {
      if (!reader) return;
      solana.forEach((item) => {
        reader.signalLogoUrl(item.address).then((logo) => {
          if (!logo) return;
          state.signal.forEach((entry) => {
            if (normalizeChain(entry.chain) === normalizeChain(item.chain) && entry.address === item.address) entry.logo = logo;
          });
          render();
        });
      });
    });
  }
  function shortAddress(address) {
    const value = String(address || '');
    return value.length > 12 ? `${value.slice(0, 5)}…${value.slice(-5)}` : value;
  }
  function compactUsd(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
    }).format(amount);
  }
  function relativeTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) return 'Live';
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
  function dedupe(items) {
    const byKey = new Map();
    items.forEach((item) => {
      const key = `${normalizeChain(item.chain)}:${String(item.address).toLowerCase()}`;
      const current = byKey.get(key);
      if (!current || (item.createdAt || 0) >= (current.createdAt || 0)) {
        byKey.set(key, { ...current, ...item });
      }
    });
    return [...byKey.values()];
  }
  function visibleItems() {
    let items = state.origin === 'signal' ? state.signal
      : state.origin === 'external' ? state.external : [...state.signal, ...state.external];
    if (state.chains.size) items = items.filter((item) => state.chains.has(normalizeChain(item.chain)));
    if (state.query) {
      const needle = state.query.toLowerCase();
      items = items.filter((item) => [item.name, item.symbol, item.address]
        .some((value) => String(value || '').toLowerCase().includes(needle)));
    }
    if (state.activeTab === 'momentum') items = items.filter((item) => Number(item.volume24h) > 0);
    if (state.activeTab === 'graduating') items = items.filter((item) => item.market === 'pump.fun bonding curve');
    return items.sort((a, b) => {
      if (state.sort === 'volume') return (Number(b.volume24h) || 0) - (Number(a.volume24h) || 0);
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
  }
  function card(item, index) {
    const metrics = [];
    const volume = compactUsd(item.volume24h);
    const liquidity = compactUsd(item.liquidityUsd);
    const marketCap = item.marketCapUsd ? compactUsd(item.marketCapUsd)
      : item.marketCapSol ? `${Number(item.marketCapSol).toFixed(1)} SOL MC` : null;
    if (volume) metrics.push(`24h vol ${volume}`);
    if (liquidity) metrics.push(`Liquidity ${liquidity}`);
    if (marketCap) metrics.push(marketCap);
    const sourceUrl = /^https:\/\//.test(item.url || '') ? item.url : null;
    const chain = normalizeChain(item.chain);
    const workspaceUrl = chain === 'solana' &&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item.address || '')
      ? `/token/${encodeURIComponent(item.address)}?${new URLSearchParams({
        chain: 'solana', name: item.name || '', symbol: item.symbol || '',
        market: item.market || '', source: sourceUrl || '',
      })}`
      : null;
    const safeUrl = workspaceUrl || (/^\/token\//.test(item.url || '') ? item.url : sourceUrl);
    const identity = `${escapeHtml(item.name || 'New token')} (${escapeHtml(item.symbol || '—')})`;
    const open = safeUrl
      ? `a href="${escapeHtml(safeUrl)}" ${safeUrl.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}`
      : 'div';
    const destination = workspaceUrl
      ? '<br><span style="color:var(--brand);">Open Signal workspace</span>'
      : safeUrl?.startsWith('http') ? '<br><span style="color:var(--ink-faint);">Opens external market</span>' : '';
    return `
      <${open} class="review-row" style="text-decoration:none;color:inherit;align-items:center;gap:12px;">
        <span class="k" style="min-width:0;display:flex;align-items:center;gap:10px;">
          <span data-logo-index="${index}"></span>
          <span style="min-width:0;">
            <strong>${identity}</strong><br>
            <span style="font-family:monospace;font-size:.72rem;color:var(--ink-faint);">${escapeHtml(shortAddress(item.address))}</span>
          </span>
        </span>
        <span class="v" style="text-align:right;font-size:.76rem;line-height:1.5;">
          ${escapeHtml(chainLabel[chain] || chain)} ·${escapeHtml(item.market || item.origin)} · ${escapeHtml(relativeTime(item.createdAt))}
          ${metrics.length ? `<br>${escapeHtml(metrics.join(' · '))}` : ''}
          ${destination}
        </span>
      </${safeUrl ? 'a' : 'div'}>`;
  }
  function render() {
    const list = document.getElementById(`explore-${state.activeTab}-list`);
    const empty = document.getElementById(`explore-${state.activeTab}-empty`);
    if (!list || !empty) return;
    const items = visibleItems().slice(0, 60);
    list.innerHTML = items.map(card).join('');
    // Logos are added as elements, never through the HTML above.
    list.querySelectorAll('[data-logo-index]').forEach((slot) => {
      slot.replaceWith(logoElement(items[Number(slot.getAttribute('data-logo-index'))]));
    });
    empty.hidden = items.length > 0;
    list.hidden = items.length === 0;
  }
  function setFeedStatus(message) {
    const status = document.getElementById('explore-live-status');
    if (status) status.textContent = message;
  }
  async function loadSignalTokens() {
    try {
      const response = await fetch(apiPath('/api/v1/tokens?limit=50'));
      if (!response.ok) return;
      const body = await response.json();
      state.signal = (body.tokens || []).map(signalTokenItem);
      render();
      resolveSignalLogos(state.signal);
    } catch { /* External feeds can still populate discovery. */ }
  }
  async function loadDexScreener() {
    try {
      const profilesResponse = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
      if (!profilesResponse.ok) throw new Error('DEX Screener profiles unavailable');
      const profiles = await profilesResponse.json();
      const supported = (Array.isArray(profiles) ? profiles : [])
        .filter((profile) => chainMap[String(profile.chainId ?? '').toLowerCase()]);
      const groups = new Map();
      supported.forEach((profile) => {
        if (!groups.has(profile.chainId)) groups.set(profile.chainId, []);
        groups.get(profile.chainId).push(profile.tokenAddress);
      });
      const requests = [...groups.entries()].flatMap(([chainId, addresses]) =>
        Array.from({ length: Math.ceil(addresses.length / 30) }, (_, index) =>
          addresses.slice(index * 30, index * 30 + 30)).map(async (batch) => {
            const joined = batch.map(encodeURIComponent).join(',');
            const response = await fetch(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chainId)}/${joined}`);
            return response.ok ? response.json() : [];
          }));
      const markets = (await Promise.all(requests)).flat();
      const external = markets.map(marketFromPair).filter((item) => item.address && item.chain);
      state.external = dedupe([...state.external, ...external]);
      setFeedStatus('Live: Pump.fun · Solana · Base · BNB Chain');
      render();
    } catch {
      setFeedStatus('Pump.fun live · cross-chain feed reconnecting');
    }
  }

  function marketFromPair(pair) {
    return {
      name: pair.baseToken?.name,
      symbol: pair.baseToken?.symbol,
      address: pair.baseToken?.address,
      // Only supported chains (chainMap keys); others are filtered out.
      chain: chainMap[String(pair.chainId ?? '').toLowerCase()],
      createdAt: pair.pairCreatedAt,
      origin: 'External',
      market: pair.dexId || 'DEX',
      volume24h: pair.volume?.h24,
      liquidityUsd: pair.liquidity?.usd,
      marketCapUsd: pair.marketCap || pair.fdv,
      url: pair.url,
      logo: pair.info?.imageUrl,
    };
  }

  async function searchAllSources(query) {
    const requestId = ++searchRequestId;
    if (query.length < 2) {
      setFeedStatus('Live: Pump.fun · Solana · Base · BNB Chain');
      return;
    }
    setFeedStatus(`Searching all supported chains for “${query}”…`);
    try {
      const requests = [
        fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`),
        fetch(apiPath(`/api/v1/search?q=${encodeURIComponent(query)}`)),
      ];

      // Contract-address searches also query the exact-address endpoints.
      // This catches tokens whose name/symbol ranking is too low to appear in
      // the general search results.
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)) {
        requests.push(fetch(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(query)}`));
      } else if (/^0x[a-fA-F0-9]{40}$/.test(query)) {
        requests.push(fetch(`https://api.dexscreener.com/tokens/v1/base/${encodeURIComponent(query)}`));
        requests.push(fetch(`https://api.dexscreener.com/tokens/v1/bsc/${encodeURIComponent(query)}`));
      }

      const responses = await Promise.allSettled(requests);
      if (requestId !== searchRequestId) return;

      const dexPairs = [];
      let signalTokens = [];
      for (let index = 0; index < responses.length; index += 1) {
        const result = responses[index];
        if (result.status !== 'fulfilled' || !result.value.ok) continue;
        const body = await result.value.json();
        if (index === 0) dexPairs.push(...(body.pairs || []));
        else if (index === 1) signalTokens = body.tokens || [];
        else dexPairs.push(...(Array.isArray(body) ? body : body.pairs || []));
      }
      if (requestId !== searchRequestId) return;

      state.external = dedupe([
        ...state.external,
        ...dexPairs.map(marketFromPair).filter((item) => item.address && item.chain),
      ]);
      state.signal = dedupe([
        ...state.signal,
        ...signalTokens.map(signalTokenItem),
      ]);
      setFeedStatus(`Search complete · ${dexPairs.length + signalTokens.length} market matches received`);
      render();
      resolveSignalLogos(state.signal);
    } catch {
      if (requestId === searchRequestId) {
        setFeedStatus('Search service is temporarily unavailable');
        render();
      }
    }
  }
  function connectPumpFeed() {
    const socket = new WebSocket('wss://pumpportal.fun/api/data');
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ method: 'subscribeNewToken' }));
      setFeedStatus('Live: Pump.fun · Solana · Base · BNB Chain');
    });
    socket.addEventListener('message', (event) => {
      try {
        const token = JSON.parse(event.data);
        if (!token.mint || token.txType !== 'create') return;
        state.external = dedupe([{
          name: token.name, symbol: token.symbol, address: token.mint, chain: 'solana',
          createdAt: Date.now(), origin: 'External', market: 'pump.fun bonding curve',
          marketCapSol: token.marketCapSol,
          url: `https://pump.fun/coin/${encodeURIComponent(token.mint)}`,
        }, ...state.external]).slice(0, 150);
        render();
      } catch { /* Ignore malformed third-party messages. */ }
    });
    socket.addEventListener('close', () => {
      setFeedStatus('Live feed reconnecting…');
      setTimeout(connectPumpFeed, 3000);
    });
    socket.addEventListener('error', () => socket.close());
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((item) => item.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    state.activeTab = tab.getAttribute('data-tab');
    document.querySelectorAll('#explore-panels [data-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-panel') !== state.activeTab;
    });
    render();
  }));
  document.querySelectorAll('.chip[data-filter-chain]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const chain = normalizeChain(chip.getAttribute('data-filter-chain'));
      if (state.chains.has(chain)) state.chains.delete(chain); else state.chains.add(chain);
      chip.setAttribute('aria-pressed', String(state.chains.has(chain)));
      render();
    });
  });
  document.querySelectorAll('.chip[data-sort]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.sort = chip.getAttribute('data-sort');
      document.querySelectorAll('.chip[data-sort]').forEach((item) =>
        item.setAttribute('aria-pressed', String(item === chip)));
      render();
    });
  });
  document.querySelectorAll('.chip[data-origin]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.origin = chip.getAttribute('data-origin');
      document.querySelectorAll('.chip[data-origin]').forEach((item) =>
        item.setAttribute('aria-pressed', String(item === chip)));
      render();
    });
  });
  const searchInput = document.getElementById('exploreSearchInput');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (event) => {
      state.query = event.target.value.trim();
      render();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => searchAllSources(state.query), 350);
    });
  }

  loadSignalTokens();
  loadDexScreener();
  connectPumpFeed();
  setInterval(loadDexScreener, 60000);
})();
