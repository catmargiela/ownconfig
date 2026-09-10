#!/usr/bin/env node
'use strict';
/**
 * Diagnostic du vault, orienté coût.
 *
 * Un lint de vault classique cherche les liens morts. Le nôtre répond d'abord à
 * la question qui pèse sur la facture : **combien chaque projet coûte-t-il en
 * tokens au démarrage de session**, et quelles pages sont payées sans rien
 * apprendre au modèle.
 *
 *   node vault-lint.js [--verbose]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('./hooks/lib/vault');

const VERBOSE = process.argv.includes('--verbose');
const tok = (s) => Math.round((s || '').length / 4);
const pad = (s, n) => String(s).padEnd(n);

const st = V.vaultStatus();
if (!st.ok) { console.error(`Vault inactif : ${st.why}`); process.exit(1); }

function listMd(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f)); }
  catch { return []; }
}

const projets = listMd(V.DIRS.projets);
const journaux = listMd(V.DIRS.journal);
const profils = listMd(V.DIRS.profil);
const toutes = [...projets, ...journaux, ...profils, ...listMd(V.ROOT)];
const nomsExistants = new Set(toutes.map((f) => path.basename(f, '.md')));

const findings = { muettes: [], tronquees: [], liensCasses: [], orphelins: [], inutilisees: [], grosses: [], sansChemin: [], doublons: [] };

// --- Profil : payé à CHAQUE session, sur chaque projet ---
const profilPath = path.join(V.DIRS.profil, 'Façon de coder.md');
const profilRaw = V.read(profilPath);
const profilClean = V.cleanForInjection(profilRaw);
const profilTok = tok(profilClean.slice(0, V.BUDGET.profil));
if (!profilClean) findings.muettes.push(['Profil/Façon de coder.md', 'aucun contenu réel — injecte 0 alors que c\'est le fichier le plus rentable']);
if (profilClean.length > V.BUDGET.profil) findings.tronquees.push(['Profil/Façon de coder.md', profilClean.length, V.BUDGET.profil]);

// --- Coût par projet ---
const couts = [];
for (const f of projets) {
  const nom = path.basename(f, '.md');
  const raw = V.read(f);
  const clean = V.cleanForInjection(raw);
  const chemin = (raw.match(/^chemin:\s*(.+)$/m) || [])[1] || '';
  const injection = chemin ? V.buildInjection(chemin.trim()) : null;

  if (!chemin) {
    findings.sansChemin.push(`Projets/${nom}.md`);
  } else {
    const resolue = path.basename(V.resolveProjectFile(chemin.trim()), '.md');
    if (resolue !== nom) findings.doublons.push([`Projets/${nom}.md`, `${resolue}.md`]);
  }
  if (!clean) findings.muettes.push([`Projets/${nom}.md`, 'que des placeholders — n\'injecte rien']);
  if (clean.length > V.BUDGET.projet) findings.tronquees.push([`Projets/${nom}.md`, clean.length, V.BUDGET.projet]);
  if (!V.readRegion(raw, 'journal').trim()) findings.inutilisees.push(`Projets/${nom}.md`);
  if (raw.length > 12000) findings.grosses.push([`Projets/${nom}.md`, raw.length]);

  couts.push({ nom, total: tok(injection), projet: tok(clean.slice(0, V.BUDGET.projet)), muette: !clean });
}

// --- Liens cassés, toutes pages confondues ---
for (const f of toutes) {
  const rel = path.relative(V.ROOT, f);
  for (const m of V.read(f).matchAll(/\[\[([^\]|#]+)/g)) {
    const cible = m[1].trim();
    if (cible && !nomsExistants.has(cible)) findings.liensCasses.push([rel, cible]);
  }
}

// --- Journaux sans page projet ---
const nomsProjets = new Set(projets.map((f) => path.basename(f, '.md')));
for (const f of journaux) {
  const m = path.basename(f, '.md').match(/—\s*(.+)$/);
  if (m && !nomsProjets.has(m[1].trim())) findings.orphelins.push(path.relative(V.ROOT, f));
}

// ------------------------------------------------------------------ rapport
console.log(`\n  Vault : ${V.ROOT.replace(os.homedir(), '~')}`);
console.log(`  ${projets.length} projet(s), ${journaux.length} journal/journaux, ${toutes.length} page(s) au total\n`);

console.log('  COÛT AU DÉMARRAGE DE SESSION');
console.log(`  ${pad('projet', 26)} ${pad('total', 9)} dont page projet`);
console.log('  ' + '─'.repeat(56));
console.log(`  ${pad('(profil, tous projets)', 26)} ${pad('~' + profilTok + ' tok', 9)} —`);
for (const c of couts.sort((a, b) => b.total - a.total)) {
  console.log(`  ${pad(c.nom.slice(0, 25), 26)} ${pad('~' + c.total + ' tok', 9)} ~${c.projet} tok${c.muette ? '   ⚠ muette' : ''}`);
}
if (!couts.length) console.log('  (aucune page projet — elles se créent à la première compaction ou fin de session)');

const bloc = (titre, items, fmt) => {
  if (!items.length) return;
  console.log(`\n  ${titre} (${items.length})`);
  const vus = VERBOSE ? items : items.slice(0, 8);
  for (const it of vus) console.log('    ' + fmt(it));
  if (items.length > vus.length) console.log(`    … +${items.length - vus.length} (--verbose)`);
};

bloc('PAGES SANS `chemin:` — jamais retrouvées si tu les renommes', findings.sansChemin, (f) => f);
bloc('DOUBLONS — deux pages pour le même dossier', findings.doublons, ([a, b]) => `${a} pointe le même dossier que ${b}`);
bloc('PAGES MUETTES — payées à la lecture, injectent zéro', findings.muettes, ([f, why]) => `${f} : ${why}`);
bloc('PAGES TRONQUÉES — écrit mais jamais injecté', findings.tronquees, ([f, a, b]) => `${f} : ${a} car. pour un budget de ${b}`);
bloc('PAGES VOLUMINEUSES — relire et élaguer', findings.grosses, ([f, n]) => `${f} : ${n} car.`);
bloc('LIENS CASSÉS', findings.liensCasses, ([f, c]) => `${f} → [[${c}]]`);
bloc('JOURNAUX ORPHELINS — page projet absente', findings.orphelins, (f) => f);
bloc('PAGES PROJET JAMAIS UTILISÉES — aucune session enregistrée', findings.inutilisees, (f) => f);

const total = Object.values(findings).reduce((n, a) => n + a.length, 0);
const pire = couts.length ? Math.max(...couts.map((c) => c.total)) : 0;
console.log(`\n  ${total === 0 ? 'Aucun problème détecté.' : total + ' point(s) à regarder.'}`);
console.log(`  Session la plus chère : ~${pire + profilTok} tokens de contexte injecté.\n`);
