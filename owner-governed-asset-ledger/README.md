# Owner-Governed Asset Ledger Program

This directory contains the Anchor workspace for the Owner-Governed Asset Ledger (OGAL) program. The workspace includes the on-chain program, Anchor IDL, Node.js helper scripts, and Unity tooling used to operate the shared registry across multiple teams.

## Documentation Quick Links
- [Shared OGAL Program Guide](../../docs/ogal-protocol/ogal-shared-deployment-guide.md) – end-to-end onboarding for Solana and Unity developers.
- [Collection authority rotation playbook](../../docs/ogal-protocol/collection-authority-rotation.md) – background on managing Metaplex update authorities.

## Program Identity and Keypairs
- Generate the program keypair locally (for example, `solana-keygen new -o target/deploy/owner_governed_asset_ledger-keypair.json`) and ensure its public key matches the `declare_id!` macro in `programs/owner_governed_asset_ledger/src/lib.rs` and the `[programs.<cluster>].owner_governed_asset_ledger` entry inside `Anchor.toml` before building or deploying.
- Update `ALLOWED_DEPLOYERS` in `programs/owner_governed_asset_ledger/src/lib.rs` so any wallets that will initialize namespaces on behalf of others are permitted by the on-chain access control.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L37-L44】
- Point `Anchor.toml`'s `[provider].wallet` (or the `ANCHOR_WALLET` environment variable) at the payer keypair that will cover deployment fees and run `initialize`.

## Deployment Prerequisites
1. Fund the payer/authority wallets and confirm they are either identical or explicitly listed in `ALLOWED_DEPLOYERS`. The `initialize` instruction enforces this check before creating PDAs.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L71-L94】
2. Run `anchor build` to compile the program and refresh the IDL at `idl/owner_governed_asset_ledger.json`.
3. Deploy or upgrade the program using `anchor deploy` (or `anchor upgrade`) once the IDs and wallets align.
4. Call `initialize(namespace)` against the deployed program to create the config and mint-authority PDAs for each namespace that will participate.

## Instruction Surface
The program exports the following instructions. Refer to the shared guide for full account layouts and workflows.

- `initialize(namespace)` – bootstraps the config and mint-authority PDAs under a namespace.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L71-L94】
- `set_authority(new_authority)` – transfers registry governance to another signer.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L97-L101】
- `rotate_collection_authority(new_update_authority)` – signs a Metaplex CPI with the mint-authority PDA to rotate the collection NFT's update authority.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L104-L153】
- `mint_object_nft(...)` – creates or reuses manifests and mints verified NFTs into recipient accounts.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L155-L620】
- `update_object_manifest(...)` – lets NFT holders refresh manifest metadata and activation flags.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L621-L704】
- `migrate_config_namespace(new_namespace)` – clones configuration state to a new namespace/authority PDA pair.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L705-L731】
- `set_paused(paused)` – toggles the global pause flag for the namespace.【F:solana/owner-governed-asset-ledger/programs/owner_governed_asset_ledger/src/lib.rs†L732-L741】

## CLI Helpers
The `scripts` directory exposes small Node.js utilities for initialization, collection inspection, and collection authority rotation. Install dependencies with `npm --prefix solana/owner-governed-asset-ledger install`, update each script's hardcoded program ID to match your deployment, and follow the workflows documented in the shared program guide for usage details.【F:solana/owner-governed-asset-ledger/scripts/initialize.js†L18-L19】【F:solana/owner-governed-asset-ledger/scripts/inspect-collection.js†L38-L42】【F:solana/owner-governed-asset-ledger/scripts/rotate-collection-authority.js†L19-L20】 Additional automation for minting, manifest updates, authority transfers, pause toggles, and migrations is still under development—see the guide for interim integration tips.

## Unity Client Configuration
The Unity project reads OGAL settings from `Assets/Solana_Toolbelt/_Data/Solana_Configuration.asset`. Populate the program ID, namespace, config PDA, and mint-authority PDA with your confirmed values after initialization. Unity transaction sender prefabs for namespace initialization and collection-authority rotation live under `Assets/Solana_Toolbelt/Program_Instructions`, and the runtime mint/update flows are implemented in `Assets/Solana_Toolbelt/Services/Owner_Governed_Asset_Ledger_Service`. Configure them with your deployment-specific data before shipping builds.【F:Assets/Solana_Toolbelt/_Data/_Scripts/SolanaConfiguration.cs†L162-L686】【F:Assets/Solana_Toolbelt/Program_Instructions/InitializeNamespaceTransactionSender.cs†L16-L193】【F:Assets/Solana_Toolbelt/Program_Instructions/SetCollectionUpdateAuthorityTransactionSender.cs†L16-L211】

