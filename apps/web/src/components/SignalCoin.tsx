import React from 'react';

/**
 * Homepage hero emblem. This intentionally mirrors the approved Signal coin
 * reference as a single scalable SVG so desktop and mobile keep the same
 * proportions, spacing and typography.
 */
export function SignalCoin({ size = 520 }: { size?: number }) {
  const uid = `signal-coin-${size}`;
  return (
    <div className="signal-coin-stage" style={{ ['--coin-size' as string]: `${size}px` }}>
      <div className="signal-coin-aura" aria-hidden="true" />
      <div className="signal-coin-earth" aria-hidden="true"><span className="earth-lights" /></div>
      <svg className="signal-coin" viewBox="0 0 520 520" role="img" aria-label="Signal launchpad emblem">
        <defs>
          <radialGradient id={`${uid}-face`} cx="50%" cy="44%" r="67%">
            <stop offset="0" stopColor="#17162f" />
            <stop offset=".7" stopColor="#090a18" />
            <stop offset="1" stopColor="#050610" />
          </radialGradient>
          <linearGradient id={`${uid}-rim`} x1="8%" y1="8%" x2="92%" y2="92%">
            <stop offset="0" stopColor="#c69cff" />
            <stop offset=".48" stopColor="#8b70ff" />
            <stop offset="1" stopColor="#77c7ff" />
          </linearGradient>
          <linearGradient id={`${uid}-mark`} x1="20%" y1="8%" x2="82%" y2="92%">
            <stop offset="0" stopColor="#a962ff" />
            <stop offset=".48" stopColor="#8d64ff" />
            <stop offset="1" stopColor="#67c7ff" />
          </linearGradient>
          <path id={`${uid}-topArc`} d="M 135 151 A 174 174 0 0 1 385 151" />
          <path id={`${uid}-leftArc`} d="M 112 346 A 181 181 0 0 1 122 171" />
          <path id={`${uid}-rightArc`} d="M 398 171 A 181 181 0 0 1 408 346" />
        </defs>

        <circle cx="260" cy="260" r="232" fill="#060712" stroke={`url(#${uid}-rim)`} strokeWidth="5" />
        <circle cx="260" cy="260" r="219" fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="15" />
        <circle cx="260" cy="260" r="202" fill="#080914" stroke="#25264a" strokeWidth="2" />
        <circle cx="260" cy="260" r="188" fill={`url(#${uid}-face)`} stroke="#8b7cff" strokeWidth="2" />

        <g fill="none" stroke="#7650bd" strokeWidth="1.5" opacity=".72">
          <path d="M126 260h40l16-18h23l20-31h18" /><path d="M132 286h37l17-16h25l20-31h22" />
          <path d="M394 260h-40l-16-18h-23l-20-31h-18" /><path d="M388 286h-37l-17-16h-25l-20-31h-22" />
          <path d="M153 176v42h25l20 22" /><path d="M367 176v42h-25l-20 22" />
          <path d="M142 304h29l17 17v34" /><path d="M378 304h-29l-17 17v34" />
        </g>
        <g fill="#a76aff" opacity=".75">
          <circle cx="166" cy="260" r="3" /><circle cx="169" cy="286" r="3" />
          <circle cx="354" cy="260" r="3" /><circle cx="351" cy="286" r="3" />
          <circle cx="153" cy="176" r="3" /><circle cx="367" cy="176" r="3" />
        </g>

        <g>
          <path d="M211 210 A62 62 0 0 1 309 210" stroke={`url(#${uid}-mark)`} strokeWidth="12" strokeLinecap="round" fill="none" />
          <path d="M228 231 A40 40 0 0 1 292 231" stroke={`url(#${uid}-mark)`} strokeWidth="11" strokeLinecap="round" fill="none" />
          <path d="M196 323 L260 218 L324 323" stroke={`url(#${uid}-mark)`} strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="260" cy="291" r="11" fill={`url(#${uid}-mark)`} />
        </g>

        <text x="260" y="354" textAnchor="middle" fill="#fff" fontSize="39" fontWeight="800" letterSpacing="4">SIGNAL</text>
        <text x="260" y="379" textAnchor="middle" fill="#f4f1ff" fontSize="10.5" fontWeight="650" letterSpacing="3.2">THE LAUNCHPAD</text>
        <text x="260" y="396" textAnchor="middle" fill="#f4f1ff" fontSize="10" fontWeight="650" letterSpacing="2.7">FOR WHAT'S NEXT</text>

        <g fill="#bda8f4" fontSize="8.3" fontWeight="700" letterSpacing=".45">
          <text x="188" y="421" textAnchor="middle">REAL</text><text x="188" y="432" textAnchor="middle">PROJECTS</text>
          <text x="260" y="421" textAnchor="middle">REAL</text><text x="260" y="432" textAnchor="middle">DATA</text>
          <text x="334" y="421" textAnchor="middle">REAL</text><text x="334" y="432" textAnchor="middle">COMMUNITY</text>
        </g>
        <g stroke="#725fa8" strokeWidth="1.2"><path d="M224 414v22" /><path d="M297 414v22" /></g>

        <text fill="#f7f4ff" fontSize="16" fontWeight="700" letterSpacing="5">
          <textPath href={`#${uid}-topArc`} startOffset="50%" textAnchor="middle">S I G N A L</textPath>
        </text>
        <text fill="#e8e3ff" fontSize="9" fontWeight="700" letterSpacing="1.1">
          <textPath href={`#${uid}-leftArc`} startOffset="50%" textAnchor="middle">LAUNCH · BUILD · TRADE</textPath>
        </text>
        <text fill="#e8e3ff" fontSize="8.4" fontWeight="700" letterSpacing=".9">
          <textPath href={`#${uid}-rightArc`} startOffset="50%" textAnchor="middle">MULTI-CHAIN · COMMUNITY · CULTURE</textPath>
        </text>
        <text x="260" y="469" textAnchor="middle" fill="#f7f4ff" fontSize="15" fontWeight="800" letterSpacing="5">$SIGNAL</text>
      </svg>
    </div>
  );
}
