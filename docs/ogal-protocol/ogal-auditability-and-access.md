# OGAL Auditability, Events, and Access Controls

## Streaming On-Chain Events for Monitoring

OGAL emits structured Anchor events every time an object NFT is minted and whenever a manifest is edited. The `ObjectMinted` event surfaces the config, manifest, mint, recipient, and object identifier for the mint, while `ManifestUpdated` reports the config, manifest, mint, object identifier, and the manifest's active status after a change. Both events are emitted inside the program via Anchor's `emit!` macro, which causes Solana runtime logs to include base64-encoded event data that conforms to Anchor's standard layout. Investors or studios can subscribe to these logs by using the `logsSubscribe` or `programSubscribe` WebSocket RPC methods (or an Anchor client listener), decode the event payloads with the generated IDL, and feed them into monitoring dashboards or compliance automation workflows.

To prove provenance for audit purposes, OGAL also emits `PauseStatusUpdated` when the registry authority toggles the global pause flag. These three events together give downstream services a complete timeline of mint activity, manifest revisions, and lifecycle controls without requiring trusted off-chain reports.

## Auditability and Governance Hooks

OGAL's configuration accounts act as a namespace-scoped source of truth. The `Config` account records the authority, bump seeds, the running object count, the namespace public key, and whether minting is paused. Each manifest stores the config it belongs to, so investors can traverse a namespace and confirm that every monetized object references the same configuration authority. Studios can rotate namespaces via `migrate_config_namespace`, which clones the existing configuration into a new PDA while preserving authority continuity and historical audit trails. Because every manifest and event references the config PDA, investors gain deterministic lineage from namespace to manifest to mint, satisfying transparency requirements without manual reconciliation.

Governance hooks complement the audit data. The `set_paused` instruction lets the configuration authority halt minting and emits an explicit `PauseStatusUpdated` event so compliance teams know when commercialization is suspended or resumed. Collection authorities can also be rotated between the mint PDA and a maintenance wallet without redeploying the program, preserving brand control while allowing day-to-day operations.

## Mutability and Update Control

Manifest accounts track both provenance and availability. A manifest stores the immutable `object_id`, `config`, and `mint` references alongside mutable fields such as the metadata URI, manifest hash, and an `is_active` flag. Updates are authorized exclusively through `update_object_manifest`, which requires the signer to prove NFT ownership by presenting a token account that belongs to them, holds the correct mint, and contains at least one token before any changes are applied. Once those ownership checks pass, OGAL updates the `manifest_hash`, metadata URI, and `is_active` status in place and emits `ManifestUpdated`, preserving the same manifest PDA and `object_id` for downstream provenance tracking.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L749-L898】

## Why Tiered Access Still Matters

External gating (such as subscription passes or ownership of another NFT) cannot prevent someone from reading metadata once an asset exists on-chain, but OGAL's access controls shape how and when valuable experiences are delivered:

* **Mint gating:** Studios can require prerequisite tokens or passes before minting the object NFT. Until the mint instruction succeeds, the asset does not exist, so off-chain data loaders have nothing to scrape.
* **Runtime enforcement:** Games and services integrate OGAL manifests to decide whether to honor a request (e.g., loading a level or applying a cosmetic). Even if a user reconstructs metadata from the blockchain, the game can refuse to load the content without verifying the appropriate tier, keeping premium experiences exclusive.
* **Dynamic manifests:** Because manifests can be updated by the rights holder, studios can rotate metadata URIs or deactivate objects when prerequisites change. Combined with the `is_active` flag, this lets them revoke unauthorized access signals and ensures unauthorized use is short-lived.

Together, these controls ensure that tiered access schemes remain commercially meaningful: the on-chain data is transparent, but the ability to participate in gameplay loops or revenue-generating experiences still depends on satisfying the programmable policies encoded in OGAL.
