# Devilsnare

**SNARE** = Simple, Natural, Agentic Review Environment

A Mac desktop app for reviewing the state of all your projects across every environment. Not an IDE, not a task runner — a review environment. It observes and reports so you can decide what to do.

Product of Moona LLC.

## Vision

Every project you touch — local repos, monorepo submodules, remote servers, cloud deployments — visible in one list with honest, up-to-date status. The goal is to answer "where is everything at?" in seconds, not hours of terminal hopping and `git status` across machines.

## Data model

Everything is a **Path**. The list view is flat — every scannable path is a row. The detail panel adapts based on what the path actually is.

```
Path
  name            — display name (repo name, folder name)
  path            — absolute path or remote URI
  type            — monorepo | repo | submodule | project-folder
  environment     — local | ssh | cloud (v2+)
  parent          — null for top-level, parent Path for children
  children        — discovered sub-paths
  status          — computed from checks (clean | dirty | stale | unknown)
  lastActivity    — most recent commit or file modification
  diskUsage       — bytes on disk
  checks          — results of individual health checks
```

### Type-specific detail views

**monorepo** (e.g. pando)
- Submodule list with pinned vs actual commit, detached HEAD state
- Dirty submodule summary
- manifest.json vs reality (planned but missing repos)
- TODO.md migration status

**repo** (e.g. hatch, macabre-2026)
- Branch, remote tracking, ahead/behind
- Uncommitted changes
- Dependency health (node_modules installed, outdated packages)
- Notable files (.env, CLAUDE.md, package.json)

**submodule** (e.g. superwork.ing inside pando)
- Pinned commit vs checked-out commit
- Detached HEAD state (normal vs unexpected)
- Backup branches from nothing-cli operations
- Divergence from parent's pin

**project-folder** (e.g. clones inside superwork.ing, templates inside websuite)
- Individual HTML/CSS/JS entry points
- Data files (JSON, CSV)
- Last modified date
- Custom metadata per parent project

## Discovery

Three-layer scan:

1. **Top-level** — scan configured root directories (e.g. `~/Code`) for git repos and monorepos
2. **Submodules** — inside monorepos, enumerate `.gitmodules` entries
3. **Sub-projects** — inside any project, discover meaningful subdirectories

### Sub-project detection (v1: convention-based)

A subdirectory is a "sub-project" if it has:
- Its own `index.html` or `{name}.html` entry point
- Its own `package.json`
- Its own `README.md`
- A data file (`*.json`, `*.csv`) suggesting independent state

This covers superwork.ing clones (each has `{name}.html`), websuite templates, and hatch scripts. Projects can override with a `.devilsnare` config file listing explicit sub-project paths if auto-detection misses or over-includes.

## Checks

Per-path health checks, run on demand or on app launch:

| Check | Applies to | What it reports |
|-------|-----------|-----------------|
| git-status | repo, submodule | dirty/clean, branch, uncommitted files |
| git-remote | repo | ahead/behind remote, unpushed commits, no remote |
| git-submodules | monorepo | dirty submodules, diverged pins |
| deps-installed | repo, submodule | node_modules present vs missing |
| deps-outdated | repo, submodule | outdated packages (npm outdated) |
| disk-usage | all | total size, largest subdirectories |
| last-activity | all | last commit date, last file modification |
| stale | all | no activity in 30+ days |
| env-files | repo, submodule | .env present (security awareness, not contents) |
| nothing-static-sync | submodule | is project on latest nothing-static |

## Architecture

- **Electron** main process — runs shell commands via `child_process`, manages IPC
- **Renderer** — plain HTML/CSS/JS (no framework, no bundler)
- **minterface.css** — shared design system
- **Dark/light mode** — via Electron `nativeTheme`
- **Data** — cached results in JSON files, refresh on demand
- **Config** — `~/.devilsnare/config.json` for root directories, environments, preferences

## UI

### Primary list (left panel or full width)

All paths in one scrollable list. Grouped by root directory, then by org folder within monorepos.

Each row shows:
- Status indicator (color dot: green/yellow/red/gray)
- Name
- Type badge (monorepo / repo / submodule / folder)
- Last activity (relative time)
- Environment badge (local / ssh / cloud) — v2+

Expandable: monorepos and repos with sub-projects expand inline to show children.

### Detail panel (right panel on click)

Adapts to path type. Shows:
- Full check results
- Git state details
- Action buttons (open in terminal, open in editor, open in GitHub)
- Sub-project list for container paths

### Top bar

- Refresh all / refresh selected
- Search/filter
- Group by: root / type / status / environment

## Multi-environment (v2+)

The hardest unsolved problem: reasoning about parity across environments.

### Environments to support

- **Local machines** — iMac, MacBook, any Mac with SSH enabled
- **GitHub** — main branch, feature branches, PRs
- **Remote servers** — VPS via SSH (e.g. openclaw repos deployed to cloud)
- **Cloud functions** — deployed code vs source repo
- **NAS** — network-attached storage with git repos or backups

### Parity checks (v2+)

For any path that exists in multiple environments:
- Is the code the same? (commit SHA comparison)
- Is one ahead/behind another?
- Are there environment-specific changes (config, env vars)?
- Is the deployed version current?

### Connection scheme

- **SSH** — primary for Mac-to-Mac and Mac-to-VPS. Key-based auth, connection pooling.
- **GitHub API** — for remote branch/PR state without needing a local clone
- **Cloud provider APIs** — for deployment status (Cloud Functions, Vercel, etc.)

### UI for multi-environment

Each path gains an "environments" section in its detail view showing where it exists and parity status. The list view gains environment filter badges.

This is the long-term differentiator — no tool currently gives you a unified view of "this project" across local, GitHub, staging, and production.

## v1 scope

Ship the simplest useful version first:

- [x] Electron app shell with dark/light mode
- [ ] Scan `~/Code` for git repos and monorepos
- [ ] Enumerate submodules inside monorepos
- [ ] Discover sub-projects inside repos
- [ ] Run checks: git-status, git-remote, git-submodules, disk-usage, last-activity
- [ ] Primary list with status indicators, expandable hierarchy
- [ ] Detail panel with check results
- [ ] Action buttons: open in terminal, open in editor, open on GitHub
- [ ] Cached results with manual refresh
- [ ] Config file for root directories

### Not in v1

- Multi-environment (SSH, cloud, NAS)
- Parity checks across environments
- Auto-fix or auto-commit
- File watching / live updates
- Dependency outdated checks (slow, do later)
- nothing-static sync checks (niche, do later)

## Tech decisions

- Vanilla JS, no framework, no bundler — matches hatch conventions
- `child_process.execFile` for all shell operations — no shell injection risk
- IPC via Electron's contextBridge/preload pattern
- JSON file caching in `~/.devilsnare/cache/`
- No database — flat files, same as hatch

## Naming

- App name: **Devilsnare**
- Internal references: devilsnare (all lowercase, one word)
- Repo: `mattborn/devilsnare` or `moonadesign/devilsnare`
- Bundle ID: `com.moona.devilsnare`
