#!/usr/bin/env node

const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
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

const MANIFEST_SEED = Buffer.from('object_manifest');
const MINT_SEED = Buffer.from('object_mint');
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

const UPDATE_MANIFEST_DISCRIMINATOR = instructionDiscriminator('update_object_manifest');

function parseBigInt(value, flag) {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    if (value.startsWith('0x') || value.startsWith('0X')) {
      return BigInt(value);
    }
    return BigInt(value);
  }
  throw new Error(`Unable to parse --${flag} into a bigint.`);
}

function parseManifestHash(input) {
  if (!input) {
    throw new Error('A manifest hash must be provided.');
  }
  let cleaned = input.trim();
  if (cleaned.startsWith('0x') || cleaned.startsWith('0X')) {
    cleaned = cleaned.slice(2);
  }
  if (cleaned.length !== 64) {
    throw new Error('Manifest hash must be provided as a 32-byte hex string.');
  }
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('Manifest hash must only contain hexadecimal characters.');
  }
  return Buffer.from(cleaned, 'hex');
}

function encodeString(value) {
  const stringBytes = Buffer.from(value ?? '', 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(stringBytes.length, 0);
  return Buffer.concat([lenBuf, stringBytes]);
}

function parseBoolean(value, flag) {
  if (value === undefined || value === null) {
    throw new Error(`Unable to parse boolean for --${flag}.`);
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (['true', 't', 'yes', 'y', '1'].includes(lowered)) {
      return true;
    }
    if (['false', 'f', 'no', 'n', '0'].includes(lowered)) {
      return false;
    }
  }
  throw new Error(`Unable to parse boolean for --${flag}.`);
}

function deriveManifestPda(config, objectId) {
  const objectIdBytes = Buffer.alloc(8);
  objectIdBytes.writeBigUInt64LE(objectId, 0);
  return PublicKey.findProgramAddressSync(
    [MANIFEST_SEED, config.toBuffer(), objectIdBytes],
    OGAL_PROGRAM_ID,
  );
}

function deriveObjectMintPda(manifest) {
  return PublicKey.findProgramAddressSync(
    [MINT_SEED, manifest.toBuffer()],
    OGAL_PROGRAM_ID,
  );
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('update-manifest')
    .option('namespace', {
      type: 'string',
      demandOption: true,
      describe: 'Namespace public key for the OGAL configuration',
    })
    .option('object-id', {
      type: 'string',
      demandOption: true,
      describe: 'Numeric object identifier whose manifest will be updated',
    })
    .option('object-mint', {
      type: 'string',
      demandOption: true,
      describe: 'Object mint address associated with the manifest',
    })
    .option('owner-keypair', {
      type: 'string',
      demandOption: true,
      describe: 'Path to the keypair of the manifest owner (must hold the NFT)',
    })
    .option('owner-token-account', {
      type: 'string',
      describe: 'Optional override for the owner token account (defaults to the derived ATA)',
    })
    .option('manifest-hash', {
      type: 'string',
      demandOption: true,
      describe: '32-byte manifest hash encoded as hex',
    })
    .option('metadata-uri', {
      type: 'string',
      demandOption: true,
      describe: 'New metadata URI to store on the manifest',
    })
    .option('is-active', {
      type: 'string',
      default: 'true',
      describe: 'Whether the object should remain active (true/false)',
    })
    .option('config-bump', {
      type: 'number',
      describe: 'Expected config PDA bump (optional validation)',
    })
    .option('manifest-bump', {
      type: 'number',
      describe: 'Expected manifest PDA bump (optional validation)',
    })
    .option('mint-bump', {
      type: 'number',
      describe: 'Expected mint PDA bump (optional validation)',
    })
    .option('rpc-url', {
      type: 'string',
      default: 'https://api.mainnet-beta.solana.com',
      describe: 'RPC endpoint used to submit the transaction',
    })
    .option('commitment', {
      type: 'string',
      default: 'confirmed',
      describe: 'RPC commitment used for blockhash fetching and confirmations',
    })
    .help()
    .parse();

  const namespace = new PublicKey(argv.namespace);
  const objectId = parseBigInt(argv['object-id'], 'object-id');
  const objectMint = new PublicKey(argv['object-mint']);
  const manifestHash = parseManifestHash(argv['manifest-hash']);
  const metadataUri = argv['metadata-uri'];
  const isActive = parseBoolean(argv['is-active'], 'is-active');

  if (!metadataUri || metadataUri.length === 0) {
    throw new Error('Metadata URI cannot be empty.');
  }
  if (metadataUri.length > 128) {
    throw new Error('Metadata URI exceeds the on-chain MAX_URI_LENGTH (128 characters).');
  }

  const ownerKeypair = loadKeypair(argv['owner-keypair']);
  const owner = ownerKeypair.publicKey;

  const connection = new Connection(argv['rpc-url'], argv.commitment);
  const [configPda, configBump] = deriveConfigPda(namespace);
  if (argv['config-bump'] !== undefined && argv['config-bump'] !== configBump) {
    throw new Error(`Config bump mismatch. Expected ${argv['config-bump']}, derived ${configBump}.`);
  }

  const [authPda, authBump] = deriveAuthPda(configPda);

  const [manifestPda, manifestBump] = deriveManifestPda(configPda, objectId);
  if (argv['manifest-bump'] !== undefined && argv['manifest-bump'] !== manifestBump) {
    throw new Error(`Manifest bump mismatch. Expected ${argv['manifest-bump']}, derived ${manifestBump}.`);
  }

  const [derivedObjectMint, mintBump] = deriveObjectMintPda(manifestPda);
  if (!derivedObjectMint.equals(objectMint)) {
    throw new Error(
      `Derived object mint ${derivedObjectMint.toBase58()} does not match provided mint ${objectMint.toBase58()}.`,
    );
  }
  if (argv['mint-bump'] !== undefined && argv['mint-bump'] !== mintBump) {
    throw new Error(`Mint bump mismatch. Expected ${argv['mint-bump']}, derived ${mintBump}.`);
  }

  const ownerTokenAccount = argv['owner-token-account']
    ? new PublicKey(argv['owner-token-account'])
    : PublicKey.findProgramAddressSync(
        [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), objectMint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )[0];

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), objectMint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );

  logStructured('info', 'update_object_manifest.derived_accounts', {
    namespace,
    objectId: objectId.toString(),
    configPda,
    configBump,
    authPda,
    authBump,
    manifestPda,
    manifestBump,
    objectMint,
    mintBump,
    owner,
    ownerTokenAccount,
    metadataPda,
    tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
    rentSysvar: SYSVAR_RENT_PUBKEY,
    instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
  });

  console.log('Derived accounts:');
  console.log('  Config PDA:', configPda.toBase58());
  console.log('  Auth PDA:', authPda.toBase58());
  console.log('  Manifest PDA:', manifestPda.toBase58());
  console.log('  Object Mint:', objectMint.toBase58());
  console.log('  Metadata PDA:', metadataPda.toBase58());
  console.log('  Owner Token Account:', ownerTokenAccount.toBase58());
  console.log('  Token Metadata Program:', TOKEN_METADATA_PROGRAM_ID.toBase58());
  console.log('  Rent Sysvar:', SYSVAR_RENT_PUBKEY.toBase58());
  console.log('  Instructions Sysvar:', SYSVAR_INSTRUCTIONS_PUBKEY.toBase58());

  const data = Buffer.concat([
    UPDATE_MANIFEST_DISCRIMINATOR,
    manifestHash,
    encodeString(metadataUri),
    Buffer.from([isActive ? 1 : 0]),
  ]);

  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: authPda, isSigner: false, isWritable: false },
    { pubkey: manifestPda, isSigner: false, isWritable: true },
    { pubkey: objectMint, isSigner: false, isWritable: false },
    { pubkey: ownerTokenAccount, isSigner: false, isWritable: false },
    { pubkey: metadataPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({
    programId: OGAL_PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(instruction);
  tx.feePayer = owner;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(argv.commitment);
  tx.recentBlockhash = blockhash;

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [ownerKeypair], {
      commitment: argv.commitment,
      skipPreflight: false,
    });

    logStructured('info', 'update_object_manifest.sent', {
      signature,
      lastValidBlockHeight,
    });
    console.log('Signature:', signature);
    console.log('Last valid block height:', lastValidBlockHeight);
  } catch (err) {
    const logs = await collectLogs(err);
    logStructured('error', 'update_object_manifest.failed', {
      err,
      logs,
    });
    if (Array.isArray(logs)) {
      console.error('Transaction logs:');
      for (const line of logs) {
        console.error(line);
      }
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
