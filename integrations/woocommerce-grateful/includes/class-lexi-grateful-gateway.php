<?php
/**
 * Grateful.me redirect gateway for WooCommerce.
 *
 * @package LEXIGratefulWooCommerce
 */

defined( 'ABSPATH' ) || exit;

final class LEXI_Grateful_Gateway extends WC_Payment_Gateway {
	const META_PAYMENT_ID = '_lexi_grateful_payment_id';
	const META_CHECKOUT_URL = '_lexi_grateful_checkout_url';
	const META_EXTERNAL_REFERENCE = '_lexi_grateful_external_reference';
	const META_CREATE_STATE = '_lexi_grateful_create_state';
	const META_EXPECTED_AMOUNT = '_lexi_grateful_expected_fiat_amount';
	const META_EXPECTED_CURRENCY = '_lexi_grateful_expected_fiat_currency';
	const META_MANUAL_REVIEW = '_lexi_grateful_manual_review';

	/** @var string */
	private $api_key = '';

	/** @var string */
	private $webhook_secret = '';

	/**
	 * Configure settings and checkout labels.
	 */
	public function __construct() {
		$this->id                 = 'lexi_grateful';
		$this->method_title       = __( 'Grateful.me', 'lexi-grateful-woocommerce' );
		$this->method_description = __( 'Redirect customers to Grateful.me to complete payment. Grateful status is checked server-side before WooCommerce marks an order paid.', 'lexi-grateful-woocommerce' );
		$this->has_fields         = false;
		$this->supports           = array( 'products' ); // No refund support is claimed.

		$this->init_form_fields();
		$this->init_settings();
		$this->enabled        = $this->get_option( 'enabled', 'no' );
		$this->title          = $this->get_option( 'title', __( 'Pay with Grateful', 'lexi-grateful-woocommerce' ) );
		$this->description    = $this->get_option( 'description', __( 'You will complete payment on Grateful.me’s secure checkout.', 'lexi-grateful-woocommerce' ) );
		$this->api_key        = trim( (string) $this->get_option( 'api_key', '' ) );
		$this->webhook_secret = trim( (string) $this->get_option( 'webhook_secret', '' ) );

		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
	}

	/**
	 * Gateway settings. Secret values are never localized to checkout JavaScript.
	 *
	 * @return void
	 */
	public function init_form_fields() {
		$this->form_fields = array(
			'enabled' => array(
				'title'   => __( 'Enable/Disable', 'lexi-grateful-woocommerce' ),
				'label'   => __( 'Enable Grateful.me payments', 'lexi-grateful-woocommerce' ),
				'type'    => 'checkbox',
				'default' => 'no',
			),
			'title' => array(
				'title'       => __( 'Checkout title', 'lexi-grateful-woocommerce' ),
				'type'        => 'text',
				'default'     => __( 'Pay with Grateful', 'lexi-grateful-woocommerce' ),
				'description' => __( 'Shown to customers at checkout.', 'lexi-grateful-woocommerce' ),
				'desc_tip'    => true,
			),
			'description' => array(
				'title'       => __( 'Checkout description', 'lexi-grateful-woocommerce' ),
				'type'        => 'textarea',
				'default'     => __( 'You will complete payment on Grateful.me’s secure checkout.', 'lexi-grateful-woocommerce' ),
				'description' => __( 'Do not promise a particular token, exchange rate, fee, or refund unless your Grateful account confirms it.', 'lexi-grateful-woocommerce' ),
				'desc_tip'    => true,
			),
			'api_key' => array(
				'title'             => __( 'Grateful API key', 'lexi-grateful-woocommerce' ),
				'type'              => 'password',
				'default'           => '',
				'description'       => __( 'Stored on this WordPress server and sent only to the documented Grateful API. Leave blank to keep the current key.', 'lexi-grateful-woocommerce' ),
				'desc_tip'          => true,
				'custom_attributes' => array( 'autocomplete' => 'new-password' ),
			),
			'webhook_secret' => array(
				'title'             => __( 'Grateful webhook secret', 'lexi-grateful-woocommerce' ),
				'type'              => 'password',
				'default'           => '',
				'description'       => __( 'Used to verify X-Grateful-Signature on provider callbacks. Stored on this WordPress server; leave blank to keep the current secret.', 'lexi-grateful-woocommerce' ),
				'desc_tip'          => true,
				'custom_attributes' => array( 'autocomplete' => 'new-password' ),
			),
			'notification_url' => array(
				'title'       => __( 'Grateful notification URL', 'lexi-grateful-woocommerce' ),
				'type'        => 'title',
				'description' => '<code>' . esc_html( $this->notification_url() ) . '</code><br />' . esc_html__( 'Register this HTTPS URL in the Grateful integration dashboard. Webhook contents are authenticated and then checked against Grateful’s status API.', 'lexi-grateful-woocommerce' ),
			),
		);
	}

