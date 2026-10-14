<?php
/**
 * Minimal server-side client for the Grateful API contract used by the gateway.
 *
 * @package LEXIGratefulWooCommerce
 */

defined( 'ABSPATH' ) || exit;

final class LEXI_Grateful_API {
	const API_ORIGIN = 'https://merchant.grateful.me';

	/**
	 * Create a provider checkout for a WooCommerce order.
	 *
	 * @param string $api_key API key kept in WooCommerce server settings.
	 * @param array  $payment Payment fields documented by the upstream integration.
	 * @return array|WP_Error
	 */
	public static function create_payment( $api_key, $payment ) {
		return self::request( 'POST', '/api/payments/new', $api_key, $payment, 20 );
	}

	/**
	 * Fetch the provider's authoritative status for a known payment ID.
	 *
	 * @param string $api_key API key kept in WooCommerce server settings.
	 * @param string $payment_id Provider payment ID saved on the order.
	 * @return array|WP_Error
	 */
	public static function get_payment_status( $api_key, $payment_id ) {
		if ( ! is_string( $payment_id ) || '' === $payment_id || strlen( $payment_id ) > 200 ) {
			return new WP_Error( 'lexi_grateful_invalid_payment_id', __( 'The provider payment identifier is invalid.', 'lexi-grateful-woocommerce' ) );
		}

		$response = self::request( 'GET', '/api/payments/' . rawurlencode( $payment_id ) . '/status', $api_key, null, 12 );
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		if ( empty( $response['status'] ) || ! is_string( $response['status'] ) ) {
			return new WP_Error( 'lexi_grateful_status_missing', __( 'Grateful returned no payment status.', 'lexi-grateful-woocommerce' ) );
		}
		return $response;
	}

	/**
	 * Validate Grateful's checkout redirect against the documented fixed host.
	 *
	 * @param mixed $url Candidate remote checkout URL.
	 * @return bool
	 */
	public static function is_safe_checkout_url( $url ) {
		if ( ! is_string( $url ) || strlen( $url ) > 2048 || preg_match( '/[\x00-\x20\x7f]/', $url ) ) {
			return false;
		}

		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) || empty( $parts['path'] ) ) {
			return false;
		}

		return 'https' === strtolower( $parts['scheme'] )
			&& 'merchant.grateful.me' === strtolower( $parts['host'] )
			&& 0 === strpos( $parts['path'], '/payment/' )
			&& empty( $parts['user'] )
			&& empty( $parts['pass'] )
			&& ( empty( $parts['port'] ) || 443 === (int) $parts['port'] );
	}

	/**
	 * Make a bounded request only to the documented Grateful API origin.
	 *
	 * @param string     $method HTTP method.
	 * @param string     $path Fixed API path.
	 * @param string     $api_key Server-side API key.
	 * @param array|null $body Optional JSON body.
	 * @param int        $timeout Request timeout in seconds.
	 * @return array|WP_Error
	 */
	private static function request( $method, $path, $api_key, $body, $timeout ) {
		if ( ! is_string( $api_key ) || '' === trim( $api_key ) ) {
			return new WP_Error( 'lexi_grateful_not_configured', __( 'Grateful is not configured.', 'lexi-grateful-woocommerce' ) );
		}

		$args = array(
			'method'              => $method,
			'timeout'             => $timeout,
			'redirection'         => 0,
			'sslverify'           => true,
			'reject_unsafe_urls'  => true,
			'limit_response_size' => 65536,
			'headers'             => array(
				'Accept'       => 'application/json',
				'Content-Type' => 'application/json',
				'x-api-key'   => trim( $api_key ),
			),
		);
		if ( is_array( $body ) ) {
			$args['body'] = wp_json_encode( $body );
			if ( false === $args['body'] ) {
				return new WP_Error( 'lexi_grateful_encode_failed', __( 'The payment request could not be prepared.', 'lexi-grateful-woocommerce' ) );
			}
		}

		$response = wp_remote_request( self::API_ORIGIN . $path, $args );
		if ( is_wp_error( $response ) ) {
			self::log( 'Grateful API request failed; provider details were withheld.' );
			return new WP_Error( 'lexi_grateful_network_error', __( 'Grateful could not be reached. The order has not been marked paid.', 'lexi-grateful-woocommerce' ) );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			self::log( 'Grateful API returned a non-success HTTP status; response body was withheld.' );
			// Treat likely processed/ambiguous responses conservatively; only clear client rejections permit a safe retry.
			$ambiguous_client_codes = array( 408, 409, 425, 429 );
			$is_explicit_rejection = $code >= 400 && $code < 500 && ! in_array( $code, $ambiguous_client_codes, true );
			$error_code            = $is_explicit_rejection ? 'lexi_grateful_http_rejected' : 'lexi_grateful_http_ambiguous';
			return new WP_Error( $error_code, __( 'Grateful did not accept the request. The order has not been marked paid.', 'lexi-grateful-woocommerce' ), array( 'http_status' => $code ) );
		}

		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $decoded ) ) {
			self::log( 'Grateful API returned an invalid JSON response; response body was withheld.' );
			return new WP_Error( 'lexi_grateful_invalid_response', __( 'Grateful returned an invalid response. The order has not been marked paid.', 'lexi-grateful-woocommerce' ) );
		}

		return $decoded;
	}

	/**
	 * Write a redacted log line; never include credentials, payloads, or customer data.
	 *
	 * @param string $message Safe diagnostic.
	 * @return void
	 */
	private static function log( $message ) {
		if ( function_exists( 'wc_get_logger' ) ) {
			wc_get_logger()->warning( $message, array( 'source' => 'lexi-grateful-woocommerce' ) );
		}
	}
}
