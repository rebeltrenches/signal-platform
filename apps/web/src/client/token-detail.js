// Token detail page tab switching — real interaction, no fake data behind
// it. Each panel already renders its own honest state (empty-state or
// SourcedRow "Unavailable") server-side; this just shows/hides them.
(function () {
  const tabs = document.querySelectorAll('#token-tabs [role="tab"]');
  if (tabs.length === 0) return;

  function activateTab(target) {
    tabs.forEach((t) => t.setAttribute('aria-selected', t.getAttribute('data-tab') === target ? 'true' : 'false'));
    document.querySelectorAll('#token-panels [data-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-panel') !== target;
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.getAttribute('data-tab')));
  });

  // A link from elsewhere (Dashboard's "Chat" link on a real launch) can
  // land directly on this tab via #community, rather than requiring an
  // extra manual click after arriving. Case-insensitive: URL fragments
  // are conventionally lowercase ("#community"), while this page's own
  // tab labels are capitalized ("Community") — matching exactly would
  // require every link to remember that inconsistency.
  const hashTarget = window.location.hash.replace('#', '').toLowerCase();
  const matchingTab = Array.from(tabs).find((t) => (t.getAttribute('data-tab') || '').toLowerCase() === hashTarget);
  if (matchingTab) {
    activateTab(matchingTab.getAttribute('data-tab'));
  }

  const params = new URLSearchParams(window.location.search);
  const pathAddress = window.location.pathname.split('/').filter(Boolean).pop() || '';
  const tokenMint = params.get('mint') || pathAddress;
  const tokenName = params.get('name') || '';
  const tokenSymbol = params.get('symbol') || '';
  const tokenChain = params.get('chain') || 'solana';
  const sourceMarket = params.get('source') || '';
  const solanaMintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  if (tokenMint && tokenMint !== 'example') {
    const name = document.getElementById('token-name');
    const address = document.getElementById('token-address');
    const chain = document.getElementById('token-chain');
    if (name) name.textContent = tokenName ? `${tokenName}${tokenSymbol ? ` (${tokenSymbol})` : ''}` : 'Solana token';
    if (address) address.textContent = tokenMint;
    if (chain) chain.textContent = tokenChain === 'solana' ? 'Solana' : tokenChain;
  }
  if (/^https:\/\//.test(sourceMarket)) {
    const link = document.getElementById('token-source-market');
    if (link) { link.href = sourceMarket; link.hidden = false; }
  }

  function solToLamports(value) {
    if (!/^\d+(\.\d{0,9})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    const lamports = BigInt(whole) * 1_000_000_000n + BigInt((fraction + '000000000').slice(0, 9));
    return lamports > 0n ? lamports : null;
  }
  function formatBaseUnits(value, decimals) {
    if (!/^\d+$/.test(String(value)) || !Number.isInteger(decimals)) return `${value} base units`;
    const padded = String(value).padStart(decimals + 1, '0');
    const whole = padded.slice(0, -decimals) || '0';
    const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, '') : '';
    return fraction ? `${whole}.${fraction}` : whole;
  }
  function setQuoteField(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  document.querySelectorAll('[data-trade-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById('trade-amount');
      if (input) input.value = button.getAttribute('data-trade-preset') || '';
    });
  });
  const quoteButton = document.getElementById('trade-quote-btn');
  if (quoteButton) {
    fetch('/api/solana/swap/quote')
      .then((response) => response.ok ? response.json() : null)
      .then((capability) => {
        if (!capability?.quoteEnabled) {
          quoteButton.disabled = true;
          quoteButton.textContent = 'Live route preview coming online';
          const status = document.getElementById('trade-status');
          if (status) status.textContent = 'The quote service is not configured yet. Use the source-market link in the meantime.';
        }
      })
      .catch(() => { /* POST still fails closed if capability detection is unavailable. */ });
  }
  if (quoteButton) quoteButton.addEventListener('click', async () => {
    const status = document.getElementById('trade-status');
    const amountInput = document.getElementById('trade-amount');
    const lamports = solToLamports(amountInput?.value.trim() || '');
    if (tokenChain !== 'solana' || !solanaMintPattern.test(tokenMint)) {
      if (status) status.textContent = 'Live route previews currently support valid Solana token mints only.';
      return;
    }
    if (!lamports) {
      if (status) status.textContent = 'Enter a valid SOL amount with no more than 9 decimal places.';
      return;
    }
    quoteButton.disabled = true;
    quoteButton.textContent = 'Loading live route…';
    if (status) status.textContent = 'Requesting a current market route. No wallet action will occur.';
    try {
      const response = await fetch('/api/solana/swap/quote', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ side: 'buy', tokenMint, amount: lamports.toString() }),
      });
      const quote = await response.json();
      if (!response.ok) throw new Error(quote.message || 'Live route unavailable.');
      setQuoteField('trade-router', `${quote.router} · ${quote.routeMode}`);
      setQuoteField('trade-routed', `${formatBaseUnits(quote.routedAmount, 9)} SOL`);
      setQuoteField('trade-output', `${formatBaseUnits(quote.expectedOutput, quote.tokenDecimals)}${tokenSymbol ? ` ${tokenSymbol}` : ''}`);
      setQuoteField('trade-impact', quote.priceImpactPct == null ? 'Provided at execution review' : `${quote.priceImpactPct}%`);
      setQuoteField('trade-signal-fee', `${formatBaseUnits(quote.signalFeeLamports, 9)} SOL (1%)`);
      if (status) status.textContent = 'Live preview received. No transaction was created; Signal requests a fresh route when you choose to trade.';
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Live route unavailable.';
    } finally {
      quoteButton.disabled = false;
      quoteButton.textContent = 'Refresh live route';
    }
  });

  // Real "Launched on Signal" check — replaces the static placeholder
  // with an actual lookup against the real registration endpoint
  // (Stage 2). Deliberately does NOT add any RPC/indexer capability:
  // this only answers "is there a real Token row for this address,"
  // exactly what packages/types' own TokenIdentity.launchedOnSignal
  // comment describes as the correct way to answer this ("a fact to
  // fetch — check the Token table"), nothing more. Chain defaults to
  // 'solana', matching this page's own existing static "Solana" badge
  // — real multi-chain detail pages are a separate concern this fix
  // doesn't attempt to solve.
  (function checkLaunchedOnSignal() {
    const badge = document.getElementById('signal-launch-badge');
    if (!badge) return;
    const address = tokenMint;
    if (!address) return;

    function apiPath(path) {
      const base = window.SIGNAL_API_BASE_URL;
      return base ? `${base.replace(/\/$/, '')}${path}` : path;
    }

    fetch(apiPath(`/api/v1/tokens/solana/${encodeURIComponent(address)}`))
      .then((res) => {
        // Registration is a weaker fact than verified bonding-curve provenance.
        // Never overwrite the on-chain curve result if that module already set it.
        if (badge.dataset.signalCurve === 'true') return;
        badge.textContent = res.ok ? 'Registered on Signal: Yes' : 'Registered on Signal: No';
      })
      .catch(() => {
        // Lookup failed (no backend reachable) — leave the honest
        // "Unavailable" text exactly as it was, never guess.
      });
  })();

  // Market data, holders and logo from /api/solana/token-market: a DEX
  // pair when one trades, else the pump.fun bonding curve read on-chain.
  // Fetched once per page view (the server caches it); every value is set
  // as text, and anything the server couldn't read stays "Unavailable"
  // with its reason.
  (function loadMarketData() {
    const stats = document.getElementById('token-stats');
    if (!stats || tokenChain !== 'solana' || !solanaMintPattern.test(tokenMint)) return;

    function formatAmount(value) {
      const abs = Math.abs(value);
      if (abs === 0) return '0';
      if (abs >= 1e6) return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value);
      if (abs >= 1) return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
      // Small prices: significant digits, never scientific notation.
      return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format(value);
    }
    function formatted(point) {
      if (!point || typeof point.value !== 'number') return null;
      if (point.unit === 'USD') return `$${formatAmount(point.value)}`;
      if (point.unit === '%') return `${point.value >= 10 ? point.value.toFixed(1) : point.value.toFixed(2)}%`;
      return `${formatAmount(point.value)} ${point.unit}`;
    }
    function unavailableNode(reason) {
      const span = document.createElement('span');
      span.className = 'data-unavailable';
      span.textContent = 'Unavailable';
      span.title = reason || 'Not available';
      return span;
    }
    // `primary` and `secondary` are { value, unit } or { unavailable }.
    function setStat(name, primary, secondary) {
      const stat = stats.querySelector(`[data-stat="${name}"]`);
      if (!stat) return;
      const valueEl = stat.querySelector('.v');
      const main = formatted(primary);
      const extra = formatted(secondary);
      valueEl.replaceChildren(main ? main : unavailableNode(primary?.unavailable));
      stat.querySelectorAll('[data-stat-detail]').forEach((el) => el.remove());
      const detailText = main ? extra : primary?.unavailable;
      if (detailText) {
        const detail = document.createElement('div');
        detail.className = 'l';
        detail.setAttribute('data-stat-detail', '');
        detail.textContent = detailText;
        stat.appendChild(detail);
      }
    }
    function addDetail(name, text) {
      const stat = stats.querySelector(`[data-stat="${name}"]`);
      if (!stat || !text) return;
      const detail = document.createElement('div');
      detail.className = 'l';
      detail.setAttribute('data-stat-detail', '');
      detail.textContent = text;
      stat.appendChild(detail);
    }
    // What the market cap counts (e.g. leaving out pump.fun's Mayhem
    // wallet), the full-supply figure when that applies, and a badge.
    function showMarketCapBasis(body) {
      addDetail('marketCap', body.marketCapBasis);
      const full = formatted(body.marketCapFullSupply?.usd) || formatted(body.marketCapFullSupply?.sol);
      if (full) addDetail('marketCap', `Full on-chain supply: ${full}`);
      const chain = document.getElementById('token-chain');
      if (chain && body.mayhem?.detected && !document.getElementById('token-mayhem-badge')) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.id = 'token-mayhem-badge';
        badge.textContent = 'Mayhem Mode';
        badge.title = "pump.fun Mayhem Mode: an extra 1B tokens were minted into pump.fun's Mayhem wallet.";
        chain.after(badge);
      }
    }
    function showLogo(logo, label) {
      const slot = document.getElementById('token-logo-slot');
      if (!slot || !window.signalLogoImage) return;
      const element = window.signalLogoImage.logoElement({ url: logo?.url, label, size: 48, className: 'token-logo-lg' });
      element.id = 'token-logo-slot';
      if (!logo?.url && logo?.unavailable) element.title = `Logo unavailable: ${logo.unavailable}`;
      slot.replaceWith(element);
    }

    // The lookup's outcome is shared with other scripts on this page (e.g.
    // sell-link.js), so the page asks for market data only once.
    const announce = (detail) => {
      window.signalTokenMarket = detail;
      document.dispatchEvent(new CustomEvent('signal:token-market', { detail }));
    };
    fetch(`/api/solana/token-market?mint=${encodeURIComponent(tokenMint)}`)
      .then(async (response) => ({ ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) }))
      .then(({ ok, status, body }) => {
        announce({ ok, status, code: body.code || null });
        if (!ok) {
          const reason = body.error || 'Market data is temporarily unavailable.';
          ['price', 'marketCap', 'liquidity', 'holders'].forEach((name) => setStat(name, { unavailable: reason }));
          return;
        }
        setStat('price', body.price?.usd?.value !== undefined ? body.price.usd : body.price?.sol, body.price?.usd?.value !== undefined ? body.price?.sol : null);
        setStat('marketCap', body.marketCap?.usd?.value !== undefined ? body.marketCap.usd : body.marketCap?.sol, body.marketCap?.usd?.value !== undefined ? body.marketCap?.sol : null);
        showMarketCapBasis(body);
        setStat('liquidity', body.liquidity?.sol?.value !== undefined ? body.liquidity.sol : body.liquidity?.usd, body.liquidity?.sol?.value !== undefined ? body.liquidity?.usd : null);
        const holders = body.holders || {};
        setStat('holders', typeof holders.count === 'number'
          ? { value: holders.count, unit: holders.capped ? 'holders+' : 'holders' }
          : { unavailable: holders.unavailable });
        if (typeof holders.count === 'number') {
          stats.querySelector('[data-stat="holders"] .v').textContent =
            `${holders.count.toLocaleString()}${holders.capped ? '+' : ''}`;
        }
        const progress = stats.querySelector('[data-stat="curveProgress"]');
        if (progress && body.source === 'pump.fun bonding curve') {
          progress.hidden = false;
          stats.classList.add('stat-grid-5');
          setStat('curveProgress', body.curveProgress);
        }
        const sourceEl = document.getElementById('token-market-source');
        if (sourceEl && body.source) {
          sourceEl.textContent = `Market data source: ${body.source}${holders.source ? ` · Holders: ${holders.source}` : ''}`;
          sourceEl.hidden = false;
        }
        const nameEl = document.getElementById('token-name');
        if (nameEl && !tokenName && body.name) nameEl.textContent = body.symbol ? `${body.name} (${body.symbol})` : body.name;
        showLogo(body.logo, tokenSymbol || body.symbol || body.name);
      })
      .catch(() => {
        if (!window.signalTokenMarket) announce({ ok: false, status: 0, code: null });
        ['price', 'marketCap', 'liquidity', 'holders'].forEach((name) => setStat(name, { unavailable: 'Market data service unreachable.' }));
      });
  })();
})();
