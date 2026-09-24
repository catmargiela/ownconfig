---
name: theme-edit
description: Create or modify a Claude Code theme (interface colors, light or dark) or the status line colors. Use when the user says « change la couleur de… » / "change the color of…", « fais-moi un thème » / "make me a theme", « modifie le thème » / "edit the theme", « la couleur X est illisible » / "color X is unreadable", or talks about palette, contrast or status line colors.
---

# Editing a theme or colors

Reply to the user in French.

Three different things go by the name "color"; identify which one before
touching anything.

| Request | Where | Who can change it |
|---|---|---|
| Interface colors (text, accent, diffs, borders…) | `themes/<slug>.json` in the config repo | you |
| Status line colors | `bin/statusline.sh` in the config repo | you |
| Session color (`/color`) | user command | **the user only**: tell them to type `/color` |

Themes and the status line live in `~/.claude-config` and are linked
into `~/.claude` by `install.js`. Always edit the repo copy, never the
link in `~/.claude`.

## Theme format

```json
{
  "name": "Nom affiché dans /theme",
  "base": "dark",
  "overrides": { "claude": "#97CE4C", "text": "#E6F4F1" }
}
```

- `base`: `dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`,
  `light-ansi`. Anything not in `overrides` comes from the base.
- Colors: `#RRGGBB`, `#RGB`, `rgb(r,g,b)`, `ansi256(n)`, `ansi:<name>`
  (`ansi:cyanBright`…).
- The file name (`<slug>.json`) is the identifier: `"theme": "custom:<slug>"`.

Most useful keys (the full list is in `KNOWN_KEYS` of
`bin/theme-check.js`):

| Key | Role |
|---|---|
| `claude`, `claudeShimmer` | brand accent, spinner |
| `text`, `subtle`, `inactive` | text, secondary text, inactive elements |
| `suggestion`, `permission`, `planMode`, `autoAccept` | suggestions, permission requests, plan mode, auto-accept |
| `bashBorder`, `promptBorder` | border of Bash commands, of the input field |
| `success`, `error`, `warning` | states |
| `diffAdded`, `diffRemoved` (+ `Dimmed`, `Word`) | diff backgrounds: these are **backgrounds**, pick shades close to the terminal background, not bright colors |
| `userMessageBackground`, `bashMessageBackgroundColor`, `selectionBg` | backgrounds of messages, Bash output, selection |

## Procedure

1. Read the existing theme in full (`themes/<slug>.json`), or start from a
   neighboring theme for a new one.
2. Modify **only** the requested keys in `overrides`. Never
   invent a key: if it is not in `KNOWN_KEYS`, it does nothing.
3. Check:
   ```bash
   node ~/.claude-config/bin/theme-check.js ~/.claude-config/themes/<slug>.json
   ```
   It reports unknown keys, malformed colors and a text / message background
   contrast below 4.5. Fix every error; a contrast warning gets fixed too,
   unless explicitly asked otherwise.
4. New theme: `node ~/.claude-config/install.js` to create the link in
   `~/.claude/themes/`. Existing theme: nothing to do, the link already points to
   the repo file.
5. Activate: tell the user to type `/theme` and pick the theme. Only
   modify `theme` in `~/.claude/settings.json` if they ask, with a
   backup in `~/.claude/backups/` and a `jq empty` before writing.
6. New theme: add it to the `Contenu` table of the README, in the same commit.

## Status line

The palette is at the top of `bin/statusline.sh` (variables `BLUE`, `MAG`, `CYAN`,
`GREEN`, `YEL`, `RED`, `GREY`, ANSI 256 codes `\033[38;5;<n>m`). Changing a
color = changing its code, then checking the rendering:

```bash
echo '{"workspace":{"current_dir":"/tmp"},"model":{"display_name":"Opus"},"context_window":{"used_percentage":42},"rate_limits":{"five_hour":{"used_percentage":57},"seven_day":{"used_percentage":83}}}' \
  | bash ~/.claude-config/bin/statusline.sh
```

## Forbidden

- Writing a theme anywhere other than `~/.claude-config/themes/`.
- Announcing « c'est joli »: what can be checked here is validity and
  contrast; the actual rendering, only the user sees it. Say so.
- Touching other `settings.json` keys when changing theme.
