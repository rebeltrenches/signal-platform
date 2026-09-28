// Permanent storage for a launch's logo and metadata JSON on Arweave,
// through ArDrive Turbo. The creator's own wallet signs every upload and
// pays for any that aren't free; Signal holds no key and pays nothing.
//
// Turbo stores small files free (currently up to 107,520 bytes each,
// within a lifetime allowance per wallet and per IP). When it refuses a
// free upload (HTTP 402: the allowance is used up, or its terms changed),
// this falls back to paying: it prices the files, shows the creator the
// exact SOL amount and waits for their approval, sends that SOL from
// their wallet to Turbo's deposit address, waits for Turbo to credit it,
// and uploads the same signed files again. Declining stops the launch
// before anything is sent.
//
// A payment that was sent but not credited yet is remembered (per
// wallet) and applied on the next attempt, so a retry never pays twice.
//
// Network access goes through the `fetch` passed in, so tests run it
// against a fake Turbo.

export const TURBO_UPLOAD_URL = "https://upload.ardrive.io";
export const TURBO_PAYMENT_URL = "https://payment.ardrive.io";
// Turbo's Solana deposit address. Checked against the payment service's
// own /v1/info before any SOL is sent; a mismatch stops the payment.
export const TURBO_SOLANA_DEPOSIT_ADDRESS = "HepiT2k93CFQaSB7i3ZNXhybZKn5MeWiv3UkLsaJKk4i";
export const ARWEAVE_GATEWAY = "https://arweave.net";

const LAMPORTS_PER_SOL = 1_000_000_000n;
// Turbo's SOL price can move between the quote and the credit.
const PRICE_MARGIN_PERCENT = 10n;
const CREDIT_POLL_INTERVAL_MS = 3_000;
const CREDIT_POLL_ATTEMPTS = 40;
const SUBMIT_ATTEMPTS = 5;

export function arweaveUrl(id) {
  return `${ARWEAVE_GATEWAY}/${id}`;
}

/** Thrown when the creator declines the storage payment. Nothing was sent. */
export class StoragePaymentDeclined extends Error {
  constructor() {
    super("Launch cancelled before anything was sent: the storage payment wasn't approved.");
    this.name = "StoragePaymentDeclined";
  }
}

async function responseText(res) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

export function createTurboClient({
  fetch = globalThis.fetch.bind(globalThis),
  uploadUrl = TURBO_UPLOAD_URL,
  paymentUrl = TURBO_PAYMENT_URL,
} = {}) {
  return {
    /** POSTs one signed data item. Returns { stored: true, id } or
     *  { stored: false, reason } when Turbo wants payment (402). */
    async upload(bytes) {
      const res = await fetch(`${uploadUrl}/v1/tx/solana`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      });
      if (res.status === 402) return { stored: false, reason: (await responseText(res)) || "Payment required" };
      if (!res.ok) throw new Error(`Arweave upload failed (${res.status}): ${await responseText(res)}`);
      const body = await res.json().catch(() => ({}));
      return { stored: true, id: body.id };
    },
    /** The wallet's Turbo credit balance in winc (0 if it has no account). */
    async balance(address) {
      const res = await fetch(`${paymentUrl}/v1/account/balance/solana?address=${encodeURIComponent(address)}`);
      if (res.status === 404) return 0n;
      if (!res.ok) throw new Error(`Couldn't read the Turbo balance (${res.status}).`);
      return BigInt((await res.json()).winc ?? 0);
    },
    async priceForBytes(byteCount) {
      const res = await fetch(`${paymentUrl}/v1/price/bytes/${byteCount}`);
      if (!res.ok) throw new Error(`Couldn't get the Arweave storage price (${res.status}).`);
      return BigInt((await res.json()).winc);
    },
    async wincForLamports(lamports) {
      const res = await fetch(`${paymentUrl}/v1/price/solana/${lamports}`);
      if (!res.ok) throw new Error(`Couldn't get Turbo's SOL price (${res.status}).`);
      return BigInt((await res.json()).winc);
    },
    async depositAddress() {
      const res = await fetch(`${paymentUrl}/v1/info`);
      if (!res.ok) throw new Error(`Couldn't read Turbo's deposit address (${res.status}).`);
      return (await res.json()).addresses?.solana;
    },
    /** Tells Turbo about a confirmed SOL transfer so it credits the sender. */
    async submitPayment(signature) {
      const res = await fetch(`${paymentUrl}/v1/account/balance/solana`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx_id: signature }),
      });
      return res.ok;
    },
  };
}

/** Lamports to send so Turbo credits at least `winc`, with a margin. */
export async function lamportsForWinc(turbo, winc) {
  const wincPerSol = await turbo.wincForLamports(LAMPORTS_PER_SOL);
  if (wincPerSol <= 0n) throw new Error("Turbo returned an invalid SOL price.");
  const exact = (winc * LAMPORTS_PER_SOL + wincPerSol - 1n) / wincPerSol;
  return exact + (exact * PRICE_MARGIN_PERCENT + 99n) / 100n;
}

/** Uploads signed data items ({ label, id, bytes }), free where Turbo
 *  allows and otherwise paid by the creator after approval.
 *   - ownerAddress: the creator's base58 address (the items' signer)
 *   - approvePayment({ lamports, reason, depositAddress }) -> Promise<boolean>
 *   - pay({ lamports, depositAddress, onSent }) -> Promise<signature>,
 *     confirmed on-chain; it calls onSent(signature) as soon as the
 *     transfer is submitted, before confirming it
 *   - paymentStatus(signature, sentAt) -> "confirmed" | "failed" | "pending":
 *     whether a recorded earlier payment landed on-chain
 *   - store: { get(key), set(key, value), remove(key) } for the
 *     sent-but-not-credited payment record
 *   - onStatus(text): progress for the UI
 *  Resolves once every item is stored; throws otherwise. */
