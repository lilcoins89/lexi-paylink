<?php
/**
 * Plugin Name: LEXI Grateful Payments for WooCommerce
 * Description: Redirect WooCommerce customers to Grateful.me and reconcile payment status server-side.
 * Version: 1.0.0
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * Text Domain: lexi-grateful-woocommerce
 *
 * @package LEXIGratefulWooCommerce
 */

defined( 'ABSPATH' ) || exit;

define( 'LEXI_GRATEFUL_FILE', __FILE__ );
define( 'LEXI_GRATEFUL_VERSION', '1.0.0' );

add_action(
	'before_woocommerce_init',
		static function () {
			if ( class_exists( '\\Automattic\\WooCommerce\\Utilities\\FeaturesUtil' ) ) {
				\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', LEXI_GRATEFUL_FILE, true );
			}
		}
);

add_action( 'plugins_loaded', 'lexi_grateful_woocommerce_bootstrap', 20 );

/**
 * Load the gateway only after WooCommerce has initialized its payment APIs.
 *
 * @return void
 */
function lexi_grateful_woocommerce_bootstrap() {
	if ( ! class_exists( 'WooCommerce' ) || ! class_exists( 'WC_Payment_Gateway' ) ) {
		if ( is_admin() ) {
			add_action( 'admin_notices', 'lexi_grateful_woocommerce_missing_wc_notice' );
		}
		return;
	}

	require_once __DIR__ . '/includes/class-lexi-grateful-api.php';
	require_once __DIR__ . '/includes/class-lexi-grateful-lock.php';
	require_once __DIR__ . '/includes/class-lexi-grateful-gateway.php';

	add_filter(
		'woocommerce_payment_gateways',
		static function ( $gateways ) {
			$gateways[] = 'LEXI_Grateful_Gateway';
			return $gateways;
		}
	);

	// These routes are registered before WooCommerce dispatches its wc-api query.
	$gateway = new LEXI_Grateful_Gateway();
	add_action( 'woocommerce_api_lexi_grateful_webhook', array( $gateway, 'handle_webhook' ) );
	add_action( 'woocommerce_api_lexi_grateful_return', array( $gateway, 'handle_customer_return' ) );
	add_action( 'admin_notices', 'lexi_grateful_woocommerce_configuration_notice' );

	add_action(
		'woocommerce_blocks_loaded',
		static function () {
			if ( ! class_exists( '\\Automattic\\WooCommerce\\Blocks\\Payments\\Integrations\\AbstractPaymentMethodType' ) ) {
				return;
			}

			require_once __DIR__ . '/includes/class-lexi-grateful-blocks.php';
			add_action(
				'woocommerce_blocks_payment_method_type_registration',
				static function ( $registry ) {
					$registry->register( new LEXI_Grateful_Blocks() );
				}
			);
		}
	);
}

/**
 * Show an escaped dependency notice instead of triggering a fatal error.
 *
 * @return void
 */
function lexi_grateful_woocommerce_missing_wc_notice() {
	if ( ! current_user_can( 'activate_plugins' ) ) {
		return;
	}
	echo '<div class="notice notice-error"><p>' . esc_html__( 'LEXI Grateful Payments requires WooCommerce to be active.', 'lexi-grateful-woocommerce' ) . '</p></div>';
}

/**
 * Warn administrators when the gateway is enabled but cannot safely process payments.
 *
 * @return void
 */
function lexi_grateful_woocommerce_configuration_notice() {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		return;
	}

	$settings = get_option( 'woocommerce_lexi_grateful_settings', array() );
	$enabled  = isset( $settings['enabled'] ) && 'yes' === $settings['enabled'];
	if ( ! $enabled ) {
		return;
	}

	$secure_site = 'https' === strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_SCHEME ) );
	$has_api_key = ! empty( $settings['api_key'] );
	$has_secret  = ! empty( $settings['webhook_secret'] );
	if ( $secure_site && $has_api_key && $has_secret ) {
		return;
	}

	if ( ! $secure_site ) {
		$message = __( 'The Grateful gateway is enabled, but the WordPress site URL must use HTTPS before the gateway can accept payments.', 'lexi-grateful-woocommerce' );
	} else {
		$message = __( 'The Grateful gateway is enabled, but its API key and webhook secret must both be configured in WooCommerce payment settings.', 'lexi-grateful-woocommerce' );
	}

	echo '<div class="notice notice-warning"><p>' . esc_html( $message ) . '</p></div>';
}
