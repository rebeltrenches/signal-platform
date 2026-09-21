import React from 'react';

/**
 * The cinematic hero emblem, integrated from the separately-developed
 * "V5 Duo Fix" project per an explicit, multi-round approved plan (see
 * commit message for the full trace). This is NOT the site's brand
 * mark — that's still SignalMark.tsx, used unmodified by Header.tsx and
 * everywhere else the mark appears. This component exists specifically
 * for the homepage hero's large emblem.
 *
 * Five elements present in the original source were removed here,
 * confirmed against the actual V5 stylesheet (779 lines) rather than
 * assumed: .signal-coin-orbit (.orbit-a/.orbit-b), .signal-coin-caption,
 * and the .earth-glow span all had no matching CSS definition anywhere
 * in that stylesheet — rendering them here would mean unstyled,
 * visually-broken elements, not a faithful port of a working design.
 * The unused `SignalMark` import was also removed — the original
 * imported it but never referenced it in the render output.
 */
export function SignalCoin({ size = 520 }: { size?: number }) {
  const uid = `signal-coin-${size}`;
  return (
    <div className="signal-coin-stage" style={{ ['--coin-size' as string]: `${size}px` }}>
      <div className="signal-coin-aura" aria-hidden="true" />
      <div className="signal-coin-earth" aria-hidden="true">
        <span className="earth-lights" />
      </div>
      <svg className="signal-coin" viewBox="0 0 520 520" role="img" aria-label="Signal launchpad emblem">
        <defs>
          <radialGradient id={`${uid}-face`} cx="50%" cy="42%" r="68%">
            <stop offset="0" stopColor="#171735" />
            <stop offset="0.62" stopColor="#090a18" />
            <stop offset="1" stopColor="#04050d" />
          </radialGradient>
          <linearGradient id={`${uid}-rim`} x1="8%" y1="12%" x2="92%" y2="88%">
            <stop offset="0" stopColor="#c68cff" />
            <stop offset="0.5" stopColor="#7f6cff" />
            <stop offset="1" stopColor="#66b8ff" />
          </linearGradient>
          <linearGradient id={`${uid}-edge`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0" stopColor="#a965ff" />
            <stop offset="0.52" stopColor="#6d65ff" />
            <stop offset="1" stopColor="#6dc7ff" />
          </linearGradient>
          <linearGradient id={`${uid}-mark`} x1="30%" y1="10%" x2="70%" y2="90%">
            <stop offset="0" stopColor="#5c8cff" />
            <stop offset="0.5" stopColor="#9a3dff" />
            <stop offset="1" stopColor="#d06cff" />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="2.8" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <path id={`${uid}-topArc`} d="M 105 260 A 155 155 0 0 1 415 260" />
          <path id={`${uid}-leftArc`} d="M 72 286 A 190 190 0 0 1 150 112" />
          <path id={`${uid}-rightArc`} d="M 370 112 A 190 190 0 0 1 448 286" />
          <path id={`${uid}-bottomArc`} d="M 145 412 A 190 190 0 0 0 375 412" />
        </defs>

        <circle cx="260" cy="260" r="232" fill="#050610" stroke={`url(#${uid}-edge)`} strokeWidth="5" />
        <circle cx="260" cy="260" r="220" fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="13" />
        <circle cx="260" cy="260" r="202" fill="#080914" stroke="#24254d" strokeWidth="2" />
        <circle cx="260" cy="260" r="188" fill={`url(#${uid}-face)`} stroke="#8a78ff" strokeWidth="2" />

        <g opacity=".36" stroke="#873cff" strokeWidth="1.4" fill="none">
          <path d="M105 285h52l18-23h25l21-36h25" />
          <path d="M112 318h47l18-17h28l25-38h32" />
          <path d="M410 285h-52l-18-23h-25l-21-36h-25" />
          <path d="M403 318h-47l-18-17h-28l-25-38h-32" />
          <path d="M150 155v40h28l22 26" />
          <path d="M370 155v40h-28l-22 26" />
        </g>
        <g fill="#a35cff" opacity=".7">
          <circle cx="175" cy="238" r="3" /><circle cx="162" cy="301" r="3" />
          <circle cx="345" cy="238" r="3" /><circle cx="358" cy="301" r="3" />
          <circle cx="150" cy="155" r="2.5" /><circle cx="370" cy="155" r="2.5" />
        </g>

        <circle cx="260" cy="260" r="116" fill="none" stroke="#7650ff" strokeOpacity=".08" strokeWidth="14" />
        <g filter={`url(#${uid}-glow)`}>
          <path d="M202 211 A72 72 0 0 1 318 211" stroke={`url(#${uid}-mark)`} strokeWidth="12" strokeLinecap="round" fill="none" />
          <path d="M222 233 A45 45 0 0 1 298 233" stroke={`url(#${uid}-mark)`} strokeWidth="12" strokeLinecap="round" fill="none" />
          <path d="M185 341 L260 217 L335 341" stroke={`url(#${uid}-mark)`} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="260" cy="311" r="11" fill={`url(#${uid}-mark)`} />
        </g>

        <text x="260" y="362" textAnchor="middle" fill="#ffffff" fontSize="34" fontWeight="800" letterSpacing="5">SIGNAL</text>
        <text x="260" y="388" textAnchor="middle" fill="#f0ecff" fontSize="10.5" fontWeight="600" letterSpacing="3.4">THE LAUNCHPAD</text>
        <text x="260" y="406" textAnchor="middle" fill="#f0ecff" fontSize="10" fontWeight="600" letterSpacing="2.8">FOR WHAT'S NEXT</text>
        <g fill="#bdafff" fontSize="9.4" fontWeight="700" letterSpacing="1">
          <text x="190" y="433" textAnchor="middle">REAL PROJECTS</text>
          <text x="260" y="433" textAnchor="middle">REAL DATA</text>
          <text x="334" y="433" textAnchor="middle">REAL COMMUNITY</text>
        </g>
        <g stroke="#6758aa" strokeWidth="1">
          <path d="M224 421v18" /><path d="M297 421v18" />
        </g>
        <text fill="#f7f4ff" fontSize="12" fontWeight="700" letterSpacing="4">
          <textPath href={`#${uid}-topArc`} startOffset="50%" textAnchor="middle">SIGNAL</textPath>
        </text>
      </svg>
    </div>
  );
}
