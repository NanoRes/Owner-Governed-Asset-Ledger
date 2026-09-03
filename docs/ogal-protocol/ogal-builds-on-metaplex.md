# How OGAL Uses Metaplex Source Interfaces

## Scope

This document describes source-level use of Metaplex interfaces at OGAL commit `83b3436be62d5e187e1c87bf448a80b29c5a7d1e`. It does not establish a deployment, marketplace compatibility, production use, gameplay behavior, monetization, or a security review.

## Imported Metaplex operations

The program source imports and invokes Metaplex token metadata interfaces for:

- `CreateMetadataAccountV3`;
- `CreateMasterEditionV3`;
- `VerifySizedCollectionItem`;
- `VerifyCollection` for an unsized collection;
- `UpdateMetadataAccountV2`.

OGAL also uses SPL Token and associated-token interfaces to create or validate a mint and recipient associated token account, then mint a token unit.

## OGAL state layered around metadata

OGAL adds namespace-scoped config and auth PDAs, object manifest PDAs, object mint PDAs, a pause flag, an object counter, a stored manifest hash and URI, and active/minted/initialized flags.

These records are OGAL protocol state. Metaplex metadata and an OGAL manifest have related but distinct roles; neither creates legal rights, application entitlement, custody, or settlement behavior.

## First-mint behavior

For a new manifest, the payer becomes the recorded manifest creator. On the first mint, the program:

1. validates name, symbol, URI, creator, seller fee, account, and program limits;
2. requires creator shares to total 100 and include the recorded manifest creator;
3. requires every creator marked verified to sign;
4. creates Metaplex metadata with the auth PDA as update authority;
5. mints one token unit to the recipient account;
6. creates a master edition with `max_supply = 0`; and
7. verifies either a sized or unsized collection.

The source calls `mint_to` on every invocation that reaches that step; first-mint metadata and master-edition work is conditional on the manifest not already being marked minted. Later-call behavior depends on current account and authority state and was not dynamically tested here.

## Metadata is not economic execution

Creator shares and seller fee basis points are Metaplex metadata constraints. The reviewed source does not calculate, custody, distribute, reconcile, or guarantee royalties, revenue, fair-share payouts, taxes, refunds, disputes, or settlement.

## Authority boundaries

- The auth PDA signs metadata creation, master-edition creation, collection verification, metadata URI updates, and collection update-authority rotation.
- The stored config authority signer is required for collection update-authority rotation.
- The stored config authority is not required to sign `mint_object_nft`; its public key is supplied as an unchecked account that must match config.
- A positive-balance object token holder signer can update the manifest hash, URI, and active flag. That possession check grants only the implemented update ability.

The unresolved mint-admission behavior requires a separate Human decision and independent security review.

## Collection and deployment boundaries

The source verifies expected metadata and master-edition PDA relationships and supports sized and unsized collection verification branches. It does not prove the current authority, size, mint, or namespace state of any collection on a network.

Historical collection addresses and production statements remain `PUBLIC_CLAIMS_ONLY_UNVERIFIED`; see the [namespace directory](namespace-directory.md). Chain queries, deployment parity, tool behavior, and external integrations require separate authorization and evidence.

## Observability limit

OGAL emits `ObjectMinted`, `ManifestUpdated`, and `PauseStatusUpdated`. It emits no event for collection update-authority rotation. Metaplex logs or account changes are external observations and require an accepted read and reconciliation contract before supporting an audit claim.

## External tooling

Local Node.js script source is present under `owner-governed-asset-ledger/scripts/`. Unity source and a tracked Anchor IDL are absent. No tool execution, dependency installation, IDL generation, build, test, wallet use, provider access, or chain verification supports this candidate.
