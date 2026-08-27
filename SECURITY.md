# Security Policy

## Supported Versions

The following versions of mtp-core are currently receiving security updates:

| Version | Supported |
| :------ | :-------- |
| 1.x     | Yes       |

Older major versions will not receive security patches. Upgrade to the latest version to stay protected.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in mtp-core, report it privately so it can be patched before it is disclosed publicly. This protects everyone using the library.

### How to report

Send an email to the maintainer directly with the subject line:

```
[mtp-core SECURITY] Brief description of the issue
```

Include in your report:
- A description of the vulnerability and its potential impact
- The version(s) of mtp-core affected
- Steps to reproduce the issue or a proof-of-concept
- Any suggested fix if you have one

You will receive an acknowledgment within 48 hours and a full response within 7 days outlining the next steps.

### What to expect

1. Your report is acknowledged within 48 hours
2. The vulnerability is investigated and confirmed
3. A fix is developed and tested
4. A patched version is released on npm
5. The vulnerability is publicly disclosed after the patch is available, with credit to the reporter if desired

## Scope

Security issues of particular concern for mtp-core include:

- Flaws in signature generation or verification logic (`identity-manager.js`)
- Vulnerabilities that allow a forged task or result to pass signature verification
- Issues with the deterministic serialization (`stableStringify`) that could cause signature inconsistencies
- Replay attack vectors not covered by the existing timestamp mechanism
- Dependency vulnerabilities in `uuid` or `zod` that affect the security guarantees of the protocol

## Out of Scope

The following are not considered security vulnerabilities in mtp-core:

- Vulnerabilities in the example code (`examples/`) — examples are not production code
- Issues that require physical access to a machine holding a private key
- Weaknesses in how a consumer application stores or manages its own keys (key management is the responsibility of the application, not the library)
- RSA-2048 being theoretically weaker than Ed25519 — this is a known trade-off documented in the codebase; Ed25519 support is planned for a future version

## Security Design Notes

For developers auditing the library:

- All signatures use RSA-2048 with SHA-256 (RS256) via Node.js's built-in `crypto` module, with no third-party cryptography dependencies
- JSON is serialized deterministically using a recursive key-sorting algorithm before any signature is computed, preventing key-ordering attacks
- Signed data never includes the `signature` field itself, preventing circular dependency in verification
- The library does not enforce a replay attack window by default; applications are expected to implement timestamp validation in their handlers
- Private keys are held in memory; the library explicitly documents that production deployments must use an HSM or secrets manager

## Acknowledgments

Security researchers who responsibly disclose vulnerabilities will be credited in the release notes of the patched version, unless they prefer to remain anonymous.
