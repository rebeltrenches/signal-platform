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
// Devnet is permanently excluded (docs/ROADMAP.md Stage 6). Browser RPC
// traffic is routed through SIGNAL's server-side Mainnet proxy so the
// configured provider URL/key is never exposed to the client.
import * as web3 from "https://esm.sh/@solana/web3.js@1.95.3";
import * as splToken from "https://esm.sh/@solana/spl-token@0.4.9?deps=@solana/web3.js@1.95.3";
import { apiUrl } from "./api-config.js";

const SIGNAL_SOLANA_RPC_PROXY = "/api/solana/rpc";
const SIGNAL_PLATFORM_WALLET = new web3.PublicKey("FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19"); // public fee recipient, not a secret
const SIGNAL_LAUNCH_FEE_LAMPORTS = 1_000_000; // 0.001 SOL = 1% of the configured 0.1 SOL launch-price basis

// Matches MINIMUM_TOKEN_SUPPLY in packages/types exactly (manually
// synced — same constraint as the constant above). Deliberately
// duplicated from wizard.js's own copy of this same check, not shared
// via a global: this is the REAL gate, immediately before anything that
// costs real SOL, and must not depend on wizard.js having run, loaded,
// or agreed — see the call site below for where this is actually
// enforced, and B2 in the Mainnet-readiness audit for why.
const MINIMUM_TOKEN_SUPPLY = 100_000_000;
function validateSupply(raw) {
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
  return { valid: true, error: null };
}

// Real, persistent record of a launch that got as far as a genuinely
// confirmed mint but no further — written the moment step 1 confirms,
// cleared only once step 2 also confirms. Exists so a failure between
// the two steps can never lose track of a mint that real SOL was
// already spent creating (see B1 in the Mainnet-readiness audit).
const PENDING_LAUNCH_KEY = "signal_pending_launch_v1";
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
function clearPendingLaunch() {
  try {
    localStorage.removeItem(PENDING_LAUNCH_KEY);
  } catch {
    // nothing to do — worst case a stale pending notice shows again later
  }
}

function short(addr) {
  return addr.slice(0, 4) + "\u2026" + addr.slice(-4);
}
function explorerLink(signature) {
  return `https://explorer.solana.com/tx/${signature}`;
}

class LaunchFlow {
  constructor(rootEl) {
    this.root = rootEl;
    this.connection = new web3.Connection(SIGNAL_SOLANA_RPC_PROXY, "confirmed");
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

    const tx = new web3.Transaction().add(
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
splToken.createInitializeMintInstruction(mint, decimals, launcherPubkey, null, splToken.TOKEN_PROGRAM_ID)
    );
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = launcherPubkey;
    tx.partialSign(this.mintKeypair);
    return { tx, mint, lamports };
  }

  /** Mirrors SolanaAdapter.buildMintSupplyTransaction using classic SPL Token. */
  async buildMintSupplyTx(launcherPubkey, mint, totalSupply, decimals) {
    const ata = splToken.getAssociatedTokenAddressSync(mint, launcherPubkey, false, splToken.TOKEN_PROGRAM_ID);
    const tx = new web3.Transaction().add(
      splToken.createAssociatedTokenAccountInstruction(launcherPubkey, ata, launcherPubkey, mint, splToken.TOKEN_PROGRAM_ID),
      splToken.createMintToInstruction(mint, ata, launcherPubkey, totalSupply * 10n ** BigInt(decimals), [], splToken.TOKEN_PROGRAM_ID)
    );
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = launcherPubkey;
    return { tx, ata };
  }

  /** Simulate the exact transaction, then sign, submit and confirm against
   *  the same blockhash. Wallet mutation of the simulated message is rejected. */
  async signSubmitConfirm(tx, stepName) {
    if (!tx.recentBlockhash || !tx.lastValidBlockHeight) {
      throw new Error("Transaction is missing its confirmation blockhash.");
    }

    this.setStepState(stepName, "simulating");
    const simulation = await this.connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: false,
    });
    if (simulation.value.err) {
      this.setStepState(stepName, "failed", JSON.stringify(simulation.value.err));
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    const simulatedMessage = tx.serializeMessage();
    this.setStepState(stepName, "awaiting_signature");
    const signed = await this.wallet.signTransaction(tx);
    const signedMessage = signed.serializeMessage();
    if (simulatedMessage.length !== signedMessage.length ||
        simulatedMessage.some((byte, i) => byte !== signedMessage[i])) {
      this.setStepState(stepName, "failed", "wallet changed transaction");
      throw new Error("Wallet changed the simulated transaction message.");
    }

    this.setStepState(stepName, "submitted");
    const signature = await this.connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    });
    this.setStepState(stepName, "confirming", signature);

    const confirmation = await this.connection.confirmTransaction({
      signature,
      blockhash: tx.recentBlockhash,
      lastValidBlockHeight: tx.lastValidBlockHeight,
    }, "confirmed");
    if (confirmation.value.err) {
      this.setStepState(stepName, "failed", JSON.stringify(confirmation.value.err));
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    this.setStepState(stepName, "confirmed", signature);
    this.log(`✓ ${stepName}: <a href="${explorerLink(signature)}" target="_blank" rel="noopener noreferrer">${signature}</a>`);
    return signature;
  }
}

