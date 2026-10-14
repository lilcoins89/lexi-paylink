import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";

type ResolvedSafeUrl = { url: URL; address: string; family: 4 | 6 };
function isBlockedIp(address: string): boolean {
  const lower = address.toLowerCase().split("%")[0];
  if (lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:") || lower.startsWith("ff")) return true;
  const ipv4 = lower.startsWith("::ffff:") ? lower.slice(7) : lower;
  if (isIP(ipv4) !== 4) return isIP(lower) === 0;
  const octets = ipv4.split(".").map(Number);
  if (octets.length !== 4 || octets.some(value => value < 0 || value > 255)) return true;
  const [a, b, c] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) || (a === 203 && b === 0 && c === 113) || a >= 224;
}

async function resolveSafeUrl(value: string): Promise<ResolvedSafeUrl> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Webhook endpoint must be an HTTPS URL without embedded credentials or fragments.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test")) throw new Error("Webhook endpoint cannot target a local or internal host.");
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error("Webhook endpoint cannot target a private or reserved IP address.");
    return { url, address: host, family: isIP(host) as 4 | 6 };
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isBlockedIp(item.address))) throw new Error("Webhook host resolves to a private or reserved address.");
  const address = addresses[0]!;
  return { url, address: address.address, family: address.family as 4 | 6 };
}

export async function assertSafeWebhookUrl(value: string): Promise<URL> {
  return (await resolveSafeUrl(value)).url;
}

export async function postSafeWebhook(value: string, headers: Record<string, string>, body: string, timeoutMs = 10_000): Promise<{ statusCode: number }> {
  const { url, address, family } = await resolveSafeUrl(value);
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
      servername: url.hostname,
      lookup: ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => callback(null, address, family)) as NonNullable<RequestOptions["lookup"]>,
    };
    const request = https.request(url, options, (response: IncomingMessage) => {
      response.resume();
      response.on("end", () => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode >= 300 && statusCode < 400) reject(new Error("Webhook redirects are blocked."));
        else if (statusCode < 200 || statusCode >= 300) reject(new Error(`Webhook returned HTTP ${statusCode}.`));
        else resolve({ statusCode });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Webhook request timed out.")));
    request.on("error", reject);
    request.end(body);
  });
}
