#!/usr/bin/env bash
# Structural check of the local marketplace and the rebenga plugin, without the
# claude CLI (used in CI). Locally, `claude plugin validate --strict` goes further.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
err() { echo "✗ $*"; fail=1; }

jq -e '.name and (.plugins | length > 0)' .claude-plugin/marketplace.json >/dev/null \
  || err "marketplace.json : name ou plugins manquant"
jq -e '.name == "rebenga" and (.version | test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))' \
  plugins/rebenga/.claude-plugin/plugin.json >/dev/null || err "plugin.json : name ou version invalide"

# Every component starts with a frontmatter holding the keys Claude Code needs.
check_front() {
  local file=$1; shift
  local head
  head=$(awk 'NR==1 && $0!="---"{exit 1} NR>1 && $0=="---"{exit 0} NR>1{print}' "$file") \
    || { err "$file : frontmatter absent"; return; }
  for key in "$@"; do
    grep -qE "^${key}:" <<<"$head" || err "$file : clé « ${key} » absente du frontmatter"
  done
}

for f in plugins/rebenga/commands/*.md; do check_front "$f" description; done
for f in plugins/rebenga/agents/*.md agents/*.md; do check_front "$f" name description; done
for f in plugins/rebenga/skills/*/SKILL.md skills/*/SKILL.md; do check_front "$f" name description; done

[ "$fail" = 0 ] && echo "✓ marketplace, plugin et frontmatters"
exit "$fail"
