#!/bin/sh
# headersHelper for the GitHub MCP server: emits the Authorization header from gh's keychain token.
# Never writes the token to disk; runs on each MCP connection.

# The helper may be launched with an empty environment: give it a sane PATH.
[ -n "${PATH:-}" ] || PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

# gh writes state under $HOME; never let it fall back to the current directory.
home_of() {
  u=$1
  case $u in ''|*[!A-Za-z0-9._-]*) return 1 ;; esac
  h=""
  if command -v dscl >/dev/null 2>&1; then
    h=$(dscl . -read "/Users/$u" NFSHomeDirectory 2>/dev/null | sed -n 's/^NFSHomeDirectory: *//p')
  fi
  if [ -z "$h" ] && command -v getent >/dev/null 2>&1; then
    h=$(getent passwd "$u" 2>/dev/null | cut -d: -f6)
  fi
  # $u is restricted to [A-Za-z0-9._-] above: the tilde expansion is safe.
  [ -n "$h" ] || h=$(eval "printf '%s' ~$u")
  case $h in /*) [ -d "$h" ] && printf '%s' "$h" ;; *) return 1 ;; esac
}

if [ -z "${HOME:-}" ]; then
  HOME=$(home_of "$(id -un 2>/dev/null)") || exit 1
fi
export HOME

# Absolute paths only: a relative hit (`.` in PATH) could run a planted binary.
resolve() {
  p=$(command -v "$1" 2>/dev/null)
  case $p in /*) printf '%s' "$p"; return 0 ;; esac
  for p in "/opt/homebrew/bin/$1" "/usr/local/bin/$1"; do
    [ -x "$p" ] && { printf '%s' "$p"; return 0; }
  done
  return 1
}

gh=$(resolve gh) || exit 1
jq=$(resolve jq) || exit 1
token=$("$gh" auth token 2>/dev/null) || exit 1
[ -n "$token" ] || exit 1
"$jq" -cn --arg t "$token" '{Authorization: ("Bearer " + $t)}'
