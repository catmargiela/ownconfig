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

## Profil — lu à chaque session

- [[Façon de coder]] — préférences durables, injectées partout
- [[Stack]] — outils et versions

## Projets

Une page par projet dans \`Projets/\`, créée automatiquement à la première
session dans le dossier. Ce qui est écrit à la main dans ces pages est réinjecté
à chaque session suivante. Chaque page liste ses sessions récentes et leur résultat.

## Journal

Une note par jour et par projet dans \`Journal/\`, un bloc par session, mis à jour
en fin de réponse et avant chaque compaction.

## Fonctionnement

| Moment | Ce qui se passe |
|---|---|
| Début de session | Lecture de [[Façon de coder]] + la page du projet + la dernière session |
| Avant compaction | Écriture de l'état dans le journal du jour |
| Fin de réponse | Mise à jour du bloc de la session, de la page projet et du [[Tableau de bord]] |

Les blocs entre \`<!-- claude:xxx:start -->\` et \`<!-- claude:xxx:end -->\` sont
gérés automatiquement. Tout le reste est à toi et n'est jamais réécrit.
`,

  [path.join(DIRS.profil, 'Façon de coder.md')]: `---
type: profil
tags: [claude, profil]
---

# Façon de coder

> Injectée au début de **chaque** session, tous projets confondus.
> Ne mettre ici que ce qui est vrai partout — le reste va dans la page du projet.
> Viser la concision : ce fichier se paie à chaque session.

## Ce que je veux par défaut

<!-- Exemples à remplacer par les tiens :
- Me proposer une approche avant d'écrire plus de ~50 lignes.
- Aller droit au but, pas de récapitulatif de ce que je viens de dire.
- Me dire quand je pars sur une mauvaise piste, sans attendre que je demande.
-->

## Ce que je ne veux pas

<!--
- Des commentaires qui paraphrasent le code.
- Des abstractions ajoutées « au cas où ».
- Qu'on me dise que c'est fait sans l'avoir vérifié.
-->

## Conventions transverses

<!-- Nommage, structure de dossiers, gestion des erreurs, style de commit
     — uniquement ce qui vaut pour tous tes projets. -->

## Décisions déjà tranchées

<!-- Les débats qu'on n'a plus besoin de refaire. Par exemple :
- Gestionnaire de paquets : ...
- Tests : ... 
- Déploiement : ...
-->

Voir [[Stack]] et [[Index Claude]].
`,

  [path.join(DIRS.profil, 'Stack.md')]: `---
type: profil
tags: [claude, profil]
---

# Stack

> Outils et versions récurrents. Sert à éviter les suppositions.

## Langages et cadres

<!-- À compléter : ce que tu utilises réellement et à quelle version. -->

## Outillage

<!-- Gestionnaire de paquets, linter, formateur, runner de tests. -->

## Services

<!-- Hébergement, base de données, auth, paiement, analytics. -->

## Environnement

- Machine : macOS
- Claude Code : configuration versionnée dans \`~/.claude-config\`

Voir [[Façon de coder]] et [[Index Claude]].
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
