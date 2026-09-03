# Owner-Governed Asset Ledger Program Workspace

This directory contains the Anchor workspace for the Owner-Governed Asset Ledger program. At the reviewed source pin, the workspace includes program source, scripts, tests, lockfiles, and vendored build source. It does not include an Anchor IDL or Unity source.

## Source identity

| Field | Value |
| --- | --- |
| Repository commit | `83b3436be62d5e187e1c87bf448a80b29c5a7d1e` |
| Repository tree | `f14290d84896985da72abc697baf153255b782ab` |
| Rust component version | `0.1.0` |
| Declared program ID | `GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx` |
| Repository lifecycle | `UNVERSIONED_SOURCE_SNAPSHOT` |
| Candidate status | `IMPLEMENTATION_CANDIDATE_NOT_ACCEPTED` |

The declared program ID matches the `[programs.mainnet]` value in `Anchor.toml`. That match does not prove deployment, deployed bytecode, upgrade authority, current chain state, or production use. The program address is not a wallet and cannot provide a normal wallet signature.

## Program source authority

For implemented behavior, use `programs/owner_governed_asset_ledger/src/lib.rs` at the immutable pin. The [source status record](../docs/ogal-protocol/ogal-source-status.md) maps the instruction, account, state, event, and error surfaces.

The source exports:

- `initialize(namespace)`
- `set_authority(new_authority)`
- `rotate_collection_authority(new_update_authority)`
- `mint_object_nft(...)`
- `update_object_manifest(...)`
- `migrate_config_namespace(new_namespace)`
- `set_paused(paused)`

## Authority boundary

`initialize` requires both `authority` and `payer` to sign. The authority must equal the payer or appear in `ALLOWED_DEPLOYERS`. At the reviewed pin, `ALLOWED_DEPLOYERS` contains the declared program address. A program address cannot act as a normal signing wallet; this entry does not establish an effective external deployer.

`set_authority`, `rotate_collection_authority`, `migrate_config_namespace`, and `set_paused` require the stored config authority to sign.

`mint_object_nft` is materially different. Its `authority` account must match the stored config authority, but the account is unchecked and is not a signer. The payer signs and becomes the recorded manifest creator for a newly initialized manifest. The intended mint-admission policy is unresolved; documentation must not represent an authority signature as implemented for this instruction.

`update_object_manifest` requires an owner signer and a token account owned by that signer that matches the object mint and has a positive balance. This possession check authorizes the implemented update only. It does not confer copyright, a license, commercial-use permission, application entitlement, gameplay possession, custody, settlement, equity, or guaranteed revenue.

## Metadata and economic boundary

On a first mint, creator shares must total 100, the creator list must include the recorded manifest creator, and creators marked verified must sign. Seller fee basis points cannot exceed 10,000. These checks populate and constrain Metaplex metadata; they do not calculate, custody, distribute, reconcile, or guarantee a payout or fair-share outcome.

## Workspace inventory

- `programs/owner_governed_asset_ledger/src/lib.rs`: reviewed program source
- `programs/owner_governed_asset_ledger/Cargo.toml`: Rust component version and dependencies
- `Anchor.toml`: local Anchor configuration and declared program value
- `scripts/`: Node.js helpers whose source is present
- `tests/`: source tests whose execution status is not established by this candidate
- `vendor/`: vendored build source

The repository has no tracked `idl/owner_governed_asset_ledger.json`. Any IDL must be generated or fetched only in a separately authorized workflow; no IDL is part of this source candidate.

## Scripts and external integrations

The local scripts describe client transactions and account derivation. Their presence does not prove successful execution, deployment, production readiness, or parity with deployed bytecode. No dependencies were installed and no scripts, builds, or tests were run for the source reconciliation.

Paths beginning with `Assets/` that appear in historical documentation refer to external Unity product or tooling source; they are absent from this repository. Their exact owning repository and immutable pin are unverified here. No external integration source is authoritative for the reviewed OGAL program.

## Deployment and operational gates

No wallet path, keypair, RPC endpoint, chain account, or deployment procedure is accepted by this document. Before any later deployment or operational task, a Human must separately authorize source review, security review, build evidence, IDL handling, wallet and provider access, deployment verification, rollback planning, and public claims.

## Documentation

- [Session start](../docs/context/llm_session_start_here.md)
- [Shared source guide](../docs/ogal-protocol/ogal-shared-deployment-guide.md)
- [Auditability and access](../docs/ogal-protocol/ogal-auditability-and-access.md)
- [Collection authority rotation](../docs/ogal-protocol/collection-authority-rotation.md)
- [Namespace migration](../docs/ogal-protocol/ogal-namespace-migration.md)
- [Risk register](../docs/ogal-protocol/ogal-risk-register.md)
- [Threat model](../docs/ogal-protocol/ogal-threat-model.md)
