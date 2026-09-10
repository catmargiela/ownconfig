---
name: git-ship
description: Préparer un commit ou une pull request propre — découpage, message conventionnel, description de PR. À utiliser quand on s'apprête à committer, à pousser ou à ouvrir une PR.
---

# Committer et ouvrir une PR

## Avant de committer

```bash
git status                # ce qui va partir
git diff                  # ce qu'on a réellement écrit
```

Ne jamais faire `git add -A` sans avoir lu `git status`. Fichiers de build,
`.env`, dumps, captures d'écran et artefacts de test s'y glissent en silence.

Un commit = un changement cohérent. Si le message a besoin d'un « et », il y a
probablement deux commits.

## Message

```
<type>(<portée>): <ce que ça change, à l'impératif, en minuscule>
```

Types : `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

Le sujet dit **ce qui change**. Le corps, s'il existe, dit **pourquoi** — c'est
la seule information que le diff ne contient pas.

```
fix(upload): rejeter les fichiers > 5 Mo avant lecture en mémoire

Le contrôle de taille arrivait après le buffer complet, ce qui permettait
de saturer la RAM du serveur avec quelques requêtes simultanées.
```

Jamais de `--no-verify`. Si un hook de pré-commit échoue, il a une raison.

## Pull request

Titre : même forme qu'un message de commit.

Corps, dans cet ordre :

1. **Ce que ça change** — deux ou trois lignes, en langage utilisateur.
2. **Pourquoi** — le problème résolu, ou le ticket.
3. **Comment tester** — les étapes exactes qu'un relecteur doit suivre pour
   vérifier lui-même. C'est la section la plus utile et la plus souvent bâclée.
4. **Risques** — ce qui pourrait casser ailleurs, ce qui n'a pas été couvert.

Construire le résumé à partir de **tous** les commits de la branche
(`git log main..HEAD`), pas du seul dernier.

## Garde-fous

- Ne jamais pousser sur `main` ni forcer un push sans demande explicite.
- Préférer `--force-with-lease` à `--force` : il refuse d'écraser le travail
  d'un autre.
- Vérifier la branche de destination avant d'ouvrir la PR.
