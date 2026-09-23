'use strict';
/**
 * PreToolUse / Edit|Write|MultiEdit sur `**\/migrations/*.sql` — migration-guard.
 *
 * Refus (standard, strict) :
 *   1. `;` dans un commentaire SQL. goose découpe les instructions sur `;` même
 *      à l'intérieur d'un commentaire : la migration part en production coupée
 *      en deux, avec une instruction tronquée. Incident réel, pas théorique.
 *   2. Section `-- +goose Up` sans section `-- +goose Down` : plus de rollback.
 *
 * Avertissements (non bloquants) :
 *   - `DROP TABLE` / `DROP COLUMN` sans `IF EXISTS`.
 *   - AND et OR mélangés sans parenthèses dans un WHERE : AND lie plus fort que
 *     OR, la condition ne filtre pas ce qu'on croit. Incident réel aussi.
 *
 * Le contrôle porte sur le fichier tel qu'il sera APRÈS l'édition : un Edit est
 * rejoué sur le contenu actuel pour juger la migration complète.
 */
const fs = require('fs');
const { enabled, deny, warn, readState, writeState, tilde } = require('./util');

function isMigration(filePath) {
  return /(^|[\\/])migrations[\\/][^\\/]+\.sql$/i.test(String(filePath || ''));
}

/** Contenu du fichier après application de l'appel d'outil, ou null. */
function resultingContent(ti) {
  if (typeof ti.content === 'string') return ti.content;
  const filePath = ti.file_path || ti.path;
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { text = ''; }
  const edits = Array.isArray(ti.edits) ? ti.edits : [ti];
  for (const e of edits) {
    if (!e || typeof e.new_string !== 'string') continue;
    const oldStr = typeof e.old_string === 'string' ? e.old_string : '';
    // Remplacement littéral : une fonction évite l'interprétation de `$&`, `$1`…
    text = !oldStr ? text + e.new_string
      : e.replace_all ? text.split(oldStr).join(e.new_string)
      : text.replace(oldStr, () => e.new_string);
  }
  return text;
}

/**
 * Découpe le SQL en code et commentaires, en respectant chaînes '…', identifiants
 * "…" et chaînes dollar ($$…$$, $tag$…$tag$). Renvoie le code sans commentaires
 * ni littéraux, et la liste des commentaires avec leur ligne.
 */
function scanSql(sql) {
  const text = String(sql);
  const comments = [];
  let code = '';
  let i = 0;
  const lineAt = (idx) => text.slice(0, idx).split('\n').length;
  while (i < text.length) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    if (two === '--') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      comments.push({ line: lineAt(i), text: text.slice(i, stop) });
      i = stop;
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      comments.push({ line: lineAt(i), text: text.slice(i, stop) });
      code += ' ';
      i = stop;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && !(text[j] === c && text[j + 1] !== c)) j += text[j] === c ? 2 : 1;
      code += c + c;
      i = j + 1;
    } else if (c === '$' && /^\$[A-Za-z_]*\$/.test(text.slice(i))) {
      const tag = text.slice(i).match(/^\$[A-Za-z_]*\$/)[0];
      const end = text.indexOf(tag, i + tag.length);
      code += "''";
      i = end < 0 ? text.length : end + tag.length;
    } else {
      code += c;
      i++;
    }
  }
  return { code, comments };
}

function semicolonComments(sql) {
  return scanSql(sql).comments.filter((c) => c.text.includes(';')).map((c) => c.line);
}

function missingDown(sql) {
  const up = /^\s*--\s*\+goose\s+Up\b/im.test(sql);
  const down = /^\s*--\s*\+goose\s+Down\b/im.test(sql);
  return up && !down;
}

function unsafeDrops(code) {
  return /\bDROP\s+(TABLE|COLUMN)\s+(?!IF\s+EXISTS\b)/i.test(code);
}

