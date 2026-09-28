import { execFile } from 'child_process';
import { promisify } from 'util';
import { open } from 'fs/promises';
import * as path from 'path';

const execFileAsync = promisify(execFile);
export const maxDiffChars = 120_000;

export async function selectedDiff(root: string, files: string[], untracked: Set<string>): Promise<string> {
    const hasHead = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root })
        .then(() => true, error => {
            if (error.code === 1) return false;
            throw error;
        });
    let diff = '';
    if (hasHead) {
        const result = await execFileAsync('git', [
            '--literal-pathspecs', 'diff', 'HEAD', '--no-ext-diff', '--unified=3', '--',
            ...files.map(file => path.relative(root, file))
        ], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
        diff = result.stdout;
    }
    // Read at most the remaining prompt budget; avoid opening whole files as editor documents.
    for (const file of files) {
        if (diff.length > maxDiffChars) break;
        if (hasHead && !untracked.has(path.normalize(file))) continue;
        const handle = await open(file, 'r').catch(error => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
        });
        if (!handle) continue;
        try {
            const buffer = Buffer.alloc((maxDiffChars + 1 - diff.length) * 4);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            const content = buffer.subarray(0, bytesRead);
            if (content.includes(0)) continue;
            const relative = path.relative(root, file);
            diff += `\ndiff --git a/${relative} b/${relative}\nnew file\n${content.toString('utf8')}`;
        } finally {
            await handle.close();
        }
    }
    return diff;
}
