# Owner-Governed Asset Ledger (OGAL) Shared Program Guide

## Purpose and Audience
This guide explains how external Solana and Unity development teams can onboard to a shared deployment of the Owner-Governed Asset Ledger (OGAL) program without redeploying it themselves. It covers every on-chain feature exposed by the program, demonstrates how to drive those capabilities from the provided Node.js command-line helpers and Unity tooling, and highlights the pieces that still need to be implemented so teams can plan their integrations accordingly.

The document is intentionally network-agnostic—substitute your studio's program ID, namespace, and PDA addresses wherever placeholders appear. Treat it as the canonical reference for collaborating across multiple teams on a single OGAL deployment.

## Program Concepts
### Namespaces and Derived Accounts
OGAL scopes all registry state to a **namespace** (an arbitrary public key chosen by the authority). During initialization the program derives two program-derived accounts (PDAs) using deterministic seeds:

- **Config PDA** – derived from `seed = b"config"` and the namespace, stores the registry authority, namespace, pause status, object counter, and bump seeds.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L35-L61】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1060-L1087】
- **Mint-authority PDA** – derived from `seed = b"auth"` and the config PDA, signs collection-level CPIs on behalf of the registry.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L35-L61】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1089-L1104】

Individual assets mint under **object manifests** (PDAs derived from the config, the string `"object_manifest"`, and a numeric object identifier) and **object mints** (derived from the config, `"object_mint"`, and the same object identifier). These manifests cache the creator, metadata URI, manifest hash, and flags recording whether the asset is initialized, active, and minted.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L37-L60】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1116-L1179】

### Transfers and Custody
Ownership transfers happen via standard SPL Token transfers outside OGAL. OGAL does not escrow or mediate custody; it simply observes ownership at the moment a holder requests a manifest update. The `update_object_manifest` instruction enforces this by checking that the supplied token account belongs to the signer, matches the expected mint, and holds a positive balance before allowing metadata changes.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L749-L804】

### Canonical Asset Identity
OGAL treats the **ObjectManifest PDA** and its paired **object mint** as the canonical asset identity. The manifest PDA is the registry’s source of truth for a given object ID, while the object mint is the NFT representation derived from that same identifier. Together they anchor provenance and keep the asset identity stable even as metadata evolves.

The `ObjectManifest` account stores the key fields clients should use to confirm identity and integrity: `object_id`, `config`, `mint`, `manifest_hash`, `metadata_uri`, `creator`, and `is_active`. Consumers should treat the manifest PDA address plus the recorded `mint` as the canonical handle for the asset, and validate that updates only mutate the hash/URI/activation state without changing the object’s identity.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1116-L1179】

### Instruction Catalogue
OGAL exposes the following instructions:

| Instruction | Summary |
| --- | --- |
| `initialize(namespace)` | Creates the namespace's config and mint-authority PDAs after verifying the signer is the payer or appears in `ALLOWED_DEPLOYERS`.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L35-L99】 |
| `set_authority(newAuthority)` | Updates the config account's authority, enabling governance transfers without migrations.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L97-L101】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1106-L1114】 |
| `rotate_collection_authority(newUpdateAuthority)` | Uses the mint-authority PDA to sign a Metaplex CPI that rotates the collection NFT's update authority, handling both canonical and legacy discriminators.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L104-L153】 |
| `mint_object_nft` | Derives or creates the manifest, mint, associated token account, and Metaplex metadata before minting a verified 1/1 NFT into the recipient account.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L155-L620】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L779-L884】 |
| `update_object_manifest` | Lets the NFT holder refresh the manifest hash, metadata URI, and activation flag once they prove ownership of the mint.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L621-L704】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1032-L1047】 |
| `migrate_config_namespace` | Copies configuration state to a new namespace and fresh PDAs for rollover events.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L705-L731】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1049-L1079】 |
| `set_paused(paused)` | Toggles a registry-wide pause flag and emits an event so clients know minting is frozen.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L732-L741】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1210-L1228】 |

### Events and Observability
Every instruction emits explicit Anchor events you can subscribe to via RPC websockets:

- `ObjectMinted` on successful mints.
- `ManifestUpdated` whenever metadata is refreshed.
- `PauseStatusUpdated` when the pause flag changes.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1198-L1234】

Capture these events to audit namespace activity or trigger automation.

