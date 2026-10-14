<?php
/**
 * WooCommerce Blocks payment-method registration.
 *
 * @package LEXIGratefulWooCommerce
 */

defined( 'ABSPATH' ) || exit;

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

final class LEXI_Grateful_Blocks extends AbstractPaymentMethodType {
	/** @var string */
	protected $name = 'lexi_grateful';

	/**
	 * Load only the public display settings.
	 *
	 * @return void
	 */
	public function initialize() {
		$this->settings = get_option( 'woocommerce_lexi_grateful_settings', array() );
	}

	/**
	 * Whether the server-side gateway is configured and available.
	 *
	 * @return bool
	 */
	public function is_active() {
		$gateway = new LEXI_Grateful_Gateway();
		return $gateway->is_available();
	}

	/**
	 * Register a dependency-light script using WooCommerce's provided globals.
	 *
	 * @return array
	 */
	public function get_payment_method_script_handles() {
		$path    = __DIR__ . '/../assets/blocks.js';
		$version = file_exists( $path ) ? (string) filemtime( $path ) : LEXI_GRATEFUL_VERSION;
		wp_register_script(
			'lexi-grateful-blocks',
			plugins_url( 'assets/blocks.js', LEXI_GRATEFUL_FILE ),
			array( 'wp-element', 'wc-blocks-registry', 'wc-settings' ),
			$version,
			true
		);
		return array( 'lexi-grateful-blocks' );
	}

	/**
	 * Expose only buyer-facing content; never expose API keys or webhook secrets.
	 *
	 * @return array
	 */
	public function get_payment_method_data() {
		$settings = is_array( $this->settings ) ? $this->settings : array();
		return array(
			'title'       => isset( $settings['title'] ) ? sanitize_text_field( $settings['title'] ) : __( 'Pay with Grateful', 'lexi-grateful-woocommerce' ),
			'description' => isset( $settings['description'] ) ? sanitize_textarea_field( $settings['description'] ) : __( 'You will complete payment on Grateful.me’s secure checkout.', 'lexi-grateful-woocommerce' ),
			'supports'    => array( 'products' ),
		);
	}
}
