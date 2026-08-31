import * as vscode from 'vscode';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { Repository } from './gitApi';

const execFileAsync = promisify(execFile);

export function isAiEnabled(): boolean {
    return vscode.workspace.getConfiguration('aoh.git').get<boolean>('ai.enabled', false);
}

export async function generateCommitMessage(repo: Repository): Promise<string> {
    if (!isAiEnabled()) {
        throw new Error('AI support is disabled. Enable aoh.git.ai.enabled first.');
    }

    const cwd = repo.rootUri.fsPath;
    const [{ stdout: diff }, { stdout: history }] = await Promise.all([
        execFileAsync('git', ['diff', '--cached', '--no-ext-diff', '--unified=3'], {
            cwd,
            maxBuffer: 4 * 1024 * 1024
        }),
        execFileAsync('git', ['log', '-8', '--pretty=%s'], {
            cwd,
            maxBuffer: 512 * 1024
        }).catch(() => ({ stdout: '', stderr: '' }))
    ]);

    const cleanDiff = String(diff).trim();
    if (!cleanDiff) {
        throw new Error('The staged diff is empty.');
    }

    const maxDiffChars = 120_000;
    const diffForPrompt = cleanDiff.length > maxDiffChars
        ? cleanDiff.slice(0, maxDiffChars)
        : cleanDiff;

    const context = [
        'Generate a concise Git commit message for the staged changes.',
        '',
        'Rules:',
        '- Return only the commit message. No Markdown, quotes, explanation, or code fences.',
        '- Prefer one short subject line. Add a body only if the changes genuinely need explanation.',
        '- Describe what changed and, when useful, why.',
        '- Match the style of the recent commit subjects when possible.',
        '- Do not invent changes that are not present in the diff.',
        '',
        'Recent commit subjects:',
        String(history).trim() || '(none available)'
    ].join('\n');

    const config = vscode.workspace.getConfiguration('aoh.git');
    const command = config.get<string>('ai.command', 'codex').trim() || 'codex';
    const configuredArgs = config.get<string[]>('ai.arguments', ['exec', '--color', 'never', '-']);

    return (await runAi(command, configuredArgs, cwd, context, diffForPrompt)).trim();
}

async function runAi(
    command: string,
    configuredArgs: string[],
    cwd: string,
    context: string,
    diff: string
): Promise<string> {
    const hasPlaceholder = configuredArgs.some(arg => arg.includes('{Context}') || arg.includes('{Diff}'));
    const args = configuredArgs.map(arg => arg
        .replaceAll('{Context}', context)
        .replaceAll('{Diff}', diff));

    const stdin = hasPlaceholder
        ? undefined
        : `${context}\n\nStaged diff:\n${diff}`;

    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => stdout += chunk);
        child.stderr.on('data', chunk => stderr += chunk);

        child.on('error', error => {
            if (settled) return;
            settled = true;
            const code = (error as NodeJS.ErrnoException).code;
            reject(code === 'ENOENT'
                ? new Error(`AI command '${command}' was not found. Configure aoh.git.ai.command.`)
                : error);
        });

        child.on('close', code => {
            if (settled) return;
            settled = true;
            if (code === 0) {
                resolve(stdout);
                return;
            }
            reject(new Error(stderr.trim() || stdout.trim() || `AI command exited with code ${code ?? 'unknown'}.`));
        });

        if (stdin !== undefined) child.stdin.end(stdin);
        else child.stdin.end();
    });
}