## Pre-flight Checklist
1. **Confirm Access Control** – Update the `ALLOWED_DEPLOYERS` array in `programs/.../src/lib.rs` so any sponsoring wallets are permitted to initialize namespaces when the authority and payer differ.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L37-L44】
2. **Collect Registry Inputs** – Record the deployed program ID, the namespace public key you intend to claim, the fee-payer/authority keypairs, and the target collection mint.
3. **Install Tooling** – Ensure the Solana CLI, Node.js (for the scripts in `solana/owner-governed-asset-ledger/scripts`), and Unity 2021+ (for the provided components) are available.
4. **Fetch the IDL** – OGAL ships its Anchor IDL at `solana/owner-governed-asset-ledger/idl/owner_governed_asset_ledger.json`. Use it for custom clients or when implementing missing automation.
5. **Choose an RPC Endpoint** – The helpers default to public mainnet RPC URLs; replace them with your cluster of choice before running transactions.

## Command-line Implementation Path
The `solana/owner-governed-asset-ledger` package bundles Node.js utilities for the most common administrative tasks. Install dependencies once:

```bash
npm --prefix solana/owner-governed-asset-ledger install
```

> **Important:** Each script hardcodes `<PROGRAM_ID>` inside the source file. Update those constants to match the shared deployment before running the commands.【F:solana/owner-governed-asset-ledger/scripts/initialize.js†L18-L19】【F:solana/owner-governed-asset-ledger/scripts/inspect-collection.js†L38-L42】【F:solana/owner-governed-asset-ledger/scripts/rotate-collection-authority.js†L19-L20】

### 1. Initialize a Namespace
1. Generate or select the namespace keypair (store the secret offline) and obtain the public key with `solana-keygen pubkey`.
2. Confirm the signing wallet is funded and, if different from the payer, appears in `ALLOWED_DEPLOYERS`.
3. Run the helper:
   ```bash
   npm --prefix solana/owner-governed-asset-ledger run initialize \
     -- --namespace <NAMESPACE_PUBKEY> \
     --authority-keypair /path/to/authority.json \
     --payer-keypair /path/to/payer.json \
     --rpc-url <RPC_ENDPOINT>
   ```
   The script derives the config and mint-authority PDAs, builds the Anchor discriminator payload, submits the transaction, and prints the namespace, PDAs, signature, and last valid block height.【F:solana/owner-governed-asset-ledger/scripts/initialize.js†L47-L110】【F:solana/owner-governed-asset-ledger/scripts/initialize.js†L126-L163】
4. Archive the resulting PDAs—every subsequent instruction expects them.

### 2. Inspect Collection Status
Use `inspect-collection` to confirm the collection NFT points at the namespace PDA and to review metadata sizing:

```bash
npm --prefix solana/owner-governed-asset-ledger run inspect-collection \
  -- --mint <COLLECTION_MINT> \
  --namespace <NAMESPACE_PUBKEY> \
  --rpc-url <RPC_ENDPOINT>
```

The tool derives config, mint-authority, metadata, and master edition PDAs, fetches the Metaplex account, normalizes option fields, and reports whether the update authority matches the derived namespace authority.【F:solana/owner-governed-asset-ledger/scripts/inspect-collection.js†L44-L206】【F:solana/owner-governed-asset-ledger/scripts/inspect-collection.js†L249-L296】 Use it during onboarding and whenever mint guard rails trigger.

### 3. Rotate the Collection Update Authority
When maintenance wallets need temporary control of the collection NFT, run:

```bash
npm --prefix solana/owner-governed-asset-ledger run rotate-collection-authority \
  -- --namespace <NAMESPACE_PUBKEY> \
  --collection-mint <COLLECTION_MINT> \
  --new-update-authority <NEW_AUTHORITY_OR_KEYPAIR_PATH> \
  --authority-keypair /path/to/config-authority.json \
  --rpc-url <RPC_ENDPOINT>
```

The script derives the config and mint-authority PDAs, builds the instruction data, and automatically retries with the legacy discriminator if the cluster still runs an older Anchor build.【F:solana/owner-governed-asset-ledger/scripts/rotate-collection-authority.js†L56-L205】 It logs the transaction signature once confirmed.

### 4. Mint Object NFTs
Use `mint-object` to derive every PDA, assemble the Metaplex metadata, and submit `mint_object_nft` in a single transaction:

