---
name: mirror-sync
description: Keep a module or front end duplicated across two repos in sync (for example a web app and its desktop app). Use when a patch must be « reporté de l'autre côté » ("carried over to the other side"), or when the user talks about a mirror (miroir), a copy or two front ends to keep aligned.
---

# Syncing a mirror

Reply to the user in French.

A front end copied into two repos drifts silently: every patch applied by hand
on one side only creates a divergence nobody decided. The goal is to separate
**intended** differences (platform-specific) from **drift**.

## 1. Find the pair

- Read each repo's `CLAUDE.md`: look for a "miroir" section giving the two
  roots (`<dépôt A>/<chemin>` ↔ `<dépôt B>/<chemin>`) and the list of intended
  divergences.
- Nothing documented: ask the user for both paths. Do not guess a mapping from
  similar-looking folder names.

## 2. Measure the gap

- `diff -rq <A> <B>` for the list of files that differ or are missing on one
  side, then `git diff --no-index <A>/<f> <B>/<f>` file by file.
- Exclude noise: `node_modules`, build output, generated files.
- Classify each divergence:
  - **intended** — platform-specific code (native API, routing, links,
    storage), or listed as such in the `CLAUDE.md`;
  - **drift** — a fix present on one side only, a file lagging behind;
  - **uncertain** — show it to the user, do not decide alone.

## 3. Carry a patch over

1. Make the change on one side, commit it or turn it into a patch:
   `git format-patch -1 <sha> --relative=<chemin A>` or `git diff > x.patch`.
2. Apply it on the other side, remapping the path:
   `git apply --directory=<chemin B> --3way x.patch` (or `-p<n>` if needed).
   `--check` first to see what does not apply.
3. A reject on a file with an intended divergence: carry the intent over by
   hand, preserving the platform-specific part, then show the result.
4. Run the typecheck and the build **of each repo**, with its own scripts
   (`package.json`, `Cargo.toml`…). One green side proves nothing for the other.
5. Rerun `diff -rq`: only the intended divergences must remain.

## Forbidden

- Overwriting a file on the other side by raw copy when it holds an intended
  divergence, without the user's approval.
- Aligning a drift "the wrong way" without checking which side carries the
  most recent fix (`git log -p` on the file in each repo).
- Announcing both sides in sync without both builds green.

## Making it last

Offer to write a "miroir" section in the project's `CLAUDE.md`: the two roots,
the list of files with intended divergences and why, and the diff command to
rerun. The next session will not have to rediscover the pair.

## Report

Files aligned, intended divergences kept, drifts fixed (with the direction),
uncertain ones pending, and the output of both builds.
