# Configuration Claude Code

Configuration personnelle versionnée. Source de vérité : ce dépôt.
`~/.claude` ne contient que des liens symboliques vers lui — un fichier édité ici
est actif immédiatement, sans réinstallation.

Une mécanique (dispatcher de hooks, profils, fact-forcing, protection des
garde-fous) et une surface volontairement réduite : 5 agents et 4 skills de base,
plus un plugin `rebenga` (13 commandes, 12 agents, 8 skills). Une surface qui ne se
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
| `hooks/` | dispatcher + contrôles + pont Obsidian + moniteur de contexte + rappel des fichiers compagnons + compression des sorties Bash (`hooks/lib/compress/`) |
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
| `minimal` | refus durs seulement (`--no-verify`, `push --force`, `curl \| sh`, secret écrit en clair) ; aucune compression des sorties |
| `standard` | *(défaut)* + protection des garde-fous, garde des migrations, avertissements d'hygiène Bash, fact-forcing sur commandes destructives, gate qualité et rappel des compagnons sur `Stop`, compression des sorties Bash |
| `strict` | + fact-forcing sur la première écriture de **chaque** fichier |

```bash
CC_PROFILE=strict claude      # session sensible : migration, paiement, onchain
CCX_DISABLED=1 claude         # tout couper
```

Échappatoires ciblées : `CCX_ALLOW_CONFIG=1` (autoriser une édition de config),
`CCX_ALLOW_MIGRATION=1` (passer outre la garde des migrations),
`CCX_NO_TYPECHECK=1`, `CCX_DEBUG=1` (voir les erreurs internes des hooks),
`CCX_RAW=1 <commande>` (sortie brute d'une commande), `CCX_COMPRESS=off` (couper la
compression des sorties).

## Hooks

Un seul process Node par événement, qui exécute ses modules en interne — plutôt
qu'un process par contrôle enregistré.

| Événement | Contrôle |
|---|---|
| `PreToolUse` Edit/Write | refuse un secret écrit en clair (`secret-guard`) ; refuse une migration goose avec `;` en commentaire ou sans `Down`, avertit sur `DROP` sans `IF EXISTS` et AND/OR non parenthésés (`migration-guard`) ; refuse d'éditer une config de lint/format/types ; fact-forcing (strict) |
| `PreToolUse` Bash | refuse un secret écrit dans un fichier ; refus durs ; fact-forcing sur commande destructive ; avertissements d'hygiène : glob zsh sans correspondance, guillemets imbriqués dans `ssh`, statut lu après un pipe sans `pipefail`, `sleep` long (`bash-hygiene`) ; en dernier, réécrit une commande de lecture ou de build éligible pour compresser sa sortie (`compress`, voir plus bas) |
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
fois par cible et par session. Une réécriture de commande (`updatedInput`) passe
par ce même JSON, jamais accompagnée d'une décision de permission.

### Le fact-forcing

Demander « tu es sûr ? » à un modèle ne produit rien : il répond oui. Le hook ne
demande donc pas confirmation, il **refuse** et exige des faits — qui importe ce
fichier, quelle API publique bouge, quel est le plan de rollback, quelle était
l'instruction exacte. L'investigation forcée produit une prudence que
l'auto-évaluation ne produit pas. La seconde tentative passe.

Le contenu des chaînes citées est neutralisé avant l'analyse (un message de
commit qui contient « drop table » ne déclenche rien). Cette lecture suit les
règles réelles du shell : entre apostrophes, rien n'est échappé — `'a\'` se ferme
au second `'` — donc `ls 'a\' ; rm -rf x ; echo '` laisse bien voir le `rm -rf`.
Une quote jamais refermée est analysée telle quelle, par prudence.

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

## Compression des sorties

La sortie d'une commande Bash entre dans le contexte et s'y repaie à chaque tour.
Un `go test -v`, un `next build` ou un `git log` en déversent des milliers de
caractères dont le modèle n'a besoin que d'une fraction : les échecs, les
erreurs, le résumé.