```bash
npm --prefix solana/owner-governed-asset-ledger run mint-object \
  -- --namespace <NAMESPACE_PUBKEY> \
  --object-id <NUMERIC_ID> \
  --manifest-uri <ARWEAVE_OR_IPFS_URI> \
  --manifest-hash <32_BYTE_HEX> \
  --metadata-name "<DISPLAY_NAME>" \
  --seller-fee-bps <ROYALTY_BPS> \
  --recipient <RECIPIENT_PUBKEY> \
  --collection-mint <COLLECTION_MINT> \
  --payer-keypair /path/to/mint-author.json \
  --creator <ADDRESS:SHARE:VERIFIED[:KEYPAIR_PATH]> ... \
  --rpc-url <RPC_ENDPOINT>
```

Important behaviours:

- Supply at least one creator via `--creator` (repeatable) or `--creators-json`; the helper enforces that shares sum to 100 and that verified creators load matching keypairs.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L183-L224】【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L424-L452】
- The script validates metadata sizing, parses the manifest hash, and enforces the program limits on name, symbol, URI, and creator count before building the instruction payload.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L240-L360】
- PDAs for the config, mint authority, manifest, mint, metadata, master edition, and recipient ATA are derived automatically, with optional `--config-bump`, `--auth-bump`, `--manifest-bump`, and `--mint-bump` guards if you want to pre-compute expectations.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L370-L404】
- The helper fetches the config account to prove the namespace exists and that any provided `--authority` matches the stored authority before proceeding.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L405-L423】
- Pass `--include-instructions-sysvar` for sized collections; the helper adds the sysvar and merges any verified creator signers alongside the payer before submitting the transaction and logging the signature.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L494-L540】

### 5. Update Object Manifests
Content teams can refresh manifests with `update-manifest`:

```bash
npm --prefix solana/owner-governed-asset-ledger run update-manifest \
  -- --namespace <NAMESPACE_PUBKEY> \
  --object-id <NUMERIC_ID> \
  --object-mint <OBJECT_MINT> \
  --owner-keypair /path/to/nft-owner.json \
  --manifest-hash <32_BYTE_HEX> \
  --metadata-uri <NEW_URI> \
  --is-active <true|false> \
  --rpc-url <RPC_ENDPOINT>
```

The script derives the manifest and mint PDAs from the namespace, ensures the provided mint matches the derivation, and defaults the owner token account to the ATA when `--owner-token-account` is omitted.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L95-L161】【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L200-L216】 It also validates URI length, parses the manifest hash, and accepts optional bump checks for config, manifest, and mint PDAs before signing and submitting the transaction.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L40-L139】【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L146-L189】

### 6. Transfer Registry Authority
Rotate governance without custom tooling by running `set-authority`:

```bash
npm --prefix solana/owner-governed-asset-ledger run set-authority \
  -- --namespace <NAMESPACE_PUBKEY> \
  --new-authority <NEW_AUTHORITY_PUBKEY> \
  --authority-keypair /path/to/current-authority.json \
  --rpc-url <RPC_ENDPOINT>
```

The helper re-derives the config (and mint-authority) PDAs for the namespace, builds the `set_authority` payload, and confirms the transaction while logging the signature and last valid block height.【F:solana/owner-governed-asset-ledger/scripts/set-authority.js†L25-L109】 Use it during handoffs and archive the resulting signature in governance runbooks.【F:solana/owner-governed-asset-ledger/scripts/set-authority.js†L95-L109】

### 7. Pause and Resume Minting
Emergency stops are now one command away with `set-paused`:

```bash
npm --prefix solana/owner-governed-asset-ledger run set-paused \
  -- --namespace <NAMESPACE_PUBKEY> \
  --paused \
  --authority-keypair /path/to/config-authority.json \
  --rpc-url <RPC_ENDPOINT>
```

Pass `--paused` (or `--no-paused`) to toggle the registry flag. The script verifies the config PDA, constructs the payload, and reports the pause status change once the transaction confirms; on failures it surfaces simulation logs for quick triage.【F:solana/owner-governed-asset-ledger/scripts/set-paused.js†L25-L111】 Remember that every change still emits `PauseStatusUpdated`, so keep observers listening for downtime alerts.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L732-L741】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1210-L1228】

### 8. Migrate to a Fresh Namespace
`migrate-namespace` copies configuration state to a replacement namespace, initializing new PDAs along the way:

```bash
npm --prefix solana/owner-governed-asset-ledger run migrate-namespace \
  -- --old-namespace <CURRENT_NAMESPACE> \
  --new-namespace <TARGET_NAMESPACE> \
  --authority-keypair /path/to/config-authority.json \
  --rpc-url <RPC_ENDPOINT>
```

