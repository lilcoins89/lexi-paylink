<?php
/**
 * Small database-backed lock shared across WordPress workers.
 *
 * @package LEXIGratefulWooCommerce
 */

defined( 'ABSPATH' ) || exit;

final class LEXI_Grateful_Lock {
	const TTL_SECONDS = 120;

	/**
	 * Acquire a bounded lock for one order/resource.
	 *
	 * @param string $resource Stable internal resource name.
	 * @return string|WP_Error Lock token or error.
	 */
	public static function acquire( $resource ) {
		$key   = self::option_key( $resource );
		$token = wp_generate_password( 40, false, false );
		$value = array(
			'token'      => $token,
			'expires_at' => time() + self::TTL_SECONDS,
		);

		if ( add_option( $key, $value, '', false ) ) {
			return $token;
		}

		$stored = self::read_raw_value( $key );
		if ( false === $stored ) {
			self::clear_option_cache( $key );
			return add_option( $key, $value, '', false ) ? $token : self::busy_error();
		}

		$existing = maybe_unserialize( $stored );
		if ( ! is_array( $existing ) || empty( $existing['expires_at'] ) || (int) $existing['expires_at'] >= time() ) {
			return self::busy_error();
		}

		// Delete only the exact serialized value we inspected; never remove a newer worker's lock.
		if ( ! self::delete_if_unchanged( $key, $stored ) ) {
			return self::busy_error();
		}
		return add_option( $key, $value, '', false ) ? $token : self::busy_error();
	}

	/**
	 * Release only the still-current lock owned by the caller.
	 *
	 * @param string $resource Stable internal resource name.
	 * @param string $token Caller token.
	 * @return void
	 */
	public static function release( $resource, $token ) {
		$key    = self::option_key( $resource );
		$stored = self::read_raw_value( $key );
		if ( false === $stored ) {
			return;
		}

		$existing = maybe_unserialize( $stored );
		if ( is_array( $existing ) && isset( $existing['token'] ) && is_string( $existing['token'] ) && hash_equals( $existing['token'], (string) $token ) ) {
			self::delete_if_unchanged( $key, $stored );
		}
	}

	/**
	 * Read the uncached serialized option value. False means no row exists.
	 *
	 * @param string $key Option key.
	 * @return string|false
	 */
	private static function read_raw_value( $key ) {
		global $wpdb;

		$value = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT option_value FROM {$wpdb->options} WHERE option_name = %s LIMIT 1",
				$key
			)
		);
		return is_string( $value ) ? $value : false;
	}

	/**
	 * Compare-and-delete a row and invalidate WordPress's option caches if it matched.
	 *
	 * @param string $key Option key.
	 * @param string $stored_value Exact serialized value read from the database.
	 * @return bool
	 */
	private static function delete_if_unchanged( $key, $stored_value ) {
		global $wpdb;

		$deleted = $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s",
				$key,
				$stored_value
			)
		);
		if ( 1 !== (int) $deleted ) {
			return false;
		}

		self::clear_option_cache( $key );
		return true;
	}

	/**
	 * Clear option caches after the lock's direct compare-and-delete query.
	 *
	 * @param string $key Option key.
	 * @return void
	 */
	private static function clear_option_cache( $key ) {
		wp_cache_delete( $key, 'options' );
		wp_cache_delete( 'alloptions', 'options' );
		wp_cache_delete( 'notoptions', 'options' );
	}

	/**
	 * Return a standard busy result.
	 *
	 * @return WP_Error
	 */
	private static function busy_error() {
		return new WP_Error( 'lexi_grateful_busy', __( 'Another payment update is being processed. Please retry shortly.', 'lexi-grateful-woocommerce' ) );
	}

	/**
	 * Derive a fixed-length option key; raw order identifiers are not used as keys.
	 *
	 * @param string $resource Stable internal resource name.
	 * @return string
	 */
	private static function option_key( $resource ) {
		return 'lexi_grateful_lock_' . hash( 'sha256', (string) $resource );
	}
}