**Principe.** `PostToolUse` ne peut pas modifier une sortie : la compression se
fait donc en amont. Au `PreToolUse` Bash, une commande éligible est réécrite
(`updatedInput`) en `node '<…>/wrap.js' <commande en base64> # '<commande>'`. Le
wrapper exécute la commande **inchangée** dans ton shell, garde stdout et stderr
séparés, rend le code de sortie de la commande (signal : 128 + n), et imprime une
version condensée de chaque flux. La commande d'origine reste lisible en
commentaire, pour qui relit l'appel.

**Modèle de sécurité.**

- **Liste blanche stricte** de commandes de lecture et de build (voir le tableau).
  Tout le reste passe sans être touché — y compris les commandes destructives ou
  à effet de bord, qui ne sont de toute façon jamais sur la liste.
- **Aucune décision de permission.** Le hook n'émet jamais `permissionDecision` :
  la commande réécrite repasse par le flux de permission normal et par le
  classifieur du mode auto, exactement comme l'originale.
- **Passe en dernier.** Le module `compress` est le dernier de la chaîne
  `pre-bash` : un refus (secret, `push --force`, fact-forcing) termine le hook en
  sortie 2 avant lui ; une commande refusée n'est jamais réécrite.
- **Une seule commande simple.** Refusés : `&&`, `||`, `;`, pipe, retour à la
  ligne, `$(…)`, backticks, `<<`, `<(…)`, toute redirection, `&` final,
  variable en tête (`X=1 cmd`), `$` et `\` hors guillemets simples, `sudo`,
  un binaire hors des dossiers système standard (`/tmp/x/git` n'est pas `git`),
  les options de sortie structurée (`--json`, `-o json`, `--format`,
  `--porcelain`…), de suivi ou de surveillance (`-f`/`--follow` des logs,
  `--watch`, `vitest` sans `run`), d'écriture (`--fix`, `-u`, `--output`,
  `find -exec`/`-delete`) et les commandes lancées en arrière-plan. Le wrapper
  revérifie l'éligibilité avant d'exécuter.
- **Rien ne se perd.** Sortie de moins de 2000 caractères ou gain inférieur à
  20 % : sortie brute inchangée. Erreur interne : sortie brute, même code.
  Sortie de plus de 8 Mo : transmise telle quelle. Sortie binaire : octet pour
  octet.
- **Récupération des lignes critiques.** Toute ligne d'erreur de l'entrée
  (`error`, `FAIL`, `panic`, `fatal`, `Traceback`, `ENOENT`, `fichier:12:5:`…)
  absente du résultat y est remise (30 max), sous `[ccx: N ligne(s) d'erreur
  récupérée(s)]`. Toujours après un échec ; après un succès aussi, sauf pour les
  listings, recherches et sorties `git` (un fichier `not-found.tsx` ou un commit
  « fix error handling » ne sont pas des erreurs). Un
  échec sur une commande dont le processeur ne gère pas les échecs passe par le
  processeur générique.

- **Aucun caractère de contrôle, même entre apostrophes.** La commande réécrite
  garde l'originale en commentaire (`# 'git log'`) pour que la validation et le
  classifieur voient ce qui s'exécute. Un commentaire shell s'arrête au premier
  retour à la ligne physique : un `\n` caché dans un argument cité ferait sortir
  la suite du commentaire en commande libre. Tout caractère de contrôle (`\n`,
  `\r`, NUL…) et les séparateurs de ligne Unicode (NEL, LS, PS) rendent donc la
  commande inéligible, et la réécriture refuse de toute façon une entrée
  multi-ligne (double barrière, test de non-régression).

Une sortie compressée se termine par une ligne :
`[ccx: sortie compressée 12630→1159 car. (git) — CCX_RAW=1 git log pour la sortie brute]`.

Gains mesurés sur ce dépôt : `git log` 12 630 → 1 159 caractères (−91 %),
`rg -n function hooks` −56 %, `find . -type f` −45 %. Les diffs gardent toutes
leurs lignes par choix : sous 20 % de gain, la sortie brute est rendue.

