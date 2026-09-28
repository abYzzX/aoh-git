import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { setTimeout as delay } from 'timers/promises';

const execFileAsync = promisify(execFile);

async function terminateProcessTree(pid: number | undefined): Promise<void> {
    if (pid === undefined) return; // Spawn failed before a process was created.
    if (process.platform === 'win32') {
        // Kill the tree in one operation, before its root can exit and orphan children.
        await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
            windowsHide: true, timeout: 5_000
        });
        return;
    }

    const signalGroup = (signal: NodeJS.Signals): boolean => {
        try {
            process.kill(-pid, signal);
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
            throw error;
        }
    };
    if (!signalGroup('SIGTERM')) return;
    // The wrapper may close before its children. Do not cancel this escalation on close.
    await delay(1_000);
    signalGroup('SIGKILL');
}

export interface AiLimits { timeoutMs?: number; maxOutputBytes?: number; }

/** Provider-neutral, bounded CLI execution. Never include prompt-bearing args in errors. */
export function runAi(
    command: string, configuredArgs: string[], cwd: string, context: string, diff: string,
    { timeoutMs = 120_000, maxOutputBytes = 4 * 1024 * 1024 }: AiLimits = {}
): Promise<string> {
    const usesPlaceholder = configuredArgs.some(arg => arg.includes('{Context}') || arg.includes('{Diff}'));
    const args = configuredArgs.map(arg => arg.replaceAll('{Context}', context).replaceAll('{Diff}', diff));
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
            // A dedicated POSIX process group lets us signal wrappers and descendants together.
            detached: process.platform !== 'win32'
        });
        let stdout = '';
        let stderr = '';
        let bytes = 0;
        let settled = false;
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            // Keep runAi pending (and the repository generation guard held) until cleanup ends.
            void terminateProcessTree(child.pid).then(
                () => reject(error),
                () => reject(new Error(`${error.message} AI process-tree cleanup failed.`))
            );
        };
        const timer = setTimeout(() => fail(new Error('AI command timed out after two minutes.')), timeoutMs);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        const append = (chunk: string, isError: boolean) => {
            if (settled) return;
            bytes += Buffer.byteLength(chunk);
            if (bytes > maxOutputBytes) {
                fail(new Error('AI command exceeded the output limit.'));
                return;
            }
            if (isError) stderr += chunk;
            else stdout += chunk;
        };
        child.stdout.on('data', chunk => append(chunk, false));
        child.stderr.on('data', chunk => append(chunk, true));
        // A CLI may exit without consuming stdin. EPIPE must not crash the host.
        child.stdin.on('error', error => {
            if ((error as NodeJS.ErrnoException).code !== 'EPIPE') fail(error);
        });
        child.on('error', error => fail(new Error(
            (error as NodeJS.ErrnoException).code === 'ENOENT'
                ? 'AI command was not found. Configure aoh.git.ai.command.'
                : 'AI command could not be started.'
        )));
        child.on('close', code => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr.trim() || stdout.trim() || `AI command exited with code ${code ?? 'unknown'}.`));
        });
        child.stdin.end(usesPlaceholder ? undefined : `${context}\n\nSelected diff:\n${diff}`);
    });
}
