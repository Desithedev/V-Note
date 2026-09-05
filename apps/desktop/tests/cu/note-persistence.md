---
id: cu.note-persistence
kind: computer-use
priority: smoke
app_target: /Users/nchopra/go/src/github.com/Desithedev/V-Note/node_modules/electron/dist/Electron.app
start_route: /home
---

# Note Persistence

## Purpose

Verify that a note created and edited through the real V-Note Electron UI persists after navigating away and returning.

## Preconditions

- V-Note is already running from this repository with `pnpm dev`.
- Use `app_target` exactly. Do not attach to generic `Electron`.
- Treat `localhost:5173/#/...` as the expected Electron dev renderer URL.
- Do not delete existing notes or change settings.

## Test Data

- Title: `CU persistence test <ISO timestamp>`
- Body: `This body was entered through Computer Use to verify save persistence after navigation.`

## Steps

1. Attach Computer Use to `app_target`.
2. Assert the V-Note app window is visible.
3. Navigate to Home if not already there.
4. Click `+ Note`.
5. Assert the new note editor is visible.
6. Replace the note title with the test title.
7. Enter the test body in the editor.
8. Wait at least 1 second for debounced save.
9. Navigate to Home.
10. Assert the note appears in the Home note list with the test title.
11. Reopen the note from the Home note list.
12. Assert the title still matches the test title.
13. Assert the body still matches the test body.

## Assertions

- The app target is the V-Note Electron app path, not another Electron process.
- The note editor opens after `+ Note`.
- The title appears on Home after navigating away.
- The reopened note shows the same title.
- The reopened note shows the same body.
- No blank renderer is visible at the end of the scenario.

## Optional Evidence

If UI evidence is ambiguous, inspect the local dev database:

```bash
sqlite3 apps/desktop/v-note.db "select id,title,updated_at from notes order by id desc limit 5;"
```

For editor body persistence, check that the newest note has Yjs updates:

```bash
sqlite3 apps/desktop/v-note.db "select note_id, length(update_data) from yjs_updates order by id desc limit 5;"
```

## Report Format

```md
## CU Test Report: cu.note-persistence

Status: PASS | FAIL | BLOCKED
App target: <path used>
Started at: <timestamp>
Finished at: <timestamp>

### Evidence
- <short UI assertion/evidence>
- <short optional database/log evidence>

### Failures
- <failure or "None">

### Notes
- <anything surprising, including wrong Electron attachment, blank renderer, or app restart>
```
