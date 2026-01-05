/**
 * @file requester.js
 * @description Helper class for clients (Requesters) to interact with the MTP network.
 * Handles task creation (signing) and result verification.
 */

import { IdentityManager } from '../identity/identity-manager.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * @class Requester
 * @classdesc The client-side actor in the MTP system. 
 * Use this to generate secure task payloads that Executors will accept.
 */
export class Requester {
    /**
      * @param {string} name - Name of the requester identity.
     * @param {Object} [options] - Configuration options.
     * @param {Object} [options.keys] - Existing keys.
     */
    constructor(name, options = {}) {
        this.identity = new IdentityManager(name, options.keys);
    }

    /**
     * Creates a signed task object ready for submission.
     * 
     * @param {string} capabilityId - ID of the capability to invoke (found via Discovery).
     * @param {Object} payload - The input data for the task.
     * @param {string} [executorPublicKey] - Optional. If you want to encrypt for a specific executor (not impl in v1).
     * @returns {Object} The signed task object.
     */
    createTask(capabilityId, payload, executorPublicKey) {
        const taskData = {
            taskId: uuidv4(),
            requesterId: this.identity.id,
            capabilityId,
            payload,
            timestamp: Date.now()
        };

        // Sign the task so the Executor can verify it came from 'requesterId'
        // and hasn't been tampered with.
        const signature = this.identity.sign(taskData);

        return {
            ...taskData,
            signature,
            // We attach our public key so the Executor can verify the signature.
            // In a decentralized registry system, the Executor might look this up instead.
            publicKey: this.identity.publicKey
        };
    }

    /**
     * Verifies the result received from an Executor.
     * 
     * @param {Object} signedResult - The result object returned by the API.
     * @param {string} executorPublicKey - The public key of the Executor we expect a result from.
     * @returns {boolean} True if the result is authentic and untampered.
     */
    verifyResult(signedResult, executorPublicKey) {
        // Destructure to separate signature from the data
        const { signature, ...data } = signedResult;

        // Verify that the data + signature matches the executor's public key.
        return IdentityManager.verify(data, signature, executorPublicKey);
    }
}
