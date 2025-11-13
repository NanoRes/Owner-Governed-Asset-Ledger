# OGAL Collection Sizing Reference

This guide consolidates how Owner-Governed Asset Ledger (OGAL) interacts with Metaplex collection NFTs and explains the trade-offs between **sized** and **unsized** collection metadata. It also walks through detailed creation flows for each variant so the registry team can mint compliant collections for Token Toss.

## OGAL Compatibility

OGAL inspects the collection metadata during the first `mint_object_nft` execution for a namespace:

- If `collection_details` is **`null`**, OGAL treats the collection as **unsized** and CPIs into Metaplex's legacy `VerifyCollection` instruction.
- If `collection_details` is **present**, OGAL switches to the **sized** path and invokes `VerifySizedCollectionItem`.

The Unity `OwnerGovernedAssetLedgerService` now mirrors this behavior when it performs client-side guard checks: sized metadata skips the "unique master edition" requirement while unsized metadata still enforces `max_supply = 0`.

Programmable NFT collections that rely on Metaplex's `ProgrammableNonFungible` token standard are supported as soon as the parser accepts the expanded enum, so attaching a rule set no longer blocks OGAL from recognizing sized metadata.

Both branches are built into the production binary, so you can migrate collections between modes without redeploying OGAL. The CLI must provide the accounts each CPI expects:

- Unsized collections only require the default accounts listed in `mint_object_nft-instructions.md`.
- Sized collections additionally require the `Sysvar1nstructions1111111111111111111111111` account. The bundled CLI exposes this as `--include-instructions-sysvar`.

## When to Choose Each Mode

| Mode | Benefits | Drawbacks |
| --- | --- | --- |
| **Sized collection** | - On-chain metadata advertises how many items exist (or the intended cap) via `collection_details.size`.<br>- OGAL automatically increments the stored size when the first mint verifies with Metaplex, providing auditable supply tracking.<br>- Compatible with current Metaplex verifier semantics (no requirement for a unique master edition). | - Every mint transaction must supply the Instructions sysvar, so integrators must remember to add `--include-instructions-sysvar` (or equivalent) in custom clients.<br>- Manual collection edits must keep `collection_details` consistent with actual supply to avoid confusing consumers. |
| **Unsized collection** | - Simpler mint transactions: no Instructions sysvar is needed.<br>- Compatible with legacy OGAL tooling if all environments run the post-October 2025 binary that supports the unsized fallback path. | - Metaplex enforces that the collection's master edition is **unique** (`max_supply = 0`). If this requirement is not met, `VerifyCollection` fails with error `0x52` (`CollectionMustBeAUniqueMasterEdition`).<br>- No on-chain record of collection size, making supply audits dependent on off-chain indexing.

## Creating a Sized Collection NFT

Follow these steps when you want OGAL to track collection size on-chain:

1. **Generate a payer and authority keypair (if needed).**
   ```bash
   solana-keygen new -o ~/.config/solana/token_toss_collection.json
   ```
   The keypair funds account creation fees and temporarily holds collection authority before you hand it to OGAL.

