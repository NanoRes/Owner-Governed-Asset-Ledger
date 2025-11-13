const test = require('node:test');
const assert = require('node:assert');
const { Keypair, PublicKey } = require('@solana/web3.js');

const {
  deserializeManifestCreator,
  ensureManifestCreatorPresent,
} = require('../utils');

test('deserializeManifestCreator returns the stored creator public key', () => {
  const manifestCreator = Keypair.generate().publicKey;
  const accountDiscriminatorLength = 8;
  const pubkeyLength = 32;
  const u64Length = 8;
  const u8Length = 1;
  const manifestHashLength = 32;
  const manifestMaxUriLength = 128;
  const manifestUriPaddingLength = 1;
  const manifestUriLengthFieldLength = 2;
  const creatorOffset =
    accountDiscriminatorLength +
    pubkeyLength +
    u64Length +
    pubkeyLength +
    u8Length +
    u8Length +
    u8Length +
    u8Length +
    u8Length +
    manifestHashLength +
    manifestMaxUriLength +
    manifestUriPaddingLength +
    manifestUriLengthFieldLength;
  const data = Buffer.alloc(creatorOffset + pubkeyLength + 8); // allow for trailing padding
  manifestCreator.toBuffer().copy(data, creatorOffset);

  const result = deserializeManifestCreator(data);
  assert.ok(result instanceof PublicKey);
  assert.strictEqual(result.toBase58(), manifestCreator.toBase58());
});

test('ensureManifestCreatorPresent throws when the manifest creator is missing', () => {
  const manifestCreator = Keypair.generate().publicKey;
  const otherCreator = {
    address: Keypair.generate().publicKey,
    share: 100,
    verified: false,
  };

  assert.throws(
    () => ensureManifestCreatorPresent([otherCreator], manifestCreator),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(
        err.message,
        new RegExp(`Manifest account .* was created by ${manifestCreator.toBase58()}`),
      );
      return true;
    },
  );
});
