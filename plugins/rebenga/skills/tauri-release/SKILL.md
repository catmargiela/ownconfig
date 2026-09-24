---
name: tauri-release
description: Publish a release of a Tauri v2 desktop app (macOS, Windows) through GitHub Actions and tauri-action, updater included. Use when the user says « sors une version » ("cut a release"), « publie la release » ("publish the release"), « tag la v… » ("tag v…"), or when a Tauri release has failed.
---

# Tauri v2 release

Reply to the user in French.

A failed release is expensive: macOS runners are slow and billed, and a
"green" job may publish no files at all. Announce it only after seeing the
files on the release and a valid `latest.json`.

## 1. Before the tag

- **Review**: run `rebenga:rust-tauri-reviewer` on the diff since the last
  tag (`git diff <dernier-tag>..HEAD`). No tag with an open CRITICAL.
- **Consistent version everywhere**: `tauri.conf.json` (`version`),
  `src-tauri/Cargo.toml`, `package.json`, and a regenerated `Cargo.lock`. Grep
  the new version: it must appear in each one, identical.
- **Secrets**: `gh secret list` must show the updater signing key and its
  password (names expected by the workflow, often
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), plus
  the Apple/Windows signing ones if used. Never read or display a value.
  Remind the user that the private key must be backed up off the machine:
  losing it means no longer being able to update installations.
- **Updater**: `plugins.updater.pubkey` not empty, `endpoints` pointing to the
  URL actually served, `bundle.createUpdaterArtifacts` enabled, and
  `uploadUpdaterJson` not disabled in the workflow.

## 2. The workflow

Read `.github/workflows/*.yml` in full before tagging:

- Trigger: which tag pattern (`v*`…) and on which branch.
- Windows: runners start under PowerShell. Any step written in bash must carry
  `shell: bash`, otherwise `ParserError` — often after macOS has already been
  built.
- Release: if a job creates the draft, pass its id to tauri-action through
  `releaseId` as a job output, do not look it up in the releases list (the
  draft may not be there yet). An empty `releaseId` skips all uploads and the
  job still ends in success.
- Several jobs writing the same `latest.json`: serialize them
  (`max-parallel: 1`) or merge it in a final job.
- Private repo: the `latest.json` URLs point to the assets API, not to a named
  public link. Check that whatever serves the updater can resolve them.

## 3. Tag and watch

1. Show the user the version, the tag and the commit; wait for their approval.
2. `git tag v<x.y.z> && git push origin v<x.y.z>`.
3. `gh run list --workflow <fichier> -L 1`, then `gh run watch <id> --exit-status`.
4. `gh release view v<x.y.z> --json assets,isDraft`: one installer, one update
   archive and one `.sig` signature per platform, and `latest.json`.
5. Download `latest.json` (`gh release download v<x.y.z> -p latest.json`):
   right version, one entry per platform, non-empty `signature`.

## Rollback

- Run failed before upload: fix, delete the local and remote tag
  (`git push origin :refs/tags/v<x.y.z>`), the draft if it exists, retag.
- Defective published version: do not delete a release already being served;
  publish a higher one. An updater does not downgrade.

## Report

Version, run link, list of assets seen, verified contents of `latest.json`,
and what was not verified (actual install on each OS).
