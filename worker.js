import { onRequestPost as portfolio } from "./functions/api/solana/portfolio.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/solana/portfolio") {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" },
          { status: 405, headers: { "cache-control": "no-store, max-age=0" } },
        );
      }
      return portfolio({ request });
    }

    return env.ASSETS.fetch(request);
  },
};
