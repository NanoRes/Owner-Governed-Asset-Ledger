# OGAL Risk Register

## Register status

This register is a source-only reconciliation candidate for repository commit `83b3436be62d5e187e1c87bf448a80b29c5a7d1e`, tree `f14290d84896985da72abc697baf153255b782ab`. Every risk is open. Recording a mitigation or evidence need does not authorize implementation, external access, deployment, licensing, public claims, or acceptance.

## OGAL-RISK-001: Mint-admission authority intent is ambiguous

- Status: `OPEN_HUMAN_DECISION_REQUIRED`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: A payer invokes `mint_object_nft` with the stored authority public key as the unchecked non-signer account; the stored authority does not sign.
- Consequence: Namespace mint admission may be permissionless when restricted minting was intended, or integrations may wrongly require a signature the program does not require.
- Mitigation: Preserve the current behavior as documented; obtain a Human product decision and an independently reviewed security specification before any code change or activation.
- Evidence need: Written mint-admission intent, abuse analysis, exact proposed source diff if behavior changes, tests, independent security review, and migration or rollout evidence.
- Acceptance or closure authority: Human protocol authority after separate product and security gates.

## OGAL-RISK-002: Mainnet and live-product claims lack accepted evidence

- Status: `OPEN_EVIDENCE_REQUIRED`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: A document or public surface represents the configured program ID, Token Toss, namespace, authority, collection, or production status as currently verified.
- Consequence: Users may rely on a deployment or integration that was not matched to reviewed source, current chain state, or a current product release.
- Mitigation: Classify every such statement as `PUBLIC_CLAIMS_ONLY_UNVERIFIED`; require separately authorized chain, build, release, and integration evidence before promotion.
- Evidence need: Deployed-bytecode match, upgrade-authority state, namespace and collection account evidence, transaction evidence, production build provenance, integration pin, and current release acceptance.
- Acceptance or closure authority: Human deployment and release authority after independent evidence review.

## OGAL-RISK-003: License and public-good service profile are undefined

- Status: `OPEN_LEGAL_AND_SERVICE_DECISION_REQUIRED`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: Source visibility or public-good language is treated as permission to reuse, a license grant, guaranteed access, fee policy, support promise, portability promise, or anti-capture rule.
- Consequence: Legal rights and service expectations may be misstated; maintainers and adopters may assume obligations or permissions that do not exist.
- Mitigation: State that no repository license file or accepted public-good service profile exists; keep license selection and service policy outside this candidate.
- Evidence need: Human-approved legal review, exact license decision, service scope, operating-cost and fee policy, availability and support terms, upgrade governance, admission policy, portability, and exit terms.
- Acceptance or closure authority: Human legal and public-good service authority.

## OGAL-RISK-004: Creator-share metadata may be represented as payout enforcement

- Status: `OPEN_DOCUMENTATION_AND_INTEGRATION_RISK`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: Creator shares totaling 100 or seller fee basis points are described as fair-share, revenue distribution, royalty payment, accounting, or settlement execution.
- Consequence: Creators or integrators may expect revenue calculation, custody, distribution, reconciliation, or guarantees that the program does not implement.
- Mitigation: Describe the fields only as Metaplex metadata constraints; route any economic or settlement system to a separately governed source.
- Evidence need: Source-to-document review plus separately accepted economic, accounting, custody, tax, dispute, and settlement specifications for any future payout claim.
- Acceptance or closure authority: Human economic and legal authority after independent source and policy review.

## OGAL-RISK-005: Token possession may be represented as legal rights or entitlement

- Status: `OPEN_DOCUMENTATION_AND_PRODUCT_POLICY_RISK`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: The positive-balance token check for manifest updates is described as copyright, license, commercial-use permission, application entitlement, gameplay possession, legal ownership, equity, or a settlement right.
- Consequence: Users and products may apply rights or access policies that are absent from the reviewed program.
- Mitigation: Keep possession-based update authority separate from legal rights, application policy, gameplay, identity, custody, and settlement.
- Evidence need: Product-specific entitlement contract, legal rights terms, custody model, transfer and recovery rules, and accepted integration source at immutable pins.
- Acceptance or closure authority: Human legal and product-policy authority.

## OGAL-RISK-006: Event documentation may overstate audit completeness

- Status: `OPEN_OBSERVABILITY_GAP`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: The three implemented events are described as a complete governance or lifecycle timeline.
- Consequence: Indexers and auditors may miss authority transfer, collection rotation, namespace migration, initialization, or other state transitions.
- Mitigation: Limit event claims to `ObjectMinted`, `ManifestUpdated`, and `PauseStatusUpdated`; identify missing events and require state reconciliation.
- Evidence need: Accepted event contract, indexer coverage, state-diff strategy, replay tests, and evidence for any later event additions.
- Acceptance or closure authority: Human protocol and auditability authority after independent source review.

