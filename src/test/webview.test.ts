import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { renderWebview } from '../webview';
import { gitStatusClasses, Status } from '../gitStatus';

test('rendered webview JavaScript parses after template interpolation', () => {
    const html = renderWebview({ cspSource: 'vscode-resource:' } as Parameters<typeof renderWebview>[0]);
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
    assert.doesNotThrow(() => new Script(script));
});
test('all unmerged statuses are conflicts and type changes are modifications', () => {
    assert.equal(gitStatusClasses[Status.TYPE_CHANGED], 'git-modified');
    for (const status of [Status.ADDED_BY_US, Status.ADDED_BY_THEM, Status.DELETED_BY_US,
        Status.DELETED_BY_THEM, Status.BOTH_ADDED, Status.BOTH_DELETED, Status.BOTH_MODIFIED]) {
        assert.equal(gitStatusClasses[status], 'git-conflict');
    }
});
