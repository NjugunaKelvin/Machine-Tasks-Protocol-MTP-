/**
 * @file index.js
 * @description Public API entry point for the machine-tasks-protocol npm package.
 *
 * This file re-exports all public classes from their respective modules so that
 * consumers can import everything from the package root:
 *
 *   import { Executor, Requester, IdentityManager, CapabilityManager } from 'machine-tasks-protocol';
 *
 * Module overview:
 *
 *   IdentityManager    Generates and manages RSA key pairs; signs and verifies data objects.
 *                      Most users will not instantiate this directly. Executor and Requester
 *                      create their own IdentityManager instances internally. Use it directly
 *                      only if you need low-level cryptographic operations.
 *
 *   CapabilityManager  Maintains the registry of capabilities an Executor can perform and
 *                      validates incoming payloads against their Zod schemas. Again, most
 *                      users will interact with this indirectly through the Executor API.
 *
 *   Executor           The server-side class. Create one instance per service, register
 *                      capabilities with addCapability(), then feed incoming task payloads
 *                      to executeTask(). It handles authentication, schema validation,
 *                      handler dispatch, and result signing automatically.
 *
 *   Requester          The client-side class. Create one instance per application. Use
 *                      createTask() to build a signed task payload and verifyResult() to
 *                      confirm the returned result is authentic before using its data.
 */

export { IdentityManager } from './identity/identity-manager.js';
export { CapabilityManager } from './capability/capability-manager.js';
export { Executor } from './execution/executor.js';
export { Requester } from './client/requester.js';
