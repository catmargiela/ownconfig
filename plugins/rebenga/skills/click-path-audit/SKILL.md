---
name: click-path-audit
description: Trace each interactive element of a screen through handlers and state to find actions undone by others. Use when the user says « ce bouton ne marche pas » ("this button does nothing"), state resets, or after a store refactor.
---

# Click-path audit

Reply to the user in French.

Some UI bugs survive every usual check: the handler exists, each call works on
its own, nothing throws, the types line up. Yet the button does nothing,
because a later call, a store side effect or an effect silently undoes the
first one. This audit follows each click to its final state. It is
**read-only**: no code change, no app launch unless the user asks.

## 1. Scope

One screen, one component or one button, named by the user. For a whole app,
split per screen and delegate (see `rebenga:iterative-retrieval`), with the
state map of step 2 shared first.

## 2. Map who sets and who resets each piece of state

Before any handler, read every state source the screen touches: Zustand
stores, React contexts, React Query keys, local `useState`. For each action:

```
store: useLeadStore
  selectLead(id)   sets {selectedId, detail}  RESETS {editMode:false, draft:null}
  setEditMode(b)   sets {editMode}
query: ['leads', filters]  invalidated by createLead, updateLead
```

Flag every action that resets a field it does not own: that is where hidden
undos come from.

## 3. Trace each interactive element

List every button, link, toggle, form submit, keyboard shortcut and menu item.
For each, follow the handler **in call order**, down through custom hooks:
store setters, `mutate`/`fetch` to the Go API, `router.push`, `invalidateQueries`,
Tauri `invoke`, toasts, `useEffect`s triggered by what it changes. Compare the
final state with what the element's label promises.

## 4. What to flag

| Pattern | Sign |
|---|---|
| Sequential undo | call B resets what call A just set (store side effect) |
| Effect interference | a `useEffect` watching the changed value sets it back, or re-fetches |
| Refetch over optimistic state | `invalidateQueries`/refetch lands before the mutation commits, or `onSettled` overwrites the optimistic value with stale data |
| Stale closure | handler or `useCallback` reads an old value (missing dependency, `setX(x + 1)` twice) |
| Async race | two requests resolve out of order; the last write wins, not the latest intent |
| Double submit | no guard on `isPending`, button still enabled, Enter key submits twice, no idempotency key on the API |
| Missing loading/disabled | no feedback during the request, the user clicks again |
| Half-updated error path | store updated before the API call and not rolled back in `catch`/`onError`; modal closed before success |
| Dead or missing transition | condition always false at that point; label says "Enregistrer" but nothing is sent |

Each finding needs proof: the `file:line` of the call that sets and of the one
that undoes. A suspicion without a line is labelled « à confirmer », with the
check that would settle it (a log, a test, a React Query Devtools look).

## 5. After the audit

Every confirmed bug deserves a failing test before the fix
(`rebenga:tdd-workflow`). Propose fixes, do not apply them without a yes.

## Output

```
Audit : écran Fiche client (app/clients/[id]/page.tsx) — 9 éléments, 3 problèmes

| Élément            | Chemin d'appel                                   | État modifié                 | Problème                                   | Preuve |
|--------------------|--------------------------------------------------|------------------------------|--------------------------------------------|--------|
| « Modifier »       | setEditMode(true) → selectLead(id)               | editMode true → false        | selectLead réinitialise editMode           | lead-store.ts:42, LeadHeader.tsx:88 |
| « Enregistrer »    | updateLead.mutate → onSuccess invalidate(['lead'])| detail                       | bouton actif pendant la requête, double envoi | LeadForm.tsx:131 |
| « Supprimer »      | setLeads(filtré) → DELETE /leads/:id              | leads                        | pas de retour arrière si l'API échoue       | useLeads.ts:57 |
| « Exporter »       | invoke('export_csv')                             | —                            | aucun                                      | ExportButton.tsx:12 |
```

Then the state map of step 2 for the fields involved, and the points left
« à confirmer ». An element not traced is listed as such, never left out.
