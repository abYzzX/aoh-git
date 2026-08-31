# AOH - Git

AOH - Git is a compact Git interface for Visual Studio Code focused on everyday development workflows.

It provides a dedicated Git view with repository state, branch operations, staging controls, commits, synchronization actions, rollback support, and optional AI-assisted commit messages.

## Features

- Multiple Git repositories in a workspace
- Current branch and ahead/behind information
- Tree and flat views for changed files
- Stage and unstage individual files
- Stage and unstage complete folders recursively
- Stage or unstage complete change groups
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

The argument list may contain the placeholders `{Context}` and `{Diff}`. If neither placeholder is used, AOH sends the generated context and staged diff through standard input. This is generally preferable for large diffs and avoids command-line length limitations.

The configured command must write the generated commit message to standard output.

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
