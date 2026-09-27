// Real Solana Mainnet token-creation flow — Phase 4 of the master build
// instruction ("complete real Solana Mainnet deployment architecture,
// but DO NOT deploy"). This code is genuinely capable of creating a real
// token on Solana Mainnet if run with a funded wallet and real internet
// access. It has NEVER been executed from this sandbox — no internet
// access here, and no one has run it with a real wallet either. Writing
// real, correct code and actually executing it against mainnet are two
// different things; only the first has happened.
//
// SIGNAL's 1% creator trading fee is paid in SOL by the trading layer.
// It is deliberately NOT implemented as Token-2022 TransferFeeConfig,
// because that mechanism withholds the launched token rather than SOL.
//
// Mainnet browser RPC traffic is routed through SIGNAL's server-side
// proxy so the configured provider URL/key is never exposed to the
// client. Devnet is never offered to users (docs/ROADMAP.md Stage 6);
// it exists only for testing this flow, in a build made with
// SIGNAL_SOLANA_CLUSTER=devnet (see build.tsx/Shell.tsx). Such a build
// talks to the public Devnet RPC directly and keeps its launches out of
// the Mainnet dashboard and recovery record (see listOnSignal for the
// token registry).
import * as web3 from "./vendor/solana-web3.js";
import * as splToken from "./vendor/spl-token.js";
import { apiUrl } from "./api-config.js";
// Generated at build time from packages/config (the one place it is set).
import { SIGNAL_PLATFORM_WALLET_ADDRESS } from "./platform-wallet.js";
import { launchTransactionDifference, finalizeSignedTransaction } from "./launch-integrity.js";

const SIGNAL_SOLANA_RPC_PROXY = "/api/solana/rpc";
const IS_DEVNET = window.SIGNAL_SOLANA_CLUSTER === "devnet";
const SOLANA_RPC_ENDPOINT = IS_DEVNET
  ? "https://api.devnet.solana.com"
  // web3.js rejects relative endpoints, so resolve the proxy against this origin.
  : new URL(SIGNAL_SOLANA_RPC_PROXY, window.location.origin).toString();
const EXPLORER_CLUSTER_QUERY = IS_DEVNET ? "?cluster=devnet" : "";
const SIGNAL_PLATFORM_WALLET = new web3.PublicKey(SIGNAL_PLATFORM_WALLET_ADDRESS); // public fee recipient, not a secret
const SIGNAL_LAUNCH_FEE_LAMPORTS = 1_000_000; // 0.001 SOL = 1% of the configured 0.1 SOL launch-price basis

// Both launch transactions carry their own compute budget. Phantom adds a
// priority fee to any transaction that has none, which changes the
// message and (correctly) trips the simulated-vs-signed check below.
// At the ~40k units these transactions use, this price adds ~0.000002 SOL.
const COMPUTE_UNIT_LIMIT_MAX = 1_400_000;
const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 50_000;
// An RPC node can briefly not know a blockhash another node just returned.
const BLOCKHASH_RETRIES = 4;
const BLOCKHASH_RETRY_DELAY_MS = 1_500;

// Matches MINIMUM_TOKEN_SUPPLY in packages/types exactly (manually
// synced — same constraint as the constant above). Deliberately
// duplicated from wizard.js's own copy of this same check, not shared
// via a global: this is the REAL gate, immediately before anything that
// costs real SOL, and must not depend on wizard.js having run, loaded,
// or agreed — see the call site below for where this is actually
// enforced, and B2 in the Mainnet-readiness audit for why.
const MINIMUM_TOKEN_SUPPLY = 100_000_000;
// SPL Token stores amounts (supply * 10^decimals) as a u64.
const MAX_TOKEN_DECIMALS = 9;
const U64_MAX = 18_446_744_073_709_551_615n;
// No fallback: a launch needs an explicit decimals value, since it is
// minted into the token permanently.
function validateDecimals(raw) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length === 0) return { valid: false, error: `Enter the number of decimals (0 to ${MAX_TOKEN_DECIMALS}).` };
  if (!/^[0-9]$/.test(trimmed)) {
    return { valid: false, error: `Decimals must be a whole number from 0 to ${MAX_TOKEN_DECIMALS}.` };
  }
  return { valid: true, error: null };
}
function validateSupply(raw, decimals) {
  const trimmed = (raw || "").trim();
  if (trimmed.length === 0) return { valid: false, error: "Enter a total supply." };
  if (!/^[0-9]+$/.test(trimmed)) {
    return { valid: false, error: "Supply must be a whole number \u2014 no decimals, commas, or signs." };
  }
  const asNumber = Number(trimmed);
  if (asNumber === 0) return { valid: false, error: "Supply cannot be zero." };
  if (asNumber < MINIMUM_TOKEN_SUPPLY) {
    return { valid: false, error: `Minimum supply is ${MINIMUM_TOKEN_SUPPLY.toLocaleString()}.` };
  }
  const maxSupply = U64_MAX / 10n ** BigInt(decimals);
  if (BigInt(trimmed) > maxSupply) {
    return { valid: false, error: `Maximum supply with ${decimals} decimals is ${maxSupply.toLocaleString()}.` };
  }
  return { valid: true, error: null };
}

