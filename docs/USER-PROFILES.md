# Signal profiles

## First release

- `/profile`: signed-wallet editor, live preview and browser draft recovery.
- `/u/<username>`: public view; private and absent profiles both return 404.
- Unique lowercase username, display name, 280-character bio, self-selected
  creator/researcher/community roles, X/Telegram/website links.
- Avatar/banner raster uploads are cropped and compressed locally, capped at
  75 KB each on the server, and stored durably with the profile.
- Four appearance themes and a validated accent colour scoped to the card.
- Private by default; wallet address and registered-project showcase each
  require separate opt-in. A featured project must belong to the signed wallet.
- Wallet-ownership badge means a wallet signed in, not verified identity,
  social-account verification or an endorsement.
- Publishing projects can expose the creator wallet through public chain
  records even when the address is hidden on the profile. The editor says so.
- Public endpoints never serialize holdings, watchlists, alerts, user IDs,
  owner fields or private preferences. Public profile APIs/pages use no-store.
- Changing wallets invalidates requests and resets the visible editor.
- Delete affects only the profile and releases its username.

## Rollout

Keep this feature on its review branch until approved. A frontend preview
supports styling and local drafts; saving and public links require the matching
API code AND database table. It never claims that a draft has been published.

1. After approval, apply `packages/database/sql/user-profiles.sql` to the
   existing API database with the normal authorized deployment connection.
   This is additive: it creates one table and its indexes, without altering
   existing financial, wallet, token or chat records. Do not use reset or
   accept-data-loss options. Existing schema-sync deployments can instead
   create the new model through their normal reviewed schema-sync flow.
2. Generate Prisma Client from the updated schema during the API build and
   deploy the matching `apps/api` code. Keep the existing `CHAT_STORAGE=database`,
   `DATABASE_URL` and `AUTH_SECRET`; no secrets are added by this feature.
3. Deploy the approved frontend/Worker. Profile calls use the existing
   `SIGNAL_API_BASE_URL` when configured, or the same-origin Worker proxy and
   existing `SIGNAL_API_ORIGIN` otherwise. The same-origin proxy also forwards the existing wallet-auth routes. A
   separately hosted API must retain its existing frontend CORS allowlist.
4. Verify real-wallet sign-in, private save/reload, publish, visitor view,
   wallet/project privacy switches, unpublish and delete. No launch or swap
   transaction is needed to test profiles.

## Validation

- `node --import tsx apps/api/tests/profiles-routes.test.ts`: real HTTP auth and
  signed-wallet ownership, private projections, validation and lifecycle.
- `pnpm exec tsx apps/api/tests/profiles-postgres.test.ts`: generated Prisma
  against local isolated PostgreSQL, concurrent username claims and persistence.
  Refuses remote/non-test database URLs.
- `node apps/web/tests/profiles-proxy.test.mjs`: routing, body limits, no-store,
  private-header isolation and unavailable-backend states.
- `python apps/web/tests/profile-page.test.py`: browser -> real wallet signature
  -> API save -> public visitor, image upload, wallet switching and mobile layout.
  Uses test-only memory storage; PostgreSQL persistence is tested separately.
- Existing auth/watchlist tests, Vercel adapter checks, schema validation,
  TypeScript check and web build cover surrounding behavior.

Chat handles, social-account proof, multiple-wallet linking, profile search,
followers and shared scan posts are future extensions, not part of this release.
