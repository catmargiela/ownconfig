---
name: iterative-retrieval
description: Delegate to subagents without dumping all the context on them — minimal task and pointers, then the agent reports what it is missing in a fixed section, and you relaunch in 2 or 3 rounds at most. Use when delegating to agents, especially in a parallel batch (issues, reviews, explorations), or when the main context is saturating.
---

# On-demand context for subagents

Reply to the user in French.

Pasting everything into a subagent's prompt costs twice: you reread the files
here to pass them on, and you pay for them on every following turn. And most
of the time, you guess wrong about what it needs. Better to give it the
minimum and let it say what it is missing.

## First send: task + pointers

- **The task** and its done criterion, in two or three sentences.
- **Pointers, not content**: paths, function names, issue number, test
  command. The agent reads for itself.
- **Decisions already made** that it cannot guess ("keep the v1 API", "no new
  dependency"), one line each.
- **The return format**, with the mandatory « Manque » section.

No conversation history, no copied files, no list of conventions it will find
in the project's `CLAUDE.md`.

## The « Manque » section

Append as is to the end of the prompt:

```
Termine par une section « ## Manque », même vide :
- Fichiers : chemins que tu n'as pas trouvés ou pas pu lire.
- Décisions : choix que tu ne peux pas trancher seul, avec les options.
- Conventions : règle du projet ambiguë ou contradictoire.
Pour chaque ligne, dis ce qui bloque et ce que tu as fait en attendant.
N'invente pas pour combler un manque : signale-le.
```

## Loop

1. **Send** the first prompt (in parallel for a batch).
2. **Read the Manque section** before the rest. Empty and coherent work: done.
3. **Answer only the gap**: settle the decision, give the path, cite the
   convention. Relaunch the same agent (SendMessage keeps its context) rather
   than a new one that would start from scratch.
4. **Two or three rounds at most.** At the third gap on the same point, the
   task is badly split or it is a question for the user: take back control,
   do not relaunch.

Also stop when the gap is a "nice to have" (one more file would be pleasant):
the result is enough, do not reopen.

## In a parallel batch

- A gap shared by several agents (same unclear convention) is settled once and
  sent to all of them in the same message.
- An agent asking for another batch's files signals a bad split: merge the two
  batches, do not share on the sly.

## What it saves

The main context keeps only conclusions and a few gap lines, not the files
read by each agent. On a batch of five agents, it is the difference between
orchestrating to the end and saturating the window before integration.
