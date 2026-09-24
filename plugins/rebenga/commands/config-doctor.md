---
description: Vérifie que ~/.claude correspond toujours au dépôt de config — liens, hooks enregistrés, settings.json, thème, version du plugin, état git, dispatcher, moteur Python.
disable-model-invocation: true
---

Diagnostic de la configuration Claude Code. Lecture seule : ne rien réparer
sans que l'utilisateur le demande.

## 1. Diagnostiquer

Lancer exactement :

```bash
node ~/.claude/bin/config-doctor.js
```

Si le fichier est absent, le lien lui-même manque : le dire et proposer
`node ~/.claude-config/install.js`, puis s'arrêter.

## 2. Rendre le résultat

Recopier les lignes telles quelles dans un bloc de code, puis, pour chaque
`FAIL` et chaque `WARN`, une ligne : la cause et la commande qui corrige.

| Contrôle | Correction |
|---|---|
| Liens, Hooks enregistrés | `node ~/.claude-config/install.js` (idempotent, sauvegarde settings.json) |
| settings.json illisible | restaurer la dernière copie de `~/.claude/backups/settings.json.ccx-*` |
| Thème | `/theme`, ou recréer le fichier avec la skill `theme-edit` |
| Plugin rebenga | `claude plugin marketplace update ownconfig && claude plugin update rebenga@ownconfig` |
| Dépôt | `git -C ~/.claude-config status`, puis pull ou commit selon le cas |
| Dispatcher | `CCX_DEBUG=1` puis relancer la commande pour voir le module en cause |
| Moteur token-saver | installer Python ≥ 3.10 (Homebrew) ou définir `CCX_PYTHON` ; sans lui, la compression reste en Node |

Ne lancer aucune correction sans accord. Tout est `OK` : le dire en une ligne.
