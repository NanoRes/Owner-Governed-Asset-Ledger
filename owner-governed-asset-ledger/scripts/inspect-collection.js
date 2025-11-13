#!/usr/bin/env node

const { Connection, PublicKey } = require('@solana/web3.js');
const mplTokenMetadata = require('@metaplex-foundation/mpl-token-metadata');
const { lamports: toLamports } = require('@metaplex-foundation/umi');

function unwrapOption(value) {
  if (value && typeof value === 'object' && value.__option) {
    return value.__option === 'Some' ? unwrapOption(value.value) : null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => unwrapOption(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, unwrapOption(v)]));
  }

  return value;
}

function normalizePublicKey(value) {
  if (!value) {
    return value;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    if (typeof value.toBase58 === 'function') {
      return value.toBase58();
    }

    if (typeof value.toString === 'function') {
      return value.toString();
    }
  }

  return value;
}

function normalizeBigNumberish(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    return BigInt(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }

    try {
      return BigInt(trimmed);
    } catch (err) {
      return null;
    }
  }

  if (typeof value === 'object') {
    if (typeof value.toString === 'function') {
      const asString = value.toString();
      if (asString && asString !== '[object Object]') {
        try {
          return BigInt(asString);
        } catch (err) {
          // fall through to attempt other conversions
        }
      }
    }

    if (typeof value.toNumber === 'function') {
      try {
        return BigInt(value.toNumber());
      } catch (err) {
        return null;
      }
    }
  }

  return null;
}
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const OGAL_PROGRAM_ID = new PublicKey('GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx');
const METAPLEX_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
);

function deriveConfigPda(namespace, overrideBump) {
  const seeds = [Buffer.from('config'), namespace.toBuffer()];
  if (typeof overrideBump === 'number') {
    seeds.push(Buffer.from([overrideBump]));
    return [PublicKey.createProgramAddressSync(seeds, OGAL_PROGRAM_ID), overrideBump];
  }

  return PublicKey.findProgramAddressSync(seeds, OGAL_PROGRAM_ID);
}

function deriveAuthPda(config, overrideBump) {
  const seeds = [Buffer.from('auth'), config.toBuffer()];
  if (typeof overrideBump === 'number') {
    seeds.push(Buffer.from([overrideBump]));
    return [PublicKey.createProgramAddressSync(seeds, OGAL_PROGRAM_ID), overrideBump];
  }

  return PublicKey.findProgramAddressSync(seeds, OGAL_PROGRAM_ID);
}

function deriveMetadataPda(mint, overrideBump) {
  const seeds = [Buffer.from('metadata'), METAPLEX_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()];
  if (typeof overrideBump === 'number') {
    seeds.push(Buffer.from([overrideBump]));
    return [PublicKey.createProgramAddressSync(seeds, METAPLEX_METADATA_PROGRAM_ID), overrideBump];
  }

  return PublicKey.findProgramAddressSync(seeds, METAPLEX_METADATA_PROGRAM_ID);
}

function deriveMasterEditionPda(mint, overrideBump) {
  const seeds = [
    Buffer.from('metadata'),
    METAPLEX_METADATA_PROGRAM_ID.toBuffer(),
    mint.toBuffer(),
    Buffer.from('edition'),
  ];
  if (typeof overrideBump === 'number') {
    seeds.push(Buffer.from([overrideBump]));
    return [PublicKey.createProgramAddressSync(seeds, METAPLEX_METADATA_PROGRAM_ID), overrideBump];
  }

  return PublicKey.findProgramAddressSync(seeds, METAPLEX_METADATA_PROGRAM_ID);
}

function describeCollectionDetails(details) {
  if (!details) {
    return { isSized: false, description: 'unsized collection (collectionDetails is null)' };
  }

  // Generated SDK wraps enum variants in an object with a __kind discriminator.
  if (details.__kind === 'V1' && details.size !== undefined) {
    return {
      isSized: true,
      description: `sized collection (V1) with declared size ${details.size.toString()}`,
    };
  }

  if (details.__kind === 'V2' && details.maxSize !== undefined) {
    return {
      isSized: true,
      description: `sized collection (V2) with max size ${details.maxSize.toString()}`,
    };
  }

  // Fall back to a best-effort stringification.
  return {
    isSized: true,
    description: `sized collection (unexpected layout): ${JSON.stringify(details)}`,
  };
}

function deserializeMetadataAccount(metadataAddress, account) {
  if (!account) {
    return null;
  }

  if (mplTokenMetadata.Metadata && typeof mplTokenMetadata.Metadata.deserialize === 'function') {
    const [metadata] = mplTokenMetadata.Metadata.deserialize(account.data);
    return {
      ...metadata,
      updateAuthority: normalizePublicKey(metadata.updateAuthority),
      collection: metadata.collection
        ? {
            ...metadata.collection,
            key: normalizePublicKey(metadata.collection.key),
          }
        : null,
    };
  }

  if (typeof mplTokenMetadata.deserializeMetadata === 'function') {
    const rawAccount = {
      publicKey: metadataAddress.toBase58(),
      data: account.data,
      executable: account.executable,
      owner:
        typeof account.owner?.toBase58 === 'function'
          ? account.owner.toBase58()
          : account.owner,
      lamports: toLamports(account.lamports ?? 0),
      rentEpoch: account.rentEpoch !== undefined ? BigInt(account.rentEpoch) : undefined,
    };

    const deserialized = mplTokenMetadata.deserializeMetadata(rawAccount);
    const collection = unwrapOption(deserialized.collection);
    const collectionDetails = unwrapOption(deserialized.collectionDetails);
    return {
      ...deserialized,
      updateAuthority: normalizePublicKey(deserialized.updateAuthority),
      collection: collection
        ? {
            ...collection,
            key: normalizePublicKey(collection.key),
          }
        : null,
      collectionDetails,
    };
  }

  throw new Error('Unsupported @metaplex-foundation/mpl-token-metadata export shape.');
}

