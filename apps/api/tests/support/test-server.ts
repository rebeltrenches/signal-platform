/**
 * TEST-ONLY API entrypoint for the browser e2e tests in apps/web/tests.
 * Never deployed: nothing under apps/api/src imports or runs this file.
 *
 * Serves the real API (src/server.ts's createServer, in-memory storage)
 * plus one extra endpoint, POST /__test/seed-token, which writes a token
 * straight into the token store. Those page tests need registered tokens
 * as setup data (some at the static preview address "example"), while
 * real registration requires a signed-in creator wallet and an on-chain
 * proof — which apps/api/tests/token-routes.test.ts covers end to end.
 *
 * Run with: npx tsx apps/api/tests/support/test-server.ts  (PORT env)
 */
import http from 'node:http';
import { createServer } from '../../src/server.js';
import { registerToken } from '../../src/tokens/tokenStore.js';

import { __setProfileRepositoryForTests } from '../../src/profiles/profileStore.js';
import { MemoryProfileRepository } from '../../src/profiles/MemoryProfileRepository.js';
__setProfileRepositoryForTests(new MemoryProfileRepository());

const PORT = Number(process.env.PORT ?? 4000);
const api = createServer();

http
  .createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/__test/seed-token') {
      api.emit('request', req, res);
      return;
    }
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw);
        const token = await registerToken({
          chain: String(body.chain ?? '').toUpperCase(),
          address: body.address,
          name: body.name,
          symbol: body.symbol,
          decimals: body.decimals,
          creatorWalletAddress: body.creatorWalletAddress,
        });
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ token }));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'SEED_FAILED', message: (err as Error).message }));
      }
    });
  })
  .listen(PORT, () => {
    console.log(`test api listening on http://localhost:${PORT}`);
  });
