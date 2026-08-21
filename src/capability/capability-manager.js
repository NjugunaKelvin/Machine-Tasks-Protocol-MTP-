/**
 * @file capability-manager.js
 * @description Manages the registry of capabilities that an Executor advertises and enforces.
 *
 * A "capability" in MTP is a formal, typed contract between an Executor and the
 * outside world. It says: "Send me data matching this schema and I will do X."
 *
 * This module is responsible for two things:
 *   1. Registration: Accepting new capability definitions at startup and assigning them
 *      unique IDs so Requesters can reference them in task payloads.
 *   2. Validation: When a task arrives, confirming that the incoming payload matches the
 *      registered Zod schema before the handler is ever called.
 *
 * Separating capability definition from execution logic keeps the Executor clean.
 * The CapabilityManager is the gatekeeper; the Executor is the runner.
 *
 * Schemas are defined using Zod, a TypeScript-first runtime validation library that
 * works equally well in plain JavaScript. Zod schemas are:
 *   - Composable: Nest objects, arrays, unions, refinements freely
 *   - Precise: Return detailed, structured error messages on failure
 *   - Extensible: Add custom refinements (e.g. .refine(val => val > 0))
 *
 * For a full reference on writing Zod schemas, see: https://zod.dev
 */

import { z } from 'zod';

/**
 * @class CapabilityManager
 * @classdesc Holds the catalogue of skills an Executor possesses and validates incoming inputs.
 *
 * Think of this as the Executor's "menu". Each registered capability is a menu item with
 * a strict input format. If a Requester sends data that does not match the format, the
 * request is rejected before any business logic runs. This prevents malformed inputs
 * from causing cryptic runtime errors deep inside your handler functions.
 *
 * @example
 * const identity = new IdentityManager('MyService');
 * const caps = new CapabilityManager(identity.getIdentity());
 *
 * const cap = caps.registerCapability(
 *   'Summarize',
 *   z.object({ text: z.string().min(1) }),
 *   z.object({ summary: z.string() }),
 *   { maxTokens: 1000, costPerOp: 0.002 }
 * );
 *
 * caps.validateCapability(cap.id, { text: 'Hello world' }); // passes
 * caps.validateCapability(cap.id, { text: 123 });           // throws ZodError
 */
export class CapabilityManager {
  /**
   * Creates a CapabilityManager for the given Executor identity.
   *
   * @param {{ id: string, publicKey: string }} identity - The public identity of the Executor.
   *   This is embedded in the discovery document so Requesters know who owns these capabilities.
   */
  constructor(identity) {
    this.identity = identity;

    /**
     * Internal in-memory registry of all capabilities registered on this Executor.
     *
     * Each entry stores both the public-facing metadata (id, name, description, constraints)
     * and the internal Zod schema objects (prefixed with underscore to signal they are private).
     * The Zod objects are never serialized or sent over the network; they are only used
     * for validation at runtime.
     *
     * In a distributed system backed by multiple Executor instances, you would replace this
     * array with a shared store (e.g. Redis) so all instances have the same capability list.
     *
     * @type {Array<Object>}
     */
    this.capabilities = [];
  }

