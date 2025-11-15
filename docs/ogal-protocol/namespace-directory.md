# OGAL Namespace Directory

This directory records every namespace that uses the shared Owner-Governed Asset
Ledger deployment. Update the table whenever a new experience launches or an
existing namespace migrates to fresh PDAs.

| Namespace | Namespace Public Key | Maintainer | Asset Format | Experience | Notes |
| --------- | -------------------- | ---------- | ------------ | ---------- | ----- |
| Token Toss UGC Levels | `3Bc5ARkDGM2ZdAe8EjwHMmNrXvpSzQVcPug7MSp4Qhbw` | Ghiblify Games (NanoRes Studios) | JSON level descriptors hashed by the editor | Token Toss (player-created levels) | Collection mint `EhULHuQtpaKUZSdv1kQR7XwYGRfEaU8b1Y7JkbFGQHxW`; OGAL mint authority `G7skWhSjK6oskMKMuCbVuRQSVvrhc1VN1nQYLHR8ewL5`. |

## Namespace details

- **Content pipeline** – Levels are saved as deterministic JSON files so the game
  can rebuild each minted layout at runtime.【F:docs/ogal-protocol/mint-signature-changes.md†L7-L28】
- **Program constants** – Program ID `GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx`,
  config PDA `5bhVoogdhY5VYuLuUuMXaiNrvP4zbmP1wNWstUUvmiF5`, and registry authority
  `E5mQ27muTebiYaohBsdsCwrvPN3MVoRmECFtL4A5Sx9q` are published in the Unity
  configuration asset used by production builds.【F:owner-governed-asset-ledger/README.md†L200-L207】
- **Collection management** – The namespace verifies mints against collection
  `EhULHuQtpaKUZSdv1kQR7XwYGRfEaU8b1Y7JkbFGQHxW`, rotating authority between the
  mint-authority PDA and a maintenance wallet during metadata updates.【F:docs/ogal-protocol/collection-authority-rotation.md†L26-L109】

## Adding a new namespace

1. Initialize the namespace following the steps in the repository README.
2. Record the namespace public key, derived config PDA, mint-authority PDA, and
   collection mint in the table above.
3. Document the asset format and any schema links so other teams understand how
   to consume the manifests.
4. Submit a pull request including this file and any new runbooks or references
   needed for the experience.
