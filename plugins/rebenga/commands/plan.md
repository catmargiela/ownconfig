---
description: Explorer le codebase et produire un plan d'implémentation validé avant d'écrire la moindre ligne de code.
argument-hint: "<fonctionnalité à planifier>"
---

Planifier : $ARGUMENTS

Suivre ces étapes dans l'ordre. **Aucun code n'est écrit avant l'approbation
explicite de l'utilisateur.**

## 1. Vérifier la demande

Si `$ARGUMENTS` est vide, demander à l'utilisateur ce qu'il veut planifier, puis
s'arrêter. Ne pas deviner.

## 2. Déléguer l'exploration

Lancer l'outil Agent avec `subagent_type: "rebenga:planner"`. Lui passer :

- la demande telle quelle : `$ARGUMENTS` ;
- le contexte utile déjà connu dans la session — fichiers mentionnés, contraintes
  énoncées, décisions prises, stack du projet.

Attendre son plan. Ne pas refaire l'exploration ici en parallèle.

## 3. Passer en mode plan

Appeler l'outil `EnterPlanMode`. S'il n'est pas chargé, le charger d'abord avec
ToolSearch, requête `select:EnterPlanMode,ExitPlanMode`.

En mode plan :

- relire le plan du planner, vérifier les chemins cités qui paraissent douteux ;
- l'affiner : étapes manquantes, vérification absente, risque sous-estimé ;
- trancher ce qui peut l'être, laisser les vraies questions ouvertes visibles.

Présenter le plan final avec `ExitPlanMode` pour approbation.

## 4. Attendre

Tant que l'utilisateur n'a pas approuvé, ne créer ni ne modifier aucun fichier.
S'il demande des changements, réviser le plan et le représenter. Une fois
approuvé, suivre les étapes dans l'ordre et exécuter la vérification de chacune
avant de passer à la suivante.
