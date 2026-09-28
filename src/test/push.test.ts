import test from 'node:test';
import assert from 'node:assert/strict';
import { needsPublication, pushArguments } from '../push';
import { diagnosticText } from '../logging';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('missing, inherited and different-remote upstreams require publication confirmation', () => {
    assert.equal(needsPublication('feature', undefined), true);
    assert.equal(needsPublication('feature', { remote: 'origin', name: 'master' }), true);
    assert.equal(needsPublication('feature', { remote: 'origin', name: 'feature' }), false);
    assert.equal(needsPublication('feature', { remote: 'origin', name: 'feature' }, 'other'), true);
});

test('diagnostics retain Git stderr and codes and redact authentication', () => {
    const result = diagnosticText({ message: 'failed https://user:secret@example.com/repo',
        stderr: 'fatal: rejected Authorization: Bearer secret', gitErrorCode: 'PushRejected', code: 1 });
    assert.match(result, /fatal: rejected/);
    assert.match(result, /PushRejected/);
    assert.doesNotMatch(result, /secret/);
});

test('publication repairs inherited master upstream without committing or changing master/index', async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'aoh-push-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const exec = promisify(execFile);
    const git = async (...args: string[]) => (await exec('git', args, { cwd: root })).stdout.trim();
    await git('init', '-b', 'master');
    await git('config', 'user.name', 'Test');
    await git('config', 'user.email', 'test@example.invalid');
    await git('config', 'commit.gpgsign', 'false');
    await git('commit', '--allow-empty', '-m', 'initial');
    await git('init', '--bare', 'remote.git');
    await git('remote', 'add', 'origin', path.join(root, 'remote.git'));
    await git('push', '-u', 'origin', 'master');
    await git('config', 'branch.autoSetupMerge', 'always');
    await git('switch', '--no-track', '-c', 'safe', 'origin/master');
    assert.equal(await git('for-each-ref', '--format=%(upstream)', 'refs/heads/safe'), '');
    await git('switch', '-c', 'feature', 'origin/master');
    await git('config', 'push.default', 'simple');
    await assert.rejects(git('push'), /does not match/);
    await writeFile(path.join(root, 'selected'), 'staged');
    await git('add', 'selected');
    const head = await git('rev-parse', 'HEAD');
    const index = await git('write-tree');
    await git(...pushArguments({ branch: 'feature', remote: 'origin', publish: true }));
    assert.equal(await git('rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/feature');
    assert.equal(await git('rev-parse', 'HEAD'), head);
    assert.equal(await git('rev-parse', 'origin/master'), head);
    assert.equal(await git('write-tree'), index);
    await git('config', 'remote.origin.push', 'HEAD:refs/heads/wrong');
    await git(...pushArguments({ branch: 'feature', remote: 'origin', publish: false }));
    assert.equal(await git('ls-remote', 'origin', 'refs/heads/wrong'), '');
});
