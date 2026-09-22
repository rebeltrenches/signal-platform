// Legacy browser entry point intentionally disabled.
//
// SIGNAL no longer uses Token-2022 withheld-token fees for new launches.
// Creator trading fees are paid in native SOL by SIGNAL-routed trades.
// Keep this file inert so an old cached/imported path cannot accidentally
// revive the superseded harvest/withdraw flow.
(function () {
  window.SIGNAL_LEGACY_TOKEN_FEE_COLLECTION_DISABLED = true;
})();
