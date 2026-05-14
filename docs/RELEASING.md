# Releasing

`xian-js` follows the same high-level release model as `xian-py`:

- validation runs on pushes and pull requests
- publishing happens only from a git tag
- the release tag format is `vX.Y.Z`

## Version Policy

`xian-js` is versioned at the repo level.

That means:

- the repo tag is `vX.Y.Z`
- every publishable package in this repo must have version `X.Y.Z`
- the current publishable packages are `@xian-tech/client` and `@xian-tech/provider`

This repo is not lockstepped with `xian-wallet-browser`.

- `xian-js` and `xian-wallet-browser` release independently
- when the wallet repo needs a newer SDK release, it updates its dependency
  versions explicitly and then ships its own tag

## Next Breaking SDK Release

The VM-only runtime cleanup is a breaking SDK release. The old
`getContract(...)` alias has been removed from `@xian-tech/client`. Consumers
must use the explicit artifact APIs:

- `getContractSource(contract)` for canonical contract source
- `getContractIr(contract)` for Xian VM IR

Release checklist:

- tag as the next breaking pre-1.0 version, for example `v0.2.0`
- update every publishable package version to the tag version before tagging
- call out the removed `getContract(...)` alias in release notes
- update downstream examples and wallet dependencies before publishing

## Tag Workflow

1. Update `packages/client/package.json` and `packages/provider/package.json`
   to the intended release version.
2. Run `npm install` if package metadata changed.
3. Run `npm run validate`.
4. Commit the release version changes.
5. Create and push a tag in the form `vX.Y.Z`.

## What The Release Workflow Does

On `v*` tags, GitHub Actions will:

1. install dependencies
2. run `npm run validate`
3. verify that the package versions match the tag
4. build npm tarballs for the publishable packages
5. publish them to npm with trusted publishing
6. create a GitHub release from the same tag

## Notes

- Do not tag from a dirty tree.
- If `xian-wallet-browser` needs the new SDK version, release `xian-js` first.
- npm trusted publishing must be configured for each publishable package before
  the workflow can publish successfully.
