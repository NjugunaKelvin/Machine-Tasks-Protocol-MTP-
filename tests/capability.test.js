/**
 * @file capability.test.js
 * @description Tests for the CapabilityManager class.
 *
 * Covers: capability registration, generated ID format, discovery document shape,
 * successful schema validation, and validation failures for bad payloads.
 *
 * Run all tests with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CapabilityManager } from '../src/capability/capability-manager.js';
import { IdentityManager } from '../src/identity/identity-manager.js';

// Shared test identity used across all capability tests
const identity = new IdentityManager('CapTestExecutor');
const publicIdentity = identity.getIdentity();

describe('CapabilityManager', () => {

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  test('registerCapability() returns a capability object with a generated ID', () => {
    const caps = new CapabilityManager(publicIdentity);

    const InputSchema = z.object({ value: z.number() });
    const OutputSchema = z.object({ doubled: z.number() });

    const cap = caps.registerCapability('Double', InputSchema, OutputSchema);

    assert.ok(cap.id.startsWith('cap_double_'), `Expected ID to start with "cap_double_", got "${cap.id}"`);
    assert.equal(cap.name, 'Double');
  });

  test('registerCapability() normalizes multi-word names into the ID', () => {
    const caps = new CapabilityManager(publicIdentity);
    const schema = z.object({ text: z.string() });
    const cap = caps.registerCapability('Summarize Text', schema, schema);

    assert.ok(cap.id.startsWith('cap_summarize_text_'), `Spaces should be replaced with underscores in the ID`);
  });

  test('multiple capabilities are stored and independently retrievable', () => {
    const caps = new CapabilityManager(publicIdentity);
    const schema = z.object({ x: z.number() });

    const capA = caps.registerCapability('CapA', schema, schema);
    const capB = caps.registerCapability('CapB', schema, schema);

    assert.notEqual(capA.id, capB.id);
    assert.equal(caps.capabilities.length, 2);
  });

  test('constraints are preserved on the registered capability', () => {
    const caps = new CapabilityManager(publicIdentity);
    const schema = z.object({ n: z.number() });
    const constraints = { costPerOp: 0.005, timeoutMs: 5000 };

    const cap = caps.registerCapability('PricedTask', schema, schema, constraints);

    assert.deepEqual(cap.constraints, constraints);
  });

  // -------------------------------------------------------------------------
  // Discovery Document
  // -------------------------------------------------------------------------

  test('getCapabilities() includes executorId and a capabilities array', () => {
    const caps = new CapabilityManager(publicIdentity);
    const schema = z.object({ x: z.number() });
    caps.registerCapability('Task', schema, schema);

    const doc = caps.getCapabilities();

    assert.equal(doc.executorId, publicIdentity.id);
    assert.ok(Array.isArray(doc.capabilities));
    assert.equal(doc.capabilities.length, 1);
    assert.ok(typeof doc.timestamp === 'number');
  });

  test('getCapabilities() strips internal Zod schema objects from the output', () => {
    const caps = new CapabilityManager(publicIdentity);
    const schema = z.object({ x: z.number() });
    caps.registerCapability('Task', schema, schema);

    const doc = caps.getCapabilities();
    const capEntry = doc.capabilities[0];

    assert.ok(!('_inputSchemaZod' in capEntry), 'Private Zod schema must not appear in discovery output');
    assert.ok(!('_outputSchemaZod' in capEntry), 'Private Zod schema must not appear in discovery output');
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  test('validateCapability() passes and returns parsed data for a valid payload', () => {
    const caps = new CapabilityManager(publicIdentity);
    const schema = z.object({ a: z.number(), b: z.number() });

    const cap = caps.registerCapability('Add', schema, schema);
    const result = caps.validateCapability(cap.id, { a: 10, b: 20 });

    assert.equal(result.a, 10);
    assert.equal(result.b, 20);
  });

  test('validateCapability() throws ZodError for missing required fields', () => {
    const caps = new CapabilityManager(publicIdentity);
    const schema = z.object({ name: z.string(), age: z.number() });

    const cap = caps.registerCapability('Profile', schema, schema);

    assert.throws(
      () => caps.validateCapability(cap.id, { name: 'Alice' }), // missing 'age'
      (err) => {
        assert.ok(err.name === 'ZodError' || err.message.includes('age'), 'Should throw a ZodError about the missing age field');
        return true;
      }
    );
  });

  test('validateCapability() throws ZodError for wrong field types', () => {
    const caps = new CapabilityManager(publicIdentity);
    const schema = z.object({ count: z.number() });
    const cap = caps.registerCapability('Counter', schema, schema);

    assert.throws(
      () => caps.validateCapability(cap.id, { count: 'not_a_number' }),
      (err) => {
        assert.ok(err.message.length > 0, 'ZodError should have a message');
        return true;
      }
    );
  });

  test('validateCapability() throws Error when capability ID does not exist', () => {
    const caps = new CapabilityManager(publicIdentity);

    assert.throws(
      () => caps.validateCapability('cap_nonexistent_99999', { x: 1 }),
      (err) => {
        assert.ok(err.message.includes('Capability not found'), `Expected "Capability not found" in error, got: ${err.message}`);
        return true;
      }
    );
  });

  test('validateCapability() strips unknown fields not defined in the schema', () => {
    const caps = new CapabilityManager(publicIdentity);
    // This schema does not mention "extra"
    const schema = z.object({ value: z.number() });
    const cap = caps.registerCapability('Strict', schema, schema);

    // Zod strips unknown keys by default with .parse() unless .passthrough() is used
    const result = caps.validateCapability(cap.id, { value: 5, extra: 'injected' });
    assert.equal(result.value, 5);
    assert.ok(!('extra' in result), 'Unknown fields should be stripped by Zod validation');
  });
});
