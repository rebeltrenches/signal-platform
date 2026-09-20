import http from 'node:http';
import { Router, notImplemented } from './router.js';
import { getHealth, getHealthDatabase } from './routes/health.js';
import { listChains } from './routes/chains.js';
import { previewTax } from './routes/tax.js';
import { getMainMessages, postMainMessage, getTokenMessages, postTokenMessage, reportChatMessage, deleteChatMessage, checkModeratorStatus } from './routes/chat.js';
import { registerTokenRoute, getTokenRoute, listMyTokensRoute, listRecentTokensRoute, searchTokensRoute } from './routes/tokens.js';
import { getAuthChallenge, postAuthSession, getAuthSession } from './routes/auth.js';
import { getWatchlist, postWatchlistItem, deleteWatchlistItem } from './routes/watchlist.js';
import { getAlerts, postAlert, deleteAlert } from './routes/alerts.js';

const router = new Router();

// --- real, working ----------------------------------------------------
router.register('GET', '/health', getHealth);
router.register('GET', '/health/database', getHealthDatabase);
router.register('GET', '/api/v1/chains', listChains);
router.register('POST', '/api/v1/tax/preview', previewTax);

// --- Chat (real, in-memory — see apps/api/src/chat/store.ts's own
// header for exactly what "real" means here and what its honest limits
// are: genuinely stored/validated/rate-limited/signature-verified, but
// in-process memory, not a database; polling, not a WebSocket push) ---
router.register('GET', '/api/v1/chat/main/messages', getMainMessages);
router.register('POST', '/api/v1/chat/main/messages', postMainMessage);
router.register('GET', '/api/v1/chat/token/:address/messages', getTokenMessages);
router.register('POST', '/api/v1/chat/token/:address/messages', postTokenMessage);
router.register('POST', '/api/v1/chat/messages/:messageId/report', reportChatMessage);
router.register('DELETE', '/api/v1/chat/messages/:messageId', deleteChatMessage);
router.register('GET', '/api/v1/chat/is-moderator', checkModeratorStatus);

// --- Tokens: real registration + lookup (Stage 2 — the indexer's
// registration half). GET .../tokens/:chain/:address replaces the old
// Stage 11 stub for this ONE specific endpoint — it now answers from
// real registered-token data, honestly 404ing when nothing's
// registered, never fabricating a placeholder. Broader discovery
// (browsing/searching ALL tokens for Explore) still needs the
// full indexer refresh loop actually running somewhere — that part
// remains Stage 11, not claimed here. ---
router.register('POST', '/api/v1/tokens/register', registerTokenRoute);
router.register('GET', '/api/v1/tokens/mine', listMyTokensRoute);
router.register('GET', '/api/v1/tokens', listRecentTokensRoute);
router.register('GET', '/api/v1/tokens/:chain/:address', getTokenRoute);

// --- Auth: real sign-in-with-wallet + session tokens (Stage 19 per
// docs/ARCHITECTURE.md's "security hardening" framing). Reuses
// chat/verify.ts's proven signature verification — see
// auth/AuthSession.ts's own header for the full design. ---
router.register('GET', '/api/v1/auth/challenge', getAuthChallenge);
router.register('POST', '/api/v1/auth/session', postAuthSession);
router.register('GET', '/api/v1/auth/session', getAuthSession);

// --- Watchlist: real, session-authenticated CRUD (unblocks the
// Stage-15 stub that explicitly waited on Stage 19 auth, which now
// exists). See routes/watchlist.ts for the authorization model. ---
router.register('GET', '/api/v1/watchlist', getWatchlist);
router.register('POST', '/api/v1/watchlist', postWatchlistItem);
router.register('DELETE', '/api/v1/watchlist/:itemId', deleteWatchlistItem);

// --- Alerts: real, session-authenticated CONFIGURATION CRUD only.
// See routes/alerts.ts and alerts/AlertRepository.ts for why
// triggering/scheduling/notifications are explicitly out of scope. ---
router.register('GET', '/api/v1/alerts', getAlerts);
router.register('POST', '/api/v1/alerts', postAlert);
router.register('DELETE', '/api/v1/alerts/:alertId', deleteAlert);

// --- documented in the spec, honestly stubbed until their stage lands --
router.register('GET', '/api/v1/launches', notImplemented('Stage 8 — bonding curve'));
router.register('GET', '/api/v1/trades', notImplemented('Stage 9 — trading'));
router.register('GET', '/api/v1/holders', notImplemented('Stage 11 — indexer'));
router.register('GET', '/api/v1/wallets/:chain/:address', notImplemented('Stage 14 — whale tracking'));
router.register('GET', '/api/v1/creators/:address', notImplemented('Stage 16 — creator system'));
router.register('GET', '/api/v1/analytics', notImplemented('Stage 17'));
router.register('GET', '/api/v1/search', searchTokensRoute);
router.register('GET', '/api/v1/rewards', notImplemented('Stage 11 — indexer + worker'));

const PORT = Number(process.env.PORT ?? 4000);

export function createServer() {
  return http.createServer((req, res) => {
    router.handleNode(req, res).catch((err) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: (err as Error).message }));
    });
  });
}

// Only actually listen when this file is run directly (`tsx src/server.ts`),
// not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(PORT, () => {
    console.log(`api listening on http://localhost:${PORT}`);
  });
}
