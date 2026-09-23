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

  function shortenMint(mint) {
    return mint.length > 16 ? mint.slice(0, 8) + "…" + mint.slice(-6) : mint;
  }

  function formatTokenAmount(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return String(amount);
    if (value === 0) return "0";
    if (Math.abs(value) < 0.000001) return "<0.000001";
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: Math.abs(value) < 1 ? 6 : 4,
      useGrouping: true,
    }).format(value);
  }

  function row(token) {
    const div = document.createElement("div");
    div.className = "review-row";

    const identity = document.createElement("span");
    identity.className = "k";

    const primary = document.createElement("span");
    primary.textContent = token.name
      ? `${token.name}${token.symbol ? ` (${token.symbol})` : ""}`
      : token.symbol || shortenMint(token.mint);
    primary.title = token.mint;
    identity.append(primary);

    if (token.symbol || token.name) {
      const mint = document.createElement("small");
      mint.textContent = shortenMint(token.mint);
      mint.title = token.mint;
      mint.style.display = "block";
      mint.style.marginTop = "3px";
      mint.style.fontFamily = "monospace";
      mint.style.opacity = "0.65";
      identity.append(mint);
    }

    const value = document.createElement("span");
    value.className = "v";
    value.textContent = formatTokenAmount(token.amount);

    div.append(identity, value);
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
        const messages = {
          RPC_NOT_CONFIGURED: "Preview RPC is not configured.",
          RPC_INVALID_CONFIG: "Preview RPC configuration is invalid.",
          RPC_HTTP_ERROR: "The Solana RPC provider rejected the request.",
          RPC_TIMEOUT: "The Solana RPC provider timed out.",
          RPC_RESPONSE_ERROR: "The Solana RPC provider returned an invalid response.",
        };
        throw new Error(`${messages[payload.code] || payload.error || "Live Solana balances are unavailable"} [${payload.code || `HTTP_${response.status}`}]`);
      }

      solEl.textContent = `${Number(payload.lamports) / 1_000_000_000} SOL`;
      tokensEl.replaceChildren();
      if (Array.isArray(payload.tokens) && payload.tokens.length) {
        for (const token of payload.tokens) tokensEl.append(row(token));
        if (payload.tokenDataComplete === false) {
          tokensEl.append(row({ mint: "Status", amount: "Some token balances may be unavailable" }));
        }
      } else if (payload.tokenDataComplete === false) {
        tokensEl.append(row({ mint: "Tokens", amount: "Temporarily unavailable — refresh to retry" }));
      } else {
        tokensEl.append(row({ mint: "Tokens", amount: "None held" }));
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
