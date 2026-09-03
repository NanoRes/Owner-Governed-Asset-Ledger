# OGAL Source Status

## Record status

This is a source-reconciliation candidate. It describes the reviewed program source; it is not Human acceptance, security approval, deployment evidence, a release, or a public claim.

| Field | Value |
| --- | --- |
| Repository | `NanoRes/Owner-Governed-Asset-Ledger` |
| Visibility | public |
| Branch | `main` |
| Commit | `83b3436be62d5e187e1c87bf448a80b29c5a7d1e` |
| Tree | `f14290d84896985da72abc697baf153255b782ab` |
| Lifecycle | `UNVERSIONED_SOURCE_SNAPSHOT` |
| Rust component version | `0.1.0` |
| Git tags | none at the reviewed pin |
| GitHub releases | none recorded by the accepted source review |
| Candidate status | `IMPLEMENTATION_CANDIDATE_NOT_ACCEPTED` |

## Source authority

`owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs` is authoritative for implemented behavior at this pin. `owner-governed-asset-ledger/Anchor.toml` and the program `Cargo.toml` are authoritative for source configuration and component version at the same pin. Documentation, scripts, public statements, and external integrations must yield to those sources.

The source declares program ID `GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx`; `Anchor.toml` carries the same value. This is not proof of a deployment or of deployed-bytecode parity.

## Instruction boundary

### `initialize(namespace: Pubkey)`

- Requires `authority` and mutable `payer` signers.
- Initializes config PDA seeds `['config', namespace]` and auth PDA seeds `['auth', config]`.
- Requires the authority to equal the payer or match `ALLOWED_DEPLOYERS`.
- Stores authority, config bump, auth bump, zero object count, namespace, and `paused = false`; stores config and bump in the auth account.
- Emits no OGAL event.
- At this pin, `ALLOWED_DEPLOYERS` contains the declared program address. A program address cannot provide a normal wallet signature; the entry is not an effective signing wallet.

### `set_authority(new_authority: Pubkey)`

- Requires the current stored authority signer and the config PDA.
- Replaces `config.authority` with the supplied public key.
- Defines no successor-acceptance handshake, recovery, multisignature, or timelock rule.
- Emits no OGAL event.

### `rotate_collection_authority(new_update_authority: Pubkey)`

- Requires the current stored authority signer, config PDA, auth PDA, collection metadata, collection mint, and Metaplex token metadata program.
- Verifies the metadata program ID and derives the expected collection metadata PDA.
- Uses auth PDA seeds to invoke Metaplex `UpdateMetadataAccountV2` and set a new update authority.
- Emits no OGAL event.

### `mint_object_nft(object_id, manifest_uri, manifest_hash, metadata_name, metadata_symbol, seller_fee_basis_points, creators)`

- Requires a payer signer. The account named `authority` is an `UncheckedAccount`; it must equal `config.authority` through `has_one`, but it is not required to sign.
- Requires config and auth PDAs, object manifest, object mint, recipient token account, recipient, token program, associated token program, system program, metadata, master edition, collection mint, token metadata program, collection metadata, collection master edition, rent sysvar, an optional instructions sysvar, and any verified creator signer accounts.
- Rejects minting while the config is paused.
- Derives the object manifest from `['object_manifest', config, object_id_le_bytes]` and the object mint from `['object_mint', manifest]`.
- Creates or validates the manifest, mint, and recipient associated token account.
- On a new manifest, stores the payer as creator, stores the hash and URI, marks the manifest active and initialized, and increments the config object count.
- On an initialized manifest, requires active status, matching object ID, config, mint, hash, and any nonempty supplied URI.
- On the first mint, validates metadata lengths, requires at least one creator, limits the creator count to the Metaplex maximum, limits seller fee basis points to 10,000, requires creator shares to total 100, requires the stored manifest creator in the list, and requires every creator marked verified to sign.
- On the first mint, creates Metaplex metadata. The function then calls SPL Token `mint_to` for one unit on every invocation that reaches that point.
- On the first mint after `mint_to`, creates a master edition with `max_supply = 0` and verifies either a sized or unsized collection. Metadata and master-edition creation occur only when the manifest was not previously marked minted. The later-call outcome depends on the current account and authority state; this source candidate includes no runtime test result.
- Marks the manifest minted and emits `ObjectMinted` after the mint and any first-mint Metaplex work succeed.

The missing stored-authority signature is an unresolved mint-admission decision. Documentation must not choose between intended permissionless payer-funded minting and a missing authority control.

### `update_object_manifest(manifest_hash, metadata_uri, is_active)`

