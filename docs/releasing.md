# Releasing LibreCode

This guide covers the full release process across all three repos:
- `techtoboggan/librecode` (main)
- `techtoboggan/librecode-i18n`
- `techtoboggan/librecode-3rdparty-providers`

## Prerequisites

- `gh` CLI authenticated (`gh auth status`)
- `npm` authenticated with publish access to the `@librecode` scope
- Git push access to all three repos
- For macOS signing: `APPLE_*` secrets set in the main repo's GitHub Actions settings

## Version scheme

`MAJOR.MINOR.PATCH[-prerelease]` following SemVer. Preview releases use the
suffix `-preview.N` (e.g. `1.0.0-preview.1`, `1.0.0-preview.2`). Release
candidates use `-rc.N`. Stable releases have no suffix.

CI automatically marks GitHub Releases as `prerelease: true` when the tag
contains `-preview.` or `-rc.`.

---

## Step 1 — Update dependent repos

### librecode-i18n

```bash
cd /path/to/librecode-i18n

# Make any locale changes, then:
# Edit package.json version manually, or let the release script handle it.
# The main repo's npm-publish workflow reads from i18n's main branch,
# so just ensure main is up to date.

git add .
git commit -m "chore: bump to vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

The i18n repo's own `npm-publish.yml` will attempt to publish `@librecode/i18n`
on tag push. The main repo's `npm-publish.yml` also publishes it — both are
idempotent (the second one skips with a "already published" message).

**Wait for i18n to land on npm before proceeding:**
```bash
# Poll until this returns the new version
npm view @librecode/i18n@X.Y.Z version
```

### librecode-3rdparty-providers

```bash
cd /path/to/librecode-3rdparty-providers

# Bump versions in all four package.json files if needed, then:
git add .
git commit -m "chore: bump to vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

The OIDC publish workflow fires automatically on the tag push. Providers depend
on `@librecode/plugin` being on npm — if this fires before the main repo
publishes plugin, it retries up to 5 times (5 min total). You can also
re-run it manually once plugin is published:
```bash
gh run rerun <run-id> --failed
```

---

## Step 2 — Release the main repo

Use the release script. It bumps all versions, regenerates the lockfile
(critical — skipping this causes `bun install --frozen-lockfile` failures in
CI), commits, and tags:

```bash
cd /path/to/librecode
scripts/release.sh X.Y.Z
```

The script will:
1. Bump `version` in all 7 `package.json` files and `Cargo.toml`
2. Run `bun install` to update `bun.lock` with the new `@librecode/i18n` version
3. Commit with message `chore: bump version to X.Y.Z`
4. Create tag `vX.Y.Z`
5. Print next-step instructions

Then push:
```bash
git push && git push --tags
```

---

## Step 3 — Monitor CI

Four workflows fire simultaneously on the tag push:

| Workflow | What it does | Typical duration |
|---|---|---|
| `Publish npm packages` | Publishes `@librecode/sdk`, `@librecode/i18n`, `@librecode/plugin` | ~3 min |
| `Release` | Builds CLI binaries for 7 targets, uploads to GitHub Release with SHA256SUMS | ~10 min |
| `Desktop` | Builds `.deb`, `.rpm`, AppImage (Linux), signed `.app`+`.dmg` (macOS), `.exe` (Windows) | ~20–30 min |
| `Flatpak` | Builds Flatpak bundle from cargo-sources.json, uploads to GitHub Release | ~30–40 min |

Watch live:
```bash
gh run list --limit 10
gh run watch <run-id>
```

### CI ordering and known races

`Desktop` and `Release` both run `bun install --frozen-lockfile`, which needs
`@librecode/i18n@X.Y.Z` to be resolvable on npm. They poll npm for up to
10 minutes before running install — if i18n publish is slow you may see
"Not yet, retrying..." lines in the logs. This is normal.

`Publish npm packages` publishes i18n first, then sdk (which depends on i18n),
then plugin. All three steps skip gracefully if the version is already on npm
(safe to re-run).

If any job fails, re-run only the failed jobs:
```bash
gh run rerun <run-id> --failed
```

---

## Step 4 — Post-release: Homebrew formula

After `Release` completes, download `SHA256SUMS` from the GitHub Release and
update the Homebrew formula with the real checksums:

```bash
# Download SHA256SUMS
gh release download vX.Y.Z --pattern SHA256SUMS

# Get the darwin-arm64 and darwin-x64 hashes
grep darwin SHA256SUMS
```

Edit `contrib/homebrew/librecode.rb` and replace the `sha256 "FILL_IN_AFTER_RELEASE"` 
placeholders. Then move the formula to the tap repo:

```bash
# If techtoboggan/homebrew-tap doesn't exist yet, create it on GitHub, then:
cd /path/to/homebrew-tap
cp /path/to/librecode/contrib/homebrew/librecode.rb Formula/librecode.rb
git add Formula/librecode.rb
git commit -m "librecode X.Y.Z"
git push

# Test it
brew install techtoboggan/tap/librecode
librecode --version
```

---

## Rollback

If a release is broken after tagging:

```bash
# Delete the remote tag (this voids the GitHub Release artifacts)
git push origin :refs/tags/vX.Y.Z
git tag -d vX.Y.Z

# Fix the issue, re-run the release script, push the new tag
scripts/release.sh X.Y.Z
git push && git push --tags
```

npm versions cannot be unpublished after 72 hours. For a broken npm publish,
release a patch version (`X.Y.Z+1`) instead.

---

## Checklist

Before tagging:
- [ ] All tests pass: `bun test --timeout 30000`
- [ ] No type errors: `bun run typecheck`
- [ ] No new lint warnings: `bunx biome lint packages/`
- [ ] `CHANGELOG.md` updated with the new version entry
- [ ] `PLAN.md` header version updated
- [ ] `librecode-i18n` is tagged and `@librecode/i18n@X.Y.Z` is on npm
- [ ] `librecode-3rdparty-providers` is tagged

After CI:
- [ ] GitHub Release created with all artifacts
- [ ] `npm view @librecode/sdk@X.Y.Z version` returns correctly
- [ ] `npm view @librecode/plugin@X.Y.Z version` returns correctly
- [ ] `npm view @librecode/i18n@X.Y.Z version` returns correctly
- [ ] Homebrew formula sha256s updated and tap repo pushed
- [ ] Smoke test: `curl -fsSL .../install.sh | sh` on a clean VM
