# OGAL Current-Source Threat Model

## Status and scope

This is a source-only threat inventory for repository commit `83b3436be62d5e187e1c87bf448a80b29c5a7d1e`, tree `f14290d84896985da72abc697baf153255b782ab`. It covers observable behavior in `lib.rs` and known documentation gaps. It does not certify security, choose new architecture, authorize remediation, or validate any deployment or external integration.

Runtime, chain, provider, wallet, key-management, dependency, build, and production evidence were not examined for this candidate. All mitigations below are review directions; they are not approved implementation requirements.

## Protected assets and properties

- Namespace config authority and pause state
- Deterministic config, auth, manifest, and object-mint relationships
- Object ID, mint, creator, manifest hash, metadata URI, and active-state integrity
- Collection metadata authority and verification relationships
- Correct creator metadata and seller fee metadata
- Accurate event and account interpretation
- Separation of token possession from legal rights and product entitlement
- Separation of metadata from payout, accounting, custody, and settlement
- Honest deployment, integration, licensing, and public-good claims

## Trust boundaries

| Boundary | Current source posture |
| --- | --- |
| Transaction signers to OGAL | Anchor signer constraints apply per instruction; `mint_object_nft.authority` is not a signer |
| OGAL to SPL Token | CPI creates or validates mint and associated token accounts, then mints one unit |
| OGAL to Metaplex | CPI creates metadata and master edition, verifies a collection, updates metadata URI, and rotates collection update authority |
| On-chain manifest to URI content | OGAL stores a hash and URI; it does not fetch, validate content safety, ensure availability, or enforce privacy |
| Events to consumers | Only three events exist; consumers must reconcile account state and handle RPC semantics outside OGAL |
| Source to deployment | Source configuration is not evidence of deployed bytecode, chain state, or upgrade authority |
| OGAL to external products | Gameplay, identity, privacy, custody, economy, business policy, and public claims are externally owned |
| Documentation to authority | Documentation is supporting source; only Human acceptance can close gates |

## Actors

- Current namespace authority signer
- Transaction payer and prospective minter
- Object token holder and manifest updater
- Metadata creator signer
- Recipient
- External client or script operator
- Indexer, dashboard, auditor, or application reader
- Malicious or mistaken caller
- Compromised authority or holder credential
- Documentation reader relying on unverified public claims

## Current controls

- Deterministic PDA derivation and relationship checks
- Stored-authority signer checks for authority transfer, collection rotation, namespace migration, and pause changes
- Dual signer requirement for initialization, plus payer equality or `ALLOWED_DEPLOYERS` check
- Pause check for minting
- Object manifest identity, hash, URI, mint, and active-state checks during mint
- Positive token balance and owner checks for manifest updates
- Creator count, share total, manifest-creator presence, verified-creator signature, and seller fee bounds on first mint
- Expected Metaplex program and metadata PDA checks
- Sized and unsized collection verification branches
- URI and metadata length limits
- Three emitted events for mint, manifest update, and pause change

These controls are source observations only. Their deployment parity and runtime effectiveness are unverified.

## Threats and open gaps

### TM-001: Unresolved mint admission

- Scenario: Any payer can supply the stored authority public key as the unchecked `authority` account without that authority signing.
- Current control: Config `has_one` validates the authority key; the payer must sign and fund account creation.
- Open gap: The source does not establish whether permissionless payer-funded minting is intended or whether an authority signature is missing.
- Impact: Unauthorized or abusive namespace minting, operational surprise, or client-policy divergence.
- Linked risks: `OGAL-RISK-001`, `OGAL-RISK-010`.
- Required gate: Human product decision followed by independent security review; any code change is separately authorized.

### TM-002: Authority compromise, loss, or mistaken transfer

- Scenario: The stored authority credential is compromised or lost, or `set_authority` assigns an unintended public key.
- Current control: Current authority signature is required for authority transfer and privileged namespace actions.
- Open gap: No multisignature, timelock, successor acceptance, recovery, or rollback mechanism is defined in the program.
- Impact: Loss or misuse of pause, migration, collection-rotation, and authority-transfer control.
- Linked risks: `OGAL-RISK-009`, `OGAL-RISK-010`.
- Required gate: Human governance and security design; no control is implied by this inventory.

### TM-003: Possession is mistaken for legal or product authority

- Scenario: A holder with a positive token balance updates a manifest, and an integration interprets that ability as copyright, license, entitlement, gameplay possession, custody, or legal ownership.
- Current control: The program limits the update to a matching holder token account and preserves object identity.
- Open gap: No legal-rights registry, license reference, application entitlement, custody model, dispute process, or recovery policy exists.
- Impact: Unauthorized use, conflicting claims, product access errors, or legal misrepresentation.
- Linked risk: `OGAL-RISK-005`.
- Required gate: Separate Human-approved legal and product policy at an immutable integration pin.

### TM-004: Creator metadata is mistaken for payout execution

- Scenario: Creator shares and seller fee basis points are presented as guaranteed revenue allocation or fair-share payment.
- Current control: First mint validates creator-list presence, count, total shares, verified signatures, and the seller fee upper bound.
- Open gap: OGAL implements no calculation, custody, distribution, reconciliation, accounting, tax, refund, dispute, or settlement behavior.
- Impact: False economic expectations and incompatible downstream accounting.
- Linked risk: `OGAL-RISK-004`.
- Required gate: Separate Human economic, legal, custody, and settlement authority.

### TM-005: Mutable URI content, privacy leakage, or unsafe content