function deserializeMasterEditionAccount(editionAddress, account) {
  if (!account) {
    return null;
  }

  if (typeof mplTokenMetadata.deserializeMasterEdition === 'function') {
    const rawAccount = {
      publicKey: editionAddress.toBase58(),
      data: account.data,
      executable: account.executable,
      owner:
        typeof account.owner?.toBase58 === 'function'
          ? account.owner.toBase58()
          : account.owner,
      lamports: toLamports(account.lamports ?? 0),
      rentEpoch: account.rentEpoch !== undefined ? BigInt(account.rentEpoch) : undefined,
    };

    const deserialized = mplTokenMetadata.deserializeMasterEdition(rawAccount);
    const data = deserialized.data ?? deserialized;

    return {
      supply: normalizeBigNumberish(data.supply ?? deserialized.supply),
      maxSupply: normalizeBigNumberish(unwrapOption(data.maxSupply ?? deserialized.maxSupply)),
    };
  }

  throw new Error('Unsupported @metaplex-foundation/mpl-token-metadata export shape.');
}

async function fetchMasterEdition(connection, editionAddress) {
  const account = await connection.getAccountInfo(editionAddress);
  if (!account) {
    throw new Error(`Master edition account ${editionAddress.toBase58()} is not found.`);
  }

  const masterEdition = deserializeMasterEditionAccount(editionAddress, account);
  if (!masterEdition) {
    throw new Error(`Master edition account ${editionAddress.toBase58()} could not be deserialized.`);
  }

  return masterEdition;
}

async function fetchMetadata(connection, metadataAddress) {
  const account = await connection.getAccountInfo(metadataAddress);
  if (!account) {
    throw new Error(`Metadata account ${metadataAddress.toBase58()} is not found.`);
  }

  const metadata = deserializeMetadataAccount(metadataAddress, account);
  if (!metadata) {
    throw new Error(`Metadata account ${metadataAddress.toBase58()} could not be deserialized.`);
  }

  return metadata;
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('inspect-collection')
    .option('mint', {
      type: 'string',
      demandOption: true,
      describe: 'Collection mint address to inspect',
    })
    .option('rpc-url', {
      type: 'string',
      default: 'https://api.mainnet-beta.solana.com',
      describe: 'RPC endpoint used for the inspection',
    })
    .option('namespace', {
      type: 'string',
      describe: 'Registry namespace that should own the collection via the OGAL PDA',
    })
    .option('config-bump', {
      type: 'number',
      describe: 'Optional override for the registry config PDA bump when deriving addresses',
    })
    .option('auth-bump', {
      type: 'number',
      describe: 'Optional override for the registry mint authority PDA bump when deriving addresses',
    })
    .option('metadata', {
      type: 'string',
      describe: 'Explicit metadata account address to inspect (defaults to the canonical PDA)',
    })
    .option('metadata-bump', {
      type: 'number',
      describe: 'Optional override for the metadata PDA bump when deriving addresses',
    })
    .option('edition', {
      type: 'string',
      describe: 'Explicit master edition account address (defaults to the canonical PDA)',
    })
    .option('edition-bump', {
      type: 'number',
      describe: 'Optional override for the master edition PDA bump when deriving addresses',
    })
    .help()
    .parse();

  const mint = new PublicKey(argv.mint);
  const connection = new Connection(argv['rpc-url'], 'confirmed');

  const [metadataAddress, metadataBump] = argv.metadata
    ? [new PublicKey(argv.metadata), argv['metadata-bump']]
    : deriveMetadataPda(mint, argv['metadata-bump']);

  const [editionAddress, editionBump] = argv.edition
    ? [new PublicKey(argv.edition), argv['edition-bump']]
    : deriveMasterEditionPda(mint, argv['edition-bump']);

  let derivedNamespaceAuthority = null;
  if (argv.namespace) {
    const namespace = new PublicKey(argv.namespace);
    const [configAddress, configBump] = deriveConfigPda(namespace, argv['config-bump']);
    const [authAddress, authBump] = deriveAuthPda(configAddress, argv['auth-bump']);
    derivedNamespaceAuthority = {
      namespace: namespace.toBase58(),
      config: configAddress.toBase58(),
      configBump,
      authority: authAddress.toBase58(),
      authBump,
    };
  }

  const metadata = await fetchMetadata(connection, metadataAddress);
  const masterEdition = await fetchMasterEdition(connection, editionAddress);
  const collectionDetails = describeCollectionDetails(metadata.collectionDetails);

  const output = {
    rpcEndpoint: argv['rpc-url'],
    mint: mint.toBase58(),
    metadataAccount: metadataAddress.toBase58(),
    metadataBump: metadataBump,
    masterEditionAccount: editionAddress.toBase58(),
    masterEditionBump: editionBump,
    updateAuthority: metadata.updateAuthority,
    collectionDetails: collectionDetails.description,
    isSizedCollection: collectionDetails.isSized,
    collectionField: metadata.collection
      ? {
          key: metadata.collection.key,
          verified: metadata.collection.verified,
        }
      : null,
    derivedNamespaceAuthority,
  };

  if (derivedNamespaceAuthority) {
    output.updateAuthorityMatchesDerivedMintAuthority =
      metadata.updateAuthority === derivedNamespaceAuthority.authority;
  }

  if (masterEdition) {
    output.hasMaxSupply = masterEdition.maxSupply !== null;
    output.isUnique = masterEdition.maxSupply !== null && masterEdition.maxSupply === 0n;
    output.isCollectionSetToMaxSupplyZero = masterEdition.maxSupply === 0n;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
