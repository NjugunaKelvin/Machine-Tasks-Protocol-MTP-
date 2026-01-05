/**
 * @file identity-manager.js
 * @description Manages cryptographic identities for MTP participants (Executors and Requesters).
 * Handles key generation, storage (in-memory), signing, and verification of messages.
 * Uses Node.js native 'crypto' module for performance and security.
 */

import { generateKeyPairSync, createSign, createVerify } from 'crypto';

/**
 * @class IdentityManager
 * @classdesc The IdentityManager is responsible for the cryptographic operations of a participant.
 * It holds the private key for signing and the public key for verification.
 * 
 * In a production MTP system, the private key should be loaded from a secure vault (HSM, Secrets Manager)
 * rather than being generated on the fly every time, unless it's an ephemeral identity.
 */
export class IdentityManager {
  /**
   * Creates an instance of IdentityManager.
   * 
   * @param {string} [name='anonymous'] - A human-readable label for this identity (e.g., 'PaymentService').
   * @param {Object} [existingKeys] - Optional. If provided, uses these keys instead of generating new ones.
   */
  constructor(name = 'anonymous', existingKeys = null) {
    this.name = name;

    if (existingKeys) {
      this.id = existingKeys.id || `did:mtp:${name}:${Date.now()}`;
      this.privateKey = existingKeys.privateKey;
      this.publicKey = existingKeys.publicKey;
    } else {
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
   * Retrieves the public identity profile.
   * 
   * @returns {Object} An object containing the ID and Public Key.
   */
  getIdentity() {
    return {
      id: this.id,
      publicKey: this.publicKey,
    };
  }

  /**
   * Cryptographically signs a data payload.
   * 
   * @param {Object|string} data - The data to sign. objects are automatically serialized deterministically.
   * @returns {string} The signature in hexadecimal format.
   */
  sign(data) {
    const sign = createSign('SHA256');
    const payload = IdentityManager.stableStringify(data);
    // console.log(`DEBUG_SIGN: ${payload.substring(0, 50)}...`);
    sign.update(payload);
    sign.end();
    return sign.sign(this.privateKey, 'hex');
  }

  /**
   * Verifies a signature against a dataset and a public key.
   * 
   * @static
   * @param {Object|string} data - The original data that was signed.
   * @param {string} signature - The hex signature received.
   * @param {string} publicKey - The signer's public key (PEM format).
   * @returns {boolean} True if verification succeeds, False otherwise.
   */
  static verify(data, signature, publicKey) {
    const verify = createVerify('SHA256');
    const payload = IdentityManager.stableStringify(data);
    verify.update(payload);
    verify.end();

    try {
      return verify.verify(publicKey, signature, 'hex');
    } catch (err) {
      return false;
    }
  }

  /**
   * Deterministic JSON stringify to ensure consistent signatures.
   * Sorts object keys recursively.
   * 
   * @static
   * @param {any} obj - input
   * @returns {string} canonical JSON string
   */
  static stableStringify(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
      return '[' + obj.map(item => IdentityManager.stableStringify(item)).join(',') + ']';
    }

    const keys = Object.keys(obj).sort();
    const parts = [];

    keys.forEach(key => {
      const value = obj[key];
      if (value !== undefined && typeof value !== 'function') {
        const keyStr = JSON.stringify(key);
        const valStr = IdentityManager.stableStringify(value);
        parts.push(`${keyStr}:${valStr}`);
      }
    });

    return '{' + parts.join(',') + '}';
  }
}
