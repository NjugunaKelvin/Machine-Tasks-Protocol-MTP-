/**
 * @file executor.js
 * @description The core runtime for an MTP Executor node.
 *
 * An Executor is any service, agent, or device that is willing to perform typed,
 * signed tasks on behalf of authorized Requesters. It is the "server" side of the
 * MTP protocol.
 *
 * This file wires together the Identity Layer and Capability Layer into a single,
 * self-contained class that can be dropped into any Node.js HTTP server (Express,
 * Fastify, Hono, etc.) or invoked directly in tests or serverless functions.
 *
 * The lifecycle of a task through the Executor is a strict, ordered pipeline:
 *
 *   Step 1: IDENTITY VERIFICATION
 *     Confirm the task's cryptographic signature matches the attached public key.
 *     A failed signature means the task was either forged or tampered with in transit.
 *
 *   Step 2: CAPABILITY ROUTING
 *     Find the handler function registered for the requested capability ID.
 *     If the capability does not exist, return a signed error so the Requester knows
 *     this specific Executor cannot fulfill the request (not a network error).
 *
 *   Step 3: SCHEMA VALIDATION
 *     Run the payload through the Zod schema registered with the capability.
 *     Reject malformed input before any business logic is executed.
 *
 *   Step 4: EXECUTION
 *     Call the handler function with the validated payload.
 *     The handler is defined by the developer and contains the actual business logic.
 *
 *   Step 5: RESULT SIGNING
 *     Sign the result (or error) with the Executor's private key so the Requester
 *     can verify that the response came from this specific Executor and was not
 *     altered between the Executor and the Requester.
 *
 * Every step that fails produces a signed error response rather than an unsigned HTTP
 * error. This design means the Requester always has cryptographic evidence of what
 * happened, which is essential for auditing and dispute resolution.
 */

import { IdentityManager } from '../identity/identity-manager.js';
import { CapabilityManager } from '../capability/capability-manager.js';

/**
 * @class Executor
 * @classdesc An autonomous agent node in the MTP network that accepts, validates, and executes tasks.
 *
 * Create one Executor per service. Register your capabilities on startup. Then pass
 * incoming task payloads to executeTask() from your HTTP handler or any other transport.
 *
 * @example
 * import { Executor } from 'machine-tasks-protocol';
 * import { z } from 'zod';
 *
 * const executor = new Executor('AnalyticsNode');
 *
 * executor.addCapability(
 *   'SummarizeText',
 *   z.object({ text: z.string().min(1) }),
 *   z.object({ summary: z.string() }),
 *   async (payload) => {
 *     const summary = await myAiModel.summarize(payload.text);
 *     return { summary };
 *   }
 * );
 *
 * // In your Express route:
 * app.post('/task', async (req, res) => {
 *   const result = await executor.executeTask(req.body);
 *   res.json(result);
 * });
 */
export class Executor {
  /**
   * Creates an Executor instance and initializes its identity and capability registry.
   *
   * @param {string} name - The display name for this Executor node. Used in the DID and logs.
   * @param {Object} [options={}] - Optional configuration.
   * @param {Object} [options.keys] - Pre-existing key material (from secure storage).
   *   If omitted, a new RSA key pair is generated. See IdentityManager for the keys shape.
   */
  constructor(name, options = {}) {
    // Initialize this node's cryptographic identity. The identity gives this Executor
    // its globally unique DID and the ability to sign results.
    this.identity = new IdentityManager(name, options.keys);

    // Initialize the capability registry. We pass the public identity so it can be
    // included in discovery documents that are shared with Requesters and registries.
    this.capabilityManager = new CapabilityManager(this.identity.getIdentity());

    /**
     * Maps capability IDs to their handler functions.
     *
     * Using a Map (instead of a plain object) gives O(1) lookups and avoids any risk
     * of collisions with built-in Object prototype properties like "constructor".
     *
     * @type {Map<string, Function>}
     */
    this.handlers = new Map();
  }

