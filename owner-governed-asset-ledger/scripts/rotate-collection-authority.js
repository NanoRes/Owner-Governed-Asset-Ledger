#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const OGAL_PROGRAM_ID = new PublicKey('GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx');
const METAPLEX_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const EXPECTED_ROTATE_COLLECTION_AUTHORITY_DISCRIMINATOR = Buffer.from([
  127, 21, 205, 57, 21, 40, 136, 55,
]);
const LEGACY_ROTATE_COLLECTION_AUTHORITY_DISCRIMINATOR = Buffer.from([
  173, 30, 192, 124, 93, 238, 110, 80,
]);

const ROTATE_COLLECTION_AUTHORITY_DISCRIMINATOR = instructionDiscriminator(
  'rotate_collection_authority',
);
const LEGACY_DISCRIMINATOR = legacyInstructionDiscriminator('rotate_collection_authority');

if (!ROTATE_COLLECTION_AUTHORITY_DISCRIMINATOR.equals(EXPECTED_ROTATE_COLLECTION_AUTHORITY_DISCRIMINATOR)) {
  throw new Error(
    'rotate_collection_authority discriminator mismatch. Ensure the Anchor build output is in sync with the helpers.',
  );
}

if (!LEGACY_DISCRIMINATOR.equals(LEGACY_ROTATE_COLLECTION_AUTHORITY_DISCRIMINATOR)) {
  throw new Error('Legacy discriminator mismatch. Ensure the compatibility hash is correct.');
}

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

function parsePublicKeyOrKeypair(value, flagName) {
  if (!value) {
    throw new Error(`Expected a value for --${flagName}.`);
  }

  try {
    return new PublicKey(value);
  } catch (err) {
    const expandedPath = expandPath(value);
    if (!fs.existsSync(expandedPath)) {
      throw new Error(
        `Failed to parse --${flagName}: provide a base58 public key or a path to a keypair JSON file.`,
      );
    }

    try {
      const keypair = loadKeypair(expandedPath);
      return keypair.publicKey;
    } catch (loadErr) {
      throw new Error(
        `Failed to read keypair for --${flagName}: ${loadErr.message}. Ensure the file contains a valid secret key array.`,
      );
    }
  }
}

