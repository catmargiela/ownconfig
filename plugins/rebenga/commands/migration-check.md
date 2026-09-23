---
description: Vérifie les migrations SQL du diff — contrôles statiques, essai à blanc en transaction annulée, régénération sqlc, build et vet Go.
argument-hint: "[fichier de migration, vide = migrations du diff]"
---

Vérifier les migrations. Cible : `$ARGUMENTS`

Une migration fautive empêche souvent l'API de démarrer : c'est tout le service
qui tombe, pas une fonctionnalité. Chaque étape rapporte sa sortie.

## 1. Périmètre

Trouver le dossier des migrations et l'outil (`goose` dans le `Makefile`, le
`go.mod` ou le code ; `schema:` dans `sqlc.yaml`). Si `$ARGUMENTS` est vide :
fichiers nouveaux ou modifiés de ce dossier dans `git status --porcelain` et
`git diff --name-only HEAD`. Aucun : le dire et s'arrêter.

## 2. Contrôles statiques

Pour chaque fichier, citer `fichier:ligne` à chaque défaut :

- **Pas de `;` dans un commentaire.** goose découpe sur les points-virgules sans
  reconnaître les commentaires : un `;` dans une prose coupe l'instruction en
  deux. `psql` sait lire un commentaire, donc l'essai en 3 **ne détecte pas**
  ce défaut. Préférer `--` à `/* */`.
- `-- +goose Up` et `-- +goose Down` présents ; `Down` défait réellement `Up`.
- Corps `$$ … $$` (fonctions, `DO`) entourés de `-- +goose StatementBegin` /
  `StatementEnd`.
- `AND` et `OR` mêlés : parenthésés. Même vigilance pour `||` à côté d'un
  opérateur comme `~*`, dont la précédence surprend.
- `-- +goose NO TRANSACTION` ou `CREATE INDEX CONCURRENTLY` : l'essai en
  transaction est impossible, le signaler au lieu de le tenter.

## 3. Essai à blanc, toujours annulé

Base **de développement** par défaut, trouvée dans `.env.example`, le compose ou
le `CLAUDE.md`, DSN lu depuis l'environnement, jamais affiché. Production :
seulement si l'utilisateur le demande explicitement, et le même essai annulé.

Extraire la section `Up`, l'envelopper et la passer **par stdin**, jamais en
argument entre guillemets doubles (`$$` y devient le PID du shell) :

```bash
{ echo 'BEGIN;'; sed -n '/+goose Up/,/+goose Down/p' fichier.sql; echo 'ROLLBACK;'; } \
  | psql -v ON_ERROR_STOP=1 "$DATABASE_URL"
```

Rejouer ensuite `Up` puis `Down` dans une même transaction annulée. Jamais de
`COMMIT`, jamais `goose up` contre la production depuis ici. La dernière ligne
de sortie doit être `ROLLBACK`.

## 4. Code généré et compilation

- sqlc présent : `make sqlc` si la cible existe, sinon `sqlc generate`, puis
  `git status --short` pour montrer ce qui a changé.
- `go build ./...` puis `go vet ./...` dans le module Go.

Ces étapes ne voient ni la précédence des opérateurs ni le découpage goose :
elles complètent l'essai, elles ne le remplacent pas.

## Rapport

```
00043_add_status.sql
[✓] Statique      Up/Down, aucun ; en commentaire
[✓] Essai (dev)   BEGIN … ROLLBACK, 0 erreur
[✓] sqlc          2 fichiers régénérés
[✗] go vet        internal/orders/store.go:88 — …
```

Étape sautée ou impossible : le dire, avec la raison.
