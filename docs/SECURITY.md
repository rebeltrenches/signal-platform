# Security and transaction model

Current engineering reference for Signal's bonding-curve branch. This document should stay aligned with the launch, trading, authority, fee, graduation, and compliance behavior actually implemented in code.

## Wallet and custody model

- Signal does not request, generate, store, or receive a user's seed phrase or private key.
- Wallet actions are approved in the user's connected wallet. The application can build transactions, but it cannot sign on the user's behalf.
- Signal does not hold a user account balance or take control of a connected wallet.
- SOL paid into a live bonding curve becomes on-chain curve liquidity governed by the Signal program rules.
- Every transaction should be reviewed in the wallet before approval, including network, amount, recipients, and instructions.

## Current Solana launch model

Signal-created Solana tokens use the classic SPL Token program plus Signal's on-chain constant-product bonding-curve program.

For a new Signal bonding-curve launch:

1. The creator chooses the token name, symbol, logo, description, total supply, and decimals.
2. Token metadata is stored on Arweave and created as immutable on-chain metadata.
3. The configured total supply is minted directly into the program-owned bonding-curve token vault; the creator receives no automatic token allocation.
4. Mint authority is revoked before curve initialization is accepted, and no freeze authority is configured.
5. The bonding-curve program verifies the mint supply, authorities, and vault custody on-chain before creating curve state.
6. 79.31% of supply is available as real bonding-curve sale inventory and 20.69% remains under program control for graduation liquidity.
7. The curve begins with a 30 SOL virtual SOL reserve and a virtual token reserve equal to 107.30% of the fixed supply.
8. When the sale inventory reaches zero, curve trading closes and the reserved tokens plus available curve SOL can graduate to Raydium CPMM.

The protocol minimum supply is 100,000,000 tokens and is enforced by the Solana program as well as the website. The website also rejects supplies that would exceed the curve program's safe `u64` virtual-reserve range.

After mint authority is revoked and confirmed on-chain, additional supply cannot be minted. Externally indexed tokens can use different authority, custody, or liquidity models and must be inspected independently.

## Fees

### Launch fee

The Signal bonding-curve program enforces a fixed **0.001 SOL Signal launch fee** during curve initialization and binds the recipient to the configured Signal platform wallet. A direct program caller cannot substitute another recipient or skip the fee. The fee transfer and curve initialization are part of the same Solana transaction, so a failed initialization rolls the fee transfer back atomically.

Solana rent, transaction fees, metadata costs, and any separately approved storage payment are additional costs.

### Signal curve trading fee

Before graduation, the bonding-curve program charges a **1% fee in SOL** on both curve buys and curve sells. The recipient is bound in the program to the configured Signal platform wallet.

The Signal curve trading fee:

- is settled in SOL;
- is not a token transfer tax;
- is not implemented with Token-2022 `TransferFeeConfig`;
- is not charged on ordinary wallet-to-wallet token transfers; and
- does not fund a holder-reward mechanism.

On buys, the program separates the fee from the net SOL added to curve reserves. On sells, the fee is deducted from the gross curve payout. A failed curve transaction does not separately complete the fee transfer.

## Bonding-curve behavior

The curve uses virtual constant-product reserves for price discovery. Buys reduce token reserves and increase SOL reserves; sells return tokens to the curve and withdraw SOL subject to available real reserves and the configured fee.

Important enforced properties include:

- the creator starts with 0 automatically allocated tokens;
- the full fixed supply begins in the program-owned token vault;
- buyers can receive output only into a token account owned by the signing buyer;
- a human creator cannot directly drain the curve vault;
- the same curve cannot be initialized twice;
- buy and sell slippage minimums are enforced on-chain;
- a final buy takes only the exact amount needed to finish the remaining sale inventory, even if the buyer authorizes a larger maximum; and
- once the curve is complete, further curve buys and sells are rejected.

## Graduation to Raydium

A completed curve reserves 20.69% of the fixed supply for post-curve liquidity. Graduation migrates that token reserve and the available curve SOL into Raydium CPMM.

The implementation uses a two-stage graduation instruction because direct lamport movement and later CPI calls in the same program invocation can cause Solana runtime balance errors. In the normal final-fill path, both stages can be included in one outer transaction so the user's final curve purchase and graduation remain atomic. A permissionless recovery path can resume a prepared graduation later if the normal flow is interrupted.

The Raydium integration validates the expected CPMM program, config, pool PDAs, vaults, observation account, and create-pool fee receiver. The create-pool fee is read from Raydium's config account rather than hard-coded as an assumed amount.

After pool creation, the Signal migration PDA burns the withdrawable LP tokens it receives. Automated runtime tests verify that the resulting pool can execute a real token-to-WSOL swap in an isolated validator loaded with cloned public Raydium program/config state.

## Current trading status

- Before graduation, Signal-created curve tokens support non-custodial Solana buys and sells through the Signal bonding-curve program.
- A completed curve can graduate its reserved inventory and available SOL to Raydium CPMM.
- After graduation, trading uses the available external-market route rather than the completed Signal curve.
- Base and BNB Chain discovery is live, while Signal token creation and in-app trading on those chains remain planned.

## Transaction integrity

The browser checks the transaction it prepared against the transaction returned after wallet signing so unexpected material changes can be rejected. Wallet software may add known safety or compute instructions only where the implementation explicitly allows them.

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

- Signal itself has not undergone an independent professional smart-contract security audit.
- Passing automated tests is not a substitute for an independent audit.
- Third-party market data and indexed on-chain data can be delayed, incomplete, or temporarily unavailable.
- Wallet-address screening cannot establish the real-world identity or control of every wallet.
- IP geolocation can be inaccurate or bypassed and is not a substitute for legal compliance.
- Raydium or Solana protocol behavior, accounts, fees, or program versions can change and must be revalidated before production changes.
- Externally discovered tokens can have different mint, freeze, metadata, liquidity, or trading authorities from Signal-created tokens.
- Features and supported networks can change as the beta develops.

## Before production enablement

The highest-priority remaining work includes:

1. independent professional security review of the bonding-curve, launch, trading, and Raydium-graduation paths;
2. controlled Devnet/on-chain validation using the exact program binary and web build intended for release;
3. legal review of the platform's launch, trading, fee, promotion, sanctions, and jurisdictional model; and
4. final verification that public-facing copy matches the deployed program and website behavior.