// Real, persistent record of a launch that isn't finished yet — written
// the moment step 1 confirms. Its `stage` says what is left:
//  - "supply" (or no stage, for older records): the mint exists but its
//    supply was never minted. Exists so a failure between the two steps
//    can never lose track of a mint that real SOL was already spent
//    creating (see B1 in the Mainnet-readiness audit).
//  - "listing": supply minted and locked, but Signal hasn't confirmed the
//    listing yet (e.g. the API was down). Kept so the listing can still be
//    retried after a reload.
// Cleared only once Signal confirms the listing (or the creator dismisses it).
const PENDING_LAUNCH_KEY = IS_DEVNET ? "signal_pending_launch_devnet_v1" : "signal_pending_launch_v1";
function savePendingLaunch(record) {
  try {
    localStorage.setItem(PENDING_LAUNCH_KEY, JSON.stringify(record));
  } catch {
    // storage unavailable — the mint-created log line below is still
    // the user's record of it for this session
  }
}
function getPendingLaunch() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_LAUNCH_KEY) || "null");
  } catch {
    return null;
  }
}
// Only clears the record if it is for this mint, so finishing one launch
// can never erase the record of a different, still-incomplete one.
function clearPendingLaunch(mintAddress) {
  try {
    if (getPendingLaunch()?.mint === mintAddress) localStorage.removeItem(PENDING_LAUNCH_KEY);
  } catch {
    // nothing to do — worst case a stale pending notice shows again later
  }
}

function isListingStage(record) {
  return record?.stage === "listing";
}
function markPendingListing(record) {
  savePendingLaunch({ ...record, stage: "listing" });
}

function short(addr) {
  return addr.slice(0, 4) + "\u2026" + addr.slice(-4);
}
function explorerLink(signature) {
  return `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER_QUERY}`;
}
function explorerAddressLink(address) {
  return `https://explorer.solana.com/address/${address}${EXPLORER_CLUSTER_QUERY}`;
}
function supplyLockMessage(verified, mintAddress) {
  return verified
    ? `<b>Supply locked.</b> Mint authority revoked and verified on-chain — no more tokens can ever be minted.`
    : `The mint authority revoke is in the confirmed supply transaction, but the mint couldn't be read back yet. ` +
      `Check <a href="${explorerAddressLink(mintAddress)}" target="_blank">Explorer</a> shows no Mint Authority.`;
}

