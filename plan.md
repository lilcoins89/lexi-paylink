# LEXI PayLink — implementation plan

## Product scope and architecture

LEXI PayLink will be a TypeScript merchant payment-request web app with a website-free checkout, server-verified Solana USDC settlement, durable merchant workflows, receipts, audit history, and a PayBox-aware agent integration. It will use the initialized managed Webdev project and its actual services: React 19 + Vite, Express, tRPC, Drizzle ORM, and managed MySQL. This differs from the brief’s preferred Next.js/PostgreSQL/Prisma stack because the project is already initialized on the supported React/Express/Drizzle template and its provisioned persistent database is MySQL-compatible. The product behavior and relational model remain the same; the application will not pretend it is using PostgreSQL or Prisma.

Merchant sign-in will use the existing Manus OAuth implementation and server-validated sessions. All merchant-owned queries and mutations will authorize from the server-side user/merchant association. Public checkout will expose only the minimal invoice fields needed to pay. Monetary values will be stored and compared as integer USDC base units; display formatting is separate.

The first-party app will be built in phases but delivered as one coherent application. A database-backed job table with atomic claim/lease, idempotency keys, bounded exponential retry, and terminal failure states will provide durable workflow execution without requiring an unconfigured Redis service. MySQL uniqueness and transactions will protect transfer crediting and order updates. Public Solana RPC may be used when no provider credential is configured; the provider URL remains configurable, and lack of RPC certainty will never produce a confirmed state.

## Payment and workflow behavior

Payment requests will use cryptographically unguessable public IDs and store network, official configured USDC mint, receiver wallet, amount in base units, expiry, overpayment policy, order/reference, workflow selection, and optional success URL. Checkout will provide a Solana Pay URI/QR plus copyable instructions and available wallet handoff. A submitted signature only starts server verification. The server will fetch the transaction and require successful execution and the configured finality level, then parse token transfers and verify exact mint, receiver wallet token-account ownership, amount policy, expiry/late-payment handling, and global signature uniqueness. The explicit payment state machine and audit records will keep invoice expiry distinct from late funds. Underpayment will not fulfill orders; overpayment will follow the request’s stored policy.

A confirmed payment will be committed with its verified-transfer record, order update, immutable receipt snapshot, audit event, and workflow job in an idempotent database transaction. Workflow simulation will use clearly labelled synthetic events and a dry-run execution context that cannot call external integrations. Live workflows will support receipt creation, order status, Telegram/email notifications, signed webhooks, history records, and a post-confirmation redirect. Retry actions will retry only the selected failed side effect, never credit or fulfill again. External notification delivery is at-least-once if a provider outcome is ambiguous; receivers should deduplicate webhook keys. Pending signatures are polled automatically and can also be rechecked through a merchant-scoped operator action using the same server verifier.

The UI will include responsive landing, sign-in state, dashboard, request creation and share panel, public checkout, payment lifecycle details, receipts, orders, workflow builder/simulator/history, notification and webhook settings, reliability view, account/security settings, and PayBox setup/documentation. Live dashboard metrics will come only from the database. An optional demo mode will be visibly labelled and isolated from real payment status.

## PayBox integration boundary

Current PayBox documentation describes its OAuth 2.1 authorization-code + PKCE flow, scoped user-granted credentials, and MCP endpoint at `https://api.paybox.sh/mcp`. The official plugin source is packaged for Grok using `.grok-plugin/plugin.json` and `.mcp.json`; the SDK wraps the supported MCP tools, including plugin discovery/invocation and `verify_solana_balance`. The reviewed contract does not provide a native incoming-USDC invoice/payment-link endpoint, does not document a third-party plugin catalog submission API, and does not establish LEXI invoices from a PayBox request as settled.

LEXI therefore includes the official `@paybox-sh/sdk` connection check for a server-provided bearer token and a separately named, merchant-token-authenticated LEXI MCP surface for its own operations (create request, read status, retrieve verified receipt, inspect events/workflows, and safe simulation). PayBox OAuth 2.1 consent and token refresh remain host/operator-managed and are not implemented as an in-app PKCE callback; the current UI says so explicitly. Metadata and setup examples follow the observed Grok/MCP shape without claiming host compatibility, official PayBox marketplace acceptance, or a third-party submission API. PayBox remains optional and cannot create a confirmed LEXI payment; LEXI’s own Solana verifier remains authoritative. No wallet private key or seed phrase will be requested, stored, or passed to an agent. Real credentials and host consent require merchant/host setup and remain unconfigured until actually exercised.

## Design direction

