# OGAL Namespace Migration Source Boundary

## Implemented behavior

At source commit `83b3436be62d5e187e1c87bf448a80b29c5a7d1e`, `migrate_config_namespace(new_namespace)` requires the current stored authority signer. The signer also pays to initialize a new config PDA and a new auth PDA.

The instruction copies these values from the old config:

- authority;
- object count; and
- pause state.

It records the new namespace and new PDA bump values; the new auth account points to the new config.

## Behavior not implemented

The instruction does not:

- change the old config or auth account;
- move, clone, or rewrite existing object manifests;
- move or rewrite object mints, metadata, token accounts, or collection state;
- create a redirect between namespaces;
- emit an OGAL migration event;
- establish asset discovery across old and new configs;
- define schema or protocol version negotiation;
- deprecate the old namespace;
- define rollback; or
- update any external client, dashboard, service, or Unity asset.

Existing manifests remain associated with the original config PDA. A new config uses a different config key in future manifest derivations even if its copied object count matches the old config.

## Continuity status

The migration instruction is a config-copy primitive; it is not a complete continuity protocol. Documentation must not claim that it preserves complete manifest, mint, event, client, or governance continuity.

A sequence such as pause, rotate collection authority, migrate, update clients, and resume is an operational proposal only. It has no accepted versioning, deprecation, finality, evidence, or rollback contract in this repository.

## External integrations

Historical Unity types and `Assets/` paths are absent from this repository. Their owning source and immutable pin are unverified here. The local script `owner-governed-asset-ledger/scripts/migrate-namespace.js` is present as supporting client source; it is not evidence of a successful migration or compatibility with an external product.

## Required Human gate

Before operational use, a Human must separately accept:

- the migration objective and namespace ownership;
- old and new account inventories;
- manifest and mint discovery rules;
- client-version compatibility and cutover behavior;
- deprecation and rollback rules;
- missing event and read-contract treatment;
- external integration pins;
- security review and test evidence; and
- chain, provider, wallet, deployment, and release authority.

This document grants none of those authorities.