  /**
   * Registers a capability and its implementation on this Executor.
   *
   * This is the primary setup method. Call it once per capability during startup.
   * Internally it delegates schema registration to the CapabilityManager and stores
   * the handler function in the handlers Map keyed by the generated capability ID.
   *
   * @param {string} name - Human-readable capability name (e.g. "ResizeImage", "RunInference").
   * @param {import('zod').ZodSchema} inputSchema - Zod schema that all incoming payloads must satisfy.
   * @param {import('zod').ZodSchema} outputSchema - Zod schema describing the shape of returned results.
   * @param {Function} handler - Async function that receives the validated payload and returns result data.
   *   Signature: async (payload: Object) => Promise<Object>
   *   Throw an Error from the handler to signal an execution failure. MTP will catch it and
   *   return a signed failure response to the Requester.
   * @returns {Object} The registered capability object (includes the generated capability ID).
   */
  addCapability(name, inputSchema, outputSchema, handler) {
    // Register the public metadata and schemas with the CapabilityManager.
    // This generates a unique ID that links the public definition to the private handler.
    const cap = this.capabilityManager.registerCapability(name, inputSchema, outputSchema);

    // Store the handler function internally, keyed by capability ID.
    // The handler is never exposed externally; only the Executor's executeTask() calls it.
    this.handlers.set(cap.id, handler);

    return cap;
  }

  /**
   * Runs the full MTP execution pipeline for a signed task.
   *
   * This is the single entry point for all incoming work. Pass the raw parsed JSON body
   * from your transport (HTTP, WebSocket, message queue) directly to this method.
   * It returns a signed result object regardless of success or failure, so your transport
   * layer can always call res.json(result) without any additional try/catch logic.
   *
   * The pipeline steps are described in detail in the file-level JSDoc above.
   *
   * @param {Object} signedTask - The task object created by a Requester via Requester.createTask().
   * @param {string} signedTask.taskId - UUID identifying this specific task invocation.
   * @param {string} signedTask.requesterId - DID of the Requester sending the task.
   * @param {string} signedTask.capabilityId - ID of the capability to invoke.
   * @param {Object} signedTask.payload - The input data for the capability.
   * @param {number} signedTask.timestamp - Unix timestamp (ms) when the task was created.
   * @param {string} signedTask.signature - Hex-encoded RSA-SHA256 signature over the task fields.
   * @param {string} signedTask.publicKey - PEM-encoded public key of the Requester for verification.
   * @returns {Promise<Object>} A signed result object with at minimum: taskId, executorId, status, timestamp, signature.
   *   On success: also contains a `result` field with the handler's return value.
   *   On failure: also contains an `error` field with a human-readable failure reason.
   */
  async executeTask(signedTask) {
    const { taskId, requesterId, capabilityId, payload, timestamp, signature, publicKey } = signedTask;

    // STEP 1: IDENTITY VERIFICATION (Identity Layer)
    //
    // Reconstruct the exact data object that the Requester signed. The field list here
    // must match the fields that Requester.createTask() passes to identity.sign() exactly.
    // Any mismatch (missing field, extra field, different value) will cause verification to fail.
    //
    // We do NOT include `signature` or `publicKey` in the verification payload because
    // those fields were added after signing and are not part of the signed message.
    const dataToVerify = { taskId, requesterId, capabilityId, payload, timestamp };

    const isValid = IdentityManager.verify(dataToVerify, signature, publicKey);

    if (!isValid) {
      // Return a signed failure response. The Requester can verify this response came
      // from this Executor, proving that the authentication failure happened here and
      // not somewhere else in the network. This is important for audit trails.
      return this._createSignedResult(taskId, 'failure', null, 'Invalid Task Signature: Authentication failed');
    }

    // STEP 2: CAPABILITY ROUTING
    //
    // Look up the handler function by capability ID. If the Requester specified a
    // capability that this Executor does not support, tell them clearly rather than
    // returning a generic 404. The signed response proves this Executor received and
    // rejected the request, not that the request was lost in transit.
    const handler = this.handlers.get(capabilityId);
    if (!handler) {
      return this._createSignedResult(
        taskId,
        'failure',
        null,
        `Capability '${capabilityId}' is not supported by this Executor.`
      );
    }

    // STEP 3: SCHEMA VALIDATION (Capability Layer)
    //
    // Validate the payload against the Zod schema before calling the handler.
    // This ensures the handler always receives well-formed input and never has to
    // do its own input validation. If the schema check fails, Zod throws a ZodError
    // whose .message property contains a human-readable description of each failure.
    try {
      this.capabilityManager.validateCapability(capabilityId, payload);
    } catch (e) {
      return this._createSignedResult(
        taskId,
        'failure',
        null,
        `Schema Validation Failed: ${e.message}`
      );
    }

    // STEP 4: EXECUTION (Execution Layer) and STEP 5: RESULT SIGNING (Verification Layer)
    //
    // Call the handler with the validated payload. If the handler throws for any reason
    // (business rule violation, external service failure, timeout, etc.), catch the error
    // and return a signed failure response. Do not let unhandled exceptions propagate to
    // the transport layer, as that would produce an unsigned response.
    try {
      const resultData = await handler(payload);

      // Execution succeeded. Sign the result so the Requester can verify it came from
      // this Executor and was not altered between here and the Requester.
      return this._createSignedResult(taskId, 'success', resultData);

    } catch (err) {
      // The handler threw an error. This is a well-defined failure mode. Return a signed
      // response so the Requester has cryptographic proof of what failed and where.
      return this._createSignedResult(taskId, 'failure', null, err.message);
    }
  }

