# Scripts

- `release-context.mjs` validates the checked-in release manifest, resolves a
  tag to an immutable source commit, checks the pinned sibling source and
  package-lock versions, and verifies packed release artifacts.
- `release-context.node-test.mjs` exercises the fail-closed manifest and
  version rules with Node's built-in test runner.
