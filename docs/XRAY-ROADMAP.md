# Signal X-Ray: roadmap

X-Ray shows on-chain facts about any Solana token. The rules below apply to every version.

## Rules for every version

- **Facts, not scores.** Each line is a fact, a ✅/⚠️ marker and a one-line "why it matters".
- **No verdicts.** Never an overall "safe", "not a honeypot" or "rug-free". Say what was checked and when, e.g. "Sell simulation succeeded right now".
- **Unavailable, never guessed.** Data that can't be read shows as "Unavailable".
- **Read-only.** Nothing is signed or sent. Chain reads and keys stay server-side, and results are cached per mint and rate-limited per IP.
- **Cost reported.** Every response reports its RPC usage.

## V1: built

Endpoint `GET /api/xray?mint=…` (`functions/api/solana/xray.js`), shown on the front page ("X-Ray any token") and the token page's Signal Check tab (`apps/web/src/client/xray.js`).

- **Hard facts:**
  - mint and freeze authority; metadata mutable or immutable (Metaplex or Token-2022 metadata); supply and decimals;
  - Token-2022 extensions: transfer fee (%, and whether its authority can change it), transfer hook, permanent delegate, frozen-by-default accounts, pausable or paused, non-transferable.
- **Holders and liquidity:**
  - top 10 holders' share, excluding labelled pool and curve accounts; the creator's holding when the creator is known;
  - market (pump.fun curve, or the pool it trades in), liquidity and pool age;
  - LP tokens burned, held by programs or held by wallets (PumpSwap, Raydium AMM v4, Raydium CPMM). Concentrated-liquidity pools are marked as not applicable.
- **Honeypot checks:**
  - the mechanisms found above, listed together;
  - a simulated 1% sell from a real holder (`simulateTransaction`, `sigVerify: false`; never sent);
  - successful sells by non-creator wallets in the last 15 pool or curve transactions.
- **Signal launches:** an extra line, "Launched on Signal: mint authority revoked at launch".

**Cost per uncached X-Ray** (cached 5 minutes per mint; 1 minute if something was unavailable):

| Source | Calls |
|---|---|
| Solana RPC (Helius) | about 20–25: 3–5 `getMultipleAccounts`, 1–2 `getTokenLargestAccounts`, 0–1 `getTokenSupply`, 1 `simulateTransaction`, 1 `getSignaturesForAddress`, up to 15 `getTransaction` (one batched request) |
| Jupiter (existing key) | 1 order request, for the sell simulation |
| DEX Screener | 1 (free, no key) |
| Signal API | 1 |

## V2: not built yet

- **Clusters.** Buys bundled in the same block, and wallets funded from shared sources.
- **Creator plus linked wallets.** Their combined share of supply.
- **Bubble map.** The top ~50 holders from Helius data, drawn with our own D3 build (no third-party embed).
- **Dev wallet sells.** When and how much the creator (and linked wallets) sold.
- **Snipers and insiders at launch.** Wallets that bought in the first blocks, and how much they still hold.

## V3: not built yet

- **Creator's previous launches and their outcomes.** Wording: "no previous launches found from this wallet". Never "creator is safe".
- **Copycat warning.** A name or logo matching an existing token.
- **Liquidity-removal timeline.** Adds and removals over time.
- **Holder trend.** Holder count and concentration over time.
- **Wash-trading signs.** Circular trades between related wallets.
- **Social links check.** Links in the metadata: present, reachable, and pointing back to this mint.

## Later

- **Base and BNB versions.** Contract ownership, proxy/upgradeability, tax and blacklist functions, and a sell simulation via `eth_call`.
- **Telegram safety bot** reusing the same engine. The same rules apply: facts, markers and "why", no verdicts.
