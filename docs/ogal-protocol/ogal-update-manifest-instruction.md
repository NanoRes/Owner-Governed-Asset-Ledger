# OGAL `update-manifest` Transaction Instruction Breakdown

## Overview

The `update-manifest` CLI script produces a single on-chain instruction, `update_object_manifest`, encapsulated in a one-instruction transaction sent to the Owner-Governed Asset Ledger (OGAL) program. All client-side activity—deriving program-derived addresses (PDAs), validating inputs, and serializing data—prepares for that instruction. Once the transaction is submitted, the OGAL program enforces its invariants before updating the manifest account and emitting a `ManifestUpdated` event.

## Instruction Construction (`update_object_manifest`)

The client assembles the instruction data as four serialized components:

1. **8-byte discriminator** for the `update_object_manifest` entry point (Anchor selector).
2. **32-byte manifest hash** (hex decoded).
3. **Length-prefixed UTF-8 metadata URI** (4-byte little-endian length followed by bytes).
4. **1-byte `is_active` flag** (`0` or `1`).

The instruction references ten accounts:

| Account | Role | Constraints |
| --- | --- | --- |
| `owner` | Transaction fee payer and signer | Must hold the NFT represented by `owner_token_account`. |
| `config` | OGAL configuration PDA | Derived from the seeds `[CONFIG_SEED, namespace]`. |
| `auth` | Registry mint authority PDA | Derived from `[AUTH_SEED, config]` and authorizes the metadata CPI. |
| `object_manifest` | Manifest PDA to update | Must already be initialized and match the config and mint. |
| `object_mint` | Mint PDA | Derived from `[MINT_SEED, manifest]` and must match the manifest record. |
| `owner_token_account` | Associated Token Account | Belongs to `owner` and holds the NFT. |
| `object_metadata` | Metaplex metadata PDA | Derived from `["metadata", TOKEN_METADATA_PROGRAM_ID, mint]` and updated in-place. |
| `metadata_program` | Metaplex token metadata program | Must equal `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`. |
| `rent` | Rent sysvar | Must equal `SysvarRent111111111111111111111111111111111`. |
| `instructions` | Instructions sysvar (optional) | Must equal `Sysvar1nstructions1111111111111111111111111` when provided. |

All accounts are writable except the mint, token account, metadata program, rent sysvar, and instructions sysvar. The metadata PDA remains writable so the CPI can update its URI.

## Preflight Derivations and Validations

Prior to dispatching the instruction, the CLI performs several validations:

* **Option parsing** – Coerces namespace, object ID, mint, manifest hash, metadata URI, and active flag into the correct numeric, hexadecimal, and boolean forms.
* **Metadata length enforcement** – Rejects URIs longer than 128 characters to align with the program's `MAX_URI_LENGTH`.
* **PDA derivations** – Calculates and optionally checks bumps for the config, manifest, and mint PDAs, erroring when caller-supplied expectations disagree.
* **Token account resolution** – Determines the owner's token account, defaulting to the associated token account derived from the wallet and mint unless explicitly overridden.

These preflight steps ensure the transaction references the canonical OGAL accounts and prevents targeting incorrect mints or manifests.

## On-chain Execution Logic

When Solana executes `update_object_manifest`, the OGAL program enforces the following safeguards before mutating state:

1. **Metadata length limits** – Enforces both `MAX_URI_LENGTH` and Metaplex's `METADATA_MAX_URI_LENGTH`.
2. **Ownership and balance checks** – Confirms the provided token account belongs to the signer, targets the correct mint, and holds at least one token (proving the caller owns the NFT).
3. **Manifest PDA integrity** – Validates that the manifest account derives from expected seeds, uses the recorded bump, is initialized, and references the same config and mint.

Only after these validations does OGAL update the manifest hash, metadata URI, and active flag, subsequently emitting a `ManifestUpdated` event containing the config, manifest address, mint, object ID, and new status.

## Transaction Submission

Finally, the client wraps the instruction in a transaction, sets the owner as the fee payer, fetches a recent blockhash, and calls `sendAndConfirmTransaction`. Logging hooks surface derived accounts, the success signature, or failure logs to aid operators in monitoring or debugging submissions.

## Summary

Although the CLI executes significant client-side validation, the on-chain transaction itself contains a single instruction: `update_object_manifest`. The OGAL program re-validates critical invariants, updates the manifest record, and emits telemetry so downstream systems can track manifest changes.
