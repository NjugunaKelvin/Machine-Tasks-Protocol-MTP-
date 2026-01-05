# Machine Task Protocol (MTP)

> The Standard for Authenticated, Verifiable, and Structured Machine-to-Machine Delegation.

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js](https://img.shields.io/badge/Node.js-v16%2B-green)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/Status-Stable-brightgreen)]()

**MTP** is a lightweight, cryptographically secure protocol designed for the age of autonomous agents. It allows services (Executors) and clients (Requesters) to communicate with **proof of identity**, **schema enforcement**, and **non-repudiation**—all without relying on centralized API keys or heavy OAuth infrastructure for peer-to-peer agent tasks.

---

## Table of Contents

- [Introduction](#-introduction)
- [Why MTP?](#-why-mtp)
- [Core Concepts](#-core-concepts)
- [Installation](#-installation)
- [Quick Start Guide](#-quick-start-guide)
    - [1. Setting up an Executor (Server/Agent)](#1-setting-up-an-executor-serveragent)
    - [2. Setting up a Requester (Client)](#2-setting-up-a-requester-client)
    - [3. The End-to-End Flow](#3-the-end-to-end-flow)
- [Advanced Usage](#-advanced-usage)
    - [Customizing Capabilities](#customizing-capabilities)
    - [Handling Complex Schemas](#handling-complex-schemas)
    - [Error Handling & Security](#error-handling--security)
- [API Reference](#-api-reference)
- [Contributing](#-contributing)
- [License](#-license)

---

## Introduction

In a world where AI agents perform critical tasks (diagnosing patients, executing trades, modifying code), the question is no longer "can we connect?" but **"can we trust?"**.

Standard REST APIs are great for data, but they lack inherent "contract" enforcement for autonomous actions. MTP fills this gap by introducing a multi-layer protocol:
1.  **Identity Layer**: Who are you? (Cryptographic DIDs)
2.  **Capability Layer**: What can you do? (Zod Signed Schemas)
3.  **Execution Layer**: Prove you did it. (Signed Results)

---

## Why MTP?

| Feature | Standard API (REST/RPC) | Machine Task Protocol (MTP) |
| :--- | :--- | :--- |
| **Authentication** | API Keys (can be stolen) | RSA/Ed25519 Signatures (Private Key never leaves device) |
| **Validation** | Manual checks in controller | **Automatic Schema Enforcement** via Capability Manager |
| **Trust** | "Trust me, I sent the right data" | **Cryptographic Proof** (Signature Verification) |
| **Auditability** | Server logs (alterable) | **Signed Receipts** (Mathematically provable) |
| **Structure** | JSON (loose) | **Standardized Task/Result Objects** |

---

## Core Concepts

### 1. Executors
An **Executor** is any node (server, robot, AI agent) that performs work. It advertises **Capabilities**—specific skills it possesses (e.g., "SummarizeText", "ResizeImage", "CalculateRisk").

### 2. capabilities & Schemas
A **Capability** is a contract. It defines:
- **Input Schema**: What data is needed.
- **Output Schema**: What will be returned.
- **Constraints**: Constraints on usage (timeouts, costs).

MTP uses `zod` for strictly typed runtime validation.

### 3. Requesters
A **Requester** is a client asking for work. It generates a **Task Payload**, signs it with its Private Key, and sends it to the Executor.

---

## Installation

### Option A: Install via Git (Recommended for latest version)
You can install MTP directly from GitHub to get the bleeding-edge features.

```bash
npm install git+https://github.com/NjugunaKelvin/Machine-Tasks-Protocol-MTP-.git
```

### Option B: Local Development
If you want to modify the protocol itself:

```bash
git clone https://github.com/NjugunaKelvin/Machine-Tasks-Protocol-MTP-.git
cd Machine-Tasks-Protocol-MTP-
npm install
```

---

## Quick Start Guide

Let's build a secure "Math Agent" that other developers can call.

### 1. Setting up an Executor (Server/Agent)

Create a file `server.js`. This node will accept tasks.

```javascript
import { Executor } from 'machine-tasks-protocol';
import { z } from 'zod';

// 1. Initialize the Executor with a unique name
// In production, keys can be loaded from secure storage.
const mathAgent = new Executor("MathWizard_v1");

// 2. Define the Input/Output "Contract"
const SumInput = z.object({
  a: z.number().describe("The first number"),
  b: z.number().describe("The second number")
});

const SumOutput = z.object({
  total: z.number(),
  calculatedAt: z.string()
});

// 3. Register the Capability
// Only requests matching 'SumInput' will trigger this function.
mathAgent.addCapability(
  "CalculateSum", 
  SumInput, 
  SumOutput, 
  async (payload) => {
    console.log(`[MathAgent] processing ${payload.a} + ${payload.b}`);
    return {
      total: payload.a + payload.b,
      calculatedAt: new Date().toISOString()
    };
  }
);

// 4. Expose Public Info (for Discovery)
const publicDocs = mathAgent.getPublicInfo();
console.log("Agent Identity:", publicDocs.identity.id);
console.log("Capabilities:", publicDocs.capabilities);

// In a real app, you would now expose 'mathAgent.executeTask()' via Express/FastAPI
```

### 2. Setting up a Requester (Client)

Create a file `client.js`. This represents another developer using your agent.

```javascript
import { Requester } from 'machine-tasks-protocol';

// 1. Initialize Client Identity
const userApp = new Requester("InvoiceApp");

// 2. Target the Capability
// You get this ID from the 'publicDocs' or a registry
const targetCapabilityId = "cap_calculate_sum_123456789"; 

// 3. Create the Task
// This creates a JSON object containing the payload + a cryptographic signature.
const secureTask = userApp.createTask(
  targetCapabilityId,
  { a: 100, b: 550 },
  // Optional: Pass the Executor's public key if you wanted early validation
);

console.log("Signed Task Payload:", secureTask);

// 4. Send `secureTask` to the server...
// (Code continues in next section)
```

### 3. The End-to-End Flow

Here is how you wire them together (simulating a network call):

```javascript
// ... Assuming code from above ...

// 1. Client Sends Task (Simulation)
// In reality: const result = await fetch('https://api.agent.com/task', ...)
const signedResult = await mathAgent.executeTask(secureTask);

// 2. Client Verifies Result
// The client MUST verify the signature to prove the result came from "MathWizard_v1"
const executorPublicKey = publicDocs.identity.publicKey;

const isValid = userApp.verifyResult(signedResult, executorPublicKey);

if (isValid) {
  if (signedResult.status === 'success') {
    console.log("Trusted Result:", signedResult.result.total);
  } else {
    console.error("Task Failed:", signedResult.error);
  }
} else {
  console.error("SECURITY ALERT: Result signature is invalid! Possible tampering.");
}
```

---

## 🛠 Advanced Usage

### Structuring a Server with Express
MTP is framework-agnostic. Here is the canonical way to wrap it in Express:

```javascript
import express from 'express';
import { Executor } from 'machine-tasks-protocol';

const app = express();
app.use(express.json());

const executor = new Executor("ServiceNode");
// ... add capabilities ...

app.post('/api/submit', async (req, res) => {
  try {
    // The executor handles signature verification internally
    // If the signature is invalid, it returns a signed failure response.
    const response = await executor.executeTask(req.body);
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: "Transport Error" });
  }
});
```

### Custom Schema Validation
MTP uses `zod` for schema validation. This allows for powerful rules:

```javascript
const UserProfileSchema = z.object({
  username: z.string().min(5).max(20),
  email: z.string().email(),
  subscription: z.enum(["Free", "Pro", "Enterprise"]),
  meta: z.object({
    loginCount: z.number().int().nonnegative()
  }).optional()
});

executor.addCapability("UpdateProfile", UserProfileSchema, ResponseSchema, async (data) => {
  // 'data' is GUARANTEED to match the schema here.
  // No need for manual 'if (data.username.length < 5)' checks.
  await db.update(data);
  return { success: true };
});
```

### Deterministic Serialization
MTP handles the complex problem of JSON key ordering during signing. 
`{ "a": 1, "b": 2 }` and `{ "b": 2, "a": 1 }` are treated as identical for signature verification purposes, ensuring robust communication between different languages or libraries.

---

## 📖 API Reference

### `Executor`
The main class for service providers.
- **`new Executor(name, [options])`**: Creates a new agent identity.
- **`addCapability(name, inputSchema, outputSchema, handler)`**: Registers a function.
- **`executeTask(signedTask)`**: Authenticates and runs a specific task.
- **`getPublicInfo()`**: Returns safe-to-share details (Public Key, Capabilities).

### `Requester`
The main class for service consumers.
- **`new Requester(name, [options])`**: Creates a new client identity.
- **`createTask(capabilityId, payload, [targetKey])`**: Returns a signed task object.
- **`verifyResult(signedResult, executorKey)`**: Boolean check for integrity.

### `IdentityManager`
Low-level cryptographic primitives.
- **`sign(data)`**: Returns hex signature.
- **`verify(data, signature, publicKey)`**: Validates signature.

---

## Contributing

We welcome contributions! MTP is designed to be the backbone of agent communication, and we need your help to make it stronger.

### How to Contribute
1.  **Fork** the repository.
2.  **Clone** your fork:
    ```bash
    git clone https://github.com/YOUR_USERNAME/Machine-Tasks-Protocol-MTP-.git
    ```
3.  **Create a Branch** for your feature:
    ```bash
    git checkout -b feature/amazing-new-feature
    ```
4.  **Install Dependencies**:
    ```bash
    npm install
    ```
5.  **Make Changes** & Test (We used standard Node `crypto`).
6.  **Push** to your fork and submit a **Pull Request**.

### Guidelines
-   **Security First**: Any changes to `identity-manager.js` must be carefully vetted.
-   **Backward Compatibility**: Do not break existing schema validation logic.
-   **Documentation**: Update JSDoc comments if you change API signatures.

---

## License

**ISC License**

Copyright (c) 2026 MTP Contributors

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
