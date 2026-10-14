import { PayboxClient } from "@paybox-sh/sdk";

export type PayboxStatus = { configured: false; reason: string } | { configured: true; accessibleCredentials: number; integration: "PayBox SDK / MCP" };

export async function inspectPayboxConnection(): Promise<PayboxStatus> {
  const token = process.env.PAYBOX_ACCESS_TOKEN;
  if (!token) return { configured: false, reason: "No PayBox access token configured. Connect through the PayBox OAuth/MCP flow before using PayBox-authorized tools." };
  try {
    const client = new PayboxClient({ token });
    const result = await client.listCredentials();
    return { configured: true, accessibleCredentials: Array.isArray(result.credentials) ? result.credentials.length : 0, integration: "PayBox SDK / MCP" };
  } catch {
    return { configured: false, reason: "PayBox could not be reached with the configured credentials. No payment was changed." };
  }
}

export function payboxIntegrationBoundary() {
  return {
    endpoint: "https://api.paybox.sh/mcp",
    oauth: "OAuth 2.1 authorization code + PKCE; grants are scoped by the account owner.",
    incomingInvoiceApi: false,
    settlementAuthority: "LEXI server-side Solana verification only",
    supportedTools: ["list_credentials", "request_payment", "verify_solana_balance", "get_request", "discover_plugins", "use_plugin"],
  } as const;
}