	/**
	 * Avoid rendering stored credentials back into the settings page.
	 *
	 * @param string $key Settings field key.
	 * @param array  $data Field data.
	 * @return string
	 */
	public function generate_password_html( $key, $data ) {
		if ( in_array( $key, array( 'api_key', 'webhook_secret' ), true ) ) {
			$previous = isset( $this->settings[ $key ] ) ? $this->settings[ $key ] : '';
			$this->settings[ $key ] = '';
			$data['placeholder']   = __( 'Configured value is hidden; leave blank to preserve', 'lexi-grateful-woocommerce' );
			$html                  = parent::generate_password_html( $key, $data );
				$this->settings[ $key ] = $previous;
			return $html;
		}
		return parent::generate_password_html( $key, $data );
	}

	/**
	 * Preserve saved secrets when the blank password inputs are submitted.
	 *
	 * @return bool
	 */
	public function process_admin_options() {
		$original_fields = $this->form_fields;
		foreach ( array( 'api_key', 'webhook_secret' ) as $secret_field ) {
			$field_name = $this->get_field_key( $secret_field );
			$posted     = isset( $_POST[ $field_name ] ) && is_scalar( $_POST[ $field_name ] ) ? trim( (string) wp_unslash( $_POST[ $field_name ] ) ) : '';
			if ( '' === $posted ) {
				unset( $this->form_fields[ $secret_field ] );
			}
		}

		$saved             = parent::process_admin_options();
		$this->form_fields = $original_fields;
		$this->init_settings();
		$this->api_key        = trim( (string) $this->get_option( 'api_key', '' ) );
		$this->webhook_secret = trim( (string) $this->get_option( 'webhook_secret', '' ) );
		return $saved;
	}

