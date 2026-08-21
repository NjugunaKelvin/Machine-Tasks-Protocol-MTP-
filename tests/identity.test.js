/**
 * @file identity.test.js
 * @description Tests for the IdentityManager class.
 *
 * Covers: key generation, DID format, signing, verification, stableStringify,
 * and edge cases like tampered data, bad keys, and primitive value signing.
 *
 * Run all tests with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityManager } from '../src/identity/identity-manager.js';

describe('IdentityManager', () => {

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  test('generates a unique DID that includes the provided name', () => {
    const identity = new IdentityManager('TestNode');
    assert.ok(identity.id.startsWith('did:mtp:TestNode:'), `Expected DID to start with "did:mtp:TestNode:", got "${identity.id}"`);
  });

  test('generates RSA public and private keys on construction', () => {
    const identity = new IdentityManager('TestNode');
    assert.ok(identity.publicKey.includes('BEGIN PUBLIC KEY'), 'publicKey should be a PEM-encoded RSA public key');
    assert.ok(identity.privateKey.includes('BEGIN PRIVATE KEY'), 'privateKey should be a PEM-encoded PKCS8 private key');
  });

  test('two identities with the same name get different DIDs and different key pairs', () => {
    const a = new IdentityManager('SharedName');
    const b = new IdentityManager('SharedName');

    // DIDs differ because of the timestamp component
    assert.notEqual(a.id, b.id);
    // Key pairs are independently generated
    assert.notEqual(a.publicKey, b.publicKey);
  });

  test('restores identity correctly from existing keys', () => {
    const original = new IdentityManager('Persistent');
    const existingKeys = {
      id: original.id,
      privateKey: original.privateKey,
      publicKey: original.publicKey,
    };

    const restored = new IdentityManager('Persistent', existingKeys);

    assert.equal(restored.id, original.id);
    assert.equal(restored.publicKey, original.publicKey);
    assert.equal(restored.privateKey, original.privateKey);
  });

  test('getIdentity() returns only id and publicKey (no private key)', () => {
    const identity = new IdentityManager('SafeNode');
    const publicProfile = identity.getIdentity();

    assert.ok('id' in publicProfile, 'getIdentity() should include id');
    assert.ok('publicKey' in publicProfile, 'getIdentity() should include publicKey');
    assert.ok(!('privateKey' in publicProfile), 'getIdentity() must NOT expose the private key');
  });

  // -------------------------------------------------------------------------
  // Signing and Verification
  // -------------------------------------------------------------------------

  test('sign() returns a non-empty hex string', () => {
    const identity = new IdentityManager('Signer');
    const signature = identity.sign({ action: 'test', value: 42 });

    assert.ok(typeof signature === 'string', 'signature should be a string');
    assert.ok(signature.length > 0, 'signature should not be empty');
    // Hex strings only contain 0-9 and a-f
    assert.match(signature, /^[0-9a-f]+$/, 'signature should be a lowercase hex string');
  });

  test('verify() returns true for a valid signature', () => {
    const identity = new IdentityManager('Signer');
    const data = { task: 'compute', value: 100 };
    const signature = identity.sign(data);

    const isValid = IdentityManager.verify(data, signature, identity.publicKey);
    assert.equal(isValid, true);
  });

  test('verify() returns false when data is tampered', () => {
    const identity = new IdentityManager('Signer');
    const data = { task: 'compute', value: 100 };
    const signature = identity.sign(data);

    // Tamper with the data after signing
    const tamperedData = { task: 'compute', value: 999 };
    const isValid = IdentityManager.verify(tamperedData, signature, identity.publicKey);
    assert.equal(isValid, false);
  });

  test('verify() returns false when the wrong public key is used', () => {
    const signer = new IdentityManager('Signer');
    const impostor = new IdentityManager('Impostor');
    const data = { task: 'compute', value: 100 };
    const signature = signer.sign(data);

    // Using a different identity's public key must fail
    const isValid = IdentityManager.verify(data, signature, impostor.publicKey);
    assert.equal(isValid, false);
  });

  test('verify() returns false for an empty or invalid signature string', () => {
    const identity = new IdentityManager('Signer');
    const data = { task: 'compute' };
    const isValid = IdentityManager.verify(data, 'not_a_real_signature', identity.publicKey);
    assert.equal(isValid, false);
  });

  test('verify() returns false when publicKey argument is not a valid PEM string', () => {
    const identity = new IdentityManager('Signer');
    const data = { task: 'compute' };
    const signature = identity.sign(data);
    const isValid = IdentityManager.verify(data, signature, 'this_is_not_a_pem_key');
    assert.equal(isValid, false);
  });

  test('signing with a loaded (restored) identity produces verifiable signatures', () => {
    const original = new IdentityManager('LoadedIdentity');
    const data = { request: 'doWork' };

    const restored = new IdentityManager('LoadedIdentity', {
      id: original.id,
      privateKey: original.privateKey,
      publicKey: original.publicKey,
    });

    // Sign with the restored identity
    const signature = restored.sign(data);

    // Verify using the original public key (they are the same keys)
    assert.equal(IdentityManager.verify(data, signature, original.publicKey), true);
  });

  // -------------------------------------------------------------------------
  // stableStringify
  // -------------------------------------------------------------------------

  test('stableStringify produces the same output regardless of key insertion order', () => {
    const a = { z: 3, a: 1, m: 2 };
    const b = { a: 1, m: 2, z: 3 };
    const c = { m: 2, z: 3, a: 1 };

    const resultA = IdentityManager.stableStringify(a);
    const resultB = IdentityManager.stableStringify(b);
    const resultC = IdentityManager.stableStringify(c);

    assert.equal(resultA, resultB);
    assert.equal(resultB, resultC);
    assert.equal(resultA, '{"a":1,"m":2,"z":3}');
  });

  test('stableStringify handles nested objects by sorting keys at every level', () => {
    const obj = { outer: { z: 1, a: 2 }, id: 'x' };
    const result = IdentityManager.stableStringify(obj);
    assert.equal(result, '{"id":"x","outer":{"a":2,"z":1}}');
  });

  test('stableStringify preserves array element order', () => {
    const obj = { items: [3, 1, 2] };
    const result = IdentityManager.stableStringify(obj);
    assert.equal(result, '{"items":[3,1,2]}');
  });

  test('stableStringify handles primitive values directly', () => {
    assert.equal(IdentityManager.stableStringify(42), '42');
    assert.equal(IdentityManager.stableStringify('hello'), '"hello"');
    assert.equal(IdentityManager.stableStringify(true), 'true');
    assert.equal(IdentityManager.stableStringify(null), 'null');
  });

  test('signing is consistent for objects with different key order (relies on stableStringify)', () => {
    const identity = new IdentityManager('StableTest');

    const a = { b: 2, a: 1 };
    const b = { a: 1, b: 2 };

    const sigA = identity.sign(a);
    const sigB = identity.sign(b);

    // Same data, same signature, because key order is normalized
    assert.equal(sigA, sigB);
  });
});
