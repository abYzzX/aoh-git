export type ContextAction =
    | 'commit' | 'rollback' | 'diff' | 'source'
    | 'copyPath' | 'copyRelativePath' | 'delete' | 'add' | 'ignore'
    | 'patchFile' | 'patchClipboard' | 'stash'
    | 'refresh' | 'compareRevision' | 'compareRef' | 'history'
    | 'push' | 'pull' | 'fetch' | 'merge' | 'rebase' | 'branches' | 'newBranch'
    | 'newTag' | 'reset' | 'unstash' | 'remotes' | 'clone';

export interface ContextMenuItem {
    label?: string;
    action?: ContextAction;
    only?: 'tracked' | 'untracked';
    disabled?: string;
    separator?: boolean;
    submenu?: boolean;
}
const separator: ContextMenuItem = { separator: true };

export const rootContextMenu: ContextMenuItem[] = [
    { label: 'Commit Files...', action: 'commit' },
    { label: 'Rollback...', action: 'rollback' },
    { label: 'Show Diff', action: 'diff' },
    { label: 'Jump to Source', action: 'source' },
    separator,
    { label: 'Copy Path', action: 'copyPath' },
    { label: 'Copy Relative Path', action: 'copyRelativePath' },
    separator,
    { label: 'Delete...', action: 'delete' },
    { label: 'Add to VCS', action: 'add', only: 'untracked' },
    { label: 'Add to .gitignore', action: 'ignore' },
    separator,
    { label: 'Create Patch from Local Changes...', action: 'patchFile', only: 'tracked' },
    { label: 'Copy as Patch to Clipboard', action: 'patchClipboard' },
    { label: 'Stash Changes...', action: 'stash', only: 'tracked' },
    separator,
    { label: 'Refresh', action: 'refresh' },
    separator,
    { label: 'Git', submenu: true }
];

export const gitContextMenu: ContextMenuItem[] = [
    { label: 'Commit Files...', action: 'commit' },
    { label: 'Add', action: 'add' },
    separator,
    { label: 'Show Diff', action: 'diff' },
    { label: 'Compare with Revision...', action: 'compareRevision' },
    { label: 'Compare with Branch or Tag...', action: 'compareRef' },
    { label: 'Show History', action: 'history' },
    { label: 'Rollback', action: 'rollback' },
    separator,
    { label: 'Push...', action: 'push' },
    { label: 'Pull...', action: 'pull' },
    { label: 'Fetch', action: 'fetch' },
    separator,
    { label: 'Merge...', action: 'merge' },
    { label: 'Rebase...', action: 'rebase' },
    separator,
    { label: 'Branches...', action: 'branches' },
    { label: 'New Branch...', action: 'newBranch' },
    { label: 'New Tag...', action: 'newTag' },
    { label: 'Reset HEAD...', action: 'reset' },
    separator,
    { label: 'Stash Changes...', action: 'stash' },
    { label: 'Unstash Changes...', action: 'unstash' },
    separator,
    { label: 'Manage Remotes...', action: 'remotes' },
    { label: 'Clone...', action: 'clone' }
];

// Shared with the webview via function serialization; keep this function self-contained.
export function visibleMenu(items: ContextMenuItem[], kind: 'tracked' | 'untracked' | 'mixed'): ContextMenuItem[] {
    return items.filter(item => !item.only || item.only === kind);
}

export function isContextAction(value: unknown): value is ContextAction {
    return [...rootContextMenu, ...gitContextMenu].some(item => !!item.action && item.action === value && !item.disabled);
}