  /**
   * Registers a new capability on this Executor.
   *
   * Call this once per capability during your service's startup phase, before accepting
   * any requests. Each call assigns a unique ID to the capability based on its name and
   * the current timestamp. The ID is what Requesters use to reference the capability in
   * their task payloads.
   *
   * The generated ID follows the pattern: cap_<normalized_name>_<timestamp>
   * For example: "cap_image_resize_1709823423000"
   *
   * @param {string} name - Human-readable capability name. Use PascalCase or Title Case.
   *   Examples: "ImageResize", "SentimentAnalysis", "RiskScore".
   * @param {import('zod').ZodSchema} inputSchema - A Zod schema object describing the expected input.
   *   The schema is used to validate every incoming payload before your handler is called.
   * @param {import('zod').ZodSchema} outputSchema - A Zod schema object describing the output shape.
   *   This is stored for documentation purposes in this version. Future versions will validate
   *   handler return values against it before signing the result.
   * @param {Object} [constraints={}] - Optional operational constraints.
   *   These are included in the discovery document so Requesters know what to expect.
   * @param {number} [constraints.costPerOp] - Price per task execution (in your chosen unit).
   * @param {number} [constraints.timeoutMs] - Maximum execution time in milliseconds.
   * @param {number} [constraints.maxPayloadBytes] - Maximum size of the input payload.
   * @returns {Object} The registered capability object including its generated ID.
   */
  registerCapability(name, inputSchema, outputSchema, constraints = {}) {
    // Build a URL-safe, lowercase ID from the capability name by replacing whitespace
    // with underscores. Append a timestamp to avoid collisions if the same name is
    // registered twice (e.g. during hot-reload in development).
    const capabilityId = `cap_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;

    const capability = {
      id: capabilityId,
      name,
      description: `Capability for ${name}`,
      constraints,

      // These internal fields hold the actual Zod schema instances. They are prefixed
      // with underscore to make it clear they are for internal use only and should not
      // appear in any API response or log output.
      _inputSchemaZod: inputSchema,
      _outputSchemaZod: outputSchema,
    };

    this.capabilities.push(capability);
    console.log(`[CapabilityManager] Registered capability: "${name}" (${capabilityId})`);
    return capability;
  }

  /**
   * Builds and returns the public discovery document for this Executor.
   *
   * The discovery document is a serializable JSON object that Requesters and registries
   * use to learn what this Executor can do and how to reach it. Internal Zod schema
   * objects are stripped out so the document is safe to send over the network or store
   * in a registry database.
   *
   * In a future version this method will convert Zod schemas to JSON Schema (draft-07)
   * objects so that Requesters in other languages can validate locally before submitting.
   *
   * @returns {{ executorId: string, capabilities: Array<Object>, timestamp: number }}
   *   A plain object containing the executor's DID, its list of public capabilities, and
   *   the time the document was generated.
   */
  getCapabilities() {
    return {
      executorId: this.identity.id,
      capabilities: this.capabilities.map(cap => {
        // Destructure to separate out private Zod objects from public properties
        const { _inputSchemaZod, _outputSchemaZod, ...publicProps } = cap;
        return {
          ...publicProps,
          // Placeholder for future JSON Schema export. When implemented, this field
          // will contain the full JSON Schema representation of the input and output.
          schemaDescription: 'Validators are internal to Executor instance',
        };
      }),
      timestamp: Date.now(),
    };
  }

  /**
   * Validates a payload against a registered capability's input schema.
   *
   * This is the enforcement step. It is called by the Executor before running any handler.
   * If the payload does not satisfy every constraint in the Zod schema, a ZodError is thrown
   * with a human-readable message describing every validation failure. This message is safe
   * to return to the Requester as part of a signed error response.
   *
   * Zod's parse() method also strips unknown fields by default, which prevents payload
   * injection attacks where a Requester sends extra keys hoping they will be used by
   * the handler without validation.
   *
   * @param {string} capabilityId - The ID returned when the capability was registered.
   * @param {Object} input - The raw payload object from the task submission.
   * @returns {Object} The parsed, validated, and stripped data object safe to pass to the handler.
   * @throws {Error} If no capability with the given ID is found.
   * @throws {import('zod').ZodError} If the input fails schema validation.
   */
  validateCapability(capabilityId, input) {
    const cap = this.capabilities.find(c => c.id === capabilityId);

    if (!cap) {
      // This should not happen in normal operation because the Executor checks for the
      // handler's existence before calling validateCapability. But it is a useful guard
      // if someone calls this method directly.
      throw new Error(`Capability not found: ${capabilityId}`);
    }

    // Zod's parse() throws a ZodError on failure. That error has a .message property
    // with a human-readable description of every field that failed, which the Executor
    // will include in the signed failure response sent back to the Requester.
    return cap._inputSchemaZod.parse(input);
  }
}
