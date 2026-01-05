/**
 * @file capability-manager.js
 * @description Manages the registry of capabilities that an Executor can perform.
 * It handles the definition, storage, and validation of standardized tasks.
 * MTP relies on strict schemas to ensure Executors don't crash on malformed inputs.
 */

import { z } from 'zod';

/**
 * @class CapabilityManager
 * @classdesc Holds the list of abilities (skills) an Executor possesses.
 * It acts as a gatekeeper, ensuring any incoming task matches a registered capability's schema.
 */
export class CapabilityManager {
    /**
     * Creates a CapabilityManager.
     * @param {Object} identity - The public identity of the Executor (id and publicKey).
     */
    constructor(identity) {
        /** @property {Object} identity - Reference to the executor's identity. */
        this.identity = identity;

        /** 
         * @property {Array} capabilities - In-memory storage of capability definitions. 
         * In a distributed system, this might be backed by a Redis or database layer.
         */
        this.capabilities = [];
    }

    /**
     * Registers a new capability that this Executor can handle.
     * 
     * @param {string} name - Human-readable name (e.g., 'ImageResize', 'SentimentAnalysis').
     * @param {z.Schema} inputSchema - A Zod schema defining the expected input structure.
     * @param {z.Schema} outputSchema - A Zod schema defining the guaranteed output structure.
     * @param {Object} [constraints={}] - Operational constraints (e.g., cost, timeout).
     * @returns {Object} The registered capability object including its unique ID.
     */
    registerCapability(name, inputSchema, outputSchema, constraints = {}) {
        // Generate a unique ID for this specific version of the capability.
        // If the schema changes, the ID should ideally change or have a version suffix.
        const capabilityId = `cap_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;

        const capability = {
            id: capabilityId,
            name,
            // We store the Zod schema object for internal validation...
            _inputSchemaZod: inputSchema,
            _outputSchemaZod: outputSchema,
            // ...and a description for external consumers (simplified for this prototype).
            // In a real implementation, we would convert Zod -> JSON Schema here.
            description: `Capability for ${name}`,
            constraints,
        };

        this.capabilities.push(capability);
        console.log(`[CapabilityManager] Registered: ${name} (${capabilityId})`);
        return capability;
    }

    /**
     * Generates a public catalogue of all registered capabilities.
     * This output is intended for the Discovery Layer.
     * 
     * @returns {Object} A signed-like object containing executor info and list of capabilities.
     */
    getCapabilities() {
        return {
            executorId: this.identity.id,
            // We strip out the internal Zod objects and return only serializable data
            capabilities: this.capabilities.map(cap => {
                const { _inputSchemaZod, _outputSchemaZod, ...publicProps } = cap;
                return {
                    ...publicProps,
                    // In a production specificaiton (OpenAPI/JSON Schema), we'd include the actual schema defs here.
                    // For this version, we leave strictly typed validation as an internal guarantee.
                    schemaDescription: "Validators are internal to Executor instance"
                };
            }),
            timestamp: Date.now()
        };
    }

    /**
     * Validates a payload against a specific capability's input schema.
     * 
     * @param {string} capabilityId - The ID of the capability to check against.
     * @param {Object} input - The standard input data received in the task.
     * @returns {Object} The parsed and validated data (Zod strips unknown fields by default).
     * @throws {Error} If capability is missing or validation fails.
     */
    validateCapability(capabilityId, input) {
        const cap = this.capabilities.find(c => c.id === capabilityId);

        if (!cap) {
            throw new Error(`Capability not found: ${capabilityId}`);
        }

        // strict() mode in Zod generally good for APIs to avoid unexpected injection,
        // but we rely on the schema passed in during registration.
        return cap._inputSchemaZod.parse(input);
    }
}
