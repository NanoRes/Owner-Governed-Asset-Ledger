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

const SET_PAUSED_DISCRIMINATOR = instructionDiscriminator('set_paused');

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('set-paused')
    .option('namespace', {
      type: 'string',
      demandOption: true,
      describe: 'Namespace whose configuration PDA should be updated',
    })
    .option('paused', {
      type: 'boolean',
      demandOption: true,
      describe: 'Whether the registry should be paused (use --paused or --no-paused)',
    })
    .option('authority-keypair', {
      type: 'string',
      demandOption: true,
      describe: 'Path to the authority keypair (signs the transaction and pays fees)',
    })
    .option('rpc-url', {
      type: 'string',
      default: 'https://api.mainnet-beta.solana.com',
      describe: 'RPC endpoint used to submit the transaction',
    })
    .option('commitment', {
      type: 'string',
      default: 'confirmed',
      describe: 'Commitment level for fetching blockhashes and confirmations',
    })
    .help()
    .parse();

  const namespace = new PublicKey(argv.namespace);
  const authorityKeypair = loadKeypair(argv['authority-keypair']);
  const paused = Boolean(argv.paused);

  const connection = new Connection(argv['rpc-url'], argv.commitment);

  const [configPda] = deriveConfigPda(namespace);
  const [authPda] = deriveAuthPda(configPda);

  logStructured('info', 'derived-pdas', {
    namespace: namespace.toBase58(),
    configPda: configPda.toBase58(),
    authPda: authPda.toBase58(),
  });

  const data = Buffer.alloc(8 + 1);
  SET_PAUSED_DISCRIMINATOR.copy(data, 0);
  data.writeUInt8(paused ? 1 : 0, 8);

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
      paused,
    });
  } catch (err) {
    const logs = await collectLogs(err);
    logStructured('error', 'transaction-failed', {
      message: err?.message ?? 'Unknown error',
      guidance:
        'Simulation failed. Confirm the signer matches the config authority and the namespace is correct. ' +
        'Review the printed logs or run `solana confirm <sig> --verbose` for more detail.',
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
