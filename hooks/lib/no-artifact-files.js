'use strict';
/**
 * PreToolUse / Write|Edit|MultiEdit — no-artifact-files.
 *
 * Refuse, une seule fois par chemin et par session, la CRÉATION d'un fichier de
 * travail (NOTES.md, report.md, rapport-final.md, todo.txt…) hors des dossiers
 * faits pour ça. Ces fichiers encombrent le dépôt et répondent à une question
 * qui attendait une réponse dans la conversation.
 *
 * Second passage autorisé (même mécanisme que le fact-forcing) : si
 * l'utilisateur a demandé ce fichier, relancer suffit. Éditer un fichier
 * existant n'est jamais refusé.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { enabled, readState, writeState, deny, findUp, tilde } = require('./util');

const ARTIFACT_NAMES = [
  /^(notes?|todo|scratch|wip|tmp|draft|report|audit|summary|analysis|plan)([-_. ].*)?\.(md|txt)$/i,
  /^(rapport|compte-rendu|bilan|analyse|resume|résumé)([-_. ].*)?\.(md|txt)$/i,
];
/** Dossiers où ces fichiers ont leur place. */
const ALLOWED_DIRS = new Set(['docs', '.claude', '.github']);

function isArtifactName(filePath) {
  const name = path.basename(String(filePath || '')).normalize('NFC');
  return ARTIFACT_NAMES.some((re) => re.test(name));
}

function vaultDir() {
  return path.resolve(process.env.CC_VAULT || path.join(os.homedir(), 'Documents', 'Obsidian Vault'));
}

function isInside(file, dir) {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Le fichier est-il dans `docs/`, `.claude/`, `.github/` ou le vault ? Les
 * dossiers sont cherchés dans le chemin RELATIF au dépôt : un dépôt qui vit
 * lui-même sous `~/.claude/` ne rend pas tout son contenu exempt.
 */
function inAllowedPlace(file) {
  if (isInside(file, vaultDir())) return true;
  const repo = findUp(path.dirname(file), ['.git']);
  const rel = repo && repo.dir !== os.homedir() ? path.relative(repo.dir, file) : file;
  return path.dirname(rel).split(path.sep).some((part) => ALLOWED_DIRS.has(part));
}

function denyMsg(file) {
  return [
    `[Fichier de travail] Création de ${tilde(file)} refusée (première tentative).`,
    '',
    'Ce nom ressemble à des notes, un rapport ou une synthèse. L\'utilisateur préfère',
    'recevoir ce contenu dans la conversation ; un fichier de ce genre n\'entre dans le',
    'dépôt que s\'il l\'a demandé.',
    '',
    '  → Donner le contenu dans la réponse plutôt que dans un fichier.',
    '  → Documentation durable : `docs/`. Mémoire longue : le vault (skill vault-note).',
    "  → Si l'utilisateur a explicitement demandé ce fichier, relancer la même écriture :",
    '    elle passera.',
  ].join('\n');
}

function run(input) {
  if (!enabled(['standard', 'strict'])) return;
  const tool = input?.tool_name;
  if (tool && !['Write', 'Edit', 'MultiEdit'].includes(tool)) return;
  const raw = input?.tool_input?.file_path || input?.tool_input?.path;
  if (!raw || !isArtifactName(raw)) return;
  const file = path.resolve(input.cwd || process.cwd(), raw);
  if (fs.existsSync(file) || inAllowedPlace(file)) return;

  const seen = readState(input.session_id, 'artifact', {});
  if (seen[file]) return;
  // Marqué AVANT le refus : le second passage doit aboutir, sinon on boucle.
  writeState(input.session_id, 'artifact', { ...seen, [file]: 1 });
  deny(denyMsg(file));
}

module.exports = { run, isArtifactName, inAllowedPlace };