	/**
	 * Only expose the gateway on an HTTPS site with both credentials configured.
	 *
	 * @return bool
	 */
	public function is_available() {
		if ( ! parent::is_available() || '' === $this->api_key || '' === $this->webhook_secret ) {
			return false;
		}
		return 'https' === strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_SCHEME ) );
	}

	/**
	 * Create one provider payment, or reuse/reconcile the known payment for this order.
	 *
	 * @param int $order_id WooCommerce order ID.
	 * @return array
	 */
	public function process_payment( $order_id ) {
		$order = wc_get_order( absint( $order_id ) );
		if ( ! $order ) {
			return $this->failure_result( __( 'The order could not be loaded. No payment was confirmed.', 'lexi-grateful-woocommerce' ) );
		}
		if ( $order->is_paid() ) {
			return array( 'result' => 'success', 'redirect' => $this->get_return_url( $order ) );
		}
		if ( ! $this->is_available() ) {
			return $this->failure_result( __( 'Grateful payments are not currently available. Please choose another payment method.', 'lexi-grateful-woocommerce' ) );
		}

		$resource = 'order:' . $order->get_id();
		$lock     = LEXI_Grateful_Lock::acquire( $resource );
		if ( is_wp_error( $lock ) ) {
			return $this->failure_result( __( 'This payment is already being processed. Please wait before retrying.', 'lexi-grateful-woocommerce' ) );
		}

		try {
			return $this->process_payment_locked( $order );
		} finally {
			LEXI_Grateful_Lock::release( $resource, $lock );
		}
	}

	/**
	 * Process while holding the per-order lock.
	 *
	 * @param WC_Order $order Order.
	 * @return array
	 */
	private function process_payment_locked( $order ) {
		$payment_id = (string) $order->get_meta( self::META_PAYMENT_ID, true );
		if ( '' !== $payment_id ) {
			$sync = $this->reconcile_order( $order );
			if ( is_wp_error( $sync ) ) {
				return $this->failure_result( __( 'Payment status could not be confirmed. The existing Grateful payment was not duplicated.', 'lexi-grateful-woocommerce' ) );
			}
			if ( $order->is_paid() ) {
				return array( 'result' => 'success', 'redirect' => $this->get_return_url( $order ) );
			}
			$checkout_url = (string) $order->get_meta( self::META_CHECKOUT_URL, true );
			if ( isset( $sync['state'] ) && 'pending' === $sync['state'] && LEXI_Grateful_API::is_safe_checkout_url( $checkout_url ) ) {
				return array( 'result' => 'success', 'redirect' => $checkout_url );
			}
			return $this->failure_result( __( 'This Grateful payment cannot be restarted automatically. Review its status before creating another payment.', 'lexi-grateful-woocommerce' ) );
		}

		$create_state = (string) $order->get_meta( self::META_CREATE_STATE, true );
		if ( 'started' === $create_state || 'ambiguous' === $create_state ) {
			$order->update_status( 'on-hold', __( 'Grateful payment creation may have reached the provider. Check the Grateful dashboard before attempting another payment.', 'lexi-grateful-woocommerce' ) );
			return $this->failure_result( __( 'The previous payment attempt has an unknown outcome. Please contact the store before retrying.', 'lexi-grateful-woocommerce' ) );
		}

		$amount   = wc_format_decimal( $order->get_total(), false, false );
		$currency = strtoupper( (string) $order->get_currency() );
		if ( ! $this->is_valid_amount( $amount ) || ! preg_match( '/^[A-Z]{3}$/', $currency ) ) {
			return $this->failure_result( __( 'This order amount or currency cannot be sent to Grateful.', 'lexi-grateful-woocommerce' ) );
		}

		$external_reference = $this->external_reference_for_order( $order );
		$callback_url       = add_query_arg(
			array(
				'order_id' => $order->get_id(),
				'key'      => $order->get_order_key(),
			),
			$this->customer_return_url()
		);
		if ( 'https' !== strtolower( (string) wp_parse_url( $callback_url, PHP_URL_SCHEME ) ) ) {
			return $this->failure_result( __( 'The store return URL must use HTTPS before Grateful payments can be created.', 'lexi-grateful-woocommerce' ) );
		}

		$order->update_meta_data( self::META_CREATE_STATE, 'started' );
		$order->update_meta_data( self::META_EXPECTED_AMOUNT, $amount );
		$order->update_meta_data( self::META_EXPECTED_CURRENCY, $currency );
		$order->update_meta_data( self::META_EXTERNAL_REFERENCE, $external_reference );
		$order->save();

		$created = LEXI_Grateful_API::create_payment(
			$this->api_key,
			array(
				'fiatAmount'         => $amount,
				'fiatCurrency'       => $currency,
				'externalReferenceId' => $external_reference,
				'callbackUrl'        => $callback_url,
				)
			);
			if ( is_wp_error( $created ) ) {
				if ( in_array( $created->get_error_code(), array( 'lexi_grateful_http_rejected', 'lexi_grateful_not_configured', 'lexi_grateful_encode_failed' ), true ) ) {
					$order->update_meta_data( self::META_CREATE_STATE, 'rejected' );
					$order->add_order_note( __( 'Grateful explicitly rejected payment creation. The order remains unpaid; review the provider configuration before retrying.', 'lexi-grateful-woocommerce' ) );
					$order->save();
					return $this->failure_result( __( 'Grateful did not accept this payment request. The order remains unpaid; please contact the store or choose another payment method.', 'lexi-grateful-woocommerce' ) );
				}

				$order->update_meta_data( self::META_CREATE_STATE, 'ambiguous' );
				$order->update_status( 'on-hold', __( 'Grateful payment creation outcome is unknown. Check the Grateful dashboard before retrying; a second payment was not created automatically.', 'lexi-grateful-woocommerce' ) );
			return $this->failure_result( __( 'Grateful could not confirm whether the payment was created. Contact the store before retrying.', 'lexi-grateful-woocommerce' ) );
		}

		$payment_id = isset( $created['id'] ) && is_scalar( $created['id'] ) ? trim( (string) $created['id'] ) : '';
		$checkout   = isset( $created['url'] ) ? $created['url'] : '';
		if ( '' === $payment_id || strlen( $payment_id ) > 200 ) {
			$order->update_meta_data( self::META_CREATE_STATE, 'ambiguous' );
			$order->update_status( 'on-hold', __( 'Grateful returned an incomplete payment response. Reconcile the payment with Grateful before retrying.', 'lexi-grateful-woocommerce' ) );
			return $this->failure_result( __( 'Grateful returned an incomplete payment response. Contact the store before retrying.', 'lexi-grateful-woocommerce' ) );
		}

		$order->update_meta_data( self::META_PAYMENT_ID, sanitize_text_field( $payment_id ) );
		$order->update_meta_data( self::META_CREATE_STATE, 'created' );
		if ( LEXI_Grateful_API::is_safe_checkout_url( $checkout ) ) {
			$order->update_meta_data( self::META_CHECKOUT_URL, esc_url_raw( $checkout ) );
		}
		$order->save();

		if ( ! LEXI_Grateful_API::is_safe_checkout_url( $checkout ) ) {
			$order->update_status( 'on-hold', __( 'Grateful returned an invalid checkout URL. The payment was not redirected; reconcile it in the Grateful dashboard.', 'lexi-grateful-woocommerce' ) );
			return $this->failure_result( __( 'Grateful returned an invalid checkout address. Contact the store before retrying.', 'lexi-grateful-woocommerce' ) );
		}

		if ( 'pending' !== $order->get_status() ) {
			$order->update_status( 'pending', __( 'Awaiting payment confirmation from Grateful.', 'lexi-grateful-woocommerce' ) );
		}
		if ( function_exists( 'WC' ) && WC()->cart ) {
			WC()->cart->empty_cart();
		}

		return array(
			'result'   => 'success',
			'redirect' => esc_url_raw( $checkout ),
		);
	}

	/**
	 * Handle an HMAC-authenticated provider notification and fetch authoritative status.
	 *
	 * @return void
	 */
	public function handle_webhook() {
		if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'POST' !== strtoupper( (string) $_SERVER['REQUEST_METHOD'] ) ) {
			$this->send_json( 405, false );
		}

		$raw_body = file_get_contents( 'php://input' );
		if ( ! is_string( $raw_body ) || '' === $raw_body || strlen( $raw_body ) > 65536 ) {
			$this->send_json( 400, false );
		}
		if ( '' === $this->webhook_secret ) {
			$this->send_json( 503, false );
		}

		$received_signature = isset( $_SERVER['HTTP_X_GRATEFUL_SIGNATURE'] ) ? trim( (string) wp_unslash( $_SERVER['HTTP_X_GRATEFUL_SIGNATURE'] ) ) : '';
		if ( ! preg_match( '/^[a-fA-F0-9]{64}$/', $received_signature ) ) {
			$this->send_json( 401, false );
		}
		$expected_signature = hash_hmac( 'sha256', $raw_body, $this->webhook_secret );
		if ( ! hash_equals( $expected_signature, strtolower( $received_signature ) ) ) {
			$this->send_json( 401, false );
		}

		$event = json_decode( $raw_body, true );
		if ( ! is_array( $event ) ) {
			$this->send_json( 400, false );
		}
		$external_reference = $this->event_external_reference( $event );
		$order_id           = $this->order_id_from_external_reference( $external_reference );
		if ( ! $order_id ) {
			$this->send_json( 400, false );
		}
		$order = wc_get_order( $order_id );
		if ( ! $order || $external_reference !== (string) $order->get_meta( self::META_EXTERNAL_REFERENCE, true ) ) {
			$this->send_json( 404, false );
		}

		$stored_payment_id = (string) $order->get_meta( self::META_PAYMENT_ID, true );
		$event_payment_id  = $this->event_payment_id( $event );
		if ( '' === $stored_payment_id || ( '' !== $event_payment_id && ! hash_equals( $stored_payment_id, $event_payment_id ) ) ) {
			// A callback can race the create response. Return a retryable status; never trust the event alone.
			$this->send_json( 503, false );
		}

		$resource = 'order:' . $order->get_id();
		$lock     = LEXI_Grateful_Lock::acquire( $resource );
		if ( is_wp_error( $lock ) ) {
			$this->send_json( 503, false );
		}
		try {
			$result = $this->reconcile_order( $order );
		} finally {
			LEXI_Grateful_Lock::release( $resource, $lock );
		}

		if ( is_wp_error( $result ) ) {
			$this->log_safe( 'Authenticated Grateful notification could not be reconciled; provider details were withheld.' );
			$this->send_json( 503, false );
		}
		$this->send_json( 200, true );
	}

	/**
	 * Handle customer return. URL status parameters are ignored; fetch provider status again.
	 *
	 * @return void
	 */
	public function handle_customer_return() {
		$order_id = isset( $_GET['order_id'] ) && is_scalar( $_GET['order_id'] ) ? absint( wp_unslash( $_GET['order_id'] ) ) : 0;
		$order    = $order_id ? wc_get_order( $order_id ) : false;
		$key      = isset( $_GET['key'] ) && is_string( $_GET['key'] ) ? (string) wc_clean( wp_unslash( $_GET['key'] ) ) : '';
		if ( ! $order || '' === $key || ! hash_equals( (string) $order->get_order_key(), $key ) ) {
			$this->send_json( 403, false );
		}

		$resource = 'order:' . $order->get_id();
		$lock     = LEXI_Grateful_Lock::acquire( $resource );
		if ( is_wp_error( $lock ) ) {
			wc_add_notice( __( 'Payment is still being checked. The order has not been marked paid yet.', 'lexi-grateful-woocommerce' ), 'notice' );
			wp_safe_redirect( $this->get_return_url( $order ) );
			exit;
		}
		try {
			if ( ! $order->is_paid() ) {
				$result = $this->reconcile_order( $order );
			} else {
				$result = array( 'state' => 'completed' );
			}
		} finally {
			LEXI_Grateful_Lock::release( $resource, $lock );
		}

		if ( is_wp_error( $result ) || ! $order->is_paid() ) {
			wc_add_notice( __( 'Grateful has not yet confirmed this payment. Your order remains unpaid until its status is verified.', 'lexi-grateful-woocommerce' ), 'notice' );
		}
		wp_safe_redirect( $this->get_return_url( $order ) );
		exit;
	}

	/**
	 * Query Grateful and apply only a known provider status to the matching order.
	 * Caller must hold the per-order lock.
	 *
	 * @param WC_Order $order Order.
	 * @return array|WP_Error
	 */
	private function reconcile_order( $order ) {
		$payment_id = (string) $order->get_meta( self::META_PAYMENT_ID, true );
		if ( '' === $payment_id ) {
			return new WP_Error( 'lexi_grateful_payment_missing', __( 'No Grateful payment ID is stored for this order.', 'lexi-grateful-woocommerce' ) );
		}

		$provider = LEXI_Grateful_API::get_payment_status( $this->api_key, $payment_id );
		if ( is_wp_error( $provider ) ) {
			return $provider;
		}

		$provider_id = $this->provider_payment_id( $provider );
		if ( '' !== $provider_id && ! hash_equals( $payment_id, $provider_id ) ) {
			return new WP_Error( 'lexi_grateful_payment_mismatch', __( 'Grateful returned a different payment ID.', 'lexi-grateful-woocommerce' ) );
		}
		$provider_reference = $this->event_external_reference( $provider );
		$expected_reference = (string) $order->get_meta( self::META_EXTERNAL_REFERENCE, true );
		if ( '' !== $provider_reference && ! hash_equals( $expected_reference, $provider_reference ) ) {
			return new WP_Error( 'lexi_grateful_reference_mismatch', __( 'Grateful returned a different external order reference.', 'lexi-grateful-woocommerce' ) );
		}

		if ( array_key_exists( 'fiatAmount', $provider ) ) {
				$actual_amount   = $this->canonical_amount( $provider['fiatAmount'] );
				$expected_amount = $this->canonical_amount( $order->get_meta( self::META_EXPECTED_AMOUNT, true ) );
				if ( false === $actual_amount || false === $expected_amount || ! hash_equals( $expected_amount, $actual_amount ) ) {
					$order->update_meta_data( self::META_MANUAL_REVIEW, 'yes' );
					$order->update_status( 'on-hold', __( 'Grateful payment amount did not match the stored WooCommerce order amount; manual review is required.', 'lexi-grateful-woocommerce' ) );
				return new WP_Error( 'lexi_grateful_amount_mismatch', __( 'Grateful payment amount did not match this order.', 'lexi-grateful-woocommerce' ) );
			}
		}
		if ( array_key_exists( 'fiatCurrency', $provider ) ) {
				$actual_currency   = strtoupper( (string) $provider['fiatCurrency'] );
				$expected_currency = strtoupper( (string) $order->get_meta( self::META_EXPECTED_CURRENCY, true ) );
				if ( '' !== $expected_currency && ! hash_equals( $expected_currency, $actual_currency ) ) {
					$order->update_meta_data( self::META_MANUAL_REVIEW, 'yes' );
					$order->update_status( 'on-hold', __( 'Grateful payment currency did not match the stored WooCommerce order; manual review is required.', 'lexi-grateful-woocommerce' ) );
				return new WP_Error( 'lexi_grateful_currency_mismatch', __( 'Grateful payment currency did not match this order.', 'lexi-grateful-woocommerce' ) );
			}
		}

		$status = isset( $provider['status'] ) && is_string( $provider['status'] ) ? strtolower( trim( $provider['status'] ) ) : '';
		$known  = array( 'success', 'completed', 'pending', 'processing', 'failed', 'error', 'expired' );
		if ( ! in_array( $status, $known, true ) ) {
			return new WP_Error( 'lexi_grateful_unknown_status', __( 'Grateful returned a status that requires manual review.', 'lexi-grateful-woocommerce' ) );
		}

		$order->update_meta_data( '_lexi_grateful_last_provider_status', $status );
		$order->update_meta_data( '_lexi_grateful_last_checked_at', gmdate( 'c' ) );

		if ( in_array( $status, array( 'success', 'completed' ), true ) ) {
			if ( $order->is_paid() ) {
				$order->save();
				return array( 'state' => 'completed' );
				}
				if ( $this->requires_manual_review( $order ) ) {
					$message = __( 'Grateful reports a successful payment for an order that is cancelled, failed, refunded, or manually held. Manual review is required; automatic fulfillment was not triggered.', 'lexi-grateful-woocommerce' );
					$manual_review = 'yes' === (string) $order->get_meta( self::META_MANUAL_REVIEW, true );
					if ( ! $manual_review ) {
						$order->update_meta_data( self::META_MANUAL_REVIEW, 'yes' );
					}
					if ( 'on-hold' !== $order->get_status() ) {
						$order->update_status( 'on-hold', $message );
					} elseif ( ! $manual_review ) {
						$order->add_order_note( $message );
					}
					$order->save();
					return array( 'state' => 'manual-review' );
				}
			$order->payment_complete( $payment_id );
			$order->add_order_note( __( 'Payment status confirmed directly with Grateful.me.', 'lexi-grateful-woocommerce' ) );
			$order->update_meta_data( self::META_CREATE_STATE, 'completed' );
			$order->save();
			return array( 'state' => 'completed' );
		}

			if ( in_array( $status, array( 'pending', 'processing' ), true ) ) {
				if ( ! $order->is_paid() && ! $this->requires_manual_review( $order ) && 'pending' !== $order->get_status() ) {
					$order->update_status( 'pending', __( 'Grateful reports that payment is still pending. This order has not been marked paid.', 'lexi-grateful-woocommerce' ) );
			}
			$order->save();
			return array( 'state' => 'pending' );
		}

		if ( ! $order->is_paid() && in_array( $status, array( 'failed', 'error' ), true ) && 'failed' !== $order->get_status() ) {
			$order->update_status( 'failed', __( 'Grateful confirmed that payment failed.', 'lexi-grateful-woocommerce' ) );
		}
		if ( ! $order->is_paid() && 'expired' === $status && 'cancelled' !== $order->get_status() ) {
			$order->update_status( 'cancelled', __( 'Grateful confirmed that the payment expired.', 'lexi-grateful-woocommerce' ) );
		}
		$order->save();
		return array( 'state' => $status );
	}

	/**
	 * Build the provider's server-to-server notification endpoint.
	 *
	 * @return string
	 */
	private function notification_url() {
		return home_url( '/wc-api/lexi_grateful_webhook/' );
	}

	/**
	 * Build a customer-return endpoint carrying only the WooCommerce order key.
	 *
	 * @return string
	 */
	private function customer_return_url() {
		return home_url( '/wc-api/lexi_grateful_return/' );
	}

	/**
	 * Stable external reference that can be mapped back to this WordPress site/order.
	 *
	 * @param WC_Order $order Order.
	 * @return string
	 */
	private function external_reference_for_order( $order ) {
		return 'wc-' . absint( get_current_blog_id() ) . '-order-' . absint( $order->get_id() );
	}

	/**
	 * Do not let provider callbacks reopen terminal or explicitly held orders.
	 *
	 * @param WC_Order $order Order.
	 * @return bool
	 */
	private function requires_manual_review( $order ) {
		return 'yes' === (string) $order->get_meta( self::META_MANUAL_REVIEW, true )
			|| in_array( $order->get_status(), array( 'cancelled', 'refunded', 'failed', 'on-hold' ), true );
	}

	/**
	 * Extract and validate an external reference from a provider payload.
	 *
	 * @param array $payload Provider payload.
	 * @return string
	 */
	private function event_external_reference( $payload ) {
		foreach ( array( 'externalReferenceId', 'external_reference_id' ) as $key ) {
			if ( isset( $payload[ $key ] ) && is_scalar( $payload[ $key ] ) ) {
				return (string) $payload[ $key ];
			}
		}
		return '';
	}

	/**
	 * Extract an optional provider payment ID from an event/status response.
	 *
	 * @param array $payload Provider payload.
	 * @return string
	 */
	private function event_payment_id( $payload ) {
		foreach ( array( 'paymentId', 'payment_id', 'id' ) as $key ) {
			if ( isset( $payload[ $key ] ) && is_scalar( $payload[ $key ] ) ) {
				return trim( (string) $payload[ $key ] );
			}
		}
		return '';
	}

	/**
	 * Extract provider's payment identifier from status response.
	 *
	 * @param array $payload Provider payload.
	 * @return string
	 */
	private function provider_payment_id( $payload ) {
		return $this->event_payment_id( $payload );
	}

	/**
	 * Map only well-formed references for this WordPress multisite/blog instance.
	 *
	 * @param string $reference External reference.
	 * @return int
	 */
	private function order_id_from_external_reference( $reference ) {
		if ( ! preg_match( '/^wc-([0-9]+)-order-([0-9]+)$/D', (string) $reference, $matches ) ) {
			return 0;
		}
		if ( (int) $matches[1] !== (int) get_current_blog_id() ) {
			return 0;
		}
		return absint( $matches[2] );
	}

	/**
	 * Ensure the amount is a positive decimal string without using floating point.
	 *
	 * @param mixed $amount Candidate amount.
	 * @return bool
	 */
	private function is_valid_amount( $amount ) {
		return false !== $this->canonical_amount( $amount ) && preg_match( '/[1-9]/', (string) $amount );
	}

	/**
	 * Canonicalize a decimal amount for exact string comparison.
	 *
	 * @param mixed $amount Candidate amount.
	 * @return string|false
	 */
	private function canonical_amount( $amount ) {
		if ( ! is_scalar( $amount ) ) {
			return false;
		}
		$value = trim( (string) $amount );
		if ( ! preg_match( '/^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$/', $value ) ) {
			return false;
		}
		$parts    = explode( '.', $value, 2 );
		$integer  = ltrim( $parts[0], '0' );
		$integer  = '' === $integer ? '0' : $integer;
		$fraction = isset( $parts[1] ) ? rtrim( $parts[1], '0' ) : '';
		return '' === $fraction ? $integer : $integer . '.' . $fraction;
	}

	/**
	 * Return a generic checkout failure without including provider details.
	 *
	 * @param string $message Safe customer-facing message.
	 * @return array
	 */
	private function failure_result( $message ) {
		if ( function_exists( 'wc_add_notice' ) ) {
			wc_add_notice( $message, 'error' );
		}
		return array( 'result' => 'failure', 'redirect' => wc_get_checkout_url() );
	}

	/**
	 * Send a minimal callback response after locks have been released.
	 *
	 * @param int  $status HTTP response status.
	 * @param bool $success Whether the callback was handled.
	 * @return void
	 */
	private function send_json( $status, $success ) {
		status_header( (int) $status );
		nocache_headers();
		wp_send_json( array( 'ok' => (bool) $success ), (int) $status );
	}

	/**
	 * Redacted server-side diagnostic.
	 *
	 * @param string $message Safe message only.
	 * @return void
	 */
	private function log_safe( $message ) {
		if ( function_exists( 'wc_get_logger' ) ) {
			wc_get_logger()->warning( $message, array( 'source' => 'lexi-grateful-woocommerce' ) );
		}
	}
}
