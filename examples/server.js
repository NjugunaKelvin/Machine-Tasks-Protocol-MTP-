/**
 * @file server.js
 * @description MTP Reference Implementation: HTTP server wrapping an Executor.
 *
 * This file is a complete, working demonstration of how to integrate the MTP library
 * into an Express HTTP server. It shows the canonical patterns for:
 *
 *   1. Creating an Executor with named capabilities
 *   2. Exposing a GET /discovery endpoint so clients can find this server's capabilities
 *   3. Exposing a POST /submit-task endpoint that processes signed task payloads
 *   4. Simulating a full client interaction (Requester.createTask + result verification)
 *
 * Run this example with: npm run start:example
 *
 * Expected output:
 *   [Network] MTP Node listening on port 3000
 *   [System] Executor started. Capability: cap_mathadd_<timestamp>
 *   1. [Client] Fetching discovery info...
 *   2. [Client] Creating and signing task...
 *   3. [Client] Submitting task via HTTP...
 *   4. [Client] Received result: { ... }
 *   5. [Client] Signature Verification: VALID (Safe to use)
 *      [Client] Final Answer: 125
 *
 * Note: express and body-parser are devDependencies in this project. They are only
 * required to run this example, not to use the MTP library itself.
 */

import express from 'express';
import bodyParser from 'body-parser';
import { z } from 'zod';
import { Executor } from '../src/execution/executor.js';
import { Requester } from '../src/client/requester.js';

const app = express();
const port = 3000;

// Parse incoming request bodies as JSON
app.use(bodyParser.json());

// =============================================================================
// EXECUTOR SETUP
// Initialize the Executor and register its capabilities before starting the server.
// In production you would load keys from a secrets manager and register capabilities
// that wrap real business logic (database calls, AI inference, file processing, etc.).
// =============================================================================

const myExecutor = new Executor('AlphaNode');

// Define Zod schemas for the MathAdd capability.
// These schemas are the contract: any task payload must contain two numbers.
const AddInputSchema = z.object({
  a: z.number().describe('First number'),
  b: z.number().describe('Second number'),
});

const AddOutputSchema = z.object({
  answer: z.number().describe('The sum of a and b'),
});

// Register the MathAdd capability.
// The third argument is the handler: an async function that receives the validated
// payload and returns the result data. It can call any code: databases, ML models, APIs.
const mathCap = myExecutor.addCapability(
  'MathAdd',
  AddInputSchema,
  AddOutputSchema,
  async (payload) => {
    console.log(`[AlphaNode] Calculating ${payload.a} + ${payload.b}...`);
    // Simulate a short async operation (e.g. a database call or model inference)
    await new Promise(resolve => setTimeout(resolve, 100));
    return { answer: payload.a + payload.b };
  }
);

console.log(`[System] Executor started. Capability: ${mathCap.id}`);

// =============================================================================
// HTTP ENDPOINTS
// These are the two standard MTP endpoints. Every MTP-compliant Executor service
// should expose at minimum these two routes.
// =============================================================================

/**
 * GET /discovery
 *
 * Returns the public discovery document for this Executor. The document includes:
 *   - The Executor's DID and RSA public key
 *   - A list of all registered capabilities with their IDs and metadata
 *
 * Requesters call this endpoint once to learn what capabilities are available and
 * to get the Executor's public key for result verification.
 */
app.get('/discovery', (req, res) => {
  res.json(myExecutor.getPublicInfo());
});

/**
 * POST /submit-task
 *
 * The main task submission endpoint. Accepts a signed task object (created by
 * Requester.createTask()) and returns a signed result object.
 *
 * The Executor internally:
 *   1. Verifies the task signature
 *   2. Looks up the capability handler
 *   3. Validates the payload against the Zod schema
 *   4. Runs the handler
 *   5. Signs and returns the result
 *
 * Every response is a signed object. HTTP 500 is only returned for transport-level
 * errors (e.g. JSON parse failure), not for task-level failures (which return a
 * signed failure response with HTTP 200).
 */
app.post('/submit-task', async (req, res) => {
  try {
    // Pass the raw parsed JSON body directly to executeTask.
    // The Executor handles all authentication, validation, and execution internally.
    const result = await myExecutor.executeTask(req.body);
    res.json(result);
  } catch (error) {
    // This catch block handles unexpected transport errors, not task failures.
    // Task failures (bad signature, schema mismatch, handler error) are returned
    // as signed failure objects with HTTP 200 by the Executor.
    res.status(500).json({ error: `Transport error: ${error.message}` });
  }
});

// =============================================================================
// START SERVER AND RUN CLIENT DEMO
// Once the server is listening, run a simulated client interaction to demonstrate
// the full MTP round-trip in the console output.
// =============================================================================

app.listen(port, async () => {
  console.log(`[Network] MTP Node listening on port ${port}`);
  console.log('\n--- Starting Automatic Client Demo ---\n');
  await runClientDemo();
});

/**
 * Simulates a complete Requester interaction with this server.
 *
 * In a real application this code would live in a separate service or script.
 * It is included here so you can see the full protocol flow in a single file.
 *
 * Flow:
 *   1. Fetch the discovery document to learn the capability ID and executor public key
 *   2. Create a signed task using Requester.createTask()
 *   3. Send the task to POST /submit-task over HTTP
 *   4. Receive the signed result
 *   5. Verify the result signature using the executor's public key
 *   6. Use the result data if verification passes
 */
async function runClientDemo() {
  // Initialize the client with its own cryptographic identity
  const client = new Requester('ClientOne');

  // Step 1: Discovery
  // Fetch the server's public document to learn what capabilities it has and
  // to get the executor's public key for result verification later.
  console.log('1. [Client] Fetching discovery info...');
  const publicInfo = myExecutor.getPublicInfo();

  const targetCap = publicInfo.capabilities.capabilities.find(c => c.name === 'MathAdd');
  const executorPubKey = publicInfo.identity.publicKey;

  if (!targetCap) throw new Error('MathAdd capability not found in discovery document');
  console.log(`   [Client] Found capability: ${targetCap.name} (${targetCap.id})`);

  // Step 2: Task Creation
  // createTask() generates a UUID, attaches the requester's DID and the payload,
  // then signs the whole object. The returned task is ready to send over the wire.
  console.log('2. [Client] Creating and signing task...');
  const task = client.createTask(targetCap.id, { a: 50, b: 75 }, executorPubKey);

  // Step 3: Task Submission
  // Send the signed task to the Executor over HTTP. In production this would be
  // a real network request to the Executor's URL.
  console.log('3. [Client] Submitting task via HTTP...');
  let result;
  try {
    const response = await fetch(`http://localhost:${port}/submit-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    result = await response.json();
  } catch (e) {
    console.error('   [Client] HTTP Error:', e.message);
    return;
  }

  console.log('4. [Client] Received result:', JSON.stringify(result, null, 2));

  // Step 4: Result Verification
  // ALWAYS verify the result signature before using the data. This confirms the
  // result came from the expected Executor and was not altered in transit.
  const isVerified = client.verifyResult(result, executorPubKey);
  const integrityMsg = isVerified ? 'VALID (Safe to use)' : 'INVALID (Possible tampering!)';

  console.log(`5. [Client] Signature Verification: ${integrityMsg}`);

  if (isVerified && result.status === 'success') {
    console.log(`   [Client] Final Answer: ${result.result.answer}`);
  } else if (result.status === 'failure') {
    console.error(`   [Client] Task failed: ${result.error}`);
  }

  console.log('\n--- Demo Complete ---');
}
