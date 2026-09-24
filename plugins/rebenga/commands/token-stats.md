---
description: Bilan de la compression des sorties Bash — commandes compressées, caractères et tokens économisés, processeurs et commandes les plus rentables.
disable-model-invocation: true
argument-hint: "[jours, 7 par défaut]"
---

Résume ce qu'a économisé la compression des sorties Bash sur les `$ARGUMENTS`
derniers jours (7 si vide). Lecture seule : ne rien modifier, ne rien supprimer.

Source : `~/.claude/state/ccx/compress-stats.jsonl`, une ligne JSON par commande
passée par le wrapper — `ts`, `cmd` (deux premiers mots), `processor` (`node:git`,
`ts:kubectl`…), `engine` (`node`, `python` ou `none`), `before` et `after`
(en caractères), `exit`. Aucun contenu de sortie n'y est stocké.

Estimation : **tokens ≈ caractères / 4**, toujours étiquetée « est. ».

## 1. Mesurer

Lancer exactement ce script, avec le nombre de jours en argument (le remplacer
par `7` si `$ARGUMENTS` est vide) :

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

Fichier absent ou vide : le dire, rappeler que la compression est coupée en
profil `minimal`, avec `CCX_DISABLED=1` ou `CCX_COMPRESS=off`, et s'arrêter là.

## 2. Rapport

```
Compression des sorties — 7 derniers jours
| Commandes enveloppées | Compressées | Avant → après (car.) | Économie | Tokens économisés (est.) |
|-----------------------|-------------|----------------------|----------|--------------------------|
| 214                   | 131         | 1 204 000 → 311 000  | 74 %     | ~223 000                 |
```

Puis les deux classements du script (processeurs, commandes), cinq lignes max
chacun.

Une commande enveloppée mais non compressée (`après = avant`) avait une sortie
trop courte (moins de 2000 caractères) ou un gain inférieur à 20 % : ce n'est pas
une anomalie. Signaler seulement un processeur dont le gain moyen est proche de
zéro sur beaucoup d'appels : il coûte un process sans rien rapporter.

Terminer par : « Sortie brute d'une commande : la préfixer par `CCX_RAW=1`. »