- Scenario: A permitted holder changes the manifest hash and URI; the target content is unavailable, malicious, privacy-sensitive, or inconsistent with a consumer's schema.
- Current control: URI length and possession checks apply; the hash and URI are recorded.
- Open gap: The program does not fetch content, enforce a schema, moderate content, validate availability, scan content, classify privacy, or define correction and dispute handling.
- Impact: Client compromise, content unavailability, privacy disclosure, inconsistent rendering, or abuse.
- Linked risks: `OGAL-RISK-005`, `OGAL-RISK-010`.
- Required gate: Product-specific content, privacy, moderation, and retrieval policies outside neutral OGAL behavior.

### TM-006: Collection authority or metadata state mismatch

- Scenario: The collection metadata account has an unexpected update authority, wrong PDA relationship, invalid form, or incompatible sized or unsized state.
- Current control: The program derives expected metadata addresses, verifies the token metadata program, signs with the auth PDA, and branches for sized or unsized verification.
- Open gap: Current collection chain state, tool behavior, deployment parity, and operational recovery were not verified.
- Impact: Mint failure, incorrect operational assumptions, or unintended collection authority changes if external procedures are wrong.
- Linked risks: `OGAL-RISK-002`, `OGAL-RISK-008`, `OGAL-RISK-010`.
- Required gate: Separately authorized chain, deployment, tool, and runbook verification.

### TM-007: Namespace migration creates split routing

- Scenario: New config and auth PDAs are created while existing manifests remain tied to the old config; clients disagree about which namespace is current.
- Current control: Only the current authority can migrate; selected config state is copied deterministically.
- Open gap: No continuity, redirect, discovery, deprecation, version negotiation, event, or rollback contract exists.
- Impact: Orphaned discovery, stale clients, inconsistent updates, incomplete audit trails, or failed mint and update flows.
- Linked risks: `OGAL-RISK-006`, `OGAL-RISK-007`, `OGAL-RISK-012`.
- Required gate: Human-approved protocol and client migration contract with independent evidence.

### TM-008: Incomplete event history and read-contract ambiguity

- Scenario: An indexer treats the three events as a complete and final governance timeline or misses, duplicates, or reorders observations.
- Current control: Mint, manifest update, and pause actions emit structured events; accounts remain queryable.
- Open gap: Initialization, authority transfer, collection rotation, and migration emit no OGAL event. Finality, replay, reorganization, deduplication, pagination, freshness, and reconciliation semantics are undefined.
- Impact: Incorrect audit, dashboard, governance, or product state.
- Linked risks: `OGAL-RISK-006`, `OGAL-RISK-012`.
- Required gate: Accepted read contract and independently tested indexer behavior.

### TM-009: Resource exhaustion and mint spam

- Scenario: Untrusted callers submit repeated payer-funded mint attempts, create many manifests, choose costly metadata inputs within limits, or force integrations to process excessive account and event volume.
- Current control: The payer funds account creation; length and creator limits exist; minting can be paused by the authority.
- Open gap: Admission intent is unresolved, no rate or quota policy is implemented, and the pause flag affects minting only.
- Impact: Namespace pollution, monitoring load, operational cost, or denial of service in dependent systems.
- Linked risks: `OGAL-RISK-001`, `OGAL-RISK-010`, `OGAL-RISK-012`.
- Required gate: Separate abuse and capacity review; this record proposes no mechanism.

### TM-010: Repeated mint invocation and external account state

- Scenario: An initialized manifest marked minted is submitted to `mint_object_nft` again.
- Current control: First-mint metadata and master-edition work is skipped when `minted` is true; identity, activity, hash, URI, and token-account checks still apply.
- Open gap: The function still reaches a one-unit `mint_to` call. The actual later-call outcome depends on mint authority and Metaplex account state; it was not dynamically tested in this reconciliation.
- Impact: Failed transactions, integration confusion, or an incorrect supply assumption if deployed behavior differs from expectations.
- Linked risk: `OGAL-RISK-010`.
- Required gate: Independent security analysis and separately authorized test evidence before any supply claim.

### TM-011: External source and IDL mismatch

- Scenario: A client follows a stale `solana/` path, assumes a tracked IDL exists, or uses absent Unity source without a verified owner and immutable pin.
- Current control: The reconciled documents name the actual local program path and label missing or external artifacts.
- Open gap: External source compatibility, generated IDL parity, release status, and product integration remain unverified.
- Impact: Wrong discriminators, account layouts, program IDs, transaction construction, or public claims.
- Linked risks: `OGAL-RISK-002`, `OGAL-RISK-008`.
- Required gate: Separate source clearance and interface evidence for every external repository and generated artifact.

### TM-012: Source configuration is mistaken for deployment truth

- Scenario: Matching program IDs in `lib.rs` and `Anchor.toml`, or a configured mainnet cluster, is used as proof of deployed bytecode and a live production service.
- Current control: Reconciled documentation classifies these values as source configuration.
- Open gap: No chain query, build provenance, bytecode match, upgrade-authority check, namespace evidence, release record, or current product evidence was accepted.
- Impact: Users rely on an unverified program or service; security and operational responsibilities are misstated.
- Linked risks: `OGAL-RISK-002`, `OGAL-RISK-003`.
- Required gate: Human-authorized deployment and release evidence review.

## Explicitly absent decisions

This threat model does not decide mint admission, authority architecture, recovery, multisignature, timelock, migration design, indexing rules, content policy, licensing, public-good service, deployment, economics, custody, settlement, token policy, or public claims. It does not authorize code, test, dependency, IDL, script, generated-output, wallet, provider, chain, deployment, or external-product changes.
