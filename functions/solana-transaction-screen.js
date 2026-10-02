// Read required signers from the transaction itself, never a caller-supplied
// wallet. The RPC still verifies signatures and validates the full message.
import { refusalFor, jsonResponse } from "./compliance.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function addressFor(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let address = "";
  while (value) {
    address = BASE58[Number(value % 58n)] + address;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    address = "1" + address;
  }
  return address;
}

export function transactionSigners(encoded) {
  if (typeof encoded !== "string" || !encoded.length || encoded.length > 1644
      || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("Expected a base64 Solana transaction.");
  }
  const raw = atob(encoded);
  if (btoa(raw) !== encoded || raw.length > 1232) throw new Error("Invalid transaction encoding.");
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  let cursor = 0;
  const byte = () => {
    if (cursor >= bytes.length) throw new Error("Truncated transaction.");
    return bytes[cursor++];
  };
  const shortvec = () => {
    let value = 0;
    for (let i = 0; i < 3; i++) {
      const next = byte();
      if (i === 2 && next > 3) throw new Error("Invalid compact length.");
      value |= (next & 127) << (7 * i);
      if (!(next & 128)) {
        if (i > 0 && next === 0) throw new Error("Noncanonical compact length.");
        return value;
      }
    }
    throw new Error("Invalid compact length.");
  };
  const signatures = shortvec();
  if (signatures < 1 || signatures > 19) throw new Error("Invalid signature count.");
  cursor += signatures * 64;
  let required = byte();
  const versioned = (required & 128) !== 0;
  if (versioned) {
    if (required !== 128) throw new Error("Unsupported transaction version.");
    required = byte();
  }
  const readonlySigned = byte();
  const readonlyUnsigned = byte();
  const keys = shortvec();
  if (required !== signatures || keys < required || keys > 256
      || readonlySigned >= required || readonlyUnsigned > keys - required
      || cursor + keys * 32 + 33 > bytes.length) {
    throw new Error("Invalid transaction message.");
  }
  return Array.from({ length: required }, (_, i) =>
    addressFor(bytes.subarray(cursor + i * 32, cursor + (i + 1) * 32)));
}

export async function transactionRefusal(request, env, encoded, action) {
  const region = await refusalFor(request, env, undefined, action);
  if (region) return region;
  let signers;
  try {
    signers = transactionSigners(encoded);
  } catch {
    return jsonResponse(400, { code: "INVALID_SIGNED_TRANSACTION", error: "A valid base64 Solana transaction is required." });
  }
  for (const signer of signers) {
    const refusal = await refusalFor(request, env, signer, action);
    if (refusal) return refusal;
  }
  return null;
}
