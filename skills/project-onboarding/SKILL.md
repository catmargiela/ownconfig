---
name: project-onboarding
description: Get up to speed on an unknown repository or a taken-over client project, then produce its local CLAUDE.md file. Use at the first session on an unfamiliar codebase, or when a project does not have a CLAUDE.md yet.
---

# Onboarding a project

Reply to the user in French.

Goal: go from an unknown repository to a usable map, then freeze that
map in a local `CLAUDE.md` so this work never has to be redone.

## 1. Reconnaissance

Delegate the broad search to the `Explore` agent rather than loading dozens
of files into the main context.

```bash
ls -la
cat package.json 2>/dev/null | head -50      # scripts + dependencies = the real stack
ls *.lock *lock.yaml yarn.lock 2>/dev/null   # the package manager is authoritative
git log --oneline -15                        # what is moving right now
git log --format='%an' | sort | uniq -c | sort -rn | head   # who knows this code
```

Then, on the file tree: where the source code lives, where the tests live, where the
deployment configuration lives.

## 2. The five questions that matter

Answer them before writing a single line:

1. **How do you run it?** The dev command, and its prerequisites (environment
   variables, database, third-party service).
2. **How do you verify?** Build, typecheck, lint, tests — the exact commands,
   as defined in the scripts.
3. **Where is the core?** The 3 to 5 files or folders the business logic goes through.
   The most modified files in `git log` are a good indicator.
4. **What conventions already exist?** Naming, folder structure, error
   handling, commit style. Note them by reading, not by assuming.
5. **Where are the mines?** Untested code on a critical path, migration in
   progress, debt flagged in a comment, abandoned dependency.

## 3. Freeze the result

Write `CLAUDE.md` at the project root. It is loaded in every session on this
repository: it must stay short and contain only what cannot be deduced from the code.

```markdown
# <projet>

<Une phrase : ce que fait ce projet, pour qui.>

## Commandes
- dev : `...`
- build : `...`
- test : `...`
- lint / types : `...`

## Architecture
<3 à 6 lignes : le flux principal, et où vit la logique métier.>

## Conventions du projet
<Uniquement les règles réelles observées, qui diffèrent des habitudes par défaut.>

## Pièges
<Ce qui a déjà fait perdre du temps ici, et pourquoi.>
```

Two mistakes to avoid in this file: copying what the code already says (the
dependency list, the file tree), and putting in generalities valid everywhere —
they live in the global `CLAUDE.md`, not here.

## 4. Local rules, if needed

If the project imposes a language or framework absent from the global config (Solidity, Swift,
Python), create `.claude/rules/<sujet>.md` in the project rather than weighing down the
global configuration. A rule should only live globally if it applies to
all projects.
