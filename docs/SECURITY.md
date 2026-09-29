# Security and transaction model

Current engineering reference for Signal's live beta. This document describes the implementation currently used by the web app and should be updated whenever the launch, trading, authority, or compliance model changes.

## Wallet and custody model

- Signal is non-custodial. Application code does not request, generate, store, or receive a user's seed phrase or private key.
- Wallet actions are approved in the user's connected wallet. The application can build or request transactions, but it cannot sign on the user's behalf.
- Signal does not hold user balances or custody user funds.
- Every transaction shown to a user should be treated as untrusted until the user has reviewed the network, amount, recipients, and instructions in the wallet prompt.

## Current Solana launch model

Signal's live Solana launch flow creates a classic SPL Token mint on Mainnet.

For tokens created through the current Signal flow:

1. The creator chooses the token name, symbol, logo, description, total supply, and decimals.
2. Token metadata is stored on Arweave and the on-chain metadata is created as immutable.
3. The configured total supply is minted to the creator wallet.
4. Mint authority is revoked after the supply is minted.
5. Signal reads the mint back from chain and verifies the supply lock where possible before reporting the launch as complete.
6. No freeze authority is configured for a new Signal-created token.

After mint authority has been revoked and that state is confirmed on-chain, additional supply cannot be minted. Externally indexed tokens can have different authority settings and must be inspected independently.

## Fees

### Launch fee

The current Solana launch transaction includes a fixed **0.001 SOL Signal launch fee** paid to the configured Signal platform wallet. Solana rent, network fees, metadata costs, and any approved storage payment are separate.

### Signal trading fee

Signal's current Solana buy flow charges a **1% fee on the gross SOL amount** for eligible buys executed through Signal. The fee is paid in SOL to the configured Signal platform wallet.

The Signal trading fee:

- applies to eligible Solana buys routed and executed through Signal;
- is not a token transfer tax;
- is not implemented with Token-2022 `TransferFeeConfig`;
- is not charged by Signal on ordinary wallet-to-wallet token transfers;
- is not charged by Signal on trades completed directly on an external market; and
- does not fund a holder-reward mechanism.

The current buy transaction is designed so the swap and the Signal fee are part of the same transaction: both succeed or both fail. The complete transaction is presented to the user's wallet before signing.

## Current trading status

- Solana buy execution is live in beta when Signal can build a valid route for the selected token and amount.
- Solana sell execution is not yet implemented in-app; external market links are used where appropriate.
- Base and BNB Chain discovery is live, while Signal token creation and in-app trading on those chains remain planned.

## Transaction integrity

The browser checks the transaction it prepared against the transaction returned after wallet signing so that unexpected material changes can be rejected. Wallet software may add known safety or compute instructions; those are handled only where the implementation explicitly permits them.

No integrity check is a substitute for the user reading the wallet prompt before approval.

## Regional restrictions and sanctions screening

Regional availability is configured in `config/restrictions.json` and enforced by the Cloudflare Worker for relevant launch and trade-building actions. The browser mirrors those checks so users receive an explanation before attempting a blocked action.

Wallet addresses are screened against the digital-currency addresses published in the US Treasury OFAC SDN data used by the application. If screening is unavailable, launch and trade actions fail closed until the check can be completed. This screening is one control and must not be described as a guarantee that every sanctioned person or prohibited transaction can be detected from a wallet address alone.

## Data and evidence labels

Signal distinguishes between:

- blockchain-derived data;
- Signal-verified facts produced by a stated verification process;
- creator-provided information;
- third-party data; and
- community-reported information.

Signal should not convert those facts into a proprietary "safe" score or guarantee about a token, project, wallet, or future performance.

## Current limitations

- Signal itself has not undergone a professional security audit.
- Third-party market data and indexed on-chain data can be delayed, incomplete, or temporarily unavailable.
- Wallet-address screening cannot establish the real-world identity or control of every wallet.
- IP geolocation can be inaccurate or bypassed and is not a substitute for legal compliance.
- External tokens can have different mint, freeze, metadata, liquidity, or trading authorities from tokens created through Signal.
- Features and supported networks can change as the beta develops.

## Before broader production use

The highest-priority non-code work remains:

1. independent professional security review of the live launch and transaction-building paths;
2. legal review of the platform's launch, trading, fee, promotion, sanctions, and jurisdictional model; and
3. continued verification that public-facing copy matches the actual deployed behavior before every release.
