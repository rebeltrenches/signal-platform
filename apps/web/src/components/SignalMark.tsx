import React from 'react';

/**
 * The Signal mark — refined from the original uploaded coin artwork
 * (apps/web/src/assets/signal-logo-full.png): the same recognizable
 * shape (broadcast/signal arcs above an upward peak, with a source dot)
 * redrawn as a clean flat vector instead of a 3D chrome coin with glow,
 * reflections, and baked-in taglines. Same brand, same silhouette —
 * refined, not replaced.
 *
 * Pure SVG so it's crisp at any size with zero raster artifacts: this
 * one definition serves the navbar (~28px), the hero (~120px), and the
 * favicon (16/32/64px, rasterized from this exact markup — see
 * scripts/generate-favicons.ts) — one source of truth, so the mark can
 * never drift out of sync with itself across contexts the way separate
 * hand-cropped PNGs did before.
 *
 * A single, restrained two-stop gradient (brand purple to a closely
 * related blue-violet) — the same two-tone identity the original coin
 * used, kept because it's ALREADY the brand's identity, not because a
 * gradient is a default reach. No glow, no drop-shadow, no bevel, no
 * 3D — those are the specific things being refined away.
 */
export function SignalMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="signal-mark-gradient" x1="10" y1="8" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4a67ff" />
          <stop offset="1" stopColor="#6d4aff" />
        </linearGradient>
      </defs>
      <path d="M13 17 A13 13 0 0 1 35 17" stroke="url(#signal-mark-gradient)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M18 21.5 A7.2 7.2 0 0 1 30 21.5" stroke="url(#signal-mark-gradient)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M11 37 L24 16.5 L37 37" stroke="url(#signal-mark-gradient)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="32" r="2.7" fill="url(#signal-mark-gradient)" />
    </svg>
  );
}
