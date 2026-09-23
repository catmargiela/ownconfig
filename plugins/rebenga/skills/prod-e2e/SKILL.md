---
name: prod-e2e
description: Suite Playwright versionnée dans le dépôt et lancée contre la production sans risque — comptes de test jetables, parcours en lecture, identifiants par variables d'environnement. À utiliser quand on veut vérifier la production après un déploiement, tester en prod, ou écrire des tests e2e de production.
---

# Tests e2e contre la production

Vérifier la production par des tests, c'est accepter qu'ils tournent sur de
vraies données. La suite doit donc être plus prudente qu'une suite de dev : elle
ne peut rien casser, rien polluer, et rien laisser derrière elle.

## Une suite, pas un script

- Elle vit **dans le dépôt du projet**, par exemple `e2e/prod/`, avec son propre
  projet Playwright (`projects: [{ name: 'prod', testDir: 'e2e/prod' }]`) ou sa
  propre config. Elle est relue, versionnée et relancée à chaque déploiement.
- Pas de script jetable dans un dossier temporaire : ce qui n'est pas dans le
  dépôt ne sera pas relancé.
- Le plugin MCP Playwright sert à **explorer** un écran ou reproduire un bug à
  la main. Ce qu'on en apprend devient ensuite un test dans la suite.

## Comptes de test

- Des comptes dédiés et jetables, nommés `e2e-<horodatage>-<aléa>`, créés par
  le setup de la suite (par API si possible) et **supprimés** en teardown, même
  en cas d'échec (`globalTeardown` ou fixture avec nettoyage).
- Jamais le compte d'un vrai utilisateur, jamais un compte administrateur
  partagé. Droits minimaux pour les parcours couverts.
- Si le projet ne permet pas de créer un compte proprement, le dire et demander
  un compte de test permanent plutôt que contourner.

## Ce qu'on teste

- **Lecture d'abord** : connexion, pages principales, recherche, affichage d'une
  fiche, téléchargement d'un document, santé de l'API.
- Écriture : seulement sur des objets créés par la suite elle-même, préfixés
  `e2e-`, et effacés à la fin.
- **Interdit** : supprimer, modifier ou envoyer quoi que ce soit sur une donnée
  réelle, déclencher un paiement, un e-mail ou une notification vers une
  personne réelle, un import en masse.

## Identifiants et configuration

- URL et identifiants par variables d'environnement uniquement
  (`E2E_BASE_URL`, `E2E_ADMIN_TOKEN`…), documentées dans `.env.example` sans
  valeur. Jamais dans le code, jamais dans un `storageState` commité.
- Le fichier `storageState` va dans un chemin ignoré par git.

## Lancer

```bash
E2E_BASE_URL=https://<domaine> npx playwright test --project=prod
npx playwright test --project=prod --reporter=list   # compte lisible
npx playwright test --project=prod --trace on        # pour déboguer
```

Headless par défaut, `retries: 0` : un échec en production se lit, il ne se
relance pas jusqu'au vert. Rapporter `N réussis / M échoués / K ignorés`, les
tests en échec avec leur cause, et confirmer que les comptes `e2e-*` ont bien
été supprimés.

## Déléguer

Pour écrire, lancer et déboguer la suite, utiliser l'agent
`rebenga:e2e-runner`. Lui donner l'URL de production, les parcours à couvrir,
le nom des variables d'environnement et l'**accord explicite** de
l'utilisateur pour lancer contre la production — sans cet accord, il refuse.
