---
name: e2e-testing
description: Patterns de tests end-to-end d'application web avec Playwright — localisateurs, fixtures, auth réutilisée, anti-instabilité, CI. À utiliser quand on parle de tests end-to-end, de parcours utilisateur à tester, de Playwright ou de test instable.
---

# Tests end-to-end

Un test e2e coûte cher à écrire, à lancer et à maintenir. Il se justifie quand
il protège un parcours dont la panne coûte de l'argent ou des utilisateurs.

## Quand l'écrire

- **Oui** : inscription, connexion, paiement, parcours principal du produit,
  intégration entre front, API et base qu'aucun autre test ne couvre.
- **Non** : logique métier, cas limites de validation, formatage. Un test
  unitaire les couvre plus vite et plus précisément.

Viser quelques parcours solides, pas une copie e2e de la suite unitaire.

## Localisateurs

Par ordre de préférence : `getByRole('button', { name: 'Payer' })`,
`getByLabel('E-mail')`, `getByText`, puis `getByTestId`. Ils suivent ce que
l'utilisateur voit et échouent quand l'accessibilité casse. Jamais de sélecteur
fondé sur une classe CSS ou la position dans le DOM.

## Fixtures et données

- `test.extend` pour fournir une page déjà dans le bon état ou un utilisateur
  de test créé par API.
- Chaque test crée ses propres données, avec un identifiant unique, et ne
  dépend d'aucun autre test.
- Préparer l'état par API plutôt que par clics : plus rapide, moins fragile.

## Authentification

Un projet `setup` se connecte une fois et écrit `storageState` dans un fichier
ignoré par git. Les autres projets le déclarent dans `use.storageState` et
dépendent du setup via `dependencies`. Identifiants par variables
d'environnement, jamais en dur.

## Attentes

- Assertions web-first : `await expect(locator).toHaveText(...)` attend seule.
- Pour un appel précis : `const res = page.waitForResponse('**/api/cart')`
  avant l'action, puis `await res` après.
- Interdit : `page.waitForTimeout(ms)`. Un délai fixe est soit trop long, soit
  trop court sur la CI.

## Anti-instabilité

Un test instable est un bug, dans le test ou dans l'application. Le reproduire
avec `npx playwright test --repeat-each=10 fichier.spec.ts`, lire la trace, et
corriger la cause : attente manquante, données partagées, animation, horloge.
Ne pas monter `retries` ni marquer `skip` pour le faire taire.

## Lancer

```bash
npx playwright test                     # headless, tous les navigateurs configurés
npx playwright test e2e/checkout.spec.ts --project=chromium
npx playwright test --trace on          # trace complète pour déboguer
npx playwright show-report
```

En CI : `npx playwright install --with-deps chromium`, `webServer` dans la
config pour démarrer l'application, `forbidOnly: !!process.env.CI`, et
`test-results/` publié en artefact en cas d'échec.

## Déléguer

Pour écrire, lancer et déboguer les tests, utiliser l'agent
`rebenga:e2e-runner`. Lui donner le parcours à couvrir, l'URL de base et la
commande de démarrage de l'application.
