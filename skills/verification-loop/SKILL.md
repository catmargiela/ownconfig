---
name: verification-loop
description: Séquence de vérification à passer avant d'annoncer qu'un travail est terminé, avant d'ouvrir une PR, ou avant un déploiement. À utiliser quand on s'apprête à dire "c'est fait", "ça marche" ou "prêt à merger".
---

# Boucle de vérification

« Ça marche » est une affirmation qui exige une commande exécutée et sa sortie.
Cette skill fournit la séquence, dans l'ordre où elle coûte le moins cher.

## Ordre

L'ordre n'est pas arbitraire : chaque étape est plus lente que la précédente, et
échouer tôt évite de payer les suivantes. **S'arrêter à la première étape rouge**
et la corriger avant de continuer.

### 1. Le code compile

```bash
# détecter le gestionnaire de paquets d'abord : lockfile présent
npm run build 2>&1 | tail -30
```

### 2. Les types sont corrects

```bash
npx --no-install tsc --noEmit 2>&1 | head -30
```

Une erreur de type n'est pas cosmétique. Elle se corrige à la source — jamais par
`any`, `as`, `@ts-ignore` ou un assouplissement de `tsconfig.json`.

### 3. Le lint passe

```bash
npm run lint 2>&1 | head -30
```

Corriger le code, pas la règle.

### 4. Les tests passent

```bash
npm test 2>&1 | tail -40
```

Rapporter les chiffres réels : X passés, Y échoués. Un test ignoré (`skip`) se
signale, il ne se comptabilise pas comme un succès.

### 5. Rien de sensible ne part avec

```bash
git diff --staged --name-only
git diff --staged | grep -nEi '(api[_-]?key|secret|password|token|BEGIN.*PRIVATE KEY)[\"'"'"']?\s*[:=]' || echo "aucun secret apparent"
```

Vérifier aussi qu'aucun `.env`, dump de base ou fichier de credentials n'est
dans le diff.

### 6. Le comportement, pas seulement la chaîne d'outils

Les cinq étapes précédentes prouvent que le code est bien formé, pas qu'il fait
ce qui était demandé. Relire la demande initiale et vérifier le chemin utilisateur
concerné — en lançant l'application si c'est faisable.

## Rapport

Annoncer le résultat par étape, avec les vrais chiffres :

```
build ✓  types ✓  lint ✓  tests 42/42 ✓  secrets ✓
Comportement vérifié : upload d'un fichier > 5 Mo rejeté avec le message attendu.
```

Toute étape non exécutée se déclare comme non exécutée. Ne jamais présenter une
étape sautée comme un succès — c'est le seul manquement qui rend tout le reste
inutilisable.
