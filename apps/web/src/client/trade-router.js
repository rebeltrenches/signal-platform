// Token-page trade router. Signal-launched tokens trade against their
// program-owned bonding curve until it completes. Tokens without a live
// Signal curve fall back to the existing Jupiter route.
import * as web3 from "./vendor/solana-web3.js";
import * as splToken from "./vendor/spl-token.js";
import { SIGNAL_PLATFORM_WALLET_ADDRESS } from "./platform-wallet.js";
import { SIGNAL_BONDING_CURVE_PROGRAM_ID } from "./bonding-curve-program.js";
import { launchTransactionDifference, finalizeSignedTransaction } from "./launch-integrity.js";

const RPC = new URL("/api/solana/rpc", window.location.origin).toString();
const FEE_BPS = 100n;
const BPS = 10_000n;
const STATE_LEN = 128;
const PLATFORM_WALLET = new web3.PublicKey(SIGNAL_PLATFORM_WALLET_ADDRESS);
const COMPUTE_LIMIT = 250_000;
const COMPUTE_PRICE = 50_000;

const params = new URLSearchParams(window.location.search);
const pathAddress = window.location.pathname.split("/").filter(Boolean).pop() || "";
const tokenMintText = params.get("mint") || pathAddress;
const chain = (params.get("chain") || "solana").toLowerCase();