2. **Upload collection metadata JSON.** Use a storage provider (Arweave, AWS S3, etc.) to host the metadata that Metaplex will reference. Ensure it contains the **required** fields `name`, `symbol`, `description`, and `image`, along with any optional collection attributes OGAL will surface to clients. If you are targeting Arweave, follow this workflow:

   1. **Prepare `metadata.json`.** Save the JSON to disk and lint/validate it locally so you can catch syntax errors before upload.
   2. **Select an uploader.** Either install the [Bundlr CLI](https://docs.bundlr.network/docs/cli/installation) or the [Arweave CLI](https://github.com/ArweaveTeam/arweave-deploy). Both CLIs accept the same JSON file path and return an Arweave transaction ID.
   3. **Fund your wallet.** Use `bundlr fund <lamports>` or `arweave wallet add` / `arweave wallet balance` to ensure the associated keypair has enough AR (or the Bundlr cross-chain token you selected) to pay for the upload.
   4. **Upload the file.** For Bundlr, run `bundlr upload metadata.json --content-type application/json`; for the Arweave CLI, run `arweave deploy metadata.json`. The command prints the transaction ID on success.
   5. **Record the output.** Persist the returned transaction ID and derived HTTP URL (`https://arweave.net/<transaction-id>`) in your project notes so you can inject it into Metaplex commands later.

   After the upload completes, verify the asset by requesting the URL (for example `curl https://arweave.net/<transaction-id>`) and confirm the response body matches your local JSON. Store the verified URI in your runbook—the same string must be passed to the `--uri` flag in Metaplex CLIs or scripts. When automating with the Metaplex JS SDK or CLI, propagate the CID/hash into `createMetadataAccountV3` calls (e.g., `--uri https://arweave.net/<transaction-id>` or `collectionMetadataData.uri = ...`). For scripts that load configuration from `.env` files or deployment manifests, persist the CID/hash there so every subsequent mint, verification, or update routine references the same immutable URI. This ensures the on-chain metadata points to the exact Arweave resource you uploaded.

3. **Create the collection mint.** With Metaplex JS or the CLI, create the mint account and initialize it as an NFT:
   ```bash
   ts-node scripts/metaplex/create-collection.ts \
     --payer ~/.config/solana/token_toss_collection.json \
     --name "Token Toss UGC Level" \
     --symbol TTLC \
     --uri https://arweave.net/<collection-json> \
     --seller-fee-bps 0 \
     --mutable \
     --token-standard NonFungible
   ```
   This script should issue `createMetadataAccountV3` and `createMasterEditionV3` with `max_supply = 0` (standard for collections) and mint exactly one token to the authority wallet.

4. **Populate `collection_details`.** Call `SetCollectionSize` (Metaplex instruction) or update the metadata via `updateMetadataAccountV2` to attach the exact structure OGAL expects from the [Metaplex Token Metadata program](https://developers.metaplex.com/token-metadata):
   ```json
   {
     "collectionDetails": {
       "V1": { "size": 0 }
     }
   }
   ```
   The nested `V1` enum tag mirrors Metaplex's [sized collection state](https://developers.metaplex.com/token-metadata/collections#sized-collections). Setting the initial size to `0` signals a sized collection, and OGAL will increment this value when it performs `VerifySizedCollectionItem`.

5. **Transfer collection authority to OGAL.** Use the OGAL CLI helper or Metaplex's `setAuthority` instruction to set the update authority to the OGAL mint-authority PDA documented for your deployment (for Token Toss mainnet this is `G7skWhSjK6oskMKMuCbVuRQSVvrhc1VN1nQYLHR8ewL5`).

6. **Verify the metadata.** Run:
   ```bash
   node solana/owner-governed-asset-ledger/scripts/inspect-collection.js --mint <collection-mint>
   ```
   Confirm `collection_details` is present and the update authority matches the OGAL PDA.

7. **Mint an object via OGAL.** Invoke the CLI with the extra sysvar:
   ```bash
   npm run mint-object -- --include-instructions-sysvar ...
   ```
   The first mint increments `collection_details.size` from `0` to `1` and completes without requiring a unique master edition.

### Sized Collection Metadata Examples

Use these examples as a starting point for storage uploads. Adjust the URIs and attribute content to match your launch.

**Sized collection (with `collectionDetails`):**

```json
{
  "name": "Token Toss UGC Level",
  "symbol": "TTLC",
  "description": "Official Token Toss collection managed by OGAL with on-chain supply tracking.",
  "image": "https://arweave.net/rVYCmcN0OhmPh2ls36Ic9psInvE4oweZbAV8x5mbPBY",
  "seller_fee_basis_points": 0,
  "external_url": "https://ghiblifygames.com/tokentosscollections",
  "attributes": [
    { "trait_type": "Season", "value": "2026" }
  ],
  "properties": {
    "creators": [
      { "address": "E5mQ27muTebiYaohBsdsCwrvPN3MVoRmECFtL4A5Sx9q", "share": 100 }
    ]
  },
  "collectionDetails": {
    "V1": { "size": 0 }
  }
}
```

**Unsized metadata (omit `collectionDetails` entirely):**

```json
{
  "name": "Token Toss UGC Level",
  "symbol": "TTLC",
  "description": "Official Token Toss collection managed by OGAL without supply tracking.",
  "image": "https://arweave.net/rVYCmcN0OhmPh2ls36Ic9psInvE4oweZbAV8x5mbPBY",
  "seller_fee_basis_points": 0,
  "external_url": "https://ghiblifygames.com/tokentosscollections",
  "attributes": [
    { "trait_type": "Season", "value": "2026" }
  ],
  "properties": {
    "creators": [
      { "address": "E5mQ27muTebiYaohBsdsCwrvPN3MVoRmECFtL4A5Sx9q", "share": 100 }
    ]
  }
}
```

## Creating an Unsized Collection NFT

Use this path when you want legacy unsized semantics and accept the requirement for a unique master edition.

1. **Prepare payer and authority keypairs** as described above.

2. **Upload collection metadata JSON** to your storage provider. Even though you will omit `collection_details`, the metadata must still include the **required** fields `name`, `symbol`, `description`, and `image` so OGAL can relay the collection to downstream clients. Follow the same Arweave workflow outlined above—prepare the JSON, choose Bundlr or the Arweave CLI, fund the wallet, upload, and record the transaction ID/URL—then verify the HTTP endpoint with `curl` and archive the resulting URI for later mints.

3. **Create the collection NFT without `collection_details`.** Issue the same `createMetadataAccountV3` and `createMasterEditionV3` calls, but **omit** any `collection_details` field. The important constraint is that the master edition must be created with `max_supply = 0` so Metaplex treats it as a unique edition.

4. **Verify uniqueness.** Inspect the collection master edition account. The `max_supply` field should be `0` or `None`, indicating a unique master edition. If it is set to a positive number or `null`, you must recreate the master edition to enforce uniqueness before OGAL can verify unsized items.

5. **Transfer update authority to OGAL** (same PDA as above).

6. **Confirm metadata state** with the inspector script. The output should show `"collection_details": null`.

7. **Mint an object via OGAL.** Run the CLI *without* `--include-instructions-sysvar`. OGAL will perform the legacy `VerifyCollection` CPI, which succeeds only because the master edition is unique. If you ever change the master edition to non-unique, subsequent mints will fail with error `0x52` until the unique constraint is restored.

### Unsized Collection Metadata Examples

The structures below highlight how unsized metadata intentionally leaves out the `collectionDetails` object so OGAL falls back to the legacy verification path from the [OGAL program](../solana/owner-governed-asset-ledger/README.md) while remaining compatible with Metaplex's unique-master-edition requirement.

**Sized metadata (with `collectionDetails`) for comparison:**

```json
{
  "name": "Token Toss UGC Level",
  "symbol": "TTLC",
  "description": "Reference JSON showing the sized structure OGAL detects.",
  "image": "https://arweave.net/rVYCmcN0OhmPh2ls36Ic9psInvE4oweZbAV8x5mbPBY",
  "seller_fee_basis_points": 0,
  "properties": {
    "creators": [
      { "address": "E5mQ27muTebiYaohBsdsCwrvPN3MVoRmECFtL4A5Sx9q", "share": 100 }
    ]
  },
  "collectionDetails": {
    "V1": { "size": 0 }
  }
}
```

**Unsized metadata (no `collectionDetails` field):**

```json
{
  "name": "Token Toss UGC Level",
  "symbol": "TTLC",
  "description": "Reference JSON that OGAL treats as unsized because it lacks collectionDetails.",
  "image": "https://arweave.net/rVYCmcN0OhmPh2ls36Ic9psInvE4oweZbAV8x5mbPBY",
  "seller_fee_basis_points": 0,
  "properties": {
    "creators": [
      { "address": "E5mQ27muTebiYaohBsdsCwrvPN3MVoRmECFtL4A5Sx9q", "share": 100 }
    ]
  }
}
```

## Operational Tips

### Converting an Unsized Collection to Sized

Follow this workflow when you need to migrate an already-minted unsized collection without disrupting OGAL operations:

1. **Reclaim update authority.** Use Metaplex's `SetAuthority` instruction (accounts: metadata account, current update authority signer, `CollectionAuthorityRecord` PDA if delegated, and the OGAL PDA as the authority you are revoking) so the collections team regains control long enough to edit metadata. Pause live mints before rotating authority to avoid failed verifications while OGAL is offline.
2. **Fetch the current metadata state.** Export the existing JSON via the Metaplex CLI, JS SDK, or a direct `getAccountInfo` call. Archive the `data` payload so you can preserve descriptions, external links, and any custom fields when you apply the update.
3. **Add `collection_details` with an initial size.** Submit `UpdateMetadataAccountV2` (accounts: metadata account, authority signer you reclaimed in step 1, payer, and the Token Metadata program) and extend the data struct with `{ "collectionDetails": { "V1": { "size": <current supply> } } }`. This is also the ideal point to raise the size above the current minted total so OGAL can continue incrementing it. The instruction must include the Metaplex `Instructions` sysvar account; OGAL mints will require the same sysvar going forward.
4. **Return authority to OGAL.** Re-run `SetAuthority`, this time transferring the update authority back to the OGAL PDA documented for your environment. Coordinate the hand-off with the operations team so no mint attempts run while the authority is mid-rotation.
5. **Re-verify the collection.** Invoke OGAL's inspector script (`node solana/owner-governed-asset-ledger/scripts/inspect-collection.js --mint <collection-mint>`) to confirm the new `collection_details.size` value and updated authority. Optionally submit a no-op `VerifySizedCollectionItem` transaction against a known mint to validate Metaplex accepted the sized metadata.

After conversion, **all mint flows must supply the `Sysvar1nstructions1111111111111111111111111` account** (for example with `npm run mint-object -- --include-instructions-sysvar ...`). Schedule a post-change validation window to run the inspector script and a test mint so you can catch regressions before reopening public mints.

> ⚠️ **Operational warning:** Coordinate the conversion during a maintenance window or while live mints are paused. Attempting to mint while the authority is reclaimed or before clients add the Instructions sysvar will cause transactions to fail with `InvalidAccountIndex` or Metaplex authority errors.

- **Authority management:** OGAL requires custody of the update authority to verify new mints. Use the rotation scripts in `collection-authority-rotation.md` whenever you swap authorities between staging and production.
- **Monitoring:** Keep `mint_object_nft-instructions.md` handy for the precise account order OGAL expects. Mismatched account lists are the most common source of sysvar-related transaction failures.

By following these recipes, you can choose the collection sizing model that best fits your operational requirements while ensuring OGAL mints succeed on the first attempt.
