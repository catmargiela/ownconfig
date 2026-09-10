---
name: project-onboarding
description: Prendre en main un dépôt inconnu ou un projet client repris, puis produire son fichier CLAUDE.md local. À utiliser à la première session sur un codebase qu'on ne connaît pas, ou quand un projet n'a pas encore de CLAUDE.md.
---

# Prise en main d'un projet

Objectif : passer d'un dépôt inconnu à une carte utilisable, puis figer cette
carte dans un `CLAUDE.md` local pour ne jamais refaire ce travail.

## 1. Reconnaissance

Déléguer la recherche large à l'agent `Explore` plutôt que de charger des dizaines
de fichiers dans le contexte principal.

```bash
ls -la
cat package.json 2>/dev/null | head -50      # scripts + dépendances = la stack réelle
ls *.lock *lock.yaml yarn.lock 2>/dev/null   # le gestionnaire de paquets fait foi
git log --oneline -15                        # ce qui bouge en ce moment
git log --format='%an' | sort | uniq -c | sort -rn | head   # qui connaît ce code
```

Puis, sur l'arborescence : où vit le code source, où vivent les tests, où vit la
configuration de déploiement.

## 2. Les cinq questions qui comptent

Y répondre avant d'écrire la moindre ligne :

1. **Comment on lance ça ?** La commande de dev, et ses prérequis (variables
   d'environnement, base de données, service tiers).
2. **Comment on vérifie ?** Build, typecheck, lint, tests — les commandes exactes,
   telles que définies dans les scripts.
3. **Où est le cœur ?** Les 3 à 5 fichiers ou dossiers où passe la logique métier.
   Les fichiers les plus modifiés dans `git log` sont un bon indicateur.
4. **Quelles conventions existent déjà ?** Nommage, structure des dossiers, gestion
   des erreurs, style de commit. Les relever en lisant, pas en supposant.
5. **Où sont les mines ?** Code sans tests sur un chemin critique, migration en
   cours, dette signalée en commentaire, dépendance abandonnée.

## 3. Figer le résultat

Écrire `CLAUDE.md` à la racine du projet. Il est chargé à chaque session sur ce
dépôt : il doit rester court et ne contenir que ce qui n'est pas déductible du code.

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

Deux erreurs à éviter dans ce fichier : recopier ce que le code dit déjà (la liste
des dépendances, l'arborescence), et y mettre des généralités valables partout —
elles vivent dans le `CLAUDE.md` global, pas ici.

## 4. Règles locales, si nécessaire

Si le projet impose un langage ou un cadre absent du global (Solidity, Swift,
Python), créer `.claude/rules/<sujet>.md` dans le projet plutôt que d'alourdir la
configuration globale. Une règle ne doit vivre en global que si elle s'applique à
tous les projets.
