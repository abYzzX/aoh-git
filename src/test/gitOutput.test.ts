import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLocalBranches, parseRemoteBranches, splitRemoteBranch } from '../gitOutput';

test('parseLocalBranches trims, removes empty lines and sorts branches', () => {
    assert.deepEqual(
        parseLocalBranches('feature/zeta\n\n master \r\nfix/alpha\n'),
        ['feature/zeta', 'fix/alpha', 'master']
    );
});

test('parseRemoteBranches ignores symbolic HEAD refs', () => {
    const output = [
        'origin/main|',
        'origin/HEAD|refs/remotes/origin/main',
        'upstream/dev|'
    ].join('\n');

    assert.deepEqual(parseRemoteBranches(output), ['origin/main', 'upstream/dev']);
});

test('parseRemoteBranches ignores HEAD even without a symref', () => {
    assert.deepEqual(parseRemoteBranches('origin/HEAD|\norigin/main|'), ['origin/main']);
});

test('parseRemoteBranches sorts results', () => {
    assert.deepEqual(
        parseRemoteBranches('upstream/zeta|\norigin/main|\norigin/dev|'),
        ['origin/dev', 'origin/main', 'upstream/zeta']
    );
});

test('splitRemoteBranch separates remote and branch', () => {
    assert.deepEqual(splitRemoteBranch('origin/feature/foo'), {
        remote: 'origin',
        branch: 'feature/foo'
    });
});

test('splitRemoteBranch preserves a local-looking branch name', () => {
    assert.deepEqual(splitRemoteBranch('main'), { remote: '', branch: 'main' });
});
