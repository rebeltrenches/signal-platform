# Bonding-curve release preparation

Mainnet deployment is paused pending owner funding and release approval. Website preview deployment does not deploy this program.

## Verified build

- Source baseline: c037925b36c1e8164b8f5b8ce7e4b131b8906004 (program unchanged from tested PR55 source).
- GitHub Actions run: 36641330929.
- Artifact: signal-bonding-curve-sbf, ID 11065994860, expires 2026-10-06.
- ZIP SHA256: bbffe729ed07e6f7a14248ce81e1b72444a12ef96aecddd7d193823149fbb7e7.
- Binary: signal_bonding_curve.so, 124200 bytes.
- Local-validator integration checks passed; Mainnet deployment and real Phantom trading are not verified.

## Funding estimate

Read-only Mainnet RPC rent quote on 2026-09-29 UTC:

- Program account, 36 bytes: 833120 lamports.
- ProgramData, current binary plus 45-byte metadata: 631814840 lamports.
- ProgramData with double binary capacity plus metadata: 1262750840 lamports.
- Temporary upload buffer, binary plus 37-byte metadata: 631774200 lamports.

Program plus ProgramData deposits: 0.632647960 SOL current capacity or 1.263583960 SOL double capacity. Transaction fees, retries and any temporary funding requirement must be calculated using the selected CLI deployment procedure before requesting approval. These deposits are not a per-token launch fee. Never promise a hard 0.65/1.30 SOL cap without a final deployment calculation.

## Release prerequisites

1. Confirm the owner-controlled fee payer and upgrade authority. Do not request seed phrases or private keys in chat.
2. Establish and durably secure the program keypair; record its public address. No program keypair has been generated in this session.
3. Verify the exact binary hash and fee recipient against approved source. Select capacity and calculate final funding, including buffer handling.
4. Obtain explicit approval for the Mainnet deployment and cost. Do not treat preview approval as permission to spend SOL.
5. Deploy and verify executable account, program bytes, authority and cluster.
6. Set SIGNAL_BONDING_CURVE_PROGRAM_ID for the Vercel preview build and redeploy. Keep main and Cloudflare production unchanged.
7. Verify wallet, compliance and real launch/buy/sell with individually reviewed transactions before claiming launch readiness.

## Preview verification limitation

The connected Vercel app denies authenticated HTTP access to this project's preview. Local handler tests do not prove deployed endpoint responses. Restore project/team authorization to complete deployed geo, screening and RPC checks.
