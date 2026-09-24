---
description: Transforme un comportement à interdire en contrôle de hook testé dans le dépôt de config — à partir d'une description ou de l'analyse des sessions récentes.
disable-model-invocation: true
argument-hint: "[comportement à interdire, ou vide pour analyser les sessions]"
---

Hookifier : `$ARGUMENTS`

Une consigne répétée dans le chat s'oublie ; un contrôle dans le dispatcher ne
s'oublie pas. Le but est un module de hook testé, jamais une règle écrite à la
va-vite dans la config vivante.

## 1. Trouver la règle

- **Argument fourni** : partir de lui. Demander un exemple concret de commande
  ou d'édition fautive s'il n'y en a pas.
- **Argument vide** : lancer l'agent `rebenga:conversation-analyzer` sur les
  20 dernières sessions. Montrer sa liste classée, puis demander **quelle règle
  implémenter**. Une seule par passage.

## 2. Spécifier avant d'écrire

Présenter et faire valider :

| Champ | Contenu |
|---|---|
| Événement | `pre-bash`, `pre-edit`, `post-edit`, `stop`, `pre-compact` ou `session-start` |
| Cible | champ lu dans l'entrée : `tool_input.command`, `file_path`, contenu écrit |
| Déclencheur | condition exacte, avec 3 exemples qui doivent déclencher et 3 qui ne doivent pas |
| Action | **refus** (exit 2, message français qui dit quoi faire à la place) ou **avertissement** (`util.warn()`, une fois par cible et par session) |
| Profils | `minimal` = refus durs seulement ; `standard` par défaut ; `strict` pour le zèle |
| Faux positifs | où ça peut mordre à tort (texte cité, heredoc, commentaire) et comment on l'évite |

Dans le doute, avertir plutôt que refuser : un refus à tort bloque le travail.

## 3. Implémenter dans le dépôt de config

Dans `~/.claude-config`, **sur une branche** (`git switch -c feat/hook-<nom>`).
Les hooks installés pointent vers ce dépôt : si le checkout est lié en direct,
travailler dans un `git worktree` pour ne rien changer à la session en cours.

1. Lire `hooks/dispatch.js`, `hooks/lib/util.js` et un module voisin
   (`bash-hygiene.js` pour un avertissement, `secret-guard.js` pour un refus)
   en entier. Réutiliser `stripQuoted` / `stripHeredocs` de `pre-bash.js`.
2. Créer `hooks/lib/<nom>.js` : `run(input)` qui sort tôt si
   `!enabled([...profils])`, la détection en fonction pure exportée, puis
   `deny(message)` ou `warn(message)`. Aucune exception ne doit remonter.
3. L'ajouter à la table `EVENTS` de `dispatch.js`, à la bonne place : les refus
   avant les avertissements, sans réordonner les modules existants.
4. Tests dans `test.js`, nouveau `group(...)` : cas positifs, cas négatifs
   (dont les faux positifs identifiés), un test par profil concerné et un avec
   `CCX_DISABLED=1`, plus un appel réel via `hook(...)` qui vérifie le code de
   sortie.
5. README : ligne du tableau `Hooks`, profils si besoin, compteurs de l'intro.

## 4. Prouver

`node test.js` → la sortie complète, zéro `FAIL`. Un test existant qui passe au
rouge se corrige dans le nouveau module, **jamais** en modifiant ou retirant le
test ni en affaiblissant un garde-fou existant.

## 5. S'arrêter là

Montrer le diff, la sortie des tests et le message de refus ou d'avertissement
tel qu'il s'affichera. Ne pas merger, ne pas relancer `install.js`, ne rien
activer dans la config vivante sans un oui explicite. Pas de commit sans
demande ; s'il est demandé : `feat(hooks): …`.
