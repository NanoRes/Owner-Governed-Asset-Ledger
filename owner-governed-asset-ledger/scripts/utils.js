const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  Keypair,
  PublicKey,
  SendTransactionError,
} = require('@solana/web3.js');

const OGAL_PROGRAM_ID = new PublicKey('GwMpopxNkDYsnucBRPf47QSEsEzA3rS1o6ioMX78hgqx');

const ACCOUNT_DISCRIMINATOR_LENGTH = 8;
const PUBKEY_LENGTH = 32;
const U64_LENGTH = 8;
const U8_LENGTH = 1;
const MANIFEST_HASH_LENGTH = 32;
const MANIFEST_MAX_URI_LENGTH = 128;
const MANIFEST_URI_PADDING_LENGTH = 1;
const MANIFEST_URI_LENGTH_FIELD_LENGTH = 2;

// ObjectManifest layout defined in programs/owner_governed_asset_ledger/src/lib.rs.
const MANIFEST_CREATOR_OFFSET =
  ACCOUNT_DISCRIMINATOR_LENGTH +
  PUBKEY_LENGTH + // config
  U64_LENGTH + // object_id
  PUBKEY_LENGTH + // mint
  U8_LENGTH + // bump
  U8_LENGTH + // mint_bump
  U8_LENGTH + // is_active
  U8_LENGTH + // minted
  U8_LENGTH + // initialized
  MANIFEST_HASH_LENGTH +
  MANIFEST_MAX_URI_LENGTH +
  MANIFEST_URI_PADDING_LENGTH +
  MANIFEST_URI_LENGTH_FIELD_LENGTH;

const MANIFEST_CREATOR_END = MANIFEST_CREATOR_OFFSET + PUBKEY_LENGTH;

function expandPath(p) {
  if (!p) {
    return p;
  }
  if (p.startsWith('~')) {
    if (p === '~') {
      return os.homedir();
    }

    const remainder = p.slice(1).replace(/^[/\\]/, '');
    return path.resolve(os.homedir(), remainder);
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

function instructionDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function deriveConfigPda(namespace) {
  return PublicKey.findProgramAddressSync([Buffer.from('config'), namespace.toBuffer()], OGAL_PROGRAM_ID);
}

function deriveAuthPda(config) {
  return PublicKey.findProgramAddressSync([Buffer.from('auth'), config.toBuffer()], OGAL_PROGRAM_ID);
}

function logStructured(level, event, payload) {
  const entry = { level, event, ...payload };
  const serialized = JSON.stringify(entry, (_key, value) => {
    if (value instanceof PublicKey) {
      return value.toBase58();
    }
    if (value instanceof Error) {
      return value.message;
    }
    return value;
  });

  switch (level) {
    case 'warn':
      console.warn(serialized);
      break;
    case 'error':
      console.error(serialized);
      break;
    default:
      console.log(serialized);
      break;
  }
}

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

function deserializeManifestCreator(data) {
  if (!data) {
    throw new Error('Manifest account data is missing.');
  }

  const buffer = Buffer.from(data);
  if (buffer.length < MANIFEST_CREATOR_END) {
    throw new Error('Manifest account data is too small to contain the creator field.');
  }

  return new PublicKey(buffer.subarray(MANIFEST_CREATOR_OFFSET, MANIFEST_CREATOR_END));
}

function ensureManifestCreatorPresent(creators, manifestCreator, manifestPda) {
  if (!Array.isArray(creators)) {
    throw new Error('Creators must be provided as an array.');
  }
  if (!(manifestCreator instanceof PublicKey)) {
    throw new Error('Manifest creator must be a PublicKey instance.');
  }

  const hasCreator = creators.some((creator) => creator?.address?.equals?.(manifestCreator));
  if (hasCreator) {
    return creators;
  }

  const manifestCreatorAddress = manifestCreator.toBase58();
  const manifestAddress = manifestPda?.toBase58?.() ?? 'unknown manifest account';
  throw new Error(
    `Manifest account ${manifestAddress} was created by ${manifestCreatorAddress}, but this address was not provided in the creators list. Include it in the --creator or --creators-json input and ensure that the shares still sum to 100.`,
  );
}

module.exports = {
  OGAL_PROGRAM_ID,
  expandPath,
  loadKeypair,
  instructionDiscriminator,
  deriveConfigPda,
  deriveAuthPda,
  logStructured,
  collectLogs,
  deserializeManifestCreator,
  ensureManifestCreatorPresent,
};
