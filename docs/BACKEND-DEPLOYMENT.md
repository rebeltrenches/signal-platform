# Backend production deployment — exact remaining steps

This documents precisely what Stage 1's local implementation prepared
and precisely what still requires real infrastructure to finish. Kept
as documentation, not a live source file: the wiring code below cannot
actually compile in this sandbox (no generated `@prisma/client` exists
here — see the explanation below), so including it as real `.ts` would
mean carrying code no build here can verify. The moment a real
environment exists, this becomes a short, mechanical task rather than
a design problem — the design work is what Stage 1 actually finished.

## What's already real and working, right now, unconditionally

- `apps/api` runs as a plain `node:http` server with zero missing
  dependencies — `pnpm install` isn't even required for it to run.
- Chat's full security stack (Ed25519 verification, rate limiting,
  moderation, soft-delete, room isolation, XSS-escaping) works
  identically regardless of which repository is active — proven by the
  same 28 backend + 19 real-browser tests passing against
  `MemoryChatRepository`, the only implementation ever actually
  exercised.
- CORS, the configurable frontend API base URL, and consistent
  error/status shapes across every route are complete and tested now,
  independent of the database question below.

## What genuinely requires real infrastructure, and why

No internet exists in the sandbox this project has been built in, at
any point. Two concrete, separate consequences:

1. **The `prisma` CLI itself was never installable** (`npm install -g
   prisma` needs a registry). Without it, `prisma generate` — the
   command that reads `schema.prisma` and writes a typed
   `@prisma/client` package into `node_modules` — has never run.
   There is no generated client anywhere in this repository to import
   against.
2. **No live Postgres instance has ever existed** for this project to
   connect to, so even if a client existed, there is nothing for it to
   actually talk to.

This is why `PrismaChatRepository` (`apps/api/src/chat/
PrismaChatRepository.ts`) is written against a hand-declared
`PrismaLikeClient` interface instead of importing `@prisma/client`
directly — there is nothing real to import. Its query logic is real
and tested against a mock implementing that same interface
(`apps/api/tests/chat-repository.test.ts`), which proves it calls the
right operations with the right shapes — not that real Postgres
accepts them. That remains genuinely unverified.

## The exact steps, in order, once a real environment exists

```bash
# 1. Provision a real Postgres instance (any host — Neon, Supabase,
#    Railway, RDS, a plain VM). Get its connection string.

# 2. In a real environment with internet:
cd packages/database
DATABASE_URL="<the real connection string>" npx prisma migrate dev --name init
# This single command both generates the client AND creates the
# database's tables — there is no existing migration to apply, since
# none has ever been generated (confirmed: no migrations/ folder
# exists in this repo today).

# 3. Confirm it worked:
DATABASE_URL="<same string>" npx prisma studio
# or: psql "<same string>" -c '\dt'   (should list ChatRoom, ChatMessage, etc.)
```

## The wiring change itself — small, and exactly this

In `apps/api/src/chat/store.ts`, the `resolveRepository()` function
currently throws when `CHAT_STORAGE=database` is set (deliberately —
see that function's own comment). Replace the throw with:

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaChatRepository } from './PrismaChatRepository.js';

let prismaRepository: ChatRepository | undefined;

function resolveRepository(): ChatRepository {
  if (process.env.CHAT_STORAGE === 'database') {
    if (!prismaRepository) {
      const prisma = new PrismaClient();
      prismaRepository = new PrismaChatRepository(prisma);
    }
    return prismaRepository;
  }
  return activeRepository;
}
```

`PrismaClient`'s actual generated type satisfies `PrismaLikeClient`
structurally — every method `PrismaChatRepository` calls
(`chatRoom.findUnique`, `wallet.create`, etc.) exists on the real
client with a compatible shape. No changes to `PrismaChatRepository`
itself should be needed; if the real client's generated types disagree
with `PrismaLikeClient` anywhere, that's real, valuable information
this preparation can't produce without the real client existing.

## Then, separately: actually hosting `apps/api`

The base-URL and CORS work done in this stage exists specifically so
this step is just configuration, not more code:

1. Deploy `apps/api` to any Node host (Render, Railway, Fly.io, a
   plain VM) with `DATABASE_URL` and `CHAT_STORAGE=database` set.
2. Set `CORS_ORIGINS` to the real frontend's exact origin.
3. Rebuild the frontend with `SIGNAL_API_BASE_URL` set to that host's
   URL, per `apps/web/scripts/build.tsx`.

## What this document is not

Not a claim that any of the above has been run. Not a claim that the
wiring code compiles here (it can't — `@prisma/client` doesn't exist
in this sandbox). Not a substitute for actually running `prisma
migrate dev` against a real database and watching it succeed.
