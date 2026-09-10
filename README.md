# Configuration Claude Code

Configuration personnelle versionnée. Source de vérité : ce dépôt.
`~/.claude` ne contient que des liens symboliques vers lui — un fichier édité ici
est actif immédiatement, sans réinstallation.

Inspirée de [ECC](https://github.com/affaan-m/ECC) pour sa mécanique (dispatcher
de hooks, profils, fact-forcing, protection des garde-fous), volontairement pas
pour son volume : 5 agents et 3 skills au lieu de 68 et 286. Une surface qui ne
se déclenche jamais est un coût sans contrepartie.

## Installation

```bash
node install.js              # pose les liens et enregistre les hooks
node install.js --dry-run    # montre ce qui serait fait
node install.js --uninstall  # retire tout, laisse les hooks tiers en place
```

L'installeur est idempotent : il retire d'abord ses propres entrées de
`settings.json` (reconnues au chemin `hooks/ccx/dispatch.js`) avant de les
reposer. Les hooks tiers — vibe-island, pixel-agents — sont relus, comptés et
conservés. `settings.json` est sauvegardé à chaque passage.

## Contenu

| | |
|---|---|
| `CLAUDE.md` | règles chargées à chaque session — 63 lignes, chacune doit se justifier |
| `agents/` | 5 sous-agents : relecture, sécurité, build, front, tests |
| `skills/` | 3 workflows déclenchés par leur description |
| `hooks/` | dispatcher + 6 contrôles |
| `rules/templates/` | modèles de règles **par projet** (jamais installés en global) |

Pas de dossier `commands/` : une commande exige d'être tapée, une skill se
déclenche seule. Tout ce qui mérite d'exister est une skill.

## Profils

La rigueur se règle par une variable d'environnement, sans toucher à la config :

| `CC_PROFILE` | Comportement |
|---|---|
| `minimal` | refus durs seulement (`--no-verify`, `push --force`, `curl \| sh`) |
| `standard` | *(défaut)* + protection des garde-fous, fact-forcing sur commandes destructives, gate qualité sur `Stop` |
| `strict` | + fact-forcing sur la première écriture de **chaque** fichier |

```bash
CC_PROFILE=strict claude      # session sensible : migration, paiement, onchain
CCX_DISABLED=1 claude         # tout couper
```

Échappatoires ciblées : `CCX_ALLOW_CONFIG=1` (autoriser une édition de config),
`CCX_NO_TYPECHECK=1`, `CCX_DEBUG=1` (voir les erreurs internes des hooks).

## Hooks

Un seul process Node par événement, qui exécute ses modules en interne — plutôt
qu'un process par contrôle enregistré.

| Événement | Contrôle |
|---|---|
| `PreToolUse` Edit/Write | refuse d'éditer une config de lint/format/types ; fact-forcing (strict) |
| `PreToolUse` Bash | refus durs ; fact-forcing sur commande destructive |
| `PostToolUse` Edit/Write | empile les fichiers touchés (aucun travail lourd ici) |
| `Stop` | formate, typecheck et signale les `console.log` — en un seul lot |
| `SessionStart` | réinjecte le résumé des sessions précédentes du projet |

Deux invariants :

1. **Un hook ne casse jamais un appel d'outil.** Toute erreur inattendue se
   termine en sortie 0. Seul un refus délibéré sort en 2.
2. **Aucun gate ne boucle.** Le fact-forcing ne se déclenche qu'une fois par
   cible et par session ; le gate de typecheck est plafonné à 3 relances et
   ignore une signature d'erreur déjà vue.

### Le fact-forcing

Demander « tu es sûr ? » à un modèle ne produit rien : il répond oui. Le hook ne
demande donc pas confirmation, il **refuse** et exige des faits — qui importe ce
fichier, quelle API publique bouge, quel est le plan de rollback, quelle était
l'instruction exacte. L'investigation forcée produit une prudence que
l'auto-évaluation ne produit pas. La seconde tentative passe.

## Étendre

- **Un agent** : `agents/<nom>.md`, frontmatter `name` / `description` / `tools` /
  `model`. La `description` détermine quand il est appelé — la rédiger comme un
  déclencheur, pas comme un titre.
- **Une skill** : `skills/<nom>/SKILL.md`, frontmatter `name` + `description`.
  Même règle : la description est le déclencheur.
- **Un contrôle** : un module dans `hooks/lib/`, exportant `run(input)`, ajouté à
  la table `EVENTS` de `hooks/dispatch.js`.

Après ajout d'un agent ou d'une skill, relancer `node install.js` pour poser le
lien. Modifier un fichier existant ne demande rien.

## Ce qui reste volontairement local

Les règles de langage vivent dans le projet (`.claude/rules/`), pas ici. Une
règle globale est du contexte payé à chaque session, y compris sur les projets
qui ne la concernent pas. Voir `rules/templates/`.
