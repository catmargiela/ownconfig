---
description: Sets or rotates a secret in a .env without the value ever appearing in the conversation, the shell history or a tool's output.
disable-model-invocation: true
argument-hint: "<KEY> [.env file, empty = .env]"
---

Reply to the user in French.

Set the secret `$ARGUMENTS`.

The value must **never** go through the conversation, a command argument, the
shell history or a tool's output. You do not see it, you do not ask for it in
plain text.

## 1. Validate the input

- Key: first word of `$ARGUMENTS`, matching `^[A-Z_][A-Z0-9_]*$`. Missing
  or invalid: ask and stop.
- File: second word, else `.env`. Check that git ignores it
  (`git check-ignore`); otherwise flag it before anything else.
- If the user pastes the value into the chat: do not use it without warning
  them that it is now exposed and must be revoked then regenerated.

## 2. Choose the source

Ask where the value comes from. The source writes to stdout; you pipe it
straight into the write, without ever printing it:

- `gh auth token`;
- macOS keychain: `security find-generic-password -s <service> -w`;
- manual entry: the user runs, in their own terminal, the command from
  step 3 prefixed with `read -rs VAL && printf '%s\n' "$VAL" |`.

## 3. Write without echo

Backup, then replace the line (or append it), duplicates removed, trailing
newline guaranteed, mode 600:

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

Empty value: nothing is written. Before running, report the old line
**masked**: `KEY=<n caractères>` or « absente ».

## 4. Verify, without the value

```bash
awk -v k="$KEY" 'index($0, k "=") == 1 { n++; printf "ligne %d : %d caractères\n", NR, length($0) - length(k) - 1 } END { print n + 0 " occurrence(s)" }' "$F"
awk 'NF && $0 !~ /^[[:space:]]*#/ && index($0, "=") == 0 { print "ligne " NR " sans =" }' "$F"
```

Expected: one occurrence, the expected length, no line without `=`, mode
600 (`stat -f %Lp` on macOS, `stat -c %a` on Linux). If the service lets you
test the secret without passing it as an argument, do so.

## Remote .env

Same procedure over ssh: the value travels **on stdin**, never on the command
line (visible in `ps` and the remote history). A pipe and a heredoc cannot
both feed stdin: pass the script as an argument, the value through the pipe —
`<source> | ssh <hôte> '<script awk ci-dessus>'`.
Confirm the host before writing.

## Forbidden

`cat`, `grep` or `source` of the file, `echo "$VAL"`, `set -x`, blind `>>`.
After writing, `docker compose restart` does not re-read the `env_file`: you
need `docker compose up -d <service>`, and only with the user's consent.
