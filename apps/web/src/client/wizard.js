// Create-token wizard: step navigation, per-step validation, and the
// chain-dependent Signal trading-fee display. Wallet/network execution lives in
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
  // inside ArDrive Turbo's free per-file limit. Creators may pick any image
  // up to MAX_LOGO_INPUT_BYTES; it is resized in the browser to fit
  // LOGO_MAX_DIMENSION and compressed under MAX_LOGO_BYTES before use.
  const MAX_NAME_BYTES = 32;
  const MAX_SYMBOL_BYTES = 10;
  const MAX_DESCRIPTION_CHARS = 500;
  const MAX_LOGO_BYTES = 100 * 1024;
  const MAX_LOGO_INPUT_BYTES = 5 * 1024 * 1024;
  const LOGO_MAX_DIMENSION = 512;
  const MAX_LOGO_INPUT_SIDE = 8192;
  const MAX_LOGO_INPUT_PIXELS = 32 * 1024 * 1024;
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

  const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  // Decodes to something drawable. An animated GIF or WebP yields its first frame.
  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close && bitmap.close() };
      } catch { /* fall through to <img> */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Fits the image inside LOGO_MAX_DIMENSION (never enlarging, never
  // stretching), centred on a square canvas with transparent padding, then
  // encodes it as WebP (JPEG where the browser can't) under MAX_LOGO_BYTES,
  // lowering the quality and then the size until it fits. Resolves to a
  // File, or null if the image can't be made small enough.
  async function resizeLogo(image) {
    const QUALITIES = [0.92, 0.85, 0.78, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
    let scale = Math.min(1, LOGO_MAX_DIMENSION / Math.max(image.width, image.height));
    for (let round = 0; round < 6; round++) {
      const w = Math.max(1, Math.round(image.width * scale));
      const h = Math.max(1, Math.round(image.height * scale));
      const side = Math.max(w, h);
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, side, side);
      ctx.drawImage(image.source, Math.round((side - w) / 2), Math.round((side - h) / 2), w, h);
      // Try WebP first; if this browser can't encode it, use JPEG.
      const webpProbe = await canvasToBlob(canvas, 'image/webp', QUALITIES[0]);
      const type = webpProbe && webpProbe.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
      let target = canvas;
      if (type === 'image/jpeg') {
        // JPEG has no transparency: put the picture on white.
        target = document.createElement('canvas');
        target.width = side;
        target.height = side;
        const flatCtx = target.getContext('2d');
        flatCtx.fillStyle = '#ffffff';
        flatCtx.fillRect(0, 0, side, side);
        flatCtx.drawImage(canvas, 0, 0);
      }
      for (const quality of QUALITIES) {
        const blob = type === 'image/webp' && quality === QUALITIES[0] ? webpProbe : await canvasToBlob(target, type, quality);
        if (blob && blob.type === type && blob.size <= MAX_LOGO_BYTES) {
          return new File([blob], type === 'image/webp' ? 'logo.webp' : 'logo.jpg', { type });
        }
      }
      scale *= 0.75;
    }
    return null;
  }

  // Reads the declared pixel size from the file header, so a small but
  // huge-when-decoded image is refused before the browser tries to decode it.
  function declaredSize(b, type) {
    const u16be = (i) => (b[i] << 8) | b[i + 1];
    const u32be = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const u16le = (i) => b[i] | (b[i + 1] << 8);
    const u24le = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
    if (type === 'image/png') return b.length >= 24 ? { w: u32be(16), h: u32be(20) } : null;
    if (type === 'image/gif') return b.length >= 10 ? { w: u16le(6), h: u16le(8) } : null;
    if (type === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xff) { i++; continue; }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: u16be(i + 7), h: u16be(i + 5) };
        i += 2 + u16be(i + 2);
      }
      return null;
    }
    if (type === 'image/webp' && b.length >= 30) {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === 'VP8X') return { w: u24le(24) + 1, h: u24le(27) + 1 };
      if (kind === 'VP8L') { const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 }; }
      if (kind === 'VP8 ') return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    }
    return null;
  }

  // Turns whatever the creator picked into the exact file that will be
  // stored: returns { file, animated } or { error }.
  async function prepareLogo(file) {
    if (file.size > MAX_LOGO_INPUT_BYTES) {
      return { error: `This image is ${(file.size / 1024 / 1024).toFixed(1)} MB; the maximum is 5 MB.` };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const head = bytes.subarray(0, 64);
    const type = logoTypeFromBytes(head);
    if (!type) return { error: 'The logo must be a PNG, JPEG, GIF or WebP image (SVG is not supported).' };
    const unreadable = { error: "We couldn't read this image. Try another PNG, JPEG, GIF or WebP file." };
    const size = declaredSize(bytes, type);
    if (!size || !size.w || !size.h) return unreadable;
    if (size.w > MAX_LOGO_INPUT_SIDE || size.h > MAX_LOGO_INPUT_SIDE || size.w * size.h > MAX_LOGO_INPUT_PIXELS) {
      return { error: `This image is ${size.w}×${size.h} pixels, which is too large to process here. Try one under ${MAX_LOGO_INPUT_SIDE}×${MAX_LOGO_INPUT_SIDE}.` };
    }
    let image;
    try {
      image = await decodeImage(file);
    } catch {
      return unreadable;
    }
    let resized;
    try {
      if (!image.width || !image.height) return unreadable;
      resized = await resizeLogo(image);
    } finally {
      image.release();
    }
    if (!resized) return { error: "We couldn't shrink this image under 100 KB. Try a simpler image." };
    // The same byte-level checks as before, now on the final image.
    const finalType = logoTypeFromBytes(new Uint8Array(await resized.slice(0, 12).arrayBuffer()));
    if (!finalType || resized.size > MAX_LOGO_BYTES) return { error: "We couldn't prepare this image. Try another one." };
    const animated = type === 'image/gif' || (type === 'image/webp' && new TextDecoder('latin1').decode(head).includes('ANIM'));
    return { file: resized, animated };
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
  let logoRun = 0; // a newer pick makes an older, slower one discard its result
  if (logoInput) logoInput.addEventListener('change', async (e) => {
    const run = ++logoRun;
    const file = e.target.files && e.target.files[0];
    const preview = document.getElementById('tk-logo-preview');
    const info = document.getElementById('tk-logo-info');
    state.logoFile = null;
    state.logoValid = false;
    // Hidden (and its old image released) until a new file passes the checks.
    if (preview) {
      preview.hidden = true;
      if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
      preview.removeAttribute('src');
    }
    if (info) info.textContent = '';
    showError('tk-logo-error', '');
    validateStep();
    if (!file) return;
    if (info) info.textContent = 'Preparing your logo…';
    const result = await prepareLogo(file);
    if (run !== logoRun) return;
    if (result.error) {
      if (info) info.textContent = '';
      showError('tk-logo-error', result.error);
    } else {
      state.logoFile = result.file;
      state.logoValid = true;
      if (preview) { preview.src = URL.createObjectURL(result.file); preview.hidden = false; }
      if (info) {
        info.textContent = `Resized to ${formatKb(result.file.size)} ${result.file.type === 'image/webp' ? 'WebP' : 'JPEG'} — this exact image is what gets stored on-chain.` +
          (result.animated ? ' Animated images become a still picture of the first frame.' : '');
      }
    }
    validateStep();
  });

  // ---- Step 2: configuration + chain-dependent fee display ----
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
        '<div class="tax-box tax-unavailable">Signal-routed trading fees don\u2019t apply on ' + cfg.displayName +
        ' yet \u2014 discovery is live, while creation and in-app trading remain planned (see /security).</div>';
    }
    // If Signal trading-fee routing IS supported, the server-rendered default
    // markup already shows the current 1% fee-to-platform-wallet SOL breakdown
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