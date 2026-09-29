// Signal Solana launch flow using a program-owned constant-product bonding
// curve. New launches NEVER mint the whole supply to the creator wallet.
// The complete supply is minted to the curve PDA's token vault; 79.31% is
// available for curve trading and 20.69% remains reserved in that vault for
// post-curve liquidity. The creator receives tokens only if they buy them.
import * as web3 from "./vendor/solana-web3.js";
import * as splToken from "./vendor/spl-token.js";
import { SIGNAL_PLATFORM_WALLET_ADDRESS } from "./platform-wallet.js";
import { SIGNAL_BONDING_CURVE_PROGRAM_ID } from "./bonding-curve-program.js";
import { apiUrl } from "./api-config.js";
import { launchTransactionDifference, finalizeSignedTransaction } from "./launch-integrity.js";
import { createSignedDataItem, toHex } from "./ans104.js";
import { createTurboClient, uploadDataItems, arweaveUrl, StoragePaymentDeclined } from "./turbo-upload.js";
import {
  validateTokenName,
  validateTokenSymbol,
  validateDescription,
  validateLogo,
  buildMetadataJson,
  createMetadataInstruction,
  metadataAddress,
  decodeMetadataAccount,
  TOKEN_METADATA_PROGRAM_ID,
} from "./token-metadata.js";

const RPC_PROXY = "/api/solana/rpc";
const IS_DEVNET = window.SIGNAL_SOLANA_CLUSTER === "devnet";
const RPC_ENDPOINT = IS_DEVNET ? "https://api.devnet.solana.com" : new URL(RPC_PROXY, window.location.origin).toString();
const EXPLORER_SUFFIX = IS_DEVNET ? "?cluster=devnet" : "";
const PLATFORM_WALLET = new web3.PublicKey(SIGNAL_PLATFORM_WALLET_ADDRESS);
const LAUNCH_FEE_LAMPORTS = 1_000_000; // current Signal launch charge: 0.001 SOL
const MINIMUM_TOKEN_SUPPLY = 100_000_000n;
const U64_MAX = 18_446_744_073_709_551_615n;
const MAX_DECIMALS = 9;
const COMPUTE_LIMIT_MAX = 1_400_000;
const COMPUTE_PRICE_MICRO_LAMPORTS = 50_000;
const INITIAL_REAL_BPS = 7_931n;
const BPS = 10_000n;
const CURVE_STATE_LEN = 128;
const PENDING_KEY = IS_DEVNET ? "signal_curve_pending_devnet_v1" : "signal_curve_pending_v1";
const LAUNCHES_KEY = IS_DEVNET ? "signal_devnet_launches_v2" : "signal_real_launches_v2";

function programId() {
  if (!SIGNAL_BONDING_CURVE_PROGRAM_ID) return null;
  try { return new web3.PublicKey(SIGNAL_BONDING_CURVE_PROGRAM_ID); } catch { return null; }
}

function curveAddress(mint, pid) {
  return web3.PublicKey.findProgramAddressSync([new TextEncoder().encode("bonding-curve"), mint.toBytes()], pid)[0];
}

function explorerAddress(address) {
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}${EXPLORER_SUFFIX}`;
}
function explorerTx(signature) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${EXPLORER_SUFFIX}`;
}
function short(address) { return `${address.slice(0, 4)}…${address.slice(-4)}`; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); } catch { return null; }
}
function savePending(value) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(value)); } catch { /* recovery is best-effort */ }
}
function clearPending(mint) {
  try { if (readPending()?.mint === mint) localStorage.removeItem(PENDING_KEY); } catch { /* no-op */ }
}
function recordLaunch(entry) {
  try {
    const existing = JSON.parse(localStorage.getItem(LAUNCHES_KEY) || "[]");
    if (!existing.some((item) => item.mint === entry.mint)) existing.push(entry);
    localStorage.setItem(LAUNCHES_KEY, JSON.stringify(existing));
  } catch { /* on-chain launch remains valid */ }
}

