import { execFile } from 'child_process';
import { promisify } from 'util';
import { posix } from 'path';
import { parseNullPaths, parseNameStatus, parseStashes } from './gitOutput';

const execFileAsync = promisify(execFile);
export interface StashFile { path: string; name: string; dir: string; status: string; untracked: boolean; }

/** File lists are immutable for a stash hash, even when stash ordinals change. */
export class StashStore {
    private readonly files = new Map<string, Map<string, StashFile[]>>();
    private readonly entries = new Map<string, ReturnType<typeof parseStashes>>();

    async list(root: string) {
        const { stdout } = await execFileAsync('git', [
            'stash', 'list', '-z', '--format=%gd%x00%H%x00%ct%x00%gs%x00%P'
        ], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
        const entries = parseStashes(stdout);
        this.entries.set(root, entries);
        const cache = this.files.get(root);
        const hashes = new Set(entries.map(entry => entry.hash));
        if (cache) for (const hash of cache.keys()) if (!hashes.has(hash)) cache.delete(hash);
        return entries.map(entry => ({ ...entry, files: cache?.get(entry.hash) }));
    }

    async load(root: string, hash: string): Promise<void> {
        const entry = this.entries.get(root)?.find(entry => entry.hash === hash);
        if (!entry) throw new Error('The selected stash is no longer available.');
        let cache = this.files.get(root);
        if (!cache) this.files.set(root, cache = new Map());
        if (cache.has(hash)) return;
        const [files, untracked] = await Promise.all([
            execFileAsync('git', ['stash', 'show', '--include-untracked', '--name-status', '-z', '--format=', '--no-renames', hash],
                { cwd: root, maxBuffer: 10 * 1024 * 1024 }),
            entry.parents.length > 2
                ? execFileAsync('git', ['ls-tree', '-r', '--name-only', '-z', `${hash}^3`],
                    { cwd: root, maxBuffer: 10 * 1024 * 1024 })
                : Promise.resolve({ stdout: '' })
        ]);
        const untrackedPaths = new Set(parseNullPaths(untracked.stdout));
        cache.set(hash, parseNameStatus(files.stdout).map(file => ({
            ...file, name: posix.basename(file.path), dir: posix.dirname(file.path) === '.' ? '' : posix.dirname(file.path), untracked: untrackedPaths.has(file.path)
        })));
    }

    retain(roots: Set<string>): void {
        for (const root of this.entries.keys()) if (!roots.has(root)) {
            this.entries.delete(root);
            this.files.delete(root);
        }
    }
}
