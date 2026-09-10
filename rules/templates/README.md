# Modèles de règles par projet

À copier dans `<projet>/.claude/rules/`, jamais dans `~/.claude/`.

Une règle globale est chargée à **chaque** session, sur tous les projets. Une
règle Solidity en global se paie sur chaque site vitrine. Le critère est simple :
si la règle ne s'applique pas à tous les projets, elle est locale.

La skill `project-onboarding` génère le `CLAUDE.md` d'un projet ; ces modèles
complètent quand le projet impose un langage absent de la configuration globale.
