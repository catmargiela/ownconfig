---
description: Pose ou fait tourner un secret dans un .env sans que la valeur apparaisse jamais dans la conversation, l'historique shell ou la sortie d'un outil.
argument-hint: "<CLE> [fichier .env, vide = .env]"
---

Poser le secret `$ARGUMENTS`.

La valeur ne doit **jamais** passer par la conversation, un argument de
commande, l'historique shell ou la sortie d'un outil. Tu ne la vois pas, tu ne
la demandes pas en clair.

## 1. Valider l'entrée

- Clé : premier mot de `$ARGUMENTS`, conforme à `^[A-Z_][A-Z0-9_]*$`. Absente
  ou invalide : demander et s'arrêter.
- Fichier : second mot, sinon `.env`. Vérifier qu'il est ignoré par git
  (`git check-ignore`) ; sinon le signaler avant tout.
- Si l'utilisateur colle la valeur dans le chat : ne pas l'utiliser sans le
  prévenir qu'elle est désormais exposée et doit être révoquée puis régénérée.

## 2. Choisir la source

Demander d'où vient la valeur. La source écrit sur stdout, tu la branches
directement sur l'écriture, sans jamais l'afficher :

- `gh auth token` ;
- trousseau macOS : `security find-generic-password -s <service> -w` ;
- saisie : l'utilisateur lance lui-même, dans son terminal, la commande de
  l'étape 3 précédée de `read -rs VAL && printf '%s\n' "$VAL" |`.

## 3. Écrire sans écho

Sauvegarde, puis remplacement de la ligne (ou ajout), doublons retirés, saut de
ligne garanti, droits 600 :

```bash
cp -p "$F" "$F.bak-$(date +%Y%m%d%H%M%S)" && chmod 600 "$F".bak-*
<source> | ( umask 077; awk -v k="$KEY" '
  FILENAME == "-" { if (FNR == 1) v = $0; next }
  FNR == 1 && v == "" { exit 1 }
  $0 ~ "^" k "=" { if (!done) print k "=" v; done = 1; next }
  { print }
  END { if (v == "") exit 1; if (!done) print k "=" v }
' - "$F" > "$F.tmp" ) && chmod 600 "$F.tmp" && mv "$F.tmp" "$F" || rm -f "$F.tmp"
```

Valeur vide : rien n'est écrit. Avant de lancer, rapporter l'ancienne ligne
**masquée** : `KEY=<n caractères>` ou « absente ».

## 4. Vérifier, sans la valeur

```bash
awk -v k="$KEY" 'index($0, k "=") == 1 { n++; printf "ligne %d : %d caractères\n", NR, length($0) - length(k) - 1 } END { print n + 0 " occurrence(s)" }' "$F"
awk 'NF && $0 !~ /^[[:space:]]*#/ && index($0, "=") == 0 { print "ligne " NR " sans =" }' "$F"
```

Attendu : une occurrence, la longueur prévue, aucune ligne sans `=`, droits
600 (`stat -f %Lp` sur macOS, `stat -c %a` sur Linux). Si le service permet
d'éprouver le secret sans le passer en argument, le faire.

## .env distant

Même procédure par ssh : la valeur voyage **sur stdin**, jamais dans la ligne
de commande (visible dans `ps` et l'historique distant). Un tube et un heredoc
ne peuvent pas alimenter stdin à la fois : passer le script en argument, la
valeur par le tube — `<source> | ssh <hôte> '<script awk ci-dessus>'`.
Confirmer l'hôte avant d'écrire.

## Interdits

`cat`, `grep` ou `source` du fichier, `echo "$VAL"`, `set -x`, `>>` à l'aveugle.
Après écriture, `docker compose restart` ne relit pas l'`env_file` : il faut
`docker compose up -d <service>`, et seulement avec l'accord de l'utilisateur.
