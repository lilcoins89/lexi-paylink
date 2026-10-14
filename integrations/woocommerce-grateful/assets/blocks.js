( function () {
	'use strict';

	if ( ! window.wc || ! window.wc.wcBlocksRegistry || ! window.wc.wcSettings || ! window.wp || ! window.wp.element ) {
		return;
	}

	const registerPaymentMethod = window.wc.wcBlocksRegistry.registerPaymentMethod;
	const getSetting = window.wc.wcSettings.getSetting;
	const createElement = window.wp.element.createElement;
	if ( typeof registerPaymentMethod !== 'function' || typeof getSetting !== 'function' || typeof createElement !== 'function' ) {
		return;
	}

	const settings = getSetting( 'lexi_grateful_data', {} );
	const title = settings.title || 'Pay with Grateful';
	const description = settings.description || 'You will complete payment on Grateful.me’s secure checkout.';
	const content = createElement( 'div', { className: 'lexi-grateful-blocks-description' }, description );

	registerPaymentMethod( {
		name: 'lexi_grateful',
		label: createElement( 'span', null, title ),
		content: content,
		edit: content,
		ariaLabel: title,
		canMakePayment: function () {
			return true;
		},
		supports: {
			features: Array.isArray( settings.supports ) ? settings.supports : [ 'products' ],
		},
	} );
} )();
