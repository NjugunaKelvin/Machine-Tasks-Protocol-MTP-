/**
 * @file requester.test.js
 * @description Tests for the Requester class.
 *
 * Covers: task creation, task shape and fields, signature validity, result
 * verification (genuine vs tampered), and the end-to-end flow with an Executor.
 *
 * Run all tests with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Requester } from '../src/client/requester.js';
import { Executor } from '../src/execution/executor.js';
import { IdentityManager } from '../src/identity/identity-manager.js';

describe('Requester', () => {

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  test('creates a cryptographic identity on construction', () => {
    const requester = new Requester('AppClient');

    assert.ok(requester.identity instanceof IdentityManager, 'Requester should hold an IdentityManager instance');
    assert.ok(requester.identity.id.startsWith('did:mtp:AppClient:'));
    assert.ok(requester.identity.publicKey.includes('BEGIN PUBLIC KEY'));
  });

  // -------------------------------------------------------------------------
  // createTask()
  // -------------------------------------------------------------------------

  test('createTask() returns an object with all required MTP task fields', () => {
    const requester = new Requester('AppClient');
    const task = requester.createTask('cap_some_cap_123', { value: 42 });

    const requiredFields = ['taskId', 'requesterId', 'capabilityId', 'payload', 'timestamp', 'signature', 'publicKey'];
    for (const field of requiredFields) {
      assert.ok(field in task, `Task is missing required field: "${field}"`);
    }
  });

  test('createTask() correctly sets the requesterId to the requester DID', () => {
    const requester = new Requester('AppClient');
    const task = requester.createTask('cap_test_123', { x: 1 });
    assert.equal(task.requesterId, requester.identity.id);
  });

  test('createTask() sets the capabilityId from the argument', () => {
    const requester = new Requester('AppClient');
    const task = requester.createTask('cap_specific_cap_456', { x: 1 });
    assert.equal(task.capabilityId, 'cap_specific_cap_456');
  });

  test('createTask() passes the payload through unmodified', () => {
    const requester = new Requester('AppClient');
    const payload = { region: 'EU', amount: 500, currency: 'EUR' };
    const task = requester.createTask('cap_tax_123', payload);
    assert.deepEqual(task.payload, payload);
  });

  test('createTask() generates a unique UUID taskId on every call', () => {
    const requester = new Requester('AppClient');
    const taskA = requester.createTask('cap_test_123', { x: 1 });
    const taskB = requester.createTask('cap_test_123', { x: 1 });

    assert.notEqual(taskA.taskId, taskB.taskId);
    // UUID v4 pattern
    assert.match(taskA.taskId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('createTask() attaches the requester public key for the Executor to verify with', () => {
    const requester = new Requester('AppClient');
    const task = requester.createTask('cap_test_123', { x: 1 });
    assert.equal(task.publicKey, requester.identity.publicKey);
  });

  test('createTask() signature is verifiable using the requester public key', () => {
    const requester = new Requester('AppClient');
    const task = requester.createTask('cap_test_123', { value: 100 });

    const { signature, publicKey, ...signedData } = task;
    const isValid = IdentityManager.verify(signedData, signature, publicKey);
    assert.equal(isValid, true, 'Task signature should be verifiable using the attached public key');
  });

  // -------------------------------------------------------------------------
  // verifyResult()
  // -------------------------------------------------------------------------

  test('verifyResult() returns true for an authentic Executor result', async () => {
    const executor = new Executor('TestExecutor');
    const cap = executor.addCapability(
      'Echo',
      z.object({ msg: z.string() }),
      z.object({ echo: z.string() }),
      async (p) => ({ echo: p.msg })
    );

    const requester = new Requester('AppClient');
    const task = requester.createTask(cap.id, { msg: 'hello MTP' });
    const result = await executor.executeTask(task);

    const executorPubKey = executor.identity.publicKey;
    const isValid = requester.verifyResult(result, executorPubKey);

    assert.equal(isValid, true);
  });

  test('verifyResult() returns false when the result data is tampered', async () => {
    const executor = new Executor('TestExecutor');
    const cap = executor.addCapability(
      'Echo',
      z.object({ msg: z.string() }),
      z.object({ echo: z.string() }),
      async (p) => ({ echo: p.msg })
    );

    const requester = new Requester('AppClient');
    const task = requester.createTask(cap.id, { msg: 'original' });
    const result = await executor.executeTask(task);

    // Simulate a man-in-the-middle changing the result data
    const tamperedResult = { ...result, result: { echo: 'TAMPERED' } };

    const isValid = requester.verifyResult(tamperedResult, executor.identity.publicKey);
    assert.equal(isValid, false);
  });

  test('verifyResult() returns false when the wrong executor public key is used', async () => {
    const executor = new Executor('TestExecutor');
    const cap = executor.addCapability(
      'Echo',
      z.object({ msg: z.string() }),
      z.object({ echo: z.string() }),
      async (p) => ({ echo: p.msg })
    );

    const requester = new Requester('AppClient');
    const task = requester.createTask(cap.id, { msg: 'hello' });
    const result = await executor.executeTask(task);

    // Use a completely different identity's key to verify (simulating a wrong/forged key)
    const wrongIdentity = new IdentityManager('WrongExecutor');
    const isValid = requester.verifyResult(result, wrongIdentity.publicKey);

    assert.equal(isValid, false);
  });

  test('verifyResult() returns false when the signature is stripped from the result', () => {
    const requester = new Requester('AppClient');
    const identity = new IdentityManager('SomeExecutor');

    // A result without a signature field should fail cleanly
    const resultWithoutSignature = {
      taskId: 'some-task',
      executorId: identity.id,
      status: 'success',
      result: { answer: 42 },
      timestamp: Date.now(),
      // No signature field
    };

    const isValid = requester.verifyResult(resultWithoutSignature, identity.publicKey);
    assert.equal(isValid, false);
  });

  // -------------------------------------------------------------------------
  // End-to-End Flow
  // -------------------------------------------------------------------------

  test('full round-trip: requester creates task, executor runs it, requester verifies result', async () => {
    const executor = new Executor('MathNode');
    const cap = executor.addCapability(
      'Multiply',
      z.object({ x: z.number(), y: z.number() }),
      z.object({ product: z.number() }),
      async (p) => ({ product: p.x * p.y })
    );

    const executorInfo = executor.getPublicInfo();
    const executorPubKey = executorInfo.identity.publicKey;

    const requester = new Requester('CalculatorApp');
    const task = requester.createTask(cap.id, { x: 6, y: 7 });
    const result = await executor.executeTask(task);

    assert.equal(result.status, 'success');
    assert.equal(result.result.product, 42);
    assert.equal(requester.verifyResult(result, executorPubKey), true);
  });
});