- **Design movement:** Premium minimal fintech with a restrained editorial dashboard; clean financial software rather than a trading terminal.
- **Core principles:** Verified facts first; generous hierarchy; calm status feedback; accessible contrast and keyboard navigation.
- **Color philosophy:** A deep ink foundation establishes security, warm off-white surfaces keep long-form financial details readable, and a distinctive luminous mint/teal accent signals LEXI actions and verified settlement. Amber and coral are reserved for pending/attention and failure states.
- **Layout paradigm:** A persistent compact navigation rail and wide work surface for the merchant console; checkout switches to a focused, narrow mobile-first payment column.
- **Signature elements:** A geometric LEXI monogram built from two linked strokes; a fine settlement timeline with clear checkpoints; mint-accented verification chips, never color alone.
- **Interaction philosophy:** Every irreversible or financial state is explained before action; copy/share/QR are immediate; payment status changes only from server evidence; simulation is visibly separated from live flows.
- **Animation:** Short, low-amplitude transitions for drawers and state changes; no looping financial counters or motion that could imply a payment succeeded. Respect reduced-motion preferences.
- **Typography system:** A crisp grotesk sans for interface labels and body; a tabular/monospaced numeric style for amounts, signatures, IDs, and timestamps. Use clear type sizes and line heights with responsive scaling.
- **Brand essence:** Website-free USDC payment requests with verifiable settlement and automation for independent merchants; trustworthy, precise, practical.
- **Brand voice:** Direct, calm, transparent. Examples: “Share a link. We’ll verify the transfer.” “Still checking the Solana transaction — your order has not been marked paid.”
- **Wordmark & logo:** Custom linked-stroke LEXI monogram paired with a compact “LEXI PayLink” wordmark, used as a durable HTTPS platform logo asset and in-app mark.
- **Signature brand color:** Bright mint-teal, reserved for LEXI identity and verified/primary action states.

## Project structure

- `client/src/pages/` — landing, merchant console, checkout, receipts, settings, and workflow pages.
- `client/src/components/` — shared shell, status badges, forms, charts, lifecycle timeline, QR/share panel, and accessible UI.
- `client/src/lib/` — tRPC client, formatting, routes, and browser-safe helpers.
- `server/routers.ts` — validated public and authenticated tRPC procedures.
- `server/payments/` — request creation, explicit state machine, Solana RPC verifier, reconciliation, and exact integer amount rules.
- `server/workflows/` — workflow validation, simulation sandbox, durable jobs, idempotency, retries, and action handlers.
- `server/integrations/` — Telegram, email, SSRF-hardened webhook delivery, and PayBox OAuth/MCP adapter.
- `server/security/` — rate limits, safe URL validation, token encryption utilities, HMAC and audit hash-chain helpers.
- `drizzle/schema.ts`, `drizzle/*.sql`, `drizzle/meta/` — relational schema and additive migrations for merchant settings, requests/attempts, transfers, orders, receipts, workflows, jobs/actions, notification/webhook attempts, payment events, and audit records.
- `shared/` — common schemas, state types, route constants, and API contracts.
- `server/**/*.test.ts` — unit tests for amounts/state/workflow policy, RPC verifier fixtures, idempotency fingerprints, platform authentication, and simulation isolation.
- `public/manus-routes.json` — synchronized public-page route manifest.
- `paybox-plugin/` plus `.mcp.json` / `.grok-plugin/` — packaged agent entry, metadata, tool guide, and installation/invocation documentation, clearly describing host limitations.

## Implementation and delivery workflow

1. After plan approval, create `TODO.md` with the complete outcome criteria from the brief, then confirm diagnostics remain registered for TypeScript.
2. Extend the database schema and write additive migrations, then implement merchant authorization, request and order services, precise amount utilities, public invoice routes, and payment-link/QR sharing.
3. Add the Solana transaction verifier, explicit transition rules, signature uniqueness, reconciliation, and fixture-based tests. Do not send test transfers or claim live integration verification without a real configured RPC transaction.
4. Implement durable workflow jobs, receipts, audit chain, simulation isolation, retry UI, settings, and notification/webhook adapters. Keep external delivery disabled until its credentials and destination are configured.
5. Add the supported PayBox OAuth/MCP adapter and LEXI agent-tool surface, then document what is directly supported, what requires merchant/host setup, and what is not provided by PayBox.
6. Complete responsive application pages, route manifest, environment example, migrations, tests, README, local/managed deployment instructions, and a clearly labelled demo.
7. Run project checks and tests, fix actionable issues, inspect the code paths against the brief, start the stable Preview, create the requested private GitHub repository using the managed repository confirmation workflow, and save the completed source to its canonical `main`. Do not publish a production deployment or trigger real payment/notifications without the required user configuration and explicit readiness.

## Known setup boundaries

The project’s managed database is shared by development and production, so testing must use read-only inspection or isolated unit fixtures and avoid destructive SQL or fabricated production transactions. PayBox and notification credentials are not configured yet. Telegram/email delivery, a custom domain, marketplace submission, production RPC credentials, and real settlement demonstrations must remain clearly labelled unconfigured until supplied and verified. A private repository connection is an explicit platform confirmation workflow; the project will be pushed only after that confirmation.
