import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), "utf8");
const api = read("../includes/class-lexi-grateful-api.php");
const gateway = read("../includes/class-lexi-grateful-gateway.php");
const blocks = read("../includes/class-lexi-grateful-blocks.php");
const browser = read("../assets/blocks.js");
const lock = read("../includes/class-lexi-grateful-lock.php");
const bootstrap = read("../lexi-grateful-woocommerce.php");

assert.match(api, /https:\/\/merchant\.grateful\.me/);
assert.match(api, /\/api\/payments\/new/);
assert.match(api, /x-api-key/);
assert.match(api, /'sslverify'\s*=>\s*true/);
assert.match(api, /'redirection'\s*=>\s*0/);
assert.match(api, /'limit_response_size'\s*=>\s*65536/);
assert.match(api, /merchant\.grateful\.me/);
assert.match(api, /\/payment\//);
assert.match(api, /408,\s*409,\s*425,\s*429/);
assert.match(api, /lexi_grateful_http_rejected/);
assert.match(api, /lexi_grateful_http_ambiguous/);

assert.match(bootstrap, /Plugin Name: LEXI Grateful Payments for WooCommerce/);
assert.match(bootstrap, /\\Automattic\\WooCommerce\\Utilities\\FeaturesUtil::declare_compatibility/);
assert.doesNotMatch(bootstrap, /\\\\Automattic\\\\WooCommerce\\\\Utilities\\\\FeaturesUtil::declare_compatibility/);
assert.match(bootstrap, /woocommerce_api_lexi_grateful_webhook/);
assert.match(bootstrap, /woocommerce_api_lexi_grateful_return/);
assert.match(bootstrap, /woocommerce_blocks_payment_method_type_registration/);

assert.match(gateway, /hash_hmac\(\s*'sha256'/);
assert.match(gateway, /hash_equals\(/);
assert.match(gateway, /file_get_contents\(\s*'php:\/\/input'/);
assert.match(gateway, /X_GRATEFUL_SIGNATURE/);
assert.match(gateway, /get_payment_status\(/);
assert.match(gateway, /provider_payment_id\(/);
assert.match(gateway, /event_external_reference\(/);
assert.match(gateway, /META_EXTERNAL_REFERENCE/);
assert.match(gateway, /payment_complete\(\s*\$payment_id\s*\)/);
assert.match(gateway, /array\(\s*'success',\s*'completed',\s*'pending',\s*'processing',\s*'failed',\s*'error',\s*'expired'/);
assert.match(gateway, /'started'/);
assert.match(gateway, /'ambiguous'/);
assert.match(gateway, /'rejected'/);
assert.match(gateway, /'manual-review'/);
assert.match(gateway, /META_MANUAL_REVIEW/);
assert.match(gateway, /requires_manual_review\(/);
assert.match(gateway, /array\( 'cancelled', 'refunded', 'failed', 'on-hold' \)/);
assert.doesNotMatch(gateway, /\$_GET\s*\[\s*['"]status['"]\s*\]/);
assert.doesNotMatch(gateway, /function\s+process_refund\s*\(/);
assert.match(gateway, /array\(\s*'products'\s*\)/);

assert.match(lock, /add_option\(\s*\$key/);
assert.match(lock, /delete_if_unchanged\(/);
assert.match(lock, /DELETE FROM \{\$wpdb->options\} WHERE option_name = %s AND option_value = %s/);
assert.match(lock, /maybe_unserialize\(/);
assert.match(lock, /hash_equals\(/);
assert.match(lock, /wp_cache_delete\(\s*\$key,\s*'options'/);

assert.match(blocks, /'title'/);
assert.match(blocks, /'description'/);
assert.doesNotMatch(blocks, /api_key|webhook_secret/i);
assert.match(browser, /registerPaymentMethod/);
assert.doesNotMatch(browser, /api_key|webhook_secret|secret_key/i);

console.log("Grateful gateway source-contract checks passed (static checks only; no PHP/WooCommerce runtime was available).");
