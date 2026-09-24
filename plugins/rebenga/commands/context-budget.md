---
description: Estime le contexte résident à chaque tour (CLAUDE.md, skills, agents, MCP, plugins) et propose les trois économies les plus rentables.
disable-model-invocation: true
argument-hint: "[vide]"
---

Estime ce que coûte la configuration Claude Code avant même la première question.
Chaque token résident se repaie à chaque tour.

Estimation : **tokens ≈ caractères / 4**, toujours étiquetée « est. ». Le chiffre
exact vient de `/context`, pas d'ici.

## 1. Inventaire

Mesurer avec `wc -c`, jamais en affichant le contenu :

- **CLAUDE.md** : `~/.claude/CLAUDE.md`, `./CLAUDE.md`, `./CLAUDE.local.md`,
  les CLAUDE.md des dossiers parents jusqu'à la racine du dépôt, et
  `.claude/rules/**/*.md`. Chargés en entier.
- **Skills** : seuls `name` + `description` du frontmatter résident. Les
  extraire de chaque `SKILL.md` de `~/.claude/skills/`, `.claude/skills/` et des
  plugins activés. Le corps ne coûte rien tant que la skill n'est pas invoquée.
- **Agents** : idem, `description` seule, dans `~/.claude/agents/`,
  `.claude/agents/` et les plugins.
- **Commandes** : la `description` de chaque commande de plugin ou utilisateur.
- **Plugins activés** :
  `jq -r '.enabledPlugins // {} | to_entries[] | select(.value) | .key' ~/.claude/settings.json`
  puis leur chemin via
  `jq -r '.plugins[]?[]?.installPath' ~/.claude/plugins/installed_plugins.json`.
- **Serveurs MCP** : noms seulement, par
  `jq -r '.mcpServers // {} | keys[]'` sur `.mcp.json`, `~/.claude.json` et
  `~/.claude/settings.json`. Les outils différés (chargés via ToolSearch) coûtent
  ~0 au départ : seul leur nom est listé. Les outils non différés paient leur
  schéma complet.

## Sécurité

Lectures de réglages **par clé** uniquement. Ne jamais afficher `env`, `headers`,
`args`, `command` d'un serveur MCP ni un fichier de réglages entier : ils
contiennent des tokens et des clés. Pas de `cat` sur `~/.claude.json`.

## 2. Rapport

Un tableau trié par coût décroissant :

```
| Composant                  | Nb | Tokens (est.) |
|----------------------------|----|---------------|
| CLAUDE.md global           | 1  | ~1 900        |
| Descriptions de skills     | 34 | ~1 600        |
| Descriptions d'agents      | 12 | ~700          |
| Serveurs MCP (non différés)| 2  | ~?            |
| Total résident             |    | ~4 800        |
```

Signaler au passage : description de plus de ~40 mots, CLAUDE.md de plus de
~200 lignes, skill ou agent dupliquant un autre, serveur MCP qui recouvre une CLI
déjà disponible (`gh`, `git`).

## 3. Trois recommandations

Les trois économies au meilleur ratio gain / effort, chacune avec son gain
estimé et l'action exacte (fichier, plugin ou serveur visé). Ne rien modifier :
proposer, l'utilisateur tranche.

Terminer par : « Pour la mesure exacte en direct, lance `/context`. »
