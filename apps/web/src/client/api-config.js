// Shared with every module-script client file (launch-solana.js,
// future ones) that calls apps/api. chat.js is a classic script (not a
// module — see build.tsx's clientScripts vs moduleScripts split) so it
// can't import this; it keeps its own small, already-tested inline
// copy instead of forcing a cross-script-type dependency for a few
// lines of logic. Same behavior either way: window.SIGNAL_API_BASE_URL
// unset (the default, and the only way this has ever actually run)
// means today's exact relative-path, same-origin behavior.
export function apiUrl(path) {
  const base = window.SIGNAL_API_BASE_URL;
  return base ? `${base.replace(/\/$/, '')}${path}` : path;
}

/** The Signal platform wallet's public address, injected at build time
 *  (see build.tsx/Shell.tsx) from SIGNAL_PLATFORM_WALLET — never
 *  hardcoded here or in any file that imports this. Undefined if the
 *  build didn't have that env var set; callers that need a real value
 *  (launch-solana.js, at the moment a launch is actually attempted)
 *  check for this explicitly and fail loudly rather than proceeding
 *  with an undefined recipient —
