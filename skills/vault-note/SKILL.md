---
name: vault-note
description: Écrire dans le vault Obsidian — contexte d'un projet, décision prise, préférence de travail, état avant compaction. À utiliser quand l'utilisateur dit "note ça", "retiens ça", "mets ça dans mon vault", avant de compacter, ou quand une décision structurante vient d'être prise.
---

# Écrire dans le vault

Le vault Obsidian est la mémoire longue. Le contexte d'une session disparaît à la
compaction ; ce qui est dans le vault revient à chaque session suivante.

Emplacement : `~/Documents/Obsidian Vault/Claude/` (ou `$CC_VAULT`).

```
Claude/
├── Index Claude.md
├── Profil/
│   ├── Façon de coder.md    ← injecté à CHAQUE session, tous projets
│   └── Stack.md
├── Projets/<Projet>.md      ← injecté sur ce projet uniquement
└── Journal/<date> — <Projet>.md
```

## Règle de cohabitation

Les blocs délimités par `<!-- claude:xxx:start -->` … `<!-- claude:xxx:end -->`
sont gérés par les hooks. **Tout le reste appartient à l'utilisateur.**

Pour modifier une page : lire, éditer la section visée avec `Edit`, ne jamais
réécrire le fichier entier avec `Write`. Une note effacée par mégarde ne se
récupère pas.

## Où écrire quoi

| Information | Destination |
|---|---|
| Vrai sur tous les projets (préférence, convention, décision tranchée) | `Profil/Façon de coder.md` |
| Vrai sur ce projet seulement (architecture, piège, commande) | `Projets/<Projet>.md` |
| Vrai à un instant donné (état du travail, ce qui reste) | `Journal/<date> — <Projet>.md` |

Le mauvais rangement le plus fréquent : mettre dans le profil ce qui ne concerne
qu'un projet. Le profil est relu à chaque session, sur chaque projet — il se paie
partout. Dans le doute, écrire dans la page projet.

## Ce qui mérite d'être noté

- **Une décision et sa raison.** « On est passés à X parce que Y échouait sur Z. »
  Le *pourquoi* est la seule chose que le code ne dit pas.
- **Un piège vérifié.** Ce qui a fait perdre du temps, et comment le contourner.
- **Une préférence exprimée par l'utilisateur.** Quand il corrige une manière de
  faire, c'est durable — le noter évite de le refaire corriger.
- **L'état du travail en cours**, avant compaction ou en fin de session.

## Ce qui ne mérite pas d'être noté

- Ce que le code dit déjà : arborescence, liste de dépendances, signatures.
- Le détail d'une session de débogage qui s'est bien terminée.
- Une généralité vraie pour tout projet (« écrire des tests »). Elle est déjà
  dans le `CLAUDE.md` global.

Une page de projet dépasse rarement 60 lignes utiles. Au-delà, elle devient du
contexte payé à chaque session pour de l'information qu'on ne relit jamais.

## Écrire

```bash
V="$HOME/Documents/Obsidian Vault/Claude"
```

Toujours lire la page avant d'y toucher :

```bash
cat "$V/Projets/<Projet>.md"
```

Puis `Edit` sur la section concernée. Relier les pages entre elles avec des liens
`[[Nom de page]]` — c'est ce qui construit le graphe Obsidian et permet de
retrouver un contexte par rebond.

## Avant une compaction

C'est le moment le plus important : après, le détail n'existe plus.

1. Écrire dans le journal du jour : ce qui a été fait, où en est le travail, ce
   qui reste, et toute décision prise pendant la session.
2. Remonter dans `Projets/<Projet>.md` ce qui est durable (une décision, un
   piège) — le journal est daté, la page projet est permanente.
3. Puis seulement, proposer `/compact` à l'utilisateur.

Une compaction faite après cette écriture ne perd que des tokens. Faite avant,
elle perd de l'information.
