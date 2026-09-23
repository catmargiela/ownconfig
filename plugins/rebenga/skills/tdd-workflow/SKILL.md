---
name: tdd-workflow
description: Boucle test-first ROUGE, VERT, REFACTOR avec preuve à chaque étape. À utiliser quand on doit écrire le code avec les tests d'abord, pour une nouvelle fonctionnalité ou un correctif de bug en test-first.
---

# Workflow TDD

Le test d'abord n'a de valeur que si chaque étape est prouvée par la sortie du
runner. « Le test échoue » sans sortie collée est une affirmation, pas une preuve.

## Boucle

1. **ROUGE** — un test pour un comportement. Lancer. Montrer l'échec, et vérifier
   qu'il échoue sur l'assertion — pas sur un import cassé ou une faute de frappe.
2. **VERT** — le code minimal qui le fait passer. Lancer. Montrer le succès.
3. **REFACTOR** — nettoyer code et test. Relancer la suite concernée. Montrer
   qu'elle reste verte.

Un comportement par tour. Lancer le fichier de test ciblé pendant la boucle, la
suite complète à la fin.

## Choisir le premier test

- **Bug** : le test qui reproduit exactement le défaut signalé. S'il passe, le bug
  n'est pas compris — enquêter avant de corriger.
- **Feature** : le cas nominal le plus simple qui force l'existence de l'API
  publique (signature, nom, type de retour). Puis les frontières : entrée vide,
  `null`, valeur limite, erreur réseau.
- Tester le comportement observable par l'appelant, jamais l'implémentation.

## Déléguer

Lancer l'agent `rebenga:tdd-guide` quand l'implémentation demande plusieurs tours
de boucle ou touche plusieurs fichiers : il exécute la boucle entière et rend les
preuves ROUGE/VERT par comportement. Pour un changement d'un seul test, dérouler
la boucle ici.

Cette skill complète l'agent `test-writer` existant, elle ne le remplace pas :
`test-writer` écrit les tests d'une feature ou reproduit un bug avant correction ;
`tdd-guide` enchaîne test et implémentation jusqu'au vert. Pour un bug, on peut
faire écrire la reproduction par `test-writer`, puis dérouler VERT et REFACTOR.

## Interdits

Affaiblir une assertion, `skip` ou `only`, toucher la config du runner, mocker
l'unité sous test, un test réduit à un snapshot. Un rouge se corrige dans le code.

## Checklist

- [ ] Runner et conventions du projet repérés avant d'écrire
- [ ] Chaque test vu en échec, sortie montrée
- [ ] Chaque test vu en succès, sortie montrée
- [ ] Suite complète relancée après refactor, chiffres réels rapportés
- [ ] Aucun test affaibli, ignoré ni supprimé
- [ ] Tests ignorés ou non couverts signalés explicitement
