# Configuration Claude Code

Configuration personnelle versionnée. Source de vérité : ce dépôt.
`~/.claude` ne contient que des liens symboliques vers lui — un fichier édité ici
est actif immédiatement, sans réinstallation.

Une mécanique (dispatcher de hooks, profils, fact-forcing, protection des
garde-fous) et une surface volontairement réduite : 5 agents et 4 skills de base,
plus un plugin `rebenga` (12 commandes, 12 agents, 8 skills). Une surface qui ne se
déclenche jamais est un coût sans contrepartie.

## Installation

```bash
node install.js              # pose les liens et enregistre les hooks
node install.js --dry-run    # montre ce qui serait fait
node install.js --uninstall  # retire tout, laisse les hooks tiers en place
```

L'installeur est idempotent : il retire d'abord ses propres entrées de
`settings.json` (reconnues au chemin `hooks/ccx/dispatch.js`) avant de les
reposer. Les hooks tiers — vibe-island, pixel-agents — sont relus, comptés et
conservés. `settings.json` est sauvegardé à chaque passage dans
`~/.claude/backups/settings.json.ccx-<horodatage>` ; seules les 3 sauvegardes les
plus récentes sont gardées, les autres fichiers du dossier ne sont jamais touchés.

Il lie aussi les deux scripts de `bin/` à l'endroit où Claude Code les attend :
`~/.claude/statusline.sh` et `~/.claude/bin/gh-mcp-headers.sh` (rendus
exécutables). Si un vrai fichier différent s'y trouve déjà, il est d'abord copié
dans `~/.claude/backups/` ; identique, il est remplacé sans bruit. `--uninstall`
retire ces liens comme les autres.

## Contenu

| | |
|---|---|
| `CLAUDE.md` | règles chargées à chaque session — 63 lignes, chacune doit se justifier |
| `agents/` | 5 sous-agents : relecture, sécurité, build, front, tests |
| `skills/` | 4 workflows déclenchés par leur description : `git-ship`, `verification-loop`, `vault-note`, `project-onboarding` |
| `hooks/` | dispatcher + contrôles + pont Obsidian + moniteur de contexte + rappel des fichiers compagnons |
| `bin/statusline.sh` | barre de statut : dossier, branche git, modèle, jauge de contexte, usage `5h N% · 7j N%`, coût |
| `bin/gh-mcp-headers.sh` | `headersHelper` du serveur MCP GitHub : lit le jeton de `gh` à chaque connexion, jamais écrit sur disque ; tolère un environnement vide (`HOME` déduit du compte, `gh`/`jq` trouvés par `PATH` puis Homebrew) |
| `plugins/rebenga/` | plugin local : commandes `rebenga:*`, agents spécialisés, skills TDD et e2e (voir plus bas) |
| `.claude-plugin/` | marketplace locale `ownconfig` qui publie le plugin |
| `rules/templates/` | modèles de règles **par projet** (jamais installés en global) |

Pas de dossier `commands/` à la racine : une skill se déclenche seule, une
commande exige d'être tapée. Les commandes qui méritent d'exister vivent dans le
plugin, préfixées `rebenga:` pour ne jamais entrer en conflit avec les commandes
intégrées.

## Profils

La rigueur se règle par une variable d'environnement, sans toucher à la config :

| `CC_PROFILE` | Comportement |
|---|---|
| `minimal` | refus durs seulement (`--no-verify`, `push --force`, `curl \| sh`, secret écrit en clair) |
| `standard` | *(défaut)* + protection des garde-fous, garde des migrations, avertissements d'hygiène Bash, fact-forcing sur commandes destructives, gate qualité et rappel des compagnons sur `Stop` |
| `strict` | + fact-forcing sur la première écriture de **chaque** fichier |

```bash
CC_PROFILE=strict claude      # session sensible : migration, paiement, onchain
CCX_DISABLED=1 claude         # tout couper
```

Échappatoires ciblées : `CCX_ALLOW_CONFIG=1` (autoriser une édition de config),
`CCX_ALLOW_MIGRATION=1` (passer outre la garde des migrations),
`CCX_NO_TYPECHECK=1`, `CCX_DEBUG=1` (voir les erreurs internes des hooks).

