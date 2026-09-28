import test from 'node:test';
import assert from 'node:assert/strict';
import { rootContextMenu, gitContextMenu, visibleMenu, isContextAction } from '../contextMenu';

const labels = (items: typeof rootContextMenu) => items.map(item => item.separator ? '---' : item.label);
test('root menu follows the requested order and tracked/untracked restrictions', () => {
    assert.deepEqual(labels(visibleMenu(rootContextMenu, 'tracked')), [
        'Commit Files...', 'Rollback...', 'Show Diff', 'Jump to Source', '---',
        'Copy Path', 'Copy Relative Path', '---', 'Delete...', 'Add to .gitignore', '---',
        'Create Patch from Local Changes...', 'Copy as Patch to Clipboard',
        'Stash Changes...', '---', 'Refresh', '---', 'Git'
    ]);
    assert.deepEqual(labels(visibleMenu(rootContextMenu, 'untracked')), [
        'Commit Files...', 'Rollback...', 'Show Diff', 'Jump to Source', '---',
        'Copy Path', 'Copy Relative Path', '---', 'Delete...', 'Add to VCS', 'Add to .gitignore', '---',
        'Copy as Patch to Clipboard', '---', 'Refresh', '---', 'Git'
    ]);
    assert.ok(visibleMenu(rootContextMenu, 'mixed').every(item => !item.only));
});
test('Git submenu preserves the requested action groups', () => {
    assert.deepEqual(labels(gitContextMenu), [
        'Commit Files...', 'Add', '---', 'Show Diff', 'Compare with Revision...', 'Compare with Branch or Tag...',
        'Show History', 'Rollback', '---', 'Push...', 'Pull...', 'Fetch', '---', 'Merge...', 'Rebase...', '---',
        'Branches...', 'New Branch...', 'New Tag...', 'Reset HEAD...', '---', 'Stash Changes...', 'Unstash Changes...',
        '---', 'Manage Remotes...', 'Clone...'
    ]);
});
test('menu actions are available and malformed actions are rejected', () => {
    assert.ok([...rootContextMenu, ...gitContextMenu].every(item => !item.disabled));
    for (const action of [undefined, null, '', 'toString', 'unknownAction']) assert.equal(isContextAction(action), false);
    assert.equal(isContextAction('patchClipboard'), true);
});
