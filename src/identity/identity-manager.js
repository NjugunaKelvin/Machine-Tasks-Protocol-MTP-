/**
 * @file identity-manager.js
 * @description Manages cryptographic identities for all participants in the MTP network.
 *
 * Every entity in the MTP ecosystem (an Executor or a Requester) is represented by a
 * cryptographic identity. This identity consists of:
 *   - A unique Decentralized Identifier (DID) formatted as "did:mtp:<name>:<timestamp>"
 *   - An RSA-2048 public/private key pair used for signing and verification
 *
 * This module handles three fundamental operations:
 *   1. Key generation: Create a new RSA key pair for a fresh identity
 *   2. Signing: Produce a cryptographic signature over any data object
 *   3. Verification: Confirm that a signature was produced by the holder of a given public key
 *
 * The signing algorithm used is RSA with SHA-256 (RS256), which is widely supported,
 * battle-tested, and produces deterministic signatures given the same private key and data.
 *
 * NOTE ON KEY STORAGE: This implementation generates and holds keys in memory. In a
 * production deployment you should load private keys from a Hardware Security Module (HSM),
 * a secrets manager (e.g. AWS Secrets Manager, HashiCorp Vault), or an encrypted keystore.
 * Never hard-code or commit private keys to source control.
 */

import { generateKeyPairSync, createSign, createVerify } from 'crypto';

/**
 * @class IdentityManager
 * @classdesc Represents the cryptographic identity of one participant in the MTP network.
 *
 * Each participant (Executor or Requester) creates exactly one IdentityManager instance.
 * That instance is their "passport" on the network: their unique ID and the ability to
 * sign messages that others can verify without any shared secret.
 *
 * @example
 * // Create a brand-new identity (generates a fresh RSA key pair)
 * const identity = new IdentityManager('PaymentService');
 * console.log(identity.id); // "did:mtp:PaymentService:1709823423000"
 *
 * @example
 * // Load a persisted identity (keys were saved to a vault previously)
 * const identity = new IdentityManager('PaymentService', {
 *   id: 'did:mtp:PaymentService:1709823423000',
 *   privateKey: process.env.PRIVATE_KEY_PEM,
 *   publicKey: process.env.PUBLIC_KEY_PEM,
 * });
 */
export class IdentityManager {
  /**
   * Creates an IdentityManager instance.
   *
   * If no existingKeys are provided, a fresh 2048-bit RSA key pair is generated synchronously.
   * Key generation is a one-time cost on startup. For long-lived services the key pair should
   * be generated once, persisted securely, and loaded on each subsequent startup.
   *
   * @param {string} [name='anonymous'] - A human-readable label for this identity.
   *   Used as part of the generated DID string. Examples: 'AlphaNode', 'BillingService'.
   * @param {Object|null} [existingKeys=null] - Optional pre-existing key material.
   *   Pass this when restoring a persisted identity rather than creating a new one.
   * @param {string} [existingKeys.id] - The previously assigned DID string.
   * @param {string} existingKeys.privateKey - PEM-encoded PKCS8 private key.
   * @param {string} existingKeys.publicKey - PEM-encoded SPKI public key.
   */
  constructor(name = 'anonymous', existingKeys = null) {
    this.name = name;

    if (existingKeys) {
      // Restore a previously generated identity. This is the correct pattern for
      // production services that need a stable identity across restarts.
      this.id = existingKeys.id || `did:mtp:${name}:${Date.now()}`;
      this.privateKey = existingKeys.privateKey;
      this.publicKey = existingKeys.publicKey;
    } else {
      // Generate a fresh identity. The timestamp component of the DID makes it
      // effectively unique even if the same name is used across multiple instances.
      this.id = `did:mtp:${name}:${Date.now()}`;

      const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      this.privateKey = privateKey;
      this.publicKey = publicKey;
    }
  }

