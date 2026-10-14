# Asteria

A source release of a multi-character game automation controller. It combines role-aware progression planning, native transaction verification, durable journals, semantic game-update validation and isolated repair proposals.

## Public release contents

- Controller, planning, knowledge, runtime and observability source.
- Offline test source and a small self-contained public test suite.
- Example machine configurations with fictional characters and documentation-only IP addresses.
- Static game reference data. Downloaded game client code/assets are excluded.

This repository is a sanitized source snapshot. It contains no production accounts, passwords, API tokens, SSH keys, real host addresses, browser profiles, saved games, learning history, transaction journals, internal audit reports or production Git history. The operational workspace is maintained separately.

## Local development

Use Node.js 22.23 or newer and Python 3 for Python utilities.

```sh
npm ci --ignore-scripts
node scripts/setup-public-examples.js
npm test
```

Setup copies example configuration to ignored local files only when the target does not already exist. It does not start services, create game accounts or access a live game. The identifiers `tum`, `vps` and `windows` are adapter names retained for compatibility; all shipped addresses and characters are examples.

For a real installation, review and configure those local files, supply your own accounts and provider credentials locally, and install the required Playwright browser separately. Create a fresh registry trust configuration for your own hosts. Do not run provisioning, deployment, account creation or live inspection scripts merely to test the repository.

The complete `scripts/v32-checks.js` suite additionally needs locally obtained current/historical game-client fixtures and installation-specific documentation/configuration. Those artifacts are deliberately not published, so `npm test` runs only the named self-contained suite. Passing it is not proof of live progression, a production deployment or full native-game acceptance.

## Design

Progression uses native capabilities and risk-aware role-weighted combat value. A protected operation keeps ownership until its verified boundary. Ambiguous paid actions remain fenced against replay. Structural transaction contracts govern adaptation to game updates. Repair candidates require isolation, regression checks and deployment evidence.

See [SECURITY.md](SECURITY.md) before contributing or configuring live access.
