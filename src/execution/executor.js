/**
 * @file executor.js
 * @description The core runtime for the MTP Executor.
 * It integrates Identity and Capability management to securely process incoming tasks.
 * It is responsible for the "Execution Layer" and "Result Verification Layer" of the protocol.
 */

import { IdentityManager } from '../identity/identity-manager.js';
import { CapabilityManager } from '../capability/capability-manager.js';

/**
 * @class Executor
 * @classdesc Represents an autonomous agent or service node in the MTP network.
 * It accepts signed tasks, validates them, executes logic, and returns signed results.
 */
export class Executor {
    /**
     * Creates an Executor instance.
     * 
     * @param {string} name - The display name for this executor.
     * @param {Object} [options] - Configuration options.
     * @param {Object} [options.keys] - Existing keys to persist identity.
     */
    constructor(name, options = {}) {
        // Initialize Identity Layer
        this.identity = new IdentityManager(name, options.keys);

        // Initialize Capability Layer (Advertising what we can do)
        // We pass our public identity so it can be embedded in discovery docs.
        this.capabilityManager = new CapabilityManager(this.identity.getIdentity());

        // Internal registry mapping Capability IDs -> Implementation Functions.
        // This allows us to have different code logic for different capabilities.
        this.handlers = new Map();
    }

    /**
     * Registers a skill/capability and its implementation.
     * 
     * @param {string} name - Name of the capability.
     * @param {Object} inputSchema - Zod schema for input.
     * @param {Object} outputSchema - Zod schema for output.
     * @param {Function} handler - Async function (payload) => Promise<result>.
     * @returns {Object} The registered capability object.
     */
    addCapability(name, inputSchema, outputSchema, handler) {
        // 1. Register public definition
        const cap = this.capabilityManager.registerCapability(name, inputSchema, outputSchema);

        // 2. Register internal handler
        this.handlers.set(cap.id, handler);

        return cap;
    }

    /**
     * The core pipeline for executing a task.
     * This method:
     * 1. Verifies the cryptographic signature of the task.
     * 2. Checks if the capability exists.
     * 3. Validates the payload against the schema.
     * 4. Runs the handler function.
     * 5. Signs the result.
     * 
     * @param {Object} signedTask - The task object from a Requester.
     * @returns {Promise<Object>} The signed result object.
     */
    async executeTask(signedTask) {
        const { taskId, requesterId, capabilityId, payload, timestamp, signature, publicKey } = signedTask;

        // ---------------------------------------------------------
        // STEP 1: SECURITY CHECK (Identity Layer)
        // ---------------------------------------------------------
        // We must verify the sender IS who they say they are.
        // In a real system, we'd also check 'requesterId' against a blocklist or whitelist.

        // Reconstruct the payload that was signed.
        // IMPT: The order and content must match exactly what the client signed.
        const dataToVerify = { taskId, requesterId, capabilityId, payload, timestamp };

        const isValid = IdentityManager.verify(dataToVerify, signature, publicKey);

        if (!isValid) {
            // We return a failure result signed by us, so the client knows WE rejected it
            // (as opposed to a network error).
            return this._createSignedResult(taskId, 'failure', null, 'Invalid Task Signature: Auth Failed');
        }

        // ---------------------------------------------------------
        // STEP 2: CAPABILITY LOOKUP (Discovery/Routing)
        // ---------------------------------------------------------
        const handler = this.handlers.get(capabilityId);
        if (!handler) {
            return this._createSignedResult(taskId, 'failure', null, `Capability '${capabilityId}' not supported by this executor.`);
        }

        // ---------------------------------------------------------
        // STEP 3: SCHEMA VALIDATION (Capability Layer)
        // ---------------------------------------------------------
        try {
            this.capabilityManager.validateCapability(capabilityId, payload);
        } catch (e) {
            // Validation errors are deterministic failures, good to return detailed info.
            return this._createSignedResult(taskId, 'failure', null, `Schema Validation Failed: ${e.message}`);
        }

        // ---------------------------------------------------------
        // STEP 4: EXECUTION (Execution Layer)
        // ---------------------------------------------------------
        try {
            const resultData = await handler(payload);

            // ---------------------------------------------------------
            // STEP 5: RESULT SIGNING (Verification Layer)
            // ---------------------------------------------------------
            // Success! Sign the result so the client knows it came from us.
            return this._createSignedResult(taskId, 'success', resultData);

        } catch (err) {
            // Internal code error or execution constraint failure.
            return this._createSignedResult(taskId, 'failure', null, err.message);
        }
    }

    /**
     * Helper method to construct and sign the result object.
     * 
     * @private
     * @param {string} taskId - ID of the task being responded to.
     * @param {string} status - 'success' or 'failure'.
     * @param {Object} [result] - The actual data (if success).
     * @param {string} [error] - Error message (if failure).
     * @returns {Object} Signed result object.
     */
    _createSignedResult(taskId, status, result = null, error = null) {
        const resultObject = {
            taskId,
            executorId: this.identity.id,
            status,
            timestamp: Date.now()
        };

        if (status === 'success') {
            resultObject.result = result;
        } else {
            resultObject.error = error;
        }

        // Sign the result to guarantee integrity.
        const signature = this.identity.sign(resultObject);

        return {
            ...resultObject,
            signature
        };
    }

    /**
     * Returns the discovery document for this Executor.
     */
    getPublicInfo() {
        return {
            identity: this.identity.getIdentity(),
            capabilities: this.capabilityManager.getCapabilities()
        }
    }
}