- Requires an owner signer, config and auth PDAs, object manifest, object mint, owner token account, object metadata account, Metaplex program, rent sysvar, and optional instructions sysvar.
- Requires the token account owner to equal the signer, the token account mint to equal the object mint, and a positive token balance.
- Validates the manifest initialization, config relationship, manifest PDA and bump, mint relationship, metadata PDA, Metaplex program, and sysvars.
- Mutates the stored manifest hash, metadata URI, and active flag.
- Updates the Metaplex metadata URI through an auth-PDA-signed CPI while retaining the other decoded metadata fields.
- Emits `ManifestUpdated`.

This is possession-based update authority only. The source defines no copyright, license, commercial-use permission, application entitlement, gameplay possession, custody, settlement, equity, or guaranteed revenue.

### `migrate_config_namespace(new_namespace: Pubkey)`

- Requires the old stored authority signer; that signer also pays for the new accounts.
- Requires the old config and auth PDAs, then initializes new config and auth PDAs under the new namespace.
- Copies authority, object count, and pause state; records new bump values and the new namespace.
- Does not move or rewrite existing object manifests, mints, metadata, token accounts, or events.
- Emits no OGAL event and defines no continuity, redirect, deprecation, rollback, or client-version rule.

### `set_paused(paused: bool)`

- Requires the current stored authority signer and config PDA.
- Replaces the config pause flag and emits `PauseStatusUpdated`.
- The mint instruction checks this flag; other instructions do not use it as a global stop.

## Account context boundary

| Context | Accounts and signer boundary |
| --- | --- |
| `Initialize` | `authority` signer; mutable `payer` signer; initialized config and auth PDAs; system program |
| `MintObjectNft` | Composite context containing `MintObjectNftBase` and `MintObjectNftMetadata` |
| `MintObjectNftBase` | unchecked non-signer `authority`; mutable config and auth PDAs; mutable `payer` signer; mutable unchecked manifest, mint, and recipient token account; unchecked recipient; token, associated token, and system programs |
| `MintObjectNftMetadata` | mutable unchecked metadata and master edition; unchecked collection mint; unchecked token metadata program; additional remaining accounts described below |
| Mint remaining accounts | mutable collection metadata; mutable collection master edition; rent sysvar; optional instructions sysvar; remaining creator accounts, with signatures required only for creators marked verified |
| `RotateCollectionAuthority` | stored `authority` signer; mutable config; auth; mutable collection metadata; collection mint; token metadata program |
| `UpdateObjectManifest` | mutable owner signer; mutable config; auth; mutable object manifest; object mint; owner token account; mutable object metadata; metadata program; rent; optional instructions sysvar |
| `SetAuthority` | stored `authority` signer; mutable config |
| `SetPaused` | stored `authority` signer; mutable config |
| `MigrateConfigNamespace` | mutable stored `authority` signer; mutable old config; initialized new config; old auth; initialized new auth; system program |

## State boundary

### `Config`

- `authority: Pubkey`
- `config_bump: u8`
- `auth_bump: u8`
- `object_count: u64`
- `namespace: Pubkey`
- `paused: bool`

### `Auth`

- `config: Pubkey`
- `bump: u8`

### `ObjectManifest`

- `config: Pubkey`
- `object_id: u64`
- `mint: Pubkey`
- `bump: u8`
- `mint_bump: u8`
- byte-backed `is_active`, `minted`, and `initialized` flags
- `manifest_hash: [u8; 32]`
- `metadata_uri: [u8; 128]`
- `metadata_uri_padding: u8`
- `metadata_uri_length: u16`
- `creator: Pubkey`

Object identity fields are validated against the config and PDA derivations. The manifest hash, metadata URI, and active flag are mutable through the possession-authorized update instruction.

### `CreatorInput`

- `address: Pubkey`
- `verified: bool`
- `share: u8`

Creator input is Metaplex metadata input; it is not OGAL payout, accounting, custody, or settlement state.

## Event boundary

| Event | Fields | Emission point |
| --- | --- | --- |
| `ObjectMinted` | config, manifest, mint, recipient, object ID | after successful mint processing |
| `ManifestUpdated` | config, manifest, mint, object ID, active flag | after manifest and metadata URI update |
| `PauseStatusUpdated` | config, paused flag | after pause flag replacement |

There are no OGAL events for `initialize`, `set_authority`, `rotate_collection_authority`, or `migrate_config_namespace`. These three events do not provide a complete governance timeline.

## Error boundary

