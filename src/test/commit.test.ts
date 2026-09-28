import test from 'node:test';
import assert from 'node:assert/strict';
import { commitSelection } from '../commit';

test('a failed push still reports a successful selected-file commit exactly once', async () => {
    const events: string[] = [];
    const repo = {
        state: { indexChanges: [{ uri: { fsPath: 'selected' } }, { uri: { fsPath: 'excluded' } }] },
        async restore(files: string[], options: { staged: boolean }) {
            assert.deepEqual(files, ['excluded']);
            assert.deepEqual(options, { staged: true });
            events.push('restore');
        },
        async add(files: string[]) { assert.deepEqual(files, ['selected']); events.push('add'); },
        async commit(message: string) { assert.equal(message, 'message'); events.push('commit'); }
    };
    await assert.rejects(commitSelection(repo, ['selected'], 'message', () => events.push('committed'), async () => {
        events.push('push'); throw new Error('offline');
    }), /offline/);
    assert.deepEqual(events, ['restore', 'add', 'commit', 'committed', 'push']);
});

test('failed commits do not clear the message or push', async () => {
    const repo = {
        state: { indexChanges: [] },
        async restore() { assert.fail('nothing to unstage'); },
        async add() {},
        async commit() { throw new Error('hook failed'); }
    };
    await assert.rejects(commitSelection(repo, ['selected'], 'message', () => assert.fail('must retain draft'),
        async () => assert.fail('must not push')), /hook failed/);
});
