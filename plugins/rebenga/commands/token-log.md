---
description: Liste une par une les commandes Bash passées par la compression des sorties — date, commande, processeur, taille avant/après, gain.
disable-model-invocation: true
argument-hint: "[jours, 7 par défaut] [--toutes]"
---

Liste les commandes Bash compressées pendant la période demandée : `$ARGUMENTS`.
Lecture seule : ne rien modifier, ne rien supprimer.

Source : `~/.claude/state/ccx/compress-stats.jsonl`, une ligne JSON par commande
passée par le wrapper — `ts`, `cmd` (deux premiers mots seulement, jamais les
arguments : un argument peut contenir un secret), `processor` (`node:git`,
`ts:kubectl`…), `engine` (`node`, `python` ou `none`), `before` et `after`
(en caractères), `exit`.

Arguments :
- un nombre : la période en jours (7 si absent) ;
- `--toutes` : inclure aussi les commandes enveloppées mais rendues brutes
  (sortie de moins de 2000 caractères ou gain inférieur à 20 %).

## 1. Lister

Lancer exactement ce script, en lui passant les arguments tels quels
(`$ARGUMENTS`, éventuellement vide) :

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

Fichier absent ou vide : le dire, rappeler que la compression est coupée en
profil `minimal`, avec `CCX_DISABLED=1` ou `CCX_COMPRESS=off`, et s'arrêter là.

## 2. Afficher

Rendre la liste en tableau, de la plus récente à la plus ancienne :

```
Commandes compressées — 7 derniers jours (3 sur 7 enveloppées)
| Quand       | Commande | Processeur | Avant → après (car.) | Gain | Statut     | Exit |
|-------------|----------|------------|----------------------|------|------------|------|
| 23/09 15:12 | git log  | git        | 15 611 → 1 564       | 90 % | compressée | 0    |
```

Au-delà de 50 lignes, afficher les 50 plus récentes et dire combien sont
masquées. Ne rien interpréter de plus : pour les totaux et les classements,
renvoyer vers `/rebenga:token-stats`.

Terminer par : « Sortie brute d'une commande : la préfixer par `CCX_RAW=1`. »