function pid() {
  if (!SIGNAL_BONDING_CURVE_PROGRAM_ID) return null;
  try { return new web3.PublicKey(SIGNAL_BONDING_CURVE_PROGRAM_ID); } catch { return null; }
}
function curvePda(mint, programId) {
  return web3.PublicKey.findProgramAddressSync([new TextEncoder().encode("bonding-curve"), mint.toBytes()], programId)[0];
}
function decodeState(data) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (b.length !== STATE_LEN || b[0] !== 1) throw new Error("Invalid Signal curve state.");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    complete: b[2] !== 0,
    graduated: b[3] !== 0,
    mint: new web3.PublicKey(b.slice(4, 36)),
    virtualTokens: v.getBigUint64(68, true),
    virtualSol: v.getBigUint64(76, true),
    realTokens: v.getBigUint64(84, true),
    realSol: v.getBigUint64(92, true),
    totalSupply: v.getBigUint64(100, true),
    initialRealTokens: v.getBigUint64(108, true),
    decimals: b[116],
  };
}
function ceilDiv(n, d) { return (n + d - 1n) / d; }
function fee(amount) { return amount * FEE_BPS / BPS; }
function finalFee(net) { return ceilDiv(net * FEE_BPS, BPS - FEE_BPS); }
function u64(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}
function data(op, a, b) {
  const out = new Uint8Array(17);
  out[0] = op;
  out.set(u64(a), 1);
  out.set(u64(b), 9);
  return out;
}
function parseUnits(text, decimals) {
  if (!/^\d+(\.\d*)?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  if (frac.length > decimals) return null;
  const raw = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  return raw > 0n ? raw : null;
}
function formatUnits(raw, decimals, maxFraction = 6) {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return `${whole}${fraction ? "." + fraction : ""}`;
}
function formatSol(lamports) { return `${formatUnits(lamports, 9, 6)} SOL`; }

function quoteBuy(s, maxGross) {
  const maxFee = fee(maxGross);
  if (maxFee <= 0n || maxFee >= maxGross) throw new Error("Amount is too small.");
  const maxNet = maxGross - maxFee;
  const k = s.virtualTokens * s.virtualSol;
  const newVs = s.virtualSol + maxNet;
  const newVt = ceilDiv(k, newVs);
  const theoretical = s.virtualTokens - newVt;
  if (theoretical <= 0n) throw new Error("Amount is too small to buy a token unit.");
  if (theoretical <= s.realTokens) return { gross: maxGross, net: maxNet, fee: maxFee, tokens: theoretical };
  const tokens = s.realTokens;
  const targetVt = s.virtualTokens - tokens;
  const requiredVs = ceilDiv(k, targetVt);
  const net = requiredVs - s.virtualSol;
  const exactFee = finalFee(net);
  const gross = net + exactFee;
  if (gross > maxGross) throw new Error("Amount is not enough for the final curve fill.");
  return { gross, net, fee: exactFee, tokens };
}
function quoteSell(s, tokenIn) {
  if (s.realTokens + tokenIn > s.initialRealTokens) throw new Error("You cannot sell more tokens back than the curve has sold.");
  const k = s.virtualTokens * s.virtualSol;
  const newVt = s.virtualTokens + tokenIn;
  const newVs = ceilDiv(k, newVt);
  const gross = s.virtualSol - newVs;
  if (gross <= 0n || gross > s.realSol) throw new Error("The curve does not have enough real SOL for this sell.");
  const tradeFee = fee(gross);
  return { tokens: tokenIn, gross, fee: tradeFee, net: gross - tradeFee };
}
function priceImpactBuy(s, q) {
  const before = Number(s.virtualSol) / Number(s.virtualTokens);
  const after = Number(s.virtualSol + q.net) / Number(s.virtualTokens - q.tokens);
  return before > 0 ? Math.max(0, (after / before) - 1) : 0;
}
function priceImpactSell(s, q) {
  const before = Number(s.virtualSol) / Number(s.virtualTokens);
  const after = Number(s.virtualSol - q.gross) / Number(s.virtualTokens + q.tokens);
  return before > 0 ? Math.max(0, 1 - (after / before)) : 0;
}

async function fallback() {
  await import("./swap-execute.js?v=swap-confirmation-retry-8");
}

async function signAndSend(connection, provider, tx) {
  const simulation = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: false });
  if (simulation.value.err) throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
  const expectedMessage = tx.compileMessage();
  const expectedBytes = tx.serializeMessage();
  const signed = await provider.signTransaction(tx);
  const difference = launchTransactionDifference(web3, expectedMessage, signed.compileMessage());
  if (difference) throw new Error(`Wallet changed the transaction (${difference}); nothing was submitted.`);
  if (finalizeSignedTransaction(expectedBytes, signed, [])) {
    const finalSimulation = await connection.simulateTransaction(signed, { sigVerify: false, replaceRecentBlockhash: false });
    if (finalSimulation.value.err) throw new Error(`Final transaction failed simulation: ${JSON.stringify(finalSimulation.value.err)}`);
  }
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 5 });
  for (let i = 0; i < 60; i += 1) {
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true }).catch(() => null);
    if (status?.value?.err) throw new Error("The transaction failed on Solana.");
    if (["confirmed", "finalized"].includes(status?.value?.confirmationStatus)) return signature;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Submitted as ${signature}, but confirmation is not visible yet. Check Solana Explorer before retrying.`);
}

async function mountCurveTrading({ connection, programId, mint, curve, state }) {
  const terminal = document.getElementById("trade-terminal");
  const execute = document.getElementById("trade-execute-btn");
  const preview = document.getElementById("trade-quote-btn");
  const amount = document.getElementById("trade-amount");
  const status = document.getElementById("trade-status");
  const router = document.getElementById("trade-router");
  const routed = document.getElementById("trade-routed");
  const output = document.getElementById("trade-output");
  const impact = document.getElementById("trade-impact");
  const feeRow = document.getElementById("trade-signal-fee");
  const execution = document.getElementById("trade-execution");
  if (!terminal || !execute || !amount) return;

  const buttons = terminal.querySelectorAll("button.chip");
  const buyButton = document.getElementById("trade-buy") || buttons[0];
  const sellButton = buttons[1];
  if (sellButton) { sellButton.disabled = false; sellButton.title = "Sell tokens back into the Signal bonding curve"; }
  const label = terminal.querySelector('label[for="trade-amount"]');
  const presets = amount.nextElementSibling;
  let mode = "buy";
  let currentState = state;
  let lastQuote = null;

  function applyProgress(s) {
    const sold = s.initialRealTokens - s.realTokens;
    const pct = s.initialRealTokens > 0n ? Number(sold * 10_000n / s.initialRealTokens) / 100 : 0;
    const stat = document.querySelector('[data-stat="curveProgress"]');
    if (stat) {
      stat.hidden = false;
      const value = stat.querySelector(".v");
      if (value) value.textContent = `${pct.toFixed(2)}%`;
    }
  }
  applyProgress(currentState);
  if (router) router.textContent = "Signal bonding curve";
  if (feeRow) feeRow.textContent = "1% in SOL, enforced by the curve program";
  if (execution) execution.textContent = "One on-chain curve transaction; wallet confirmation required";

  async function refreshState() {
    const info = await connection.getAccountInfo(curve, "confirmed");
    if (!info || !info.owner.equals(programId)) throw new Error("Signal curve state is unavailable.");
    currentState = decodeState(info.data);
    applyProgress(currentState);
    return currentState;
  }

  function setMode(next) {
    mode = next;
    buyButton?.setAttribute("aria-pressed", String(mode === "buy"));
    sellButton?.setAttribute("aria-pressed", String(mode === "sell"));
    if (label) label.textContent = mode === "buy" ? "Amount in SOL" : "Amount in tokens";
    amount.value = "";
    amount.placeholder = mode === "buy" ? "0.05" : "1000000";
    if (presets) presets.hidden = mode === "sell";
    execute.textContent = mode === "buy" ? "Review curve buy in Phantom" : "Review curve sell in Phantom";
    lastQuote = null;
    if (routed) routed.textContent = "—";
    if (output) output.textContent = "—";
    if (impact) impact.textContent = "—";
  }
  buyButton?.addEventListener("click", () => setMode("buy"));
  sellButton?.addEventListener("click", () => setMode("sell"));
  setMode("buy");

  async function buildQuote() {
    const s = await refreshState();
    if (s.complete || s.graduated) throw new Error("The bonding curve is complete. Curve trading is closed for graduation.");
    if (mode === "buy") {
      const gross = parseUnits(amount.value.trim(), 9);
      if (!gross) throw new Error("Enter a valid SOL amount.");
      const q = quoteBuy(s, gross);
      lastQuote = { ...q, mode, state: s, impact: priceImpactBuy(s, q) };
      routed.textContent = formatSol(q.net);
      output.textContent = `${formatUnits(q.tokens, s.decimals)} tokens`;
      impact.textContent = `${(lastQuote.impact * 100).toFixed(2)}%`;
      feeRow.textContent = `${formatSol(q.fee)} (1%)`;
    } else {
      const tokenIn = parseUnits(amount.value.trim(), s.decimals);
      if (!tokenIn) throw new Error(`Enter a valid token amount with at most ${s.decimals} decimals.`);
      const q = quoteSell(s, tokenIn);
      lastQuote = { ...q, mode, state: s, impact: priceImpactSell(s, q) };
      routed.textContent = `${formatUnits(q.tokens, s.decimals)} tokens`;
      output.textContent = formatSol(q.net);
      impact.textContent = `${(lastQuote.impact * 100).toFixed(2)}%`;
      feeRow.textContent = `${formatSol(q.fee)} (1%)`;
    }
    if (status) status.textContent = "Live quote from the on-chain Signal curve. Execution uses 1% slippage protection.";
    return lastQuote;
  }

  preview?.addEventListener("click", async () => {
    try { await buildQuote(); } catch (error) { if (status) status.textContent = error.message; }
  });

  execute.addEventListener("click", async () => {
    const provider = window.phantom?.solana || window.solana;
    if (!window.launchpadWallet?.address || !provider?.isPhantom) {
      document.getElementById("wallet-connect-btn")?.click();
      return;
    }
    const compliance = window.signalCompliance;
    const cleared = compliance ? await compliance.check("trade", window.launchpadWallet.address) : { ok: false, message: "Signal safety checks did not load." };
    if (!cleared.ok) { if (status) status.textContent = cleared.message; return; }

    execute.disabled = true;
    try {
      const quote = await buildQuote();
      if (quote.impact > 0.10) throw new Error("Trade blocked because curve price impact exceeds 10%.");
      if (quote.impact > 0.05 && !window.confirm(`Curve price impact is ${(quote.impact * 100).toFixed(2)}%. Continue?`)) {
        throw new Error("Trade cancelled before wallet approval.");
      }
      const trader = new web3.PublicKey(window.launchpadWallet.address);
      const traderAta = splToken.getAssociatedTokenAddressSync(mint, trader, false, splToken.TOKEN_PROGRAM_ID);
      const curveVault = splToken.getAssociatedTokenAddressSync(mint, curve, true, splToken.TOKEN_PROGRAM_ID);
      const instructions = [
        web3.ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_LIMIT }),
        web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE }),
      ];
      if (mode === "buy") {
        const createAta = splToken.createAssociatedTokenAccountIdempotentInstruction || splToken.createAssociatedTokenAccountInstruction;
        instructions.push(createAta(trader, traderAta, trader, mint, splToken.TOKEN_PROGRAM_ID));
        const minTokens = quote.tokens * 99n / 100n;
        instructions.push(new web3.TransactionInstruction({
          programId,
          keys: [
            { pubkey: curve, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: curveVault, isSigner: false, isWritable: true },
            { pubkey: traderAta, isSigner: false, isWritable: true },
            { pubkey: trader, isSigner: true, isWritable: true },
            { pubkey: PLATFORM_WALLET, isSigner: false, isWritable: true },
            { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: data(1, quote.gross, minTokens),
        }));
      } else {
        const account = await connection.getAccountInfo(traderAta, "confirmed");
        if (!account) throw new Error("Your connected wallet does not hold this token.");
        const minSol = quote.net * 99n / 100n;
        instructions.push(new web3.TransactionInstruction({
          programId,
          keys: [
            { pubkey: curve, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: curveVault, isSigner: false, isWritable: true },
            { pubkey: traderAta, isSigner: false, isWritable: true },
            { pubkey: trader, isSigner: true, isWritable: true },
            { pubkey: PLATFORM_WALLET, isSigner: false, isWritable: true },
            { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: data(2, quote.tokens, minSol),
        }));
      }
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const tx = new web3.Transaction({ feePayer: trader, recentBlockhash: blockhash, lastValidBlockHeight }).add(...instructions);
      if (status) status.textContent = `Review the ${mode} in Phantom. Signal cannot sign for you.`;
      const signature = await signAndSend(connection, provider, tx);
      if (status) status.textContent = `Confirmed: ${signature}`;
      if (execution) execution.textContent = "Confirmed on Solana";
      await refreshState();
      lastQuote = null;
    } catch (error) {
      if (status) status.textContent = error.message;
    } finally {
      execute.disabled = false;
    }
  });

  execute.dataset.ready = "curve";
}

(async function routeTrade() {
  if (chain !== "solana" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenMintText) || tokenMintText === "example") {
    await fallback();
    return;
  }
  const programId = pid();
  if (!programId) { await fallback(); return; }
  const mint = new web3.PublicKey(tokenMintText);
  const curve = curvePda(mint, programId);
  const connection = new web3.Connection(RPC, "confirmed");
  const info = await connection.getAccountInfo(curve, "confirmed").catch(() => null);
  if (!info || !info.owner.equals(programId)) { await fallback(); return; }
  let state;
  try { state = decodeState(info.data); } catch { await fallback(); return; }
  if (!state.mint.equals(mint)) { await fallback(); return; }
  if (state.graduated) { await fallback(); return; }
  if (state.complete) {
    const button = document.getElementById("trade-execute-btn");
    const status = document.getElementById("trade-status");
    if (button) { button.disabled = true; button.textContent = "Curve complete — graduation pending"; button.dataset.ready = "curve-complete"; }
    if (status) status.textContent = "Bonding curve reached 100%. Curve trading is closed while graduation liquidity is prepared.";
    const router = document.getElementById("trade-router");
    if (router) router.textContent = "Signal bonding curve — complete";
    return;
  }
  await mountCurveTrading({ connection, programId, mint, curve, state });
})();
