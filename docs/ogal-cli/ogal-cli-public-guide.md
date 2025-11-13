# Operating the public OGAL CLI

This playbook explains how to operate the Owner-Governed Asset Ledger (OGAL) command-line helpers against the shared program that our studio maintains on Solana mainnet. The CLI is published under `solana/owner-governed-asset-ledger` and ships ready to target the production program ID `GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx` without further configuration.【F:solana/owner-governed-asset-ledger/scripts/utils.js†L1-L95】 All commands run on mainnet-beta with `confirmed` commitment unless you override the RPC endpoint or commitment flags.

## Environment checklist

1. Install dependencies once:
   ```bash
   npm --prefix solana/owner-governed-asset-ledger install
   ```
   The package.json exposes scripts for every OGAL instruction, so you can call them through `npm --prefix ... run <script> -- <flags>` from any directory.【F:solana/owner-governed-asset-ledger/package.json†L1-L24】
2. Collect the shared registry constants that the studio publishes alongside this document (namespace, config PDA, mint-authority PDA, collection mint, and registry authority wallet). Each command below includes the flags that must reference those values.
3. Ensure every signing keypair file is stored locally and funded for fees. The helpers expand `~` in file paths to make it easy to reference standard Solana keypair dumps.【F:solana/owner-governed-asset-ledger/scripts/utils.js†L1-L95】

## Instruction catalogue

### Initialize a namespace (public entry point)

Anyone can onboard a new namespace by creating its config and mint-authority PDAs with the shared program—this is how partner teams adopt the protocol without redeploying OGAL. The helper enforces that the authority and payer public keys supplied via flags match the loaded keypair files and derives the PDAs deterministically before submitting the transaction.【F:solana/owner-governed-asset-ledger/scripts/initialize.js†L1-L158】

```bash
npm --prefix solana/owner-governed-asset-ledger run initialize -- \
  --namespace <NEW_NAMESPACE_PUBKEY> \
  --authority-keypair /path/to/authority.json \
  [--payer-keypair /path/to/payer.json] \
  [--authority <BASE58_PUBKEY>] \
  [--payer <BASE58_PUBKEY>] \
  [--rpc-url <RPC_ENDPOINT>] \
  [--commitment processed|confirmed|finalized]
```

**Planning notes**
- Generate a namespace keypair (or reuse an address from a custodial wallet) and fund the payer with SOL for rent and fees.
- If the deployer differs from the payer, supply both keypair paths so the script can add them to the signer set. The helper defaults the payer to the authority when you omit `--payer-keypair`, so explicitly pass a second file path when delegating payment.【F:solana/owner-governed-asset-ledger/scripts/initialize.js†L42-L158】
- Archive the derived config and mint-authority PDAs printed at the end—their addresses gate every other instruction.

### Inspect the collection (health check)

Use `inspect-collection` to confirm that the collection NFT trusts the OGAL mint-authority PDA and to review collection sizing metadata. You can optionally provide namespace and bump expectations to assert that the on-chain state matches your records.【F:solana/owner-governed-asset-ledger/scripts/inspect-collection.js†L1-L187】

```bash
npm --prefix solana/owner-governed-asset-ledger run inspect-collection -- \
  --mint <COLLECTION_MINT> \
  [--namespace <NAMESPACE_PUBKEY>] \
  [--config-bump <INT>] [--auth-bump <INT>] \
  [--metadata <ACCOUNT>] [--metadata-bump <INT>] \
  [--edition <ACCOUNT>] [--edition-bump <INT>] \
  [--rpc-url <RPC_ENDPOINT>]
```

### Rotate the collection update authority

When temporary automation needs to claim the collection NFT, rotate the update authority with this script. It accepts either a base58 address or a path to a keypair JSON file for the new authority, automatically retries with the legacy discriminator if the cluster still expects it, and logs all derived addresses before submitting the transaction.【F:solana/owner-governed-asset-ledger/scripts/rotate-collection-authority.js†L1-L209】

```bash
npm --prefix solana/owner-governed-asset-ledger run rotate-collection-authority -- \
  --namespace <NAMESPACE_PUBKEY> \
  --collection-mint <COLLECTION_MINT> \
  --new-update-authority <BASE58_OR_KEYPAIR_PATH> \
  --authority-keypair /path/to/config-authority.json \
  [--payer-keypair /path/to/payer.json] \
  [--rpc-url <RPC_ENDPOINT>] \
  [--commitment <LEVEL>]
```

### Transfer the registry authority

