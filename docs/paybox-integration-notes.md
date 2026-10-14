# Integration research notes

Reviewed 14 October 2026 before implementation.

## PayBox

- The official SDK and CLI page describes `@paybox-sh/sdk` as a typed Node SDK wrapping PayBox’s MCP surface. It documents `PayboxClient`, runtime discovery/invocation of PayBox plugins, and methods including `listCredentials`, `verifySolanaBalance`, `getRequest`, `discoverPlugins`, `getPluginContract`, and `usePlugin`.
- PayBox’s OAuth 2.1 page documents dynamic public-client registration, authorization-code + PKCE (S256), user-selected credential grants, `mcp` and optional `offline_access` scopes, and bearer access to `https://api.paybox.sh/mcp`. It has no client secret. Sensitive operations can still require passkey approval.
- The official `moonpay/paybox-plugin` repository contains `.mcp.json` and `.grok-plugin/plugin.json`; its README says the package is currently for Grok and that the server endpoint is `https://api.paybox.sh/mcp`. That is a plugin for connecting an agent to PayBox, not documentation of a third-party PayBox plugin submission API.
- The reviewed documentation/source does not expose an incoming USDC merchant-invoice/payment-link API or a Solana settlement webhook. LEXI therefore creates and verifies its own invoices; PayBox wallet/credential tools cannot mark a LEXI invoice paid.

Sources:

- [PayBox SDK & CLI](https://docs.paybox.sh/sdk-cli)
- [PayBox OAuth 2.1](https://docs.paybox.sh/connect/oauth)
- [PayBox MCP tools](https://docs.paybox.sh/reference/mcp-tools)
- [Official PayBox plugin repository](https://github.com/moonpay/paybox-plugin)
- [PayBox SDK package](https://www.npmjs.com/package/@paybox-sh/sdk)

## Circle USDC mint addresses

Circle’s official address table lists Solana mainnet USDC as `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and Solana Devnet USDC as `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Circle labels testnet tokens as having no financial value.

Source: [USDC contract addresses — Circle Docs](https://developers.circle.com/stablecoins/usdc-contract-addresses)

## Solana Pay invoice references

Reviewed 14 October 2026 before wiring per-invoice references into checkout.

- The Solana Pay protocol specification defines the transfer URL parameters as `solana:<recipient>?amount=...&spl-token=...&reference=...`; the reference must be a base58-encoded 32-byte value. Wallets must attach each reference as a read-only, non-signer account to the token transfer instruction. Validators index transactions by these account keys, allowing a merchant to use `getSignaturesForAddress` or inspect the finalized transaction to find the intended payment.
- The official Solana Pay wallet guide says a wallet should preserve the URL's original intent and add all supplied references to the SPL transfer instruction. The LEXI wallet adapter follows this by attaching its generated per-invoice public key to the USDC transfer instruction. The server requires that reference to appear in the finalized transaction before evaluating the token-balance delta.
- References are public identifiers, not private keys. LEXI stores only the public key; it discards the generated keypair secret immediately.

Sources:

- [Solana Pay specification](https://docs.solanapay.com/spec)
- [Solana Pay wallet integration](https://docs.solanapay.com/core/transfer-request/wallet-integration)
- [Solana official transfer requests guide](https://solana.com/docs/tools/solana-pay/quickstart/transfer-requests)
- [Solana Pay overview](https://solana.com/docs/tools/solana-pay/overview)
