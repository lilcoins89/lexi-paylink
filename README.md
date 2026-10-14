# LEXI PayLink

LEXI PayLink lets merchants, freelancers, creators, online sellers, and small businesses request Solana USDC payments without building an online store. Merchants create an invoice link and QR; customers pay from a compatible wallet; LEXI verifies the finalized on-chain transfer before marking an order paid or issuing a receipt.

> A submitted signature, wallet “success” screen, or client-side callback is never settlement proof. LEXI's server-side Solana verifier is authoritative.

## Current implementation

- Responsive merchant pages, Manus OAuth login/session handling, server-bound merchant records, isolated private API queries, and a data-driven dashboard.
- Payment request creation with integer base-unit amounts, mainnet/devnet USDC identity, merchant receiver wallet, unique Solana Pay invoice reference, expiry, overpayment policy, optional order/workflow/redirect, stable idempotency key, shareable link, QR download, and mobile checkout.
- Server-side finalized transaction verification for signature status, execution result, invoice reference, official USDC mint, receiving-wallet token-account ownership, parsed SPL transfer instruction, and matching positive integer token-balance delta.
- Database-backed payment attempts, automatic reconciliation polling, and a merchant-scoped manual reconciliation control; duplicate signature protection, concurrency-safe settlement, underpayment/overpayment/expiry handling, and late-transfer recording.
- Receipt snapshots and shareable printable pages only for amount-satisfied verified settlements; order records; canonicalized, merchant-serialized audit hash chains.
- Deterministic PayLink Autopilot drafts, merchant-confirmed workflow activation, dry-run simulation, durable workflow execution, idempotent payment-history actions, bounded retries and dead-letter states.
- Telegram, Resend email, and signed HTTPS webhooks are configurable but require merchant/server credentials and setup. External messages are not sent in demo/test flows.
- Workflow actions are retried with bounded backoff; payment credit, order updates, receipts, and payment-history action events are idempotent. Telegram/email/webhook delivery is at-least-once: if a provider accepts a send but the worker loses the response before saving success, a retry may duplicate that external notification. Webhooks include a stable idempotency key and receivers should deduplicate it. Notification retries never repeat settlement or fulfillment.
- A merchant-authenticated stateless JSON-RPC/MCP endpoint at `POST /api/mcp` for creating requests, reading status/receipts/events, workflow simulation, and execution history.
- Official `@paybox-sh/sdk` connection check and documented interoperability boundary. LEXI does not claim PayBox exposes a native incoming-USDC invoice endpoint or a Solana settlement webhook; PayBox cannot confirm LEXI invoices.

## Stack

React 19 + Vite, TypeScript, Express, tRPC, Drizzle ORM, and managed MySQL; Solana Web3.js/SPL Token and wallet-adapter; QRCode; Vitest. The project uses its initialized supported managed template rather than the Next.js/PostgreSQL/Prisma preference in the product brief. See [`plan.md`](./plan.md) for the approved architecture and design.

## Prerequisites

- Node.js 22 and pnpm 10.18.0 (`packageManager` is pinned in `package.json`).
- A MySQL-compatible database. Use a dedicated non-production database for local development; never run test writes against a live merchant database.
- The host's configured Manus OAuth/service environment for real merchant login. These credentials are supplied by the managed environment, not included in this repository.

