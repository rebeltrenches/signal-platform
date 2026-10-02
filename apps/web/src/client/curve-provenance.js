// Token-page provenance guard. A Signal registration row proves only that the
// creator registered the mint with Signal; it does not prove the mint was
// launched through Signal's bonding-curve program. This module independently
// checks the deterministic curve PDA on-chain before showing that stronger
// claim in the UI.
import * as web3 from "./vendor/solana-web3.js";
import { SIGNAL_BONDING_CURVE_PROGRAM_ID } from "./bonding-curve-program.js";

const STATE_LEN = 160;
const STATE_VERSION = 2;
const RPC = new URL("/api/solana/rpc", window.location.origin).toString();
const encoder = new TextEncoder();

function programId() {
  if (!SIGNAL_BONDING_CURVE_PROGRAM_ID) return null;
  try { return new web3.PublicKey(SIGNAL_BONDING_CURVE_PROGRAM_ID); } catch { return null; }
}

function curvePda(mint, pid) {
  return web3.PublicKey.findProgramAddressSync(
    [encoder.encode("bonding-curve"), mint.toBytes()],
    pid,
  )[0];
}

function stateProvesMint(data, mint) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length !== STATE_LEN || bytes[0] !== STATE_VERSION) return false;
  return new web3.PublicKey(bytes.slice(4, 36)).equals(mint);
}

(async function proveCurveLaunch() {
  const badge = document.getElementById("signal-launch-badge");
  if (!badge) return;

  const params = new URLSearchParams(window.location.search);
  const pathAddress = window.location.pathname.split("/").filter(Boolean).pop() || "";
  const mintText = params.get("mint") || pathAddress;
  const chain = (params.get("chain") || "solana").toLowerCase();
  if (chain !== "solana" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintText) || mintText === "example") return;

  const pid = programId();
  if (!pid) return;

  try {
    const mint = new web3.PublicKey(mintText);
    const curve = curvePda(mint, pid);
    const connection = new web3.Connection(RPC, "confirmed");
    const info = await connection.getAccountInfo(curve, "confirmed");
    if (!info || !info.owner.equals(pid) || !stateProvesMint(info.data, mint)) return;

    badge.dataset.signalCurve = "true";
    badge.textContent = "Launched on Signal curve: Yes";
    badge.title = "Verified from the Signal bonding-curve program account on Solana.";
  } catch {
    // No guess on RPC/decode failure. The weaker registration fact, when
    // available, remains visible instead of fabricating launch provenance.
  }
})();
