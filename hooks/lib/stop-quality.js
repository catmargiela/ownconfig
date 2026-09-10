'use strict';
/**
 * Stop — gate qualité batché sur les fichiers édités pendant la réponse.
 *
 * Formatage : silencieux, appliqué. Typecheck : bloquant tant que le budget de
 * relances n'est pas épuisé, pour que l'erreur revienne à l'agent plutôt que
 * d'atterrir dans un commit. console.log : signalé, jamais bloquant.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { enabled, readState, writeState, findUp, run: exec, tilde } = require('./util');

const JS_TS = /\.(m|c)?[jt]sx?$/;
const TS = /\.(m|c)?tsx?$/;
const TEST = /(\.(test|spec)\.|__tests__|\/tests?\/|\.stories\.)/;
const MAX_BLOCKS = 3; // plafond de relances par session : un gate ne doit pas boucler

function projectRoot(file) {
  const found = findUp(path.dirname(file), ['package.json']);
  return found ? found.dir : null;
}

/** Biome s'il est configuré, sinon Prettier s'il est installé. Aucun téléchargement. */
function formatter(root) {
  if (fs.existsSync(path.join(root, 'biome.json')) || fs.existsSync(path.join(root, 'biome.jsonc'))) {
    if (fs.existsSync(path.join(root, 'node_modules', '.bin', 'biome'))) {
      return { bin: path.join(root, 'node_modules', '.bin', 'biome'), args: ['format', '--write'] };
    }
  }
  const prettier = path.join(root, 'node_modules', '.bin', 'prettier');
  if (fs.existsSync(prettier)) return { bin: prettier, args: ['--write', '--log-level=silent'] };
  return null;
}

function typecheck(root) {
  const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
  if (!fs.existsSync(tsc)) return null;
  if (!fs.existsSync(path.join(root, 'tsconfig.json'))) return null;
  const res = exec(tsc, ['--noEmit', '--pretty', 'false'], { cwd: root, timeout: 45000 });
  if (res.ok) return null;
  const lines = res.out.split('\n').filter((l) => /error TS\d+/.test(l));
  return lines.length ? lines : null;
}

function consoleLogs(files) {
  const hits = [];
  for (const f of files) {
    if (!JS_TS.test(f) || TEST.test(f)) continue;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      if (/(?<!\/\/.*)\bconsole\.log\s*\(/.test(line)) hits.push(`${tilde(f)}:${i + 1}`);
    });
  }
  return hits;
}

function run(input) {
  if (!enabled(['standard', 'strict'])) return;

  const sid = input?.session_id;
  const edited = readState(sid, 'edited', []).filter((f) => fs.existsSync(f));
  writeState(sid, 'edited', []); // vidé quoi qu'il arrive : pas de retraitement
  if (!edited.length) return;

  const roots = [...new Set(edited.map(projectRoot).filter(Boolean))];
  const codeFiles = edited.filter((f) => JS_TS.test(f));

  // 1. Formatage — appliqué en silence, un seul appel par projet.
  if (codeFiles.length) {
    for (const root of roots) {
      const fmt = formatter(root);
      if (!fmt) continue;
      const own = codeFiles.filter((f) => f.startsWith(root + path.sep));
      if (own.length) exec(fmt.bin, [...fmt.args, ...own], { cwd: root, timeout: 30000 });
    }
  }

  const notes = [];

  // 2. Typecheck — une seule passe par projet, seulement si du TS a bougé.
  let errors = [];
  if (process.env.CCX_NO_TYPECHECK !== '1' && edited.some((f) => TS.test(f))) {
    for (const root of roots) {
      const errs = typecheck(root);
      if (errs) errors.push(...errs.slice(0, 15));
    }
  }

  // 3. console.log — signalé, jamais bloquant.
  const logs = consoleLogs(edited);
  if (logs.length) {
    notes.push(`console.log laissé dans le code : ${logs.slice(0, 8).join(', ')}${logs.length > 8 ? ` (+${logs.length - 8})` : ''}`);
  }

  if (!errors.length) {
    if (notes.length) process.stderr.write('[Qualité] ' + notes.join('\n') + '\n');
    return;
  }

  // Relance bornée : plafond par session + signature, pour ne jamais boucler
  // sur une erreur que l'agent n'arrive pas à corriger.
  const sig = crypto.createHash('sha1').update(errors.join('\n')).digest('hex').slice(0, 12);
  const gate = readState(sid, 'typecheck-gate', { count: 0, last: null });
  if (gate.count >= MAX_BLOCKS || gate.last === sig) {
    process.stderr.write(
      `[Qualité] ${errors.length} erreur(s) de type non corrigée(s) — gate épuisé, à signaler à l'utilisateur.\n`
    );
    return;
  }
  writeState(sid, 'typecheck-gate', { count: gate.count + 1, last: sig });

  process.stderr.write(
    [
      '[Gate qualité] Le typecheck échoue sur les fichiers modifiés dans cette réponse.',
      '',
      ...errors,
      '',
      ...(notes.length ? notes.concat('') : []),
      'Corriger ces erreurs avant de conclure. Ne pas assouplir tsconfig.json et ne pas',
      "ajouter d'`any` : corriger le type à la source.",
    ].join('\n') + '\n'
  );
  process.exit(2);
}

module.exports = { run, consoleLogs };