The helper derives both sets of config and mint-authority PDAs, ensures you are not migrating to the same namespace, and signs the transaction with the authority wallet before logging the resulting signature.【F:solana/owner-governed-asset-ledger/scripts/migrate-namespace.js†L26-L114】 Use it in tandem with the governance playbook—pause minting, rotate collection authority, migrate, update clients, then resume—to avoid inconsistencies.【F:solana/owner-governed-asset-ledger/scripts/migrate-namespace.js†L60-L123】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L705-L741】

### 9. Monitoring and Troubleshooting
- Subscribe to the `ObjectMinted`, `ManifestUpdated`, and `PauseStatusUpdated` events via your RPC provider for alerting and analytics.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1198-L1234】
- Use `solana transaction simulate` with the serialized payloads printed by your clients (Unity logs include a base64 copy) to inspect CPI errors before resubmitting.【F:Assets/Solana_Toolbelt/Services/Owner_Governed_Asset_Ledger_Service/OwnerGovernedAssetLedgerService.cs†L805-L812】

## Unity Implementation Path
The Unity project ships production-ready components in `Assets/Solana_Toolbelt` that wrap OGAL interactions. Configure them with your own keys before running.

### 1. Configure the Solana Toolbelt
Open `Assets/Solana_Toolbelt/_Data/Solana_Configuration.asset` and populate the OGAL section with your program ID, namespace, config PDA, and mint-authority PDA. Leaving the PDA fields empty forces the runtime to derive them, but recording the confirmed values avoids accidental namespace drift.【F:Assets/Solana_Toolbelt/_Data/_Scripts/SolanaConfiguration.cs†L162-L686】

### 2. Initialize a Namespace from Unity
Attach `InitializeNamespaceTransactionSender` to a bootstrap scene, supply your RPC URL, deployer wallet (via inspector or the `DEPLOYER_PRIVATE_KEY` environment variable), program ID, namespace, and optional expected PDAs. Press Play to submit the transaction; the console logs the signature on success.【F:Assets/Solana_Toolbelt/Program_Instructions/InitializeNamespaceTransactionSender.cs†L16-L193】 Update the serialized defaults before distributing the scene to partners so it references your shared deployment.

### 3. Rotate the Collection Authority from Unity
`SetCollectionUpdateAuthorityTransactionSender` performs the same rotation as the CLI helper. Configure the component with your namespace, collection mint, expected PDAs, and target authority, then invoke `SendTransactionAsync()` or toggle `sendOnStart` to run it automatically.【F:Assets/Solana_Toolbelt/Program_Instructions/SetCollectionUpdateAuthorityTransactionSender.cs†L16-L211】 The script automatically falls back to the legacy discriminator when needed and logs descriptive warnings.

### 4. Mint Object NFTs at Runtime
`OwnerGovernedAssetLedgerService` exposes `MintObjectNftAsync` for runtime minting flows. It resolves the config, derives the manifest and mint PDAs, enforces collection guardrails, builds the transaction, and emits detailed debug output (including a serialized transaction) on failure.【F:Assets/Solana_Toolbelt/Services/Owner_Governed_Asset_Ledger_Service/OwnerGovernedAssetLedgerService.cs†L22-L807】 Compose a `OwnerGovernedAssetLedgerMintRequest` via `LevelEditorMintService` or your own factory and pass it to the service to mint on behalf of the logged-in creator.【F:Assets/Solana_Toolbelt/Services/Owner_Governed_Asset_Ledger_Service/OwnerGovernedAssetLedgerModels.cs†L46-L200】【F:Assets/Solana_Toolbelt/Services/Level_Editor_Mint_Service/LevelEditorMintService.cs†L78-L120】

### 5. Update Manifests from Unity
The same service implements `UpdateManifestAsync`, which verifies the caller still holds the NFT, checks the manifest belongs to the namespace, and submits the update instruction. Unity UI flows (such as `LevelMintPopup`) already call into this path for content updates.【F:Assets/Solana_Toolbelt/Services/Owner_Governed_Asset_Ledger_Service/OwnerGovernedAssetLedgerService.cs†L250-L347】【F:Assets/__Scenes/Token_Toss_Game/UI/Managers/Popups_Manager/Popups/LevelMintPopup.cs†L407-L474】

