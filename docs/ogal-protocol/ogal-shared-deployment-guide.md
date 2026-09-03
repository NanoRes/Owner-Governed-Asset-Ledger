# OGAL Shared Source and Deployment-Claim Guide

## Purpose and authority

This guide explains the program surface found in `NanoRes/Owner-Governed-Asset-Ledger` `main` commit `83b3436be62d5e187e1c87bf448a80b29c5a7d1e`, tree `f14290d84896985da72abc697baf153255b782ab`.

The program source at that pin is authoritative for implemented behavior. This guide is supporting documentation. It is not proof of a shared deployment, mainnet state, deployed-bytecode parity, production readiness, a live integration, a license, or a public-good service.

## Source snapshot

| Field | Value |
| --- | --- |
| Lifecycle | `UNVERSIONED_SOURCE_SNAPSHOT` |
| Rust component version | `0.1.0` |
| Declared program ID | `GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx` |
| Git tags | none at the reviewed pin |
| GitHub releases | none recorded by the accepted source review |
| Candidate status | `IMPLEMENTATION_CANDIDATE_NOT_ACCEPTED` |

The declared ID matches `owner-governed-asset-ledger/Anchor.toml`; that match is source configuration only.

## Account model

### Config PDA

- Seeds: `['config', namespace]`
- Stores: authority, config bump, auth bump, object count, namespace, and pause flag

### Auth PDA

- Seeds: `['auth', config]`
- Stores: config public key and bump
- Signs the implemented token and Metaplex CPIs through program-derived seeds

### Object manifest PDA

- Seeds: `['object_manifest', config, object_id_le_bytes]`
- Stores: config, object ID, mint, bumps, active/minted/initialized flags, manifest hash, metadata URI, and creator
- Mutable through implemented behavior: manifest hash, metadata URI, active flag, and mint lifecycle flags

### Object mint PDA

- Seeds: `['object_mint', manifest]`
- Created as a zero-decimal SPL Token mint with the auth PDA as mint and freeze authority

The manifest PDA and its recorded mint form the protocol's source-level identity pair. This technical identity is not a legal ownership or rights record.

## Instruction catalogue

| Instruction | Implemented source boundary |
| --- | --- |
| `initialize(namespace)` | Authority signer and payer signer create config and auth PDAs; authority must equal payer or match `ALLOWED_DEPLOYERS` |
| `set_authority(new_authority)` | Current stored authority signer replaces the config authority; no successor acceptance or event |
| `rotate_collection_authority(new_update_authority)` | Current stored authority signer causes the auth PDA to sign a Metaplex metadata update; no OGAL event |
| `mint_object_nft(...)` | Payer signer creates or validates accounts, mints one unit, and performs first-mint Metaplex work; the stored authority account is not a signer |
| `update_object_manifest(...)` | Positive-balance token holder signer updates manifest hash, URI, and active flag, plus Metaplex URI |
| `migrate_config_namespace(new_namespace)` | Current authority signer creates new config and auth PDAs and copies selected config fields; existing manifests are not moved |
| `set_paused(paused)` | Current authority signer replaces the config pause flag; mint checks the flag |

See [OGAL source status](ogal-source-status.md) for exact account contexts, state fields, events, and errors.

## Mint-admission boundary

The `mint_object_nft` context checks that the account named `authority` equals the stored config authority, but the account is an unchecked non-signer. The payer is the signer and becomes the stored creator for a newly initialized manifest.

The source therefore does not establish whether permissionless payer-funded minting is intended or whether a stored-authority signature is missing. That decision remains a Human product and security gate. Client documentation must not claim that the stored authority signs mint admission.

## First-mint metadata checks

On the first mint, source checks include:

- metadata name and symbol limits;
- at least one creator and no more than the Metaplex creator limit;
- creator shares totaling 100;
- inclusion of the stored manifest creator;
- signatures from creators marked verified;
- seller fee basis points no greater than 10,000;
- expected metadata, master-edition, collection metadata, and collection master-edition addresses;
- the expected Metaplex token metadata program;
- sized or unsized collection verification.

These are account, CPI, and metadata constraints. They are not payout, fair-share, accounting, tax, refund, dispute, custody, or settlement execution.

The function invokes `mint_to` for one unit on every call that reaches that step. Metadata and master-edition creation occur only when the manifest was not previously marked minted. A later invocation's outcome depends on current account and authority state; no runtime test was authorized for this reconciliation.