## Related Runbooks
- [Mint debugging runbook](../../docs/ogal-protocol/mint-debugging-runbook.md) – guidance for troubleshooting failed transactions in Unity.
- [OGAL auditability and access](../../docs/ogal-protocol/ogal-auditability-and-access.md) – governance and observability context for the ledger.

Generate the program keypair locally (for example,
`solana-keygen new -o target/deploy/owner_governed_asset_ledger-keypair.json`) and keep it
out of version control (see `.gitignore`). The public key derived from that file
**must** match the ID declared in `Anchor.toml` and in
`programs/owner_governed_asset_ledger/src/lib.rs` before building or deploying.

Before running `anchor deploy`, make the following updates:

1. **Anchor provider wallet** – Set the `[provider].wallet` entry in
   `Anchor.toml` (or export `ANCHOR_WALLET`) to
   `/home/nanores/.config/solana/nano_id.json`. This wallet pays for the
   deployment fees and will sign `initialize`.
2. **Allowed deployers** – If a different wallet will initialize the registry
   on behalf of the authority, add its public key to the `ALLOWED_DEPLOYERS`
   constant in `programs/owner_governed_asset_ledger/src/lib.rs` before rebuilding.
3. **Program ID consistency** – Run `solana address -k
   target/deploy/owner_governed_asset_ledger-keypair.json` and ensure the resulting address
   matches the `declare_id!` macro in the program source and the value under
   `[programs.<cluster>].owner_governed_asset_ledger` in `Anchor.toml`.

After those files are updated, rebuild the program (`anchor build`) to refresh
the IDL before deploying.

## Deployment prerequisites

The `initialize` instruction enforces that the signer who submits the
transaction is either the payer or one of the explicitly allowed deployers. The
list of allowed deployers is controlled by the `ALLOWED_DEPLOYERS` constant near
the top of `programs/owner_governed_asset_ledger/src/lib.rs`. In this repository it already
includes the legacy deployment wallet `GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx`.
If you want to deploy from a different wallet, add its public key to the array
and rebuild the program before attempting to run `anchor deploy`.

If you encounter the error message `The signer is not authorized to deploy the
owner-governed asset ledger.`, double-check that the public key of the deploying wallet is
listed in `ALLOWED_DEPLOYERS` (or is the same as the payer) and that the wallet
configured in `Anchor.toml` matches the keypair you expect to use.

## Instructions

The program implements the following instructions:

- `initialize` — bootstraps the configuration PDA and the mint authority PDA.
- `mint_object_nft` — mints an object NFT to a recipient ATA while ensuring the manifest PDA exists.
- `update_object_manifest` — updates the metadata URI and active flag for an existing manifest PDA.
- `rotate_collection_authority` — updates the collection NFT's Metaplex
  `update_authority`, signing the CPI with the OGAL mint-authority PDA so the
  studio can hand control back to a wallet for maintenance. The instruction's
  Anchor discriminator hashes the string `global:rotate_collection_authority`
  and should resolve to `[127, 21, 205, 57, 21, 40, 136, 55]`. The Unity and
  CLI helpers verify this preimage at runtime and automatically retry with the
  legacy double-colon hash if the deployed program has not yet been upgraded,
  ensuring the request does not route to the fallback handler.

Refer to `programs/owner_governed_asset_ledger/src/lib.rs` for implementation details.

## Deploying the Program

`initialize` may only be executed by the wallet that pays the transaction fees
unless that wallet's public key appears in the `ALLOWED_DEPLOYERS` constant in
`programs/owner_governed_asset_ledger/src/lib.rs`. Encountering the on-chain error
`The signer is not authorized to deploy the owner-governed asset ledger.` means that the
`authority` signer passed to the instruction either does not match the payer or
has not been whitelisted. To proceed:

1. Decide which wallet will act as the long-term registry authority. The same
   keypair can also be used as the payer, or you may add additional team wallets
   to `ALLOWED_DEPLOYERS` so they can perform the initialization on behalf of
   the authority. The authority **cannot** be the program ID because program
   accounts do not possess signing capability.
