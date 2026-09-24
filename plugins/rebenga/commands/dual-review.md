---
description: Double revue indépendante d'un diff ou d'une PR sur une grille PASS/FAIL, avec boucle de correction bornée à trois tours.
disable-model-invocation: true
argument-hint: [numéro de PR, chemins, ou vide pour le diff courant]
---

Double revue demandée. Arguments : `$ARGUMENTS`

## Procédure

1. Périmètre :
   - un numéro de PR : `gh pr diff <n>` et `gh pr view <n>` pour l'objectif ;
   - des chemins : `git diff HEAD -- <chemins>` ;
   - rien : `git diff HEAD`, puis `HEAD~1` si c'est vide.
   Diff vide : le dire et s'arrêter. Lire les fichiers modifiés pour comprendre
   le changement, sans commencer la revue toi-même.
2. Construire une grille de **8 à 12 contrôles binaires**, taillée pour ce diff.
   Chaque contrôle a une condition PASS vérifiable, pas une appréciation. Base :
   - la logique fait ce que l'objectif annonce, cas limites compris ;
   - aucune erreur avalée ni fallback qui masque une panne ;
   - chaque comportement modifié est exercé par un test qui l'affirme ;
   - aucun garde-fou affaibli (lint, typecheck, test désactivé, `nolint`,
     `eslint-disable`, `any`, `--no-verify`) ;
   - aucun secret, token ou chemin personnel en dur ;
   - entrées validées à la frontière (handler, commande Tauri, formulaire).
   Ajouter selon le diff : migration goose réversible et sans verrou long,
   requête sqlc paramétrée, `ctx` propagé, état d'erreur SWR rendu, `Result`
   Rust remonté au front, pas de `unwrap` sur une entrée externe.
   Montrer la grille à l'utilisateur avant de lancer les relecteurs.
3. Lancer **deux relecteurs en parallèle**, dans un seul message avec deux
   appels Agent : par défaut `code-reviewer` et `rebenga:silent-failure-hunter`
   (ou `rebenga:go-reviewer`, `web-reviewer`, `rebenga:rust-tauri-reviewer`
   selon la stack dominante). Même prompt pour les deux : l'objectif, la grille,
   la commande de diff, et la consigne « tu es seul à relire, rends PASS ou FAIL
   pour chaque contrôle avec la preuve `fichier:ligne` ; en cas de doute, FAIL ».
   Aucun des deux ne voit la sortie de l'autre.
4. Porte de verdict :
   - les deux rendent PASS sur tous les contrôles : verdict **PASS**, fin ;
   - sinon : lister les contrôles en échec, avec la preuve de chaque relecteur,
     et proposer un correctif ciblé par contrôle.
5. Appliquer les correctifs **seulement après l'accord de l'utilisateur**,
   limités à ce qui a été signalé. Puis relancer l'étape 3 avec deux relecteurs
   neufs, sans leur transmettre les rapports précédents.
6. **Trois tours maximum.** Au-delà, s'arrêter et présenter ce qui reste en
   échec pour décision manuelle.

## Interdits

- Moyenner ou trancher en silence un désaccord : un contrôle PASS chez l'un et
  FAIL chez l'autre est rapporté comme désaccord, avec les deux preuves.
- Passer un contrôle en PASS en assouplissant sa condition entre deux tours.
- Committer, pousser ou corriger sans accord explicite.
- Donner à un relecteur le rapport de l'autre ou d'un tour précédent.

## Format du rapport

| # | Contrôle | Relecteur A | Relecteur B | Preuve |
|---|---|---|---|---|
| 1 | … | PASS / FAIL | PASS / FAIL | `fichier:ligne` |

Puis : désaccords (contrôle, position de chacun) ; tours effectués (N/3) ;
verdict final **PASS**, **FAIL** (avec les contrôles restants) ou **ESCALADÉ**.
