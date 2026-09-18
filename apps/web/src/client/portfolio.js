// Real portfolio: fetches the connected wallet's actual SOL balance and
// SPL token holdings, live, from Solana Mainnet. This is a read-only
// operation — no signature needed, no funds at risk, just genuinely
// public on-chain data about the connected wallet's own public key.
// Nothing here is fabricated: if the fetch fails or returns nothing,
// that's what gets shown, never a placeholder number.
import * as web3 from "https://esm.sh/@solana/web3.js@1.95.3";

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

(function () {
  const btn = document.getElementById("refreshPortfolioBtn");
  const emptyEl = document.getElementById("portfolio-empty");
  const skeletonEl = document.getElementById("portfolio-skeleton");
  const resultsEl = document.getElementById("portfolio-results");
  const solEl = document.getElementById("portfolio-sol");
  const tokensEl = document.getElementById("portfolio-tokens");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const address = (window.launchpadWallet && window.launchpadWallet.address) || null;
    if (!address) {
      btn.textContent = "Connect wallet first";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Fetching…";
    // Real loading state for a real, possibly-slow network round trip —
    // not an instant swap that would make a slow RPC response look like
    // a freeze. Skeleton replaces the empty-state; results stay hidden
    // until there's something real to show in them.
    emptyEl.style.display = "none";
    resultsEl.style.display = "none";
    skeletonEl.style.display = "block";

    try {
      const connection = new web3.Connection(MAINNET_RPC, "confirmed");
      const pubkey = new web3.PublicKey(address);

      const lamports = await connection.getBalance(pubkey);
      const sol = lamports / web3.LAMPORTS_PER_SOL;

      const [legacyAccounts, token2022Accounts] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: new web3.PublicKey(TOKEN_PROGRAM_ID) }),
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: new web3.PublicKey(TOKEN_2022_PROGRAM_ID) }),
      ]);
      const allAccounts = [...legacyAccounts.value, ...token2022Accounts.value].filter(
        (a) => a.account.data.parsed.info.tokenAmount.uiAmount > 0
      );

      solEl.textContent = `${sol} SOL`;
      tokensEl.innerHTML = allAccounts.length
        ? allAccounts
            .map((a) => {
              const info = a.account.data.parsed.info;
              return `<div class="review-row"><span class="k" style="font-family:monospace;font-size:12px">${info.mint}</span><span class="v">${info.tokenAmount.uiAmountString}</span></div>`;
            })
            .join("")
        : '<div class="review-row"><span class="k">Tokens</span><span class="v" style="color:var(--ink-faint)">None held</span></div>';

      skeletonEl.style.display = "none";
      resultsEl.style.display = "block";
      btn.textContent = "Refresh";
    } catch (err) {
      skeletonEl.style.display = "none";
      emptyEl.style.display = "block";
      emptyEl.innerHTML = `<div class="empty-state"><h3>Fetch failed</h3><p>${err.message}</p></div>`;
      btn.textContent = "Retry";
    } finally {
      btn.disabled = false;
    }
  });
})();
