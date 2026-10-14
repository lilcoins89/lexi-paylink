# Upstream integration notes

Research date: 2026-10-15. Both user-specified repositories were shallow-cloned into `/tmp` for static inspection only. No dependency installation, plugin installation/activation, build, or upstream script execution was performed. The cloned repositories are not copied into the LEXI repository.

## ExodusMovement/grateful-woocommerce-plugin

Source: <https://github.com/ExodusMovement/grateful-woocommerce-plugin>

Inspected README, `grateful-payments.php`, `includes/Grateful_Payment_Gateway.php`, `includes/Blocks_Support.php`, `includes/Admin/Setup.php`, `src/checkout.js`, `tests/Test.php`, and `composer.json`.

The README documents a Grateful.me integration (`https://merchant.grateful.me`) that creates a payment via `POST /api/payments/new` with `fiatAmount`, `fiatCurrency`, `externalReferenceId`, and `callbackUrl`; its sample response includes `id`, `url`, and `status`. The gateway also calls `GET /api/payments/{payment_id}/status`, sends `x-api-key`, and reads `X-Grateful-Signature` for webhook authentication. The plugin has a WooCommerce gateway, customer redirect, return route, notification route, and Blocks registration sample. Its `process_refund` method is explicitly a placeholder that returns success without a refund API call; LEXI's integration must not claim refund support. Its existing tests are only a trivial equality assertion and are not relied on as evidence of correctness.

The upstream main PHP file declares GNU GPL v3.0. The GitHub API returned no SPDX license metadata for this repository. LEXI's new adapter is independently authored; no upstream PHP/JS code is copied. Keep source attribution and API-boundary documentation here.

## solana-foundation/solana-com

Source: <https://github.com/solana-foundation/solana-com>

The repository is the Solana.com monorepo and its root `LICENSE` is GNU GPL v3.0. LEXI uses the repository's developer documentation as a technical reference and does not copy source code or install its Commerce Kit/Headless/Connector packages.

Relevant pages:

- [Solana Pay v1 transfer-request specification](https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/docs/en/tools/solana-pay/specification/version1.mdx): transfer URL fields include recipient, amount, `spl-token`, unique `reference`, label, message, and optional public memo. A reference is included as a read-only, non-signer transaction account key, and clients should verify the transaction before fulfilling orders.
- [Transfer requests](https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/docs/en/tools/solana-pay/quickstart/transfer-requests.mdx): fixed-amount SOL/SPL requests, unique references, QR/mobile wallet flow, and reference search followed by recipient/amount validation.
- [QR codes](https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/docs/en/tools/solana-pay/quickstart/qr-codes.mdx): QR codes bridge desktop and mobile wallets; show a direct wallet link and accessible copy fallback where useful.
- [Payment verification tools](https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/docs/en/payments/accept-payments/verification-tools.mdx): client/frontend success is not authoritative; validate server-side, deduplicate signatures, check the official mint, and do not rely on net balance deltas alone for complex transactions.
- [Transaction requests](https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/docs/en/tools/solana-pay/quickstart/transaction-requests.mdx): interactive server-created transactions are a distinct Solana Pay mode; wallets treat the returned unsigned transaction as untrusted and validate instructions before signing.
- [Commerce Kit payment button](https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/docs/en/tools/commerce-kit/quickstart/payment-button.mdx) and [wallet connection](https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/docs/en/tools/commerce-kit/quickstart/wallet-connection.mdx): Commerce Kit describes embedded wallet-selection, QR, responsive UI, and callbacks. Its Solana Pay overview labels the kit beta/draft; it is not installed or relied upon by this application.

LEXI's existing Solana Pay checkout already generates amount/mint/reference URIs and QR codes, includes the unique reference in a wallet transfer instruction, supports a Phantom wallet adapter plus generic QR/address fallback, and requires server-side finalized USDC verification before settlement. Keep that verifier authoritative; Grateful's separate payment status must not be presented as a LEXI-verified Solana transfer.