function u64Le(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}
function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function validateSupply(rawSupply, decimals) {
  const text = String(rawSupply ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error("Enter the total supply as a whole number.");
  const whole = BigInt(text);
  if (whole < MINIMUM_TOKEN_SUPPLY) throw new Error("Minimum supply is 100,000,000 tokens.");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) throw new Error("Decimals must be from 0 to 9.");
  const raw = whole * 10n ** BigInt(decimals);
  if (raw > U64_MAX) throw new Error(`That supply is too large with ${decimals} decimals.`);
  return { whole, raw };
}

function decodeCurve(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length !== CURVE_STATE_LEN || bytes[0] !== 1) throw new Error("Unexpected Signal bonding-curve state.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const key = (offset) => new web3.PublicKey(bytes.slice(offset, offset + 32));
  return {
    bump: bytes[1],
    complete: bytes[2] !== 0,
    graduated: bytes[3] !== 0,
    mint: key(4),
    creator: key(36),
    virtualTokenReserves: view.getBigUint64(68, true),
    virtualSolReserves: view.getBigUint64(76, true),
    realTokenReserves: view.getBigUint64(84, true),
    realSolReserves: view.getBigUint64(92, true),
    totalSupply: view.getBigUint64(100, true),
    initialRealTokenReserves: view.getBigUint64(108, true),
    decimals: bytes[116],
  };
}

async function compliance(action, address) {
  const checks = window.signalCompliance;
  if (!checks) throw new Error("Signal's safety checks did not load. Reload the page and try again.");
  if (action === "connect") {
    if (!(await checks.beforeConnect())) throw new Error("Wallet connection is not available until the terms are accepted.");
    return;
  }
  const result = await checks.check(action, address);
  if (!result.ok) throw new Error(result.message);
}

async function listOnSignal(entry, container, onListed = () => {}) {
  if (IS_DEVNET && !window.SIGNAL_API_BASE_URL) { onListed(); return; }
  const line = document.createElement("div");
  container.appendChild(line);
  const url = IS_DEVNET ? apiUrl("/api/v1/tokens/register") : "/api/v1/tokens/register";
  try {
    const auth = window.signalAuth;
    if (!auth) throw new Error("Wallet sign-in is unavailable.");
    let token = await auth.ensureSignedIn(entry.creatorAddress);
    let response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ chain: "solana", address: entry.mint, name: entry.name, symbol: entry.symbol, decimals: entry.decimals }),
    });
    if (response.status === 401) {
      token = await auth.signIn(entry.creatorAddress);
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ chain: "solana", address: entry.mint, name: entry.name, symbol: entry.symbol, decimals: entry.decimals }),
      });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok && !(response.status === 409 && body.error === "TOKEN_ALREADY_REGISTERED")) {
      throw new Error(body.message || body.error || `Registration failed (${response.status}).`);
    }
    line.textContent = "Listed on Signal.";
    onListed();
  } catch (error) {
    line.textContent = `Token launched on-chain, but Signal listing still needs a retry: ${error.message}`;
  }
}

class CurveLaunchFlow {
  constructor(panel) {
    this.panel = panel;
    this.connection = new web3.Connection(RPC_ENDPOINT, "confirmed");
    this.wallet = null;
    this.mintKeypair = null;
    this.storedMetadata = null;
  }

  setStep(step, text, detail = "") {
    const node = this.panel.querySelector(`[data-launch-step="${step}"] [data-state]`);
    if (node) node.textContent = detail ? `${text} — ${detail}` : text;
  }
  logText(text) {
    const node = this.panel.querySelector("#launch-result");
    if (node) node.append(document.createTextNode(text), document.createElement("br"));
  }
  logLink(label, href) {
    const node = this.panel.querySelector("#launch-result");
    if (!node) return;
    const link = Object.assign(document.createElement("a"), { textContent: label, href, target: "_blank", rel: "noopener noreferrer" });
    node.append(link, document.createElement("br"));
  }

