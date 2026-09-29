// Vercel's Node adapter for the shared, compliance-checked Worker handlers.
import worker from "../../../worker.js";

export default async function handler(req, res) {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    headers.delete("cf-ipcountry");
    headers.delete("cf-connecting-ip");
    const ip = headers.get("x-real-ip");
    if (ip) headers.set("cf-connecting-ip", ip);
    const method = req.method || "GET";
    let body;
    if (method !== "GET" && method !== "HEAD") {
      if (req.body !== undefined) {
        body = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);
      } else {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk);
          length += bytes.length;
          if (length > 32_000) return tooLarge(res);
          chunks.push(bytes);
        }
        body = Buffer.concat(chunks).toString("utf8");
      }
      if (Buffer.byteLength(body || "") > 32_000) return tooLarge(res);
      headers.set("content-length", String(Buffer.byteLength(body || "")));
    }
    const request = new Request(new URL(req.url, "https://signal-preview.invalid"), { method, headers, ...(body !== undefined ? { body } : {}) });
    Object.defineProperty(request, "cf", { value: {
      country: headers.get("x-vercel-ip-country") || "",
      regionCode: headers.get("x-vercel-ip-country-region") || "",
    } });
    const response = await worker.fetch(request, {
      ...process.env,
      ASSETS: { fetch: () => Response.json({ code: "NOT_FOUND", error: "API route not found." }, { status: 404 }) },
    });
    res.statusCode = response.status;
    for (const [key, value] of response.headers) res.setHeader(key, value);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ code: "API_ADAPTER_ERROR", error: "The preview API request could not be handled." }));
  }
}

function tooLarge(res) {
  res.statusCode = 413;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ code: "BODY_TOO_LARGE", error: "Request body is too large." }));
}
