// Checks that the transaction the wallet signed is still the launch
// transaction we built and simulated. Phantom on Mainnet changes
// single-signer transactions before signing: it may adjust the compute
// budget and append Lighthouse "assertion" instructions (read-only checks
// that make the transaction fail if balances change unexpectedly). Those
// are accepted; any other change is rejected.
//
// Both transactions are compared as decompiled messages, so account
// signer/writable flags are the message-level ones on both sides.
// web3 is passed in (the bundled @solana/web3.js in the browser, the npm
// package in tests) so this module has no imports of its own.

export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
export const LIGHTHOUSE_PROGRAM_ID = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

function key(value) {
  return value && typeof value.toBase58 === "function" ? value.toBase58() : String(value);
}

function sameBytes(left, right) {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function instructionDifference(expected, actual) {
  if (key(expected.programId) !== key(actual.programId)) return "program";
  if (!sameBytes(expected.data, actual.data)) return "data";
  const expectedKeys = expected.keys ?? [];
  const actualKeys = actual.keys ?? [];
  if (expectedKeys.length !== actualKeys.length) return "account count";
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (key(expectedKeys[index].pubkey) !== key(actualKeys[index].pubkey)) return "account";
    if (expectedKeys[index].isSigner !== actualKeys[index].isSigner || expectedKeys[index].isWritable !== actualKeys[index].isWritable) {
      return "account permissions";
    }
  }
  return null;
}

// Only SetComputeUnitLimit (within Solana's maximum) and SetComputeUnitPrice.
function computeBudgetProblem(instruction) {
  const data = instruction.data ?? [];
  if ((instruction.keys ?? []).length !== 0) return "compute budget instruction with accounts";
  if (data[0] === SET_COMPUTE_UNIT_LIMIT && data.length === 5) {
    const units = (data[1] | (data[2] << 8) | (data[3] << 16)) + data[4] * 2 ** 24;
    return units > MAX_COMPUTE_UNIT_LIMIT ? "compute unit limit above maximum" : null;
  }
  if (data[0] === SET_COMPUTE_UNIT_PRICE && data.length === 9) return null;
  return "unsupported compute budget instruction";
}

function messageParts(web3, compiledMessage) {
  const message = web3.TransactionMessage.decompile(compiledMessage);
  return { payer: key(message.payerKey), recentBlockhash: message.recentBlockhash, instructions: message.instructions };
}

/** null if `signedMessage` is `expectedMessage` with, at most, Phantom's
 *  compute-budget adjustments and Lighthouse assertions added; otherwise a
 *  short reason. Both are compiled messages (transaction.compileMessage());
 *  take `expectedMessage` BEFORE asking the wallet to sign, so a wallet
 *  that edits our transaction object in place can't change what we compare
 *  against. */
export function launchTransactionDifference(web3, expectedMessage, signedMessage) {
  const ours = messageParts(web3, expectedMessage);
  const theirs = messageParts(web3, signedMessage);
  if (ours.recentBlockhash !== theirs.recentBlockhash) return "blockhash";
  if (ours.payer !== theirs.payer) return "fee payer";

  const expected = ours.instructions.filter((ix) => key(ix.programId) !== COMPUTE_BUDGET_PROGRAM_ID);
  // Accounts our own instructions use, and which of them they may write.
  const ourAccounts = new Set([ours.payer]);
  const ourWritable = new Set([ours.payer]);
  for (const ix of expected) {
    for (const account of ix.keys) {
      ourAccounts.add(key(account.pubkey));
      if (account.isWritable) ourWritable.add(key(account.pubkey));
    }
  }

  let next = 0;
  const budgetTypes = new Set();
  for (const ix of theirs.instructions) {
    const program = key(ix.programId);
    if (program === COMPUTE_BUDGET_PROGRAM_ID) {
      const problem = computeBudgetProblem(ix);
      if (problem) return problem;
      const type = ix.data[0];
      if (budgetTypes.has(type)) return "duplicate compute budget instruction";
      budgetTypes.add(type);
      continue;
    }
    if (next < expected.length && !instructionDifference(expected[next], ix)) {
      next += 1;
      continue;
    }
    if (program === LIGHTHOUSE_PROGRAM_ID) {
      for (const account of ix.keys ?? []) {
        const address = key(account.pubkey);
        if (!ourAccounts.has(address)) return "safety instruction uses an account outside the transaction";
        if (account.isSigner && address !== ours.payer) return "safety instruction requires another signer";
        if (account.isWritable && !ourWritable.has(address)) return "safety instruction writes an account ours don't";
      }
      continue;
    }
    if (next < expected.length) return `${instructionDifference(expected[next], ix)} changed at instruction ${next + 1}`;
    return `added instruction from ${program}`;
  }
  if (next !== expected.length) return "missing instruction";
  return null;
}

/** After the check above passes: if the wallet changed the message (its
 *  bytes differ from `expectedMessageBytes`, taken before signing), our own
 *  co-signers (e.g. the new mint's keypair) sign the final message. Returns
 *  whether it changed; throws if any required signature is missing. */
export function finalizeSignedTransaction(expectedMessageBytes, signed, extraSigners = []) {
  const changed = !sameBytes(expectedMessageBytes, signed.serializeMessage());
  if (changed && extraSigners.length) signed.partialSign(...extraSigners);
  if (!signed.verifySignatures()) throw new Error("A required signature is missing or invalid.");
  return changed;
}