Use `set-authority` when the namespace should be governed by a different signer. The script derives both PDAs, serialises the new authority, and sends the transaction while emitting structured logs you can archive for audits.【F:solana/owner-governed-asset-ledger/scripts/set-authority.js†L1-L108】

```bash
npm --prefix solana/owner-governed-asset-ledger run set-authority -- \
  --namespace <NAMESPACE_PUBKEY> \
  --new-authority <BASE58_PUBKEY> \
  --authority-keypair /path/to/current-authority.json \
  [--rpc-url <RPC_ENDPOINT>] \
  [--commitment <LEVEL>]
```

### Pause or resume minting

`set-paused` toggles OGAL’s global pause flag. The helper loads the config authority keypair, derives the PDAs, and writes the boolean flag expected by the on-chain program.【F:solana/owner-governed-asset-ledger/scripts/set-paused.js†L1-L110】 Pass `--paused` to freeze new mints or `--no-paused` to resume.

```bash
npm --prefix solana/owner-governed-asset-ledger run set-paused -- \
  --namespace <NAMESPACE_PUBKEY> \
  --paused/--no-paused \
  --authority-keypair /path/to/config-authority.json \
  [--rpc-url <RPC_ENDPOINT>] \
  [--commitment <LEVEL>]
```

### Migrate namespace metadata

Should the studio ever publish a new namespace for the shared deployment, call `migrate-namespace` with the old and new addresses. The script derives both sets of PDAs, copies config state, and surfaces simulation logs on failure so you can remediate quickly.【F:solana/owner-governed-asset-ledger/package.json†L9-L16】

```bash
npm --prefix solana/owner-governed-asset-ledger run migrate-namespace -- \
  --old-namespace <CURRENT_NAMESPACE> \
  --new-namespace <NEW_NAMESPACE> \
  --authority-keypair /path/to/config-authority.json \
  [--rpc-url <RPC_ENDPOINT>] \
  [--commitment <LEVEL>]
```

## Deep dive: minting OGAL object NFTs

The `mint-object` helper orchestrates every account required by the `mint_object_nft` instruction, validates human inputs against OGAL’s constraints, and prints the derived addresses so you can store them with your release metadata.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L1-L571】 Use this checklist to collect the variables you’ll need before invoking it.

| Variable | Where it comes from | Script validation |
| --- | --- | --- |
| `--namespace` | Always pass the shared namespace published by the studio. | Parsed as a `PublicKey` and fed into PDA derivations.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L332-L383】 |
| `--object-id` | Choose the next unused 64-bit integer for your namespace. Track it in your content pipeline so IDs never collide. | Converted to a `BigInt`; malformed values throw before any RPC call.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L332-L341】 |
| `--manifest-uri` | Upload the metadata JSON first (IPFS, Arweave, HTTPS) and paste the final URI. | Required, max length 128 characters.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L334-L347】 |
| `--manifest-hash` | Compute the SHA-256 hash of the manifest file and hex-encode it (32 bytes). | Must be exactly 64 hex characters; the helper strips optional `0x` prefixes.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L62-L77】 |
| `--metadata-name` / `--metadata-symbol` | Creator-facing token metadata. Keep symbols <= 10 chars and names <= 32 to respect on-chain caps. | Empty or oversized values abort the command with descriptive errors.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L334-L356】 |
| `--seller-fee-bps` | Royalty basis points (0–10_000). Coordinate with finance/legal before finalising. | Range-checked before the transaction is built.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L338-L341】 |
| `--recipient` | Wallet that should receive the newly minted NFT. | Parsed as a `PublicKey` and used when deriving the recipient ATA.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L363-L403】 |
| `--collection-mint` | Use the shared collection mint published by the studio so OGAL can verify membership. | Drives collection metadata/master edition PDAs and CPI accounts.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L366-L397】 |
| `--payer-keypair` | Creator wallet that funds account rents and signs the mint. | Loaded from disk; also used to infer verified creator defaults.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L358-L365】 |
| `--creator` / `--creators-json` | Enumerate up to five creators as `address:share:verified[:keypairPath]` or a JSON array. Ensure verified collaborators provide keypairs for co-signing. | Shares must total 100 and verified creators must either be the payer or supply a matching keypair file.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L143-L226】【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L424-L452】 |
| `--authority` | Optional override if you want to assert the stored config authority before minting. | The helper fetches the config account and confirms the override matches on-chain data.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L405-L422】 |
| `--config-bump`, `--auth-bump`, `--manifest-bump`, `--mint-bump` | Optional bump assertions from your records. | Any mismatch stops the run so you can reconcile addresses before minting.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L370-L392】 |
| `--include-instructions-sysvar` | Required when minting into a sized collection. | Adds the instructions sysvar account when requested.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L494-L500】 |

