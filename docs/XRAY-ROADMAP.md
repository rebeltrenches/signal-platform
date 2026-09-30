# Signal X-Ray: roadmap

X-Ray shows on-chain facts about any Solana token (and, from V3, any wallet). The rules below apply to every version.

## Rules for every version

- **Facts with transaction links, never labels.** Every finding links to the transactions behind it (e.g. on Solscan). Never labels like "scammer", "rugger" or "insider". Say what the transactions show, e.g. "this wallet removed 100% of the LP on 2026-10-02 (tx)".
- **Never identify the real people behind wallets.** X-Ray describes wallets and their on-chain activity only. No names, handles or guesses about who controls a wallet.
- **Facts, not scores.** Each line is a fact, a ✅/⚠️ marker and a one-line "why it matters".
- **No verdicts.** Never an overall "safe", "not a honeypot" or "rug-free". Say what was checked and when, e.g. "Sell simulation succeeded right now".
- **Unavailable, never guessed.** Data that can't be read shows as "Unavailable".
- **Read-only.** Nothing is signed or sent. Chain reads and keys stay server-side, and results are cached and rate-limited per IP.
- **Cost reported.** Every response reports its RPC usage.
- **Report an error.** Every result has a "Report an error" option, so a wallet or token owner can point out a wrong or misleading fact. Reports are reviewed and corrected where the on-chain data supports it.

> **Legal review needed before launch.** Anything that describes wallets' behaviour (V2 onwards: bundles, insiders, Wallet X-Ray, serial-launch fingerprints, rug timelines, alerts) must be reviewed by a lawyer before it's released, including the wording, the "report an error" process and how corrections are handled.

## Design: one X-Ray box

- **One box for everything.** Paste any Solana address. X-Ray detects what it is from its on-chain account type: a token mint (owned by the Token or Token-2022 program) gets the **token X-Ray**; a wallet (System Program-owned, or another non-mint account) gets the **Wallet X-Ray** (V3). Anything else says what it is, e.g. "this is a token account, not a mint", with a link.
- **New checks appear as new sections** of the same results, not as separate pages or tools.
- **Live alerts** are a **"Watch this token"** button on the token result (V4).
- The same results appear on the front page and in the token page's Signal Check tab.

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
- **Signal registry:** an extra line, "Registered on Signal: Yes (mint authority revoked)". It says "registered", not "launched", because the registry holds both tokens launched on Signal and tokens listed afterwards, and doesn't record which.

**Cost per uncached X-Ray** (cached 5 minutes per mint; 1 minute if something was unavailable):

| Source | Calls |
|---|---|
| Solana RPC (Helius) | about 20–25: 3–5 `getMultipleAccounts`, 1–2 `getTokenLargestAccounts`, 0–1 `getTokenSupply`, 1 `simulateTransaction`, 1 `getSignaturesForAddress`, up to 15 `getTransaction` (one batched request) |
| Jupiter (existing key) | 1 order request, for the sell simulation |
| DEX Screener | 1 (free, no key) |
| Signal API | 1 |

## V2: not built yet

- **Bundle and insider exposure (main V2 item).** The share of supply bought in the launch block by wallets that share a funding source, shown on the bubble map. Each bundle links to its transactions and to the shared funding transfer.
- **Clusters.** Buys bundled in the same block, and wallets funded from shared sources.
- **Creator plus linked wallets.** Their combined share of supply.
- **Bubble map.** The top ~50 holders from Helius data, drawn with our own D3 build (no third-party embed). Clusters and bundles are highlighted on it.
- **Dev wallet sells.** When and how much the creator (and linked wallets) sold, with transaction links.
- **Snipers and insiders at launch.** Wallets that bought in the first blocks, and how much they still hold.
- **"Launched on Signal" line.** Needs the registry to record each token's origin (launched on Signal or listed afterwards) at registration. That's a change to the launch/registration flow, so it needs the owner's approval first.

## V3: not built yet

- **Wallet X-Ray.** Paste any wallet into the same box (see Design). It shows:
  - **the tokens it launched and each outcome**: LP removed, down 95% or more, abandoned (no trades for a set period), or still trading. Each outcome links to the transactions behind it. When nothing is found: "no previous launches found from this wallet". Never "creator is safe".
  - **its SOL funding source**: a fresh wallet, an exchange, or a wallet that also funded other launches (with links).
- **Serial-launch fingerprints.** Link creators through facts they share, each shown with its evidence, never as a label:
  - shared funding wallets;
  - reused logo/image hashes;
  - reused website templates;
  - recycled X/Telegram links.
- **Copycat warning.** A name or logo matching an existing token.
- **Liquidity-removal timeline.** Adds and removals over time.
- **Holder trend.** Holder count and concentration over time.
- **Wash-trading signs.** Circular trades between related wallets.
- **Social links check.** Links in the metadata: present, reachable, and pointing back to this mint.

## V4: not built yet

- **Rug timelines.** An automatic, factual timeline for tokens that died: creation, bundled buys, dev sells, LP removal. Each step links to its transaction on Solscan, and the timeline is shareable. Only what the transactions show; no conclusions about intent.
- **Live rug alerts.** A "Watch this token" button on the result (see Design) watches X-Rayed or watchlisted tokens. Alerts cover dev sells, dumps by linked holders and LP removal, on the site and through Signal's public Telegram channel. Each alert is a fact with its transaction link.

## Later

- **Base and BNB versions.** Contract ownership, proxy/upgradeability, tax and blacklist functions, and a sell simulation via `eth_call`.
- **Telegram safety bot** reusing the same engine. The same rules apply: facts with links, markers and "why", no labels and no verdicts.