function instructionDiscriminator(name) {
  // Anchor derives instruction discriminators using the string `global:<name>`
  // (note the single colon). The previous implementation used a double colon
  // which produced the fallback discriminator, triggering the
  // `InstructionFallbackNotFound` error when the transaction was simulated.
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function legacyInstructionDiscriminator(name) {
  return crypto.createHash('sha256').update(`global::${name}`).digest().slice(0, 8);
}

function deriveConfigPda(namespace) {
  return PublicKey.findProgramAddressSync([Buffer.from('config'), namespace.toBuffer()], OGAL_PROGRAM_ID);
}

function deriveAuthPda(config) {
  return PublicKey.findProgramAddressSync([Buffer.from('auth'), config.toBuffer()], OGAL_PROGRAM_ID);
}

function deriveMetadataPda(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METAPLEX_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METAPLEX_METADATA_PROGRAM_ID,
  );
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('rotate-collection-authority')
    .option('namespace', {
      type: 'string',
      demandOption: true,
      describe: 'Namespace public key for the OGAL configuration',
    })
    .option('collection-mint', {
      type: 'string',
      demandOption: true,
      describe: 'Collection mint address whose metadata authority should be updated',
    })
    .option('new-update-authority', {
      type: 'string',
      demandOption: true,
      describe:
        'Base58 public key (or path to a keypair file) that should become the collection update authority',
    })
    .option('authority-keypair', {
      type: 'string',
      demandOption: true,
      describe: 'Path to the OGAL config authority keypair',
    })
    .option('payer-keypair', {
      type: 'string',
      describe: 'Optional separate payer keypair path (defaults to authority)',
    })
    .option('rpc-url', {
      type: 'string',
      default: 'https://api.mainnet-beta.solana.com',
      describe: 'RPC endpoint used to submit the transaction',
    })
    .option('commitment', {
      type: 'string',
      default: 'confirmed',
      describe: 'RPC commitment used for recent blockhash and confirmations',
    })
    .help()
    .parse();

  const namespace = new PublicKey(argv.namespace);
  const collectionMint = new PublicKey(argv['collection-mint']);
  const newUpdateAuthority = parsePublicKeyOrKeypair(argv['new-update-authority'], 'new-update-authority');

  const authorityKeypair = loadKeypair(argv['authority-keypair']);
  const payerKeypair = argv['payer-keypair'] ? loadKeypair(argv['payer-keypair']) : authorityKeypair;

  const connection = new Connection(argv['rpc-url'], argv.commitment);

  const [configPda] = deriveConfigPda(namespace);
  const [authPda] = deriveAuthPda(configPda);
  const [metadataPda] = deriveMetadataPda(collectionMint);

  const data = Buffer.alloc(8 + 32);
  ROTATE_COLLECTION_AUTHORITY_DISCRIMINATOR.copy(data, 0);
  newUpdateAuthority.toBuffer().copy(data, 8);

  const keys = [
    { pubkey: authorityKeypair.publicKey, isSigner: true, isWritable: false },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: authPda, isSigner: false, isWritable: false },
    { pubkey: metadataPda, isSigner: false, isWritable: true },
    { pubkey: collectionMint, isSigner: false, isWritable: false },
    { pubkey: METAPLEX_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  console.log('Namespace:', namespace.toBase58());
  console.log('Config PDA:', configPda.toBase58());
  console.log('Auth PDA:', authPda.toBase58());
  console.log('Collection mint:', collectionMint.toBase58());
  console.log('Collection metadata PDA:', metadataPda.toBase58());
  console.log('New update authority:', newUpdateAuthority.toBase58());

  const attempts = [
    { discriminator: ROTATE_COLLECTION_AUTHORITY_DISCRIMINATOR, legacy: false },
    { discriminator: LEGACY_DISCRIMINATOR, legacy: true },
  ];

  for (const attempt of attempts) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(argv.commitment);
    const data = Buffer.alloc(8 + 32);
    attempt.discriminator.copy(data, 0);
    newUpdateAuthority.toBuffer().copy(data, 8);

    const instruction = new TransactionInstruction({
      programId: OGAL_PROGRAM_ID,
      keys,
      data,
    });

    const tx = new Transaction().add(instruction);
    tx.feePayer = payerKeypair.publicKey;
    tx.recentBlockhash = blockhash;

    const signers = [payerKeypair];
    if (!payerKeypair.publicKey.equals(authorityKeypair.publicKey)) {
      signers.push(authorityKeypair);
    }

    try {
      const signature = await sendAndConfirmTransaction(connection, tx, signers, {
        commitment: argv.commitment,
      });

      if (attempt.legacy) {
        console.warn(
          'rotate_collection_authority succeeded using the legacy double-colon discriminator. ' +
            'Redeploy the program compiled with the patched Anchor toolchain to adopt the canonical discriminator.',
        );
      }

      console.log('Signature:', signature);
      console.log('Last valid block height:', lastValidBlockHeight);
      return;
    } catch (err) {
      const logs = await collectLogs(err);
      if (!attempt.legacy && isFallbackError(err, logs)) {
        console.warn(
          'rotate_collection_authority was rejected with InstructionFallbackNotFound. Retrying with the legacy discriminator.',
        );
        continue;
      }

      if (logs && Array.isArray(logs)) {
        console.error('Transaction logs:');
        for (const log of logs) {
          console.error('  ', log);
        }
      }

      throw err;
    }
  }

  throw new Error('rotate_collection_authority failed with both discriminator variants.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function collectLogs(err) {
  if (err instanceof SendTransactionError || typeof err?.getLogs === 'function' || err?.logs) {
    const logs =
      typeof err.getLogs === 'function'
        ? await err.getLogs().catch(() => err.logs ?? err.transactionLogs ?? null)
        : err.logs ?? err.transactionLogs ?? null;
    return logs && Array.isArray(logs) ? logs : null;
  }

  return null;
}

function isFallbackError(err, logs) {
  const pieces = [];
  if (err?.message) {
    pieces.push(String(err.message));
  }
  if (err?.transactionMessage) {
    pieces.push(String(err.transactionMessage));
  }
  if (logs && Array.isArray(logs)) {
    pieces.push(logs.join(' '));
  }

  const combined = pieces.join(' ');
  return combined.includes('InstructionFallbackNotFound') || combined.includes('custom program error: 0x65');
}
