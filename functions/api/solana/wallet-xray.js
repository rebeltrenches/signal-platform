// Read-only Solana address detection and wallet facts. No signing or sending.
import { decodeAddress } from "./token-market.js";

const SYSTEM = "11111111111111111111111111111111";
const PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
export const HISTORY_LIMIT = 20;
const FALLBACKS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];

export function atomicAmount(raw, decimals = 9) {
  const value = BigInt(raw);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return (negative ? "-" : "") + (decimals ? digits.slice(0, -decimals) : digits) + (fraction ? "." + fraction : "");
}

const fact = (id, label, value, why, status = "info") => ({ id, label, value, why, status });
const unavailable = (id, label, reason) => ({ ...fact(id, label, "Unavailable", "Missing data does not imply zero activity.", "unavailable"), reason });

/** Only parsed, explicit SOL transfers involving the target are connections.
 * Account co-occurrence, fee payments, failed transactions and balance changes
 * are never used to infer ownership or a relationship. */
export function transactionFacts(tx, signature, address) {
  const meta = tx?.meta;
  const message = tx?.transaction?.message;
  if (!meta || !message || !Array.isArray(message.accountKeys)) return null;
  const keys = message.accountKeys.map((key) => typeof key === "string" ? key : key.pubkey);
  const index = keys.indexOf(address);
  const instructions = [...(message.instructions || []), ...(meta.innerInstructions || []).flatMap((entry) => entry.instructions || [])];
  const transfers = [];
  if (!meta.err) for (const instruction of instructions) {
    const parsed = instruction.parsed;
    const info = parsed?.info;
    if (instruction.programId !== SYSTEM && instruction.program !== "system") continue;
    if (!["transfer", "transferWithSeed"].includes(parsed?.type)) continue;
    if (!info || (info.source !== address && info.destination !== address) || info.source === info.destination) continue;
    if (!decodeAddress(info.source) || !decodeAddress(info.destination) || !Number.isSafeInteger(info.lamports) || info.lamports <= 0) continue;
    transfers.push({ source: info.source, destination: info.destination, lamports: String(info.lamports), amount: atomicAmount(info.lamports), signature });
  }
  const tokens = new Map();
  for (const [entries, sign] of [[meta.preTokenBalances, -1n], [meta.postTokenBalances, 1n]]) {
    for (const entry of entries || []) {
      const amount = entry.uiTokenAmount;
      if (entry.owner !== address || !decodeAddress(entry.mint) || !/^\d+$/.test(String(amount?.amount)) || !Number.isInteger(amount?.decimals) || amount.decimals < 0 || amount.decimals > 30) continue;
      const current = tokens.get(entry.mint) || { mint: entry.mint, raw: 0n, decimals: amount.decimals };
      current.raw += sign * BigInt(amount.amount);
      tokens.set(entry.mint, current);
    }
  }
  const before = meta.preBalances?.[index], after = meta.postBalances?.[index];
  return {
    signature, blockTime: tx.blockTime ?? null, slot: tx.slot ?? null,
    status: meta.err ? "failed" : "confirmed",
    solChange: Number.isSafeInteger(before) && Number.isSafeInteger(after) ? atomicAmount(BigInt(after) - BigInt(before)) : null,
    feeSol: Number.isSafeInteger(meta.fee) ? atomicAmount(meta.fee) : null,
    feePaidByWallet: keys[0] === address,
    tokenChanges: meta.err ? [] : [...tokens.values()].filter((token) => token.raw !== 0n).map((token) => ({ mint: token.mint, amount: atomicAmount(token.raw, token.decimals) })),
    transfers,
  };
}

