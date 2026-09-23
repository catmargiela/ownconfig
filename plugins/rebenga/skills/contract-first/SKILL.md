---
name: contract-first
description: Garder le contrat d'une API aligné entre un fournisseur (API Go, types sqlc) et plusieurs clients (front Next.js, app desktop Tauri). À utiliser avant de modifier un endpoint, un payload, un champ de réponse ou un type partagé, ou quand un client casse après un changement côté API.
---

# Contrat d'abord

Un endpoint a un fournisseur et plusieurs lecteurs. Renommer un champ côté Go
compile, passe les tests Go, et casse le front et le desktop en silence. On
traite donc le contrat comme une interface publique : on le localise, on liste
ses lecteurs, et on les change ensemble.

## 1. Localiser la source du contrat

Dans cet ordre, la première trouvée fait foi :

1. Un schéma versionné : `openapi.yaml`, `api/*.json`, JSON Schema.
2. Sinon, les structs de requête et de réponse du handler Go, avec leurs tags
   `json:"…"` et `omitempty`. Un type sqlc exposé tel quel **est** le contrat,
   y compris ses `sql.NullString` et `pgtype.*` qui changent la sérialisation.

Si des types clients sont générés depuis le schéma, noter la commande de
génération : elle fait partie du changement.

## 2. Lister les consommateurs

Pour chaque client (front Next.js, app Tauri, script, autre service) :
`grep -rn` sur la route (`/api/v1/orders`) **et** sur chaque champ touché, en
camelCase comme en snake_case. Côté Tauri, regarder aussi les structs `serde`
en Rust et les appels `invoke` qui relaient la réponse. Un client non listé est
un client qu'on cassera.

## 3. Classer le changement

| Changement | Nature |
|---|---|
| Nouveau champ optionnel, nouvel endpoint | additif |
| Nouveau champ requis en entrée | cassant |
| Renommage, suppression | cassant |
| Type changé (`int` → `string`, date en epoch → ISO) | cassant |
| Nullabilité : un champ peut devenir `null` ou disparaître (`omitempty`) | cassant |
| Nouvelle valeur d'enum | cassant pour un client qui fait un `switch` exhaustif |

Un changement cassant : soit une version (`/v2`, nouveau champ à côté de
l'ancien, dépréciation datée), soit une mise à jour coordonnée de tous les
clients **livrés ensemble**. Une app desktop déjà installée ne se met pas à
jour avec le serveur : pour Tauri, l'ancien contrat doit survivre jusqu'à ce que
la version minimale supportée l'abandonne.

## 4. Changer tout le monde dans le même lot

Fournisseur et chaque consommateur dans le même change set. Puis prouver,
chaque côté, par sa commande : `go build ./... && go test ./...`, `tsc --noEmit`
et le build Next, `cargo check` et le typecheck du front Tauri. Quand c'est
faisable, ajouter un test de contrat : un test Go qui sérialise la réponse et
la compare à un fixture JSON, que les clients réutilisent dans leurs tests.

## Sortie

```
| Champ          | Fournisseur (Go)        | Front Next         | Desktop Tauri      | Statut   |
|----------------|-------------------------|--------------------|--------------------|----------|
| order.total    | int64 cents → string    | formatPrice() mis à jour | struct serde mise à jour | cassant, coordonné |
| order.note     | nouveau, omitempty      | non lu             | non lu             | additif  |
| order.status   | + valeur "refunded"     | switch complété    | ⚠ match non exhaustif | bloquant |
```

Puis les commandes lancées de chaque côté et leur sortie. Une ligne bloquante
ou un côté non vérifié se dit, il ne se tait pas.
