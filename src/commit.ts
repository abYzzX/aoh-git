import * as path from 'path';

interface CommitRepository {
    state: { indexChanges: ReadonlyArray<{ uri: { fsPath: string } }> };
    restore(paths: string[], options: { staged: boolean }): Promise<void>;
    add(paths: string[]): Promise<void>;
    commit(message: string, options: { postCommitCommand: null }): Promise<void>;
}

/** Report the local commit before attempting an independently fallible push. */
export async function commitSelection(
    repo: CommitRepository, files: string[], message: string,
    onCommitted: () => void, push?: () => Promise<void>
): Promise<void> {
    const selected = new Set(files.map(file => path.normalize(file)));
    const excluded = repo.state.indexChanges.map(change => change.uri.fsPath)
        .filter(file => !selected.has(path.normalize(file)));
    if (excluded.length) await repo.restore(excluded, { staged: true });
    await repo.add(files);
    await repo.commit(message, { postCommitCommand: null });
    onCommitted();
    await push?.();
}
