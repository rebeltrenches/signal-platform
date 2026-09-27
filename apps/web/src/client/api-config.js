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