**Contournements.** `CCX_RAW=1 <commande>` : sortie brute pour cette commande.
`CCX_COMPRESS=off` : compression coupée. Profil `minimal` ou `CCX_DISABLED=1` :
coupée aussi.

| Processeur | Commandes | Ce qui est fait |
|---|---|---|
| `git` | `git status`, `diff`, `show`, `log` | status groupé par dossier, sans les conseils `git` ; diff : toutes les lignes `+`/`-`, `@@` et de contexte gardées, lignes `index` retirées, fichiers de verrouillage (`package-lock.json`, `bun.lock`, `go.sum`, `Cargo.lock`, `pnpm-lock.yaml`…) résumés en une ligne ; log : `hash7 sujet` par commit, tous les commits, seulement sans `-n`/format/patch explicite |
| `gotest` | `go test` | tests et paquets réussis comptés ; chaque bloc `--- FAIL`, panic, erreur de build et ligne `FAIL` gardés |
| `jstest` | `bun test`, `vitest run`, `jest`, `cargo test` | lignes de réussite comptées ; échecs, diffs attendu/reçu, piles et résumé final gardés |
| `build` | `next build`, `tsc`, `npm/bun/pnpm/yarn build`, `go build`, `cargo build/check` | progression retirée ; table des routes gardée ; 5 premiers avertissements, les autres comptés ; tous les blocs d'erreur gardés |
| `lint` | `eslint`, `golangci-lint run`, `go vet`, `cargo clippy` | regroupé par règle : nombre + 3 premières occurrences + totaux ; erreurs de compilation (`typecheck`, rustc) en entier |
| `docker` | `docker ps/images/build/pull`, `docker compose ps/logs/build/pull` | tables sans ID/COMMAND/CREATED ; build : étapes, erreurs et bloc d'échec gardés, journaux de couche retirés ; logs : 20 premières lignes + blocs d'erreur + 40 dernières |
| `listing` | `ls`, `find`, `tree` | au-delà de 60 entrées : groupé par dossier (ou extension) avec comptes ; `tree` limité à deux niveaux |
| `search` | `rg`, `grep` | au-delà de 80 lignes : groupé par fichier, 5 premières par fichier, total ; lignes très longues coupées |
| `gh` | `gh pr checks/list`, `gh issue list`, `gh run list/view` | checks réussis comptés, échecs et en attente gardés ; listes coupées à 40 lignes avec compte |
| `generic` | tout échec non géré | barres de progression retirées, lignes identiques repliées `(xN)`, au-delà de 200 lignes : 80 premières + 60 dernières + lignes critiques du milieu |

**Jamais compressé** : ce qui n'est pas sur la liste, toute commande composée,
une sortie structurée (`--json`…), un flux suivi (`-f`, `--watch`), une commande
en arrière-plan, une sortie courte ou peu compressible.

**Statistiques.** Chaque commande enveloppée ajoute une ligne à
`~/.claude/state/ccx/compress-stats.jsonl` : horodatage, deux premiers mots de la
commande (`git log`, `go test` — jamais d'argument), processeur, tailles avant et
après, code de sortie. Aucun contenu de sortie. Le fichier est élagué de moitié
au-delà de 1 Mo. `/rebenga:token-stats [jours]` en fait le bilan.

Tests : `node test.js` lance aussi `test-compress.js` — liste blanche, intégration
au dispatcher, wrapper (codes de sortie, stderr, erreurs internes) et seuils de
qualité par processeur sur des sorties réalistes (`tests/compress/`) : chaque
cas déclare les chaînes qui doivent survivre et le gain minimal attendu, y compris
des échecs dont l'erreur est enfouie au milieu d'une longue sortie.

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
| `/rebenga:token-stats [jours]` | bilan de la compression des sorties : commandes compressées, tokens économisés (est.), processeurs les plus rentables |
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
