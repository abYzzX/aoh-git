# AOH - Git — Extension Design

## Purpose

AOH - Git provides a compact Git workflow for Visual Studio Code with a dedicated Changes/Stashes view, branch operations, staging selection, commits, synchronization, rollback, and optional AI-assisted commit messages.

The extension aims to make common Git work direct without replacing Git concepts with an unrelated abstraction.

## Requirements

- Work with one or multiple Git repositories in a workspace.
- Present repository, branch, ahead/behind, changed-file, and stash state in one focused view.
- Support flat and tree representations of changed files.
- Allow file selection independently from Git staging state where the workflow requires it.
- Support commit, Commit & Push, fetch, pull, push, branch creation/switching/merging/deletion, rollback, and stash operations.
- Keep destructive actions deliberate.
- Keep AI commit-message generation optional and provider-neutral.
- Respect the active VS Code file icon theme in the Changes view.

## Architecture

### VS Code Git integration

The built-in `vscode.git` extension is a required dependency. Its API supplies repository discovery and live repository state. AOH - Git reacts to repository state rather than maintaining a competing Git model.

### Git CLI

The extension invokes the Git executable for operations and data that are easier or more reliable to obtain directly from Git, including branch enumeration and several stash/rollback operations. CLI output parsing should use stable, machine-oriented formats where possible and parsing logic should be isolated from UI code when practical.

### Webview

The main Changes/Stashes interface is implemented as a VS Code webview. Extension-host code owns Git access and filesystem-sensitive behavior; the webview owns rendering and interaction state. Messages crossing that boundary should remain explicit and narrowly scoped.

`webview.ts` owns the HTML/CSS/JavaScript template. `gitApi.ts` and `gitStatus.ts` provide shared API types and status classification; the inactive legacy tree/commit implementations have been removed. Repository sections are replaced only when their rendered contents change. Expansion state and stash drafts survive replacement.

`RefreshQueue` serializes refreshes, merges bursts into one pending run, and prevents superseded snapshots from being published. Identical snapshots are not resent. Read-only diff/open actions do not request another Git status refresh.

`StashStore` reads only stash metadata during normal refreshes. File lists load on expansion, use NUL-delimited Git output, and are cached by repository and immutable stash hash. Caches are pruned when stashes or repositories disappear; diff inspection uses hashes so stash renumbering cannot redirect an open diff.

### File icon themes

`FileIconThemeService` reads the active contributed VS Code file icon theme and resolves its file/folder mappings, resources, and icon fonts for use in the webview. Theme changes cause icon data to be reloaded.

### AI commit messages

AI support executes a configurable external CLI. AOH - Git supplies Git context/diff input and consumes stdout as the proposed commit message. This avoids provider-specific SDK dependencies and allows Codex, Claude, Ollama wrappers, or custom tools to be used behind the same boundary.

AI support is disabled by default and is not required for normal Git functionality. `ai.ts` owns CLI execution with a two-minute timeout, a 4 MiB combined output limit, and stdin error handling. On failure, POSIX commands are terminated through their dedicated process group (SIGTERM, then SIGKILL after one second); Windows uses `taskkill /T /F`. Cleanup finishes before the generation promise rejects, so the per-repository guard stays held during termination. POSIX descendants that explicitly create their own process group/session are outside this containment. `selectedDiff.ts` handles selection-based input, unborn repositories, literal pathspecs, and bounded reads of new files. Duplicate generation and commit requests are suppressed per repository.

## Safety rules

- Rollback is destructive and requires confirmation.
- Merge conflicts are left to Git and the developer; AOH - Git does not auto-resolve them.
- Local branch deletion uses safe Git deletion semantics rather than blindly forcing deletion of unmerged work.
- Operations that publish a branch without an upstream require deliberate user interaction.

## Testing strategy

Prefer automated tests for deterministic logic such as Git output parsing, path transformations, sorting, classification, and regression cases. Avoid constructing a large fake VS Code runtime for coverage alone. UI and Git integration still require real-world extension testing.

## Repository build and release

The repository contains the extension source and package metadata, but intentionally does not own a Gitea Actions pipeline or GitVersion configuration. Build/release orchestration is handled outside this repository. Local validation is performed with `npm test`, including temporary-repository Git integration tests, refresh scheduling, AI subprocess limits, status classification, and generated webview script syntax. Tests require Git on PATH.

## Known design constraints

- Git must be available on the host.
- The built-in VS Code Git extension must be enabled.
- Some behavior depends on Git CLI output and filesystem paths, so cross-platform path handling must be treated carefully.
- AI quality and availability depend entirely on the configured external CLI.

## Planned work

Planned work should remain in issues rather than being treated as implemented behavior. Current known candidates include richer Git context-menu integration and improving prune behavior so stale local branches can be cleaned up only when they are safely merged.
