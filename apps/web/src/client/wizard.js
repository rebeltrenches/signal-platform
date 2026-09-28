// Create-token wizard: step navigation, per-step validation, and the
// chain-dependent creator-fee display. Wallet/network execution lives in
// dedicated client modules; this file only owns wizard state and validation. Reads CHAIN_CONFIGS from the embedded JSON script tag
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
  // SPL Token stores amounts (supply * 10^decimals) as a u64.
  const MAX_TOKEN_DECIMALS = 9;
  const U64_MAX = 18446744073709551615n;

  // No fallback: an empty field is an error, never an implied default,
  // because whatever passes here is what gets minted.
  function validateDecimals(raw) {
    const trimmed = String(raw ?? '').trim();
    if (trimmed.length === 0) return { valid: false, error: `Enter the number of decimals (0 to ${MAX_TOKEN_DECIMALS}).` };
    if (!/^[0-9]$/.test(trimmed)) {
      return { valid: false, error: `Decimals must be a whole number from 0 to ${MAX_TOKEN_DECIMALS}.` };
    }
    return { valid: true, error: null };
  }

  /** Returns { valid, error }. error is a short, user-facing string when
   *  invalid, null when valid. Never accepts empty, zero, negative,
   *  decimal, or non-numeric input — only a bare positive integer with
   *  no sign, no decimal point, no exponent, no leading/trailing junk,
   *  and never more than fits in a u64 at the chosen decimals. */
  function validateSupply(raw, decimalsRaw) {
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
    // The maximum depends on decimals; until decimals are valid, the
    // decimals field shows its own error and blocks the step instead.
    if (!validateDecimals(decimalsRaw).valid) return { valid: true, error: null };
    const decimals = Number(String(decimalsRaw).trim());
    const maxSupply = U64_MAX / 10n ** BigInt(decimals);
    if (BigInt(trimmed) > maxSupply) {
      return { valid: false, error: `Maximum supply with ${decimals} decimals is ${maxSupply.toLocaleString()}.` };
    }
    return { valid: true, error: null };
  }

  // Token metadata rules, mirrored from token-metadata.js (which is the
  // real gate, run again before anything is uploaded or signed). Name and
  // symbol limits are Metaplex's, in UTF-8 bytes; 100 KB keeps the logo
  // inside ArDrive Turbo's free per-file limit.
  const MAX_NAME_BYTES = 32;
  const MAX_SYMBOL_BYTES = 10;
  const MAX_DESCRIPTION_CHARS = 500;
  const MAX_LOGO_BYTES = 100 * 1024;
  const utf8 = new TextEncoder();
  const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

  function validateName(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return { valid: false, error: '' }; // empty: just keep Continue disabled
    if (CONTROL_CHARS.test(value)) return { valid: false, error: "The name can't contain control characters." };
    if (utf8.encode(value).length > MAX_NAME_BYTES) {
      return { valid: false, error: `At most ${MAX_NAME_BYTES} bytes (${MAX_NAME_BYTES} plain letters; accents and emoji use more).` };
    }
    return { valid: true, error: '' };
  }
  function validateSymbol(raw) {
    const value = String(raw ?? '').trim().toUpperCase();
    if (!value) return { valid: false, error: '' };
    if (/\s/.test(value) || CONTROL_CHARS.test(value)) return { valid: false, error: "The symbol can't contain spaces." };
    if (utf8.encode(value).length > MAX_SYMBOL_BYTES) return { valid: false, error: `At most ${MAX_SYMBOL_BYTES} bytes (${MAX_SYMBOL_BYTES} plain letters).` };
    return { valid: true, error: '' };
  }
  function validateDescription(raw) {
    return String(raw ?? '').trim().length > MAX_DESCRIPTION_CHARS
      ? { valid: false, error: `At most ${MAX_DESCRIPTION_CHARS} characters.` }
      : { valid: true, error: '' };
  }
  // Checks the file's own bytes (PNG, JPEG, GIF or WebP; never SVG).
  function logoTypeFromBytes(b) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    return null;
  }

  let current = 0;
  // decimals is read from the Decimals field below, never assumed.
  const state = { chain: null, name: '', symbol: '', description: '', logoFile: null, logoValid: false, supply: '', decimals: '' };
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
    if (current === 1) {
      ok = validateName(state.name).valid && validateSymbol(state.symbol).valid &&
        validateDescription(state.description).valid && state.logoValid;
    }
    if (current === 2) ok = validateSupply(state.supply, state.decimals).valid && validateDecimals(state.decimals).valid;
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
  const descInput = document.getElementById('tk-desc');
  const logoInput = document.getElementById('tk-logo');
  const showError = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  if (nameInput) nameInput.addEventListener('input', (e) => {
    state.name = e.target.value;
    showError('tk-name-error', validateName(state.name).error);
    validateStep();
  });
  if (symbolInput) symbolInput.addEventListener('input', (e) => {
    state.symbol = e.target.value;
    showError('tk-symbol-error', validateSymbol(state.symbol).error);
    validateStep();
  });
  if (descInput) descInput.addEventListener('input', (e) => {
    state.description = e.target.value;
    showError('tk-desc-error', validateDescription(state.description).error);
    validateStep();
  });
  if (logoInput) logoInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    const preview = document.getElementById('tk-logo-preview');
    state.logoFile = null;
    state.logoValid = false;
    // Hidden (and its old image released) until a new file passes the checks.
    if (preview) {
      preview.hidden = true;
      if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
      preview.removeAttribute('src');
    }
    let error = '';
    if (!file) {
      error = '';
    } else if (file.size > MAX_LOGO_BYTES) {
      error = `This image is ${(file.size / 1024).toFixed(1)} KB; the maximum is 100 KB.`;
    } else if (!logoTypeFromBytes(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) {
      error = 'The logo must be a PNG, JPEG, GIF or WebP image.';
    } else {
      state.logoFile = file;
      state.logoValid = true;
      if (preview) { preview.src = URL.createObjectURL(file); preview.hidden = false; }
    }
    showError('tk-logo-error', error);
    validateStep();
  });

  // ---- Step 2: configuration + chain-dependent tax display ----
  const supplyInput = document.getElementById('tk-supply');
  const supplyError = document.getElementById('tk-supply-error');
  const decimalsInput = document.getElementById('tk-decimals');
  const decimalsError = document.getElementById('tk-decimals-error');
  if (decimalsInput) state.decimals = decimalsInput.value;
  // Supply and decimals are checked together: the maximum supply depends
  // on decimals, so changing either one re-validates both.
  function showSupplyValidation() {
    const result = validateSupply(state.supply, state.decimals);
    if (supplyError) supplyError.textContent = result.valid ? '' : result.error;
    const decimalsResult = validateDecimals(state.decimals);
    if (decimalsError) decimalsError.textContent = decimalsResult.valid ? '' : decimalsResult.error;
    validateStep();
  }
  if (supplyInput) {
    supplyInput.addEventListener('input', (e) => {
      state.supply = e.target.value;
      showSupplyValidation();
    });
  }
  if (decimalsInput) {
    decimalsInput.addEventListener('input', (e) => {
      state.decimals = e.target.value;
      showSupplyValidation();
    });
  }

  function updateTaxDisplay() {
    const el = document.getElementById('tax-display');
    if (!el) return;
    const cfg = state.chain ? chainConfigs[state.chain] : null;
    if (cfg && cfg.taxSupported === false) {
      el.innerHTML =
        '<div class="tax-box tax-unavailable">Creator fee routing isn\u2019t available on ' + cfg.displayName +
        ' yet \u2014 discovery is live, while creation and in-app trading remain planned (see /security).</div>';
    }
    // If creator fee routing IS supported, the server-rendered default
    // markup already shows the current 100%-to-creator SOL breakdown
    // (see CreatePage.tsx's tax-box) — nothing to swap in here.
  }

  // ---- Review step population ----
  function populateReview() {
    const taxSupported = !(state.chain && chainConfigs[state.chain] && chainConfigs[state.chain].taxSupported === false);
    const dtc = embedded.defaultTaxConfig || { totalBps: 100 };
    const pct = (bps) => (bps / 100).toFixed(2) + '%';

    const map = {
      'rv-chain': state.chain ? (chainConfigs[state.chain] ? chainConfigs[state.chain].displayName : state.chain) : '\u2014',
      'rv-name': state.name.trim() || '\u2014',
      'rv-symbol': state.symbol.trim().toUpperCase() || '\u2014',
      'rv-description': state.description.trim() || 'None',
      'rv-supply': state.supply || '\u2014',
      'rv-decimals': state.decimals || '\u2014',
      'rv-creator-fee': taxSupported ? pct(dtc.totalBps) : 'Not available on this chain',
      'rv-holder-reward': 'None',
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
    const logoPreview = document.getElementById('tk-logo-preview');
    const reviewLogo = document.getElementById('rv-logo');
    if (reviewLogo) {
      const hasLogo = !!(state.logoValid && logoPreview && logoPreview.src);
      if (hasLogo) reviewLogo.src = logoPreview.src;
      else reviewLogo.removeAttribute('src');
      reviewLogo.hidden = !hasLogo;
    }

    // Only Solana has a real deployment adapter (Stage 6). Base/BNB show
    // an honest "not available" notice instead of a flow with nowhere
    // real to send its transaction (Stage 7, Coming Soon).
    const isSolana = state.chain === 'solana';
    const mainnetPanel = document.getElementById('launch-mainnet-panel');
    const evmNotice = document.getElementById('launch-evm-notice');
    if (mainnetPanel) mainnetPanel.hidden = !isSolana;
    if (evmNotice) evmNotice.hidden = isSolana;
    // Solana launch wiring is handled by launch-solana.js. Base/BNB remain unavailable.
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
