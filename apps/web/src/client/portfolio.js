// Real portfolio data is fetched through Signal's same-origin server endpoint.
// The RPC provider URL and credentials never enter browser code.
(function () {
  const btn = document.getElementById("refreshPortfolioBtn");
  const emptyEl = document.getElementById("portfolio-empty");
  const skeletonEl = document.getElementById("portfolio-skeleton");
  const resultsEl = document.getElementById("portfolio-results");
  const solEl = document.getElementById("portfolio-sol");
  const tokensEl = document.getElementById("portfolio-tokens");
  if (!btn) return;

  function row(label, value) {
    const div = document.createElement("div");
    div.className = "review-row";
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = value;
    div.append(k, v);
    return div;
  }

  btn.addEventListener("click", async () => {
    const address = window.launchpadWallet?.address || null;
    if (!address) {
      btn.textContent = "Connect wallet first";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Fetching…";
    emptyEl.style.display = "none";
    resultsEl.style.display = "none";
    skeletonEl.style.display = "block";

    try {
      const response = await fetch("/api/solana/portfolio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload.code === "RPC_NOT_CONFIGURED"
          ? "Live balances are waiting for the preview RPC connection."
          : (payload.error || "Live Solana balances are unavailable");
        throw new Error(message);
      }

      solEl.textContent = `${Number(payload.lamports) / 1_000_000_000} SOL`;
      tokensEl.replaceChildren();
      if (Array.isArray(payload.tokens) && payload.tokens.length) {
        for (const token of payload.tokens) tokensEl.append(row(token.mint, token.amount));
      } else {
        tokensEl.append(row("Tokens", "None held"));
      }

      skeletonEl.style.display = "none";
      resultsEl.style.display = "block";
      btn.textContent = "Refresh";
    } catch (err) {
      skeletonEl.style.display = "none";
      resultsEl.style.display = "none";
      emptyEl.style.display = "block";
      emptyEl.replaceChildren();
      const box = document.createElement("div");
      box.className = "empty-state";
      const h = document.createElement("h3");
      h.textContent = "Fetch failed";
      const p = document.createElement("p");
      p.textContent = err instanceof Error ? err.message : "Live Solana balances are unavailable";
      box.append(h, p);
      emptyEl.append(box);
      btn.textContent = "Retry";
    } finally {
      btn.disabled = false;
    }
  });
})();
