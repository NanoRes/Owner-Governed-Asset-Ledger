#!/usr/bin/env node

const {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const {
  OGAL_PROGRAM_ID,
  loadKeypair,
  instructionDiscriminator,
  deriveConfigPda,
  deriveAuthPda,
  logStructured,
  collectLogs,
} = require('./utils');

const MIGRATE_NAMESPACE_DISCRIMINATOR = instructionDiscriminator('migrate_config_namespace');

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('migrate-namespace')
    .option('old-namespace', {
      type: 'string',
      demandOption: true,
      describe: 'Existing namespace whose configuration should be migrated',
    })
    .option('new-namespace', {
      type: 'string',
      demandOption: true,
      describe: 'Fresh namespace to initialize with the copied configuration',
    })
    .option('authority-keypair', {
      type: 'string',
      demandOption: true,
      describe: 'Path to the config authority keypair (signer and payer)',
    })
    .option('rpc-url', {
      type: 'string',
      default: 'https://api.mainnet-beta.solana.com',
      describe: 'RPC endpoint used to submit the migration',
    })
    .option('commitment', {
      type: 'string',
      default: 'confirmed',
      describe: 'Commitment level for fetching blockhashes and confirmations',
    })
    .help()
    .parse();

  const oldNamespace = new PublicKey(argv['old-namespace']);
  const newNamespace = new PublicKey(argv['new-namespace']);

  if (oldNamespace.equals(newNamespace)) {
    throw new Error('The new namespace must differ from the existing namespace.');
  }

  const authorityKeypair = loadKeypair(argv['authority-keypair']);

  const connection = new Connection(argv['rpc-url'], argv.commitment);

  const [oldConfigPda] = deriveConfigPda(oldNamespace);
  const [newConfigPda] = deriveConfigPda(newNamespace);
  const [oldAuthPda] = deriveAuthPda(oldConfigPda);
  const [newAuthPda] = deriveAuthPda(newConfigPda);

  logStructured('info', 'derived-pdas', {
    oldNamespace: oldNamespace.toBase58(),
    newNamespace: newNamespace.toBase58(),
    oldConfigPda: oldConfigPda.toBase58(),
    newConfigPda: newConfigPda.toBase58(),
    oldAuthPda: oldAuthPda.toBase58(),
    newAuthPda: newAuthPda.toBase58(),
  });

  const data = Buffer.alloc(8 + 32);
  MIGRATE_NAMESPACE_DISCRIMINATOR.copy(data, 0);
  newNamespace.toBuffer().copy(data, 8);

  const instruction = new TransactionInstruction({
    programId: OGAL_PROGRAM_ID,
    keys: [
      { pubkey: authorityKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: oldConfigPda, isSigner: false, isWritable: true },
      { pubkey: newConfigPda, isSigner: false, isWritable: true },
      { pubkey: oldAuthPda, isSigner: false, isWritable: false },
      { pubkey: newAuthPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(instruction);
  tx.feePayer = authorityKeypair.publicKey;

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(argv.commitment);
  tx.recentBlockhash = blockhash;

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [authorityKeypair], {
      commitment: argv.commitment,
    });

    logStructured('info', 'transaction-confirmed', {
      signature,
      lastValidBlockHeight,
      newNamespace: newNamespace.toBase58(),
    });
  } catch (err) {
    const logs = await collectLogs(err);
    logStructured('error', 'transaction-failed', {
      message: err?.message ?? 'Unknown error',
      guidance:
        'Migration simulation failed. Ensure the derived PDAs are vacant and the signer matches the old config authority. ' +
        'If accounts already exist, close them manually or choose a new namespace before retrying.',
      logs,
    });
    throw err;
  }
}

main().catch((err) => {
  if (err) {
    logStructured('error', 'unhandled-error', { message: err.message ?? String(err) });
  }
  process.exit(1);
});