export async function uploadDataItems({
  items,
  ownerAddress,
  turbo,
  approvePayment,
  pay,
  paymentStatus = async () => "confirmed",
  store,
  onStatus = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const paymentKey = `turbo_payment_${ownerAddress}`;
  let paidThisRun = false;

  const storeItem = async (item) => {
    onStatus(`uploading ${item.label}`);
    const result = await turbo.upload(item.bytes);
    if (result.stored && result.id && result.id !== item.id) {
      throw new Error(`Turbo stored ${item.label} under an unexpected id (${result.id}).`);
    }
    return result;
  };

  // True once the balance has risen above what it was when the payment
  // was sent (i.e. Turbo credited it).
  const waitForCredit = async (balanceBefore) => {
    for (let attempt = 0; attempt < CREDIT_POLL_ATTEMPTS; attempt += 1) {
      if ((await turbo.balance(ownerAddress)) > balanceBefore) return true;
      await sleep(CREDIT_POLL_INTERVAL_MS);
    }
    return false;
  };

  const submitUntilSeen = async (signature) => {
    for (let attempt = 1; attempt <= SUBMIT_ATTEMPTS; attempt += 1) {
      if (await turbo.submitPayment(signature)) return;
      await sleep(CREDIT_POLL_INTERVAL_MS);
    }
    // Not fatal: Turbo may still credit it; the balance poll decides.
  };

  // Makes sure the wallet's Turbo balance covers `unstored`, paying the
  // shortfall only with the creator's approval.
  const ensureCredit = async (unstored, reason) => {
    let needed = 0n;
    for (const item of unstored) needed += await turbo.priceForBytes(item.bytes.length);

    // A payment sent earlier but not credited yet is applied before any
    // new one is considered. If it never landed on-chain, it is dropped
    // (no SOL left the wallet) and a new payment can be approved.
    const earlier = store.get(paymentKey);
    let earlierStatus = null;
    if (earlier?.signature) {
      onStatus("checking your earlier storage payment");
      earlierStatus = await paymentStatus(earlier.signature, earlier.sentAt);
    }
    if (earlierStatus === "pending") {
      throw new Error(
        `Your earlier storage payment (${earlier.signature}) hasn't confirmed on Solana yet. ` +
          "Try again in a minute; it won't charge you again.",
      );
    }
    if (earlierStatus === "failed") {
      store.remove(paymentKey);
    } else if (earlierStatus === "confirmed") {
      onStatus("applying your earlier storage payment");
      await submitUntilSeen(earlier.signature);
      if (!(await waitForCredit(BigInt(earlier.balanceBefore ?? 0)))) {
        throw new Error(
          `Your earlier storage payment (${earlier.signature}) hasn't been credited by ArDrive Turbo yet. ` +
            "Try again in a few minutes; it won't charge you again.",
        );
      }
      store.remove(paymentKey);
    }

    const balance = await turbo.balance(ownerAddress);
    if (balance >= needed) return;
    if (paidThisRun) throw new Error("ArDrive Turbo's credited balance still doesn't cover the upload.");

    const depositAddress = await turbo.depositAddress();
    if (depositAddress !== TURBO_SOLANA_DEPOSIT_ADDRESS) {
      throw new Error(`ArDrive Turbo's deposit address changed (${depositAddress}); no SOL was sent.`);
    }
    const lamports = await lamportsForWinc(turbo, needed - balance);
    onStatus("waiting for your approval");
    if (!(await approvePayment({ lamports, reason, depositAddress }))) throw new StoragePaymentDeclined();

    // Recorded the moment the transfer is submitted, before confirmation:
    // if confirming fails, the transfer may still land, and a retry must
    // find it instead of asking for a second payment.
    let sentSignature = null;
    const onSent = (signature) => {
      sentSignature = signature;
      store.set(paymentKey, {
        signature,
        lamports: lamports.toString(),
        balanceBefore: balance.toString(),
        sentAt: new Date().toISOString(),
      });
    };
    let signature;
    try {
      signature = await pay({ lamports, depositAddress, onSent });
    } catch (err) {
      if (!sentSignature) throw err; // never submitted: nothing was sent
      throw new Error(
        `Your storage payment (${sentSignature}) was sent but couldn't be confirmed (${err.message}). ` +
          "Press Retry; it won't charge you again unless that payment failed.",
      );
    }
    if (!sentSignature) onSent(signature);
    paidThisRun = true;
    onStatus("waiting for ArDrive Turbo to credit your payment");
    await submitUntilSeen(signature);
    if (!(await waitForCredit(balance))) {
      throw new Error(
        `Your storage payment (${signature}) was sent but ArDrive Turbo hasn't credited it yet. ` +
          "Press Retry in a few minutes; it won't charge you again.",
      );
    }
    store.remove(paymentKey);
  };

  const pending = [...items];
  while (pending.length > 0) {
    const result = await storeItem(pending[0]);
    if (result.stored) {
      pending.shift();
      continue;
    }
    await ensureCredit(pending, result.reason);
    const retried = await storeItem(pending[0]);
    if (!retried.stored) throw new Error(`ArDrive Turbo refused ${pending[0].label} after payment: ${retried.reason}`);
    pending.shift();
  }
  onStatus("stored");
}
