# Owner-Governed Asset Ledger (OGAL)

The Owner-Governed Asset Ledger repository contains a Solana Anchor program and supporting documentation for namespace-scoped object manifests and Metaplex NFTs.

## Current source status

| Field | Value |
| --- | --- |
| Repository | `NanoRes/Owner-Governed-Asset-Ledger` |
| Reviewed branch | `main` |
| Reviewed commit | `83b3436be62d5e187e1c87bf448a80b29c5a7d1e` |
| Reviewed tree | `f14290d84896985da72abc697baf153255b782ab` |
| Repository lifecycle | `UNVERSIONED_SOURCE_SNAPSHOT` |
| Rust component version | `0.1.0` |
| Git tags | none at the reviewed pin |
| GitHub releases | none recorded by the accepted source review |
| Reconciliation lifecycle | `IMPLEMENTATION_CANDIDATE_NOT_ACCEPTED` |

The exact source pin above is the authority for the source description in this repository. It is not evidence of deployed bytecode, current chain state, a live namespace, production use, or an accepted release.

## Implemented program surface

At the reviewed pin, the program implements seven instructions:

1. `initialize`
2. `set_authority`
3. `rotate_collection_authority`
4. `mint_object_nft`
5. `update_object_manifest`
6. `migrate_config_namespace`
7. `set_paused`

The program declares `GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx`; the same value appears in `owner-governed-asset-ledger/Anchor.toml`. This agreement is source configuration only. The exact instruction, account, state, event, and error boundaries are recorded in [OGAL source status](docs/ogal-protocol/ogal-source-status.md).

## Critical boundaries

- The `mint_object_nft` account named `authority` must match the stored config authority, but it is an unchecked account and is not required to sign. The payer is required to sign. Whether this represents intended permissionless payer-funded minting or a missing authority control is an unresolved Human decision.
- An object token holder with a matching positive-balance token account can update the manifest hash, metadata URI, and active flag. Token possession is not copyright, a license, commercial-use permission, application entitlement, gameplay possession, custody, settlement, equity, or guaranteed revenue.
- Creator shares totaling 100 and seller fee basis points no greater than 10,000 are Metaplex metadata constraints. OGAL does not calculate, custody, distribute, reconcile, or guarantee payouts or fair-share execution.
- OGAL does not escrow assets or mediate SPL Token transfers. Transfers occur outside the reviewed program.
- The source emits only `ObjectMinted`, `ManifestUpdated`, and `PauseStatusUpdated`. Authority transfer, collection authority rotation, and namespace migration have no corresponding OGAL events.
- Namespace migration creates new config and auth PDAs and copies selected config fields. Existing manifests remain tied to the old config; continuity, redirect, versioning, deprecation, client negotiation, and rollback rules are not defined.
- No repository license file or accepted public-good service profile exists. Public visibility alone grants neither a license nor a service commitment.

## Evidence and claim separation

Statements about Solana mainnet, a live Token Toss integration, namespace ownership, collection state, authority state, or production readiness are classified as `PUBLIC_CLAIMS_ONLY_UNVERIFIED`. They require separately authorized chain, build, release, integration, and Human acceptance evidence.

Supporting documents and scripts describe intended or available workflows; they do not prove that a deployment, external integration, or public service exists. The repository does not contain an Anchor IDL or Unity source. References to those sources are classified in the [shared source guide](docs/ogal-protocol/ogal-shared-deployment-guide.md).

## Context and governance routing

- Start with [the session routing record](docs/context/llm_session_start_here.md).
- Review the [CPF adoption candidate](docs/context/context_pipeline_framework_adoption.yml).
- Review [OGAL source status](docs/ogal-protocol/ogal-source-status.md) before relying on supporting documentation.
- Track open issues in the [risk register](docs/ogal-protocol/ogal-risk-register.md) and [threat model](docs/ogal-protocol/ogal-threat-model.md).
- Treat the [compression posture](docs/context/project_compression_manifest.yml) as inactive and non-authoritative.

CPF compatibility is a reconciliation candidate; it has not been accepted. Studio Context remains the NanoRes-specific adoption and portfolio-routing overlay. NanoRes identity, gameplay, business, economy, custody, and public policy do not become neutral OGAL requirements.

## Repository contents

- `owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs`: implemented program source at the reviewed pin
- `owner-governed-asset-ledger/`: Anchor workspace, scripts, tests, and vendored build source
- `docs/ogal-protocol/`: supporting protocol documentation
- `docs/ogal-cli/`: supporting script documentation

No candidate document accepts compatibility, security remediation, licensing, a public-good contract, deployment, production use, or a public claim.
