# Operating rules

Répondre en français. Code, noms de variables, commits et docs techniques en anglais.

## Non-negotiables

1. **Ne jamais affaiblir un garde-fou pour faire passer un test.** Si le linter, le
   typecheck ou un test bloque, corriger le code — pas la config, pas le test,
   pas d'`any`, pas de `eslint-disable`, pas de `--no-verify`.
2. **Ne jamais inventer une API.** Si la signature d'une lib n'est pas certaine,
   la lire dans `node_modules/`, la doc, ou via context7. Un appel plausible mais
   faux coûte plus cher qu'une vérification.
3. **Pas de secret en dur.** Jamais de clé, token ou mot de passe dans le code ou
   les logs. Variables d'environnement uniquement.
4. **Vérifier avant d'annoncer.** "Ça marche" exige une commande exécutée et sa
   sortie. Sinon, dire ce qui a été fait et ce qui reste à vérifier.
5. **Dire ce qui a échoué.** Un test rouge, une étape sautée, une hypothèse non
   confirmée se signalent explicitement. Ne jamais masquer par omission.

## Avant d'écrire du code

- Chercher si ça existe déjà dans le repo avant de créer un fichier.
- Lire le fichier en entier avant de le modifier, pas seulement la zone visée.
- Sur un changement non trivial : qui importe ce fichier, quelle API publique
  bouge, quel format de données est touché.

## Style

- Beaucoup de petits fichiers plutôt que peu de gros. ~200-400 lignes, 800 max.
- Fonctions < 50 lignes, imbrication < 4 niveaux.
- Immuabilité par défaut : renvoyer une nouvelle valeur plutôt que muter.
- Valider les entrées aux frontières du système, pas au milieu.
- Correspondre au style du fichier existant plutôt qu'imposer le sien.

## Délégation

Claude Code fournit déjà `Plan` (architecture) et `Explore` (recherche large).
Les utiliser plutôt que de fouiller à la main sur une question qui traverse
plusieurs fichiers.

Agents locaux :

| Situation | Agent |
|---|---|
| Code qui vient d'être écrit ou modifié | `code-reviewer` |
| Auth, paiement, upload, requête SQL, onchain | `security-reviewer` |
| Build ou typecheck cassé | `build-fixer` |
| Composant React / route Next / hook | `web-reviewer` |
| Nouvelle feature ou correction de bug | `test-writer` |

Lancer les agents indépendants en parallèle dans un seul message.

## Git

- Conventional commits : `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`.
- Ne jamais `push --force` ni committer sur `main` sans demande explicite.
- Ne jamais `git add -A` à l'aveugle : vérifier `git status` d'abord.

## Contexte

Éviter les 20 % finaux de la fenêtre de contexte sur un refactor multi-fichiers.
Sur une session longue, préférer déléguer une recherche bruyante à un sous-agent
plutôt que de charger les fichiers ici.
