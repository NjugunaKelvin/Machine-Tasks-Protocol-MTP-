import express from 'express';
import bodyParser from 'body-parser';
import { z } from 'zod';
// Create a relative import to the local source to simulate using the library
import { Executor } from '../src/execution/executor.js';
import { Requester } from '../src/client/requester.js';

/**
 * MTP Reference Implementation Server
 * 
 * This example shows how to wrap an MTP Executor in an HTTP server (Express).
 * It also includes a client simulation to demonstrate the full full flow.
 */

const app = express();
const port = 3000;

app.use(bodyParser.json());

// =================================================================
// 1. SETUP EXECUTOR
// =================================================================
// Initialize an executor. In production, you might load keys from environment variables.
const myExecutor = new Executor("AlphaNode");

// Define Schemas for a "MathAdd" Capability
const AddSchema = z.object({
    a: z.number().describe("First number"),
    b: z.number().describe("Second number")
});

const MathResultSchema = z.object({
    answer: z.number().describe("The sum of a and b")
});

// Register the capability with the Executor
const mathCap = myExecutor.addCapability(
    "MathAdd",
    AddSchema,
    MathResultSchema,
    async (payload) => {
        console.log(`[Logic] Calculating ${payload.a} + ${payload.b}...`);
        // Simulate complex work latency
        await new Promise(r => setTimeout(r, 100));
        return { answer: payload.a + payload.b };
    }
);

console.log(`[System] Executor started with Capability: ${mathCap.id}`);

// =================================================================
// 2. DEFINE HTTP ENDPOINTS (The "Task Submission Layer")
// =================================================================

// Discovery: Let clients know what we can do and who we are
app.get('/discovery', (req, res) => {
    res.json(myExecutor.getPublicInfo());
});

// Submission: The standardize endpoint for tasks
app.post('/submit-task', async (req, res) => {
    try {
        const signedTask = req.body;

        // The Executor handles all the cryptography, validation, and logic internally.
        // It returns a Signed Result.
        const result = await myExecutor.executeTask(signedTask);

        res.json(result);
    } catch (error) {
        // Catch-all for unexpected transport errors
        res.status(500).json({ error: error.message });
    }
});

// =================================================================
// 3. START SERVER & RUN CLIENT DEMO
// =================================================================
app.listen(port, async () => {
    console.log(`[Network] MTP Node listening on port ${port}`);

    console.log("\n--- Starting Automatic Client Demo ---\n");
    await runClientDemo();
});

/**
 * Simulates an external client discovering and using the service.
 */
async function runClientDemo() {
    const client = new Requester("ClientOne");

    // 1. Discovery Phase
    console.log("1. [Client] Fetching discovery info...");
    // In a real app, this would be: await fetch('http://localhost:3000/discovery');
    const publicInfo = myExecutor.getPublicInfo();

    // Choose the capability we want
    const targetCap = publicInfo.capabilities.capabilities.find(c => c.name === 'MathAdd');
    const executorPubKey = publicInfo.identity.publicKey;

    if (!targetCap) throw new Error("Capability not found!");
    console.log(`   [Client] Found Capability: ${targetCap.name} (${targetCap.id})`);

    // 2. Task Construction Phase
    console.log("2. [Client] Creating and signing task...");
    const payload = { a: 50, b: 75 };

    // Create a cryptographically secure task object
    const task = client.createTask(targetCap.id, payload, executorPubKey);

    // 3. Transmission Phase
    console.log("3. [Client] Submitting task via HTTP...");
    let result;
    try {
        // Simulating HTTP request
        const response = await fetch(`http://localhost:${port}/submit-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(task)
        });
        result = await response.json();
    } catch (e) {
        console.error("   [Client] HTTP Error:", e);
        return;
    }

    console.log("4. [Client] Received result:", JSON.stringify(result, null, 2));

    // 4. Verification Phase
    // The client MUST verify the signature to ensure the result is from the intended executor
    // and hasn't been tampered with in transit.
    const isVerified = client.verifyResult(result, executorPubKey);
    const integrityMsg = isVerified ? "✅ VALID (Safe to use)" : "❌ INVALID (Tampered!)";

    console.log(`5. [Client] Signature Verification: ${integrityMsg}`);

    if (isVerified && result.status === 'success') {
        console.log(`   [Client] Final Answer: ${result.result.answer}`);
    }

    console.log("\n--- Demo Complete ---");
}