/** Retire les groupes parenthésés jusqu'à ne garder que le niveau 0. */
function topLevel(clause) {
  let s = clause;
  for (let k = 0; k < 20 && /\([^()]*\)/.test(s); k++) s = s.replace(/\([^()]*\)/g, ' ');
  return s;
}

const WHERE_END = /\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|RETURNING|UNION|ON\s+CONFLICT)\b/i;

/** Un WHERE qui mélange AND et OR au même niveau de parenthèses. */
function mixedAndOr(code) {
  for (const stmt of code.split(';')) {
    // Chaque WHERE, y compris dans une sous-requête : on juge son propre niveau.
    const parts = stmt.split(/\bWHERE\b/i).slice(1);
    for (const part of parts) {
      // `)` restant après aplatissement : fin d'une sous-requête, donc du WHERE.
      const clause = topLevel(part).split(')')[0].split(WHERE_END)[0]
        .replace(/\bBETWEEN\s+\S+\s+AND\b/gi, ' ');
      if (/\bAND\b/i.test(clause) && /\bOR\b/i.test(clause)) return true;
    }
  }
  return false;
}

function refusalMsg(filePath, lines, noDown) {
  const out = ['[Migration Guard] Migration refusée : ' + tilde(filePath), ''];
  if (lines.length) {
    out.push(
      `\`;\` dans un commentaire SQL (ligne${lines.length > 1 ? 's' : ''} ${lines.join(', ')}).`,
      "goose découpe les instructions sur `;` même dans un commentaire : l'instruction",
      'suivante part tronquée en production.',
      '  → Retirer le `;` du commentaire (reformuler, ou utiliser `,` / `—`).',
      '',
    );
  }
  if (noDown) {
    out.push(
      'Section `-- +goose Up` sans section `-- +goose Down` : aucun rollback possible.',
      '  → Ajouter `-- +goose Down` avec l\'inverse de la migration (ou une section',
      '    Down vide assumée et commentée si elle est réellement irréversible).',
      '',
    );
  }
  out.push("Contournement explicite (à ne poser que sur demande) : CCX_ALLOW_MIGRATION=1");
  return out.join('\n');
}

function warnings(code) {
  const out = [];
  if (unsafeDrops(code)) {
    out.push('`DROP TABLE` / `DROP COLUMN` sans `IF EXISTS` : la migration échoue si l\'objet a déjà disparu (rejeu, rollback partiel).');
  }
  if (mixedAndOr(code)) {
    out.push('Un WHERE mélange AND et OR sans parenthèses. AND lie plus fort que OR : `a OR b AND c` vaut `a OR (b AND c)`. Parenthéser explicitement.');
  }
  return out;
}

function run(input) {
  const ti = input?.tool_input || {};
  const filePath = ti.file_path || ti.path;
  if (!isMigration(filePath)) return;
  if (!enabled(['standard', 'strict'])) return;

  const sql = resultingContent(ti);
  if (sql == null) return;

  if (process.env.CCX_ALLOW_MIGRATION !== '1') {
    const lines = semicolonComments(sql);
    const noDown = missingDown(sql);
    if (lines.length || noDown) deny(refusalMsg(filePath, lines, noDown));
  }

  // Avertissements : une fois par fichier et par motif dans la session.
  const found = warnings(scanSql(sql).code);
  if (!found.length) return;
  const seen = readState(input.session_id, 'migration-warn', {});
  const fresh = found.filter((w) => !seen[`${filePath}|${w}`]);
  if (!fresh.length) return;
  const next = { ...seen };
  for (const w of fresh) next[`${filePath}|${w}`] = 1;
  writeState(input.session_id, 'migration-warn', next);
  warn(['[Migration Guard] ' + tilde(filePath), ...fresh.map((w) => '  - ' + w)].join('\n'));
}

module.exports = { run, isMigration, scanSql, semicolonComments, missingDown, unsafeDrops, mixedAndOr, resultingContent };
