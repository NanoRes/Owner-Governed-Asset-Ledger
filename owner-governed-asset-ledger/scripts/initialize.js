#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const PROGRAM_ID = new PublicKey('GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx');
const INITIALIZE_DISCRIMINATOR = Buffer.from('afaf6d1f0d989bed', 'hex');
const SYSTEM_PROGRAM_ID = SystemProgram.programId;

function expandPath(p) {
  if (!p) {
    return p;
  }
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

function loadKeypair(filePath) {
  const fullPath = expandPath(filePath);
  if (!fullPath) {
    throw new Error('A keypair path must be provided.');
  }

  const secret = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('namespace', {
      type: 'string',
      demandOption: true,
      describe: 'Namespace public key that scopes the registry configuration',
    })
    .option('authority', {
      type: 'string',
      describe: 'Authority public key recorded in the config PDA',
    })
    .option('payer', {
      type: 'string',
      describe: 'Payer public key that funds the new accounts',
    })
    .option('authority-keypair', {
      type: 'string',
      describe: 'Path to the authority keypair file',
    })
    .option('payer-keypair', {
      type: 'string',
      describe: 'Path to the payer keypair file (defaults to authority keypair)',
    })
    .option('rpc-url', {
      type: 'string',
      default: 'https://api.mainnet-beta.solana.com',
      describe: 'RPC endpoint to submit the transaction to',
    })
    .option('commitment', {
      type: 'string',
      default: 'confirmed',
      describe: 'RPC commitment level used when submitting the transaction',
    })
    .check((args) => {
      if (!args['authority-keypair']) {
        throw new Error('Missing required option: --authority-keypair');
      }
      return true;
    })
    .help()
    .parse();

  const namespace = new PublicKey(argv.namespace);
  const authorityKeypair = loadKeypair(argv['authority-keypair']);
  const payerKeypair = argv['payer-keypair']
    ? loadKeypair(argv['payer-keypair'])
    : authorityKeypair;

  const authority = argv.authority
    ? new PublicKey(argv.authority)
    : authorityKeypair.publicKey;
  const payer = argv.payer
    ? new PublicKey(argv.payer)
    : payerKeypair.publicKey;

  if (!authority.equals(authorityKeypair.publicKey)) {
    throw new Error(
      `Authority public key mismatch. CLI value: ${authority.toBase58()} | Keypair: ${authorityKeypair.publicKey.toBase58()}`,
    );
  }

  if (!payer.equals(payerKeypair.publicKey)) {
    throw new Error(
      `Payer public key mismatch. CLI value: ${payer.toBase58()} | Keypair: ${payerKeypair.publicKey.toBase58()}`,
    );
  }

  const connection = new Connection(argv['rpc-url'], argv.commitment);

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from('config'), namespace.toBuffer()],
    PROGRAM_ID,
  );
  const [auth] = PublicKey.findProgramAddressSync(
    [Buffer.from('auth'), config.toBuffer()],
    PROGRAM_ID,
  );

  const data = Buffer.concat([INITIALIZE_DISCRIMINATOR, namespace.toBuffer()]);

  const keys = [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: auth, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(instruction);
  tx.feePayer = payer;

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
    argv.commitment,
  );
  tx.recentBlockhash = blockhash;

  const signers = [payerKeypair];
  if (!payerKeypair.publicKey.equals(authorityKeypair.publicKey)) {
    signers.push(authorityKeypair);
  }

  const signature = await sendAndConfirmTransaction(connection, tx, signers, {
    commitment: argv.commitment,
  });

  console.log('Namespace:', namespace.toBase58());
  console.log('Config PDA:', config.toBase58());
  console.log('Auth PDA:', auth.toBase58());
  console.log('Signature:', signature);
  console.log('Last valid block height:', lastValidBlockHeight);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
