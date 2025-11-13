# Troubleshooting OGAL mint failures

When the Owner-Governed Asset Ledger (OGAL) mint transaction fails, gather the
serialized transaction and replay it against an RPC node to inspect the on-chain
logs. The Unity client now emits this data automatically, making it easier to
pin down issues such as `custom program error: 0x65`.

## 1. Capture the serialized transaction

Whenever `OwnerGovernedAssetLedgerService` receives an RPC error while sending a
mint request it logs the transaction payload in base64:

```
[OwnerGovernedAssetLedgerService] Mint transaction failed to send. reason='...'
[OwnerGovernedAssetLedgerService] Serialized mint transaction (base64) for debugging:
BASE64_PAYLOAD
[OwnerGovernedAssetLedgerService] Reproduce locally with: solana transaction simulate 'BASE64_PAYLOAD' --sig-verify --url <RPC_URL>
```

If you are handling the exception yourself, you can also read the same base64
string from `OwnerGovernedAssetLedgerException.DebugContext`.

## 2. Replay the transaction with the Solana CLI

Use the Solana CLI (v1.18 or newer) to run a local simulation:

```bash
solana transaction simulate 'BASE64_PAYLOAD' \
  --sig-verify \
  --url https://api.mainnet-beta.solana.com
```

Replace `BASE64_PAYLOAD` with the logged value and choose the RPC endpoint that
matches the cluster you are targeting. The command prints the full log stream
for each instruction so you can see which program returned the error.

## 3. Inspect the simulation logs

Focus on the log segment for `Instruction 2`—that is where the OGAL program
invokes Metaplex's token metadata program to verify the collection. A failing
collection verification usually reports `custom program error: 0x65`. Common
culprits include:

- The collection metadata still lists the legacy studio wallet as the update
  authority instead of the OGAL mint-authority PDA.
- The collection is intentionally controlled by the developer wallet while the
  team resizes the collection (see `collection-authority-rotation.md`).
  Mints will return `custom program error: 0x65` until the authority is rotated
  back to the OGAL mint-authority PDA.
- The on-chain OGAL program has not yet been upgraded to the release that falls
  back to `VerifyCollection` for unsized collections. In the Unity console, this
  scenario also logs a warning that the collection metadata is unsized.

Use the earlier simulation logs and the collection metadata helper script in
[`collection-authority-rotation.md`](collection-authority-rotation.md) to confirm the current update authority and
collection sizing state.

If the logs surface `custom program error: 0x51 (Collection Update Authority is invalid)`, the namespace submitted to `mint_object_nft`
does not own the collection. The Metaplex program compares the collection NFT’s update authority against the namespace’s derived `auth` PDA, so mints
fail when a different namespace—or an off-protocol wallet—still controls the collection. Rotate the update authority back to the active namespace using the
helper documented in [`collection-authority-rotation.md`](collection-authority-rotation.md) and retry the mint once the PDA owns the collection again.

## 4. Share the payload when asking for help

If you need to escalate the issue, include the base64 transaction (or the
`DebugContext` value) and the simulation output. This information allows another
engineer to reproduce the failure quickly without having to recreate the exact
Unity client state.