// Real, persistent record of actually-completed launches — written only
// here, only after both transactions above have genuinely confirmed.
// The Dashboard page reads this same key; it never writes to it itself.
// Includes creatorAddress and decimals so confirmed launches can be restored
// and synchronized across the dashboard without inventing missing metadata.
const LAUNCHES_KEY = "signal_real_launches_v1";
function recordRealLaunch(entry) {
  try {
    const existing = JSON.parse(localStorage.getItem(LAUNCHES_KEY) || "[]");
    existing.push(entry);
    localStorage.setItem(LAUNCHES_KEY, JSON.stringify(existing));
  } catch {
    // storage unavailable — the real launch itself already succeeded
    // on-chain regardless; this only affects the local dashboard list
  }
  // Best-effort server-side registration — same "never breaks the real
  // flow" philosophy as the localStorage write above. The launch
  // already succeeded on-chain; whether Signal's own backend happens
  // to be reachable right now (see docs/BACKEND-DEPLOYMENT.md — as of
  // this writing, it isn't deployed anywhere) doesn't change that. A
  // failed registration here is silently swallowed, not surfaced as a
  // launch failure — this is what makes
  // packages/types' TokenIdentity.launchedOnSignal a real, checkable
  // fact for anyone (not just this browser) once a backend exists to
  // answer it, without making that backend's presence a requirement
  // for launching at all today.
  fetch(apiUrl("/api/v1/tokens/register"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chain: "solana",
      address: entry.mint,
      name: entry.name,
      symbol: entry.symbol,
      decimals: entry.decimals,
      creatorWalletAddress: entry.creatorAddress,
    }),
  }).catch(() => {});
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

  noticeEl.hidden = false;
  noticeEl.innerHTML =
    `<div class="tax-box" style="border-color:var(--gold);margin-bottom:20px;">` +
    `<b>Incomplete launch found.</b> A mint for "${pending.name}" (${pending.symbol}) was created, ` +
    `but its supply was never minted \u2014 nothing was lost.<br>` +
    `Mint address: <span class="num">${pending.mint}</span><br>` +
    `<a href="https://explorer.solana.com/address/${pending.mint}" target="_blank">View on Solana Explorer</a>` +
    `<div style="margin-top:10px;">` +
    `<button id="pendingResumeConnect" class="btn btn-ghost">Connect wallet to finish</button>` +
    `<span id="pendingResumeStatus" style="margin-left:10px;"></span>` +
    `</div></div>`;

  const connectEl = document.getElementById("pendingResumeConnect");
  const statusEl = document.getElementById("pendingResumeStatus");

  connectEl.addEventListener("click", async () => {
    connectEl.disabled = true;
    try {
      if (!window.solana || !window.solana.isPhantom) {
        throw new Error("Phantom not found \u2014 install the extension to continue.");
      }
      const resp = await window.solana.connect();
      const connected = resp.publicKey;

      if (connected.toBase58() !== pending.creatorAddress) {
        statusEl.textContent = `Connected wallet doesn't match the one that created this mint (${short(pending.creatorAddress)}). Switch wallets and try again.`;
        connectEl.disabled = false;
        return;
      }

      connectEl.textContent = "Finishing\u2026";
      const flow = new LaunchFlow(noticeEl);
      flow.wallet = window.solana;
      const mint = new web3.PublicKey(pending.mint);
      const supply = BigInt(pending.supply);

      const { tx } = await flow.buildMintSupplyTx(connected, mint, supply, pending.decimals);
      await flow.signSubmitConfirm(tx, "supply");

      clearPendingLaunch();
      recordRealLaunch({
        name: pending.name,
        symbol: pending.symbol,
        mint: pending.mint,
        creatorAddress: pending.creatorAddress,
        decimals: pending.decimals,
        launchedAt: new Date().toISOString(),
      });
      statusEl.innerHTML = `<b>Done.</b> Supply minted \u2014 <a href="https://explorer.solana.com/address/${pending.mint}" target="_blank">view on Explorer</a>.`;
      connectEl.style.display = "none";
    } catch (err) {
      statusEl.textContent = `Failed: ${err.message}`;
      connectEl.disabled = false;
      connectEl.textContent = "Connect wallet to finish";
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
        const wizard = window.launchpadWizard || {};
        name = wizard.name || "Untitled Token";
        symbol = (wizard.symbol || "TOKEN").toUpperCase();
        decimals = Number(wizard.decimals || "6");

        // The real gate. Independent of wizard.js's own check — does not
        // trust that it ran, loaded, or agreed. Invalid supply must never
        // reach buildCreateTx below this line.
        const supplyCheck = validateSupply(wizard.supply);
        if (!supplyCheck.valid) {
          throw new Error(supplyCheck.error);
        }
        supply = BigInt(wizard.supply);

        const { tx: createTx, mint: newMint } = await flow.buildCreateTx(connectedPubkey, decimals);
        mint = newMint;
        await flow.signSubmitConfirm(createTx, "mint");

        // Step 1 has genuinely confirmed — a real mint now exists.
        // Show its address and persist it BEFORE attempting step 2, so
        // a failure there can never lose track of it.
        flow.log(`Mint created: <span class="num">${mint.toBase58()}</span> \u2014 <a href="https://explorer.solana.com/address/${mint.toBase58()}" target="_blank">view on Explorer</a>`);
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

      const { tx: supplyTx } = await flow.buildMintSupplyTx(connectedPubkey, mint, supply, decimals);
      await flow.signSubmitConfirm(supplyTx, "supply");

      flow.log(`<br><b>Done.</b> Mint address: <span class="num">${mint.toBase58()}</span>`);
      flow.log(`<a href="https://explorer.solana.com/address/${mint.toBase58()}" target="_blank">View token on Solana Explorer</a>`);
      clearPendingLaunch();
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
    } catch (err) {
      flow.log(`<b style="color:var(--down)">Failed:</b> ${err.message}`);
      launchBtn.disabled = false;
      launchBtn.textContent = resumeState ? "Finish minting supply" : "Retry";
    }
  });
})();