### 6. Error Handling and Telemetry
`OwnerGovernedAssetLedgerService` standardizes user-friendly error messages for Anchor error codes (for example, `MintingPaused` or collection authority mismatches) and logs reproduction commands for engineers. Surface these messages in your UI and include the serialized transactions in support tickets for quick diagnosis.【F:Assets/Solana_Toolbelt/Services/Owner_Governed_Asset_Ledger_Service/OwnerGovernedAssetLedgerService.cs†L113-L812】【F:Assets/Solana_Toolbelt/Services/Owner_Governed_Asset_Ledger_Service/OwnerGovernedAssetLedgerService.cs†L969-L983】

### 7. Govern Registries from Unity
Producers can now execute governance flows without dropping to the CLI:

- **Transfer authority** – Attach `SetRegistryAuthorityTransactionSender` to a utility scene, populate the RPC endpoint, authority wallet (inspector or `DEPLOYER_PRIVATE_KEY`), program ID, namespace, and either a derived config PDA or an explicit override. Provide the expected config PDA for an extra safety check and set `newAuthorityPublicKey` when the successor should differ from the signing wallet.【F:Assets/Solana_Toolbelt/Program_Instructions/SetRegistryAuthorityTransactionSender.cs†L26-L215】
- **Toggle the pause flag** – `SetRegistryPauseTransactionSender` mirrors the CLI helper. Configure the same Solana settings, supply namespace/config hints, and flip the `paused` boolean before pressing Play (or enable `sendOnStart` to run automatically).【F:Assets/Solana_Toolbelt/Program_Instructions/SetRegistryPauseTransactionSender.cs†L26-L115】
- **Migrate namespaces** – `MigrateNamespaceTransactionSender` derives the old/new config and mint-authority PDAs, validates optional expectations, and signs the migration with the authority wallet. Set the current and target namespace keys and decide whether to run on scene load with `sendOnStart`.【F:Assets/Solana_Toolbelt/Program_Instructions/MigrateNamespaceTransactionSender.cs†L20-L121】

All three components share the same RPC and key handling patterns as the initialize/rotate senders, including environment-variable fallbacks and helpful inspector tooltips for teams adopting the shared deployment.【F:Assets/Solana_Toolbelt/Program_Instructions/SetRegistryAuthorityTransactionSender.cs†L26-L173】【F:Assets/Solana_Toolbelt/Program_Instructions/SetRegistryPauseTransactionSender.cs†L26-L109】【F:Assets/Solana_Toolbelt/Program_Instructions/MigrateNamespaceTransactionSender.cs†L20-L108】

## Governance and Operations Best Practices
- **Key Management** – Store authority and payer keypairs in secure vaults. Scripts accept `--authority-keypair` paths; restrict filesystem access accordingly.【F:solana/owner-governed-asset-ledger/scripts/initialize.js†L55-L84】
- **Collection Guard Rails** – If minting fails with `MintingPaused` or collection authority mismatches, run `inspect-collection` and rotate the authority back to the mint PDA before retrying.【F:solana/owner-governed-asset-ledger/scripts/inspect-collection.js†L249-L296】【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L732-L738】
- **Event Logging** – Persist emitted events alongside off-chain metadata to build comprehensive audit trails for each namespace.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L1198-L1234】
- **Namespace Migration Playbook** – Before calling `migrate_config_namespace`, pause minting, rotate the collection authority to a maintenance wallet, run the migration, update every client with the new PDAs, and finally resume minting and rotate authority back to the mint PDA.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L705-L741】

## Appendix
### PDA Reference
- Config PDA seeds: `["config", namespace]`
- Mint-authority PDA seeds: `["auth", config]`
- Object manifest seeds: `["object_manifest", config, object_id_le_bytes]`
- Object mint seeds: `["object_mint", config, object_id_le_bytes]`

### File Map
- Anchor program source: `solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs`
- Anchor IDL: `solana/owner-governed-asset-ledger/idl/owner_governed_asset_ledger.json`
- CLI scripts: `solana/owner-governed-asset-ledger/scripts/*.js`
- Unity runtime services: `Assets/Solana_Toolbelt/Services/Owner_Governed_Asset_Ledger_Service`
- Unity administrative scenes: `Assets/Solana_Toolbelt/Program_Instructions`

Armed with these references, teams worldwide can collaborate on the shared OGAL deployment, initialize their own namespaces, and leverage every feature the protocol offers while tracking the remaining automation work.
