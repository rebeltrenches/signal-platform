import React from 'react';
import { SignalMark } from './SignalMark.js';

export function SignalCoin({ size = 520 }: { size?: number }) {
  const uid = `signal-coin-${size}`;
  return (
    <div className="signal-coin-stage" style={{ ['--coin-size' as string]: `${size}px` }}>
      <div className="signal-coin-aura" aria-hidden="true" />
      <div className="signal-coin-earth" aria-hidden="true">
        <span className="earth-glow" />
        <span className="earth-lights" />
      </div>
      <div className="signal-coin-orbit orbit-a" aria-hidden="true" />
      <div className="signal-coin-orbit orbit-b" aria-hidden="true" />
      <svg className="signal-coin" viewBox="0 0 520 520" role="img" aria-label="Signal launchpad emblem">
        <defs>
          <radialGradient id={`${uid}-face`} cx="48%" cy="34%" r="72%">
            <stop offset="0" stopColor="#30205f" />
            <stop offset="0.48" stopColor="#0d0b18" />
            <stop offset="1" stopColor="#03030a" />
          </radialGradient>
          <linearGradient id={`${uid}-rim`} x1="20%" y1="5%" x2="80%" y2="95%">
            <stop offset="0" stopColor="#e7dcff" />
            <stop offset="0.18" stopColor="#7d64ff" />
            <stop offset="0.43" stopColor="#29233e" />
            <stop offset="0.68" stopColor="#b89cff" />
            <stop offset="1" stopColor="#40316d" />
          </linearGradient>
          <linearGradient id={`${uid}-edge`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.22" stopColor="#7f5cff" />
            <stop offset="0.5" stopColor="#172b76" />
            <stop offset="0.78" stopColor="#b967ff" />
            <stop offset="1" stopColor="#ffffff" />
          </linearGradient>
          <linearGradient id={`${uid}-mark`} x1="30%" y1="10%" x2="70%" y2="90%">
            <stop offset="0" stopColor="#5c8cff" />
            <stop offset="0.5" stopColor="#9a3dff" />
            <stop offset="1" stopColor="#d06cff" />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <path id={`${uid}-topArc`} d="M 105 260 A 155 155 0 0 1 415 260" />
          <path id={`${uid}-bottomArc`} d="M 415 260 A 155 155 0 0 1 105 260" />
        </defs>

        <circle cx="260" cy="260" r="232" fill="#05050c" stroke={`url(#${uid}-edge)`} strokeWidth="7" opacity=".96" />
        <circle cx="260" cy="260" r="220" fill={`url(#${uid}-rim)`} opacity=".98" />
        <circle cx="260" cy="260" r="205" fill="#080711" stroke="#1b1830" strokeWidth="2" />
        <circle cx="260" cy="260" r="190" fill={`url(#${uid}-face)`} stroke={`url(#${uid}-edge)`} strokeWidth="2" />

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

        <circle cx="260" cy="260" r="116" fill="none" stroke="#7650ff" strokeOpacity=".16" strokeWidth="22" filter={`url(#${uid}-soft)`} />
        <g filter={`url(#${uid}-glow)`}>
          <path d="M202 211 A72 72 0 0 1 318 211" stroke={`url(#${uid}-mark)`} strokeWidth="12" strokeLinecap="round" fill="none" />
          <path d="M222 233 A45 45 0 0 1 298 233" stroke={`url(#${uid}-mark)`} strokeWidth="12" strokeLinecap="round" fill="none" />
          <path d="M185 341 L260 217 L335 341" stroke={`url(#${uid}-mark)`} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="260" cy="311" r="11" fill={`url(#${uid}-mark)`} />
        </g>

        <text x="260" y="366" textAnchor="middle" fill="#ffffff" fontSize="31" fontWeight="800" letterSpacing="6">SIGNAL</text>
        <text x="260" y="393" textAnchor="middle" fill="#ddd6ff" fontSize="11" letterSpacing="4">THE LAUNCHPAD</text>
        <text x="260" y="412" textAnchor="middle" fill="#ddd6ff" fontSize="10" letterSpacing="3">FOR WHAT'S NEXT</text>
        <text x="260" y="438" textAnchor="middle" fill="#b86cff" fontSize="8" letterSpacing="2">REAL PROJECTS   •   REAL DATA   •   REAL COMMUNITY</text>

        <text fill="#f7f4ff" fontSize="12" fontWeight="700" letterSpacing="4">
          <textPath href={`#${uid}-topArc`} startOffset="50%" textAnchor="middle">SIGNAL</textPath>
        </text>
        <text fill="#bdb4d7" fontSize="9" letterSpacing="2.4">
          <textPath href={`#${uid}-bottomArc`} startOffset="50%" textAnchor="middle">BUILD • TRADE • VERIFY • COMMUNITY</textPath>
        </text>
      </svg>
      <div className="signal-coin-caption">
        <span>REAL PROJECTS</span><span>REAL DATA</span><span>REAL COMMUNITY</span>
      </div>
    </div>
  );
}