  async ensureProgramReady() {
    const pid = programId();
    if (!pid) throw new Error("Signal's bonding-curve program is not configured in this build. Launching is disabled rather than sending the full supply to the creator wallet.");
    const account = await this.connection.getAccountInfo(pid, "confirmed");
    if (!account?.executable) throw new Error("Signal's bonding-curve program is not deployed on this Solana cluster yet. Launching remains disabled.");
    return pid;
  }

  async connect() {
    const provider = window.phantom?.solana || window.solana;
    if (!provider?.isPhantom) throw new Error("Phantom not found.");
    await compliance("connect");
    const response = await provider.connect();
    this.wallet = provider;
    await this.ensureProgramReady();
    return response.publicKey;
  }

  async buildTransaction(payer, instructions) {
    const tx = new web3.Transaction().add(
      web3.ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_LIMIT_MAX }),
      web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE_MICRO_LAMPORTS }),
      ...instructions,
    );
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    tx.feePayer = payer;
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    return tx;
  }

  async signSubmit(tx, step, extraSigners = []) {
    this.setStep(step, "simulating");
    const simulation = await this.connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: false });
    if (simulation.value.err) throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
    const expectedMessage = tx.compileMessage();
    const expectedBytes = tx.serializeMessage();
    this.setStep(step, "awaiting signature");
    const signed = await this.wallet.signTransaction(tx);
    const difference = launchTransactionDifference(web3, expectedMessage, signed.compileMessage());
    if (difference) throw new Error(`Wallet changed the transaction (${difference}); nothing was submitted.`);
    if (finalizeSignedTransaction(expectedBytes, signed, extraSigners)) {
      const recheck = await this.connection.simulateTransaction(signed, { sigVerify: false, replaceRecentBlockhash: false });
      if (recheck.value.err) throw new Error(`Final signed transaction failed simulation: ${JSON.stringify(recheck.value.err)}`);
    }
    const signature = await this.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 5 });
    this.setStep(step, "confirming", signature);
    for (let i = 0; i < 60; i += 1) {
      const status = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true }).catch(() => null);
      if (status?.value?.err) throw new Error("The transaction failed on Solana.");
      if (["confirmed", "finalized"].includes(status?.value?.confirmationStatus)) {
        this.setStep(step, "confirmed");
        this.logLink(`✓ ${step}: ${signature}`, explorerTx(signature));
        return signature;
      }
      await sleep(1_000);
    }
    throw new Error(`Submitted but confirmation is not visible yet. Check ${explorerTx(signature)} before retrying.`);
  }

  async payForStorage(payer, lamports, depositAddress, onSent) {
    const tx = await this.buildTransaction(payer, [web3.SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: new web3.PublicKey(depositAddress),
      lamports: Number(lamports),
    })]);
    const signature = await this.signSubmit(tx, "upload");
    onSent(signature);
    return signature;
  }

  confirmStoragePayment({ lamports, reason, depositAddress }) {
    return Promise.resolve(window.confirm(
      `Permanent metadata storage is not free for this upload. ArDrive Turbo requires ${Number(lamports) / 1e9} SOL to ${short(depositAddress)}. Reason: ${reason}. Continue?`,
    ));
  }

  async storagePaymentStatus(signature) {
    const value = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true }).catch(() => null);
    if (value?.value?.err) return "failed";
    if (["confirmed", "finalized"].includes(value?.value?.confirmationStatus)) return "confirmed";
    return "pending";
  }

  async storeMetadata(payer, { name, symbol, description, logoBytes, logoType }) {
    const logoHash = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", logoBytes)));
    const cacheKey = JSON.stringify([payer.toBase58(), name, symbol, description, logoType, logoHash]);
    if (this.storedMetadata?.key === cacheKey) return this.storedMetadata.uri;
    const owner = payer.toBytes();
    const signMessage = async (bytes) => Uint8Array.from((await this.wallet.signMessage(bytes, "utf8")).signature);
    this.setStep("upload", "sign logo upload");
    const logo = await createSignedDataItem({ owner, data: logoBytes, tags: [{ name: "Content-Type", value: logoType }, { name: "App-Name", value: "Signal" }], signMessage });
    const imageUri = arweaveUrl(logo.id);
    this.setStep("upload", "sign metadata upload");
    const json = await createSignedDataItem({
      owner,
      data: buildMetadataJson({ name, symbol, description, imageUri, imageType: logoType }),
      tags: [{ name: "Content-Type", value: "application/json" }, { name: "App-Name", value: "Signal" }],
      signMessage,
    });
    const uri = arweaveUrl(json.id);
    if (!IS_DEVNET) {
      await uploadDataItems({
        items: [{ label: "the logo", id: logo.id, bytes: logo.bytes }, { label: "the metadata", id: json.id, bytes: json.bytes }],
        ownerAddress: payer.toBase58(),
        turbo: createTurboClient(),
        store: {
          get: (key) => { try { return JSON.parse(localStorage.getItem(`signal_${key}`) || "null"); } catch { return null; } },
          set: (key, value) => { try { localStorage.setItem(`signal_${key}`, JSON.stringify(value)); } catch { /* no-op */ } },
          remove: (key) => { try { localStorage.removeItem(`signal_${key}`); } catch { /* no-op */ } },
        },
        approvePayment: (quote) => this.confirmStoragePayment(quote),
        pay: (details) => this.payForStorage(payer, details.lamports, details.depositAddress, details.onSent),
        paymentStatus: (signature) => this.storagePaymentStatus(signature),
        onStatus: (text) => this.setStep("upload", text),
      });
    }
    this.storedMetadata = { key: cacheKey, uri };
    this.setStep("upload", IS_DEVNET ? "signed (Devnet)" : "stored on Arweave");
    return uri;
  }

  async createMint(payer, decimals, metadata) {
    this.mintKeypair = web3.Keypair.generate();
    const mint = this.mintKeypair.publicKey;
    const rent = await this.connection.getMinimumBalanceForRentExemption(splToken.MINT_SIZE);
    const tx = await this.buildTransaction(payer, [
      web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: PLATFORM_WALLET, lamports: LAUNCH_FEE_LAMPORTS }),
      web3.SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint, space: splToken.MINT_SIZE, lamports: rent, programId: splToken.TOKEN_PROGRAM_ID }),
      splToken.createInitializeMintInstruction(mint, decimals, payer, null, splToken.TOKEN_PROGRAM_ID),
      createMetadataInstruction(web3, { mint, mintAuthority: payer, payer, name: metadata.name, symbol: metadata.symbol, uri: metadata.uri }),
    ]);
    tx.partialSign(this.mintKeypair);
    await this.signSubmit(tx, "mint", [this.mintKeypair]);
    return mint;
  }

  initializeCurveInstruction(pid, mint, curve, vault, creator, rawSupply, decimals) {
    return new web3.TransactionInstruction({
      programId: pid,
      keys: [
        { pubkey: curve, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: creator, isSigner: true, isWritable: true },
        { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: concatBytes(Uint8Array.of(0), u64Le(rawSupply), Uint8Array.of(decimals)),
    });
  }

  async initializeCurve(payer, mint, rawSupply, decimals) {
    const pid = await this.ensureProgramReady();
    const curve = curveAddress(mint, pid);
    const vault = splToken.getAssociatedTokenAddressSync(mint, curve, true, splToken.TOKEN_PROGRAM_ID);
    const createAta = splToken.createAssociatedTokenAccountIdempotentInstruction || splToken.createAssociatedTokenAccountInstruction;
    const tx = await this.buildTransaction(payer, [
      createAta(payer, vault, curve, mint, splToken.TOKEN_PROGRAM_ID),
      splToken.createMintToInstruction(mint, vault, payer, rawSupply, [], splToken.TOKEN_PROGRAM_ID),
      splToken.createSetAuthorityInstruction(mint, payer, splToken.AuthorityType.MintTokens, null, [], splToken.TOKEN_PROGRAM_ID),
      this.initializeCurveInstruction(pid, mint, curve, vault, payer, rawSupply, decimals),
    ]);
    await this.signSubmit(tx, "curve");
    await this.verifyCurve(mint, curve, vault, rawSupply, decimals);
    return { curve, vault };
  }

  async verifyCurve(mint, curve, vault, rawSupply, decimals) {
    this.setStep("lock", "verifying curve custody");
    const pid = await this.ensureProgramReady();
    const [mintInfo, curveInfo, vaultInfo] = await Promise.all([
      splToken.getMint(this.connection, mint, "confirmed", splToken.TOKEN_PROGRAM_ID),
      this.connection.getAccountInfo(curve, "confirmed"),
      splToken.getAccount(this.connection, vault, "confirmed", splToken.TOKEN_PROGRAM_ID),
    ]);
    if (mintInfo.mintAuthority !== null || mintInfo.freezeAuthority !== null || BigInt(mintInfo.supply.toString()) !== rawSupply) {
      throw new Error("Mint supply/authorities do not match the locked launch configuration.");
    }
    if (!curveInfo || !curveInfo.owner.equals(pid)) throw new Error("Bonding-curve state account was not created by the Signal program.");
    const state = decodeCurve(curveInfo.data);
    const expectedReal = rawSupply * INITIAL_REAL_BPS / BPS;
    if (!state.mint.equals(mint) || !state.creator.equals(this.wallet.publicKey) || state.totalSupply !== rawSupply || state.realTokenReserves !== expectedReal || state.decimals !== decimals) {
      throw new Error("Bonding-curve state does not match the launch configuration.");
    }
    if (!vaultInfo.owner.equals(curve) || !vaultInfo.mint.equals(mint) || BigInt(vaultInfo.amount.toString()) !== rawSupply) {
      throw new Error("The full token supply is not held by the program-owned bonding-curve vault.");
    }
    this.setStep("lock", "verified — creator received 0 tokens automatically");
    return state;
  }

  async verifyMetadata(mint, expected) {
    const address = metadataAddress(web3, mint);
    const info = await this.connection.getAccountInfo(address, "confirmed");
    if (!info || info.owner.toBase58() !== TOKEN_METADATA_PROGRAM_ID) return false;
    const found = decodeMetadataAccount(info.data);
    if (found.name !== expected.name || found.symbol !== expected.symbol || found.uri !== expected.uri || found.isMutable) {
      throw new Error("On-chain metadata does not match the immutable launch metadata.");
    }
    return true;
  }
}

function mountPendingRecovery() {
  const host = document.getElementById("pending-launch-notice");
  const pending = readPending();
  if (!host || !pending) return;
  host.hidden = false;
  const box = document.createElement("div");
  box.className = "tax-box";
  box.style.borderColor = "var(--gold)";
  const title = document.createElement("b");
  title.textContent = pending.stage === "listing" ? "Curve launch completed; Signal listing pending." : "Incomplete curve launch found.";
  const text = document.createElement("p");
  text.textContent = `${pending.name} (${pending.symbol}) — ${pending.mint}`;
  const button = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-brand", textContent: pending.stage === "listing" ? "Finish listing" : "Finish bonding-curve launch" });
  const status = document.createElement("div");
  status.style.marginTop = "8px";
  box.append(title, text, button, status);
  host.replaceChildren(box);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const flow = new CurveLaunchFlow(host);
      const creator = await flow.connect();
      if (creator.toBase58() !== pending.creatorAddress) throw new Error(`Switch Phantom to ${short(pending.creatorAddress)} to finish this launch.`);
      await compliance("launch", creator.toBase58());
      const mint = new web3.PublicKey(pending.mint);
      const rawSupply = BigInt(pending.rawSupply);
      let curveAddressText = pending.curve;
      if (pending.stage !== "listing") {
        const mintInfo = await splToken.getMint(flow.connection, mint, "confirmed", splToken.TOKEN_PROGRAM_ID);
        if (mintInfo.mintAuthority === null) {
          const pid = await flow.ensureProgramReady();
          const curve = curveAddress(mint, pid);
          const info = await flow.connection.getAccountInfo(curve, "confirmed");
          if (!info) throw new Error("Mint authority is already revoked but the Signal curve state is missing. Do not retry automatically; inspect this mint first.");
          curveAddressText = curve.toBase58();
        } else {
          const result = await flow.initializeCurve(creator, mint, rawSupply, pending.decimals);
          curveAddressText = result.curve.toBase58();
        }
        pending.stage = "listing";
        pending.curve = curveAddressText;
        savePending(pending);
        recordLaunch({ ...pending, launchedAt: new Date().toISOString() });
      }
      status.textContent = "Curve is live. Finishing Signal listing…";
      await listOnSignal(pending, status, () => clearPending(pending.mint));
      button.style.display = "none";
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
}

(function mountCurveLaunch() {
  mountPendingRecovery();
  const panel = document.getElementById("launch-mainnet-panel");
  if (!panel) return;
  const connectButton = document.getElementById("mainnetConnectBtn");
  const launchButton = document.getElementById("mainnetLaunchBtn");
  const ack = document.getElementById("mainnetAck");
  const metadataAck = document.getElementById("metadataAck");
  const walletLabel = document.getElementById("mainnetWalletAddr");
  const result = document.getElementById("launch-result");
  const flow = new CurveLaunchFlow(panel);
  let creator = null;

  if (!programId()) {
    launchButton.disabled = true;
    launchButton.textContent = "Bonding curve deployment required";
    connectButton.title = "The old full-supply-to-creator launch path is disabled.";
  }

  const refresh = () => {
    if (!programId()) return;
    launchButton.disabled = !(creator && ack?.checked && metadataAck?.checked);
  };

  connectButton?.addEventListener("click", async () => {
    try {
      creator = await flow.connect();
      walletLabel.textContent = short(creator.toBase58());
      walletLabel.style.color = "var(--up)";
      connectButton.textContent = "Connected";
      connectButton.disabled = true;
      document.getElementById("rv-creator-wallet-live").textContent = creator.toBase58();
      refresh();
    } catch (error) {
      walletLabel.textContent = error.message;
      walletLabel.style.color = "var(--down)";
    }
  });
  ack?.addEventListener("change", refresh);
  metadataAck?.addEventListener("change", refresh);

  launchButton?.addEventListener("click", async () => {
    launchButton.disabled = true;
    result.replaceChildren();
    document.getElementById("launch-steps").style.display = "block";
    try {
      if (!creator) throw new Error("Connect Phantom first.");
      await compliance("launch", creator.toBase58());
      await flow.ensureProgramReady();
      if (readPending()) throw new Error("Finish the incomplete launch shown at the top of this page first.");

      const wizard = window.launchpadWizard || {};
      const nameCheck = validateTokenName(wizard.name);
      const symbolCheck = validateTokenSymbol(wizard.symbol);
      const descriptionCheck = validateDescription(wizard.description);
      if (!nameCheck.valid) throw new Error(nameCheck.error);
      if (!symbolCheck.valid) throw new Error(symbolCheck.error);
      if (!descriptionCheck.valid) throw new Error(descriptionCheck.error);
      if (!wizard.logoFile) throw new Error("Choose a logo image.");
      if (!metadataAck.checked || !ack.checked) throw new Error("Confirm the launch details first.");
      const decimals = Number(String(wizard.decimals ?? "").trim());
      const { raw: rawSupply } = validateSupply(wizard.supply, decimals);
      const logoBytes = new Uint8Array(await wizard.logoFile.arrayBuffer());
      const logoCheck = validateLogo(logoBytes);
      if (!logoCheck.valid) throw new Error(logoCheck.error);

      const metadataUri = await flow.storeMetadata(creator, {
        name: nameCheck.value,
        symbol: symbolCheck.value,
        description: descriptionCheck.value,
        logoBytes,
        logoType: logoCheck.contentType,
      });
      const mint = await flow.createMint(creator, decimals, { name: nameCheck.value, symbol: symbolCheck.value, uri: metadataUri });
      const pending = {
        stage: "curve",
        mint: mint.toBase58(),
        name: nameCheck.value,
        symbol: symbolCheck.value,
        supply: String(wizard.supply).trim(),
        rawSupply: rawSupply.toString(),
        decimals,
        metadataUri,
        creatorAddress: creator.toBase58(),
        createdAt: new Date().toISOString(),
      };
      savePending(pending);
      flow.logText(`Mint created: ${pending.mint}. No tokens have been sent to the creator wallet.`);

      const { curve, vault } = await flow.initializeCurve(creator, mint, rawSupply, decimals);
      pending.stage = "listing";
      pending.curve = curve.toBase58();
      pending.curveVault = vault.toBase58();
      savePending(pending);
      recordLaunch({ ...pending, launchedAt: new Date().toISOString() });
      flow.logText("Bonding curve live: 79.31% available on the curve; 20.69% reserved in the program vault for graduation liquidity.");
      flow.logLink("View curve account on Solana Explorer", explorerAddress(curve.toBase58()));
      await flow.verifyMetadata(mint, { name: pending.name, symbol: pending.symbol, uri: metadataUri });
      await listOnSignal(pending, result, () => clearPending(pending.mint));
      launchButton.textContent = "Launched on bonding curve";
    } catch (error) {
      const text = error instanceof StoragePaymentDeclined ? "Storage payment declined." : error.message;
      flow.logText(`Failed: ${text}`);
      launchButton.textContent = readPending() ? "Resume at top of page" : "Retry";
      refresh();
    }
  });

  panel.dataset.ready = "true";
})();

// Existing-token listing remains available, but it does not pretend an
// externally-created token was launched through Signal's curve.
(function mountExistingListing() {
  const section = document.getElementById("list-existing");
  if (!section) return;
  const submit = document.getElementById("le-submit");
  const output = document.getElementById("le-result");
  submit?.addEventListener("click", async () => {
    const mintText = document.getElementById("le-mint").value.trim();
    const name = document.getElementById("le-name").value.trim();
    const symbol = document.getElementById("le-symbol").value.trim().toUpperCase();
    output.textContent = "";
    submit.disabled = true;
    try {
      const mint = new web3.PublicKey(mintText);
      const provider = window.phantom?.solana || window.solana;
      if (!provider?.isPhantom) throw new Error("Phantom not found.");
      await compliance("connect");
      const { publicKey } = await provider.connect();
      await compliance("launch", publicKey.toBase58());
      const connection = new web3.Connection(RPC_ENDPOINT, "confirmed");
      const info = await splToken.getMint(connection, mint, "confirmed", splToken.TOKEN_PROGRAM_ID);
      if (info.mintAuthority !== null) throw new Error("This mint still has an active mint authority.");
      if (!name || !symbol) throw new Error("Enter the token name and symbol.");
      await listOnSignal({ name, symbol, mint: mint.toBase58(), decimals: info.decimals, creatorAddress: publicKey.toBase58() }, output);
    } catch (error) {
      output.textContent = `Not listed: ${error.message}`;
    } finally { submit.disabled = false; }
  });
})();
