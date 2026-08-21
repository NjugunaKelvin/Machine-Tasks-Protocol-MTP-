# Machine Task Protocol (MTP)

> The standard for authenticated, verifiable, and structured machine-to-machine task delegation.

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/Status-Stable-brightgreen)]()

MTP is a lightweight, cryptographically secure protocol for the age of autonomous agents. It lets services (Executors) and clients (Requesters) communicate with **proof of identity**, **schema enforcement**, and **non-repudiation**, without relying on shared API keys or centralized OAuth infrastructure.

Every task in MTP is signed by the sender. Every result is signed by the executor. Both sides can independently prove what was sent, what was agreed to, and what was returned, with no central authority in the loop.

---

## Table of Contents

- [Why MTP?](#why-mtp)
- [Core Concepts](#core-concepts)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Use Cases](#use-cases)
- [Advanced Usage](#advanced-usage)
- [API Reference](#api-reference)
- [Security Model](#security-model)
- [Contributing](#contributing)
- [License](#license)

---

## Why MTP?

Standard REST APIs are great for data. They are not designed for autonomous task delegation where you need to prove:

- **Who sent the request** (not just "someone with an API key")
- **What was agreed to** (the exact payload that was signed)
- **Who produced the response** (not just "the server returned 200")
- **Whether the result was tampered with** between the executor and the caller

MTP adds a cryptographic layer on top of any transport. The result is a full audit trail that is mathematically provable, even if your logs are compromised.

| Feature | Standard API (REST/RPC) | Machine Task Protocol (MTP) |
| :--- | :--- | :--- |
| **Authentication** | API Keys (can be leaked or shared) | RSA Signatures (private key never leaves the device) |
| **Input Validation** | Manual checks in each controller | Automatic via Zod schema enforcement |
| **Trust Model** | "Trust me, I sent the right data" | Cryptographic proof via signature verification |
| **Auditability** | Server logs (can be altered) | Signed receipts (mathematically verifiable) |
| **Message Structure** | Loose JSON | Standardized Task and Result objects |

---

## Core Concepts

### Executor

An Executor is any node (HTTP server, AI agent, IoT device, cloud function) that performs work. It advertises a list of **Capabilities** describing the tasks it can handle, and it signs every result it produces.

### Capability

A Capability is a typed contract. It specifies:
- **Input Schema**: The exact shape of data required to invoke the task (validated with Zod)
- **Output Schema**: The shape of the data the executor will return
- **Constraints**: Metadata such as cost per operation or execution timeout

### Requester

A Requester is any client that wants to delegate work. It generates signed task payloads and verifies the results it receives. It never shares its private key.

### Signed Task

A task payload produced by a Requester. It contains the target capability ID, the input data, a timestamp, and an RSA-SHA256 signature computed over all of those fields. Executors verify the signature before touching the payload.

### Signed Result

The response produced by an Executor after completing a task. It contains the result data (or error), a timestamp, and an RSA-SHA256 signature computed using the Executor's private key. Requesters verify this signature before using the result.

---

## How It Works

The MTP execution pipeline has five steps. The Executor runs them automatically when `executeTask()` is called.

```
Requester                                   Executor
   |                                            |
   |  createTask(capabilityId, payload)         |
   |  Signs: { taskId, requesterId,            |
   |           capabilityId, payload,          |
   |           timestamp }                     |
   |                                           |
   |  POST /submit-task ─────────────────────► |
   |                                           |  Step 1: Verify task signature
   |                                           |  Step 2: Look up capability handler
   |                                           |  Step 3: Validate payload vs Zod schema
   |                                           |  Step 4: Run handler(validatedPayload)
   |                                           |  Step 5: Sign result and return
   |                                           |
   |  ◄──────────────────────── signedResult   |
   |                                           |
   |  verifyResult(result, executorPublicKey)  |
   |  Use result.result if verified            |
```

---

## Installation

```bash
npm install machine-tasks-protocol
```

Requires Node.js 18 or higher. No native addons required. The core library depends only on `uuid` and `zod`.

For local development or to run the examples:

```bash
git clone https://github.com/NjugunaKelvin/Machine-Tasks-Protocol-MTP-.git
cd Machine-Tasks-Protocol-MTP-
npm install
```

---

## Quick Start

### 1. Set up an Executor (server side)

```javascript
import { Executor } from 'machine-tasks-protocol';
import { z } from 'zod';

const mathAgent = new Executor('MathWizard_v1');

const SumInput = z.object({
  a: z.number().describe('First number'),
  b: z.number().describe('Second number'),
});

const SumOutput = z.object({
  total: z.number(),
  calculatedAt: z.string(),
});

const cap = mathAgent.addCapability(
  'CalculateSum',
  SumInput,
  SumOutput,
  async (payload) => ({
    total: payload.a + payload.b,
    calculatedAt: new Date().toISOString(),
  })
);

console.log('Capability ID:', cap.id);
console.log('Public identity:', mathAgent.getPublicInfo().identity.id);
```

### 2. Expose it over HTTP (Express example)

```javascript
import express from 'express';

const app = express();
app.use(express.json());

app.get('/discovery', (req, res) => {
  res.json(mathAgent.getPublicInfo());
});

app.post('/task', async (req, res) => {
  const result = await mathAgent.executeTask(req.body);
  res.json(result);
});

app.listen(3000);
```

### 3. Set up a Requester (client side)

```javascript
import { Requester } from 'machine-tasks-protocol';

const client = new Requester('InvoiceApp');

// Fetch the capability ID and executor public key from the discovery endpoint
const discovery = await fetch('http://localhost:3000/discovery').then(r => r.json());
const capId = discovery.capabilities.capabilities[0].id;
const executorPubKey = discovery.identity.publicKey;

// Create a signed task
const task = client.createTask(capId, { a: 100, b: 550 });

// Submit it
const result = await fetch('http://localhost:3000/task', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(task),
}).then(r => r.json());

// Verify the result before using it
const isAuthentic = client.verifyResult(result, executorPubKey);

if (isAuthentic && result.status === 'success') {
  console.log('Total:', result.result.total);
} else if (!isAuthentic) {
  console.error('SECURITY ALERT: Result signature invalid. Possible tampering.');
} else {
  console.error('Task failed:', result.error);
}
```

---

## Use Cases

### AI Agent Orchestration

An orchestrator agent breaks a complex job into subtasks and delegates each to a specialist executor. Each delegation is a signed task. Each result comes back with a signature the orchestrator verifies before trusting. You get a complete, tamper-proof log of what each agent was asked to do and what it returned, without any central coordinator.

```javascript
// Orchestrator creates specialist agents
const summarizerAgent = new Executor('Summarizer');
const classifierAgent = new Executor('Classifier');

summarizerAgent.addCapability('SummarizeText', TextSchema, SummarySchema,
  async ({ text }) => ({ summary: await llm.summarize(text) })
);

classifierAgent.addCapability('ClassifyIntent', SummarySchema, IntentSchema,
  async ({ summary }) => ({ intent: await llm.classify(summary) })
);
```

### Zero-Trust Microservices

Replace API keys between internal services with RSA signatures. No API key rotation, no shared secrets. Each service has its own key pair. When ServiceA calls ServiceB, ServiceB verifies the signature and knows definitively that ServiceA, specifically, sent that exact payload.

```javascript
// BillingService sends a signed task to TaxService
const billingClient = new Requester('BillingService');
const task = billingClient.createTask(taxCapId, {
  amount: 9999,
  region: 'EU',
  currency: 'EUR',
});

// TaxService executor verifies the signature internally
const result = await taxExecutor.executeTask(task);
```

### IoT and Edge Device Networks

Devices in a mesh network delegate computation to capable nodes without a central broker. A sensor node with limited CPU can delegate signal processing to a more powerful edge node. The signed task proves which device made the request. The signed result proves which node performed the work.

```javascript
const processingNode = new Executor('EdgeNode_GPU');
processingNode.addCapability('ProcessSignal',
  z.object({ readings: z.array(z.number()), sampleRate: z.number() }),
  z.object({ peaks: z.array(z.number()), rms: z.number() }),
  async ({ readings, sampleRate }) => analyzeSignal(readings, sampleRate)
);
```

### Blockchain Oracles and Off-Chain Compute

Smart contracts need data from the real world. An MTP Executor acts as a trusted oracle: it signs every result it produces, and the on-chain contract or off-chain verifier can check the signature to confirm the data came from a specific, known node. The signed result object is itself an attestation.

```javascript
const priceOracle = new Executor('ChainlinkStyle_Oracle');
priceOracle.addCapability('GetTokenPrice',
  z.object({ symbol: z.string() }),
  z.object({ price: z.number(), source: z.string(), timestamp: z.number() }),
  async ({ symbol }) => {
    const price = await fetchFromMultipleSources(symbol);
    return { price, source: 'aggregated', timestamp: Date.now() };
  }
);
// The signed result is an on-chain-ready attestation
```

### Healthcare and Compliance Pipelines

In regulated industries every data transformation needs an audit trail. MTP provides one by default. A diagnostic pipeline can delegate lab analysis to a certified executor node. The signed task proves what data was submitted. The signed result proves what the certified node computed. Neither can be altered without breaking the signature.

```javascript
const labAnalyzer = new Executor('CertifiedLabNode');
labAnalyzer.addCapability('AnalyzeBloodPanel',
  z.object({ patientId: z.string().uuid(), markers: z.array(z.number()) }),
  z.object({ risks: z.array(z.string()), recommendation: z.string() }),
  async (data) => certifiedAnalysis(data)
);
```

### Financial Risk Calculation

A trading system needs a signed, attributable risk score before executing an order. The risk engine runs as an MTP Executor. Every risk score it produces is signed. If a trade goes wrong, you can produce the signed task (what data was sent) and the signed result (what score was returned), and prove exactly what happened.

```javascript
const riskEngine = new Executor('RiskEngine_v3');
riskEngine.addCapability('CalculateRisk',
  z.object({
    symbol: z.string(),
    quantity: z.number().positive(),
    portfolioValue: z.number().positive(),
  }),
  z.object({ riskScore: z.number().min(0).max(1), approved: z.boolean() }),
  async ({ symbol, quantity, portfolioValue }) => {
    const exposure = (quantity * await getPrice(symbol)) / portfolioValue;
    return { riskScore: exposure, approved: exposure < 0.05 };
  }
);
```

---

## Advanced Usage

### Persisting Identity Across Restarts

By default, each `new Executor()` generates a fresh key pair. In production you need a stable identity. Save the keys once and load them on every startup.

```javascript
import fs from 'fs';

// On first startup, save the keys
const executor = new Executor('StableNode');
fs.writeFileSync('keys.json', JSON.stringify({
  id: executor.identity.id,
  publicKey: executor.identity.publicKey,
  privateKey: executor.identity.privateKey,
}));

// On subsequent startups, load the saved keys
const savedKeys = JSON.parse(fs.readFileSync('keys.json', 'utf8'));
const executor = new Executor('StableNode', { keys: savedKeys });
```

In production, store the private key in a secrets manager (AWS Secrets Manager, HashiCorp Vault, Azure Key Vault) rather than a local file.

### Rich Zod Schema Constraints

Zod supports powerful validation rules. You can enforce business rules in the schema itself so your handler never receives invalid data.

```javascript
const UserTaskSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/),
  email: z.string().email(),
  plan: z.enum(['free', 'pro', 'enterprise']),
  metadata: z.object({
    loginCount: z.number().int().nonnegative(),
  }).optional(),
});

executor.addCapability('UpdateUser', UserTaskSchema, ResponseSchema, async (data) => {
  // At this point 'data' is guaranteed to satisfy every constraint above.
  // No need for manual validation inside the handler.
  await db.updateUser(data);
  return { updated: true };
});
```

### Handling Replay Attacks

MTP includes a `timestamp` field on every task. Add a middleware check in your handler to reject tasks that are too old.

```javascript
const FIVE_MINUTES_MS = 5 * 60 * 1000;

executor.addCapability('SensitiveOp', InputSchema, OutputSchema, async (payload, context) => {
  const taskAge = Date.now() - context.timestamp;
  if (taskAge > FIVE_MINUTES_MS) {
    throw new Error('Task timestamp is too old. Possible replay attack.');
  }
  return doSensitiveWork(payload);
});
```

### Framework-Agnostic Transport

MTP does not care how tasks arrive. Any transport that can carry JSON works.

```javascript
// Express
app.post('/task', async (req, res) => res.json(await executor.executeTask(req.body)));

// Fastify
fastify.post('/task', async (request) => executor.executeTask(request.body));

// AWS Lambda
export const handler = async (event) => ({
  statusCode: 200,
  body: JSON.stringify(await executor.executeTask(JSON.parse(event.body))),
});

// WebSocket (ws library)
ws.on('message', async (data) => {
  const result = await executor.executeTask(JSON.parse(data));
  ws.send(JSON.stringify(result));
});

// Message Queue (e.g. RabbitMQ consumer)
channel.consume(queue, async (msg) => {
  const result = await executor.executeTask(JSON.parse(msg.content));
  channel.sendToQueue(replyQueue, Buffer.from(JSON.stringify(result)));
});
```

---

## API Reference

### `Executor`

The server-side class for service providers.

| Method | Description |
| :--- | :--- |
| `new Executor(name, [options])` | Creates an Executor with its own cryptographic identity. Pass `options.keys` to restore a persisted identity. |
| `addCapability(name, inputSchema, outputSchema, handler)` | Registers a named capability with Zod schemas and an async handler function. Returns the capability object including its generated ID. |
| `executeTask(signedTask)` | Runs the full MTP pipeline (verify signature, route, validate, execute, sign result). Always returns a signed result object. |
| `getPublicInfo()` | Returns the public discovery document: identity (DID + public key) and capability list. |

### `Requester`

The client-side class for task consumers.

| Method | Description |
| :--- | :--- |
| `new Requester(name, [options])` | Creates a Requester with its own cryptographic identity. |
| `createTask(capabilityId, payload)` | Builds and signs a task payload. Returns the signed task object ready to submit. |
| `verifyResult(signedResult, executorPublicKey)` | Returns `true` if the result signature is valid for the given public key. Always call this before using result data. |

### `IdentityManager`

Low-level cryptographic primitives. You do not normally use this directly.

| Method | Description |
| :--- | :--- |
| `new IdentityManager(name, [existingKeys])` | Generates (or restores) an RSA-2048 key pair and a DID. |
| `sign(data)` | Signs an object or primitive. Returns a hex-encoded RSA-SHA256 signature. |
| `IdentityManager.verify(data, signature, publicKey)` | Static. Returns `true` if the signature is valid for the data and public key. |
| `getIdentity()` | Returns `{ id, publicKey }`. Safe to share publicly. |

### `CapabilityManager`

Used internally by `Executor`. You do not normally use this directly.

| Method | Description |
| :--- | :--- |
| `registerCapability(name, inputSchema, outputSchema, [constraints])` | Registers a capability and returns its metadata with a generated ID. |
| `validateCapability(capabilityId, input)` | Parses and validates input against the registered Zod schema. Throws on failure. |
| `getCapabilities()` | Returns the public discovery document for this executor's capabilities. |

---

## Security Model

### Cryptographic Primitives

MTP uses RSA-2048 with SHA-256 (RS256) via Node.js's built-in `crypto` module. No third-party cryptography dependencies are required.

### What Is Signed

On the Requester side, the following fields are signed: `taskId`, `requesterId`, `capabilityId`, `payload`, `timestamp`. The `signature` and `publicKey` fields are not part of the signed data.

On the Executor side, the following fields are signed: `taskId`, `executorId`, `status`, `timestamp`, and either `result` or `error`. The `signature` field is not part of the signed data.

### Deterministic Serialization

JSON key ordering is not guaranteed across languages and serializers. MTP uses a recursive key-sorting serializer (`stableStringify`) before computing any signature. This ensures two objects with the same data but different key insertion order produce identical signatures, which is critical for cross-language compatibility.

### Replay Attacks

Tasks include a `timestamp` (Unix milliseconds). Executors should reject tasks older than a defined window (5 minutes is a sensible default) and optionally track seen `taskId` values to prevent exact replay. The current implementation includes the timestamp but does not enforce a window by default. Add this check in your handler or as a wrapper.

### Man-in-the-Middle

All payloads are signed. TLS should be used at the transport layer for privacy, but the MTP signature ensures integrity even over an insecure channel. A MITM can observe the data but cannot alter it without breaking the signature.

### Key Storage

Private keys are generated in memory. In production, private keys must be stored in a hardware security module (HSM), a secrets manager, or an encrypted keystore. Never commit private key material to source control or include it in environment variables without encryption.

---

## Running Tests

```bash
npm test
```

The test suite uses Node.js's built-in test runner (no external test framework). Tests cover identity management, capability registration and validation, the full executor pipeline, and the requester round-trip.

## Running the Example

```bash
npm run start:example
```

This starts an Express server on port 3000 and immediately runs a client simulation demonstrating the full MTP flow: discovery, task creation, submission, and result verification.

---

## Contributing

Contributions are welcome. MTP is designed to be the backbone of agent communication.

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/Machine-Tasks-Protocol-MTP-.git`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Install dependencies: `npm install`
5. Make your changes and run the tests: `npm test`
6. Submit a pull request

### Guidelines

- Security first: changes to `identity-manager.js` require careful review and must not weaken the signing or verification logic.
- Do not break existing schemas or task/result object shapes. Consumers depend on the field names.
- Update JSDoc comments whenever you change a method signature.
- Add tests for every new code path.

---

## License

**ISC License**

Copyright (c) 2026 Njuguna Kelvin

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
