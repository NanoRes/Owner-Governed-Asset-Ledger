# OGAL Auditability, Events, and Access Boundaries

## Source status

This document describes program source at commit `83b3436be62d5e187e1c87bf448a80b29c5a7d1e`, tree `f14290d84896985da72abc697baf153255b782ab`. It is supporting documentation; it is not chain evidence, an accepted read contract, or a complete audit claim.

## Implemented events

OGAL emits exactly three Anchor event types:

| Event | Fields | Source action |
| --- | --- | --- |
| `ObjectMinted` | config, manifest, mint, recipient, object ID | emitted after successful mint processing |
| `ManifestUpdated` | config, manifest, mint, object ID, active flag | emitted after manifest state and Metaplex URI update |
| `PauseStatusUpdated` | config, paused flag | emitted after the config pause flag changes |

The source emits no OGAL event for initialization, registry authority transfer, collection update-authority rotation, or namespace migration. The three events therefore do not provide a complete governance or lifecycle timeline.

## Account reconciliation

Events should be treated as observations that can be reconciled with accounts, not as a complete or automatically final ledger view.

- `Config` exposes authority, PDA bumps, object count, namespace, and pause state.
- `Auth` binds the mint-authority PDA to a config.
- `ObjectManifest` exposes config, object ID, mint, PDA bumps, active/minted/initialized flags, manifest hash, metadata URI, and creator.

The source does not define finality thresholds, replay handling, reorganization handling, deduplication, pagination, freshness budgets, snapshot procedures, or event-to-account reconciliation rules. Those behaviors belong in a separately accepted read contract for each indexer, dashboard, auditor, or application.

## Mutability and update access

`update_object_manifest` requires an owner signer and a supplied token account that:

- belongs to that signer;
- matches the object mint; and
- holds a positive token balance.

The instruction can then change the manifest hash, metadata URI, and active flag, and it updates the Metaplex metadata URI through the auth PDA.

This is possession-based update authority. It is not proof of copyright, a license, commercial-use permission, application entitlement, gameplay possession, custody, settlement, equity, or guaranteed revenue. OGAL defines no rights registry, dispute process, recovery policy, or legal ownership model.

## Mint access ambiguity

The `mint_object_nft` account named `authority` must equal the stored config authority, but it is an unchecked non-signer. The payer signs. As a result, the implemented source does not require the stored namespace authority to approve each mint with a signature.

Whether permissionless payer-funded minting is intended or a control is missing remains an unresolved Human product and security decision. No access policy should be inferred beyond the exact signer and account checks in source.

## Pause scope

The stored authority can set the config pause flag, and minting checks it. The flag does not create a global application stop, revoke token possession, remove public metadata, block manifest updates, or define a legal or commercial suspension.

## External access and tiering

OGAL does not implement subscription tiers, prerequisite-token gating, gameplay access, premium content enforcement, revenue access, or application entitlement. External products may define such policies under their own accepted source and legal terms; those policies are not OGAL protocol behavior.

The URI and hash in a manifest do not guarantee content availability, confidentiality, schema validity, moderation, safety, or application support. Consumers must define those rules separately.

## Audit claim gate

A complete auditability claim requires, at minimum, separately accepted event coverage, account snapshots, finality, replay, reorganization, deduplication, pagination, freshness, reconciliation, deployment parity, and external integration evidence. None is accepted by this source candidate.
