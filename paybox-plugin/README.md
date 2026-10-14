# LEXI PayLink agent tools (MCP-compatible)

This folder documents LEXI PayLink's **own** merchant-authenticated JSON-RPC/MCP endpoint. It is not the official MoonPay PayBox wallet plugin, is not a PayBox Marketplace submission, and does not imply that PayBox accepts third-party plugins. The official PayBox plugin currently connects an agent host to PayBox at `https://api.paybox.sh/mcp`; LEXI's endpoint is separate and is served by this application at `POST https://YOUR_LEXI_PUBLIC_ORIGIN/api/mcp`.

## Merchant setup

1. Sign in to LEXI using the configured merchant account.
2. Open **Settings → Agent API** and create a merchant token. Copy it once into your trusted MCP client. LEXI stores only its SHA-256 hash; generate a replacement if it is lost.
3. Configure your MCP client with the HTTPS endpoint `/api/mcp` and an `Authorization: Bearer <token>` header. Keep the token in the client's protected secret store; do not commit it or send it in a prompt.
4. Verify connectivity with the `initialize`, `tools/list`, and `ping` calls below. The endpoint uses stateless JSON-RPC over HTTP POST and merchant-token authorization.

A generic `.mcp.json`-style URL entry can be adapted to clients that support HTTP remote MCP:

```json
{
  "mcpServers": {
    "lexi-paylink": {
      "type": "http",
      "url": "https://YOUR_LEXI_PUBLIC_ORIGIN/api/mcp"
    }
  }
}
```

This transport-only sample intentionally contains no credentials. A host must separately support sending the merchant's bearer token in the `Authorization` header. Host configuration field names vary; the official PayBox Grok plugin manifest is not evidence that every host accepts this LEXI server as a plugin.

## Test the endpoint with curl

Set these environment variables in a trusted terminal (do not put a production token in shell history):

```bash
export LEXI_MCP_URL='https://YOUR_LEXI_PUBLIC_ORIGIN/api/mcp'
read -rsp 'LEXI merchant token: ' LEXI_MCP_TOKEN; echo
```

List tools:

```bash
curl --fail-with-body --silent --show-error "$LEXI_MCP_URL" \
  -H "Authorization: Bearer $LEXI_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Initialize:

```bash
curl --fail-with-body --silent --show-error "$LEXI_MCP_URL" \
  -H "Authorization: Bearer $LEXI_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"lexi-client","version":"1.0.0"}}}'
```

The available tool names are `create_payment_request`, `get_payment_status`, `get_payment_receipt`, `list_payment_events`, `simulate_payment_workflow`, and `get_workflow_status`. Request creation requires a stable 16–128 character `idempotencyKey`; reuse the key only when retrying identical terms. Reusing it with changed invoice terms is rejected. A request-creation call creates an unpaid invoice only; it does not move funds or confirm settlement.

## Safety and integration limits

- Agent access is merchant-scoped and rate-limited. Never give an agent a wallet seed phrase, private key, PayBox signing authority, or token with broader access than needed.
- Public invoice status and receipt tools do not infer payment from a transaction signature. Receipt data is returned only after LEXI verifies finalized, amount-satisfied USDC settlement.
- The workflow simulation tool is a dry run and cannot send transactions, notifications, webhooks, mark orders paid, or issue receipts.
- LEXI does not claim a native PayBox incoming-invoice API or settlement webhook. PayBox tools, grants and approvals remain governed by PayBox; LEXI's own Solana verifier is the only source of LEXI settlement state.
- No official PayBox third-party plugin submission route was found in the reviewed current docs/repository. This example is an interoperability guide, not a marketplace acceptance guarantee.

See [`../docs/paybox-integration-notes.md`](../docs/paybox-integration-notes.md) for source citations and [`../README.md`](../README.md) for full configuration.
