import { onRequestPost as portfolio } from "./functions/api/solana/portfolio.js";
import { onRequestPost as swapQuote } from "./functions/api/solana/swap-quote.js";
import { onRequestPost as swapBuild } from "./functions/api/solana/swap-build.js";
import { onRequestPost as swapSubmit } from "./functions/api/solana/swap-submit.js";
import { onRequestPost as solanaRpc } from "./functions/api/solana/rpc.js";
import { onRequestGet as tokenMarket } from "./functions/api/solana/token-market.js";
import { onRequestGet as geo } from "./functions/api/geo.js";
import { onRequestGet as topMarkets } from "./functions/api/markets/top10.js";
import { onRequestPost as walletScreen, onRequestGet as screeningStatus } from "./functions/api/wallet-screen.js";
import { onRequestPost as registerToken } from "./functions/api/register-token.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/markets/top10") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 });
      }
      return topMarkets({ request, env });
    }

    if (url.pathname === "/api/solana/portfolio") {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" },
          { status: 405, headers: { "cache-control": "no-store, max-age=0" } },
        );
      }
      return portfolio({ request, env });
    }

    if (url.pathname === "/api/solana/rpc") {
      if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 });
      }
      return solanaRpc({ request, env });
    }

    // Regional restrictions and sanctions screening (config/restrictions.json).
    if (url.pathname === "/api/geo") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 });
      }
      return geo({ request, env });
    }

    if (url.pathname === "/api/wallet-screen") {
      if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 });
      }
      return walletScreen({ request, env });
    }

    if (url.pathname === "/api/screening-status") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 });
      }
      return screeningStatus({ request, env });
    }

    // Launch registration goes through the Worker (location + sanctions
    // checks), which forwards to the Signal API with the edge secret.
    if (url.pathname === "/api/v1/tokens/register") {
      if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 });
      }
      return registerToken({ request, env });
    }

    if (url.pathname === "/api/solana/token-market") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 });
      }
      return tokenMarket({ request, env });
    }

    if (url.pathname === "/api/solana/swap/quote") {
      if (request.method === "GET") {
        return Response.json(
          { configured: Boolean(env.JUPITER_API_KEY), quoteEnabled: Boolean(env.JUPITER_API_KEY), executionEnabled: Boolean(env.JUPITER_API_KEY) },
          { status: 200, headers: { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" } },
        );
      }
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" },
          { status: 405, headers: { "cache-control": "no-store, max-age=0" } },
        );
      }
      return swapQuote({ request, env });
    }

    if (url.pathname === "/api/solana/swap/build") {
      if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 });
      }
      return swapBuild({ request, env });
    }

    if (url.pathname === "/api/solana/swap/submit") {
      if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 });
      }
      return swapSubmit({ request, env });
    }

    // Token workspaces are rendered from one static shell; the address and
    // chain remain in the visible URL and are populated client-side.
    if (url.pathname.startsWith("/token/") && url.pathname !== "/token/example") {
      const shellUrl = new URL("/token/example/", request.url);
      return env.ASSETS.fetch(new Request(shellUrl, request));
    }

    return env.ASSETS.fetch(request);
  },
};
