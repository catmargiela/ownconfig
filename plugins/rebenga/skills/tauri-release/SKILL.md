---
name: tauri-release
description: Publier une version d'une app de bureau Tauri v2 (macOS, Windows) via GitHub Actions et tauri-action, updater compris. À utiliser quand l'utilisateur dit « sors une version », « publie la release », « tag la v… », ou quand une release Tauri a échoué.
---

# Release Tauri v2

Une release ratée coûte cher : les runners macOS sont lents et facturés, et un
job « vert » peut ne publier aucun fichier. On ne l'annonce qu'après avoir vu
les fichiers sur la release et un `latest.json` valide.

## 1. Avant le tag

- **Relecture** : lancer `rebenga:rust-tauri-reviewer` sur le diff depuis le
  dernier tag (`git diff <dernier-tag>..HEAD`). Pas de tag avec un CRITIQUE ouvert.
- **Version cohérente partout** : `tauri.conf.json` (`version`),
  `src-tauri/Cargo.toml`, `package.json`, et `Cargo.lock` régénéré. Grep la
  nouvelle version : elle doit apparaître dans chacun, identique.
- **Secrets** : `gh secret list` doit montrer la clé de signature de l'updater
  et son mot de passe (noms attendus par le workflow, souvent
  `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), plus
  ceux de signature Apple/Windows s'ils sont utilisés. Ne jamais lire ni
  afficher une valeur. Rappeler que la clé privée doit être sauvegardée hors de
  la machine : la perdre, c'est ne plus pouvoir mettre à jour les installations.
- **Updater** : `plugins.updater.pubkey` non vide, `endpoints` qui pointent vers
  l'URL réellement servie, `bundle.createUpdaterArtifacts` actif, et
  `uploadUpdaterJson` non désactivé dans le workflow.

## 2. Le workflow

Lire `.github/workflows/*.yml` en entier avant de taguer :

- Déclencheur : quel motif de tag (`v*`…) et sur quelle branche.
- Windows : les runners démarrent sous PowerShell. Toute étape écrite en bash
  doit porter `shell: bash`, sinon `ParserError` — souvent après que macOS a
  déjà été construit.
- Release : si un job crée le brouillon, passer son id à tauri-action via
  `releaseId` en sortie de job, ne pas le rechercher dans la liste des releases
  (le brouillon peut ne pas y être encore). Un `releaseId` vide fait sauter
  tous les uploads et le job finit quand même en succès.
- Plusieurs jobs qui écrivent le même `latest.json` : les sérialiser
  (`max-parallel: 1`) ou le fusionner dans un job final.
- Dépôt privé : les URL de `latest.json` pointent vers l'API des assets, pas vers
  un lien public nommé. Vérifier que ce qui sert l'updater sait les résoudre.

## 3. Taguer et surveiller

1. Montrer à l'utilisateur la version, le tag et le commit ; attendre son accord.
2. `git tag v<x.y.z> && git push origin v<x.y.z>`.
3. `gh run list --workflow <fichier> -L 1`, puis `gh run watch <id> --exit-status`.
4. `gh release view v<x.y.z> --json assets,isDraft` : un installeur, une archive
   d'update et une signature `.sig` par plateforme, et `latest.json`.
5. Télécharger `latest.json` (`gh release download v<x.y.z> -p latest.json`) :
   bonne version, une entrée par plateforme, `signature` non vide.

## Retour arrière

- Run en échec avant upload : corriger, supprimer le tag local et distant
  (`git push origin :refs/tags/v<x.y.z>`), le brouillon s'il existe, retaguer.
- Version publiée défectueuse : ne pas supprimer une release déjà servie ; en
  publier une supérieure. Un updater ne redescend pas de version.

## Rapport

Version, lien du run, liste des assets vus, contenu vérifié de `latest.json`,
et ce qui n'a pas été vérifié (installation réelle sur chaque système).
