import http from 'node:http';
import { Router, notImplemented } from './router.js';
import { getHealth, getHealthDatabase } from './routes/health.js';
import { listChains } from './routes/chains.js';
import { previewTax } from './routes/tax.js';

const router = new Router();

// --- real, working ----------------------------------------------------
router.register('GET', '/health', getHealth);
router.register('GET', '/health/database', getHealthDatabase);
router.register('GET', '/api/v1/chains', listChains);
router.register('POST', '/api/v1/tax/preview', previewTax);

// --- documented in the spec, honestly stubbed until their stage lands --
router.register('GET', '/api/v1/tokens/:chain/:address', notImplemented('Stage 11 — indexer', 'Needs live indexed token data.'));
router.register('GET', '/api/v1/launches', notImplemented('Stage 8 — bonding curve'));
router.register('GET', '/api/v1/trades', notImplemented('Stage 9 — trading'));
router.register('GET', '/api/v1/holders', notImplemented('Stage 11 — indexer'));
router.register('GET', '/api/v1/wallets/:chain/:address', notImplemented('Stage 14 — whale tracking'));
router.register('GET', '/api/v1/creators/:address', notImplemented('Stage 16 — creator system'));
router.register('GET', '/api/v1/analytics', notImplemented('Stage 17'));
router.register('GET', '/api/v1/watchlist', notImplemented('Stage 15', 'Needs auth (Stage 19) first.'));
router.register('GET', '/api/v1/alerts', notImplemented('Stage 15', 'Needs auth (Stage 19) first.'));
router.register('GET', '/api/v1/search', notImplemented('Stage 12 — Launch Radar'));
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
