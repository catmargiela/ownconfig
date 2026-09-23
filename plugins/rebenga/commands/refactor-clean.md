---
description: Nettoie le code mort, les dépendances et exports inutilisés, sur une base de tests verte, via l'agent refactor-cleaner.
argument-hint: "[dossier ou vide pour tout le dépôt]"
---

Nettoie le code mort. Périmètre : `$ARGUMENTS` (vide = tout le dépôt).

## 1. Base

Détecter les commandes de build et de test (scripts de `package.json`, `go.mod`,
`pyproject.toml`, `Makefile`), puis les lancer.

- Rouge : s'arrêter. Montrer l'échec et proposer `/rebenga:build-fix` ou une
  correction des tests d'abord. Un nettoyage sur une base rouge ne prouve rien.
- Vert : noter les chiffres exacts (tests passés, durée) comme référence.

Mesurer l'état de départ :

```bash
git diff --stat HEAD            # doit être vide, sinon le signaler
git ls-files -- $ARGUMENTS | xargs cat | wc -l
```

Noter aussi le nombre de dépendances déclarées (manifeste du langage).

## 2. Déléguer

Appeler l'outil Agent avec `subagent_type: rebenga:refactor-cleaner`. Lui
passer le périmètre, les commandes de build et de test validées à l'étape 1, et
le chiffre de référence des tests.

## 3. Prouver

Relancer **toi-même** build et tests après le retour de l'agent. Comparer :

```bash
git diff --stat
git ls-files -- $ARGUMENTS | xargs cat | wc -l
```

## Rapport

```
Avant : 18 420 lignes, 46 dépendances, tests 128/128 ✓
Après : 18 008 lignes, 44 dépendances, tests 128/128 ✓
Supprimé : −412 lignes, −2 dépendances (lodash, moment), 1 fichier
Conservé volontairement : parseLegacy (référence dynamique)
API publique touchée : aucune
```

Si le nombre de tests a baissé, le signaler explicitement et en donner la
raison : un test supprimé n'est pas un nettoyage.

Ne pas committer. Proposer la skill `git-ship` si l'utilisateur veut committer,
avec un commit `refactor:` par catégorie de suppression.
