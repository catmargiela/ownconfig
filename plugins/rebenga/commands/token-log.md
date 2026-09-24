---
description: Lists one by one the Bash commands that went through output compression — date, command, processor, size before/after, gain.
disable-model-invocation: true
argument-hint: "[days, default 7] [--toutes]"
---

Reply to the user in French.

List the Bash commands compressed during the requested period: `$ARGUMENTS`.
Read-only: modify nothing, delete nothing.

Source: `~/.claude/state/ccx/compress-stats.jsonl`, one JSON line per command
that went through the wrapper — `ts`, `cmd` (first two words only, never the
arguments: an argument may contain a secret), `processor` (`node:git`,
`ts:kubectl`…), `engine` (`node`, `python` or `none`), `before` and `after`
(in characters), `exit`.

Arguments:
- a number: the period in days (7 if absent);
- `--toutes`: also include commands that were wrapped but returned raw
  (output under 2000 characters or gain below 20 %).

## 1. List

Run exactly this script, passing it the arguments as is
(`$ARGUMENTS`, possibly empty):

```bash
node -e '
const f=require("path").join(require("os").homedir(),".claude/state/ccx/compress-stats.jsonl");
const args=process.argv.slice(1).join(" ");
const days=Number((args.match(/\d+/)||[])[0])||7, all=/--toutes/.test(args), since=Date.now()-days*864e5;
let rows=[];try{rows=require("fs").readFileSync(f,"utf8").split("\n").map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(r=>r&&Date.parse(r.ts)>=since)}catch{}
const kept=rows.filter(r=>all||r.after<r.before).sort((a,b)=>Date.parse(b.ts)-Date.parse(a.ts));
const d=t=>new Date(t).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
const pct=r=>r.before?Math.round(100*(1-r.after/r.before)):0;
console.log(`période: ${days} j · enveloppées: ${rows.length} · listées: ${kept.length}${all?" (toutes)":" (compressées)"}`);
for(const r of kept)console.log([d(r.ts),r.cmd,r.processor,`${r.before}→${r.after}`,`${pct(r)}%`,r.after<r.before?"compressée":"brute",`exit ${r.exit}`].join(" | "));' -- $ARGUMENTS
```

File missing or empty: say so, remind that compression is off in the
`minimal` profile, with `CCX_DISABLED=1` or `CCX_COMPRESS=off`, and stop there.

## 2. Display

Render the list as a table, most recent first:

```
Commandes compressées — 7 derniers jours (3 sur 7 enveloppées)
| Quand       | Commande | Processeur | Avant → après (car.) | Gain | Statut     | Exit |
|-------------|----------|------------|----------------------|------|------------|------|
| 23/09 15:12 | git log  | git        | 15 611 → 1 564       | 90 % | compressée | 0    |
```

Beyond 50 lines, show the 50 most recent and say how many are
hidden. Interpret nothing further: for totals and rankings,
point to `/rebenga:token-stats`.

End with: « Sortie brute d'une commande : la préfixer par `CCX_RAW=1`. »
