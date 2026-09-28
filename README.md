# AOH - Git

AOH - Git is a compact Git interface for Visual Studio Code focused on everyday development workflows.

It provides a dedicated Git view with repository state, branch operations, staging controls, commits, synchronization actions, rollback support, and optional AI-assisted commit messages.

## Features

- Dedicated Changes and Stashes tabs
- Stash creation with optional messages and untracked-file support
- Expandable stash contents loaded on demand, with file-level diff inspection
- Apply, pop, and drop stash actions
- Multiple Git repositories in a workspace
- Current branch and ahead/behind information
- Tree and flat views for changed files
- Select individual files, whole folders, or complete change groups
- Stage selected files automatically when committing
- Open file diffs directly from the view
- Commit and Commit & Push actions
- Fetch and Pull actions in the view toolbar
- Local and remote branch selection
- Create and switch branches
- Merge another local or remote branch into the current branch
- Roll back individual files
- Recursively roll back all changes below a directory
- Optional push confirmation
- Output channel for diagnostics
- Optional AI-generated commit messages through an external CLI

## Reuse Commit Messages

The **clock icon** inside the commit message box, next to the AI button (tooltip: **Recent Commit Messages**) opens a searchable list of the latest 100 commits in the active repository’s current history. Select an entry to replace the editor contents with its full message, including the body. You can edit it before committing. Cancelling keeps your current draft.

## AI Commit Messages

AI support is optional and disabled by default. AOH - Git does not depend on a specific AI provider. Instead, it can execute a configurable command-line tool and use its standard output as the generated commit message.

Example configuration for the OpenAI Codex CLI:

```json
{
  "aoh.git.ai.enabled": true,
  "aoh.git.ai.command": "codex",
  "aoh.git.ai.arguments": [
    "exec",
    "--color",
    "never",
    "-"
  ]
}
```

The argument list may contain the placeholders `{Context}` and `{Diff}`. If neither placeholder is used, AOH sends the generated context and selected diff through standard input. This is generally preferable for large diffs and avoids command-line length limitations.

The configured command must write the generated commit message to standard output. AOH stops commands after two minutes or when combined stdout/stderr exceeds 4 MiB. Timeout and output-limit cleanup also terminates wrapper child processes. Only one generation runs per repository at a time, including during process cleanup.

Generation uses the selected files, including new files before the first commit. Prompt input is limited to 120,000 characters; large untracked files are read only up to the remaining input budget.

## View Updates

Stash file lists and counts are loaded when a stash is expanded and cached until that stash disappears. Refreshes preserve folder/stash expansion, scroll position, and stash message drafts. Unchanged repository sections are reused.

A successful commit clears the commit message even if a subsequent push fails. Use Push to retry the upload.

## Context Menus

Right-click a changed file or a folder in the Changes view to open the file actions and the **Git** submenu. You can also focus a row and press Shift+F10 or the context-menu key. Use arrow keys to navigate, Right/Left to enter/leave Git, and Escape to close. Long menus scroll inside the view.

- Right-clicking a checked file uses the checked files in that repository; right-clicking an unchecked file uses that file. A folder uses its listed changed descendants. Delete removes those changed files, not the whole folder.
- **Add to VCS** appears only for an entirely untracked selection. **Create Patch from Local Changes** and the root **Stash Changes** appear only for an entirely tracked selection. The Git submenu also permits staging and stashing untracked files.
- **Commit Files** selects the context files and focuses the commit message. **Unstash Changes** opens the Stashes tab for the selected repository.
- **Copy Relative Path** copies paths relative to the repository root. Folder path commands copy the folder path. **Add to .gitignore** appends exact paths to the root ignore file; already tracked files remain tracked.
- Diff/source/history/comparison actions offer a file picker when several files are selected. Comparisons use the chosen revision against the current working file; history offers the latest 100 commits for that file.
- Patch export includes selected working-tree changes and supports binary files. It uses a temporary index and preserves existing staging.
- Context-menu stashes include only selected changes, preserving unrelated staging and the selected staged/unstaged split. Stashing requires an initial commit; stashing a selection consisting entirely of staged deletions requires Git 2.35 or later.
- Push, pull, fetch, branches, merge, rebase, tags, reset, and remotes act on the context repository. New tags are local and point at HEAD. Reset explicitly offers Soft, Mixed, and Hard; its scope is the whole repository. Destructive actions ask for confirmation, and unresolved conflicts are left for you to resolve.

## Rollback

The context menu of changed files and folders contains a Rollback action.

For files, the selected change is discarded. For folders, rollback is recursive and applies to changed files below that directory. Because rollback is destructive, AOH asks for confirmation before performing the operation.

Tracked changes are restored from Git. Selected untracked files are removed.

## Branch Management

The branch menu provides hierarchical navigation for local and remote branches. Operations are shown for the selected branch rather than expanding into large nested context menus.

`Merge into current branch` is available for branches other than the currently checked-out branch. Merge conflicts are left to Git and the developer; AOH does not attempt automatic conflict resolution.

## Diagnostics

AOH - Git writes diagnostic information to the `AOH - Git` output channel. This includes repository discovery, refresh operations, Git state updates, branch operations, rollback activity, and relevant errors.

## Requirements

- Visual Studio Code
- Git
- The built-in VS Code Git extension

An external AI CLI is required only when AI commit-message generation is enabled.


## Development

Install dependencies and run the complete local validation:

```bash
npm test
```

This compiles the TypeScript sources and runs the automated Node tests.

Project documentation:

- [AOH repository rules](AOH-RULES.md)
- [Extension design](EXTENSION-DESIGN.md)
- [Agent instructions](AGENT.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

The repository intentionally does not contain a Gitea Actions pipeline or GitVersion configuration. Build and release orchestration is external to the extension repository.

## License

MIT. See [LICENSE](LICENSE).

Push always targets the same branch name on the selected remote. Missing or differently named upstreams require confirmation before publication (and before staging/committing in Commit & Push). Cancelling leaves the index and commits unchanged. Creating a branch does not inherit tracking from its starting point. Push alone never commits; if a push fails after Commit & Push, the local commit remains and can be uploaded with Push.

Diagnostics are available in Output → AOH - Git, with timestamped warnings and errors including Git failure details. Routine refresh messages are omitted; additional lifecycle diagnostics use the Debug log level.

Use the clock button in the commit message box, beside the AI button, to select one of the latest 100 commit messages. Selection copies the full message into the editor; cancelling leaves the draft unchanged. The history button is also available when AI is disabled.
