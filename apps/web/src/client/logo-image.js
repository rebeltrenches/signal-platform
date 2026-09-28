// One set of rules for showing a token logo (Explore, token workspace).
// Logos come from third parties (DEX Screener, token metadata files), so:
// only https URLs, only an <img> built with DOM properties (never HTML),
// fixed size, lazy, no referrer, and a neutral placeholder when there is
// no logo or it fails to load. Classic script: sets window.signalLogoImage.
(function () {
  function safeLogoUrl(value) {
    try {
      return typeof value === 'string' && value.length <= 2048 && new URL(value).protocol === 'https:' ? value : null;
    } catch {
      return null;
    }
  }

  // First letter or digit of the label, as text (e.g. "$MFRG" -> "M").
  function placeholder(label, size, extraClass) {
    const el = document.createElement('span');
    el.className = `token-logo token-logo-placeholder${extraClass ? ` ${extraClass}` : ''}`;
    el.setAttribute('aria-hidden', 'true');
    const initial = String(label || '').match(/[\p{L}\p{N}]/u);
    el.textContent = initial ? initial[0].toUpperCase() : '?';
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    return el;
  }

  /** An <img> for `url` (or a placeholder), `size` px square. */
  function logoElement({ url, label, size = 32, className = '' }) {
    const safe = safeLogoUrl(url);
    if (!safe) return placeholder(label, size, className);
    const img = document.createElement('img');
    img.className = `token-logo${className ? ` ${className}` : ''}`;
    img.alt = '';
    img.width = size;
    img.height = size;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
    img.addEventListener('error', () => img.replaceWith(placeholder(label, size, className)), { once: true });
    img.src = safe;
    return img;
  }

  window.signalLogoImage = { safeLogoUrl, logoElement };
})();
