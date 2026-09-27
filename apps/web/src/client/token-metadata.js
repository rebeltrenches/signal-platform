// On-chain token metadata (name, symbol, logo) for Signal's Solana
// launches: the Metaplex Token Metadata account that wallets and
// explorers read, plus the input rules it imposes. The instruction is
// encoded here by hand (Borsh layout of CreateMetadataAccountV3) rather
// than pulling in the Metaplex SDK and its dependency tree.
//
// Every launch's metadata is immutable (isMutable false): nobody,
// including the creator, can change the name, symbol or logo link later.
// It must be created while the creator is still the mint authority, so
// it goes in the mint-creation transaction, before the supply
// transaction revokes that authority.
//
// web3 is passed in (the bundled @solana/web3.js in the browser, the npm
// package in tests) so this module has no imports of its own.

export const TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const CREATE_METADATA_ACCOUNT_V3 = 33;
const METADATA_V1_KEY = 4;

// Metaplex's own limits, in UTF-8 bytes.
export const MAX_NAME_BYTES = 32;
export const MAX_SYMBOL_BYTES = 10;
export const MAX_URI_BYTES = 200;
export const MAX_DESCRIPTION_CHARS = 500;
// 100 KB keeps each upload (with its ~200-byte envelope) under ArDrive
// Turbo's free per-file limit of 107,520 bytes.
export const MAX_LOGO_BYTES = 100 * 1024;

const utf8 = new TextEncoder();
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Returns { valid, error, value }; value is the trimmed name. */
export function validateTokenName(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { valid: false, error: "Enter a token name.", value };
  if (CONTROL_CHARS.test(value)) return { valid: false, error: "The name can't contain control characters.", value };
  if (utf8.encode(value).length > MAX_NAME_BYTES) {
    return { valid: false, error: `The name can be at most ${MAX_NAME_BYTES} bytes (${MAX_NAME_BYTES} plain letters; accents and emoji use more).`, value };
  }
  return { valid: true, error: null, value };
}

/** Returns { valid, error, value }; value is the trimmed, upper-case symbol. */
export function validateTokenSymbol(raw) {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!value) return { valid: false, error: "Enter a symbol.", value };
  if (/\s/.test(value) || CONTROL_CHARS.test(value)) return { valid: false, error: "The symbol can't contain spaces.", value };
  if (utf8.encode(value).length > MAX_SYMBOL_BYTES) {
    return { valid: false, error: `The symbol can be at most ${MAX_SYMBOL_BYTES} bytes (${MAX_SYMBOL_BYTES} plain letters).`, value };
  }
  return { valid: true, error: null, value };
}

export function validateDescription(raw) {
  const value = String(raw ?? "").trim();
  if (value.length > MAX_DESCRIPTION_CHARS) {
    return { valid: false, error: `The description can be at most ${MAX_DESCRIPTION_CHARS} characters.`, value };
  }
  return { valid: true, error: null, value };
}

// Identified from the file's own bytes, never its name or the browser's
// guess. SVG is deliberately not accepted: it can carry scripts.
function detectImageType(bytes) {
  const starts = (...sig) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** Returns { valid, error, contentType } for the logo file's bytes. */
export function validateLogo(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { valid: false, error: "Choose a logo image.", contentType: null };
  const contentType = detectImageType(bytes);
  if (!contentType) return { valid: false, error: "The logo must be a PNG, JPEG, GIF or WebP image.", contentType: null };
  if (bytes.length > MAX_LOGO_BYTES) {
    return { valid: false, error: `The logo is ${(bytes.length / 1024).toFixed(1)} KB; the maximum is 100 KB.`, contentType };
  }
  return { valid: true, error: null, contentType };
}

/** The off-chain JSON the on-chain `uri` points to (Metaplex fungible
 *  token standard), as UTF-8 bytes. */
export function buildMetadataJson({ name, symbol, description, imageUri, imageType }) {
  const json = {
    name,
    symbol,
    description: description || "",
    image: imageUri,
    properties: { category: "image", files: [{ uri: imageUri, type: imageType }] },
  };
  return utf8.encode(JSON.stringify(json));
}

export function metadataAddress(web3, mint) {
  const programId = new web3.PublicKey(TOKEN_METADATA_PROGRAM_ID);
  return web3.PublicKey.findProgramAddressSync([utf8.encode("metadata"), programId.toBytes(), mint.toBytes()], programId)[0];
}

function borshString(value) {
  const bytes = utf8.encode(value);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

/** CreateMetadataAccountV3 for a fungible token: no creators, collection
 *  or uses, 0 royalties, and isMutable false. The mint authority and
 *  payer (the creator) sign; the creator is also recorded as update
 *  authority, which has no power over immutable metadata. */
export function createMetadataInstruction(web3, { mint, mintAuthority, payer, name, symbol, uri }) {
  const nameCheck = validateTokenName(name);
  if (!nameCheck.valid || nameCheck.value !== name) throw new Error(nameCheck.error || "Invalid token name.");
  const symbolCheck = validateTokenSymbol(symbol);
  if (!symbolCheck.valid || symbolCheck.value !== symbol) throw new Error(symbolCheck.error || "Invalid token symbol.");
  if (!/^https:\/\//.test(uri) || utf8.encode(uri).length > MAX_URI_BYTES) throw new Error("Invalid metadata URI.");

  const parts = [
    Uint8Array.of(CREATE_METADATA_ACCOUNT_V3),
    borshString(name),
    borshString(symbol),
    borshString(uri),
    Uint8Array.of(0, 0), // seller_fee_basis_points: 0
    Uint8Array.of(0), // creators: None
    Uint8Array.of(0), // collection: None
    Uint8Array.of(0), // uses: None
    Uint8Array.of(0), // is_mutable: false
    Uint8Array.of(0), // collection_details: None
  ];
  const data = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }

  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(TOKEN_METADATA_PROGRAM_ID),
    keys: [
      { pubkey: metadataAddress(web3, mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mintAuthority, isSigner: true, isWritable: false }, // update authority
      { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** Reads a Metadata account's fields up to isMutable. Metaplex pads
 *  strings with NUL bytes to their maximum length; those are removed. */
export function decodeMetadataAccount(data) {
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  if (bytes[offset] !== METADATA_V1_KEY) throw new Error("Not a token metadata account.");
  offset += 1;
  const updateAuthority = bytes.slice(offset, offset + 32);
  offset += 32;
  const mint = bytes.slice(offset, offset + 32);
  offset += 32;
  const readString = () => {
    const length = view.getUint32(offset, true);
    offset += 4;
    const value = decoder.decode(bytes.slice(offset, offset + length)).replace(/\u0000+$/, "");
    offset += length;
    return value;
  };
  const name = readString();
  const symbol = readString();
  const uri = readString();
  const sellerFeeBasisPoints = view.getUint16(offset, true);
  offset += 2;
  if (bytes[offset] === 1) {
    const count = view.getUint32(offset + 1, true);
    offset += 1 + 4 + count * 34; // pubkey + verified + share
  } else {
    offset += 1;
  }
  const primarySaleHappened = bytes[offset] === 1;
  const isMutable = bytes[offset + 1] === 1;
  return { updateAuthority, mint, name, symbol, uri, sellerFeeBasisPoints, primarySaleHappened, isMutable };
}
