# Migrating an OGAL Namespace from Unity

The Owner-Governed Asset Ledger (OGAL) program exposes a `migrate_config_namespace`
instruction that clones the current registry configuration into a new namespace
and spins up fresh config/auth PDAs. This workflow is helpful when the studio
needs to rotate the registry namespace without redeploying the on-chain
program.

## Unity helper component

The Unity toolbelt now ships a `MigrateNamespaceTransactionSender` component that
invokes `migrate_config_namespace` directly from a standalone scene.

1. Drag the component onto an empty GameObject in an isolated scene.
2. Provide the authority wallet's private key (or define `DEPLOYER_PRIVATE_KEY`)
and confirm the matching public key.
3. Enter the current namespace (the component defaults to the live production
   namespace) and the target namespace that should own the migrated config.
4. Optionally fill the expected PDAs for the existing config/auth and the new
   config/auth accounts. The component derives all four PDAs and refuses to send
   the transaction if any derived address differs from the expected values.
5. Press play (or disable `Send On Start` and call `SendTransactionAsync`
   manually) to derive the accounts, build the instruction, and submit the
   transaction. The authority wallet signs and covers rent for the new config
   and auth PDAs.

Because the helper logs every derived PDA, teams can copy the console output to
update dashboards or post-migration runbooks.

## Runtime migrations

Projects can trigger the same migration flow at runtime through
`OwnerGovernedAssetLedgerService.MigrateConfigNamespaceAsync`. Construct an
`OwnerGovernedAssetLedgerMigrationRequest` with the new namespace and any
expected PDAs that should be validated before the instruction is sent. The
service derives the existing config/auth, validates the connected wallet is the
recorded authority, derives the new config/auth PDAs, and sends the transaction
with the authority wallet covering rent for both newly created accounts.

```csharp
var request = new OwnerGovernedAssetLedgerMigrationRequest(
    newNamespace: "<TARGET_NAMESPACE>",
    expectedOldConfigPda: "<OPTIONAL_CONFIG_PDA>",
    expectedOldAuthPda: "<OPTIONAL_AUTH_PDA>");

var signature = await ogalService.MigrateConfigNamespaceAsync(request);
Debug.Log($"Migration complete: {signature}");
```

If the RPC node rejects the transaction, the service surfaces an
`OwnerGovernedAssetLedgerException` that includes both a user-friendly message
and the raw RPC reason to simplify troubleshooting.

## Post-migration checks

After the transaction confirms, update any off-chain systems (dashboards,
backend services, Unity config assets) to reference the new config and
mint-authority PDAs. Projects that cache the namespace in
`Solana_Configuration.asset` should refresh the asset so runtime fetches use the
new PDA before minting resumes.
