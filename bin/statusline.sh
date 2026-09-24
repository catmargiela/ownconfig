#!/bin/bash
# Claude Code statusLine — colored, single line.
# dir · branch(dirty) · model(effort) · context gauge · 5h + weekly limits · cost · duration · +/- lines
# · characters saved by output compression in this session
# Offline, no secrets. Reads the statusLine JSON payload from stdin. Its only
# write: the usage limits, to state/ccx/limits.json, for the quota-alert hook
# (hooks only see what the status line is given).
input=$(cat)
STATE="$HOME/.claude/state/ccx"

IFS=$'\x1f' read -r dir model effort ctx cost dur added removed rl5 cache rl7 sid rs5 rs7 <<< "$(printf '%s' "$input" | jq -r '
  [(.workspace.current_dir // .cwd // ""),
   (.model.display_name // "" | sub(" *\\(.*\\)$"; "")),
   (.effort.level // ""),
   (.context_window.used_percentage // ""),
   (.cost.total_cost_usd // ""),
   (.cost.total_duration_ms // ""),
   (.cost.total_lines_added // ""),
   (.cost.total_lines_removed // ""),
   (.rate_limits.five_hour.used_percentage // ""),
   (.prompt_cache.hit_ratio // ""),
   (.rate_limits.seven_day.used_percentage // ""),
   (.session_id // ""),
   (.rate_limits.five_hour.resets_at // ""),
   (.rate_limits.seven_day.resets_at // "")] | map(tostring) | join("\u001f")
')"

# --- palette (ANSI) ---
R=$'\033[0m'; DIM=$'\033[2m'; B=$'\033[1m'
BLUE=$'\033[38;5;75m'; MAG=$'\033[38;5;176m'; CYAN=$'\033[38;5;80m'
GREEN=$'\033[38;5;114m'; YEL=$'\033[38;5;221m'; RED=$'\033[38;5;203m'; GREY=$'\033[38;5;245m'
SEP="${DIM} │ ${R}"

# Color by threshold: <50 green, <80 yellow, else red.
level_color() {
  local v=${1%.*}
  if [ -z "$v" ]; then printf '%s' "$GREY"
  elif [ "$v" -lt 50 ]; then printf '%s' "$GREEN"
  elif [ "$v" -lt 80 ]; then printf '%s' "$YEL"
  else printf '%s' "$RED"; fi
}

# 10-cell gauge for a percentage.
gauge() {
  local v=${1%.*} filled i out=""
  filled=$(( (v + 5) / 10 )); [ "$filled" -gt 10 ] && filled=10
  for ((i = 0; i < 10; i++)); do
    if [ "$i" -lt "$filled" ]; then out+="▰"; else out+="▱"; fi
  done
  printf '%s' "$out"
}

out="${B}${BLUE}$(basename "${dir:-.}")${R}"

# --- git: branch + number of changed files ---
if [ -n "$dir" ] && git -C "$dir" --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$dir" --no-optional-locks branch --show-current 2>/dev/null)
  [ -z "$branch" ] && branch=$(git -C "$dir" --no-optional-locks rev-parse --short HEAD 2>/dev/null)
  dirty=$(git -C "$dir" --no-optional-locks status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  seg="${MAG}⎇ ${branch}${R}"
  [ "${dirty:-0}" -gt 0 ] && seg+="${YEL} ●${dirty}${R}"
  out+="${SEP}${seg}"
fi

# --- model + effort ---
if [ -n "$model" ]; then
  seg="${CYAN}${model}${R}"
  [ -n "$effort" ] && seg+="${GREY} ${effort}${R}"
  out+="${SEP}${seg}"
fi

# --- context gauge ---
if [ -n "$ctx" ]; then
  c=$(level_color "$ctx")
  out+="${SEP}${c}$(gauge "$ctx") $(printf '%.0f' "$ctx")%${R}"
fi

# One usage-limit segment: "5h 12%".
limit_seg() {
  printf '%s' "$(level_color "$2")$1 $(printf '%.0f' "$2")%${R}"
}

# --- usage limits: 5h window + weekly (always shown when available) ---
lim=""
[ -n "$rl5" ] && lim="$(limit_seg 5h "$rl5")"
if [ -n "$rl7" ]; then
  [ -n "$lim" ] && lim+="${GREY} · ${R}"
  lim+="$(limit_seg 7j "$rl7")"
fi
[ -n "$lim" ] && out+="${SEP}${lim}"

# --- cost + duration ---
if [ -n "$cost" ]; then
  seg="${GREEN}\$$(printf '%.2f' "$cost")${R}"
  if [ -n "$dur" ]; then
    s=$(( ${dur%.*} / 1000 )); h=$(( s / 3600 )); m=$(( s % 3600 / 60 ))
    if [ "$h" -gt 0 ]; then seg+="${GREY} ${h}h${m}m${R}"; else seg+="${GREY} ${m}m${R}"; fi
  fi
  out+="${SEP}${seg}"
fi

# --- lines changed ---
if [ -n "$added$removed" ] && [ "${added:-0}${removed:-0}" != "00" ]; then
  out+="${SEP}${GREEN}+${added:-0}${R}${GREY}/${R}${RED}-${removed:-0}${R}"
fi

# --- output compression: characters saved in this session (stats rows carry the session id) ---
if [[ "$sid" =~ ^[A-Za-z0-9_-]{1,64}$ ]] && [ -f "$STATE/compress-stats.jsonl" ]; then
  saved=$(tail -n 4000 "$STATE/compress-stats.jsonl" 2>/dev/null \
    | jq -Rrn --arg s "$sid" '[inputs | fromjson? | objects | select(.session == $s) | ((.before // 0) - (.after // 0))] | add // 0' 2>/dev/null)
  if [ "${saved:-0}" -gt 0 ] 2>/dev/null; then
    saved="$(awk -v n="$saved" 'BEGIN {
      if (n >= 1e6) printf "%.1fM", n / 1e6; else if (n >= 1e4) printf "%.0fk", n / 1e3
      else if (n >= 1e3) printf "%.1fk", n / 1e3; else printf "%d", n }')"
    out+="${SEP}${CYAN}⇣${saved}${R}"
  fi
fi

# --- usage limits handed to the quota-alert hook; rewritten only when they change ---
if [ -n "$rl5$rl7" ]; then
  limits=$(jq -cn --arg p5 "$rl5" --arg r5 "$rs5" --arg p7 "$rl7" --arg r7 "$rs7" '
    # resets_at is documented in epoch seconds; milliseconds are converted, anything else dropped.
    def secs(r): (r | tonumber? // null) | if . == null then null elif . > 1e11 then (. / 1000 | floor) else . end;
    def w(p; r): if p == "" then null else {pct: (p | tonumber), resets_at: secs(r)} end;
    {five_hour: w($p5; $r5), seven_day: w($p7; $r7)}' 2>/dev/null)
  if [ -n "$limits" ] && [ "$limits" != "$(cat "$STATE/limits.json" 2>/dev/null)" ]; then
    # Unpredictable temp name (mktemp, O_EXCL): a pre-planted symlink is never followed.
    mkdir -p "$STATE" 2>/dev/null && tmp=$(mktemp "$STATE/limits.json.XXXXXX" 2>/dev/null) \
      && { printf '%s' "$limits" > "$tmp" && mv -f "$tmp" "$STATE/limits.json" || rm -f "$tmp"; } 2>/dev/null
  fi
fi

# --- prompt cache hit ratio (warn only when poor) ---
if [ -n "$cache" ]; then
  pct=$(awk -v r="$cache" 'BEGIN { printf "%.0f", r * 100 }')
  [ -n "$pct" ] && [ "$pct" -lt 70 ] && out+="${SEP}${YEL}cache ${pct}%${R}"
fi

printf '%s\n' "$out"