| Error | Implemented boundary |
| --- | --- |
| `InvalidAuthority` | supplied authority does not match config authority |
| `UriTooLong` | manifest or metadata URI exceeds a source limit |
| `ObjectInactive` | an initialized manifest is inactive during mint |
| `ManifestNotInitialized` | update targets an uninitialized manifest |
| `ObjectIdMismatch` | supplied object ID differs from stored manifest |
| `InvalidConfig` | config relationship, PDA, or bump is invalid |
| `InvalidManifestAccount` | manifest address or owner is invalid |
| `ManifestAccountTooSmall` | manifest allocation is below required length |
| `InvalidObjectMintAccount` | object mint address or owner is invalid |
| `MintMismatch` | supplied mint differs from expected or stored mint |
| `InvalidOwnerTokenAccount` | update token account is not owned by signer |
| `OwnerDoesNotHoldObjectNft` | update token account has no positive balance |
| `ManifestMismatch` | supplied hash or nonempty URI differs from stored manifest during mint |
| `RecipientMismatch` | token account authority differs from recipient |
| `UnauthorizedDeployer` | initialize authority is neither payer nor allowlisted value |
| `MintingPaused` | mint is attempted while config pause flag is true |
| `MetadataNameTooLong` | metadata name exceeds Metaplex limit |
| `MetadataSymbolTooLong` | metadata symbol exceeds Metaplex limit |
| `InvalidCreatorShareDistribution` | creator list is empty or shares do not total 100 |
| `TooManyCreators` | creator count exceeds Metaplex limit |
| `InvalidSellerFeeBasisPoints` | seller fee basis points exceed 10,000 |
| `InvalidTokenMetadataProgram` | supplied program is not the Metaplex token metadata program |
| `MissingMintMetadataAccounts` | fewer than three required remaining metadata accounts are supplied |
| `InvalidRentSysvar` | supplied rent account is not the rent sysvar |
| `InvalidMetadataAccount` | object metadata address or data is invalid |
| `InvalidMasterEditionAccount` | master edition address is invalid |
| `InvalidCollectionMetadataAccount` | collection metadata address, mutability, or data is invalid |
| `InvalidCollectionMasterEditionAccount` | collection master edition address or mutability is invalid |
| `InvalidInstructionsSysvar` | supplied optional instructions account is not the instructions sysvar |
| `MissingManifestCreator` | creator metadata omits the recorded manifest creator |
| `InvalidRecipientTokenAccount` | recipient token account is not the expected ATA or token-owned account |
| `CreatorMustSign` | a creator marked verified did not sign |

## Ownership, rights, custody, and economic separation

- SPL Token ownership transfers happen outside OGAL.
- OGAL does not escrow tokens or other assets.
- The possession check for manifest updates is not a legal-rights registry.
- No license-reference contract, dispute process, recovery policy, application entitlement, or legal ownership model is implemented.
- Creator shares and seller fee basis points are metadata constraints. No offer, order, allocation, accounting, tax, refund, payout, custody, dispute, or settlement behavior is implemented.

## Deployment, integration, and public claims

Source configuration names a mainnet cluster and program ID. Historical documentation also carries Token Toss, namespace, collection, authority, and production statements. None was verified against chain, provider, build, release, or current external product evidence for this candidate. All remain `PUBLIC_CLAIMS_ONLY_UNVERIFIED`.

The repository contains no Anchor IDL and no Unity source. Local script source is present; its execution and deployment parity are unverified. External integration paths require an owning repository, immutable pin, separate source clearance, and integration evidence before they can support a claim.

## CPF and Studio boundary

CPF package `0.7.0-rc.1`, compatibility `0.7.x-enterprise-assurance`, at `NanoRes/contextual-pipeline-framework` `main` commit `1ad0874fffc377118a086aca54e561638fe66364`, tree `cc4c508c7e9bf6378dd28a04c678684b918d3e70`, is an accepted governance source with `UNRELEASED_RELEASE_CANDIDATE` posture. OGAL compatibility with it remains `CANDIDATE_NOT_ACCEPTED`.

Studio Context remains the NanoRes-specific adoption overlay and portfolio router. It does not make NanoRes identity, gameplay, business, economy, custody, or public policy part of neutral OGAL protocol requirements.

## Unresolved Human gates

- Mint-admission authority intent
- Security review and remediation
- License selection or grant
- Public-good service profile
- Mainnet, deployment, and deployed-bytecode verification
- Namespace, authority, collection, Token Toss, and production claims
- Migration continuity and read-contract semantics
- Economic, custody, settlement, token, and public-claim authority
- CPF compatibility acceptance