// Polls instead of web3's confirmTransaction, which needs a websocket
// that the RPC proxy doesn't serve. Same approach as swap-execute.js, but
// without searchTransactionHistory: a just-submitted signature is always
// in the RPC's recent status cache (which outlives the blockhash window),
// while a history search for a not-yet-seen one can take 20s+.
async function waitForConfirmation(connection, signature, lastValidBlockHeight) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let status;
    try {
      status = await connection.getSignatureStatus(signature);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    if (status.value?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
    if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") return;
    let blockHeight;
    try {
      blockHeight = await connection.getBlockHeight("confirmed");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    if (blockHeight > lastValidBlockHeight) throw new Error("The transaction expired before confirmation.");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Submitted, but confirmation could not be verified yet. Check ${explorerLink(signature)} before retrying.`);
}

class LaunchFlow {
  constructor(rootEl) {
    this.root = rootEl;
    this.connection = new web3.Connection(SOLANA_RPC_ENDPOINT, "confirmed");
    this.wallet = null;
    this.mintKeypair = null;
  }

  setStepState(step, state, extra) {
    const row = this.root.querySelector(`[data-launch-step="${step}"] [data-state]`);
    if (row) row.textContent = state + (extra ? ` \u2014 ${extra}` : "");
  }

  log(html) {
    const el = this.root.querySelector("#launch-result");
    if (el) el.innerHTML += html + "<br>";
  }

  async connectWallet() {
    if (!window.solana || !window.solana.isPhantom) {
      throw new Error("Phantom not found \u2014 install the extension to continue.");
    }
    const resp = await window.solana.connect();
    this.wallet = window.solana;
    return resp.publicKey;
  }

  /** Create the mint account and initialize the mint.
   *  SIGNAL's creator trading fee is not a Token-2022 transfer fee:
   *  it will be collected in SOL by the trading layer. This avoids
   *  accumulating potentially worthless project tokens.
   *  The same transaction pays SIGNAL's fixed 0.001 SOL launch fee
   *  to the public platform wallet. */
  async buildCreateTx(launcherPubkey, decimals) {
this.mintKeypair = web3.Keypair.generate();
    const mint = this.mintKeypair.publicKey;
    const mintLen = splToken.MINT_SIZE;
    const lamports = await this.connection.getMinimumBalanceForRentExemption(mintLen);

    const tx = await this.buildBudgetedTx(launcherPubkey, [
      web3.SystemProgram.transfer({
        fromPubkey: launcherPubkey,
        toPubkey: SIGNAL_PLATFORM_WALLET,
        lamports: SIGNAL_LAUNCH_FEE_LAMPORTS,
      }),
      web3.SystemProgram.createAccount({
        fromPubkey: launcherPubkey,
        newAccountPubkey: mint,
        space: mintLen,
        lamports,
        programId: splToken.TOKEN_PROGRAM_ID,
      }),
      splToken.createInitializeMintInstruction(mint, decimals, launcherPubkey, null, splToken.TOKEN_PROGRAM_ID),
    ]);
    tx.partialSign(this.mintKeypair);
    return { tx, mint, lamports };
  }

  /** Prefixes the instructions with a compute unit limit (measured by a
   *  probe simulation at the maximum limit, plus 20%) and a fixed unit
   *  price, then sets a fresh blockhash. signSubmitConfirm still
   *  simulates this exact final message before asking for a signature. */
  async buildBudgetedTx(feePayer, instructions) {
    const probe = new web3.Transaction().add(
      web3.ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT_MAX }),
      web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS }),
      ...instructions,
    );
    probe.feePayer = feePayer;
    probe.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    const simulation = await this.connection.simulateTransaction(
      new web3.VersionedTransaction(probe.compileMessage()),
      { sigVerify: false, replaceRecentBlockhash: true },
    );
    if (simulation.value.err) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }
    const units = Math.min(
      Math.ceil((simulation.value.unitsConsumed || COMPUTE_UNIT_LIMIT_MAX) * 1.2),
      COMPUTE_UNIT_LIMIT_MAX,
    );

    const tx = new web3.Transaction().add(
      web3.ComputeBudgetProgram.setComputeUnitLimit({ units }),
      web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS }),
      ...instructions,
    );
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = feePayer;
    return tx;
  }

  /** Mint the full supply to the creator and permanently revoke the mint
   *  authority, in one transaction: either the supply exists and is
   *  locked, or neither happened. Revoking is mandatory — no Signal
   *  launch can ever mint more than its declared supply. */
  async buildMintSupplyTx(launcherPubkey, mint, totalSupply, decimals) {
    const ata = splToken.getAssociatedTokenAddressSync(mint, launcherPubkey, false, splToken.TOKEN_PROGRAM_ID);
    const amount = totalSupply * 10n ** BigInt(decimals);
    const tx = await this.buildBudgetedTx(launcherPubkey, [
      splToken.createAssociatedTokenAccountInstruction(launcherPubkey, ata, launcherPubkey, mint, splToken.TOKEN_PROGRAM_ID),
      splToken.createMintToInstruction(mint, ata, launcherPubkey, amount, [], splToken.TOKEN_PROGRAM_ID),
      splToken.createSetAuthorityInstruction(mint, launcherPubkey, splToken.AuthorityType.MintTokens, null, [], splToken.TOKEN_PROGRAM_ID),
    ]);
    return { tx, ata, amount };
  }

  /** Reads the mint back after the supply transaction confirms. Returns
   *  true once the chain shows no mint authority and exactly `amount`
   *  supply; throws if it shows anything else; returns false if the
   *  account can't be read (RPC trouble), since the confirmed
   *  transaction is atomic and is still the source of truth then. */
  async verifySupplyLocked(mint, amount) {
    this.setStepState("lock", "checking");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let info;
      try {
        info = await Promise.race([
          splToken.getMint(this.connection, mint, "confirmed", splToken.TOKEN_PROGRAM_ID),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10_000)),
        ]);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      if (info.mintAuthority !== null) {
        this.setStepState("lock", "failed", "mint authority is still set");
        throw new Error(`Mint authority is still set to ${info.mintAuthority.toBase58()} — supply is NOT locked.`);
      }
      if (info.supply !== amount) {
        this.setStepState("lock", "failed", "unexpected supply");
        throw new Error(`On-chain supply is ${info.supply} base units, expected ${amount}.`);
      }
      this.setStepState("lock", "supply locked");
      return true;
    }
    this.setStepState("lock", "not verified yet");
    return false;
  }

  /** Simulate the exact transaction, then sign, submit and confirm against
   *  the same blockhash. Wallet mutation of the simulated message is rejected. */
  /** Simulates the exact message (retrying briefly if the RPC node hasn't
   *  seen its fresh blockhash yet); throws with the reason if it fails. */
  async simulateExact(tx, stepName) {
    for (let attempt = 1; ; attempt += 1) {
      // web3.js only accepts a config object alongside a VersionedTransaction;
      // wrapping the legacy message keeps the exact blockhash and instructions.
      const simulation = await this.connection.simulateTransaction(
        new web3.VersionedTransaction(tx.compileMessage()),
        { sigVerify: false, replaceRecentBlockhash: false },
      );
      const err = simulation.value.err;
      if (!err) return;
      if (err === "BlockhashNotFound" && attempt < BLOCKHASH_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, BLOCKHASH_RETRY_DELAY_MS));
        continue;
      }
      this.setStepState(stepName, "failed", JSON.stringify(err));
      throw new Error(`Simulation failed: ${JSON.stringify(err)}`);
    }
  }

  /** Simulate the exact transaction, then sign, submit and confirm against
   *  the same blockhash. The wallet may only add its known safety and
   *  compute-budget instructions (launch-integrity.js); any change to our
   *  own instructions, accounts or amounts is rejected. `extraSigners` are
   *  our own co-signers, re-applied if the wallet changed the message. */
  async signSubmitConfirm(tx, stepName, extraSigners = []) {
    if (!tx.recentBlockhash || !tx.lastValidBlockHeight) {
      throw new Error("Transaction is missing its confirmation blockhash.");
    }

    this.setStepState(stepName, "simulating");
    await this.simulateExact(tx, stepName);

    // Snapshot what was simulated before the wallet sees the transaction.
    const expectedMessage = tx.compileMessage();
    const expectedMessageBytes = tx.serializeMessage();
    this.setStepState(stepName, "awaiting_signature");
    const signed = await this.wallet.signTransaction(tx);
    const difference = launchTransactionDifference(web3, expectedMessage, signed.compileMessage());
    if (difference) {
      this.setStepState(stepName, "failed", "wallet changed transaction");
      throw new Error(`Wallet changed the transaction (${difference}); nothing was submitted.`);
    }
    // The wallet's additions are checks, not changes, but what gets sent is
    // simulated exactly as signed.
    if (finalizeSignedTransaction(expectedMessageBytes, signed, extraSigners)) {
      this.setStepState(stepName, "simulating");
      await this.simulateExact(signed, stepName);
    }

    this.setStepState(stepName, "submitted");
    const signature = await this.sendWithBlockhashRetry(signed.serialize());
    this.setStepState(stepName, "confirming", signature);

    try {
      await waitForConfirmation(this.connection, signature, tx.lastValidBlockHeight);
    } catch (err) {
      this.setStepState(stepName, "failed", err.message);
      throw err;
    }
    this.setStepState(stepName, "confirmed", signature);
    this.log(`✓ ${stepName}: <a href="${explorerLink(signature)}" target="_blank" rel="noopener noreferrer">${signature}</a>`);
    return signature;
  }

  /** Resending the same signed bytes is safe (same signature); this only
   *  covers an RPC node that hasn't seen the blockhash yet. */
  async sendWithBlockhashRetry(rawTransaction) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.connection.sendRawTransaction(rawTransaction, { skipPreflight: false, maxRetries: 5 });
      } catch (err) {
        if (!/blockhash not found/i.test(err?.message ?? "") || attempt >= BLOCKHASH_RETRIES) throw err;
        await new Promise((resolve) => setTimeout(resolve, BLOCKHASH_RETRY_DELAY_MS));
      }
    }
  }
}

// Real, persistent record of actually-completed launches — written only
// here, only after both transactions above have genuinely confirmed.
// The Dashboard page reads this same key; it never writes to it itself.
// Includes creatorAddress and decimals so confirmed launches can be restored
// and synchronized across the dashboard without inventing missing metadata.
const LAUNCHES_KEY = IS_DEVNET ? "signal_devnet_launches_v1" : "signal_real_launches_v1";
function recordRealLaunch(entry) {
  try {
    const existing = JSON.parse(localStorage.getItem(LAUNCHES_KEY) || "[]");
    existing.push(entry);
    localStorage.setItem(LAUNCHES_KEY, JSON.stringify(existing));
  } catch {
    // storage unavailable — the real launch itself already succeeded
    // on-chain regardless; this only affects the local dashboard list
  }
}

// Lists a confirmed launch on Signal (POST /api/v1/tokens/register) —
// what makes packages/types' TokenIdentity.launchedOnSignal a real,
// checkable fact for anyone, not just this browser. The server only
// accepts it from a signed-in session of the creator wallet and checks
// on-chain that this wallet created the mint (audit item C2), so this
// signs in first via auth-client.js: Phantom signs a sign-in message
// (no transaction, no SOL) unless a session for this wallet is cached.
// Never breaks the launch: it already succeeded on-chain, so a failure
// here is shown with a retry button, not as a launch failure.
// A Devnet test build only lists against an explicitly configured test
// API (SIGNAL_API_BASE_URL); the production API verifies against
// Mainnet, where a Devnet mint doesn't exist, so it would refuse anyway.
// `onListed` runs once Signal confirms the listing (including after a
// later Try again), and when there is nothing to list against.
async function listOnSignal(entry, containerEl, onListed = () => {}) {
  if (IS_DEVNET && !window.SIGNAL_API_BASE_URL) {
    onListed();
    return;
  }
  const line = document.createElement("div");
  containerEl.appendChild(line);
  const register = (sessionToken) => fetch(apiUrl("/api/v1/tokens/register"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({
      chain: "solana",
      address: entry.mint,
      name: entry.name,
      symbol: entry.symbol,
      decimals: entry.decimals,
    }),
  });
  const attempt = async () => {
    line.textContent = "Listing on Signal — Phantom may ask you to sign a message (no transaction, no SOL)…";
    try {
      const auth = window.signalAuth;
      if (!auth) throw new Error("Wallet sign-in isn't available on this page.");
      let res = await register(await auth.ensureSignedIn(entry.creatorAddress));
      // A cached session can have expired server-side: sign in once more.
      if (res.status === 401) res = await register(await auth.signIn(entry.creatorAddress));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `Registration failed (${res.status}).`);
      line.textContent = "Listed on Signal — creator verified on-chain.";
      onListed();
    } catch (err) {
      // Timestamped so a retry that fails the same way still visibly changes.
      line.textContent = `Not listed on Signal yet (${new Date().toLocaleTimeString()}): ${err.message} `;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn-ghost";
      retry.textContent = "Try again";
      retry.addEventListener("click", attempt, { once: true });
      line.appendChild(retry);
    }
  };
  await attempt();
}

// ---------------------------------------------------------------------
// Cross-reload recovery notice — deliberately its own top-level block,
// not nested inside the wizard-gated IIFE below. A pending launch must
// stay recoverable no matter which chain happens to be selected in the
// wizard right now (the mainnet panel below is hidden whenever a
// non-Solana chain is selected) or which step the wizard is on — this
// runs unconditionally, once, on page load. It has its own connect
// button and its own call into buildMintSupplyTx; it does not depend on
// the wizard-gated flow below having run, and vice versa.
(function () {
  const noticeEl = document.getElementById("pending-launch-notice");
  if (!noticeEl) return; // not the Create page

  const pending = getPendingLaunch();
  if (!pending) return;
  const listingOnly = isListingStage(pending);
  const entry = { name: pending.name, symbol: pending.symbol, mint: pending.mint, decimals: pending.decimals, creatorAddress: pending.creatorAddress };

  noticeEl.hidden = false;
  noticeEl.innerHTML =
    `<div class="tax-box" style="border-color:var(--gold);margin-bottom:20px;">` +
    (listingOnly
      ? `<b>Launched, not yet listed on Signal.</b> "<span data-pending-name></span>" (<span data-pending-symbol></span>) ` +
        `was created and its supply minted and locked, but Signal hasn't confirmed the listing yet.<br>`
      : `<b>Incomplete launch found.</b> A mint for "<span data-pending-name></span>" (<span data-pending-symbol></span>) was created, ` +
        `but its supply was never minted — nothing was lost.<br>`) +
    `Mint address: <span class="num">${pending.mint}</span><br>` +
    `<a href="${explorerAddressLink(pending.mint)}" target="_blank">View on Solana Explorer</a>` +
    `<div style="margin-top:10px;">` +
    `<button id="pendingResumeConnect" class="btn btn-ghost">${listingOnly ? "Connect wallet to list on Signal" : "Connect wallet to finish"}</button>` +
    `<button id="pendingDismiss" class="btn btn-ghost" style="margin-left:8px;">Dismiss</button>` +
    `<span id="pendingResumeStatus" style="margin-left:10px;"></span>` +
    `</div></div>`;
  // Name and symbol come from storage; set as text, never as HTML.
  noticeEl.querySelector("[data-pending-name]").textContent = pending.name;
  noticeEl.querySelector("[data-pending-symbol]").textContent = pending.symbol;

  const connectEl = document.getElementById("pendingResumeConnect");
  const dismissEl = document.getElementById("pendingDismiss");
  const statusEl = document.getElementById("pendingResumeStatus");
  const onListed = () => {
    clearPendingLaunch(pending.mint);
    dismissEl.style.display = "none";
  };

  // New launches are blocked while this record exists (see the launch
  // button below), so the creator needs a deliberate way to give up on it.
  dismissEl.addEventListener("click", () => {
    const question = listingOnly
      ? `Stop tracking mint ${pending.mint}? The token stays on-chain; you can still list it later with "List an existing token".`
      : `Stop tracking mint ${pending.mint}? It stays on-chain with no supply, and this page will no longer offer to finish it.`;
    if (!window.confirm(question)) return;
    clearPendingLaunch(pending.mint);
    noticeEl.hidden = true;
    noticeEl.innerHTML = "";
  });

  connectEl.addEventListener("click", async () => {
    connectEl.disabled = true;
    try {
      if (!window.solana || !window.solana.isPhantom) {
        throw new Error("Phantom not found — install the extension to continue.");
      }
      const resp = await window.solana.connect();
      const connected = resp.publicKey;

      if (connected.toBase58() !== pending.creatorAddress) {
        statusEl.textContent = `Connected wallet doesn't match the one that created this mint (${short(pending.creatorAddress)}). Switch wallets and try again.`;
        connectEl.disabled = false;
        return;
      }

      if (listingOnly) {
        // Nothing left on-chain: only the listing, with its own Try again.
        connectEl.style.display = "none";
        await listOnSignal(entry, statusEl.parentElement, onListed);
        return;
      }

      connectEl.textContent = "Finishing…";
      const flow = new LaunchFlow(noticeEl);
      flow.wallet = window.solana;
      const mint = new web3.PublicKey(pending.mint);
      const supply = BigInt(pending.supply);

      const { tx, amount } = await flow.buildMintSupplyTx(connected, mint, supply, pending.decimals);
      await flow.signSubmitConfirm(tx, "supply");

      // Confirmed, so the supply is final: never offer "finish" again, but
      // keep the record (stage "listing") until Signal confirms the listing.
      markPendingListing(pending);
      recordRealLaunch({
        name: pending.name,
        symbol: pending.symbol,
        mint: pending.mint,
        creatorAddress: pending.creatorAddress,
        decimals: pending.decimals,
        launchedAt: new Date().toISOString(),
      });
      connectEl.style.display = "none";
      const done = `<b>Done.</b> Supply minted — <a href="${explorerAddressLink(pending.mint)}" target="_blank">view on Explorer</a>.<br>`;
      statusEl.innerHTML = done + "Checking the supply lock…";
      try {
        statusEl.innerHTML = done + supplyLockMessage(await flow.verifySupplyLocked(mint, amount), pending.mint);
      } catch (lockErr) {
        statusEl.innerHTML = done + `<b style="color:var(--down)">Supply lock check failed:</b> `;
        statusEl.append(lockErr.message);
      }
      await listOnSignal(entry, statusEl.parentElement, onListed);
    } catch (err) {
      statusEl.textContent = `Failed: ${err.message}`;
      connectEl.disabled = false;
      connectEl.textContent = listingOnly ? "Connect wallet to list on Signal" : "Connect wallet to finish";
    }
  });
})();

