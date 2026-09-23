---
description: Relance le build en échec, délègue la réparation à l'agent build-fixer, puis prouve le vert par une nouvelle exécution.
argument-hint: "[commande de build, vide = détection auto]"
---

Répare le build du dépôt courant. Commande fournie : `$ARGUMENTS`

Le succès se mesure à une seule chose : la commande passe à nouveau, et la
sortie le montre.

## 1. Trouver la commande

Si `$ARGUMENTS` est vide, la détecter dans cet ordre, et s'arrêter à la première
qui s'applique :

- `package.json` : lire `scripts` (clé ciblée : `jq '.scripts' package.json`).
  Prendre `build`, sinon `typecheck`, sinon `tsc --noEmit`. Le gestionnaire se
  déduit du lockfile : `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, sinon `npm`.
- `go.mod` : `go build ./...` puis `go vet ./...`.
- `pyproject.toml` / `setup.cfg` : l'outil de type déclaré (`mypy`, `pyright`),
  sinon `python -m compileall -q .`.
- `Cargo.toml` : `cargo build`.
- `Makefile` : la cible `build` si elle existe (`make -n build` pour vérifier).

Si rien ne s'applique, ou si plusieurs chaînes coexistent sans signal clair,
demander à l'utilisateur plutôt que deviner.

## 2. Constater l'échec

Lancer la commande et garder la sortie **entière**. Si elle passe déjà, le dire
et s'arrêter : il n'y a rien à réparer.

## 3. Déléguer

Appeler l'outil Agent avec `subagent_type: build-fixer` (agent utilisateur, sans
préfixe de plugin). Lui passer :

- la commande exacte et le répertoire de travail ;
- la sortie d'erreur (les 80 premières lignes suffisent si elle est longue) ;
- le rappel de ses interdits : pas d'`any`, pas de `@ts-ignore`, pas
  d'`eslint-disable`, pas de `--no-verify`, pas de test supprimé ou ignoré,
  pas de config assouplie.

## 4. Prouver

Relancer **toi-même** la même commande après le retour de l'agent. Ne pas se fier
à son rapport seul.

- Vert : montrer les dernières lignes de sortie et le code de retour.
- Encore rouge : montrer la nouvelle erreur et dire ce qui reste. Ne pas
  annoncer une réparation partielle comme un succès.

## Rapport

```
Commande : pnpm build
Cause : import de `formatDate` depuis un module renommé en `date-utils`
Fichiers touchés : src/lib/report.ts
Preuve : exit 0 — "✓ Compiled successfully"
```

Si l'agent a dû s'arrêter sur un choix qui affaiblit un garde-fou, relayer sa
question à l'utilisateur telle quelle.
