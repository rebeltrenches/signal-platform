// Post-signing tamper check for Signal swaps (used by swap-execute.js).
// Compares the transaction Signal built with the one the wallet returns
// signed, and names any difference; the caller stops submission on one.
// It takes web3 as a parameter so tests can run it with @solana/web3.js.
//
// Allowed wallet changes:
// - Compute-budget instructions (priority fee / compute limit) are ignored.
// - Lighthouse assertions (Phantom's transaction guard) may be appended
//   after every instruction Signal built, provided those are all still
//   present, byte-identical and in the same order (programs, data,
//   accounts, account permissions — so the swap and the 1% fee transfer to
//   the same fee wallet are unchanged). Lighthouse can only assert account
//   state or write its own memory accounts, never move the user's funds.
// Anything else (another program added, an instruction changed, removed
// or reordered, a different payer or blockhash) is a difference.

export const LIGHTHOUSE_PROGRAM_ID = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

export function createIntentCheck(web3) {
  const lighthouse = new web3.PublicKey(LIGHTHOUSE_PROGRAM_ID);

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

  /** True when the signed list is exactly Signal's instructions, unchanged
   *  and in order, followed only by Lighthouse assertions. */
  function onlyLighthouseAppended(originalInstructions, signedInstructions, payer) {
    if (signedInstructions.length <= originalInstructions.length) return false;
    for (let index = 0; index < originalInstructions.length; index += 1) {
      if (instructionDifference(originalInstructions[index], signedInstructions[index])) return false;
    }
    return signedInstructions.slice(originalInstructions.length).every((instruction) =>
      instruction.programId.equals(lighthouse)
        && instruction.data.length > 0
        // Nothing but the payer (who already signs) may be asked to sign.
        && instruction.keys.every((key) => !key.isSigner || key.pubkey.equals(payer)));
  }

  /** null when the signed message keeps Signal's intent, else a short
   *  description of the difference. */
  return function transactionIntentDifference(original, signed, addressLookupTableAccounts) {
    if (original.recentBlockhash !== signed.recentBlockhash) return "blockhash";
    if (!original.staticAccountKeys[0]?.equals(signed.staticAccountKeys[0])) return "payer";
    const withoutComputeBudget = (message) => web3.TransactionMessage
      .decompile(message, { addressLookupTableAccounts }).instructions
      .filter((instruction) => !instruction.programId.equals(web3.ComputeBudgetProgram.programId));
    const originalInstructions = withoutComputeBudget(original);
    const signedInstructions = withoutComputeBudget(signed);
    if (originalInstructions.length !== signedInstructions.length) {
      if (onlyLighthouseAppended(originalInstructions, signedInstructions, original.staticAccountKeys[0])) return null;
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
  };
}