## Local setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# Fill only the values needed for your own isolated environment.
pnpm db:migrate
pnpm dev
```

The development server listens on `PORT` (default 3000) and serves the Vite app and API together. Local authentication still requires a correctly configured OAuth host; do not replace it with a fake merchant session. For production-style mode, run `pnpm build` then `pnpm start`.

### Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | All persisted features | MySQL-compatible DSN. The managed Webdev database provides it; it is shared by preview and publication. |
| `LEXI_ENCRYPTION_KEY` | Storing merchant Telegram credentials | Base64-encoded 32-byte key for AES-256-GCM. Generate with `openssl rand -base64 32`; keep server-side only and back it up securely. |
| `LEXI_PUBLIC_URL` | Absolute links in notifications/agent responses | HTTPS origin only, no credentials or fragment. Configure the stable public app origin. |
| `SOLANA_RPC_URL_MAINNET` | Mainnet verification | Optional; defaults to the public Solana mainnet-beta RPC. A dedicated provider is recommended for production. |
| `SOLANA_RPC_URL_DEVNET` | Devnet verification | Optional; defaults to the public Solana devnet RPC. Devnet USDC is test-only and has no financial value. |
| `SOLANA_RECONCILE_INTERVAL_MS` | Pending signature reconciliation | Optional, 5,000–120,000 ms; defaults to 15,000 ms. Durable attempts remain pending when RPC is uncertain. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email notifications | Optional. `EMAIL_FROM` must be an authorized sender. Merchant notification address is configured in Settings. |
| `TELEGRAM_BOT_TOKEN` | Optional server-wide Telegram fallback | Merchants may instead configure their own bot token in Settings; it is encrypted before persistence. Validate the destination chat ID before delivery. |
| `PAYBOX_ACCESS_TOKEN` | PayBox SDK connection inspection | Optional server-side bearer token obtained through PayBox's supported grant flow. LEXI checks it with `listCredentials`. LEXI does not implement PayBox OAuth PKCE callbacks or token refresh. |
| `PORT` | Runtime listener | Optional; defaults to 3000. |
| `NODE_ENV` | Runtime mode | Use the host's normal development/production values. |

Never commit `.env`, a real token, private keys, seed phrases, or credentials. `.env.example` contains names/placeholders only.

## Database and schema changes

The relational schema is in [`drizzle/schema.ts`](./drizzle/schema.ts); additive SQL migrations and Drizzle metadata are in [`drizzle/`](./drizzle/). Apply already-reviewed migrations with:

```bash
pnpm db:migrate
```

For future changes, update the schema, generate a migration, inspect the SQL for additive/non-destructive behavior, and commit the migration. `pnpm db:push` generates and applies schema changes in one step and is not the preferred production review path. Preview and published app share the managed DB: migration DDL and validation writes affect the same data.

## Merchant and customer flows

1. Sign in through the managed Manus OAuth flow; the server resolves a merchant from the authenticated platform identity.
2. Create a USDC request with a stable idempotency key. Reusing it with identical terms returns the same request; reusing it with changed terms is rejected. A unique random Solana Pay reference is attached to the invoice.
3. Share the `/pay/{paymentId}` link or its QR. Checkout supports a Solana Pay URI, compatible wallet handoff, copyable recipient/payment details, and signature submission for verification.
4. LEXI checks the selected network's official USDC mint, transaction success, finalized commitment, invoice reference, parsed SPL transfer instruction, matching token balance delta, destination account owner and request policy. Background polling and the merchant's manual reconciliation control retry pending signatures; uncertainty never becomes confirmation.
5. Amount-satisfied settlement atomically creates the transfer/order facts, a receipt snapshot, audit event and durable workflow jobs. Partial payments never fulfill. Rejected overpayments and late transfers are recorded for manual review; no automatic refund is promised.
6. A public `/receipt/{paymentId}` page exposes a snapshot only after verified, amount-satisfied settlement. It supports JSON download and print/Save as PDF.

Official USDC mint identities are encoded in `server/payments/solana.ts`: mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`; devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (test token only; [Circle source](https://developers.circle.com/stablecoins/usdc-contract-addresses)).

## Agent and PayBox integration

LEXI's own stateless MCP-compatible HTTP endpoint is `POST /api/mcp`. Each merchant generates an agent token in Settings; only a SHA-256 hash is stored. Send it in `Authorization: Bearer <LEXI_MERCHANT_TOKEN>` from a trusted host. Do not put tokens in browser code, public repos, or model prompts.

The interface currently provides `create_payment_request` (requires a stable `idempotencyKey`), `get_payment_status`, `get_payment_receipt`, `list_payment_events`, `simulate_payment_workflow`, and `get_workflow_status`. Calls are merchant-scoped; simulation has no live side effects. See [`paybox-plugin/README.md`](./paybox-plugin/README.md) for setup and JSON-RPC examples.

The reviewed PayBox docs describe PayBox's OAuth 2.1 authorization-code + PKCE flow and `https://api.paybox.sh/mcp`; the official PayBox plugin currently packages that endpoint for Grok. That repo is a PayBox wallet plugin, not evidence that PayBox accepts third-party plugin submissions. Current docs do not document a native incoming-USDC invoice API or Solana settlement webhook. LEXI's MCP endpoint and PayBox's SDK/MCP tools are distinct. The optional token setting only checks the official SDK's credential-list call; the PayBox OAuth consent and refresh lifecycle are not implemented by LEXI. See [`docs/paybox-integration-notes.md`](./docs/paybox-integration-notes.md) and the official [SDK](https://docs.paybox.sh/sdk-cli), [MCP tools](https://docs.paybox.sh/reference/mcp-tools), [OAuth](https://docs.paybox.sh/connect/oauth), [package](https://www.npmjs.com/package/@paybox-sh/sdk), and [plugin source](https://github.com/moonpay/paybox-plugin).

## Integrations and operations

- **Telegram:** Configure bot token and chat ID from merchant Settings; LEXI validates access using read-only bot/chat APIs before storing the credential encrypted. No test message is sent during validation.
- **Email:** Configure merchant email and server `RESEND_API_KEY` / `EMAIL_FROM`. Templates cover payment received, underpaid, expired, and workflow errors.
- **Webhooks:** Configure HTTPS endpoints and event subscriptions. Private/reserved addresses and unsafe redirects are blocked; delivery uses HMAC-SHA256 over timestamp + raw JSON body with `x-lexi-timestamp`, `x-lexi-signature`, and an idempotency header. Failed actions have bounded retries and visible delivery records.
- **Workflow simulation:** Explicitly marked dry-run only; it cannot call notification/webhook integrations, submit transactions, mark orders paid, or issue receipts.
- **Audit history:** Each merchant has an ordered SHA-256 hash chain. This makes post-write alteration detectable within the recorded chain; it is not public immutability, proof of truthful source events, or a blockchain notarization.

## Commands and tests

```bash
pnpm check
pnpm test -- --run
pnpm build
pnpm start
```

The current suite passes 26 unit tests: exact integer amounts and policy classification; state transitions; RPC-mocked Solana verifier cases (valid finalized USDC with parsed SPL transfer, pending finality, wrong reference/recipient/mint, instruction/delta mismatch, and RPC uncertainty); idempotency fingerprints; verified-only workflow trigger gating; safe HTTPS redirects; isolated workflow draft/simulation; and platform auth/session helpers. These are unit/fixture tests, not database-concurrency, browser end-to-end, live RPC, or provider integration tests. No test payment has been sent.

For the managed container, the Dockerfile builds the frontend/server and listens on the configured `PORT`; `/api/health` is unauthenticated for runtime readiness. Deployment and publication remain separate from source checkpointing. This project has not been production-published as part of GitHub repository setup.

## Security and product boundaries

- LEXI does not custody funds, store wallet private keys, ask for seed phrases, or create refunds.
- Only the merchant-controlled public receiving wallet is stored for settlement checks.
- IDs are unguessable; the public checkout exposes minimal invoice data. Private tRPC/MCP operations derive merchant identity from server credentials.
- Mainnet transfers are real and generally irreversible. Always review the amount, official mint, network, receiver and policy before sharing a link.
- Devnet is a clearly labelled test environment; do not describe devnet tokens as money.
- Missing RPC, PayBox, email or Telegram configuration must be treated as unavailable—not successful.
- Rate limiting is currently per-process; production multi-instance deployments should add a shared rate-limit store and monitor provider quotas.

## Project documentation

- [`plan.md`](./plan.md) — approved design and architecture.
- [`TODO.md`](./TODO.md) — complete behavior criteria and delivery status.
- [`docs/paybox-integration-notes.md`](./docs/paybox-integration-notes.md) — source-cited research notes.
- [`paybox-plugin/README.md`](./paybox-plugin/README.md) — LEXI MCP integration guide and install/invocation example.


## Optional Grateful.me WooCommerce gateway

A standalone WooCommerce plugin **source package** lives in [`integrations/woocommerce-grateful/`](integrations/woocommerce-grateful/). It redirects WooCommerce orders to Grateful.me and fetches provider status server-side before allowing WooCommerce to mark an order paid. This integration is separate from LEXI's direct Solana USDC payment-request database: it does not create a LEXI invoice, verified Solana transfer, or LEXI-issued receipt.

The source package was **not installed, activated, or exercised** in WordPress/WooCommerce, and no PHP/Composer/WordPress dependencies were installed. The Sandbox has no PHP, Composer, WP-CLI, PHPCS, or WooCommerce runtime. Its contract and security limitations are documented in [`integrations/woocommerce-grateful/README.md`](integrations/woocommerce-grateful/README.md); source references are in [`docs/upstream-feature-notes.md`](docs/upstream-feature-notes.md). No live Grateful account/credentials were supplied. Refunds are deliberately unsupported because the inspected upstream implementation is only a placeholder. Run the dependency-free source-contract check with `node integrations/woocommerce-grateful/tests/check-source.mjs`; this is not a substitute for PHP/WordPress integration tests.

## Solana.com reference

The requested [`solana-foundation/solana-com`](https://github.com/solana-foundation/solana-com) repository is used as a technical reference for the existing Solana Pay transfer URI, QR/mobile fallback, unique reference, and server-side verification design. No Solana Commerce Kit/beta package was installed and no upstream source code was copied. See [`docs/solana-com-feature-map.md`](docs/solana-com-feature-map.md). Grateful WooCommerce status is never represented as a LEXI-verified Solana transfer.


**WooCommerce retry safety:** Clear client rejections are recorded as unpaid/rejected and may be retried after review. Timeouts, network/server errors, incomplete responses, and HTTP `408`, `409`, `425`, or `429` remain manual-reconciliation cases. Pending events cannot reopen terminal or manually held WooCommerce orders; late success requires manual review and cannot auto-fulfill through duplicate callbacks.