(function () {
  const panel = document.getElementById("launch-mainnet-panel");
  if (!panel) return; // this page's chain isn't Solana, or panel not present

  const connectBtn = document.getElementById("mainnetConnectBtn");
  const launchBtn = document.getElementById("mainnetLaunchBtn");
  const ackCheckbox = document.getElementById("mainnetAck");
  const addrEl = document.getElementById("mainnetWalletAddr");
  const resultEl = document.getElementById("launch-result");

  if (IS_DEVNET) {
    const warning = panel.querySelector(".tax-box p");
    if (warning) {
      warning.textContent = "DEVNET TEST BUILD — this creates a token on Solana Devnet using devnet SOL. Nothing here touches Mainnet.";
    }
  }

  const flow = new LaunchFlow(panel);
  let connectedPubkey = null;

  // Set once a mint has genuinely been created but its supply hasn't
  // been minted yet, WITHIN THIS SAME PAGE VIEW after step 2 failed —
  // e.g. the wallet rejected the second signature. Whenever this is
  // set, clicking the launch button resumes with THIS exact mint and
  // skips buildCreateTx entirely, so a retry can never abandon it and
  // create a second, different one. (Recovery ACROSS a reload is the
  // separate, always-visible block above this IIFE — this variable only
  // ever holds a mint created earlier in the SAME execution of this
  // script, never one recovered from storage.)
  let resumeState = null;

  function refreshLaunchButton() {
    launchBtn.disabled = !(connectedPubkey && ackCheckbox.checked);
  }

  connectBtn.addEventListener("click", async () => {
    try {
      connectedPubkey = await flow.connectWallet();
      addrEl.textContent = short(connectedPubkey.toBase58());
      addrEl.style.color = "var(--up)";
      connectBtn.textContent = "Connected";
      connectBtn.disabled = true;
      const rvCreator = document.getElementById("rv-creator-wallet-live");
      if (rvCreator) rvCreator.textContent = connectedPubkey.toBase58();
      refreshLaunchButton();
    } catch (err) {
      addrEl.textContent = err.message;
      addrEl.style.color = "var(--down)";
    }
  });

  ackCheckbox.addEventListener("change", refreshLaunchButton);

  launchBtn.addEventListener("click", async () => {
    launchBtn.disabled = true;
    if (!resumeState) resultEl.innerHTML = "";
    document.getElementById("launch-steps").style.display = "block";

    try {
      let mint, name, symbol, supply, decimals;

      if (resumeState) {
        // Resuming a mint that already exists on-chain. buildCreateTx
        // must NOT run in this branch — calling it again would generate
        // a fresh Keypair and abandon the mint we're trying to finish.
        ({ mint, name, symbol, decimals } = resumeState);
        supply = BigInt(resumeState.supply);
      } else {
        // A mint saved as incomplete (e.g. before a reload) must be
        // finished or dismissed in the notice above first. Starting a
        // new launch here would create a second mint and strand it.
        const pending = getPendingLaunch();
        if (pending) {
          throw new Error(isListingStage(pending)
            ? `Your previous token (mint ${pending.mint}) isn't listed on Signal yet. List or dismiss it at the top of this page before starting a new one.`
            : `An incomplete launch (mint ${pending.mint}) is waiting at the top of this page. Finish or dismiss it before starting a new one.`);
        }

        const wizard = window.launchpadWizard || {};
        name = wizard.name || "Untitled Token";
        symbol = (wizard.symbol || "TOKEN").toUpperCase();

        // The real gate. Independent of wizard.js's own check — does not
        // trust that it ran, loaded, or agreed. Invalid decimals or supply
        // must never reach buildCreateTx below this line.
        const decimalsRaw = String(wizard.decimals ?? "");
        const decimalsCheck = validateDecimals(decimalsRaw);
        if (!decimalsCheck.valid) {
          throw new Error(decimalsCheck.error);
        }
        decimals = Number(decimalsRaw.trim());
        const supplyCheck = validateSupply(wizard.supply, decimals);
        if (!supplyCheck.valid) {
          throw new Error(supplyCheck.error);
        }
        supply = BigInt(wizard.supply.trim());

        const { tx: createTx, mint: newMint } = await flow.buildCreateTx(connectedPubkey, decimals);
        mint = newMint;
        await flow.signSubmitConfirm(createTx, "mint", [flow.mintKeypair]);

        // Step 1 has genuinely confirmed — a real mint now exists.
        // Show its address and persist it BEFORE attempting step 2, so
        // a failure there can never lose track of it.
        flow.log(`Mint created: <span class="num">${mint.toBase58()}</span> \u2014 <a href="${explorerAddressLink(mint.toBase58())}" target="_blank">view on Explorer</a>`);
        resumeState = { mint, name, symbol, supply: supply.toString(), decimals };
        savePendingLaunch({
          mint: mint.toBase58(),
          name,
          symbol,
          supply: supply.toString(),
          decimals,
          creatorAddress: connectedPubkey.toBase58(),
          createdAt: new Date().toISOString(),
        });
      }

      const { tx: supplyTx, amount } = await flow.buildMintSupplyTx(connectedPubkey, mint, supply, decimals);
      await flow.signSubmitConfirm(supplyTx, "supply");

      // The supply transaction has confirmed, so the launch is final:
      // record it before the read-back, which must never offer a retry.
      // The pending record stays (stage "listing") until Signal confirms
      // the listing, so a failed listing survives a reload.
      flow.log(`<br><b>Done.</b> Mint address: <span class="num">${mint.toBase58()}</span>`);
      flow.log(`<a href="${explorerAddressLink(mint.toBase58())}" target="_blank">View token on Solana Explorer</a>`);
      markPendingListing({
        ...(getPendingLaunch() ?? {}),
        mint: mint.toBase58(),
        name,
        symbol,
        supply: supply.toString(),
        decimals,
        creatorAddress: connectedPubkey.toBase58(),
      });
      recordRealLaunch({
        name,
        symbol,
        mint: mint.toBase58(),
        creatorAddress: connectedPubkey.toBase58(),
        decimals,
        launchedAt: new Date().toISOString(),
      });
      resumeState = null;
      launchBtn.textContent = "Launched";
      try {
        flow.log(supplyLockMessage(await flow.verifySupplyLocked(mint, amount), mint.toBase58()));
      } catch (lockErr) {
        flow.log(`<b style="color:var(--down)">Supply lock check failed:</b> ${lockErr.message}`);
      }
      const listedMint = mint.toBase58();
      await listOnSignal({ name, symbol, mint: listedMint, decimals, creatorAddress: connectedPubkey.toBase58() }, resultEl, () => clearPendingLaunch(listedMint));
    } catch (err) {
      flow.log(`<b style="color:var(--down)">Failed:</b> ${err.message}`);
      launchBtn.disabled = false;
      launchBtn.textContent = resumeState ? "Finish minting supply" : "Retry";
    }
  });
})();

