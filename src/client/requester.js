/**
 * @file requester.js
 * @description The client-side actor in the MTP protocol.
 *
 * A Requester is any service, agent, or user application that wants to delegate
 * work to an MTP Executor. It does not perform tasks itself; it creates and sends
 * signed task payloads to Executor nodes over any transport (HTTP, WebSocket, etc.).
 *
 * The Requester's responsibilities are:
 *   1. Maintaining its own cryptographic identity (a key pair generated at startup)
 *   2. Creating task payloads that include a cryptographic signature, so Executors
 *      can confirm the task genuinely came from this Requester
 *   3. Verifying results returned by Executors, so the Requester knows the result
 *      came from the expected Executor and was not tampered with in transit
 *
 * The key insight is that the Requester never shares its private key. The Executor
 * verifies the Requester's signature using only the public key that is attached to
 * the task payload. This is the same trust model used by TLS certificates and SSH.
 */

import { IdentityManager } from '../identity/identity-manager.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * @class Requester
 * @classdesc The client-side identity for submitting tasks to MTP Executor nodes.
 *
 * Instantiate one Requester per application (or per user session if your system
 * requires per-user identity). The Requester generates its own RSA key pair and
 * uses it to sign every task it creates. Executors use the attached public key to
 * verify authenticity without any shared secret or API key exchange.
 *
 * @example
 * import { Requester } from 'machine-tasks-protocol';
 *
 * const client = new Requester('BillingService');
 *
 * // Build a signed task
 * const task = client.createTask('cap_calculate_tax_123', { amount: 500, region: 'EU' });
 *
 * // Send it to the Executor over HTTP
 * const res = await fetch('https://taxbot.internal/task', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify(task),
 * });
 * const signedResult = await res.json();
 *
 * // Verify the result
 * const executorPubKey = discoveryDoc.identity.publicKey;
 * if (client.verifyResult(signedResult, executorPubKey)) {
 *   console.log('Trusted result:', signedResult.result);
 * }
 */
export class Requester {
  /**
   * Creates a Requester instance with its own cryptographic identity.
   *
   * @param {string} name - Human-readable label for this Requester (e.g. 'InvoiceApp', 'AgentAlpha').
   *   Used in the generated DID string for traceability in logs and audit records.
   * @param {Object} [options={}] - Optional configuration.
   * @param {Object} [options.keys] - Pre-existing key material to load instead of generating new keys.
   *   Shape: { id?: string, privateKey: string, publicKey: string }. See IdentityManager for details.
   */
  constructor(name, options = {}) {
    // Create this Requester's identity. The identity is what gives the Requester
    // the ability to sign tasks. Without a private key there is nothing to sign with.
    this.identity = new IdentityManager(name, options.keys);
  }

  /**
   * Creates a signed task payload ready to be submitted to an Executor.
   *
   * Internally this method:
   *   1. Generates a unique task ID (UUID v4) for this specific invocation
   *   2. Builds the task object with the requester's DID, capability ID, payload, and timestamp
   *   3. Signs the task object using the Requester's private RSA key
   *   4. Attaches the Requester's public key so the Executor can verify without a registry lookup
   *
   * The returned object should be sent as-is (JSON serialized) to the Executor's task endpoint.
   * Do not modify the returned object. Adding, removing, or changing any field will invalidate
   * the signature and cause the Executor to reject the task.
   *
   * @param {string} capabilityId - The capability ID to invoke. Obtain this from the Executor's
   *   discovery document (GET /discovery) under capabilities.capabilities[n].id.
   * @param {Object} payload - The input data for the capability. Must match the capability's
   *   registered Zod input schema or the Executor will return a validation failure.
   * @param {string} [executorPublicKey] - Reserved for future use (payload encryption).
   *   In the current version this parameter is accepted but not used.
   * @returns {Object} The fully signed task object.
   * @returns {string} .taskId - UUID v4 unique to this task invocation.
   * @returns {string} .requesterId - DID of this Requester.
   * @returns {string} .capabilityId - The capability being requested.
   * @returns {Object} .payload - The input data passed through unmodified.
   * @returns {number} .timestamp - Unix timestamp in milliseconds at the time of creation.
   * @returns {string} .signature - Hex-encoded RSA-SHA256 signature.
   * @returns {string} .publicKey - PEM-encoded RSA public key for the Executor to verify with.
   */
  createTask(capabilityId, payload, executorPublicKey) {
    // Build the core task object. This is the exact object that gets signed.
    // The order of fields does not matter for signing (stableStringify sorts keys),
    // but it is good practice to keep it consistent and readable.
    const taskData = {
      taskId: uuidv4(),
      requesterId: this.identity.id,
      capabilityId,
      payload,
      timestamp: Date.now(),
    };

    // Sign the task data with this Requester's private key. The Executor will use
    // the attached public key (below) to verify this signature before doing anything else.
    const signature = this.identity.sign(taskData);

    return {
      ...taskData,
      signature,
      // Attach the public key so the Executor can verify immediately without a
      // registry lookup. In a future version with a Decentralized Identifier (DID)
      // registry, the Executor would resolve the DID to get the public key instead.
      publicKey: this.identity.publicKey,
    };
  }

  /**
   * Verifies the cryptographic signature on a result returned by an Executor.
   *
   * Always call this before using any data from a signed result. Without verification
   * you cannot distinguish between:
   *   - A genuine result from the expected Executor
   *   - A result tampered with by a man-in-the-middle
   *   - A forged response from a malicious party
   *
   * The verification uses the Executor's public key, which you obtain from its discovery
   * document at startup and store locally. Do not use the public key embedded in the
   * result itself (there is none) since a forged result could include a forged key.
   *
   * @param {Object} signedResult - The result object returned by the Executor's task endpoint.
   *   Must contain a `signature` field plus all other result fields.
   * @param {string} executorPublicKey - PEM-encoded RSA public key of the Executor.
   *   Obtain this once from the Executor's GET /discovery endpoint and cache it locally.
   * @returns {boolean} True if the result is authentic and has not been tampered with.
   *   False if the signature is invalid, missing, or if the data was modified after signing.
   */
  verifyResult(signedResult, executorPublicKey) {
    // Destructure to separate the signature from the rest of the result data.
    // The Executor signed the result data WITHOUT the signature field, so we must
    // remove it before calling verify. Including the signature in the verification
    // data would create a circular dependency (the signature signed itself).
    const { signature, ...data } = signedResult;

    return IdentityManager.verify(data, signature, executorPublicKey);
  }
}
