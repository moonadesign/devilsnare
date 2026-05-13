# Devilsnare

**SNARE** = Simple, Natural, Agentic Review Environment

A Mac desktop app for reviewing the state of all your projects across every environment. Not an IDE, not a task runner — a review environment. It observes and reports so you can decide what to do.

## Resume orchestration

When you click Resume, Devilsnare opens VS Code with the project and sets up terminal tabs via osascript.

| # | Action | Wait | Note |
|---|--------|------|------|
| 1 | `code --new-window <path>` | 1.5s | VS Code loads the folder |
| 2 | `osascript` activate VS Code | 0.5s | Ensure focus before keystrokes |
| 3 | `Cmd+Shift+P` | 0.5s | Trigger command palette |
| 4 | `Terminal: Kill All Terminals` | 0.5s | Autocomplete resolves |
| 5 | Press Enter | 0.5s | Prior terminals close |
| 6 | `` Ctrl+Shift+` `` (first terminal) | 1.5s | Shell initializes |
| 7 | `npm start` / `npm run dev` / `npx serve` | None | Depends on repo |
| 8 | Press Enter | 1.5s | App launches, may steal focus |
| 9 | `osascript` activate VS Code | 0.5s | Regain focus after app launch |
| 10 | `` Ctrl+Shift+` `` (second terminal) | 1.5s | Shell initializes |
| 11 | `claude --resume` / `codex resume` / `claude` | None | Depends on session |
| 12 | Press Enter | None | Session begins |

## Session matching

Devilsnare pairs AI sessions (Claude, Codex) with repos using three strategies in priority order:

1. **Project directory** — sessions in `~/.claude/projects/<encoded-path>/` match directly
2. **Title match** — root-level sessions (`~/Code`) match if their title contains the repo name
3. **Write-path analysis** — root-level sessions match to whichever repo received the most Edit/Write tool calls

Headless sessions (from `--print` reviews) use `--no-session-persistence` to avoid polluting the session index.