## Hooks

Un seul process Node par événement, qui exécute ses modules en interne — plutôt
qu'un process par contrôle enregistré.

| Événement | Contrôle |
|---|---|
| `PreToolUse` Edit/Write | refuse un secret écrit en clair (`secret-guard`) ; refuse une migration goose avec `;` en commentaire ou sans `Down`, avertit sur `DROP` sans `IF EXISTS` et AND/OR non parenthésés (`migration-guard`) ; refuse d'éditer une config de lint/format/types ; fact-forcing (strict) |
| `PreToolUse` Bash | refuse un secret écrit dans un fichier ; refus durs ; fact-forcing sur commande destructive ; avertissements d'hygiène : glob zsh sans correspondance, guillemets imbriqués dans `ssh`, statut lu après un pipe sans `pipefail`, `sleep` long (`bash-hygiene`) |
| `PostToolUse` Edit/Write | empile les fichiers touchés : lot de la réponse + liste de la session (aucun travail lourd ici) |
| `PreCompact` | écrit l'état de la session dans le vault Obsidian |
| `Stop` | capture vault, puis format + typecheck + `console.log` en un lot, puis rappel des fichiers compagnons (`companion-check`), puis mesure du contexte |
| `SessionStart` | réinjecte le profil et le contexte projet depuis le vault |

Deux invariants :

1. **Un hook ne casse jamais un appel d'outil.** Toute erreur inattendue se
   termine en sortie 0. Seul un refus délibéré sort en 2.
2. **Aucun gate ne boucle.** Le fact-forcing ne se déclenche qu'une fois par
   cible et par session ; le gate de typecheck est plafonné à 3 relances et
   ignore une signature d'erreur déjà vue ; le rappel des compagnons ne
   revient jamais deux fois pour la même règle dans une session.

Les avertissements non bloquants sont regroupés par le dispatcher et émis en un
seul JSON (`systemMessage` pour toi, `additionalContext` pour le modèle), une
fois par cible et par session.

### Le fact-forcing

Demander « tu es sûr ? » à un modèle ne produit rien : il répond oui. Le hook ne
demande donc pas confirmation, il **refuse** et exige des faits — qui importe ce
fichier, quelle API publique bouge, quel est le plan de rollback, quelle était
l'instruction exacte. L'investigation forcée produit une prudence que
l'auto-évaluation ne produit pas. La seconde tentative passe.

### Fichiers compagnons

Certains changements vont par paires : un module et sa démo, un schéma et sa
migration. Un projet le déclare, s'il le veut, dans
`<racine du dépôt>/.claude/companions.json` :

```json
[
  { "when": "modules/", "require": "demos.ts",
    "message": "Des fichiers de modules/ ont changé mais aucun fichier démo (demos.ts) : ajoute la démo dans le même commit." }
]
```

Si un fichier touché pendant la session correspond à `when` et qu'aucun ne
correspond à `require`, le `Stop` est interrompu une fois par règle et par
session avec `message` (ou un texte par défaut). Motifs relatifs à la racine du
dépôt : préfixe de dossier (`modules/`), chemin exact, ou glob (`*`, `**`, `?`) ;
un motif sans `/` vise aussi le nom de fichier seul (`demos.ts` couvre
`src/demos.ts`). Pas de fichier, JSON invalide ou règle incomplète : silence.
Actif en `standard` et `strict`. Seules les écritures faites par Edit/Write
comptent, pas les fichiers créés par une commande Bash.

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

**Un projet = un dépôt git.** Le nom du projet (page et journal) vient de la
racine du dépôt trouvée en remontant depuis le dossier de travail : un
sous-dossier écrit dans le même journal que la racine, et un worktree — y compris
`.claude/worktrees/*` — dans celui du dépôt principal. Une page dont le `chemin:`
vise exactement le dossier de travail reste prioritaire ; hors dépôt git, le nom
vient du dossier de travail comme avant. Un dépôt situé à la racine du dossier
personnel (dotfiles) est ignoré.

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

