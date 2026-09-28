# Changelog

All notable changes to AOH - Git will be documented in this file.

## 0.1.4

- Restore the clock-icon button beside AI in the commit message box to reuse complete recent commit messages.
- Fix pushing branches with an inherited, differently named upstream; confirm publication before Commit & Push changes the index or creates a commit.
- Create branches without inheriting upstream tracking and push explicitly to the matching remote branch.
- Add timestamped warning/error diagnostics, remove refresh log noise, and clearly report local commits retained after failed pushes.

## 0.1.3

- Reuse a complete previous commit message through a compact clock-icon button inside the commit message box, next to the AI button.
- Add file/folder context menus with a Git submenu, tracked/untracked visibility rules, keyboard navigation, and scrolling for smaller views.
- Add source/diff navigation, revision and branch/tag comparisons, file history, path copying, deletion, staging, and exact-path .gitignore entries.
- Export selected local changes as a patch file or clipboard patch, including binary files, without changing the Git index.
- Stash only selected changes while preserving unrelated staging; expose merge, rebase, local tag creation, reset modes, remote management, and clone actions.
- Branch selection now includes remote branches.
- Commit Files opens the commit editor with the context selection; Unstash Changes opens the existing Stashes tab.

## 0.1.2

- Terminate AI wrapper subprocesses and their descendants on timeout or excessive output before allowing another generation.
- Preserve stash filenames containing Unicode, tabs, newlines, or trailing spaces, and inspect stashes by immutable hash.
- Correct type-change and merge-conflict colors in the Changes view.
- Clear the commit message after a successful commit even when the subsequent push fails, and prevent duplicate commit submissions.
- Generate AI messages before the first commit; handle early CLI exits, hung commands, and excessive output safely.
- Preserve folder/stash expansion, scrolling, and stash message drafts across refreshes.
- Load stash file lists only when expanded and reuse them across refreshes.
- Coalesce overlapping refreshes, skip identical state updates, and reuse unchanged repository sections.
- Share status definitions and branch parsers with the active view and remove unused legacy UI implementations.
- Standardized the repository documentation structure around shared AOH rules and extension-specific design/agent documentation.
- Added automated tests for deterministic Git branch-output parsing.
- Repository-local Gitea Actions and GitVersion configuration are intentionally not part of this repository.

## 0.1.1
- Use the active VS Code file icon theme for changed files and folders in the Changes webview.
- Resolve icon-theme file/folder mappings (including expanded folders), SVG/PNG resources and icon-font glyphs from the contributing extension.
- Reload icons automatically when the configured file icon theme or active color theme changes.
- Fix tree file indentation and render real file/folder icons in the Changes webview.
- Fixed file indentation in tree view so file rows align with sibling folder contents.
- Added compact file-type icons for common source/config file extensions in Changes tree and flat views.
- Fix Tracked / Untracked grouping by classifying untracked files by Git status instead of relying on VS Code's optional untrackedChanges collection.

## Earlier versions

- Remove the Stage button; checkboxes are selection only and do not mutate the Git index.
- Commit and Commit & Push stage only the selected files at commit time.
- Prompt before publishing a local branch that has no upstream; confirmed publication uses git push --set-upstream.
- Changed the Changes view to group files as Tracked and Untracked.
- Checkboxes now represent the AOH action selection and no longer stage/unstage immediately.
- Added Stage action for staging only the currently selected files.
- Commit and Commit & Push now synchronize the Git index with the selected files only when the commit is executed.
- AI commit-message generation now uses the selected files instead of requiring pre-staged changes.
- Added a dedicated **Stashes** tab to the AOH Git view.
- Added stash creation with an optional message and **Include untracked files** option.
- Added expandable stash entries showing the files contained in each stash.
- Added file status, path, file count, stash reference, and timestamp information.
- Added double-click stash file inspection using Git-backed diffs.
- Added **Apply**, **Pop**, and **Drop** actions for individual stashes.
- Added confirmation before permanently dropping a stash.
- Added multi-repository stash support.
- Added repository header with branch and ahead/behind information.
- Added branch management directly from the Git view.
- Added separate Staged Changes and Changes sections.
- Added support for staging and unstaging individual files or groups of files.
- Added flat and tree-based file views.
- Added Git status coloring for changed files.
- Added double-click support for opening file diffs.
- Added integrated commit message editor.
- Added Commit and Commit & Push actions.
- Added optional AI-assisted commit message generation.
- Added rollback support for tracked, staged, and untracked changes with confirmation.
- Added support for multiple repositories in a workspace.
- Improved layout and configurable spacing throughout the Git view.


