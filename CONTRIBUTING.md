# Contributing to Machine Task Protocol (MTP)

> MTP is a security-critical protocol. Every contribution matters,  but contributions to the core signing and verification logic are held to an especially high standard.

Thank you for taking the time to contribute. This document explains how to get set up, what we expect from contributions, and how to get your changes merged.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Contribution Standards](#contribution-standards)
- [Security-Sensitive Areas](#security-sensitive-areas)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)
- [Proposing Features](#proposing-features)

---

## Code of Conduct

This project follows a simple principle: be direct, be respectful, and be constructive. Harassment, dismissiveness, or bad-faith engagement of any kind will not be tolerated.

---

## Ways to Contribute

You don't have to write code to contribute. Here are the ways you can help:

| Type | Examples |
| :--- | :--- |
| **Bug fixes** | Fix incorrect signature verification behavior, schema edge cases, error messages |
| **New features** | New transport adapters, capability constraints, replay-attack helpers |
| **Documentation** | Improve examples, clarify explanations, fix typos |
| **Tests** | Add coverage for untested code paths or edge cases |
| **Security** | Identify weaknesses in the cryptographic or validation logic |
| **Ecosystem** | Bindings, wrappers, or framework integrations built on top of `mtp-core` |

---

## Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **npm** (comes with Node.js)
- A basic understanding of RSA signatures and JSON schema validation will help when working on core modules

### Fork and Clone

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/Machine-Tasks-Protocol-MTP-.git
cd Machine-Tasks-Protocol-MTP-

# 2. Install dependencies
npm install

# 3. Run the test suite to confirm everything is working
npm test
```

### Run the Example

The bundled example starts a local Express server and runs a complete MTP round-trip in one command:

```bash
npm run start:example
```

This is the fastest way to see the full lifecycle; discovery, task creation, submission, and result verification, in action.

---

## Project Structure

```
src/
├── index.js                  # Public API surface - Executor, Requester, IdentityManager, CapabilityManager
├── identity/                 # RSA key generation, signing, verification (security-critical)
├── capability/               # Capability registration, Zod schema validation
├── execution/                # Task pipeline - verify → route → validate → execute → sign
└── client/                   # Requester: task creation and result verification

tests/                        # Node.js built-in test runner - mirrors the src/ structure
examples/                     # Runnable end-to-end demos (Express server + client)
docs/                         # Extended documentation
```

Understanding `src/execution/` is the best starting point if you want to trace the full MTP pipeline end to end.

---

## Development Workflow

### Branching

Always branch off `main`. Use a descriptive branch name:

```bash
git checkout -b fix/replay-attack-timestamp-check
git checkout -b feat/websocket-transport-helper
git checkout -b docs/improve-requester-examples
```

Prefixes: `fix/`, `feat/`, `docs/`, `test/`, `refactor/`, `security/`

### Making Changes

1. Make your changes in the appropriate module under `src/`
2. Add or update tests under `tests/` to cover your change
3. Update JSDoc comments on any method whose signature or behavior changes
4. Run the full test suite before pushing

```bash
npm test
```

All tests must pass. New code paths must have tests. There are no exceptions.

### Commit Messages

Use clear, lowercase imperative commit messages:

```
fix: reject tasks with expired timestamps by default
feat: add capability constraint for max execution time
docs: clarify stableStringify behavior in security model
test: add edge cases for malformed signed task objects
```

---

## Contribution Standards

These are non-negotiable requirements for any pull request.

### Tests

- Every new feature must include tests that cover the happy path and at least one failure case
- Every bug fix must include a test that would have caught the bug before the fix
- Tests live in `tests/` and use Node.js's built-in `node:test` runner,  no external test frameworks

### JSDoc

Update JSDoc on any method whose signature, parameters, or return type changes. Consumers rely on this for IDE completions and documentation.

```javascript
/**
 * Builds and signs a task payload ready for submission to an Executor.
 * @param {string} capabilityId - The ID of the target capability.
 * @param {object} payload - The input data for the capability.
 * @returns {SignedTask} A signed task object containing the payload, timestamp, and RSA-SHA256 signature.
 */
```

### Backwards Compatibility

Do not change the shape of `SignedTask` or `SignedResult` objects. Field names and types are part of the public protocol contract. Consumers,  including cross-language implementations,  depend on them.

If a breaking change is genuinely necessary, open an issue first and discuss it before writing code.

### No New Runtime Dependencies

The core library intentionally depends only on `uuid` and `zod`. Do not add new runtime dependencies to `mtp-core` without opening an issue for discussion first. Dev dependencies are fine.

---

## Security-Sensitive Areas

These files and modules require extra care:

| Path | Reason |
| :--- | :--- |
| `src/identity/` | RSA key generation, signing, and verification. Any weakening of these primitives breaks the entire trust model. |
| `src/execution/` | The task pipeline. Signature verification must run before any payload processing. This order must not change. |
| `stableStringify` | Deterministic serialization before signing. Changes here can silently break cross-implementation compatibility. |

**Rules for changes to security-sensitive modules:**

1. Explain the security rationale in your PR description, not just what changed, but why it is safe
2. Include tests that specifically verify the security property you are maintaining or improving
3. Never reduce key size, weaken hash algorithms, or skip a verification step under any condition
4. If you find a vulnerability, **do not open a public issue**,  see [Reporting Bugs](#reporting-bugs) and the [Security Policy](./SECURITY.md)

---

## Submitting a Pull Request

1. **Push your branch** to your fork on GitHub
2. **Open a pull request** against the `main` branch of this repository
3. **Fill out the PR description** — include:
   - What the change does and why
   - How you tested it
   - Any breaking changes or edge cases to be aware of
4. **Link any related issues** using `Closes #123` or `Fixes #123`
5. A maintainer will review your PR. Be prepared to revise based on feedback

PRs that are missing tests, have failing tests, or touch security-critical modules without explanation will not be merged until those issues are addressed.

---

## Reporting Bugs

Before opening an issue, search existing issues to avoid duplicates.

When opening a bug report, include:

- **Node.js version** (`node --version`)
- **`mtp-core` version** (from `package.json` or `npm list mtp-core`)
- **Minimal reproduction** — the smallest possible code that demonstrates the problem
- **Observed behavior** vs **expected behavior**
- Any relevant error messages or stack traces

For **security vulnerabilities**, do not open a public GitHub issue. Follow the process in [SECURITY.md](./SECURITY.md).

---

## Proposing Features

Open a GitHub issue before writing code for a significant new feature. This avoids the situation where you invest time in an implementation that doesn't align with the direction of the project.

A good feature proposal answers:

- **What problem does this solve?** Describe a concrete use case
- **How does it fit with MTP's design?** MTP is transport-agnostic, security-first, and schema-enforced. Does your proposal respect those principles?
- **What is the proposed API?** A rough sketch of function signatures or object shapes is helpful
- **Are there backwards compatibility concerns?**

Small improvements (documentation fixes, additional test cases, minor ergonomic changes) don't need a pre-approval issue. Just open a PR.

---

## License

By contributing to this repository, you agree that your contributions will be licensed under the [ISC License](./LICENSE) that covers this project.

---

*Machine Task Protocol,  built to be the backbone of agent communication.*
