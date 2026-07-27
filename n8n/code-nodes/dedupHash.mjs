import { createHash } from "node:crypto";

// Strips tracking params and normalizes case/trailing slash so the same
// posting reached via different query strings hashes identically.
export function canonicalUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    let s = u.toString().toLowerCase();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return String(url).split("?")[0].toLowerCase().trim();
  }
}

export function jobHash(url) {
  return createHash("sha256").update(canonicalUrl(url)).digest("hex");
}
