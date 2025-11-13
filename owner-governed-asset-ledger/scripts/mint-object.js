#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
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
  deserializeManifestCreator,
  ensureManifestCreatorPresent,
} = require('./utils');

const METAPLEX_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const MANIFEST_SEED = Buffer.from('object_manifest');
const MINT_SEED = Buffer.from('object_mint');
const MAX_CREATOR_LIMIT = 5;

const MINT_OBJECT_DISCRIMINATOR = instructionDiscriminator('mint_object_nft');

function expandPath(p) {
  if (!p) {
    return p;
  }
  if (p.startsWith('~')) {
    return path.resolve(process.env.HOME || process.env.USERPROFILE || '.', p.slice(1));
  }
  return path.resolve(p);
}

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

function deriveMetadataPda(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METAPLEX_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METAPLEX_METADATA_PROGRAM_ID,
  );
}

function deriveMasterEditionPda(mint) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      METAPLEX_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from('edition'),
    ],
    METAPLEX_METADATA_PROGRAM_ID,
  );
}

function encodeString(value) {
  const stringBytes = Buffer.from(value ?? '', 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(stringBytes.length, 0);
  return Buffer.concat([lenBuf, stringBytes]);
}

function serializeCreators(creators) {
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(creators.length, 0);
  const creatorBuffers = [lengthBuf];
  for (const creator of creators) {
    creatorBuffers.push(creator.address.toBuffer());
    creatorBuffers.push(Buffer.from([creator.verified ? 1 : 0]));
    creatorBuffers.push(Buffer.from([creator.share]));
  }
  return Buffer.concat(creatorBuffers);
}

function parseCreatorString(raw) {
  const segments = raw.split(':');
  if (segments.length < 3 || segments.length > 4) {
    throw new Error(
      `Invalid creator specification '${raw}'. Expected format address:share:verified[:keypairPath]`,
    );
  }

  const [addressRaw, shareRaw, verifiedRaw, keypairRaw] = segments;
  const address = new PublicKey(addressRaw);
  const share = Number.parseInt(shareRaw, 10);
  if (!Number.isInteger(share) || share < 0 || share > 100) {
    throw new Error(`Creator share must be an integer between 0 and 100. Received '${shareRaw}'.`);
  }
  const verified = parseBoolean(verifiedRaw, 'creator verified');
  const keypairPath = keypairRaw ? expandPath(keypairRaw) : null;

  return { address, share, verified, keypairPath };
}

function parseCreators(argv) {
  const creators = [];
  if (argv.creator) {
    for (const raw of argv.creator) {
      creators.push(parseCreatorString(raw));
    }
  }

  if (argv['creators-json']) {
    const filePath = expandPath(argv['creators-json']);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Creators JSON file not found at ${filePath}.`);
    }
    const contents = fs.readFileSync(filePath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(contents);
    } catch (err) {
      throw new Error(`Failed to parse creators JSON file: ${err.message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Creators JSON file must contain an array of creator objects.');
    }
    for (const entry of parsed) {
      if (!entry?.address) {
        throw new Error('Each creator entry must include an address field.');
      }
      const address = new PublicKey(entry.address);
      const share = Number.parseInt(entry.share ?? 0, 10);
      if (!Number.isInteger(share) || share < 0 || share > 100) {
        throw new Error(`Creator share must be between 0 and 100. Invalid value '${entry.share}'.`);
      }
      const verified = entry.verified === undefined
        ? false
        : parseBoolean(entry.verified, 'creator verified');
      const keypairPath = entry.keypair ? expandPath(entry.keypair) : null;
      creators.push({ address, share, verified, keypairPath });
    }
  }

  if (creators.length === 0) {
    throw new Error('At least one creator must be provided via --creator or --creators-json.');
  }

  const totalShare = creators.reduce((sum, c) => sum + c.share, 0);
  if (totalShare !== 100) {
    throw new Error(`Creator shares must total 100. Received total ${totalShare}.`);
  }

  return creators;
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('mint-object')
    .option('namespace', {
      type: 'string',
      demandOption: true,
      describe: 'Namespace public key for the OGAL configuration',
    })
    .option('object-id', {
      type: 'string',
      demandOption: true,
      describe: 'Numeric object identifier to mint',
    })
    .option('manifest-uri', {
      type: 'string',
      demandOption: true,
      describe: 'Manifest URI recorded on-chain',
    })
    .option('manifest-hash', {
      type: 'string',
      demandOption: true,
      describe: '32-byte manifest hash encoded as hex',
    })
    .option('metadata-name', {
      type: 'string',
      demandOption: true,
      describe: 'Token metadata name field',
    })
    .option('metadata-symbol', {
      type: 'string',
      default: '',
      describe: 'Token metadata symbol field',
    })
    .option('seller-fee-bps', {
      type: 'number',
      demandOption: true,
      describe: 'Seller fee basis points for secondary royalties',
    })
    .option('recipient', {
      type: 'string',
      demandOption: true,
      describe: 'Recipient public key that will receive the minted NFT',
    })
    .option('collection-mint', {
      type: 'string',
      demandOption: true,
      describe: 'Collection mint that the object NFT will be verified against',
    })
    .option('payer-keypair', {
      type: 'string',
      demandOption: true,
      describe: 'Path to the payer (and manifest creator) keypair JSON file',
    })
    .option('authority', {
      type: 'string',
      describe: 'Optional override for the config authority public key',
    })
    .option('config-bump', {
      type: 'number',
      describe: 'Expected config PDA bump',
    })
    .option('auth-bump', {
      type: 'number',
      describe: 'Expected auth PDA bump',
    })
    .option('manifest-bump', {
      type: 'number',
      describe: 'Expected manifest PDA bump',
    })
    .option('mint-bump', {
      type: 'number',
      describe: 'Expected object mint PDA bump',
    })
    .option('include-instructions-sysvar', {
      type: 'boolean',
      default: false,
      describe: 'Include the instructions sysvar account (required for sized collections)',
    })
    .option('creator', {
      type: 'string',
      array: true,
      describe: 'Creator definition: address:share:verified[:keypairPath] (repeatable)',
    })
    .option('creators-json', {
      type: 'string',
      describe: 'Path to a JSON file containing an array of creator definitions',
    })
    .option('token-metadata-program', {
      type: 'string',
      default: METAPLEX_METADATA_PROGRAM_ID.toBase58(),
      describe: 'Override for the Metaplex token metadata program id',
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
    .option('compute-unit-limit', {
      type: 'number',
      default: 400_000,
      describe: 'Compute unit limit requested via the compute budget program',
    })
    .option('compute-unit-price', {
      type: 'number',
      default: 0,
      describe: 'Optional micro-lamports per compute unit for priority fees',
    })
    .help()
    .parse();

  const namespace = new PublicKey(argv.namespace);
  const objectId = parseBigInt(argv['object-id'], 'object-id');
  const manifestUri = argv['manifest-uri'];
  const manifestHash = parseManifestHash(argv['manifest-hash']);
  const metadataName = argv['metadata-name'];
  const metadataSymbol = argv['metadata-symbol'] ?? '';
  const sellerFeeBasisPoints = Number.parseInt(argv['seller-fee-bps'], 10);
  if (!Number.isInteger(sellerFeeBasisPoints) || sellerFeeBasisPoints < 0 || sellerFeeBasisPoints > 10_000) {
    throw new Error('Seller fee basis points must be an integer between 0 and 10000.');
  }
  if (!manifestUri || manifestUri.length === 0) {
    throw new Error('Manifest URI cannot be empty.');
  }
  if (manifestUri.length > 128) {
    throw new Error('Manifest URI exceeds the on-chain MAX_URI_LENGTH (128 characters).');
  }
  if (!metadataName || metadataName.length === 0) {
    throw new Error('Metadata name cannot be empty.');
  }
  if (metadataName.length > 32) {
    throw new Error('Metadata name exceeds the program limit of 32 characters.');
  }
  if (metadataSymbol.length > 10) {
    throw new Error('Metadata symbol exceeds the program limit of 10 characters.');
  }

  const computeUnitLimit = Number.parseInt(argv['compute-unit-limit'], 10);
  if (!Number.isInteger(computeUnitLimit) || computeUnitLimit <= 0) {
    throw new Error('Compute unit limit must be a positive integer.');
  }

  const computeUnitPrice = Number.parseInt(argv['compute-unit-price'], 10);
  if (!Number.isInteger(computeUnitPrice) || computeUnitPrice < 0) {
    throw new Error('Compute unit price must be a non-negative integer.');
  }

  const creators = parseCreators(argv);
  if (creators.length > MAX_CREATOR_LIMIT) {
    throw new Error(`A maximum of ${MAX_CREATOR_LIMIT} creators is supported by the program.`);
  }

  const payerKeypair = loadKeypair(argv['payer-keypair']);
  const payer = payerKeypair.publicKey;

  const recipient = new PublicKey(argv.recipient);
  const collectionMint = new PublicKey(argv['collection-mint']);
  const tokenMetadataProgram = new PublicKey(argv['token-metadata-program']);

  const { connection, configPda, configBump, authPda, authBump } = await (async () => {
    const connection = new Connection(argv['rpc-url'], argv.commitment);
    const [configPda, derivedConfigBump] = deriveConfigPda(namespace);
    if (argv['config-bump'] !== undefined && argv['config-bump'] !== derivedConfigBump) {
      throw new Error(
        `Config bump mismatch. Expected ${argv['config-bump']}, derived ${derivedConfigBump}.`,
      );
    }
    const [authPda, derivedAuthBump] = deriveAuthPda(configPda);
    if (argv['auth-bump'] !== undefined && argv['auth-bump'] !== derivedAuthBump) {
      throw new Error(`Auth bump mismatch. Expected ${argv['auth-bump']}, derived ${derivedAuthBump}.`);
    }
    return { connection, configPda, configBump: derivedConfigBump, authPda, authBump: derivedAuthBump };
  })();

  const [manifestPda, manifestBump] = deriveManifestPda(configPda, objectId);
  if (argv['manifest-bump'] !== undefined && argv['manifest-bump'] !== manifestBump) {
    throw new Error(`Manifest bump mismatch. Expected ${argv['manifest-bump']}, derived ${manifestBump}.`);
  }
  const manifestAccountInfo = await connection.getAccountInfo(manifestPda);
  let manifestCreator;
  if (!manifestAccountInfo || manifestAccountInfo.data.length === 0) {
    manifestCreator = payer;
    logStructured('info', 'mint_object_nft.manifest_initializing', {
      manifestPda,
      manifestCreator,
      manifestAccountState: manifestAccountInfo ? 'empty-data' : 'missing',
    });
  } else {
    manifestCreator = deserializeManifestCreator(manifestAccountInfo.data);
    logStructured('info', 'mint_object_nft.manifest_fetched', {
      manifestPda,
      manifestCreator,
      dataLength: manifestAccountInfo.data.length,
    });
  }
  ensureManifestCreatorPresent(creators, manifestCreator, manifestPda);

  const [objectMint, mintBump] = deriveObjectMintPda(manifestPda);
  if (argv['mint-bump'] !== undefined && argv['mint-bump'] !== mintBump) {
    throw new Error(`Mint bump mismatch. Expected ${argv['mint-bump']}, derived ${mintBump}.`);
  }

  const [metadataPda] = deriveMetadataPda(objectMint);
  const [masterEditionPda] = deriveMasterEditionPda(objectMint);
  const [collectionMetadataPda] = deriveMetadataPda(collectionMint);
  const [collectionMasterEditionPda] = deriveMasterEditionPda(collectionMint);

  const ataSeeds = [recipient.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), objectMint.toBuffer()];
  const [recipientAta] = PublicKey.findProgramAddressSync(
    ataSeeds,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const configAccountInfo = await connection.getAccountInfo(configPda);
  if (!configAccountInfo) {
    throw new Error(`Config account not found at ${configPda.toBase58()}. Ensure the namespace is correct.`);
  }
  if (!configAccountInfo.owner.equals(OGAL_PROGRAM_ID)) {
    throw new Error('Derived config account is not owned by the OGAL program.');
  }
  if (configAccountInfo.data.length < 8 + 32) {
    throw new Error('Config account data is too small to contain the authority field.');
  }
  const storedAuthority = new PublicKey(configAccountInfo.data.slice(8, 40));

  const authorityPubkey = argv.authority ? new PublicKey(argv.authority) : storedAuthority;
  if (!authorityPubkey.equals(storedAuthority)) {
    throw new Error(
      `Provided authority ${authorityPubkey.toBase58()} does not match config authority ${storedAuthority.toBase58()}.`,
    );
  }

  const creatorUniqueSigners = new Map();
  const creatorAccounts = [];
  for (const creator of creators) {
    if (!creator.verified) {
      continue;
    }

    if (creator.address.equals(payer)) {
      continue;
    }

    if (!creator.keypairPath) {
      throw new Error(
        `Creator ${creator.address.toBase58()} is marked verified but no keypair path was provided.`,
      );
    }

    const expandedPath = expandPath(creator.keypairPath);
    if (!fs.existsSync(expandedPath)) {
      throw new Error(`Creator keypair file not found at ${expandedPath}.`);
    }
    const keypair = loadKeypair(expandedPath);
    if (!keypair.publicKey.equals(creator.address)) {
      throw new Error(
        `Creator keypair at ${expandedPath} does not match declared address ${creator.address.toBase58()}.`,
      );
    }
    creatorUniqueSigners.set(creator.address.toBase58(), keypair);
  }

  const sellerFeeBuffer = Buffer.alloc(2);
  sellerFeeBuffer.writeUInt16LE(sellerFeeBasisPoints, 0);

  const serializedCreators = serializeCreators(creators);

  const objectIdBuffer = Buffer.alloc(8);
  objectIdBuffer.writeBigUInt64LE(objectId, 0);

  const data = Buffer.concat([
    MINT_OBJECT_DISCRIMINATOR,
    objectIdBuffer,
    encodeString(manifestUri),
    manifestHash,
    encodeString(metadataName),
    encodeString(metadataSymbol),
    sellerFeeBuffer,
    serializedCreators,
  ]);

  const baseAccounts = [
    { pubkey: authorityPubkey, isSigner: false, isWritable: false },
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: authPda, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: manifestPda, isSigner: false, isWritable: true },
    { pubkey: objectMint, isSigner: false, isWritable: true },
    { pubkey: recipientAta, isSigner: false, isWritable: true },
    { pubkey: recipient, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: metadataPda, isSigner: false, isWritable: true },
    { pubkey: masterEditionPda, isSigner: false, isWritable: true },
    { pubkey: collectionMint, isSigner: false, isWritable: false },
    { pubkey: tokenMetadataProgram, isSigner: false, isWritable: false },
    { pubkey: collectionMetadataPda, isSigner: false, isWritable: true },
    { pubkey: collectionMasterEditionPda, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  if (argv['include-instructions-sysvar']) {
    baseAccounts.push({
      pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
      isSigner: false,
      isWritable: false,
    });
  }

  for (const [addressBase58] of creatorUniqueSigners) {
    const address = new PublicKey(addressBase58);
    creatorAccounts.push({ pubkey: address, isSigner: true, isWritable: false });
  }

  const keys = baseAccounts.concat(creatorAccounts);

  logStructured('info', 'mint_object_nft.derived_accounts', {
    namespace,
    objectId: objectId.toString(),
    configAuthority: authorityPubkey,
    configPda,
    configBump,
    authPda,
    authBump,
    manifestPda,
    manifestBump,
    manifestCreator,
    objectMint,
    mintBump,
    recipientAta,
    metadataPda,
    masterEditionPda,
    collectionMetadataPda,
    collectionMasterEditionPda,
    tokenMetadataProgram,
  });

  const instruction = new TransactionInstruction({
    programId: OGAL_PROGRAM_ID,
    keys,
    data,
  });

  const instructions = [];
  if (computeUnitLimit > 0) {
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }));
  }
  if (computeUnitPrice > 0) {
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice }));
  }
  instructions.push(instruction);

  const tx = new Transaction().add(...instructions);
  tx.feePayer = payer;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(argv.commitment);
  tx.recentBlockhash = blockhash;

  const signers = [payerKeypair];
  for (const keypair of creatorUniqueSigners.values()) {
    signers.push(keypair);
  }

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, signers, {
      commitment: argv.commitment,
      skipPreflight: false,
    });

    logStructured('info', 'mint_object_nft.sent', {
      signature,
      lastValidBlockHeight,
    });
    console.log('Signature:', signature);
    console.log('Last valid block height:', lastValidBlockHeight);
  } catch (err) {
    const logs = await collectLogs(err);
    logStructured('error', 'mint_object_nft.failed', {
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
