// Create-token wizard: step navigation, per-step validation, and the
// chain-dependent tax display. All client-side state only — nothing here
// calls an API or a chain, since none of that exists to call yet
// (Stage 5/6/7). Reads CHAIN_CONFIGS from the embedded JSON script tag
// the server rendered, so this never hard-codes chain facts twice.
(function () {
  const steps = Array.from(document.querySelectorAll('.wizard-step'));
  if (steps.length === 0) return;

  const embeddedEl = document.getElementById('embedded-data');
  const embedded = embeddedEl ? JSON.parse(embeddedEl.textContent || '{}') : {};
  const chainConfigs = embedded.chainConfigs || {};

  // FRONTEND validation only — immediate feedback while typing. This is
  // NOT the real gate: launch-solana.js implements this exact same check
  // again, independently and self-contained (not depending on this
  // function or this file having run at all), immediately before it
  // would cost any real SOL. Two separate implementations, deliberately
  // — not one shared function two files trust — so neither file's
  // correctness depends on the other one loading, running, or agreeing.
  const MINIMUM_TOKEN_SUPPLY = 100_000_000;

  /** Returns { valid, error }. error is a short, user-facing string when
   *  invalid, null when valid. Never accepts empty, zero, negative,
   *  decimal, or non-numeric input — only a bare positive integer with
   *  no sign, no decimal point, no exponent, no leading/trailing junk. */
  function validateSupply(raw) {
    const trimmed = (raw || '').trim();
    if (trimmed.length === 0) return { valid: false, error: 'Enter a total supply.' };
    if (!/^[0-9]+$/.test(trimmed)) {
      return { valid: false, error: 'Supply must be a whole number — no decimals, commas, or signs.' };
    }
    // Safe to compare as Number here only because MINIMUM_TOKEN_SUPPLY
    // and any realistic supply are both well under Number.MAX_SAFE_INTEGER
    // for the purpose of a >= comparison; the actual mint transaction
    // uses BigInt throughout (launch-solana.js), never this comparison.
    const asNumber = Number(trimmed);
    if (asNumber === 0) return { valid: false, error: 'Supply cannot be zero.' };
    if (asNumber < MINIMUM_TOKEN_SUPPLY) {
      return { valid: false, error: `Minimum supply is ${MINIMUM_TOKEN_SUPPLY.toLocaleString()}.` };
    }
    return { valid: true, error: null };
  }

  let current = 0;
  const state = { chain: null, name: '', symbol: '', supply: '', decimals: '6' };
  // Exposed so launch-solana.js can read the wizard's data without this
  // file needing to know anything about wallets or transactions —
  // Stage 6 keeps the wizard's job (collect + validate input) separate
  // from the launch flow's job (build + sign + submit).
  window.launchpadWizard = state;

  function segs() {
    return Array.from(document.querySelectorAll('#stepper .seg'));
  }

  function render() {
    steps.forEach((s, i) => {
      s.hidden = i !== current;
      if (i === current) {
        // Re-trigger even if this step was visible before (Back then
        // Next again should still settle in, not just appear once) —
        // same restart trick as the Explore tab fade.
        s.classList.remove('panel-enter');
        void s.offsetWidth;
        s.classList.add('panel-enter');
      }
    });
    segs().forEach((seg, i) => {
      seg.classList.toggle('done', i < current);
      seg.classList.toggle('active', i === current);
    });
  }

  function validateStep() {
    const nextBtn = steps[current].querySelector('[data-action="next"]');
    if (!nextBtn) return;
    let ok = true;
    if (current === 0) ok = !!state.chain;
    if (current === 1) ok = state.name.trim().length > 0 && state.symbol.trim().length > 0;
    if (current === 2) ok = validateSupply(state.supply).valid;
    nextBtn.disabled = !ok;
  }

  // ---- Step 0: chain selection ----
  document.querySelectorAll('#chain-grid .chain-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#chain-grid .chain-option').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      state.chain = btn.getAttribute('data-chain');
      validateStep();
    });
  });

  // ---- Step 1: token info ----
  const nameInput = document.getElementById('tk-name');
  const symbolInput = document.getElementById('tk-symbol');
  if (nameInput) nameInput.addEventListener('input', (e) => { state.name = e.target.value; validateStep(); });
  if (symbolInput) symbolInput.addEventListener('input', (e) => { state.symbol = e.target.value; validateStep(); });

  // ---- Step 2: configuration + chain-dependent tax display ----
  const supplyInput = document.getElementById('tk-supply');
  const supplyError = document.getElementById('tk-supply-error');
  const decimalsInput = document.getElementById('tk-decimals');
  if (supplyInput) {
    supplyInput.addEventListener('input', (e) => {
      state.supply = e.target.value;
      const result = validateSupply(state.supply);
      if (supplyError) supplyError.textContent = result.valid ? '' : result.error;
      validateStep();
    });
  }
  if (decimalsInput) decimalsInput.addEventListener('input', (e) => { state.decimals = e.target.value; });

  function updateTaxDisplay() {
    const el = document.getElementById('tax-display');
    if (!el) return;
    const cfg = state.chain ? chainConfigs[state.chain] : null;
    if (cfg && cfg.taxSupported === false) {
      el.innerHTML =
        '<div class="tax-box tax-unavailable">The Signal Fee isn\u2019t available on ' + cfg.displayName +
        ' yet \u2014 trading-only until a custom contract exists and is audited (see /security).</div>';
    }
    // If the Signal Fee IS supported, the server-rendered default
    // markup already shows the real 100%-to-platform-wallet breakdown
    // (see CreatePage.tsx's tax-box) — nothing to swap in here.
  }

  // ---- Review step population ----
  function populateReview() {
    const taxSupported = !(state.chain && chainConfigs[state.chain] && chainConfigs[state.chain].taxSupported === false);
    const dtc = embedded.defaultTaxConfig || { totalBps: 100 };
    const pct = (bps) => (bps / 100).toFixed(2) + '%';

    const map = {
      'rv-chain': state.chain ? (chainConfigs[state.chain] ? chainConfigs[state.chain].displayName : state.chain) : '\u2014',
      'rv-name': state.name || '\u2014',
      'rv-symbol': state.symbol || '\u2014',
      'rv-supply': state.supply || '\u2014',
      'rv-decimals': state.decimals || '\u2014',
      'rv-creator-fee': taxSupported ? pct(dtc.totalBps) : 'Not available on this chain',
      'rv-platform-fee': taxSupported ? pct(dtc.totalBps) + ' \u2192 Signal platform wallet (100%)' : '\u2014',
      'rv-holder-reward': 'None',
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });

    // Only Solana has a real deployment adapter (Stage 6). Base/BNB show
    // an honest "not available" notice instead of a flow with nowhere
    // real to send its transaction (Stage 7, Coming Soon).
    const isSolana = state.chain === 'solana';
    const mainnetPanel = document.getElementById('launch-mainnet-panel');
    const evmNotice = document.getElementById('launch-evm-notice');
    if (mainnetPanel) mainnetPanel.hidden = !isSolana;
    if (evmNotice) evmNotice.hidden = isSolana;
    // No launch wiring yet, on any chain. The network target itself is
    // decided (Solana Mainnet, eventually; devnet permanently excluded)
    // but implementation is not yet approved to run — see the review
    // step's own empty-state note and docs/ROADMAP.md Stage 6.
  }

  // ---- Navigation ----
  document.querySelectorAll('[data-action="next"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      current = Math.min(current + 1, steps.length - 1);
      if (current === 2) updateTaxDisplay(); // arriving at the config step, not leaving it
      if (current === 3) populateReview();
      render();
    });
  });
  document.querySelectorAll('[data-action="back"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      current = Math.max(current - 1, 0);
      render();
    });
  });

  render();
  validateStep();
})();
