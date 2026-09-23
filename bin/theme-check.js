#!/usr/bin/env node
'use strict';
/**
 * Validate a Claude Code custom theme file (themes/<slug>.json).
 *
 *   node bin/theme-check.js themes/portal.json [...]
 *
 * Checks: JSON shape ({name, base, overrides}), known base, known color keys,
 * color value syntax, and WCAG contrast of text on the message background.
 * Exit 0 when every file passes, 1 otherwise. Never writes anything.
 */
const fs = require('fs');
const path = require('path');

const BASES = ['dark', 'light', 'dark-daltonized', 'light-daltonized', 'dark-ansi', 'light-ansi'];

/** Color keys read by Claude Code's built-in themes (extracted from the binary). */
const KNOWN_KEYS = new Set([
  'claude', 'claudeShimmer', 'text', 'inverseText', 'subtle', 'inactive', 'inactiveShimmer',
  'suggestion', 'remember', 'permission', 'permissionShimmer', 'planMode', 'autoAccept',
  'autoAcceptShimmer', 'bashBorder', 'promptBorder', 'promptBorderShimmer', 'success', 'error',
  'warning', 'warningShimmer', 'merged', 'ide', 'skill', 'fastMode', 'fastModeShimmer',
  'professionalBlue', 'chromeYellow', 'background', 'selectionBg', 'userMessageBackground',
  'userMessageBackgroundHover', 'bashMessageBackgroundColor', 'memoryBackgroundColor',
  'composerSidebarBackground', 'diffAdded', 'diffRemoved', 'diffAddedDimmed', 'diffRemovedDimmed',
  'diffAddedWord', 'diffRemovedWord', 'rate_limit_fill', 'rate_limit_empty', 'effortUltra',
  'briefLabelYou', 'briefLabelClaude', 'clawd_body', 'clawd_background', 'standard',
  'rainbow_red', 'rainbow_orange', 'rainbow_yellow', 'rainbow_green', 'rainbow_blue',
  'rainbow_indigo', 'rainbow_violet', 'rainbow_red_shimmer', 'rainbow_orange_shimmer',
  'rainbow_yellow_shimmer', 'rainbow_green_shimmer', 'rainbow_blue_shimmer',
  'rainbow_indigo_shimmer', 'rainbow_violet_shimmer',
]);

const ANSI_NAMES = /^ansi:(black|red|green|yellow|blue|magenta|cyan|white|gray|grey)(Bright)?$/;

/** RGB triple of a color string, or null when it is valid but not RGB (ansi). Throws when invalid. */
function parseColor(value) {
  const v = String(value).trim();
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = v.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (m && m.slice(1).every((n) => Number(n) <= 255)) return m.slice(1).map(Number);
  m = v.match(/^ansi256\(\s*(\d{1,3})\s*\)$/);
  if (m && Number(m[1]) <= 255) return null;
  if (ANSI_NAMES.test(v)) return null;
  throw new Error(`couleur invalide « ${v} » (attendu #RRGGBB, #RGB, rgb(r,g,b), ansi256(n) ou ansi:<nom>)`);
}

/** WCAG relative-luminance contrast ratio between two RGB triples. */
function contrast(a, b) {
  const lum = (rgb) => {
    const [r, g, bl] = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Problems (errors block, warnings inform) for one parsed theme object. */
function checkTheme(theme) {
  const errors = [];
  const warnings = [];
  if (!theme || typeof theme !== 'object') return { errors: ['pas un objet JSON'], warnings };
  if (typeof theme.name !== 'string' || !theme.name.trim()) errors.push('`name` manquant');
  if (!BASES.includes(theme.base)) errors.push(`\`base\` inconnue « ${theme.base} » (${BASES.join(', ')})`);
  const o = theme.overrides;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { errors: [...errors, '`overrides` doit être un objet'], warnings };
  const rgb = {};
  for (const [key, value] of Object.entries(o)) {
    if (!KNOWN_KEYS.has(key)) errors.push(`clé inconnue « ${key} »`);
    try { rgb[key] = parseColor(value); } catch (e) { errors.push(`${key} : ${e.message}`); }
  }
  if (rgb.text && rgb.userMessageBackground) {
    const r = contrast(rgb.text, rgb.userMessageBackground);
    if (r < 4.5) warnings.push(`contraste texte / fond de message ${r.toFixed(2)} < 4.5`);
  }
  return { errors, warnings };
}

function checkFile(file) {
  try { return checkTheme(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (e) { return { errors: [`illisible : ${e.message}`], warnings: [] }; }
}

function main(files) {
  let failed = 0;
  for (const f of files) {
    const { errors, warnings } = checkFile(f);
    console.log(`${errors.length ? '✗' : '✓'} ${path.basename(f)}`);
    errors.forEach((e) => console.log(`    erreur : ${e}`));
    warnings.forEach((w) => console.log(`    attention : ${w}`));
    if (errors.length) failed++;
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('usage : node bin/theme-check.js <theme.json> [...]'); process.exit(2); }
  process.exit(main(args));
}

module.exports = { checkTheme, parseColor, contrast, KNOWN_KEYS, BASES };
