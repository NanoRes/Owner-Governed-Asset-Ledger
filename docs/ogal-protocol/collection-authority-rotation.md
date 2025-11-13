# Rotating the OGAL Collection Update Authority

When minting through the Owner-Governed Asset Ledger (OGAL) the Unity client expects the collection NFT to list the derived mint-authority PDA as its update authority. If the collection still points to the legacy studio wallet you will hit the `custom program error: 0x65` guard rail.

This guide describes how to rotate the collection authority using Metaboss, including the legacy flag set used by Metaboss v0.44.x.

## Confirming your Metaboss install

At the time of writing the latest published release is **Metaboss v0.44.1**.
That build already exposes the `set update-authority` command we rely on below,
so there is no newer “0.50” series to hunt down. If you need to reinstall the
binary (for example on a new workstation), download v0.44.1 from the
[Metaboss releases page](https://github.com/samuelvanderwaal/metaboss/releases)
or rebuild it from source with:

```bash
cargo install --git https://github.com/samuelvanderwaal/metaboss --locked --force
```

After installation, run `metaboss --version` and make sure it prints `0.44.1`
before continuing.

## Prerequisites

- Access to the current update authority keypair for the collection NFT.
- RPC endpoint URL (mainnet or devnet).
- The collection mint address. For the live production namespace: `EhULHuQtpaKUZSdv1kQR7XwYGRfEaU8b1Y7JkbFGQHxW`.
- The derived OGAL mint-authority PDA that must become the collection authority: `G7skWhSjK6oskMKMuCbVuRQSVvrhc1VN1nQYLHR8ewL5`.

## Step 1 – Derive the metadata PDA

Before you rotate the authority you need the collection’s metadata account
(`meta...`). Metaboss 0.44.1 prints it directly via the `derive metadata`
subcommand:

```bash
metaboss derive metadata EhULHuQtpaKUZSdv1kQR7XwYGRfEaU8b1Y7JkbFGQHxW
```

The command echoes a single `meta...` address to stdout. Save that value—you’ll
need it for verification and troubleshooting.

If you also want to inspect the on-chain metadata JSON, run:

```bash
metaboss decode mint \
  --rpc <RPC_URL> \
  --account EhULHuQtpaKUZSdv1kQR7XwYGRfEaU8b1Y7JkbFGQHxW \
  --full \
  --output ./metaboss-output
```

`decode mint` writes `<MINT>.json` to the chosen directory and does **not**
print anything to the console. Open the JSON file to confirm fields such as
`update_authority` before and after the rotation.

## Step 2a – Hand control **to** the OGAL mint-authority PDA

Metaboss 0.44.1 can still rotate the collection when the *current* update
authority is a wallet that can sign the transaction. Use the CLI when you are
handing control **to** the OGAL mint-authority PDA after maintenance is
complete.

Run the `set update-authority` subcommand (note the `set`, not `update`). The
`--account` flag still expects the **mint address**:

```bash
metaboss set update-authority \
  --rpc <RPC_URL> \
  --keypair /path/to/current_authority.json \
  --account EhULHuQtpaKUZSdv1kQR7XwYGRfEaU8b1Y7JkbFGQHxW \
  --new-update-authority <TARGET_AUTHORITY> \
  [--keypair-payer /path/to/payer.json]
```

Replace `<TARGET_AUTHORITY>` with the address that should control the
collection:

- `G7skWhSjK6oskMKMuCbVuRQSVvrhc1VN1nQYLHR8ewL5` — the OGAL mint-authority
  PDA used for normal level minting.
- `E5mQ27muTebiYaohBsdsCwrvPN3MVoRmECFtL4A5Sx9q` — the developer wallet that
  needs temporary control to resize the collection or perform other manual
  metadata edits.

`metaboss set ...` streams progress to stdout and prints the transaction
signature when the authority rotation succeeds.

## Step 2b – Hand control **back** to the developer wallet

Once the PDA is the recorded update authority, Metaplex expects that PDA to
sign any further updates. Because program-derived addresses cannot sign
transactions directly, the CLI path above fails when you try to rotate the
collection **away** from the PDA. Instead, call the OGAL helper script that
invokes the on-chain program and uses the PDA seeds to authorize the change:

```bash
npm --prefix solana/owner-governed-asset-ledger \
  run rotate-collection-authority -- \
  --namespace <NAMESPACE_PUBKEY> \
  --collection-mint EhULHuQtpaKUZSdv1kQR7XwYGRfEaU8b1Y7JkbFGQHxW \
  --new-update-authority E5mQ27muTebiYaohBsdsCwrvPN3MVoRmECFtL4A5Sx9q \
  --authority-keypair /path/to/config-authority.json \
  [--payer-keypair /path/to/payer.json] \
  [--rpc-url https://api.mainnet-beta.solana.com]
```

The script derives the OGAL configuration PDA from the supplied namespace,
invokes the on-chain program to rotate the collection metadata authority, and
prints the transaction signature. Use the optional payer override if the
config authority wallet should not cover the transaction fee.

> **Tip:** You can point `--new-update-authority` at either a base58 public key
> **or** a keypair JSON file. When a file path is supplied the helper reads the
> keypair, derives its public key, and uses that as the new authority. This lets
> you reuse the same wallet JSON for both the `--new-update-authority` and
> `--authority-keypair` arguments when the developer wallet should become the
> signer.

When running this command from a different directory (for example, inside the
Unity project root in WSL), make sure the `--prefix` path still resolves to the
repository's `solana/owner-governed-asset-ledger` folder. If you see
`npm ERR! enoent Could not read package.json`, it usually means the relative
path is wrong; either `cd` to the repo root or replace the prefix with the
absolute path to the Solana workspace before retrying.

If you have not run any of the helper scripts before, install the small Node.js
dependencies once with `npm --prefix solana/owner-governed-asset-ledger install`
before calling `npm run rotate-collection-authority`.

## Step 3 – Verify the change

Repeat the decode command from Step&nbsp;1 (re-using the saved JSON if desired)
and confirm the `updateAuthority` now equals the intended target. While the
developer wallet controls the collection, mint attempts from the OGAL program
will fail with `custom program error: 0x65`; this is expected and prevents new
player mints while the metadata is being updated. Once the maintenance work is
finished, rotate the authority back to the OGAL mint-authority PDA to
re-enable minting.

## Troubleshooting

- `failed to get account data`: double-check that `--account` is the mint
  address (`EhULHuQtpaKUZSdv1kQR7XwYGRfEaU8b1Y7JkbFGQHxW`) and that the current
  update-authority keypair signs the transaction. Passing the legacy wallet or
  a derived PDA causes this RPC error.
- `Found argument '--mint' which wasn't expected`: Metaboss 0.44.1 expects
  `--account <mint_address>` instead of `--mint`.
- `Found argument 'update-authority' which wasn't expected`: make sure you're
  calling `metaboss set update-authority` (two words) rather than
  `metaboss update update-authority`.
- `custom program error: 0x9e` when running `metaboss set update-authority`:
  Metaplex is reporting `Invalid authority type`. The collection is still under
  the OGAL PDA, so the CLI cannot sign the rotation transaction. Use
  `npm run rotate-collection-authority` to hand control back to the developer
  wallet, then re-run the Metaboss command to restore the PDA afterwards.
- `custom program error: 0x65` when minting after the rotation: verify that you updated the correct collection mint and that the PDA matches the configured namespace in `Solana_Configuration.asset`.
- Still seeing `custom program error: 0x65` even though the update authority matches? Update to the OGAL program version that calls Metaplex's legacy `VerifyCollection` CPI for unsized collections (Token Toss build `2025-10-11` or later). Older binaries invoked the sized-only verification helper and always failed on unsized collections with error `0x65`. Recent Unity builds surface this scenario explicitly by warning that the collection metadata is unsized when the guard rail fires—if you see that message, the on-chain program (or client build) still needs the unsized verification upgrade.
- Need more context on the guard rail failure? Use the inspection utility shipped with the Solana scripts:

  ```bash
  cd solana/owner-governed-asset-ledger
  npm install
  npm run inspect-collection -- \
    --rpc-url https://api.mainnet-beta.solana.com \
    --namespace <REGISTRY_NAMESPACE_PUBKEY> \
    --mint <COLLECTION_MINT_ADDRESS>
  ```

  The JSON output lists the collection's update authority, whether the metadata is sized or unsized, the expected mint authority PDA for the supplied namespace, and whether those values match. Share this blob when escalating mint failures so the on-call engineer can spot mismatched addresses or unsized collections that still use an outdated on-chain program.
