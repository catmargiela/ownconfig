---
name: mirror-sync
description: Garder synchronisé un module ou un front dupliqué dans deux dépôts (par exemple une app web et son app de bureau). À utiliser quand un patch doit être « reporté de l'autre côté », quand l'utilisateur parle de miroir, de copie ou de deux fronts à garder alignés.
---

# Synchroniser un miroir

Un front copié dans deux dépôts dérive en silence : chaque patch appliqué à la
main d'un seul côté crée une divergence que personne n'a décidée. Le but est de
séparer les différences **voulues** (propres à une plateforme) de la **dérive**.

## 1. Trouver la paire

- Lire le `CLAUDE.md` de chaque dépôt : chercher une section « miroir » qui donne
  les deux racines (`<dépôt A>/<chemin>` ↔ `<dépôt B>/<chemin>`) et la liste des
  divergences voulues.
- Rien de documenté : demander les deux chemins à l'utilisateur. Ne pas deviner
  une correspondance à partir de noms de dossiers ressemblants.

## 2. Mesurer l'écart

- `diff -rq <A> <B>` pour la liste des fichiers différents ou absents d'un côté,
  puis `git diff --no-index <A>/<f> <B>/<f>` fichier par fichier.
- Exclure le bruit : `node_modules`, sorties de build, fichiers générés.
- Classer chaque divergence :
  - **voulue** — code propre à la plateforme (API native, routage, liens,
    stockage), ou listée comme telle dans le `CLAUDE.md` ;
  - **dérive** — un correctif présent d'un seul côté, un fichier en retard ;
  - **incertaine** — la montrer à l'utilisateur, ne pas trancher seul.

## 3. Reporter un patch

1. Faire le changement d'un côté, le committer ou le mettre en patch :
   `git format-patch -1 <sha> --relative=<chemin A>` ou `git diff > x.patch`.
2. L'appliquer de l'autre côté en remappant le chemin :
   `git apply --directory=<chemin B> --3way x.patch` (ou `-p<n>` si besoin).
   `--check` d'abord pour voir ce qui ne s'applique pas.
3. Un rejet sur un fichier à divergence voulue : reporter l'intention à la main
   en préservant la partie propre à la plateforme, puis montrer le résultat.
4. Lancer le typecheck et le build **de chaque dépôt**, avec ses propres scripts
   (`package.json`, `Cargo.toml`…). Un côté vert ne prouve rien pour l'autre.
5. Relancer le `diff -rq` : il ne doit rester que les divergences voulues.

## Interdits

- Écraser un fichier de l'autre côté par copie brute quand il contient une
  divergence voulue, sans l'accord de l'utilisateur.
- Aligner une dérive « dans le mauvais sens » sans vérifier quel côté porte le
  correctif le plus récent (`git log -p` sur le fichier dans chaque dépôt).
- Annoncer les deux côtés synchronisés sans les deux builds verts.

## Pérenniser

Proposer d'écrire dans le `CLAUDE.md` du projet une section « miroir » : les deux
racines, la liste des fichiers à divergence voulue et pourquoi, et la commande
de diff à relancer. La prochaine session n'aura plus à redécouvrir la paire.

## Rapport

Fichiers alignés, divergences voulues conservées, dérives corrigées (avec le
sens), incertaines en attente, et la sortie des deux builds.
