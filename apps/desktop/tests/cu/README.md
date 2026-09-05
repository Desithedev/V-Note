# Computer Use Tests

These are lightweight, human-readable end-to-end scenarios for running V-Note through Codex Computer Use.

They are not Vitest or Playwright tests. They are structured prompts/checklists for an agent to operate the real Electron app as a user would.

## Running A Scenario

1. Start V-Note dev mode:

   ```bash
   pnpm dev
   ```

2. Ask Codex to run a scenario, for example:

   ```text
   Run apps/desktop/tests/cu/note-persistence.md using Computer Use.
   ```

3. The agent should use the exact app target from the scenario:

   ```text
   /Users/nchopra/go/src/github.com/Desithedev/V-Note/node_modules/electron/dist/Electron.app
   ```

Do not target generic `Electron`; another Electron app may be running.

In development, the app window exposes URLs like `localhost:5173/#/home` because Electron is loading the Vite renderer. That is expected and does not mean the flow is running in a browser.
