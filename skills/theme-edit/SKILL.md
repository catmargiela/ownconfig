---
name: theme-edit
description: Créer ou modifier un thème Claude Code (couleurs de l'interface, clair ou sombre) ou les couleurs de la barre de statut. À utiliser quand l'utilisateur dit « change la couleur de… », « fais-moi un thème », « modifie le thème », « la couleur X est illisible », ou parle de palette, de contraste ou de couleurs de la statusline.
---

# Éditer un thème ou les couleurs

Trois choses différentes portent le nom de « couleur » ; identifier laquelle avant
de toucher à quoi que ce soit.

| Demande | Où | Qui peut le changer |
|---|---|---|
| Couleurs de l'interface (texte, accent, diffs, bordures…) | `themes/<slug>.json` du dépôt de config | toi |
| Couleurs de la barre de statut | `bin/statusline.sh` du dépôt de config | toi |
| Couleur de la session (`/color`) | commande de l'utilisateur | **l'utilisateur seulement** : lui dire de taper `/color` |

Les thèmes et la barre de statut vivent dans `~/.claude-config` et sont liés
dans `~/.claude` par `install.js`. Toujours éditer la copie du dépôt, jamais le
lien dans `~/.claude`.

## Format d'un thème

```json
{
  "name": "Nom affiché dans /theme",
  "base": "dark",
  "overrides": { "claude": "#97CE4C", "text": "#E6F4F1" }
}
```

- `base` : `dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`,
  `light-ansi`. Tout ce qui n'est pas dans `overrides` vient de la base.
- Couleurs : `#RRGGBB`, `#RGB`, `rgb(r,g,b)`, `ansi256(n)`, `ansi:<nom>`
  (`ansi:cyanBright`…).
- Le nom de fichier (`<slug>.json`) est l'identifiant : `"theme": "custom:<slug>"`.

Clés les plus utiles (la liste complète est dans `KNOWN_KEYS` de
`bin/theme-check.js`) :

| Clé | Rôle |
|---|---|
| `claude`, `claudeShimmer` | accent de marque, spinner |
| `text`, `subtle`, `inactive` | texte, texte secondaire, éléments inactifs |
| `suggestion`, `permission`, `planMode`, `autoAccept` | suggestions, demandes de permission, mode plan, auto-accept |
| `bashBorder`, `promptBorder` | bordure des commandes Bash, du champ de saisie |
| `success`, `error`, `warning` | états |
| `diffAdded`, `diffRemoved` (+ `Dimmed`, `Word`) | fonds de diff : ce sont des **fonds**, choisir des teintes proches du fond du terminal, pas des couleurs vives |
| `userMessageBackground`, `bashMessageBackgroundColor`, `selectionBg` | fonds des messages, des sorties Bash, de la sélection |

## Procédure

1. Lire le thème existant en entier (`themes/<slug>.json`), ou partir d'un
   thème voisin pour un nouveau.
2. Modifier **uniquement** les clés demandées dans `overrides`. Ne jamais
   inventer une clé : si elle n'est pas dans `KNOWN_KEYS`, elle ne fait rien.
3. Vérifier :
   ```bash
   node ~/.claude-config/bin/theme-check.js ~/.claude-config/themes/<slug>.json
   ```
   Il signale les clés inconnues, les couleurs mal formées et un contraste
   texte / fond de message inférieur à 4.5. Corriger toute erreur ; un
   avertissement de contraste se corrige aussi, sauf demande contraire explicite.
4. Nouveau thème : `node ~/.claude-config/install.js` pour poser le lien dans
   `~/.claude/themes/`. Thème existant : rien à faire, le lien pointe déjà sur
   le fichier du dépôt.
5. Activer : dire à l'utilisateur de taper `/theme` et de choisir le thème. Ne
   modifier `theme` dans `~/.claude/settings.json` que s'il le demande, avec une
   sauvegarde dans `~/.claude/backups/` et un `jq empty` avant d'écrire.
6. Nouveau thème : l'ajouter au tableau `Contenu` du README, dans le même commit.

## Barre de statut

La palette est en tête de `bin/statusline.sh` (variables `BLUE`, `MAG`, `CYAN`,
`GREEN`, `YEL`, `RED`, `GREY`, codes ANSI 256 `\033[38;5;<n>m`). Changer une
couleur = changer son code, puis vérifier le rendu :

```bash
echo '{"workspace":{"current_dir":"/tmp"},"model":{"display_name":"Opus"},"context_window":{"used_percentage":42},"rate_limits":{"five_hour":{"used_percentage":57},"seven_day":{"used_percentage":83}}}' \
  | bash ~/.claude-config/bin/statusline.sh
```

## Interdits

- Écrire un thème ailleurs que dans `~/.claude-config/themes/`.
- Annoncer « c'est joli » : ce qui se vérifie ici, c'est la validité et le
  contraste ; le rendu réel, seul l'utilisateur le voit. Le dire.
- Toucher aux autres clés de `settings.json` en changeant de thème.
