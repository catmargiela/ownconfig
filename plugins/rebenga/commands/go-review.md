---
description: Revue Go du diff courant ou des chemins donnés, déléguée à l'agent go-reviewer.
argument-hint: [chemins ou vide pour le diff courant]
---

Revue Go demandée. Arguments : `$ARGUMENTS`

## Procédure

1. Périmètre :
   - si des arguments sont fournis, ce sont les fichiers ou dossiers à relire ;
   - sinon, `git diff HEAD --name-only -- '*.go'`, puis `HEAD~1` si c'est vide.
   Aucun fichier Go : le dire à l'utilisateur et s'arrêter.
2. Déléguer la revue avec l'outil Agent, `subagent_type: "rebenga:go-reviewer"`.
   Lui passer la liste des fichiers et, s'il existe, l'objectif du changement
   en une phrase. Ne pas relire toi-même les fichiers : l'agent s'en charge.
3. Relayer son rapport tel quel ou presque : sortie de l'outillage, findings
   avec sévérité et fichier:ligne, verdict. Ne pas adoucir ni retirer un
   finding, ne pas en ajouter.
4. S'il y a des findings CRITIQUE ou ÉLEVÉ, proposer de les corriger, sans
   commencer avant l'accord de l'utilisateur.

## Interdits

- Annoncer que le code est sain si l'agent a signalé un outil en échec ou
  non lancé : le dire explicitement.
- Corriger en ajoutant `//nolint`, `_ =` ou en sautant un test.
