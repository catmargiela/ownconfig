---
description: Estimates the context resident on every turn (CLAUDE.md, skills, agents, MCP, plugins) and proposes the three most cost-effective savings.
disable-model-invocation: true
argument-hint: "[empty]"
---

Reply to the user in French.

Estimate what the Claude Code configuration costs before the very first
question. Every resident token is paid again on every turn.

Estimate: **tokens ≈ characters / 4**, always labelled « est. ». The exact
figure comes from `/context`, not from here.

## 1. Inventory

Measure with `wc -c`, never by printing the content:

- **CLAUDE.md**: `~/.claude/CLAUDE.md`, `./CLAUDE.md`, `./CLAUDE.local.md`,
  the CLAUDE.md files of parent folders up to the repository root, and
  `.claude/rules/**/*.md`. Loaded in full.
- **Skills**: only the frontmatter `name` + `description` are resident. Extract
  them from each `SKILL.md` in `~/.claude/skills/`, `.claude/skills/` and the
  enabled plugins. The body costs nothing until the skill is invoked.
- **Agents**: same, `description` only, in `~/.claude/agents/`,
  `.claude/agents/` and the plugins.
- **Commands**: the `description` of each plugin or user command.
- **Enabled plugins**:
  `jq -r '.enabledPlugins // {} | to_entries[] | select(.value) | .key' ~/.claude/settings.json`
  then their path via
  `jq -r '.plugins[]?[]?.installPath' ~/.claude/plugins/installed_plugins.json`.
- **MCP servers**: names only, via
  `jq -r '.mcpServers // {} | keys[]'` on `.mcp.json`, `~/.claude.json` and
  `~/.claude/settings.json`. Deferred tools (loaded via ToolSearch) cost
  ~0 up front: only their name is listed. Non-deferred tools pay for their
  full schema.

## Security

Read settings **by key** only. Never print the `env`, `headers`, `args` or
`command` of an MCP server, nor an entire settings file: they contain tokens
and keys. No `cat` on `~/.claude.json`.

## 2. Report

A table sorted by decreasing cost:

```
| Composant                  | Nb | Tokens (est.) |
|----------------------------|----|---------------|
| CLAUDE.md global           | 1  | ~1 900        |
| Descriptions de skills     | 34 | ~1 600        |
| Descriptions d'agents      | 12 | ~700          |
| Serveurs MCP (non différés)| 2  | ~?            |
| Total résident             |    | ~4 800        |
```

Flag along the way: a description over ~40 words, a CLAUDE.md over
~200 lines, a skill or agent duplicating another, an MCP server that overlaps a
CLI already available (`gh`, `git`).

## 3. Three recommendations

The three savings with the best gain / effort ratio, each with its estimated
gain and the exact action (targeted file, plugin or server). Change nothing:
propose, the user decides.

End with: « Pour la mesure exacte en direct, lance `/context`. »
