'use strict';
/**
 * Go and Rust part of the Stop quality gate (stop-quality.js).
 *
 *   formatGo(files)   gofmt -w on the edited .go files, silent (like Biome/Prettier)
 *   vetGo(files)      go vet on the packages of the edited files → error lines
 *   formatRust(files) rustfmt on the edited .rs files, edition read from Cargo.toml
 *
 * Local binaries only (PATH, then ~/.cargo/bin for Rust); a missing tool, a
 * timeout or any failure yields nothing. Nothing is downloaded: `go vet` runs
 * with GOPROXY=off, GOTOOLCHAIN=local and GOFLAGS=-mod=readonly (a missing module
 * or a newer toolchain named in go.mod is an error line, never a fetch).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findUp, run: exec } = require('./util');

const GO = /\.go$/;
const RS = /\.rs$/;
const VET_LINE = /\.go:\d+(:\d+)?: /;
/** No module fetch, no toolchain download named by a go.mod, no inherited -toolexec. */
const NO_NETWORK = { GOPROXY: 'off', GOFLAGS: '-mod=readonly', GOTOOLCHAIN: 'local' };

function which(bin, extra = []) {
  const dirs = [...String(process.env.PATH || '').split(path.delimiter), ...extra];
  for (const d of dirs) {
    const p = d && path.join(d, bin);
    try { if (p && fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

/** Files grouped by the directory holding `marker` (go.mod, Cargo.toml). */
function byRoot(files, marker) {
  const groups = new Map();
  for (const f of files) {
    const found = findUp(path.dirname(f), [marker]);
    if (!found) continue;
    groups.set(found.dir, [...(groups.get(found.dir) || []), f]);
  }
  return groups;
}

function formatGo(files) {
  const gofmt = which('gofmt');
  const go = files.filter((f) => GO.test(f));
  if (gofmt && go.length) exec(gofmt, ['-w', ...go], { timeout: 20000 });
}

/** `go vet` per module, on the packages the edited files belong to. At most 15 lines. */
function vetGo(files) {
  const go = which('go');
  if (!go) return [];
  const errors = [];
  for (const [root, own] of byRoot(files.filter((f) => GO.test(f)), 'go.mod')) {
    const pkgs = [...new Set(own.map((f) => `./${path.relative(root, path.dirname(f)) || '.'}`))];
    const res = exec(go, ['vet', ...pkgs], { cwd: root, timeout: 45000, env: NO_NETWORK });
    if (!res.ok) errors.push(...res.out.split('\n').filter((l) => VET_LINE.test(l)));
  }
  return errors.slice(0, 15);
}

function edition(cargoToml) {
  try {
    const m = fs.readFileSync(cargoToml, 'utf8').match(/^\s*edition\s*=\s*"(\d{4})"/m);
    return m ? m[1] : '2021';
  } catch { return '2021'; }
}

function formatRust(files) {
  const rustfmt = which('rustfmt', [path.join(os.homedir(), '.cargo', 'bin')]);
  if (!rustfmt) return;
  for (const [root, own] of byRoot(files.filter((f) => RS.test(f)), 'Cargo.toml')) {
    exec(rustfmt, ['--edition', edition(path.join(root, 'Cargo.toml')), ...own], { cwd: root, timeout: 20000 });
  }
}

module.exports = { formatGo, vetGo, formatRust };
