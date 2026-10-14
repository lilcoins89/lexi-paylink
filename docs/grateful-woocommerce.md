# Grateful.me WooCommerce gateway: setup and security

The optional source package is [`integrations/woocommerce-grateful/`](../integrations/woocommerce-grateful/). This guide is documentation only; the task did not install or activate it.

## API contract

The user-selected [Grateful WooCommerce source repository](https://github.com/ExodusMovement/grateful-woocommerce-plugin) documents payment creation at `POST https://merchant.grateful.me/api/payments/new`, using `x-api-key` and fields `fiatAmount`, `fiatCurrency`, `externalReferenceId`, and `callbackUrl`. The documented response includes `id`, `url`, and `status`; its plugin reads payment status from `GET https://merchant.grateful.me/api/payments/{id}/status` and verifies notifications with `X-Grateful-Signature`. The adapter deliberately restricts outbound requests to that fixed HTTPS host, disables redirects, retains TLS verification, and limits response bytes.

The API documentation reviewed in this task does not specify an idempotency header, refund endpoint, webhook event ID scheme, or complete list of status values. The adapter does not assume those capabilities. It reuses saved payment IDs; an ambiguous creation result leaves the order on hold for merchant reconciliation rather than issuing a second create call. Refunds are not advertised or reported as successful.

## Status and trust model

Webhook HMAC is computed over the exact raw request body; the signature comparison is constant-time. The event only identifies an order/payment candidate. The plugin then retrieves that stored provider payment ID's status from Grateful and compares any returned order reference, ID, fiat amount, and currency with stored WooCommerce metadata. Customer returns also trigger server-side status retrieval; a URL's `status` value is ignored. Only an authoritative `success`/`completed` result can call WooCommerce's `payment_complete`. Pending, failed, expired, unknown, mismatched, unsigned, or unavailable statuses never mark the order paid. A late success after an order is failed/cancelled/refunded is held for manual review.

API key and webhook secret are server-side WooCommerce settings, omitted from the Blocks browser data, and never printed back into password inputs. Logs omit request/response bodies and credentials. Order writes use WooCommerce CRUD and per-order locks. The notification URL must be registered in the Grateful dashboard. The site's configured canonical URL must be HTTPS.

## WooCommerce setup after owner review

The PHP source package has not been installed. Before any future deployment, an administrator should review source and test in a staging WordPress/WooCommerce instance, ensure its external Grateful account and API contract are current, configure the API key and webhook secret, register the displayed HTTPS callback, and test classic checkout, Blocks checkout, HPOS, duplicate callbacks, timeouts, expired/failed/success outcomes, and recovery. No credentials or live transactions were available here, so none of these provider/runtime checks are claimed as completed.

The Grateful and Solana paths are distinct. A successful Grateful status is not a LEXI Solana settlement and does not create a LEXI receipt. The existing LEXI Solana verifier remains unchanged and authoritative for LEXI payment links.


## Retry and terminal-order safeguards

Clear client rejections (4xx other than `408`, `409`, `425`, and `429`) are recorded as rejected and remain unpaid; a later attempt may safely retry after reviewing the configuration. Network failures, timeouts, server errors, the ambiguous 4xx codes, and incomplete responses remain on hold for reconciliation. Pending/processing notifications never reopen a failed, cancelled, refunded, or on-hold order. Successful provider status for any such order is held for manual review with a persistent order marker, so duplicate notifications cannot later trigger payment completion.