2. Update `Anchor.toml` so the `[provider]` `wallet` path points to the keypair
   you will use when deploying. If you added entries to `ALLOWED_DEPLOYERS`,
   ensure the corresponding keypairs are available locally.
3. Build the workspace with `anchor build` and verify the output key matches the
   `programs.mainnet.owner_governed_asset_ledger` entry in `Anchor.toml`.
4. Run `anchor deploy` (or `anchor upgrade` after the initial deployment) with
   the correct wallet so the program is uploaded to the target cluster.
5. Finally, call `initialize` using the same payer or a wallet listed in
   `ALLOWED_DEPLOYERS`, supplying the authority pubkey and desired namespace to
   create the registry configuration PDA.

## One-shot CLI command for `initialize`

After the workspace is built and the authority wallet is funded, the fastest
way to run `initialize` from WSL is with the helper script added in
`scripts/initialize.js`. It derives the config/auth PDAs, builds the
instruction, and submits it to the cluster in a single CLI call.

```bash
# Install the small CLI dependencies once
npm --prefix solana/owner-governed-asset-ledger install

# Generate or select the namespace pubkey ahead of time
NAMESPACE=$(solana-keygen pubkey namespace.json)

# Invoke initialize on mainnet with the required accounts
npm --prefix solana/owner-governed-asset-ledger run initialize \
  -- --namespace "$NAMESPACE" \
  --authority-keypair ~/.config/solana/nano_id.json \
  --payer-keypair ~/.config/solana/nano_id.json \
  --rpc-url https://api.mainnet-beta.solana.com
```

The script prints the namespace, derived config/auth PDAs, transaction
signature, and last valid block height so you can verify the deployment and
record the addresses for the Unity client configuration.

## Authority and namespace maintenance helpers

Additional npm scripts mirror the on-chain maintenance instructions. Each
helper emits structured JSON logs so you can pipe the output to tools like
`jq` when capturing transactions for incident response runbooks.

### Rotate the registry authority

```
npm --prefix solana/owner-governed-asset-ledger run set-authority \
  -- --namespace <CURRENT_NAMESPACE> \
  --new-authority <NEW_AUTHORITY_PUBKEY> \
  --authority-keypair ~/.config/solana/nano_id.json
```

The script derives the config/auth PDAs for the namespace, submits the
`set_authority` instruction, and logs the resulting signature. Ensure the
current authority signer still matches the config PDA before submitting.

### Pause or resume minting

```
npm --prefix solana/owner-governed-asset-ledger run set-paused \
  -- --namespace <CURRENT_NAMESPACE> \
  --paused \
  --authority-keypair ~/.config/solana/nano_id.json
```

Passing `--paused` pauses the registry while `--no-paused` resumes it. When a
simulation fails the helper prints the RPC logs along with guidance for
retrieving additional context via `solana confirm --verbose`.

### Migrate to a new namespace

```
npm --prefix solana/owner-governed-asset-ledger run migrate-namespace \
  -- --old-namespace <CURRENT_NAMESPACE> \
  --new-namespace <NEW_NAMESPACE> \
  --authority-keypair ~/.config/solana/nano_id.json
```

The migration helper clones the config data into the new namespace and
initializes a fresh auth PDA. The authority signer also pays rent for the new
accounts, so make sure it has sufficient SOL. If the transaction simulation
detects pre-existing PDAs the script surfaces the logs and suggests closing the
conflicting accounts or choosing another namespace before retrying.

## Unity client configuration

The Unity project reads the registry values from
`Assets/Solana_Toolbelt/_Data/Solana_Configuration.asset`. After deploying or
re-initialising the registry, update the following fields so the runtime can
mint player-created levels against the live program:

```
ownerGovernedAssetLedgerProgramId      = GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx
ownerGovernedAssetLedgerNamespace      = 3Bc5ARkDGM2ZdAe8EjwHMmNrXvpSzQVcPug7MSp4Qhbw
ownerGovernedAssetLedgerConfigAccount  = 5bhVoogdhY5VYuLuUuMXaiNrvP4zbmP1wNWstUUvmiF5
ownerGovernedAssetLedgerAuthorityAccount = E5mQ27muTebiYaohBsdsCwrvPN3MVoRmECFtL4A5Sx9q
```

`OwnerGovernedAssetLedgerService` falls back to deriving the config PDA from the namespace
when you leave `ownerGovernedAssetLedgerConfigAccount` empty. Recording the confirmed PDA
here avoids that extra derivation call and prevents future edits from
accidentally pointing to an outdated namespace.
