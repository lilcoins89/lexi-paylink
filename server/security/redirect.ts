import { isIP } from "node:net";

/** Validate a merchant-controlled browser redirect; this URL is never fetched by LEXI. */
export function sanitizePublicRedirect(value?: string): string | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Enter a valid HTTPS success URL."); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const normalizedHost = hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || isIP(normalizedHost)) {
    throw new Error("Success redirects must use a public HTTPS hostname without credentials or a local/IP address.");
  }
  return url.toString();
}
