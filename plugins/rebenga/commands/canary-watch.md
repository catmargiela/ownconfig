---
description: Capture l'état observable d'un site en production puis le compare après un déploiement — statuts, assets, erreurs console, latence, éléments clés — et rend un verdict PASS/FAIL.
disable-model-invocation: true
argument-hint: "<url> [--baseline|--compare|--watch]"
---

Surveiller : `$ARGUMENTS` (mode par défaut : `--compare` s'il existe une
baseline, `--baseline` sinon).

`deploy-verify` prouve l'infra, la skill `prod-e2e` prouve les parcours. Ici on
vérifie ce que voit un visiteur, par comparaison avec l'état d'avant. Sans URL,
la demander et s'arrêter.

## Règles

- **Lecture seule** : GET et HEAD uniquement. Pas de formulaire, pas de POST,
  pas de connexion avec un vrai compte.
- Pas de test de charge : quelques requêtes par endpoint, séquentielles.
- Identifiants éventuels depuis des variables d'environnement, jamais tapés en
  ligne de commande ni écrits dans le fichier de baseline.

## Ce qu'on mesure

Les cibles se lisent dans `.claude/canary/<hôte>.json` si la baseline existe,
sinon se demandent (ou se déduisent de la page, puis se font valider) :

1. **Page** : statut HTTP, `content-type`, temps total
   (`curl -sS -o /dev/null -w '%{http_code} %{content_type} %{time_total}\n'`).
2. **Assets clés** : scripts et CSS hachés, polices, image principale — statut,
   `content-type`, taille.
3. **Endpoints** listés : latence médiane sur 3 appels.
4. **Console** : erreurs au chargement via Playwright s'il est installé dans le
   projet (`page.on('console')`, `pageerror`). Sinon, le noter « non mesuré ».
5. **DOM** : présence des sélecteurs clés (`h1`, `nav`, CTA, racine de l'app).

## `--baseline`

Capturer tout ce qui précède dans `.claude/canary/<hôte>.json` du projet
courant : date, commit déployé si connu, valeurs mesurées, cibles. Proposer
d'ajouter `.claude/canary/` au `.gitignore`. Refaire une baseline seulement sur
un état jugé sain.

## `--compare`

Mesurer à nouveau, comparer à la baseline :

| Contrôle | FAIL si |
|---|---|
| Page | statut différent de la baseline, ou ≥ 400 |
| Assets | un 4xx/5xx, ou `content-type` changé (JS servi en `text/html`) |
| Console | une erreur absente de la baseline |
| Latence | plus du double de la baseline sur un endpoint |
| DOM | un élément clé absent |

Une taille d'asset qui change est normale après un déploiement : l'afficher,
ne pas la compter en échec.

## `--watch`

Ne pas boucler ici. Proposer `/loop 5m /rebenga:canary-watch <url> --compare`
pendant la fenêtre à risque, avec arrêt au premier FAIL ou après une heure
(12 passages). Moins de 2 minutes d'intervalle n'apporte rien.

## Rapport

```
Canary : <hôte> — compare vs baseline du <date>
[✓] Page       200 text/html 0.41 s (baseline 0.38 s)
[✓] Assets     14/14 en 200, types inchangés
[✗] Console    1 nouvelle erreur : TypeError dans main-8c1d….js
[✓] Latence    /api/health 45 ms (baseline 40 ms)
[ ] DOM        non mesuré (Playwright absent)
Verdict : FAIL
```

Chaque ligne cite la mesure ; ce qui n'a pas été mesuré le dit.
