// GET /api/geo — the visitor's restriction level, from Cloudflare's
// location and config/restrictions.json. The site uses it to show the
// blocked-region notice and the right terms; the Worker enforces the same
// levels itself on launch registration and trade building.
import { geoForRequest, jsonResponse } from "../compliance.js";

export function onRequestGet({ request }) {
  return jsonResponse(200, geoForRequest(request));
}