// ---------------------------------------------------------------------
// "List an existing token": lists a mint the connected wallet already
// created, e.g. one whose listing failed after its pending record was
// gone. The server does the real checks, the same as for a launch: the
// signed-in wallet created the mint, and its mint authority is revoked.
// This only reads the mint to get its decimals and to refuse early, with
// a clear message, if the authority is still active.
(function () {
  const section = document.getElementById("list-existing");
  if (!section) return; // not the Create page

  const mintInput = document.getElementById("le-mint");
  const nameInput = document.getElementById("le-name");
  const symbolInput = document.getElementById("le-symbol");
  const submit = document.getElementById("le-submit");
  const resultEl = document.getElementById("le-result");

  submit.addEventListener("click", async () => {
    resultEl.textContent = "";
    const address = mintInput.value.trim();
    const name = nameInput.value.trim();
    const symbol = symbolInput.value.trim().toUpperCase();
    let mint;
    try {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) throw new Error("invalid");
      mint = new web3.PublicKey(address);
    } catch {
      resultEl.textContent = "Enter a valid Solana mint address.";
      return;
    }
    if (!name || !symbol) {
      resultEl.textContent = "Enter the token's name and symbol.";
      return;
    }

    submit.disabled = true;
    try {
      if (!window.solana || !window.solana.isPhantom) {
        throw new Error("Phantom not found — install the extension to continue.");
      }
      const { publicKey } = await window.solana.connect();
      resultEl.textContent = "Reading the mint on-chain…";
      const connection = new web3.Connection(SOLANA_RPC_ENDPOINT, "confirmed");
      let info;
      try {
        info = await splToken.getMint(connection, mint, "confirmed", splToken.TOKEN_PROGRAM_ID);
      } catch {
        throw new Error("Couldn't read this address as a token mint on Solana.");
      }
      if (info.mintAuthority !== null) {
        throw new Error("This mint's authority is still active, so its supply isn't locked. Only tokens with a revoked mint authority can be listed.");
      }
      resultEl.textContent = "";
      await listOnSignal(
        { name, symbol, mint: mint.toBase58(), decimals: info.decimals, creatorAddress: publicKey.toBase58() },
        resultEl,
        () => clearPendingLaunch(mint.toBase58()),
      );
    } catch (err) {
      resultEl.textContent = `Not listed: ${err.message}`;
    } finally {
      submit.disabled = false;
    }
  });
})();
