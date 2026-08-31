import * as vscode from 'vscode';
import { Repository } from './gitApi';

export async function commitMessage(
    repo: Repository,
    message: string,
    push: boolean
): Promise<void> {
    const trimmed = message.trim();

    if (!trimmed) {
        throw new Error('Enter a commit message first.');
    }

    if (repo.state.indexChanges.length === 0) {
        throw new Error('No staged changes. Tick the files you want to commit first.');
    }

    if (push && vscode.workspace.getConfiguration('aoh.git').get<boolean>('confirmPush', false)) {
        const answer = await vscode.window.showWarningMessage(
            `Commit and push "${trimmed}"?`,
            { modal: true },
            'Commit & Push'
        );

        if (answer !== 'Commit & Push') {
            return;
        }
    }

    await repo.commit(trimmed, { postCommitCommand: null });

    if (push) {
        const hasUpstream = !!repo.state.HEAD?.upstream;
        await repo.push(undefined, undefined, !hasUpstream);
    }

    await repo.status();
}
