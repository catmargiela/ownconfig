---
description: Déploie avec le script du projet après accord, puis prouve par la sortie des commandes que services, migrations, santé, proxy, bundle et .env sont bons.
disable-model-invocation: true
argument-hint: "[environnement, vide = production]"
---

Déployer et vérifier. Environnement : `$ARGUMENTS` (vide = production).

Un déploiement n'est fini que quand chaque ligne de la checklist a une preuve :
une commande exécutée et sa sortie. Rien de ce qui suit n'est codé en dur, tout
se **découvre** dans le projet ou se demande.

## 1. Découvrir

Lire, sans rien lancer : `CLAUDE.md` et `.claude/` du projet, le script de
déploiement (`deploy.sh`, `deploy/`, cible `deploy` du `Makefile`), les
`docker-compose*.yml`, `.env.example`. En tirer :

- la commande de déploiement et l'hôte cible (alias ssh, jamais une IP recopiée) ;
- le fichier compose et le projet compose utilisés en production ;
- les services attendus : `docker compose -f <fichier> config --services`
  (**jamais** `config` seul, qui imprime les variables résolues) ;
- les services censés avoir un `healthcheck` ;
- l'URL de santé (`/health`, `/healthz`, `/status`…) dans le `CLAUDE.md` ou le
  routeur ; le dossier des migrations et l'outil (goose ou autre) ;
- le conteneur du reverse proxy et le chemin de sa config.

Ce qui manque ou reste ambigu : le demander. Ne pas deviner un hôte.

## 2. Confirmer

Déployer est une action visible de l'extérieur. Montrer la commande exacte,
l'hôte, le commit (`git log -1 --oneline`) et ce qui n'est pas poussé, puis
**attendre un oui explicite**. Sans oui, s'arrêter là.

## 3. Déployer

Lancer le script tel quel et garder la sortie entière. Échec : s'arrêter,
montrer l'erreur, ne rien relancer ni corriger sur le serveur.

## 4. Vérifier, dans l'ordre, arrêt au premier rouge

1. **Services** : `docker compose ps --format '{{.Service}} {{.State}} {{.Health}}'`
   sur l'hôte. Nombre de services `running` = nombre attendu en 1 ; chaque
   service à healthcheck est `healthy` (attendre `starting` sans `sleep` fixe :
   boucle bornée ou Monitor). Si d'autres projets partagent l'hôte, vérifier
   qu'ils tournent toujours.
2. **Migrations** : version appliquée = plus haut numéro du dossier. Avec goose,
   `goose status` si le DSN est déjà dans l'environnement du conteneur, sinon
   `SELECT max(version_id) FROM goose_db_version WHERE is_applied` via `psql`
   dans le conteneur de base, SQL entre guillemets simples. Ne jamais taper un
   DSN avec mot de passe en ligne de commande.
3. **Santé** : `curl -sS -o /dev/null -w '%{http_code}\n' <url>` → 200. Pour une
   route neuve protégée, 401 contre 404 sur un chemin inventé prouve qu'elle
   existe.
4. **Proxy** : validation dans son conteneur, par exemple
   `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`.
5. **Bundle servi** : `curl -sS --compressed <url>/` et comparer les noms hachés
   des scripts (ou le build ID) à ceux du build local qui vient d'être déployé ;
   ou l'`ETag` avant/après. Même hash qu'avant = l'ancien front est encore servi.
6. **`.env`** : lignes sans `=`, **sans jamais afficher de valeur** :
   `awk 'NF && $0 !~ /^[[:space:]]*#/ && index($0, "=") == 0 { print NR }' .env`
   → numéros de ligne seulement. Une telle ligne fait refuser le fichier par
   `docker compose` au prochain démarrage. Pour les clés : `cut -d= -f1`.

## Interdits en production

Aucune commande destructive : pas de `down -v`, `rm`, `prune`, `DROP`,
`DELETE`, `TRUNCATE`, pas de `goose down`, pas d'écriture en base. Pas de
correctif à chaud sur le serveur. Au premier rouge : arrêter, rapporter,
proposer — ne pas réparer sans accord.

## Rapport

```
Déploiement : production — a1b2c3d (exit 0)
[✓] Services     7/7 running, 3/3 healthy
[✓] Migrations   version 42 = dernier fichier 00042_add_index.sql
[✓] Santé        GET /healthz → 200
[✓] Proxy        caddy validate → "Valid configuration"
[✗] Bundle       main-3f9a… servi, main-8c1d… attendu → arrêt
[ ] .env         non vérifié (arrêt avant)
```

Chaque ✓ cite la sortie qui le prouve ; chaque ligne non vérifiée le dit.