- **Dans le plugin** : `plugins/rebenga/{commands,agents,skills}/`. Une commande
  est un `.md` avec `description` + `argument-hint` ; elle délègue aux agents par
  leur nom préfixé (`rebenga:<agent>`). Valider avec
  `claude plugin validate plugins/rebenga --strict`.

Après ajout d'un agent ou d'une skill de base, relancer `node install.js` pour
poser le lien. Après modification du plugin :
`claude plugin marketplace update ownconfig`. Modifier un fichier existant ne
demande rien.

**Règle : chaque nouvelle fonctionnalité met à jour ce README dans le même
commit** — tableau `Contenu`, section concernée, et les compteurs de
l'introduction.

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
| `/rebenga:migration-check [fichier]` | contrôles statiques, essai `BEGIN…ROLLBACK` (dev par défaut), `sqlc` + `go build`/`go vet` |
| `/rebenga:deploy-verify [env]` | déploie après accord, puis prouve : services, migrations, santé, proxy, bundle servi, `.env` bien formé |
| `/rebenga:env-set <CLE>` | pose ou fait tourner un secret dans un `.env` sans que la valeur apparaisse nulle part |
| `/rebenga:dual-review [PR ou chemins]` | grille PASS/FAIL objective, deux relecteurs indépendants en parallèle, 3 tours max, désaccords rapportés |
| `/rebenga:canary-watch <url> [--baseline\|--compare\|--watch]` | photo de référence du site puis comparaison après déploiement : assets, `content-type`, latence, erreurs console, éléments clés (GET seulement) |
| `/rebenga:hookify [comportement]` | transforme une correction répétée en nouveau garde-fou du dispatcher (module, tests, README), sur une branche |

Agents appelables directement ou par délégation automatique :
`typescript-reviewer`, `database-reviewer` (SQL, migrations, ORM),
`rust-tauri-reviewer` (Rust, Tauri v2), `e2e-runner`, `tdd-guide`,
`silent-failure-hunter` (erreurs avalées : `_ = err`, `ErrNoRows` masqué,
`catch {}`, fallbacks muets), `pr-test-analyzer` (les tests couvrent-ils
vraiment le comportement modifié), `conversation-analyzer` (corrections
répétées dans les sessions passées, pour `hookify`).

| Skill | Rôle |
|---|---|
| `tdd-workflow` | boucle rouge → vert → refactor, preuve à chaque étape |
| `e2e-testing` | patterns Playwright, anti-instabilité |
| `prod-e2e` | suite Playwright versionnée contre la prod, comptes `e2e-*` jetables |
| `issue-batch` | lot d'issues GitHub : implémentation, revue, fermeture, passage à Done dans Projects |
| `mirror-sync` | un module dupliqué entre deux dépôts : divergences, patch appliqué des deux côtés |
| `tauri-release` | release Tauri v2 via tauri-action : versions, signature, `latest.json`, runners |
| `contract-first` | un contrat d'API, un fournisseur (Go/sqlc), plusieurs clients (Next, Tauri) : changements cassants repérés, tous les côtés mis à jour ensemble |
| `iterative-retrieval` | délégation par tours : l'agent dit ce qui lui manque au lieu de tout recevoir d'avance (2-3 tours max) |

Tout ce qui est propre à un projet (services attendus, URL de santé, paire de
dépôts miroirs) est lu dans le projet lui-même — son `CLAUDE.md` ou ses scripts —
jamais écrit dans ce dépôt public.

Après modification du plugin : `claude plugin marketplace update ownconfig`.

## Ce qui reste volontairement local

Les règles de langage vivent dans le projet (`.claude/rules/`), pas ici. Une
règle globale est du contexte payé à chaque session, y compris sur les projets
qui ne la concernent pas. Voir `rules/templates/`.

Réglages de la machine, hors dépôt (non versionnés) — la barre de statut et le
helper d'en-têtes GitHub sont désormais versionnés dans `bin/` :

| Fichier | Rôle |
|---|---|
| `~/.claude/settings.json` | skills inutilisées coupées (`skillOverrides`), `defaultMode: auto`, plugins actifs |
