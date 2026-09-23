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
| `hooks/` | dispatcher + contrôles + pont Obsidian + moniteur de contexte |
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
| `PreCompact` | écrit l'état de la session dans le vault Obsidian |
| `Stop` | capture vault, puis format + typecheck + `console.log` en un lot, puis mesure du contexte |
| `SessionStart` | réinjecte le profil et le contexte projet depuis le vault |

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

## Mémoire longue — vault Obsidian

Le contexte d'une session disparaît à la compaction. Le vault est ce qui reste.

```
~/Documents/Obsidian Vault/Claude/
├── Index Claude.md
├── Profil/
│   ├── Façon de coder.md    ← injectée à CHAQUE session, tous projets
│   └── Stack.md
├── Projets/<Projet>.md      ← injectée sur ce projet uniquement
└── Journal/<date> — <Projet>.md
```

| Moment | Ce qui se passe |
|---|---|
| `SessionStart` | injecte le profil + la page projet + la dernière session, sous budget |
| `PreCompact` | écrit l'état dans le journal du jour **avant** que le contexte soit perdu |
| `Stop` | met à jour le bloc de fin de session, seulement si des fichiers ont été modifiés |

La skill `vault-note` sert à l'écriture délibérée — c'est elle qui produit les
bonnes notes ; les hooks ne sont que le filet automatique.

**Invariant de cohabitation.** Les hooks n'écrivent que dans les régions
`<!-- claude:xxx:start -->` … `<!-- claude:xxx:end -->`. Tout ce qui est rédigé à
la main hors de ces blocs n'est jamais réécrit. C'est ce qui permet de curer les
pages dans Obsidian sans craindre qu'un hook les efface.

**Discipline d'injection.** Une section vide, un placeholder non rempli, un pied
de navigation ou un bloc `dataview` sont retirés avant injection : ils coûtent des
tokens à chaque session et n'apprennent rien au modèle. Une page qui ne contient
que des placeholders injecte exactement zéro caractère.

Budgets, en caractères : `CC_VAULT_BUDGET_PROJET` (3000),
`CC_VAULT_BUDGET_PROFIL` (1500), `CC_VAULT_BUDGET_JOURNAL` (1200).
Autre vault : `CC_VAULT=/chemin`. Couper : `CC_VAULT_DISABLED=1`.

```bash
node scaffold-vault.js   # (re)crée l'ossature, n'écrase jamais une page existante
```

## Économie de tokens

Chaque tour renvoie tout le contexte au modèle. Sans compaction, le coût cumulé
d'une session croît en **carré** du nombre de tours. Le vault change la donne :
compacter ne perd plus d'information, seulement des tokens — donc on peut
compacter tôt et souvent.

Le hook `Stop` mesure le contexte de façon **incrémentale** : seuls les octets
ajoutés depuis le dernier passage sont relus, jamais le transcript entier. Au
franchissement du seuil, il interrompt une fois la fin de réponse pour demander
une note de vault puis une proposition de `/compact`.

Deux seuils, pour deux questions différentes :

| Variable | Défaut | Question à laquelle il répond |
|---|---|---|
| `CC_CONTEXT_SOFT` | `150000` | **combien ça coûte** — chaque tour renvoie ce contexte entier |
| `CC_CONTEXT_WARN` | `0.7` | **suis-je près du mur** — fraction de la fenêtre |
| `CC_CONTEXT_LIMIT` | déduit du modèle | forcer la taille de fenêtre |
| `CC_CONTEXT_MONITOR` | — | `off` pour désactiver |

Le seuil absolu est celui qui compte au quotidien. Sur une fenêtre de 1M, tourner
à 400k tokens est ruineux bien avant d'être dangereux : le pourcentage ne dirait
rien, alors que le coût par tour a doublé. La compaction automatique se charge
déjà du mur.

La taille de fenêtre est **déduite du modèle** (`model` dans `settings.json`, ou
`ANTHROPIC_MODEL`) : `opus[1m]` donne 1M, sinon 200k par défaut. Une fenêtre codée
en dur produisait une alerte à 96 % alors que le contexte était à 19 %.

Le message d'alerte affiche toujours le dénominateur — `~193k sur 1M` — pour
pouvoir être recoupé avec `/context` d'un coup d'œil.

Les captures d'écran sont le poste le plus coûteux et le moins visible : une
capture plein écran vaut environ 1600 tokens et reste en contexte jusqu'à la
compaction, donc se repaie à chaque tour.

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

## Plugin `rebenga`

Commandes, agents et skills de travail, livrés comme plugin local (préfixe
`rebenga:`, donc aucun conflit avec les commandes intégrées). Source :
`plugins/rebenga/`, marketplace locale : `.claude-plugin/marketplace.json`.

```bash
claude plugin marketplace add ~/.claude-config
claude plugin install rebenga@ownconfig
```

| Commande | Rôle |
|---|---|
| `/rebenga:plan "<feature>"` | agent `planner` → mode plan → validation avant tout code |
| `/rebenga:build-fix` | relance le build, délègue à `build-fixer`, preuve verte |
| `/rebenga:refactor-clean` | code mort, dépendances inutiles, lot par lot, tests verts |
| `/rebenga:context-budget` | coût estimé du contexte résident, top 3 des économies |
| `/rebenga:go-review`, `/rebenga:python-review` | revue via l'agent du langage |

Agents appelables directement ou par délégation automatique :
`typescript-reviewer`, `database-reviewer` (SQL, migrations, ORM), `e2e-runner`,
`tdd-guide`. Skills : `tdd-workflow`, `e2e-testing`.

Après modification du plugin : `claude plugin marketplace update ownconfig`.

## Ce qui reste volontairement local

Les règles de langage vivent dans le projet (`.claude/rules/`), pas ici. Une
règle globale est du contexte payé à chaque session, y compris sur les projets
qui ne la concernent pas. Voir `rules/templates/`.
