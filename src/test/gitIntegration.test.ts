import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StashStore } from '../stashStore';
import { selectedDiff, maxDiffChars } from '../selectedDiff';

const exec = promisify(execFile);
async function fixture(t: TestContext) {
    const root = await mkdtemp(path.join(tmpdir(), 'aoh-git-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const git = (...args: string[]) => exec('git', args, { cwd: root });
    await git('init', '-q');
    await git('config', 'user.name', 'Test');
    await git('config', 'user.email', 'test@example.invalid');
    await git('config', 'commit.gpgsign', 'false');
    return { root, git, file: (name: string) => path.join(root, name) };
}

test('stash files load lazily, preserve unusual paths, and survive ordinal changes', async t => {
    const { root, git, file } = await fixture(t);
    await writeFile(file('tracked'), 'initial\n');
    await git('add', '.'); await git('commit', '-qm', 'initial');
    await writeFile(file('tracked'), 'changed\n');
    const names = ['ä.txt', ...(process.platform === 'win32' ? ['with space.txt'] : ['trailing ', 'tab\tname', 'line\nbreak'])];
    for (const name of names) await writeFile(file(name), 'new\n');
    await git('stash', 'push', '-u', '-m', 'first');
    const store = new StashStore();
    const [initial] = await store.list(root);
    assert.equal(initial.files, undefined);
    await store.load(root, initial.hash);
    const [loaded] = await store.list(root);
    assert.deepEqual(loaded.files!.filter(file => file.untracked).map(file => file.path).sort(), names.sort());
    assert.equal(loaded.files!.find(file => file.path === 'ä.txt')!.name, 'ä.txt');
    await writeFile(file('tracked'), 'second\n');
    await git('stash', 'push', '-m', 'second');
    const entries = await store.list(root);
    assert.equal(entries[0].files, undefined);
    assert.equal(entries[1].hash, initial.hash);
    assert.equal(entries[1].ref, 'stash@{1}');
    assert.strictEqual(entries[1].files, loaded.files);
    await store.load(root, entries[0].hash); // No third parent for tracked-only stashes.
    await git('stash', 'drop', 'stash@{1}');
    await store.list(root);
    await assert.rejects(store.load(root, initial.hash), /no longer available/);
});

test('AI diff handles an unborn repository, working edits to staged additions, and prompt bounds', async t => {
    const { root, git, file } = await fixture(t);
    await writeFile(file('new.txt'), 'staged\n');
    await git('add', '.');
    await writeFile(file('new.txt'), 'working version\n');
    const result = await selectedDiff(root, [file('new.txt')], new Set());
    assert.match(result, /working version/);
    await writeFile(file('large.txt'), 'x'.repeat(2 * maxDiffChars));
    const large = await selectedDiff(root, [file('large.txt')], new Set());
    assert.ok(large.length > maxDiffChars);
    assert.ok(large.length < 5 * maxDiffChars);
    await writeFile(file('binary'), Buffer.from([0, 1, 2]));
    assert.equal(await selectedDiff(root, [file('binary')], new Set()), '');
});

test('AI diff restricts tracked changes to the literal selected paths', async t => {
    const { root, git, file } = await fixture(t);
    for (const name of ['a[1].txt', 'a1.txt']) await writeFile(file(name), 'before\n');
    await git('add', '.'); await git('commit', '-qm', 'initial');
    await writeFile(file('a[1].txt'), 'selected\n');
    await writeFile(file('a1.txt'), 'unselected\n');
    const diff = await selectedDiff(root, [file('a[1].txt')], new Set());
    assert.match(diff, /\+selected/);
    assert.doesNotMatch(diff, /unselected/);
});
