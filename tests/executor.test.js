/**
 * @file executor.test.js
 * @description Tests for the Executor class.
 *
 * Covers: capability registration, the full happy-path execution pipeline,
 * signature verification failures, unknown capability rejection, schema validation
 * failures, handler exception handling, and result signing.
 *
 * Run all tests with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Executor } from '../src/execution/executor.js';
import { Requester } from '../src/client/requester.js';
import { IdentityManager } from '../src/identity/identity-manager.js';

// Helper: builds a fresh Executor with a single MathAdd capability
function buildTestExecutor() {
  const executor = new Executor('TestNode');

  const cap = executor.addCapability(
    'MathAdd',
    z.object({ a: z.number(), b: z.number() }),
    z.object({ answer: z.number() }),
    async (payload) => ({ answer: payload.a + payload.b })
  );

  return { executor, cap };
}

// Helper: builds a Requester and creates a valid signed task for the given capability
function buildValidTask(capId) {
  const requester = new Requester('TestClient');
  const task = requester.createTask(capId, { a: 10, b: 5 });
  return { requester, task };
}

describe('Executor', () => {

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  test('addCapability() registers the capability and returns its metadata', () => {
    const executor = new Executor('SetupNode');
    const schema = z.object({ x: z.number() });
    const cap = executor.addCapability('Square', schema, schema, async (p) => ({ result: p.x * p.x }));

    assert.ok(cap.id.startsWith('cap_square_'), `Expected ID to start with "cap_square_", got "${cap.id}"`);
    assert.equal(cap.name, 'Square');
  });

  test('getPublicInfo() returns identity and capabilities', () => {
    const { executor } = buildTestExecutor();
    const info = executor.getPublicInfo();

    assert.ok('identity' in info, 'getPublicInfo() must include identity');
    assert.ok('publicKey' in info.identity, 'Identity must include publicKey');
    assert.ok('capabilities' in info, 'getPublicInfo() must include capabilities');
    assert.ok(Array.isArray(info.capabilities.capabilities), 'Capabilities must be an array');
  });

  // -------------------------------------------------------------------------
  // Happy Path
  // -------------------------------------------------------------------------

  test('executeTask() returns a success result for a valid signed task', async () => {
    const { executor, cap } = buildTestExecutor();
    const { task } = buildValidTask(cap.id);

    const result = await executor.executeTask(task);

    assert.equal(result.status, 'success');
    assert.equal(result.result.answer, 15);
    assert.equal(result.taskId, task.taskId);
    assert.equal(result.executorId, executor.identity.id);
  });

  test('executeTask() attaches a signature to every success result', async () => {
    const { executor, cap } = buildTestExecutor();
    const { task } = buildValidTask(cap.id);

    const result = await executor.executeTask(task);

    assert.ok(typeof result.signature === 'string' && result.signature.length > 0, 'Result must carry a signature');
    assert.match(result.signature, /^[0-9a-f]+$/, 'Signature must be a hex string');
  });

  test('executeTask() result signature is verifiable with the executor public key', async () => {
    const { executor, cap } = buildTestExecutor();
    const { task } = buildValidTask(cap.id);

    const result = await executor.executeTask(task);
    const executorPubKey = executor.identity.publicKey;

    const { signature, ...data } = result;
    const isValid = IdentityManager.verify(data, signature, executorPubKey);
    assert.equal(isValid, true);
  });

  // -------------------------------------------------------------------------
  // Security: Signature Verification
  // -------------------------------------------------------------------------

  test('executeTask() returns a signed failure when the task signature is invalid', async () => {
    const { executor, cap } = buildTestExecutor();
    const { task } = buildValidTask(cap.id);

    // Tamper with the payload after it was signed
    const tamperedTask = { ...task, payload: { a: 99999, b: 99999 } };

    const result = await executor.executeTask(tamperedTask);

    assert.equal(result.status, 'failure');
    assert.ok(result.error.includes('Invalid Task Signature'), `Expected auth failure message, got: "${result.error}"`);
    // The failure result itself must still be signed by the Executor
    assert.ok(typeof result.signature === 'string' && result.signature.length > 0, 'Even failure responses must be signed');
  });

  test('executeTask() returns a failure when the publicKey in the task does not match the signature', async () => {
    const { executor, cap } = buildTestExecutor();
    const { task } = buildValidTask(cap.id);

    // Swap in a different public key (not the one that actually signed the task)
    const impostorIdentity = new IdentityManager('Impostor');
    const forgeredTask = { ...task, publicKey: impostorIdentity.publicKey };

    const result = await executor.executeTask(forgeredTask);

    assert.equal(result.status, 'failure');
    assert.ok(result.error.includes('Invalid Task Signature'));
  });

  // -------------------------------------------------------------------------
  // Capability Routing
  // -------------------------------------------------------------------------

  test('executeTask() returns a signed failure for an unknown capability ID', async () => {
    const { executor } = buildTestExecutor();
    const requester = new Requester('TestClient');

    // Create a task for a capability that does not exist on this executor
    const task = requester.createTask('cap_nonexistent_999', { a: 1, b: 2 });

    const result = await executor.executeTask(task);

    assert.equal(result.status, 'failure');
    assert.ok(result.error.includes('not supported'), `Expected "not supported" in error, got: "${result.error}"`);
  });

  // -------------------------------------------------------------------------
  // Schema Validation
  // -------------------------------------------------------------------------

  test('executeTask() returns a failure when the payload fails schema validation', async () => {
    const { executor, cap } = buildTestExecutor();
    const requester = new Requester('TestClient');

    // Payload sends strings instead of numbers; should fail Zod validation
    const task = requester.createTask(cap.id, { a: 'not_a_number', b: 'also_wrong' });

    const result = await executor.executeTask(task);

    assert.equal(result.status, 'failure');
    assert.ok(result.error.includes('Schema Validation Failed'), `Expected validation failure message, got: "${result.error}"`);
  });

  test('executeTask() returns a failure when required payload fields are missing', async () => {
    const { executor, cap } = buildTestExecutor();
    const requester = new Requester('TestClient');

    // Missing 'b' field required by the MathAdd schema
    const task = requester.createTask(cap.id, { a: 5 });

    const result = await executor.executeTask(task);

    assert.equal(result.status, 'failure');
    assert.ok(result.error.includes('Schema Validation Failed'));
  });

  // -------------------------------------------------------------------------
  // Handler Errors
  // -------------------------------------------------------------------------

  test('executeTask() returns a signed failure when the handler throws an error', async () => {
    const executor = new Executor('ErrorNode');
    const schema = z.object({ trigger: z.boolean() });

    const cap = executor.addCapability(
      'AlwaysFails',
      schema,
      z.object({}),
      async () => {
        throw new Error('Intentional handler failure for testing');
      }
    );

    const requester = new Requester('TestClient');
    const task = requester.createTask(cap.id, { trigger: true });

    const result = await executor.executeTask(task);

    assert.equal(result.status, 'failure');
    assert.ok(result.error.includes('Intentional handler failure'), `Expected handler error in result, got: "${result.error}"`);
    // Must still be signed
    assert.ok(typeof result.signature === 'string' && result.signature.length > 0);
  });

  // -------------------------------------------------------------------------
  // Result Integrity
  // -------------------------------------------------------------------------

  test('executeTask() includes a timestamp on every result', async () => {
    const { executor, cap } = buildTestExecutor();
    const { task } = buildValidTask(cap.id);
    const before = Date.now();

    const result = await executor.executeTask(task);
    const after = Date.now();

    assert.ok(result.timestamp >= before && result.timestamp <= after, 'Timestamp should fall within the test window');
  });

  test('executeTask() echoes back the correct taskId in the result', async () => {
    const { executor, cap } = buildTestExecutor();
    const { task } = buildValidTask(cap.id);

    const result = await executor.executeTask(task);

    assert.equal(result.taskId, task.taskId);
  });
});
