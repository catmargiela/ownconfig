#!/usr/bin/env node
'use strict';
/**
 * Crée l'ossature du vault. Idempotent : ne réécrit JAMAIS une page existante.
 * Les pages semées ici sont des points de départ à éditer à la main — c'est
 * leur contenu rédigé par l'utilisateur qui fait la valeur du contexte injecté.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, DIRS, ensureDirs, VAULT, DASHBOARD, DASHBOARD_TEMPLATE, linkFromIndex } = require('./hooks/lib/vault');

if (!fs.existsSync(VAULT)) {
  console.error(`Vault introuvable : ${VAULT}\nDéfinir CC_VAULT vers le bon dossier.`);
  process.exit(1);
}
ensureDirs();

const PAGES = {
  [path.join(ROOT, 'Index Claude.md')]: `---
type: index
tags: [claude]
---

# Index Claude

Point d'entrée de la mémoire longue de Claude Code. Les pages ci-dessous sont
lues automatiquement au début des sessions concernées.

- [[Tableau de bord]] — dernières sessions, tous projets, et économies de tokens

## Projets

Une page par projet dans \`Projets/\`, créée à la première session qui édite un
fichier dans un dépôt git. Sa clé \`chemin:\` liste le ou les dossiers qu'elle
couvre : c'est par elle que la page est retrouvée. Ce qui y est écrit à la main
est réinjecté à chaque session suivante.

Les préférences valables sur tous les projets vont dans \`~/.claude/CLAUDE.md\`,
pas dans ce vault.

## Journal

Une note par jour et par projet dans \`Journal/\`, un bloc par session, mis à jour
en fin de réponse et avant chaque compaction.

## Fonctionnement

| Moment | Ce qui se passe |
|---|---|
| Début de session | Lecture de la page du projet + la dernière session |
| Avant compaction | Écriture de l'état dans le journal du jour |
| Fin de réponse | Mise à jour du bloc de la session, de la page projet et du [[Tableau de bord]] |

Les blocs entre \`<!-- claude:xxx:start -->\` et \`<!-- claude:xxx:end -->\` sont
gérés automatiquement. Tout le reste est à toi et n'est jamais réécrit.
`,

  [DASHBOARD]: DASHBOARD_TEMPLATE,
};

let created = 0, skipped = 0;
for (const [file, content] of Object.entries(PAGES)) {
  if (fs.existsSync(file)) { skipped++; continue; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  created++;
  console.log('  créé   ', path.relative(VAULT, file));
}
// Index existant sans lien vers le tableau de bord : un bloc géré est ajouté,
// le texte de l'utilisateur n'est pas touché.
linkFromIndex();
if (skipped) console.log(`  ${skipped} page(s) déjà présente(s), laissée(s) intacte(s)`);
console.log(`\n  Vault prêt : ${ROOT}`);