## OGAL-RISK-007: Namespace migration lacks continuity and rollback rules

- Status: `OPEN_PROTOCOL_AND_CLIENT_CONTRACT_GAP`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: `migrate_config_namespace` is used or documented as preserving complete asset continuity.
- Consequence: Existing manifests remain bound to the old config while new clients may point at the new config; discovery, updates, routing, deprecation, and rollback can diverge.
- Mitigation: Document the exact copied fields and unchanged assets; require a separate continuity, versioning, deprecation, client negotiation, and rollback decision before operational use.
- Evidence need: Accepted migration contract, old and new state inventory, client compatibility plan, redirect or discovery semantics, rollback plan, and independently reviewed test evidence.
- Acceptance or closure authority: Human protocol and release authority.

## OGAL-RISK-008: Canonical guides reference absent or unpinned sources

- Status: `OPEN_PROVENANCE_GAP`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: A local guide treats `solana/owner-governed-asset-ledger`, a tracked Anchor IDL, or `Assets/` Unity paths as present in this repository.
- Consequence: Integrators may follow nonexistent paths or rely on external source whose owner, version, compatibility, and review status are unknown.
- Mitigation: Use the actual local workspace path; label the IDL absent; classify Unity and product paths as external and unverified until their owning repository and immutable pin are accepted.
- Evidence need: Repository inventory, external owner declaration, exact commit and tree, source clearance, interface compatibility review, and release provenance.
- Acceptance or closure authority: Human source-governance authority after independent cross-repository review.

## OGAL-RISK-009: Authority recovery and successor controls are undefined

- Status: `OPEN_GOVERNANCE_AND_SECURITY_GAP`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: An authority key is lost, compromised, transferred incorrectly, or expected to use multisignature, timelock, successor acceptance, or recovery controls.
- Consequence: A namespace can lose governance continuity or accept an unintended authority without an in-program recovery or acceptance process.
- Mitigation: Do not imply controls that are absent; require a separate governance and security design before changing authority behavior or operational policy.
- Evidence need: Threat analysis, key-management policy, recovery and compromise procedure, successor acceptance rule, rollback plan, source changes if any, and independent security review.
- Acceptance or closure authority: Human protocol, operations, and security authority.

## OGAL-RISK-010: Security, abuse, privacy, and denial-of-service posture is not accepted

- Status: `OPEN_SECURITY_REVIEW_REQUIRED`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: The program or an integration is activated, exposed to untrusted callers, or represented as secure without an accepted threat model and remediation record.
- Consequence: Mint spam, metadata abuse, authority compromise, denial of service, privacy leakage, malformed external content, or integration failures may remain untreated.
- Mitigation: Use the current-source threat model only as a candidate inventory; conduct a separately authorized security review and gate remediation and activation independently.
- Evidence need: Independent threat review, abuse cases, severity and likelihood assessment, test evidence, dependency and deployment review, remediation diffs, and Human acceptance.
- Acceptance or closure authority: Human security authority after independent review.

## OGAL-RISK-011: CPF compatibility and durable session ownership are not accepted

- Status: `OPEN_GOVERNANCE_GAP`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: This reconciliation candidate is treated as accepted CPF compatibility or as a permanent task-ownership registry.
- Consequence: Later work may inherit authority, lifecycle, context, or lease assumptions that were never accepted or refreshed.
- Mitigation: Keep compatibility at `CANDIDATE_NOT_ACCEPTED`; record the Human-confirmed task lease without treating it as durable repository ownership; reverify ownership before later writes.
- Evidence need: Independent candidate review, Human compatibility decision, an accepted durable session and ownership mechanism, freshness rules, and successor handoff evidence.
- Acceptance or closure authority: Human source-governance authority.

## OGAL-RISK-012: Read-contract finality and reconciliation semantics are undefined

- Status: `OPEN_READ_CONTRACT_GAP`
- Owner: `UNASSIGNED_PENDING_HUMAN`
- Trigger: An indexer, dashboard, audit process, or product consumes accounts and events as a complete, final, fresh, and replay-safe view.
- Consequence: Reorganizations, missed logs, duplicate processing, pagination gaps, stale account state, or incomplete reconciliation may produce incorrect product or governance decisions.
- Mitigation: Do not claim complete auditability; require consumers to reconcile account state and define their own provisional handling until an accepted read contract exists.
- Evidence need: Finality threshold, replay and deduplication rules, reorganization handling, pagination contract, freshness budget, account-event reconciliation procedure, and integration tests.
- Acceptance or closure authority: Human protocol and data-consumer authority after independent review.

## Preserved decision boundary

No risk is accepted or closed by this register. Mint admission, security remediation, licensing, public-good service, mainnet verification, deployment, external integration, migration design, read semantics, and all economic, custody, settlement, token, and public claims remain separate Human gates.
