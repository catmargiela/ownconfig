---
name: issue-batch
description: Traiter un lot d'issues GitHub en parallèle, puis les commenter, les fermer et les passer en « Done » dans un tableau GitHub Projects. À utiliser quand l'utilisateur dit « fais les issues #X, #Y », « traite les issues ouvertes », « mets-les en done ».
---

# Lot d'issues GitHub

Une issue fermée annonce un correctif livré. On ne ferme donc que ce qui est
mergé et vérifié, et le tableau doit refléter exactement la même chose.

## 1. Préflight

- `gh auth status` : lire les scopes réellement affichés. Il faut `repo` ; pour
  déplacer des cartes dans un tableau Projects v2, il faut aussi `project`.
- Scope `project` absent : dire à l'utilisateur de lancer lui-même
  `gh auth refresh -s project` (flux interactif), puis relancer `gh auth status`
  pour le constater. Tant qu'il manque, on traite les issues mais **aucun
  déplacement de carte** — le signaler dans le rapport final.
- Dépôt et tableau : les lire depuis le `CLAUDE.md` du projet ou `git remote -v`,
  sinon les demander. Ne jamais deviner un propriétaire ou un numéro de tableau.

## 2. Récupérer et découper

- Lire chaque issue via le serveur MCP GitHub (`issue_read`) ou
  `gh issue view <n> --json number,title,body,labels,state`.
- Écarter les issues déjà fermées ou dont le correctif existe déjà (chercher le
  commit ou la PR) : les lister à part, avec la preuve.
- Grouper en lots dont les fichiers touchés sont **disjoints**. Deux issues sur
  le même fichier vont dans le même agent, ou en séquence.

## 3. Implémenter

- Un sous-agent par lot, lancés en parallèle dans un seul message, avec
  `isolation: "worktree"` pour qu'ils ne se marchent pas dessus.
- Chaque agent reçoit : le texte de l'issue, les fichiers visés, la commande de
  test, et la consigne de rendre le diff et la sortie des tests.
- Relire chaque diff avec `code-reviewer` (et `security-reviewer` sur auth,
  paiement, upload, SQL). Corriger avant d'intégrer.
- Intégrer, puis lancer la suite complète sur le résultat fusionné — pas
  seulement dans chaque worktree.

## 4. Clôturer, issue par issue

Seulement si le correctif est mergé (ou poussé sur la branche convenue) et que
les tests sont verts :

1. Commenter : ce qui a changé, en deux ou trois lignes, et le lien du commit ou
   de la PR. `gh issue comment <n> --body-file <fichier>`.
2. Fermer avec un motif : `gh issue close <n> --reason completed` (ou
   `"not planned"` pour une issue écartée, avec l'explication en commentaire).
3. Tableau : récupérer les identifiants, **ne jamais les deviner** :
   - `gh project view <num> --owner <owner> --format json` → id du projet ;
   - `gh project field-list <num> --owner <owner> --format json` → id du champ
     `Status` et id de l'option `Done` ;
   - `gh project item-list <num> --owner <owner> --format json` → id de la carte.
   Puis `gh project item-edit --id <item> --project-id <projet>
   --field-id <champ> --single-select-option-id <option>`.

## Interdits

- Fermer une issue dont le correctif n'est ni mergé ni vérifié.
- Contourner un scope manquant (autre jeton, API brute avec un secret en clair).
- Déclarer une carte « Done » sans avoir relu son statut après `item-edit`.

## Rapport final

Un tableau `issue → statut` : fermée + Done / fermée, carte non déplacée (et
pourquoi) / ouverte (bloquante, avec la raison) / déjà faite (preuve). Puis les
commandes lancées et leurs sorties réelles, et ce qui reste à la charge de
l'utilisateur.
