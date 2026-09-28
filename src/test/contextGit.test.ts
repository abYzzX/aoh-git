import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPatch, gitOutput, ignorePattern, relativePaths, resolveRevision, stashSelected } from '../contextGit';

const exec = promisify(execFile);
async function fixture(t: TestContext) {
    const root = await mkdtemp(path.join(tmpdir(), 'aoh-context-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const git = (...args: string[]) => gitOutput(root, args);
    await git('init', '-q');
    await git('config', 'user.name', 'Test');
    await git('config', 'user.email', 'test@example.invalid');
    await git('config', 'commit.gpgsign', 'false');
    return { root, git, file: (name: string) => path.join(root, name) };
}

test('paths cannot escape the target repository', () => {
    const root = path.resolve('repository');
    assert.deepEqual(relativePaths(root, [path.join(root, 'dir', 'a.txt')]), ['dir/a.txt']);
    for (const file of [root, path.resolve(root, '..', 'outside'), path.resolve(root + '-other', 'file')]) {
        assert.throws(() => relativePaths(root, [file]), /outside/);
    }
    assert.throws(() => relativePaths(root, []), /at least one/);
});

test('ignore patterns match exact names, including Git wildcards and trailing spaces', async t => {
    const { root, file, git } = await fixture(t);
    const names = ['a[1].txt', '!bang', '#hash', ...(process.platform === 'win32' ? [] : ['star*.txt', 'trailing '])];
    await writeFile(file('.gitignore'), names.map(ignorePattern).join('\n') + '\n');
    for (const name of names) await writeFile(file(name), 'content');
    for (const name of names) await exec('git', ['check-ignore', '--quiet', '--', name], { cwd: root });
    await assert.rejects(exec('git', ['check-ignore', '--', 'a1.txt', 'star-other.txt'], { cwd: root }));
    assert.throws(() => ignorePattern('line\nbreak'), /line breaks/);
});

test('patch export includes selected text, binary and new files without altering the real index', async t => {
    const { root, file, git } = await fixture(t);
    await writeFile(file('selected.txt'), 'before\n');
    await writeFile(file('other.txt'), 'before\n');
    await git('add', '.'); await git('commit', '-qm', 'baseline');
    await writeFile(file('selected.txt'), 'partially staged\n'); await git('add', 'selected.txt');
    await writeFile(file('selected.txt'), 'working version\n');
    await writeFile(file('other.txt'), 'unrelated staged\n'); await git('add', 'other.txt');
    const binary = Buffer.from([0, 1, 2, 255, 0, 9]);
    await writeFile(file('new.bin'), binary);
    await writeFile(file('a[1].txt'), 'literal selected\n');
    await writeFile(file('a1.txt'), 'must not appear\n');
    const indexBefore = await readFile(file('.git/index'));
    const patch = await createPatch(root, ['selected.txt', 'new.bin', 'a[1].txt'].map(file));
    assert.deepEqual(await readFile(file('.git/index')), indexBefore);
    assert.match(patch, /\+working version/);
    assert.match(patch, /GIT binary patch/);
    assert.doesNotMatch(patch, /unrelated staged|must not appear/);
    await writeFile(file('changes.patch'), patch);
    await git('reset', '--hard', 'HEAD');
    await rm(file('new.bin')); await rm(file('a[1].txt'));
    await git('apply', '--check', 'changes.patch'); await git('apply', 'changes.patch');
    assert.equal(await readFile(file('selected.txt'), 'utf8'), 'working version\n');
    assert.deepEqual(await readFile(file('new.bin')), binary);
});

test('patch export works before the first commit and revision input cannot inject Git options', async t => {
    const { root, file } = await fixture(t);
    await writeFile(file('new.txt'), 'first\n');
    assert.match(await createPatch(root, [file('new.txt')]), /\+first/);
    await assert.rejects(resolveRevision(root, '--help'));
});

test('selected stash excludes unrelated staging and preserves the selected staged/unstaged split', async t => {
    const { root, file, git } = await fixture(t);
    for (const name of ['selected', 'other']) await writeFile(file(name), 'before\n');
    await git('add', '.'); await git('commit', '-qm', 'baseline');
    await writeFile(file('selected'), 'selected staged\n'); await git('add', 'selected');
    await writeFile(file('selected'), 'selected working\n');
    await writeFile(file('other'), 'other staged\n'); await git('add', 'other');
    await writeFile(file('new.txt'), 'selected untracked\n');
    await writeFile(file('outside.txt'), 'unselected untracked\n');
    await stashSelected(root, [file('selected'), file('new.txt')], 'selection');
    const names = (await git('stash', 'show', '--include-untracked', '--name-only', '-z')).split('\0').filter(Boolean).sort();
    assert.deepEqual(names, ['new.txt', 'selected']);
    assert.equal(await git('diff', '--cached', '--name-only'), 'other\n');
    assert.equal(await readFile(file('selected'), 'utf8'), 'before\n');
    assert.equal(await readFile(file('other'), 'utf8'), 'other staged\n');
    assert.equal(await readFile(file('outside.txt'), 'utf8'), 'unselected untracked\n');
    assert.equal(await git('show', 'stash@{0}^2:selected'), 'selected staged\n');
    assert.equal(await git('show', 'stash@{0}^2:other'), 'before\n');
    await git('restore', '--source=HEAD', '--staged', '--worktree', '--', 'other');
    await git('stash', 'apply', '--index');
    assert.equal(await git('show', ':selected'), 'selected staged\n');
    assert.equal(await readFile(file('selected'), 'utf8'), 'selected working\n');
});

test('selected stash handles untracked-only files and staged renames without capturing other files', async t => {
    const { root, file, git } = await fixture(t);
    await writeFile(file('old.txt'), 'tracked\n');
    await git('add', '.'); await git('commit', '-qm', 'baseline');
    await writeFile(file('new.txt'), 'new file\n');
    await writeFile(file('outside.txt'), 'outside\n');
    await stashSelected(root, [file('new.txt')], 'new only');
    assert.deepEqual((await git('stash', 'show', '--include-untracked', '--name-only', '-z')).split('\0').filter(Boolean), ['new.txt']);
    assert.equal(await readFile(file('outside.txt'), 'utf8'), 'outside\n');
    await git('mv', 'old.txt', 'renamed.txt');
    const patch = await createPatch(root, [file('old.txt'), file('renamed.txt')]);
    assert.match(patch, /deleted file mode/);
    assert.match(patch, /new file mode/);
    await stashSelected(root, [file('old.txt'), file('renamed.txt')], 'rename');
    assert.equal(await readFile(file('old.txt'), 'utf8'), 'tracked\n');
    assert.equal(await git('diff', '--cached', '--name-only'), '');
    assert.equal(await readFile(file('outside.txt'), 'utf8'), 'outside\n');
});

test('stashing only a staged deletion does not capture unrelated working edits', async t => {
    const { root, file, git } = await fixture(t);
    for (const name of ['deleted', 'other']) await writeFile(file(name), 'before\n');
    await git('add', '.'); await git('commit', '-qm', 'baseline');
    await git('rm', 'deleted');
    await writeFile(file('other'), 'unrelated\n');
    await stashSelected(root, [file('deleted')], 'deletion');
    assert.equal(await git('stash', 'show', '--name-only'), 'deleted\n');
    assert.equal(await readFile(file('deleted'), 'utf8'), 'before\n');
    assert.equal(await readFile(file('other'), 'utf8'), 'unrelated\n');
    assert.equal(await git('diff', '--cached', '--name-only'), '');
});
