# Publication and credential safety

Keep `.env`, account files, host configuration, trust keys, profiles, cache, logs, journals and per-character learning outside Git. Only fictional `.example.json` machine configuration belongs in this repository. Never attach operational archives or raw logs to public issues.

Before committing, inspect the staged diff and run `npm run security:check`. Before pushing, run Gitleaks 8.30.1 or newer against the complete repository history:

```sh
gitleaks git . --redact=100
```

Enable the supplied local guards with `git config core.hooksPath .githooks`. The push hook requires Gitleaks and fails if it is unavailable. Hooks can be bypassed by Git, so they supplement review rather than guarantee that arbitrary future changes are safe.

The initial release was checked using Gitleaks and a local comparison against known private values before upload. That private comparison corpus and its reports are not part of this repository. Automated scanning cannot prove the absence of every possible secret; review every future addition.

For suspected credentials exposure, do not paste the secret into an issue. Revoke or rotate the affected credential through its provider and contact the repository owner privately. Removing a file from the current branch does not remove it from history.
