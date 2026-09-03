# OGAL Collection Update-Authority Rotation Boundary

## Source status

This guide describes `rotate_collection_authority` at repository commit `83b3436be62d5e187e1c87bf448a80b29c5a7d1e`, tree `f14290d84896985da72abc697baf153255b782ab`. It is not evidence of current collection state, a mainnet deployment, a production namespace, or an accepted operational runbook.

## Implemented instruction

The instruction requires:

- the current stored config authority signer;
- the config PDA;
- the auth PDA associated with that config;
- the mutable collection metadata account;
- the collection mint; and
- the Metaplex token metadata program.

The program verifies the Metaplex program ID, derives the expected collection metadata PDA from the collection mint, and requires the supplied metadata account to match. It then signs a Metaplex `UpdateMetadataAccountV2` CPI with auth PDA seeds and supplies the requested new update authority.

The instruction emits no OGAL event. Any audit process must inspect external Metaplex observations or account state under a separately accepted read contract.

## Authority direction

When a normal wallet is the current collection update authority, an external wallet tool may be able to assign another update authority. When the OGAL auth PDA is the current update authority, a normal wallet cannot sign as that PDA; the OGAL program instruction is the source path that can sign with its PDA seeds, provided the stored config authority authorizes the instruction.

This description does not verify any external tool version, command syntax, wallet, collection, network, or deployment. External tool use requires separate source, release, security, wallet, provider, and chain authorization.

## Carried historical values

Historical documentation carried the following values:

| Claimed role | Carried value | Status |
| --- | --- | --- |
| Collection mint | `EhULHuQtpaKUZSdv1kQR7XwYGRfEaU8b1Y7JkbFGQHxW` | `PUBLIC_CLAIMS_ONLY_UNVERIFIED` |
| OGAL mint-authority PDA | `G7skWhSjK6oskMKMuCbVuRQSVvrhc1VN1nQYLHR8ewL5` | `PUBLIC_CLAIMS_ONLY_UNVERIFIED` |
| Maintenance or registry authority wallet | `E5mQ27muTebiYaohBsdsCwrvPN3MVoRmECFtL4A5Sx9q` | `PUBLIC_CLAIMS_ONLY_UNVERIFIED` |

These public keys are not secrets, but their current roles and relationships were not checked against chain state. They must not be represented as current production truth without separately accepted evidence.

## Local and external tooling

- `owner-governed-asset-ledger/scripts/rotate-collection-authority.js` and `inspect-collection.js` exist as local supporting source.
- Historical `solana/owner-governed-asset-ledger/...` paths are incorrect for this repository.
- Historical `Assets/Solana_Toolbelt/...` paths refer to external Unity source that is absent here; its exact owner and immutable pin are unverified in this repository.
- A tracked Anchor IDL is absent.

No dependency was installed and no script, build, test, wallet, provider, or chain interaction supports this source candidate.

## Operational risks

- A mismatched collection metadata PDA or Metaplex program is rejected by source checks.
- A current update authority that differs from the auth PDA can prevent auth-PDA-signed updates.
- Rotation can affect later collection verification and mint attempts.
- There is no OGAL rotation event.
- Authority recovery, multisignature, timelock, successor acceptance, and rollback rules are undefined.

## Required Human gate

Any rotation requires separate Human authorization for the exact network, program deployment, namespace, config, collection mint, current authority, target authority, wallet, provider, tool version, evidence capture, rollback plan, and public claim. This source document does not authorize a transaction.
