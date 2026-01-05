# Model Task Protocol (MTP) Specification

## Overview

The Model Task Protocol (MTP) is a multi-layered system designed to securely expose and execute machine tasks. It enables authenticated, verifiable, and structured delegation of work to autonomous executors.

## Architecture Layers

### 1. Identity Layer
**Purpose:** Authenticate all participants (Requesters and Executors).
**Mechanism:** 
- Public/Private Key pairs (ED25519 or similar).
- Every entity has a unique DID (Decentralized Identifier) or UUID.
- Messages are signed to ensure integrity and non-repudiation.

### 2. Capability Layer
**Purpose:** advertise what an executor can do.
**Structure:**
- **Capability Descriptor**: A JSON schema defining inputs, outputs, constraints, and pricing.
- **Constraints**: Max execution time, resource limits, supported models.

### 3. Task Submission Layer
**Purpose:** Secure channel for submitting work.
**Flow:**
1. Requester creates a Task Payload matching a Capability.
2. Requester signs the payload.
3. Requester sends payload to Executor's endpoint.

### 4. Execution Layer
**Purpose:** The runtime environment for the task.
**Responsibility:**
- Validate input against schema.
- Verification of constraints (e.g., payment, time).
- Execution of the logic (e.g., inference, calculation).
- Error handling.

### 5. Result Verification Layer
**Purpose:** Ensure results are trustworthy.
**Mechanism:**
- Results are signed by the Executor.
- Results include metadata (execution time, version).
- Requesters validate the signature and schema before accepting.

### 6. Discovery Layer (Optional)
**Purpose:** Find executors.
**Mechanism:** A registry service or P2P discovery where executors publish their Capability Descriptors.

## JSON Schemas (Draft)

### Capability Object
```json
{
  "executorId": "did:mtp:executor:12345",
  "capabilities": [
    {
      "id": "cap_math_solver_v1",
      "name": "Math Solver",
      "inputSchema": { ... },
      "outputSchema": { ... },
      "costPerOp": 0.001
    }
  ],
  "signature": "..."
}
```

### Task Object
```json
{
  "taskId": "task_9876",
  "requesterId": "did:mtp:requester:abc",
  "capabilityId": "cap_math_solver_v1",
  "payload": { "expression": "2 + 2" },
  "timestamp": 1709823423,
  "signature": "..."
}
```

### Result Object
```json
{
  "taskId": "task_9876",
  "executorId": "did:mtp:executor:12345",
  "status": "success",
  "result": { "answer": 4 },
  "signature": "..."
}
```

## Error Handling

Executors must return signed error objects if execution fails. This ensures clients can prove that a specific executor acknowledged the task but failed to complete it.

### Error Object
```json
{
  "taskId": "task_9876",
  "executorId": "did:mtp:executor:12345",
  "status": "failure",
  "error": "Input value out of bounds",
  "timestamp": 1709823455,
  "signature": "..."
}
```

## Security Considerations

1. **Replay Attacks**: Tasks include a `timestamp`. Executors should reject tasks older than a specific window (e.g., 5 minutes) or track `taskId`s to prevent reprocessing.
2. **Man-in-the-Middle**: All payloads are signed. While transport Layer Security (TLS) should be used for privacy, the MTP signature ensures integrity even over insecure channels.
3. **Key Management**: Private keys must be stored securely (e.g., HSM, Secure Enclave).
```
