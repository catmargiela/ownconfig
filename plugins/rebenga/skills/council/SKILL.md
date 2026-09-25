---
name: council
description: Weigh an ambiguous decision (architecture, library, scope, ship or hold) through three independent subagents — Skeptic, Pragmatist, Critic — when the user says « j'hésite entre », "which option" or « aide-moi à trancher ».
---

# Council

Reply to the user in French.

For decisions with several credible paths: architecture choice, library pick,
scope trade-off, ship or hold. Not for code review (use `/rebenga:dual-review`),
not for factual questions. The goal is visible disagreement, not unanimity.

## 1. Frame the question

One sentence: what is being decided, between which options, under which
constraints (deadline, solo dev, budget, existing stack), what counts as
success. If it stays vague, ask the user one question before convening.

## 2. State your prior first

Before launching anyone, write your own recommendation and its main risk. It
is shown in the synthesis, so the answer cannot quietly mirror the council.

## 3. Launch three fresh subagents in parallel

One message, three calls. Each gets **only** the question, the constraints and
the facts needed: no conversation history, no hint of which option anyone
favours. Prompt shape:

```
You are the [ROLE] on a decision council. Question: [...]
Constraints: [...]  Facts: [...]
Return: 1. Recommendation  2. Top 3 reasons  3. What would change your mind
4. Confidence (low/medium/high). Direct, under 250 words.
```

| Role | Lens |
|---|---|
| Skeptic | what breaks, hidden costs, what we would regret in six months |
| Pragmatist | simplest option that works for a solo dev, time and maintenance cost |
| Critic | attacks the currently favoured option, argues the best alternative |

## 4. Synthesize

- Say whether your prior changed, and which argument moved it. A split
  council is reported as split, never as consensus.
- Keep the strongest dissent, even when you reject it, with the reason.
- The recommendation names its deciding factor. The user decides.

## Output

```
## Conseil : [décision en quelques mots]

**Mon avis avant le conseil :** [option] — [raison, risque principal]

| Voix | Recommandation | Raison clé | Changerait d'avis si | Confiance |
|---|---|---|---|---|
| Sceptique | … | … | … | … |
| Pragmatique | … | … | … | … |
| Critique | … | … | … | … |

- **Accord :** [ce que les trois partagent]
- **Désaccord réel :** [le point qui divise, sans le lisser]
- **Recommandation :** [option] — facteur décisif : [...]
- **Mon avis a-t-il changé ?** [oui/non, pourquoi]
- **À vérifier avant de s'engager :** [mesure, test, doc à lire]

À toi de trancher.
```