Before you submit the transaction, confirm that the collection NFT’s update authority equals the namespace’s derived `auth` PDA. Metaplex enforces that relationship during collection verification, and only one namespace can control a collection at a time. If the update authority is stale or delegated elsewhere, reclaim it with the rotation helper in [`collection-authority-rotation.md`](../ogal-protocol/collection-authority-rotation.md) before retrying the mint.

**Execution tips**

1. Dry-run the command without `--include-instructions-sysvar` first; the helper will fail fast on missing files or malformed flags before any RPC calls are made.
2. Store the printed PDAs, signature, and last valid block height with your release artifacts—they’re emitted via structured logs and stdout for easy ingestion.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L509-L570】
3. If the transaction fails, inspect the surfaced simulation logs to understand which guard rail fired before retrying.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L545-L569】

## Deep dive: updating manifests

Holders can refresh manifest metadata, rotate URIs, or toggle the active flag through `update-manifest`. The helper enforces every invariant OGAL expects before the transaction is submitted.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L1-L288】 Collect these inputs up front:

| Variable | Purpose | Script validation |
| --- | --- | --- |
| `--namespace` | Shared namespace to scope PDA derivations. | Derives the config PDA and checks optional bump overrides.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L173-L199】 |
| `--object-id` | Matches the identifier chosen during minting. | Parsed as a `BigInt`; invalid formats throw immediately.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L173-L199】 |
| `--object-mint` | The NFT mint address stored on the manifest. | Verified against the manifest PDA derived from the namespace and object ID so typos are caught before submitting.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L200-L209】 |
| `--owner-keypair` | Wallet that currently holds the NFT. It pays fees and signs the instruction. | Loaded from disk; the key is used as fee payer and signer.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L187-L258】 |
| `--owner-token-account` | Optional ATA override when the NFT lives in a non-standard account. | Defaults to the derived ATA if omitted.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L211-L216】 |
| `--manifest-hash` | New SHA-256 hash of the manifest JSON. | Must be 32 bytes of hex; the helper strips `0x` prefixes automatically.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L44-L59】 |
| `--metadata-uri` | Updated metadata location (<=128 characters). | Empty or oversized URIs fail fast with actionable errors.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L177-L185】 |
| `--is-active` | Boolean flag to gate consumption of the manifest. | Accepts typical truthy/falsey strings (`true`, `false`, `0`, `1`, etc.).【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L68-L88】 |
| `--config-bump`, `--manifest-bump`, `--mint-bump` | Optional assertions to guard against PDA drift. | Any mismatch stops the run so you can reconcile state before changing metadata.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L191-L209】 |

**Operational reminders**

- Confirm the signer still controls the NFT before you run the script. OGAL enforces ownership on-chain, but verifying custody ahead of time avoids unnecessary transaction fees.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L218-L244】
- Capture the transaction signature and last valid block height from stdout; store them with the new manifest hash and URI for provenance tracking.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L231-L288】
- If the update fails, review the structured error logs the helper prints—they include Solana simulation logs whenever available to accelerate debugging.【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L257-L282】

## Record keeping and monitoring

- Run `inspect-collection` before and after large mint batches to ensure the collection update authority still points at OGAL’s mint PDA. If a third party rotated it away, reclaim control with `rotate-collection-authority` before retrying a mint.【F:solana/owner-governed-asset-ledger/scripts/rotate-collection-authority.js†L1-L209】
- Store every object’s namespace, manifest hash, URI, object mint, creators, transaction signatures, and last valid block heights in your release tracker. The CLI prints all of this data explicitly so it can be ingested automatically.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L509-L570】【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L231-L288】
- When anything fails, copy the structured JSON log lines from stderr into your support tickets—they capture derived PDAs, errors, and simulation logs in a machine-readable format.【F:solana/owner-governed-asset-ledger/scripts/mint-object.js†L509-L570】【F:solana/owner-governed-asset-ledger/scripts/update-manifest.js†L257-L282】【F:solana/owner-governed-asset-ledger/scripts/set-authority.js†L69-L108】

Follow these workflows and every partner can safely mint, manage, and govern OGAL assets on the shared public deployment without touching the on-chain code.
