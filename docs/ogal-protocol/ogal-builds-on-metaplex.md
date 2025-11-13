# How OGAL Builds on Metaplex’s NFT Protocols

## Metaplex as the foundation layer
OGAL is intentionally built on top of the Solana Unity SDK and Metaplex NFT protocols so that its higher-level gameplay and monetisation flows stay interoperable with the broader Solana ecosystem.

The on-chain program imports Metaplex’s token metadata CPI helpers (`CreateMetadataAccountV3`, `CreateMasterEditionV3`, `VerifyCollection`, and the sized-collection variant) alongside SPL token primitives, making Metaplex metadata and collection semantics first-class citizens inside every OGAL mint.

## OGAL ledger architecture
OGAL scopes each deployment to a namespace-backed configuration PDA that records the registry authority, pause flag, and object counter, paired with a mint-authority PDA that can sign metadata CPIs on behalf of the registry.

Object manifests are their own PDAs derived from the config, storing the immutable object ID, mint, creator, and the manifest hash while tracking mutable metadata URIs, activation state, and whether the NFT has been minted yet.

The shared deployment guide summarises these account relationships and explains how clients derive and validate each PDA before issuing instructions.

## Mint pipeline layered on Metaplex CPIs
`mint_object_nft` combines OGAL’s registry logic with Metaplex metadata creation in a single instruction. It enforces that minting is not paused, derives or creates the manifest, mint, and recipient ATA, and checks manifest hashes and metadata URIs before any tokens move.

When the first mint occurs, OGAL totals creator revenue shares, demands that the recorded manifest creator be listed, and then calls Metaplex’s `CreateMetadataAccountV3` and `CreateMasterEditionV3` CPIs to produce a verified 1/1 NFT tied to the configured collection.

OGAL immediately follows with either `VerifySizedCollectionItem` or the legacy `VerifyCollection` CPI so both sized and unsized Metaplex collections work without redeploying OGAL.

These steps ensure OGAL mints remain standard-compliant Metaplex assets even while OGAL tracks additional registry state.

## Governance, access control, and guard rails
Initialization requires either the config authority or an address whitelisted in `ALLOWED_DEPLOYERS`, preventing unauthorized namespace creation.

Operators can transfer control with `set_authority`, pause or resume the registry with `set_paused`, and migrate to a fresh namespace without redeploying the program, preserving continuity for all manifests and mints.

Error codes such as `MintingPaused`, `CreatorMustSign`, `InvalidCollectionMetadataAccount`, and `MissingManifestCreator` translate low-level guard rails into actionable feedback for clients.

The shared guide calls out these instructions and highlights the requirements (e.g., signer ownership proofs when updating manifests) so partner teams build to the same ruleset.

## Observability and runtime access policies
OGAL emits Anchor events for every mint, manifest update, and pause toggle, enabling downstream monitoring and compliance tooling without trusting off-chain reports.

Manifest accounts expose `is_active`, `metadata_uri`, and `manifest_hash` so studios can gate runtime access, revoke availability, or rotate metadata while maintaining provenance links for indexers and marketplaces.

This policy-driven approach governs how gameplay surfaces OGAL assets even though the underlying NFT metadata remains public on Solana.

## Operational tooling and shared workflows
Because OGAL relies on Metaplex verification, the collection NFT must point at OGAL’s mint-authority PDA; the rotation guide explains when to use Metaboss versus OGAL’s own CPI-backed helper so maintainers can hand authority back and forth safely (including the unsized-collection fallback added to OGAL).

The mint troubleshooting runbook shows how Unity logs serialized transactions and how engineers replay them to inspect Metaplex CPI failures, particularly collection verification guard rails.

The shared deployment guide also ships Node.js scripts and Unity components that wrap OGAL instructions, derive PDAs, and log reproducible diagnostics, making it straightforward for third parties to integrate OGAL without reimplementing the full Solana stack.

## What makes OGAL unique relative to vanilla Metaplex
Metaplex on its own offers metadata and collection verification, but OGAL layers a governed registry on top: namespace-scoped config state, manifest hashing, active/inactive flags, object counters, and creator-share validation are all enforced before the Metaplex CPI ever runs.

OGAL also provides operational levers (pause/migrate/authority rotation), structured events, and runtime access guidance so studios can commercialise user-generated content with fine-grained control that plain Metaplex metadata cannot supply.

Combined with battle-tested tooling and explicit guard-rail documentation, OGAL complements rather than replaces Metaplex: it leverages Metaplex for NFT standardisation while adding governance, auditability, and gameplay-aware policy enforcement that the base Metaplex program does not address.

## Testing
⚠️ Not run (QA review only).
