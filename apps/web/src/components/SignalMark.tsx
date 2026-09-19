import React from 'react';

/**
 * The Signal mark — refined from the original uploaded coin artwork
 * (apps/web/src/assets/signal-logo-full.png): the same recognizable
 * shape (broadcast/signal arcs above an upward peak, with a source dot)
 * redrawn as a clean vector instead of a 3D chrome coin with baked-in
 * taglines. Same silhouette throughout this project's whole visual
 * history — refined and re-lit for the dark palette, never replaced.
 *
 * Phase 6 (dark premium redesign): richer, more energetic gradient
 * (brand purple -> electric blue, matching --brand/--brand-2) and an
 * optional soft outer glow for prominent placements (the hero) via an
 * SVG filter — kept as an opt-in `glow` prop rather than baked in, so
 * small placements (navbar, favicon) stay crisp rather than muddy.
 *
 * Pure SVG so it's crisp at any size with zero raster artifacts: one
 * definition serves the navbar, the hero, and the favicon (rasterized
 * from this exact markup). The gradient/filter ids are derived from
 * `size` so two instances on one page (header + hero) never collide.
 */
export function SignalMark({ size = 32, glow = false, className }: { size?: number; glow?: boolean; className?: string }) {
  const gradientId = `signal-mark-gradient-${size}`;
  const glowId = `signal-mark-glow-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
      style={glow ? { overflow: 'visible' } : undefined}
    >
      <defs>
        <linearGradient id={gradientId} x1="9" y1="7" x2="39" y2="39" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4f7bff" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#a685ff" />
        </linearGradient>
        {glow && (
          <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <g filter={glow ? `url(#${glowId})` : undefined}>
        <path d="M13 17 A13 13 0 0 1 35 17" stroke={`url(#${gradientId})`} strokeWidth="3.4" strokeLinecap="round" />
        <path d="M18 21.5 A7.2 7.2 0 0 1 30 21.5" stroke={`url(#${gradientId})`} strokeWidth="3.4" strokeLinecap="round" />
        <path d="M11 37 L24 16.5 L37 37" stroke={`url(#${gradientId})`} strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="24" cy="32" r="2.9" fill={`url(#${gradientId})`} />
      </g>
    </svg>
  );
}
