---
description: Summary of Bash output compression — commands compressed, characters and tokens saved, most cost-effective processors and commands.
disable-model-invocation: true
argument-hint: "[days, default 7]"
---

Reply to the user in French.

Summarise what Bash output compression saved over the last `$ARGUMENTS`
days (7 if empty). Read-only: modify nothing, delete nothing.

Source: `~/.claude/state/ccx/compress-stats.jsonl`, one JSON line per command
that went through the wrapper — `ts`, `cmd` (first two words), `processor` (`node:git`,
`ts:kubectl`…), `engine` (`node`, `python` or `none`), `before` and `after`
(in characters), `exit`. No output content is stored there.

Estimate: **tokens ≈ characters / 4**, always labelled « est. ».

## 1. Measure

Run exactly this script, with the number of days as the argument (replace it
with `7` if `$ARGUMENTS` is empty):

```bash
node -e '
const f=require("path").join(require("os").homedir(),".claude/state/ccx/compress-stats.jsonl");
const days=Number(process.argv[1])||7, since=Date.now()-days*864e5;
let rows=[];try{rows=require("fs").readFileSync(f,"utf8").split("\n").map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(r=>r&&Date.parse(r.ts)>=since)}catch{}
const t={n:rows.length,c:0,b:0,a:0},by={p:{},c:{}};
for(const r of rows){t.b+=r.before;t.a+=r.after;if(r.after<r.before)t.c++;for(const[k,v]of[["p",r.processor],["c",r.cmd]]){const e=by[k][v]||(by[k][v]={n:0,s:0});e.n++;e.s+=r.before-r.after}}
const top=o=>Object.entries(o).sort((x,y)=>y[1].s-x[1].s).slice(0,5).map(([k,v])=>`${k}: ${v.n} cmd, ~${Math.round(v.s/4)} tokens`);
console.log(JSON.stringify({jours:days,commandes:t.n,compressees:t.c,avant:t.b,apres:t.a,economie_pct:t.b?Math.round(100*(1-t.a/t.b)):0,tokens_economises_est:Math.round((t.b-t.a)/4),processeurs:top(by.p),commandes_top:top(by.c)},null,1))' 7
```

File missing or empty: say so, remind that compression is off in the
`minimal` profile, with `CCX_DISABLED=1` or `CCX_COMPRESS=off`, and stop there.

## 2. Report

```
Compression des sorties — 7 derniers jours
| Commandes enveloppées | Compressées | Avant → après (car.) | Économie | Tokens économisés (est.) |
|-----------------------|-------------|----------------------|----------|--------------------------|
| 214                   | 131         | 1 204 000 → 311 000  | 74 %     | ~223 000                 |
```

Then the script's two rankings (processors, commands), five lines max
each.

A command wrapped but not compressed (`après = avant`) had output that was
too short (under 2000 characters) or a gain below 20 %: this is not
an anomaly. Only flag a processor whose average gain is close to
zero over many calls: it costs a process without paying anything back.

End with: « Sortie brute d'une commande : la préfixer par `CCX_RAW=1`. »