export async function runAddressXray(address, env, now, runTokenXray) {
  const usage = { rpcCalls: 0, rpcByMethod: {}, priceRequests: 0 };
  const deadline = Date.now() + 60_000;
  const urls = [...new Set([...(typeof env?.SOLANA_RPC_URL === "string" && env.SOLANA_RPC_URL.startsWith("https://") ? [env.SOLANA_RPC_URL] : []), ...FALLBACKS])];
  async function rpc(method, params) {
    for (const url of urls) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Scan time budget exhausted");
      usage.rpcCalls++;
      usage.rpcByMethod[method] = (usage.rpcByMethod[method] || 0) + 1;
      try {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(Math.min(8_000, remaining)) });
        if (!response.ok) continue;
        const payload = await response.json();
        if (!payload.error && payload.result !== undefined) return payload.result;
      } catch { /* try the next configured provider */ }
    }
    throw new Error("Chain data could not be read.");
  }
  let account;
  try {
    const result = await rpc("getAccountInfo", [address, { encoding: "jsonParsed", commitment: "confirmed" }]);
    if (!result || !Object.hasOwn(result, "value")) throw new Error("Invalid account result");
    account = result.value;
  } catch {
    return { status: 502, body: { code: "UPSTREAM_ERROR", error: "Solana account data is temporarily unavailable." }, ttl: 30_000 };
  }
  if (account && PROGRAMS.includes(account.owner) && account.data?.parsed?.type === "mint") {
    const result = await runTokenXray(address, env, now);
    if (result.body.usage) {
      result.body.usage.rpcCalls += usage.rpcCalls;
      result.body.usage.rpcByMethod.getAccountInfo = (result.body.usage.rpcByMethod.getAccountInfo || 0) + usage.rpcCalls;
    }
    result.body.kind = "token";
    return result;
  }
  if (account && (account.owner !== SYSTEM || account.executable || account.data?.parsed || (Array.isArray(account.data) && account.data[0]))) {
    const type = account.data?.parsed?.type || (account.executable ? "program" : "program-owned account");
    return { status: 200, body: { kind: "account", address, generatedAt: new Date(now).toISOString(), sections: [{ id: "account", title: "Account type", items: [fact("account-type", "Detected account", type, "This address is not a token mint or a regular wallet. Open its explorer record for details.")] }], usage }, ttl: 60_000 };
  }

  const items = [], tokens = [], transactions = [], connections = new Map();
  let partial = false, balanceSol = null, tokenDataComplete = true, historyComplete = false, hasMore = false, signatures = [];
  try {
    const result = await rpc("getBalance", [address, { commitment: "confirmed" }]);
    if (!Number.isSafeInteger(result?.value) || result.value < 0) throw new Error("Invalid balance");
    balanceSol = atomicAmount(result.value);
    items.push(fact("sol-balance", "Available SOL", balanceSol + " SOL", "The native balance at confirmed commitment; token holdings are listed separately."));
  } catch {
    partial = true;
    items.push(unavailable("sol-balance", "Available SOL", "The live balance could not be read."));
  }
  const holdings = new Map();
  for (const programId of PROGRAMS) {
    try {
      const result = await rpc("getTokenAccountsByOwner", [address, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]);
      if (!Array.isArray(result?.value)) throw new Error("Invalid token accounts");
      for (const entry of result.value) {
        const info = entry?.account?.data?.parsed?.info, amount = info?.tokenAmount;
        if (!decodeAddress(info?.mint) || !/^\d+$/.test(String(amount?.amount)) || !Number.isInteger(amount?.decimals) || amount.decimals < 0 || amount.decimals > 30) { tokenDataComplete = false; continue; }
        const token = holdings.get(info.mint) || { mint: info.mint, raw: 0n, decimals: amount.decimals, frozenAccounts: 0 };
        if (token.decimals !== amount.decimals) { tokenDataComplete = false; continue; }
        token.raw += BigInt(amount.amount);
        if (info.state === "frozen") token.frozenAccounts++;
        holdings.set(info.mint, token);
      }
    } catch { tokenDataComplete = false; }
  }
  for (const token of holdings.values()) if (token.raw > 0n) tokens.push({ mint: token.mint, amount: atomicAmount(token.raw, token.decimals), decimals: token.decimals, frozenAccounts: token.frozenAccounts, usdValue: null });
  partial ||= !tokenDataComplete;
  items.push(fact("token-holdings", "Token holdings", tokens.length + (tokenDataComplete ? " non-zero mints" : " non-zero mints (partial)"), "Includes SPL Token and Token-2022; holdings are combined across token accounts. Compressed NFTs and DeFi positions are not included.", tokenDataComplete ? "info" : "unavailable"));
  if (!tokenDataComplete) items[items.length - 1].reason = "Some token account data could not be read; this list may be incomplete.";
  const frozen = tokens.reduce((sum, token) => sum + token.frozenAccounts, 0);
  items.push(fact("frozen-accounts", "Frozen token accounts", tokenDataComplete ? String(frozen) : frozen + " observed (partial)", "Frozen accounts cannot transfer their tokens until the freeze authority unfreezes them.", frozen ? "warn" : tokenDataComplete ? "info" : "unavailable"));

  // Prices are optional third-party estimates; unknown values stay null.
  let pricedSol = null;
  try {
    usage.priceRequests++;
    const mints = ["So11111111111111111111111111111111111111112", ...tokens.slice(0, 29).map((token) => token.mint)];
    const response = await fetch("https://api.dexscreener.com/tokens/v1/solana/" + mints.join(","), { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error("Price source unavailable");
    const pairs = await response.json();
    if (!Array.isArray(pairs)) throw new Error("Invalid prices");
    const prices = new Map();
    for (const pair of pairs) {
      const price = Number(pair.priceUsd), liquidity = Number(pair.liquidity?.usd);
      if (pair.chainId !== "solana" || !Number.isFinite(price) || price <= 0 || !Number.isFinite(liquidity) || liquidity <= 0) continue;
      const mint = pair.baseToken?.address;
      if (!prices.has(mint) || liquidity > prices.get(mint).liquidity) prices.set(mint, { price, liquidity, name: pair.baseToken.name, symbol: pair.baseToken.symbol });
    }
    const solPrice = prices.get(mints[0]);
    if (solPrice && balanceSol !== null) pricedSol = Number(balanceSol) * solPrice.price;
    for (const token of tokens) {
      const price = prices.get(token.mint);
      if (!price) continue;
      token.name = price.name; token.symbol = price.symbol;
      const value = Number(token.amount) * price.price;
      if (Number.isFinite(value)) token.usdValue = value;
    }
  } catch { /* verified balances remain visible without prices */ }
  const values = tokens.filter((token) => token.usdValue !== null);
  const knownUsd = values.reduce((sum, token) => sum + token.usdValue, pricedSol || 0);
  const allPriced = balanceSol !== null && pricedSol !== null && values.length === tokens.length && tokenDataComplete;
  items.push(fact("portfolio-value", "Estimated value of priced assets", pricedSol !== null || values.length ? "$" + knownUsd.toFixed(2) + (allPriced ? "" : " (partial)") : "Unavailable", "DEX Screener prices from the most liquid returned pair. Estimates may be manipulated and are not guaranteed sale proceeds; unpriced assets are excluded.", allPriced ? "info" : "unavailable"));

  let historyAvailable = false;
  try {
    const result = await rpc("getSignaturesForAddress", [address, { limit: HISTORY_LIMIT + 1, commitment: "confirmed" }]);
    if (!Array.isArray(result)) throw new Error("Invalid signatures");
    signatures = result.slice(0, HISTORY_LIMIT);
    hasMore = result.length > HISTORY_LIMIT;
    historyAvailable = true;
    // Small batches keep reads bounded and reduce public RPC rate limits.
    for (let i = 0; i < signatures.length; i += 4) {
      const batch = await Promise.allSettled(signatures.slice(i, i + 4).map(async (entry) => {
        const tx = await rpc("getTransaction", [entry.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
        const parsed = transactionFacts(tx, entry.signature, address);
        if (!parsed) throw new Error("Transaction unavailable");
        return parsed;
      }));
      for (const result of batch) if (result.status === "fulfilled") transactions.push(result.value); else partial = true;
    }
    historyComplete = !hasMore && transactions.length === signatures.length;
  } catch { partial = true; }
  for (const tx of transactions) for (const transfer of tx.transfers) {
    const peer = transfer.source === address ? transfer.destination : transfer.source;
    const node = connections.get(peer) || { address: peer, sentLamports: 0n, receivedLamports: 0n, signatures: new Set(), transfers: [] };
    if (transfer.source === address) node.sentLamports += BigInt(transfer.lamports);
    else node.receivedLamports += BigInt(transfer.lamports);
    node.signatures.add(tx.signature); node.transfers.push(transfer);
    connections.set(peer, node);
  }
  const historyItems = [
    historyAvailable ? fact("history-coverage", "History checked", transactions.length + " of " + signatures.length + " recent transactions" + (hasMore ? "; older history exists" : ""), "At most 20 recent transactions are read. Providers may prune older history; this is not a lifetime audit.", transactions.length === signatures.length ? "info" : "unavailable") : unavailable("history-coverage", "History checked", "Recent signatures could not be read."),
    fact("connections", "SOL transfer connections", String(connections.size) + " observed accounts", "Only explicit successful SOL transfers in the checked sample create links. A transfer does not prove shared ownership."),
  ];
  if (historyAvailable && transactions.length !== signatures.length) historyItems[0].reason = "Some listed transactions could not be loaded; the history and map are incomplete.";
  const inbound = transactions.flatMap((tx) => tx.transfers.filter((transfer) => transfer.destination === address).map((transfer) => ({ ...transfer, blockTime: tx.blockTime }))).filter((transfer) => Number.isFinite(transfer.blockTime)).sort((a, b) => a.blockTime - b.blockTime)[0];
  if (inbound) historyItems.push({ ...fact("observed-funding", "Earliest SOL sender in checked sample", inbound.source, "This is a transfer observed in recent history, not necessarily the wallet's original funding source."), addresses: [inbound.source], signature: inbound.signature });
  return { status: 200, ttl: partial ? 30_000 : 60_000, body: {
    kind: "wallet", address, generatedAt: new Date(now).toISOString(), cacheSeconds: partial ? 30 : 60,
    balanceSol, tokens, tokenDataComplete, transactions,
    history: { limit: HISTORY_LIMIT, listed: signatures.length, loaded: transactions.length, hasMore, sampleComplete: historyComplete, available: historyAvailable },
    connections: [...connections.values()].map((node) => ({ address: node.address, sentSol: atomicAmount(node.sentLamports), receivedSol: atomicAmount(node.receivedLamports), signatures: [...node.signatures], transfers: node.transfers })),
    sections: [{ id: "balances", title: "Balances and holdings", items }, { id: "activity", title: "Activity and connections", items: historyItems }],
    usage, note: "Read-only Solana scan. Facts, not a verdict. History and prices may be incomplete.",
  } };
}