  /**
   * Returns the public-facing identity profile for this participant.
   *
   * This is safe to share with other participants and with the Discovery Layer.
   * It intentionally does NOT include the private key.
   *
   * @returns {{ id: string, publicKey: string }} An object with the participant's DID and public key.
   */
  getIdentity() {
    return {
      id: this.id,
      publicKey: this.publicKey,
    };
  }

  /**
   * Produces a cryptographic signature over an arbitrary data object.
   *
   * The data is first serialized to a canonical JSON string using stableStringify, which
   * sorts object keys recursively to guarantee that two objects with the same keys and
   * values but different key ordering produce the same bytes. This is critical for
   * cross-language interoperability where JSON serializers may differ in key ordering.
   *
   * The signature is produced using RSA-SHA256 and returned as a lowercase hex string.
   *
   * @param {Object|string|number|boolean|null} data - The data to sign.
   *   Objects are serialized deterministically. Primitive values are JSON-encoded.
   * @returns {string} The RSA-SHA256 signature in hexadecimal encoding.
   */
  sign(data) {
    const sign = createSign('SHA256');
    const payload = IdentityManager.stableStringify(data);
    sign.update(payload);
    sign.end();
    return sign.sign(this.privateKey, 'hex');
  }

  /**
   * Verifies that a signature was produced by the holder of the given public key.
   *
   * This is a static method because verification does not require a private key.
   * Any party with the signer's public key can call this to confirm authenticity.
   *
   * Returns false (rather than throwing) if the signature is malformed or if the public
   * key is invalid, so callers can treat any falsy result as "do not trust this message."
   *
   * @static
   * @param {Object|string|number|boolean|null} data - The original data that was signed.
   *   Must be structurally identical to what was passed to sign().
   * @param {string} signature - The hex-encoded signature received from the signer.
   * @param {string} publicKey - The PEM-encoded public key of the alleged signer.
   * @returns {boolean} True if the signature is valid; false if it is invalid or an error occurred.
   */
  static verify(data, signature, publicKey) {
    const verify = createVerify('SHA256');
    const payload = IdentityManager.stableStringify(data);
    verify.update(payload);
    verify.end();

    try {
      return verify.verify(publicKey, signature, 'hex');
    } catch (err) {
      // Any error during verification (malformed key, bad encoding, etc.) means
      // the signature cannot be trusted. Return false instead of propagating.
      return false;
    }
  }

  /**
   * Produces a canonical (deterministic) JSON string from any value.
   *
   * Standard JSON.stringify does not guarantee key ordering in objects. Two calls with
   * the same data but different insertion order can produce different strings. Since
   * our signatures are computed over the raw bytes of the JSON string, any variation
   * would cause signature verification to fail even though the data is logically identical.
   *
   * This method solves that by recursively sorting object keys before serializing.
   * Arrays preserve their order (index matters for arrays). Undefined values and
   * function-valued properties are silently omitted, matching JSON.stringify behaviour.
   *
   * @static
   * @param {any} obj - The value to serialize.
   * @returns {string} A deterministic JSON string representation.
   *
   * @example
   * IdentityManager.stableStringify({ b: 2, a: 1 });
   * // Returns '{"a":1,"b":2}'  (keys sorted alphabetically)
   */
  static stableStringify(obj) {
    // Base case: primitives and null serialize directly via JSON.stringify
    if (typeof obj !== 'object' || obj === null) {
      return JSON.stringify(obj);
    }

    // Arrays: preserve element order but recursively normalize each element
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => IdentityManager.stableStringify(item)).join(',') + ']';
    }

    // Objects: sort keys alphabetically then recursively serialize values
    const keys = Object.keys(obj).sort();
    const parts = [];

    keys.forEach(key => {
      const value = obj[key];
      // Skip undefined values and function properties, consistent with JSON.stringify
      if (value !== undefined && typeof value !== 'function') {
        const keyStr = JSON.stringify(key);
        const valStr = IdentityManager.stableStringify(value);
        parts.push(`${keyStr}:${valStr}`);
      }
    });

    return '{' + parts.join(',') + '}';
  }
}
