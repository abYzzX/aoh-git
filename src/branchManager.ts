import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitAPI, Repository } from './gitApi';

const execFileAsync = promisify(execFile);

export async function selectBranch(api: GitAPI | undefined, repoRoot?: string): Promise<void> {
    const repositories = api?.repositories ?? [];
    if (!repositories.length) {
        vscode.window.showWarningMessage('AOH - Git: no Git repository found.');
        return;
    }

    let repo = repoRoot ? repositories.find(r => r.rootUri.fsPath === repoRoot) : undefined;
    if (!repo && repositories.length === 1) repo = repositories[0];
    if (!repo) {
        const picked = await vscode.window.showQuickPick(
            repositories.map(r => ({
                label: path.basename(r.rootUri.fsPath),
                description: r.state.HEAD?.name ?? 'detached HEAD',
                repo: r
            })),
            { placeHolder: 'Select Git repository' }
        );
        if (!picked) return;
        repo = picked.repo;
    }

    if (!repo) return;
    await selectBranchForRepo(repo);
}

async function selectBranchForRepo(repo: Repository): Promise<void> {
    const cwd = repo.rootUri.fsPath;
    const current = repo.state.HEAD?.name;
    const [{ stdout: local }, { stdout: remote }] = await Promise.all([
        execFileAsync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd }),
        execFileAsync('git', ['for-each-ref', '--format=%(refname:short)|%(symref)', 'refs/remotes/'], { cwd })
    ]);

    const items: Array<{ label: string; description?: string; branchKind: 'create' | 'local' | 'remote'; value?: string }> = [
        { label: '$(add) Create new branch…', branchKind: 'create' }
    ];

    for (const branch of local.split(/\r?\n/).map(v => v.trim()).filter(Boolean).sort()) {
        items.push({
            label: branch === current ? `$(check) ${branch}` : `$(git-branch) ${branch}`,
            description: branch === current ? 'current branch' : 'local',
            branchKind: 'local',
            value: branch
        });
    }

    for (const line of remote.split(/\r?\n/).map(v => v.trim()).filter(Boolean).sort()) {
        const [name, symref] = line.split('|', 2);
        if (symref || name.endsWith('/HEAD')) continue;
        items.push({ label: `$(cloud) ${name}`, description: 'remote', branchKind: 'remote', value: name });
    }

    const picked = await vscode.window.showQuickPick(items, { placeHolder: `Switch branch — ${path.basename(cwd)}` });
    if (!picked) return;

    if (picked.branchKind === 'create') {
        const name = await vscode.window.showInputBox({ title: 'Create Branch', prompt: 'Name of the new branch', placeHolder: 'feature/my-branch' });
        if (!name?.trim()) return;
        await execFileAsync('git', ['switch', '-c', name.trim()], { cwd });
    } else if (picked.branchKind === 'local') {
        const branch = picked.value!;
        if (branch !== current) await execFileAsync('git', ['switch', branch], { cwd });
    } else {
        const remoteBranch = picked.value!;
        const slash = remoteBranch.indexOf('/');
        const branchName = slash >= 0 ? remoteBranch.slice(slash + 1) : remoteBranch;
        try {
            await execFileAsync('git', ['switch', branchName], { cwd });
        } catch {
            await execFileAsync('git', ['switch', '--track', remoteBranch], { cwd });
        }
    }

    await repo.status();
}

export async function fetchRepo(repo: Repository): Promise<void> {
    await execFileAsync('git', ['fetch', '--all', '--prune'], { cwd: repo.rootUri.fsPath });
    await repo.status();
}

export async function pullRepo(repo: Repository): Promise<void> {
    await execFileAsync('git', ['pull'], { cwd: repo.rootUri.fsPath });
    await repo.status();
}

export async function pushRepo(repo: Repository): Promise<void> {
    const hasUpstream = !!repo.state.HEAD?.upstream;
    await repo.push(undefined, undefined, !hasUpstream);
    await repo.status();
}
