# LEXI Grateful Payments for WooCommerce

Standalone WordPress/WooCommerce **source package** for redirecting an order to Grateful.me and reconciling its status. This package was added to the LEXI repository, but it was **not installed, activated, or tested in a WordPress/WooCommerce site**. No PHP/Composer/WordPress dependencies were installed.

This is a separate processor integration. A successful Grateful payment does **not** create a LEXI payment request, a LEXI Solana `VerifiedTransfer`, or a LEXI-issued receipt. LEXI's direct Solana Pay checkout remains a separate settlement path.

## Source/API boundary

The implementation follows the request/response shape documented in the user-specified [ExodusMovement Grateful WooCommerce repository](https://github.com/ExodusMovement/grateful-woocommerce-plugin): `POST https://merchant.grateful.me/api/payments/new` with `fiatAmount`, `fiatCurrency`, `externalReferenceId`, and `callbackUrl`; it uses `x-api-key`, the returned `id` and `url`, `GET /api/payments/{id}/status`, and the `X-Grateful-Signature` webhook header described in the upstream plugin. That source does not document a payment-creation idempotency header or a real refund endpoint.

The gateway therefore sends the WooCommerce order's exact decimal total/currency, saves the provider ID and checkout URL, and reuses a known payment on retry. It does not automatically retry a creation request with an ambiguous outcome: it places the order on hold and asks the merchant to reconcile the attempt in Grateful before any new payment is created. Only the fixed `merchant.grateful.me` HTTPS API origin is called. Redirects are disabled for API requests, TLS verification remains enabled, responses are size-limited, and the returned buyer URL must be HTTPS on `merchant.grateful.me` under `/payment/`.

## Merchant setup

1. Create a Grateful integration in the [Grateful dashboard](https://merchant.grateful.me/settings/integrations), following Grateful's own account and eligibility requirements.
2. In WooCommerce payment settings, enable **Grateful.me** and enter the API key and webhook secret. Password fields are blank on later views; leaving a field blank preserves its saved value.
3. Copy the read-only notification URL shown in those settings into the Grateful integration's notification/webhook configuration.
4. Confirm the WordPress canonical site URL is HTTPS. The gateway remains unavailable unless HTTPS and both credentials are configured.
5. Use an order in a controlled environment and verify that Grateful's own dashboard reports the expected provider payment. This project has no Grateful credentials, account, or live integration test.

Do not paste API credentials or the webhook secret into a customer-facing field. They remain in WordPress gateway settings and are never localized to the Blocks checkout script. Use WordPress administrator access controls, a protected database backup, and HTTPS.

## Payment lifecycle and trust rules

- On order placement, WordPress persists a stable `externalReferenceId` plus expected amount/currency and a `started` marker **before** making the provider request. This prevents an application retry from blindly creating a second payment after a network timeout.
- The gateway accepts only a response containing a provider payment ID and a validated checkout URL. An incomplete or unsafe response leaves the order unpaid/on hold; it is not redirected.
- The buyer return URL is navigation only. Query-string status is ignored. The order ID and WooCommerce order key must match before LEXI queries Grateful again.
- Webhooks must be POST JSON no larger than 64 KiB and pass `hash_equals()` against an HMAC-SHA256 of the raw body and `X-Grateful-Signature`. The order reference and any event payment ID must match stored order metadata.
- For both a valid webhook and a buyer return, the plugin fetches the provider's payment status directly with the server-side API key. Only provider `success`/`completed` status can call WooCommerce `payment_complete()`, subject to amount/currency checks if those fields are returned. A late success for an already failed, cancelled, or refunded order is held for manual review.
- Provider `pending`/`processing` remains unpaid; `failed`/`error` remains unpaid and maps to failed; an explicit provider `expired` status maps to cancelled. Unknown statuses, mismatches, invalid signatures, timeouts, and provider errors never mark the order paid.
- A database-backed per-order lock serializes payment creation, webhook updates, and return reconciliation. Duplicate notifications re-fetch the same provider status and do not intentionally re-run fulfillment after the order is paid.
- Refund support is deliberately omitted. The upstream plugin's inspected refund method is a placeholder; this package never reports a refund as successful.

## WooCommerce compatibility

The gateway registers a classic checkout method and a WooCommerce Blocks payment method using WordPress/WooCommerce-provided script globals (no bundled JS library). It declares HPOS compatibility and uses WooCommerce CRUD APIs for orders and metadata. Only the checkout title, description, and supported feature list are exposed to browser code.

## Validation and limitations

The active Sandbox does not contain PHP, Composer, WP-CLI, PHPCS, WordPress, or WooCommerce, so PHP parsing, WooCommerce integration, Blocks checkout, HPOS operation, and live provider behavior cannot be claimed as tested. A dependency-free Node source-contract check is provided at `tests/check-source.mjs`; run it with `node integrations/woocommerce-grateful/tests/check-source.mjs`. Existing LEXI TypeScript checks/tests/build are separate and should still pass after this package is added.

The inspected Grateful source is GPL-3.0. This package is independently authored from the observable API contract; no upstream PHP/JavaScript code was copied. The LEXI repository is currently marked `UNLICENSED`; this folder has no separate license grant. Choose a distribution license with the repository owner before redistributing this package. See [`docs/upstream-feature-notes.md`](../../docs/upstream-feature-notes.md) for source paths, exact API boundaries, and the no-install/no-copy policy.


## Packaging for a future controlled installation

No installation was performed as part of this work. After the repository owner selects an appropriate distribution license and a site administrator reviews the source, the plugin entrypoint is `integrations/woocommerce-grateful/lexi-grateful-woocommerce.php`. Package the **contents of this folder** with that PHP file at the package root (not nested under another directory), then install/activate it through the site's normal WordPress plugin process with WooCommerce already active. Do not upload the LEXI web application or the upstream cloned repository as the plugin. Validate first on a non-production WordPress/WooCommerce site with provider test credentials; this package has not been PHP-linted or runtime-tested in that environment.


## Rejection, retry, and manual-review safeguards

The API client distinguishes a clear HTTP client rejection from an uncertain create outcome. A non-ambiguous 4xx response other than `408`, `409`, `425`, or `429` is recorded as `rejected`; the order remains unpaid, and a later checkout attempt can retry after the merchant reviews the provider settings. Network errors, timeouts, server errors, those ambiguous 4xx codes, and incomplete responses stay on hold for manual reconciliation so a potentially created provider payment is not duplicated.

Provider `pending` or `processing` callbacks do not reopen an order already `failed`, `cancelled`, `refunded`, or `on-hold`. If Grateful later reports success for one of those orders, LEXI records a persistent manual-review marker and keeps it unpaid/on hold. Repeated success callbacks remain in manual review and do not call `payment_complete()`.