  /**
   * Constructs and signs a result or error object.
   *
   * This private helper is called at the end of every code path in executeTask().
   * It ensures that every response leaving this Executor carries a valid cryptographic
   * signature, regardless of whether the task succeeded or failed.
   *
   * The signature is computed over the result object (excluding the signature field itself)
   * using the Executor's private RSA key. The Requester uses the Executor's public key
   * (obtained from the Discovery Layer) to verify the signature.
   *
   * @private
   * @param {string} taskId - ID of the task this result corresponds to.
   * @param {'success'|'failure'} status - The outcome of the task.
   * @param {Object|null} result - The result data returned by the handler (success only).
   * @param {string|null} error - Human-readable error message (failure only).
   * @returns {Object} The signed result object ready to be returned to the Requester.
   */
  _createSignedResult(taskId, status, result = null, error = null) {
    // Build the result object that will be signed. We construct it before signing so
    // the signature covers the complete, final response including the timestamp.
    const resultObject = {
      taskId,
      executorId: this.identity.id,
      status,
      timestamp: Date.now(),
    };

    // Attach either the result data or the error message depending on status.
    // We keep these in separate fields (result vs error) to make parsing unambiguous.
    if (status === 'success') {
      resultObject.result = result;
    } else {
      resultObject.error = error;
    }

    // Sign the result object. The signature is computed over the sorted canonical JSON
    // of resultObject. The Requester must exclude the `signature` field when verifying.
    const signature = this.identity.sign(resultObject);

    // Return the complete signed envelope. The signature is a separate top-level field,
    // not nested inside resultObject, so verification does not require any reconstruction.
    return {
      ...resultObject,
      signature,
    };
  }

  /**
   * Returns the public discovery document for this Executor.
   *
   * Share this with Requesters so they know this Executor's DID, public key,
   * and the list of capabilities it supports. In a networked deployment this is
   * typically served at a GET /discovery endpoint.
   *
   * @returns {{ identity: Object, capabilities: Object }} Public identity and capabilities.
   */
  getPublicInfo() {
    return {
      identity: this.identity.getIdentity(),
      capabilities: this.capabilityManager.getCapabilities(),
    };
  }
}
