# OGAL `mint_object_nft` Transaction Instruction Breakdown

## Transaction Layout
- The client constructs a single-instruction transaction targeting the OGAL program's `mint_object_nft` entrypoint.
- Serialized data includes the discriminator, object identifier, manifest URI/hash, metadata name and symbol, seller fee basis points, and the creator array.
- Required programs and accounts include OGAL, SPL Token, SPL Associated Token, Metaplex Metadata, Rent, and the optional Instructions sysvar. Verified creator signer PDAs are added to the instruction's remaining accounts to support CPI signature requirements.

## Accounts and Data
- Anchor structures the accounts into two groups: `MintObjectNftBase` and `MintObjectNftMetadata`.
  - `MintObjectNftBase` covers the authority, config, auth PDAs, payer, manifest PDA, mint PDA, recipient associated token account, recipient wallet, and core programs (Token, Associated Token, System).
  - `MintObjectNftMetadata` includes the Metaplex metadata PDA, master edition PDA, collection mint, and the token metadata program.
- Remaining accounts supply the collection metadata PDA, collection master edition PDA, rent sysvar, optional instructions sysvar, and any extra creator signer accounts in that order.
- OGAL validates PDA seeds, minting pause status, and sysvar availability before executing downstream logic.

## Internal Instruction Sequence
1. **Ensure object manifest account exists**: Calls `ensure_object_manifest_account`, issuing a System Program `create_account` CPI when the manifest PDA is empty, or topping up rent and reallocating while enforcing OGAL ownership if it already exists.
2. **Ensure object mint exists**: Invokes `ensure_object_mint_account`, which may create the mint PDA via `create_account`, then runs SPL Token's `initialize_mint2` with the OGAL `auth` PDA as mint and freeze authority, validating ownership and rent if already initialized.
3. **Ensure recipient ATA exists**: Uses the SPL Associated Token Program's `create` instruction to create the recipient's associated token account when missing, otherwise verifies the ATA is owned by the SPL Token program.
4. **First-mint metadata creation (conditional)**: Loads the manifest to determine whether this is the first mint. On first mint, OGAL validates metadata inputs, ensures creator shares total 100 with the manifest creator included, recomputes Metaplex PDAs, and calls Metaplex's `CreateMetadataAccountV3` CPI. Verified creator accounts are forwarded to satisfy signature checks.
5. **Mint the NFT**: Performs SPL Token's `mint_to` CPI, signed by the OGAL `auth` PDA (`[AUTH_SEED, config, auth.bump]`), to deposit exactly one token into the recipient's ATA.
6. **First-mint master edition (conditional)**: On the first mint, OGAL calls Metaplex's `CreateMasterEditionV3` CPI to fix the supply at zero, ensuring a one-of-one NFT under OGAL control.
7. **First-mint collection verification (conditional)**: Determines whether the collection is sized and calls either `VerifySizedCollectionItem` or `VerifyCollection` via Metaplex CPI, registering the NFT as part of the collection with the OGAL `auth` PDA as authority.

## Post-Instruction Bookkeeping
- After successful CPIs, OGAL marks the manifest as minted and emits an `ObjectMinted` event containing the config, manifest, mint, recipient, and object identifier for downstream indexers.
- Subsequent mints skip metadata, master edition, and collection verification steps because the `was_minted` flag prevents them from re-running.
