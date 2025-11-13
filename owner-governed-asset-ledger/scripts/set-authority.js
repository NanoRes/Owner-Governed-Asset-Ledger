#!/usr/bin/env node

const {
  Connection,
  PublicKey,
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

const SET_AUTHORITY_DISCRIMINATOR = instructionDiscriminator('set_authority');

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('set-authority')
    .option('namespace', {
      type: 'string',
      demandOption: true,
      describe: 'Namespace whose configuration PDA should be updated',
    })
    .option('new-authority', {
      type: 'string',
      demandOption: true,
      describe: 'Base58 public key that should become the new authority',
    })
    .option('authority-keypair', {
      type: 'string',
      demandOption: true,
      describe: 'Path to the current authority keypair (signs the transaction)',
    })
    .option('rpc-url', {
      type: 'string',
      default: 'https://api.mainnet-beta.solana.com',
      describe: 'RPC endpoint used to submit the transaction',
    })
    .option('commitment', {
      type: 'string',
      default: 'confirmed',
      describe: 'Commitment level for recent blockhashes and confirmation',
    })
    .help()
    .parse();

  const namespace = new PublicKey(argv.namespace);
  const newAuthority = new PublicKey(argv['new-authority']);
  const authorityKeypair = loadKeypair(argv['authority-keypair']);

  const connection = new Connection(argv['rpc-url'], argv.commitment);

  const [configPda] = deriveConfigPda(namespace);
  const [authPda] = deriveAuthPda(configPda);

  logStructured('info', 'derived-pdas', {
    namespace: namespace.toBase58(),
    configPda: configPda.toBase58(),
    authPda: authPda.toBase58(),
  });

  const data = Buffer.alloc(8 + 32);
  SET_AUTHORITY_DISCRIMINATOR.copy(data, 0);
  newAuthority.toBuffer().copy(data, 8);

  const instruction = new TransactionInstruction({
    programId: OGAL_PROGRAM_ID,
    keys: [
      { pubkey: authorityKeypair.publicKey, isSigner: true, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
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
      newAuthority: newAuthority.toBase58(),
    });
  } catch (err) {
    const logs = await collectLogs(err);
    logStructured('error', 'transaction-failed', {
      message: err?.message ?? 'Unknown error',
      guidance:
        'Simulation failed. Verify the namespace matches the on-chain config and that the provided authority still owns it. ' +
        'Inspect the transaction logs or rerun with --commitment processed for faster feedback.',
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
