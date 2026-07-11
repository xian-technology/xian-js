# Releasing

`xian-js` follows the same high-level release model as `xian-py`:

- validation runs on pushes and pull requests
- publishing happens only from a git tag
- the release tag format is `vX.Y.Z`, with optional `alpha.N`, `beta.N`, or
  `rc.N` prerelease suffixes
- `release-manifest.json` pins every sibling build input by commit SHA and
  source-package version

## Version Policy

`xian-js` is versioned at the repo level.

That means:

- the repo tag is `vX.Y.Z`
- every publishable package in this repo must have version `X.Y.Z`
- the current publishable packages are `@xian-tech/client`,
  `@xian-tech/provider`, `@xian-tech/types`, and `@xian-tech/web-kit`

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

1. Update the root and every publishable package manifest to the intended
   release version:
   `package.json`,
   `packages/client/package.json`, `packages/provider/package.json`,
   `packages/types/package.json`, and `packages/web-kit/package.json`.
2. Run `npm install` if package metadata changed and commit the resulting
   `package-lock.json` update.
3. Update `release-manifest.json` to the exact released `xian-contracting`
   commit used for this SDK release. Its compiler version must match both that
   source checkout and the local file entry in `package-lock.json`.
4. Run `node scripts/release-context.mjs validate-manifest`.
5. Run `npm ci`, `npm audit --audit-level=critical --omit=dev`, and
   `npm run validate`.
6. Commit the release version and manifest changes from a clean tree.
7. Create and push a tag in the form `vX.Y.Z`.

If npm package-side permissions blocked one package after a tag was already
validated, fix the package trusted publisher in npm and run the `Release`
workflow manually with `release_tag` set to the existing tag. The manual path
checks out the immutable tag, validates the same artifacts, skips already
published packages only when their registry integrity matches, and uploads
artifacts to the existing GitHub release.

Trusted publishing must be configured separately for each publishable npm
package:

- provider: GitHub Actions
- organization/user: `xian-technology`
- repository: `xian-js`
- workflow: `release.yml`
- environment: `npm`

## What The Release Workflow Does

On an accepted release tag, GitHub Actions will:

1. verify the tag grammar and resolve the tag and trigger to one clean source SHA
2. validate every repo, package, lockfile, and sibling-manifest version
3. check out `xian-contracting` at the manifest's exact commit SHA
4. install locked dependencies, audit production dependencies, and run the
   complete workspace validation
5. build and inspect npm tarballs for every publishable package
6. upload those validated immutable artifacts
7. publish only the downloaded artifacts to npm with trusted publishing
8. create a GitHub release from the same tag and artifacts

The npm publish step is fail-closed for `@xian-tech/client`,
`@xian-tech/provider`, and `@xian-tech/types`. A version already on npm is
skipped only when its registry integrity exactly matches the validated tarball;
a mismatch fails closed.

`@xian-tech/web-kit` is still attached to the GitHub release as a validated
tarball if npm rejects publication because the package-side trusted publisher
or token permissions are not configured. Remove this exception after npm can
publish `@xian-tech/web-kit` from the release workflow.

## Notes

- Do not tag from a dirty tree.
- Do not pin a moving branch or an unversioned sibling checkout in the release
  manifest. Release validation must reflect the source package consumers can
  actually install.
- If `xian-wallet-browser` needs the new SDK version, release `xian-js` first.
- npm trusted publishing must be configured for each publishable package before
  the workflow can publish successfully.
