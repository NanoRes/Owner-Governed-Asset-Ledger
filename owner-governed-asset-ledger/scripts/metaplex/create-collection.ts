#!/usr/bin/env ts-node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { some } from '@metaplex-foundation/umi';
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi-public-keys';
import { getCreateMetadataAccountV3InstructionDataSerializer } from '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3.js';
import { getCreateMasterEditionV3InstructionDataSerializer } from '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMasterEditionV3.js';

const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

function expandPath(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return filePath;
  }
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

function loadKeypair(filePath: string): Keypair {
  const expanded = expandPath(filePath);
  if (!expanded) {
    throw new Error('A keypair path must be provided.');
  }
  const secretKey = JSON.parse(fs.readFileSync(expanded, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('payer', {
      type: 'string',
      demandOption: true,
      describe: 'Path to the payer keypair that will fund and sign the transaction',
    })
    .option('mint-keypair', {
      type: 'string',
      describe: 'Optional path where the newly generated collection mint keypair should be written',
    })
    .option('name', {
      type: 'string',
      demandOption: true,
      describe: 'Collection name stored in on-chain metadata',
    })
    .option('symbol', {
      type: 'string',
      default: '',
      describe: 'Token symbol stored in on-chain metadata',
    })
    .option('uri', {
      type: 'string',
      demandOption: true,
      describe: 'URI that hosts the off-chain metadata JSON',
    })
    .option('seller-fee-bps', {
      type: 'number',
      default: 0,
      describe: 'Secondary sale fee in basis points',
    })
    .option('collection-size', {
      type: 'number',
      default: 0,
      describe: 'Initial declared size stored in collectionDetails (use 0 for OGAL-managed sizing)',
    })
    .option('mutable', {
      type: 'boolean',
      default: true,
      describe: 'Whether the metadata is mutable',
    })
    .option('rpc-url', {
      type: 'string',
      default: 'https://api.mainnet-beta.solana.com',
      describe: 'RPC endpoint used to submit the transaction',
    })
    .option('commitment', {
      type: 'string',
      default: 'confirmed',
      describe: 'RPC commitment level',
    })
    .option('skip-preflight', {
      type: 'boolean',
      default: false,
      describe: 'Skip the RPC preflight check when sending the transaction',
    })
    .help()
    .parseSync();

  const payer = loadKeypair(argv.payer);

  const commitment = argv.commitment as Commitment;
  const connection = new Connection(argv['rpc-url'], { commitment });

  const mintKeypair = Keypair.generate();
  const mintAddress = mintKeypair.publicKey;

  if (argv['mint-keypair']) {
    const outPath = expandPath(argv['mint-keypair']);
    if (!outPath) {
      throw new Error('Unable to resolve the mint keypair output path.');
    }
    if (fs.existsSync(outPath)) {
      throw new Error(`Refusing to overwrite existing file: ${outPath}`);
    }
    fs.writeFileSync(outPath, JSON.stringify(Array.from(mintKeypair.secretKey)));
    console.log(`Saved mint keypair to ${outPath}`);
  }

  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const payerAta = getAssociatedTokenAddressSync(
    mintAddress,
    payer.publicKey,
  );

  const createMintAccountIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mintAddress,
    lamports: mintRent,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  });

  const initMintIx = createInitializeMintInstruction(
    mintAddress,
    0,
    payer.publicKey,
    payer.publicKey,
    TOKEN_PROGRAM_ID,
  );

  const createAtaIx = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    payerAta,
    payer.publicKey,
    mintAddress,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const mintToIx = createMintToInstruction(
    mintAddress,
    payerAta,
    payer.publicKey,
    1,
    [],
    TOKEN_PROGRAM_ID,
  );

  const metadataPda = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintAddress.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  )[0];

  const masterEditionPda = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mintAddress.toBuffer(),
      Buffer.from('edition'),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  )[0];

  const metadataData = getCreateMetadataAccountV3InstructionDataSerializer().serialize({
    data: {
      name: argv.name,
      symbol: argv.symbol,
      uri: argv.uri,
      sellerFeeBasisPoints: argv['seller-fee-bps'],
      creators: some([
        {
          address: umiPublicKey(payer.publicKey.toBase58()),
          verified: true,
          share: 100,
        },
      ]),
      collection: null,
      uses: null,
    },
    isMutable: argv.mutable,
    collectionDetails: some({ __kind: 'V1', size: BigInt(argv['collection-size']) }),
  });

  const createMetadataIx = new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: mintAddress, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: payer.publicKey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(metadataData),
  });

  const masterEditionData = getCreateMasterEditionV3InstructionDataSerializer().serialize({
    maxSupply: some(0n),
  });

  const createMasterEditionIx = new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: masterEditionPda, isSigner: false, isWritable: true },
      { pubkey: mintAddress, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(masterEditionData),
  });

  const tx = new Transaction();
  tx.add(createMintAccountIx);
  tx.add(initMintIx);
  tx.add(createAtaIx);
  tx.add(mintToIx);
  tx.add(createMetadataIx);
  tx.add(createMasterEditionIx);

  const recentBlockhash = await connection.getLatestBlockhash(commitment);
  tx.recentBlockhash = recentBlockhash.blockhash;
  tx.feePayer = payer.publicKey;

  tx.sign(payer, mintKeypair);

  const signature = await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair], {
    commitment,
    skipPreflight: argv['skip-preflight'],
  });

  console.log('Collection mint:', mintAddress.toBase58());
  console.log('Metadata PDA:', metadataPda.toBase58());
  console.log('Master edition PDA:', masterEditionPda.toBase58());
  console.log('Token account:', payerAta.toBase58());
  console.log('Transaction signature:', signature);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
