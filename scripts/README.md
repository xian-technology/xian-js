# Scripts

- `release-context.mjs` validates the checked-in release manifest, resolves a
  tag to an immutable source commit, checks the pinned sibling source and
  package-lock versions, and verifies packed release artifacts.
- `release-context.node-test.mjs` exercises the fail-closed manifest and
  version rules with Node's built-in test runner.
- `packed-install-smoke.mjs` packs the built types/client/provider packages and
  installs them in an isolated consumer project with a fresh private npm cache.
  This gate requires registry access and tests the packed manifests' dependency
  ranges through standard npm resolution; it does not reuse the workspace lock
  as a consumer lock. It prints the resulting consumer lock with exact versions,
  tarball URLs and integrity hashes before running the packaged nonce smoke.
  Temporary packages, cache and consumer files are removed on success or failure.