## Transfers, possession, and rights

SPL Token transfers occur outside OGAL. The program does not escrow assets or mediate custody.

`update_object_manifest` checks that the signer owns the supplied token account, the account matches the object mint, and the account has a positive balance. Passing those checks authorizes only the implemented manifest and metadata URI update. Token possession is not copyright, a license, commercial-use permission, application entitlement, gameplay possession, custody, settlement, equity, or guaranteed revenue.

## Events and read posture

The program emits only:

- `ObjectMinted` after successful mint processing;
- `ManifestUpdated` after a manifest and metadata URI update;
- `PauseStatusUpdated` after a pause change.

Initialization, authority transfer, collection authority rotation, and namespace migration emit no OGAL events. A consumer cannot derive a complete governance timeline from the three events alone.

Finality, replay, reorganization, deduplication, pagination, freshness, and account-event reconciliation semantics are not defined. Any indexer, dashboard, or application needs a separately accepted read contract.

## Namespace migration limit

`migrate_config_namespace` copies authority, object count, and pause state into a new config, records new bump values and namespace, and initializes a new auth account. It does not rewrite existing manifests, mints, metadata, token accounts, or historical events.

The source defines no cross-namespace continuity, redirect, discovery, deprecation, rollback, or client-version negotiation contract. A pause, rotate, migrate, update-client, and resume sequence is at most an operational proposal; it is not an accepted migration standard.

## Local and external source map

| Reference | Classification |
| --- | --- |
| `owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs` | Present and source-authoritative at the immutable pin |
| `owner-governed-asset-ledger/scripts/*.js` | Present supporting client source; execution and deployment parity unverified |
| `owner-governed-asset-ledger/idl/owner_governed_asset_ledger.json` | Absent; no tracked Anchor IDL exists at the reviewed pin |
| Historical `solana/owner-governed-asset-ledger/...` paths | Incorrect for this repository; use `owner-governed-asset-ledger/...` |
| `Assets/Solana_Toolbelt/...` | External Unity tooling or product source; absent here, owner and immutable pin unverified in this repository |
| Token Toss scene or runtime paths | External product source; absent here, owner and immutable pin unverified in this repository |

An IDL generated in a later workflow would be generated output. It cannot become authoritative or accepted without a separately authorized generation, parity check, and Human gate.

## Local script inventory

The reviewed tree includes source helpers for initialization, collection inspection, collection authority rotation, minting, manifest update, authority transfer, pause changes, and namespace migration. Their presence shows only that source files exist. This candidate does not establish that dependencies install, commands run, transactions succeed, or a deployed program matches them.

Any use of a script, wallet, keypair, RPC endpoint, provider, or chain requires a separate authorized operational task. No real workstation paths, credentials, endpoints, or production constants are prescribed here.

## Deployment and public-claim posture

The source configuration contains a mainnet cluster name and the declared program ID. Historical documents carry a mainnet deployment claim plus Token Toss, namespace, collection, authority, and production statements. No chain query, bytecode comparison, upgrade-authority check, account inspection, transaction review, production build provenance, or current integration verification was authorized for this candidate.

All such statements remain `PUBLIC_CLAIMS_ONLY_UNVERIFIED`. The [namespace directory](namespace-directory.md) preserves the carried values only as a claim inventory.

## Licensing and public-good posture

The repository has no license file and no accepted public-good service profile. Public visibility does not grant reuse rights or promise access, fees, availability, support, upgrades, admission, anti-capture protections, portability, or exit guarantees.

## CPF and Studio separation

CPF package `0.7.0-rc.1`, compatibility `0.7.x-enterprise-assurance`, is an unreleased release candidate at its accepted governance pin. OGAL's declaration is `CANDIDATE_NOT_ACCEPTED`.

Studio Context remains the NanoRes-specific adoption overlay and portfolio router. Its identity, gameplay, business, economy, custody, and public policies are not neutral OGAL requirements.

## Required later gates

- Human decision on mint admission
- Independent security review and any separately authorized remediation
- Human licensing and public-good service decisions
- Accepted IDL and external integration provenance if needed
- Human-authorized build, deployment, chain, and release evidence
- Human acceptance of namespace, collection, authority, Token Toss, and production claims
- Human acceptance of migration and read contracts

This guide grants none of those authorities.
