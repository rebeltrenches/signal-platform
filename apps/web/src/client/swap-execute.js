import * as web3 from "https://esm.sh/@solana/web3.js@1.95.3";

const SIGNAL_FEE_WALLET = new web3.PublicKey("FzUe6zmHp4gbkBMYQZuMT5fsfE8JEDauNkSSsR14LM19");
const LIGHTHOUSE_PROGRAM = new web3.PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
const RPC_PROXY = "/api/solana/rpc";
const COMPUTE_UNIT_LIMIT_MAX = 1_400_000;

function base58Encode(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = "";
  while (value > 0n) {
    result = alphabet[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result || "1";
}

function solToLamports(value) {
  if (!/^\d+(\.\d{0,9})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const lamports = BigInt(whole) * 1_000_000_000n + BigInt((fraction + "000000000").slice(0, 9));
  return lamports > 0n ? lamports : null;
}

function toInstruction(instruction) {
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(instruction.programId),
    keys: instruction.accounts.map((account) => ({
      pubkey: new web3.PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Uint8Array.from(atob(instruction.data), (char) => char.charCodeAt(0)),
  });
}

function lookupTables(raw) {
  if (!raw) return [];
  return Object.entries(raw).map(([key, addresses]) => new web3.AddressLookupTableAccount({
    key: new web3.PublicKey(key),
    state: {
      deactivationSlot: 18446744073709551615n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: addresses.map((address) => new web3.PublicKey(address)),
    },
  }));
}

function serializeBase64(transaction) {
  const bytes = transaction.serialize();
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function instructionDifference(left, right) {
  if (!left.programId.equals(right.programId)) return "program";
  if (!sameBytes(left.data, right.data)) return "data";
  if (left.keys.length !== right.keys.length) return "account-count";
  for (let index = 0; index < left.keys.length; index += 1) {
    const key = left.keys[index];
    const other = right.keys[index];
    if (!key.pubkey.equals(other.pubkey)) return "account";
    if (key.isSigner !== other.isSigner || key.isWritable !== other.isWritable) return "account-permissions";
  }
  return null;
}

function safeLighthouseAssertions(originalInstructions, signedInstructions, payer) {
  if (signedInstructions.length !== originalInstructions.length + 2) return false;
  for (let index = 0; index < originalInstructions.length; index += 1) {
    if (instructionDifference(originalInstructions[index], signedInstructions[index])) return false;
  }
  const originalAccounts = new Set([payer.toBase58()]);
  const originalWritableAccounts = new Set([payer.toBase58()]);
  for (const instruction of originalInstructions) {
    for (const key of instruction.keys) {
      originalAccounts.add(key.pubkey.toBase58());
      if (key.isWritable) originalWritableAccounts.add(key.pubkey.toBase58());
    }
  }
  return signedInstructions.slice(originalInstructions.length).every((instruction) =>
    instruction.programId.equals(LIGHTHOUSE_PROGRAM)
      && instruction.data.length > 0
      && instruction.keys.every((key) => {
        const address = key.pubkey.toBase58();
        if (!originalAccounts.has(address)) return false;
        if (key.isSigner && !key.pubkey.equals(payer)) return false;
        return !key.isWritable || originalWritableAccounts.has(address);
      }));
}

function transactionIntentDifference(original, signed, addressLookupTableAccounts) {
  if (original.recentBlockhash !== signed.recentBlockhash) return "blockhash";
  if (!original.staticAccountKeys[0]?.equals(signed.staticAccountKeys[0])) return "payer";
  const originalInstructions = web3.TransactionMessage
    .decompile(original, { addressLookupTableAccounts }).instructions
    .filter((instruction) => !instruction.programId.equals(web3.ComputeBudgetProgram.programId));
  const signedInstructions = web3.TransactionMessage
    .decompile(signed, { addressLookupTableAccounts }).instructions
    .filter((instruction) => !instruction.programId.equals(web3.ComputeBudgetProgram.programId));
  if (originalInstructions.length !== signedInstructions.length) {
    if (safeLighthouseAssertions(originalInstructions, signedInstructions, original.staticAccountKeys[0])) return null;
    const added = [];
    let expectedIndex = 0;
    for (let signedIndex = 0; signedIndex < signedInstructions.length; signedIndex += 1) {
      const expected = originalInstructions[expectedIndex];
      if (expected && !instructionDifference(expected, signedInstructions[signedIndex])) {
        expectedIndex += 1;
      } else {
        added.push(`#${signedIndex + 1} ${signedInstructions[signedIndex].programId.toBase58()}`);
      }
    }
    if (expectedIndex === originalInstructions.length && added.length) {
      return `added instruction${added.length === 1 ? "" : "s"}: ${added.join("; ")}`;
    }
    return `instruction-count (${originalInstructions.length} expected, ${signedInstructions.length} signed; original sequence was also changed)`;
  }
  for (let index = 0; index < originalInstructions.length; index += 1) {
    const difference = instructionDifference(originalInstructions[index], signedInstructions[index]);
    if (difference) return `${difference} at instruction ${index + 1}`;
  }
  return null;
}

async function waitForConfirmation(connection, signature, lastValidBlockHeight) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let status;
    try {
      status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    if (status.value?.err) throw new Error("The transaction failed on Solana.");
    if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") return;
    let blockHeight;
    try {
      blockHeight = await connection.getBlockHeight("confirmed");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    if (blockHeight > lastValidBlockHeight) throw new Error("The transaction expired before confirmation. Request a fresh route and try again.");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The transaction was submitted, but Signal could not verify confirmation yet. Check Solscan before doing anything else.");
}

(function mountSwapExecution() {
  const button = document.getElementById("trade-execute-btn");
  const status = document.getElementById("trade-status");
  const execution = document.getElementById("trade-execution");
  const amountInput = document.getElementById("trade-amount");
  if (!button || !amountInput) return;

  const params = new URLSearchParams(window.location.search);
  const pathAddress = window.location.pathname.split("/").filter(Boolean).pop() || "";
  const tokenMint = params.get("mint") || pathAddress;
  const chain = (params.get("chain") || "solana").toLowerCase();
  const validMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenMint) && tokenMint !== "example";

  function walletProvider() {
    return window.phantom?.solana || window.solana || null;
  }

  function refreshButton() {
    if (chain !== "solana" || !validMint) {
      button.disabled = true;
      button.textContent = "Trading unavailable for this token";
      return;
    }
    if (!window.launchpadWallet?.address) {
      button.disabled = false;
      button.textContent = "Connect wallet to trade";
      return;
    }
    button.disabled = false;
    button.textContent = "Review and buy in Phantom";
  }

  document.addEventListener("launchpad:wallet-connected", refreshButton);
  document.addEventListener("launchpad:wallet-disconnected", refreshButton);
  refreshButton();

  button.addEventListener("click", async () => {
    const provider = walletProvider();
    if (!window.launchpadWallet?.address || !provider?.isPhantom) {
      document.getElementById("wallet-connect-btn")?.click();
      return;
    }
    if (typeof provider.signTransaction !== "function") {
      if (status) status.textContent = "This wallet cannot sign a Solana transaction.";
      return;
    }
    const grossAmount = solToLamports(amountInput.value.trim());
    if (!grossAmount) {
      if (status) status.textContent = "Enter a valid SOL amount with no more than 9 decimal places.";
      return;
    }

    button.disabled = true;
    button.textContent = "Building atomic transaction…";
    if (status) status.textContent = "Requesting a fresh route for your connected wallet.";
    if (execution) execution.textContent = "Preparing — no signature requested yet";
    let submittedSignature = "";
    try {
      const address = window.launchpadWallet.address;
      const response = await fetch("/api/solana/swap/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenMint, amount: grossAmount.toString(), taker: address }),
      });
      const build = await response.json();
      if (!response.ok) throw new Error(build.message || "A signable route could not be built.");

      const impact = Number(build.priceImpactPct);
      if (Number.isFinite(impact) && impact > 0.10) {
        throw new Error("Trade blocked because estimated price impact exceeds 10%.");
      }
      if (Number.isFinite(impact) && impact > 0.05 && !window.confirm(`Estimated price impact is ${(impact * 100).toFixed(2)}%. Continue to Phantom?`)) {
        throw new Error("Trade cancelled before wallet approval.");
      }

      const payer = new web3.PublicKey(address);
      const feeLamports = Number(build.signalFeeLamports);
      if (!Number.isSafeInteger(feeLamports) || feeLamports <= 0) throw new Error("Invalid Signal-fee amount.");
      const instructions = [
        ...build.setupInstructions.map(toInstruction),
        toInstruction(build.swapInstruction),
        web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: SIGNAL_FEE_WALLET, lamports: feeLamports }),
        ...(build.cleanupInstruction ? [toInstruction(build.cleanupInstruction)] : []),
        ...build.otherInstructions.map(toInstruction),
      ];
      const recentBlockhash = base58Encode(Uint8Array.from(build.blockhashWithMetadata.blockhash));
      const tables = lookupTables(build.addressesByLookupTableAddress);
      const rpcEndpoint = new URL(RPC_PROXY, window.location.origin).toString();
      const connection = new web3.Connection(rpcEndpoint, "confirmed");
      const simulationMessage = new web3.TransactionMessage({
        payerKey: payer,
        recentBlockhash,
        instructions: [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT_MAX }), ...instructions],
      }).compileToV0Message(tables);
      const simulation = await connection.simulateTransaction(new web3.VersionedTransaction(simulationMessage), { replaceRecentBlockhash: true });
      if (simulation.value.err) throw new Error("The transaction simulation failed. Nothing was signed or submitted.");
      const units = Math.min(Math.ceil((simulation.value.unitsConsumed || COMPUTE_UNIT_LIMIT_MAX) * 1.2), COMPUTE_UNIT_LIMIT_MAX);
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      const finalMessage = new web3.TransactionMessage({
        payerKey: payer,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          web3.ComputeBudgetProgram.setComputeUnitLimit({ units }),
          ...build.computeBudgetInstructions.map(toInstruction),
          ...instructions,
        ],
      }).compileToV0Message(tables);
      const transaction = new web3.VersionedTransaction(finalMessage);
      button.textContent = "Confirm in Phantom…";
      if (status) status.textContent = "Check the gross SOL amount, token mint, and 1% fee in Phantom before approving.";
      if (execution) execution.textContent = "Awaiting your Phantom approval";
      const signed = await provider.signTransaction(transaction);
      const intentDifference = transactionIntentDifference(finalMessage, signed.message, tables);
      if (intentDifference) {
        throw new Error(`Wallet changed transaction ${intentDifference}; submission stopped.`);
      }

      button.textContent = "Submitting…";
      if (execution) execution.textContent = "Signed locally — submitting to Solana";
      const submitResponse = await fetch("/api/solana/swap/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedTransaction: serializeBase64(signed) }),
      });
      const submitted = await submitResponse.json();
      if (!submitResponse.ok) throw new Error(submitted.message || "Solana rejected the transaction.");
      submittedSignature = submitted.signature;

      if (status) status.innerHTML = `Submitted. <a href="https://solscan.io/tx/${encodeURIComponent(submitted.signature)}" target="_blank" rel="noopener noreferrer">View on Solscan ↗</a>`;
      if (execution) execution.textContent = "Submitted — waiting for confirmation";
      await waitForConfirmation(connection, submitted.signature, latestBlockhash.lastValidBlockHeight);
      if (execution) execution.textContent = "Confirmed on Solana";
      if (status) status.innerHTML = `Trade confirmed. <a href="https://solscan.io/tx/${encodeURIComponent(submitted.signature)}" target="_blank" rel="noopener noreferrer">View receipt on Solscan ↗</a>`;
    } catch (error) {
      if (execution) execution.textContent = submittedSignature ? "Submitted — verify on Solscan" : "Not completed";
      const message = error instanceof Error ? error.message : "Trade did not complete.";
      if (status && submittedSignature) {
        status.innerHTML = `${message} <a href="https://solscan.io/tx/${encodeURIComponent(submittedSignature)}" target="_blank" rel="noopener noreferrer">Check transaction on Solscan ↗</a>`;
      } else if (status) {
        status.textContent = message;
      }
    } finally {
      refreshButton();
    }
  });
})();
