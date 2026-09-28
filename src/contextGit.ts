import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile, lstat } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';

const exec = promisify(execFile);
export function relativePaths(root: string, files: string[]): string[] {
    if (!files.length) throw new Error('Select at least one changed file.');
    return [...new Set(files)].map(file => {
        const relative = path.relative(root, file);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error('The selection contains a path outside this repository.');
        }
        return relative.split(path.sep).join('/');
    });
}

export async function gitOutput(root: string, args: string[]): Promise<string> {
    return (await exec('git', ['--literal-pathspecs', ...args], { cwd: root, maxBuffer: 32 * 1024 * 1024 })).stdout;
}

export async function resolveRevision(root: string, ref: string): Promise<string> {
    return (await gitOutput(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
}

/** An anchored literal pattern in the repository-root .gitignore. */
export function ignorePattern(relative: string): string {
    if (/[\r\n]/.test(relative)) throw new Error('Gitignore cannot represent filenames containing line breaks.');
    return '/' + relative.replace(/[\\*?\[\] ]/g, character => '\\' + character);
}

/** Snapshot selected working-tree contents without altering the user's Git index. */
export async function createPatch(root: string, files: string[]): Promise<string> {
    const relative = relativePaths(root, files);
    const temporary = await mkdtemp(path.join(tmpdir(), 'aoh-patch-'));
    const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index') };
    const git = async (args: string[]) => (await exec('git', ['--literal-pathspecs', ...args],
        { cwd: root, env, maxBuffer: 32 * 1024 * 1024 })).stdout;
    try {
        const head = await exec('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root })
            .then(result => result.stdout.trim(), error => { if (error.code === 1) return undefined; throw error; });
        await git(head ? ['read-tree', head] : ['read-tree', '--empty']);
        await git(['add', '-A', '--', ...relative]);
        return await git(['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv',
            '--no-renames', ...(head ? [head] : []), '--', ...relative]);
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}

/** Git's path-limited stash still captures unrelated staged changes unless its index is isolated. */
export async function stashSelected(root: string, files: string[], message: string): Promise<void> {
    const relative = relativePaths(root, files);
    const head = await resolveRevision(root, 'HEAD');
    const temporary = await mkdtemp(path.join(tmpdir(), 'aoh-stash-'));
    const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index') };
    const git = async (args: string[]) => (await exec('git', ['--literal-pathspecs', ...args],
        { cwd: root, env, maxBuffer: 32 * 1024 * 1024 })).stdout;
    try {
        const staged = await gitOutput(root, ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff',
            '--no-textconv', '--no-renames', head, '--', ...relative]);
        await git(['read-tree', head]);
        if (staged) {
            const patch = path.join(temporary, 'staged.patch');
            await writeFile(patch, staged);
            await git(['apply', '--cached', '--whitespace=nowarn', patch]);
        }
        const indexed = new Set((await git(['ls-files', '-z', '--', ...relative])).split('\0').filter(Boolean));
        const tracked = new Set([
            ...(await gitOutput(root, ['ls-files', '-z', '--', ...relative])).split('\0'),
            ...(await gitOutput(root, ['ls-tree', '-r', '--name-only', '-z', head, '--', ...relative])).split('\0')
        ].filter(Boolean));
        // Git rejects explicit pathspecs for staged deletions, even though those deletions
        // are already included in the isolated index. Omit them from the pathspec and
        // restore their working files explicitly after the stash has been saved.
        const selectable = [];
        for (const file of relative) {
            const exists = await lstat(path.join(root, file)).then(() => true, error => {
                if (error.code === 'ENOENT') return false;
                throw error;
            });
            if (indexed.has(file) || exists) selectable.push(file);
        }
        const options = message ? ['-m', message] : [];
        await git(selectable.length
            ? ['stash', 'push', '--include-untracked', ...options, '--', ...selectable]
            : ['stash', 'push', '--staged', ...options]);
        // Restore only selected tracked paths in the real index and worktree. Selected
        // untracked files have already been removed by stash; other staging is untouched.
        const restore = relative.filter(file => tracked.has(file));
        if (restore.length) await gitOutput(root, ['restore', '--source=' + head, '--staged', '--worktree', '--', ...restore]);
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}
