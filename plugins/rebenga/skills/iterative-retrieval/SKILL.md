---
name: iterative-retrieval
description: Déléguer à des sous-agents sans leur déverser tout le contexte — tâche et pointeurs minimaux, puis l'agent rend ce qui lui manque dans une section fixe, et on relance en 2 ou 3 tours maximum. À utiliser quand on délègue à des agents, surtout en lot parallèle (issues, revues, explorations), ou quand le contexte principal sature.
---

# Contexte à la demande pour les sous-agents

Tout coller dans le prompt d'un sous-agent coûte deux fois : on relit les
fichiers ici pour les lui passer, et on les paie à chaque tour suivant. Et le
plus souvent, on devine mal ce dont il a besoin. Mieux vaut lui donner le
minimum et le laisser dire ce qui lui manque.

## Premier envoi : tâche + pointeurs

- **La tâche** et son critère de fin, en deux ou trois phrases.
- **Des pointeurs, pas du contenu** : chemins, noms de fonctions, numéro
  d'issue, commande de test. L'agent lit lui-même.
- **Les décisions déjà prises** qu'il ne peut pas deviner (« on garde l'API
  v1 », « pas de nouvelle dépendance »), en une ligne chacune.
- **Le format de retour**, avec la section « Manque » obligatoire.

Pas d'historique de la conversation, pas de fichiers recopiés, pas de liste de
conventions qu'il trouvera dans le `CLAUDE.md` du projet.

## La section « Manque »

À ajouter telle quelle à la fin du prompt :

```
Termine par une section « ## Manque », même vide :
- Fichiers : chemins que tu n'as pas trouvés ou pas pu lire.
- Décisions : choix que tu ne peux pas trancher seul, avec les options.
- Conventions : règle du projet ambiguë ou contradictoire.
Pour chaque ligne, dis ce qui bloque et ce que tu as fait en attendant.
N'invente pas pour combler un manque : signale-le.
```

## Boucle

1. **Envoyer** le premier prompt (en parallèle pour un lot).
2. **Lire la section Manque** avant le reste. Vide et travail cohérent : fini.
3. **Répondre au manque seulement** : trancher la décision, donner le chemin,
   citer la convention. Relancer le même agent (SendMessage garde son
   contexte) plutôt qu'un nouveau qui repartirait de zéro.
4. **Deux ou trois tours au plus.** Au troisième manque sur le même point,
   c'est la tâche qui est mal découpée ou une question pour l'utilisateur :
   reprendre la main, pas relancer.

S'arrêter aussi quand le manque est « bonus » (un fichier de plus serait
agréable) : le résultat suffit, on ne rouvre pas.

## En lot parallèle

- Un manque commun à plusieurs agents (même convention floue) se tranche une
  fois et part à tous dans le même message.
- Un agent qui réclame les fichiers d'un autre lot signale un mauvais
  découpage : fusionner les deux lots, ne pas partager en douce.

## Ce que ça économise

Le contexte principal ne garde que des conclusions et quelques lignes de
manque, pas les fichiers lus par chaque agent. Sur un lot de cinq agents, c'est
la différence entre orchestrer jusqu'au bout et saturer la fenêtre avant
l'intégration.
