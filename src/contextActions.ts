import * as vscode from 'vscode';
import * as path from 'path';
import { ContextAction } from './contextMenu';
import { createPatch, gitOutput, ignorePattern, relativePaths, resolveRevision, stashSelected } from './contextGit';
import { GitAPI, Repository, Status } from './gitApi';

export interface ContextHooks {
    rollback(repo: Repository, files: string[]): Promise<void>;
    branch(repo: string, action: 'push' | 'pull' | 'fetch' | 'create'): Promise<void>;
    branches(repo: string): Promise<void>;
    diff(repo: Repository, file: string): Promise<void>;
}

/** Host-side actions for the Changes view. All path operations stay in the selected repository. */
export class ContextActions {
    constructor(private readonly api: () => GitAPI | undefined, private readonly hooks: ContextHooks) {}

    async execute(action: ContextAction, repo: Repository, files: string[], folder?: string): Promise<void> {
        const root = repo.rootUri.fsPath;
        const paths = relativePaths(root, files);
        switch (action) {
            case 'rollback': this.requireResolved(repo, files); return this.hooks.rollback(repo, files);
            case 'add': await repo.add(files); return;
            case 'diff': {
                const file = await this.pickFile(root, files, 'Show Diff');
                if (file) await this.hooks.diff(repo, file);
                return;
            }
            case 'source': {
                const file = await this.pickFile(root, files, 'Jump to Source');
                if (file) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
                return;
            }
            case 'copyPath':
            case 'copyRelativePath': {
                const targets = folder ? [path.resolve(root, folder)] : files;
                const relative = relativePaths(root, targets);
                await vscode.env.clipboard.writeText((action === 'copyPath' ? targets : relative).join('\n'));
                return;
            }
            case 'delete': {
                if (!await this.confirm(`Delete ${files.length} selected file(s)?`, 'Delete')) return;
                for (const file of files) {
                    try { await vscode.workspace.fs.delete(vscode.Uri.file(file), { useTrash: true }); }
                    catch (error) {
                        if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
                    }
                }
                return;
            }
            case 'ignore': return this.addIgnore(repo, paths);
            case 'patchFile':
            case 'patchClipboard': {
                this.requireResolved(repo, files);
                const patch = await createPatch(root, this.includeRenameSources(repo, files));
                if (!patch) { await vscode.window.showInformationMessage('The selected changes produce an empty patch.'); return; }
                if (action === 'patchClipboard') await vscode.env.clipboard.writeText(patch);
                else {
                    const target = await vscode.window.showSaveDialog({
                        title: 'Create Patch from Local Changes', defaultUri: vscode.Uri.joinPath(repo.rootUri, 'changes.patch'),
                        filters: { Patch: ['patch', 'diff'] }
                    });
                    if (target) await vscode.workspace.fs.writeFile(target, Buffer.from(patch, 'utf8'));
                }
                return;
            }
            case 'compareRevision':
            case 'compareRef': {
                const ref = action === 'compareRevision'
                    ? await vscode.window.showInputBox({ title: 'Compare with Revision', prompt: 'Commit hash or revision', value: 'HEAD' })
                    : await this.pickRef(root, 'Compare with Branch or Tag');
                if (!ref) return;
                const hash = await resolveRevision(root, ref);
                const file = await this.pickFile(root, files, 'Select file to compare');
                if (file) {
                    const uri = vscode.Uri.file(file);
                    const right = await vscode.workspace.fs.stat(uri).then(() => uri, async error => {
                        if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
                        return (await vscode.workspace.openTextDocument({ content: '' })).uri;
                    });
                    await vscode.commands.executeCommand('vscode.diff', this.api()!.toGitUri(uri, hash), right,
                        `${path.basename(file)} (${ref} ↔ Working Tree)`);
                }
                return;
            }
            case 'history': {
                const file = await this.pickFile(root, files, 'Show History');
                if (!file) return;
                const commits = await repo.log({ maxEntries: 100, path: path.relative(root, file) });
                if (!commits.length) { await vscode.window.showInformationMessage('No committed history for this file.'); return; }
                const picked = await vscode.window.showQuickPick(commits.map(commit => ({
                    label: commit.message.split('\n')[0], description: commit.hash.slice(0, 10), hash: commit.hash
                })), { title: `History: ${path.basename(file)}`, placeHolder: 'Select a commit to view its patch (latest 100)' });
                if (picked) {
                    const content = await gitOutput(root, ['show', '--format=fuller', '--patch', '--no-ext-diff', '--no-textconv',
                        picked.hash, '--', path.relative(root, file)]);
                    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language: 'diff' }));
                }
                return;
            }
            case 'push': case 'pull': case 'fetch': return this.hooks.branch(root, action);
            case 'branches': return this.hooks.branches(root);
            case 'newBranch': return this.hooks.branch(root, 'create');
            case 'merge': case 'rebase': {
                this.requireResolved(repo);
                const ref = await this.pickRef(root, action === 'merge' ? 'Merge into Current Branch' : 'Rebase Current Branch onto');
                if (!ref) return;
                const hash = await resolveRevision(root, ref);
                if (!await this.confirm(`${action === 'merge' ? 'Merge' : 'Rebase onto'} ${ref} in ${path.basename(root)}?`,
                    action === 'merge' ? 'Merge' : 'Rebase')) return;
                if (action === 'merge') await repo.merge(hash);
                else await gitOutput(root, ['rebase', hash]);
                return;
            }
            case 'newTag': {
                const name = await vscode.window.showInputBox({ title: 'New Tag', prompt: 'Local tag name (at HEAD)' });
                if (!name) return;
                await gitOutput(root, ['check-ref-format', `refs/tags/${name}`]);
                if (name.startsWith('-')) throw new Error('Tag names must not start with a hyphen.');
                const message = await vscode.window.showInputBox({ title: 'New Tag', prompt: 'Annotation (leave empty for a lightweight tag)' });
                if (message === undefined) return;
                await repo.tag(name, message);
                return;
            }
            case 'reset': return this.reset(repo);
            case 'stash': {
                this.requireResolved(repo);
                const message = await vscode.window.showInputBox({ title: 'Stash Selected Changes', prompt: 'Stash message (optional)' });
                if (message === undefined) return;
                await stashSelected(root, this.includeRenameSources(repo, files), message);
                return;
            }
            case 'remotes': return this.remotes(repo);
            case 'clone': await vscode.commands.executeCommand('git.clone'); return;
            case 'refresh': return;
            default: throw new Error('This action is not available.');
        }
    }

    private includeRenameSources(repo: Repository, files: string[]): string[] {
        const selected = new Set(files);
        for (const change of repo.state.indexChanges) {
            if (change.status === Status.INDEX_RENAMED && selected.has(change.uri.fsPath)) selected.add(change.originalUri.fsPath);
        }
        return [...selected];
    }

    private requireResolved(repo: Repository, files?: string[]): void {
        if (repo.state.mergeChanges.some(change => !files || files.includes(change.uri.fsPath))) {
            throw new Error('Resolve the merge conflicts before performing this action.');
        }
    }

    private async pickFile(root: string, files: string[], title: string): Promise<string | undefined> {
        if (files.length === 1) return files[0];
        return (await vscode.window.showQuickPick(files.map(file => ({ label: path.relative(root, file), file })), { title }))?.file;
    }

    private async pickRef(root: string, title: string): Promise<string | undefined> {
        const output = await gitOutput(root, ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags']);
        const items = output.split(/\r?\n/).filter(Boolean).map(line => line.split('\0'))
            .filter(([, symref]) => !symref).map(([ref]) => ({ label: ref.replace(/^refs\//, ''), ref }));
        return (await vscode.window.showQuickPick(items, { title }))?.ref;
    }

    private async confirm(message: string, action: string): Promise<boolean> {
        return await vscode.window.showWarningMessage(message, { modal: true }, action) === action;
    }

    private async addIgnore(repo: Repository, paths: string[]): Promise<void> {
        const patterns = paths.map(ignorePattern);
        const uri = vscode.Uri.joinPath(repo.rootUri, '.gitignore');
        try { await vscode.workspace.fs.stat(uri); }
        catch (error) {
            if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
            const create = new vscode.WorkspaceEdit();
            create.createFile(uri, { ignoreIfExists: true });
            if (!await vscode.workspace.applyEdit(create)) throw new Error('Could not create .gitignore.');
        }
        const document = await vscode.workspace.openTextDocument(uri);
        const text = document.getText();
        const existing = new Set(text.split(/\r?\n/));
        const additions = patterns.filter(pattern => !existing.has(pattern));
        if (!additions.length) return;
        const newline = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, document.positionAt(text.length), (text && !text.endsWith('\n') ? newline : '') + additions.join(newline) + newline);
        if (!await vscode.workspace.applyEdit(edit)) throw new Error('Could not update .gitignore.');
        await vscode.window.showTextDocument(document);
        await document.save();
        if (repo.state.indexChanges.concat(repo.state.workingTreeChanges).some(change => change.status !== Status.UNTRACKED && paths.includes(path.relative(repo.rootUri.fsPath, change.uri.fsPath).split(path.sep).join('/')))) {
            await vscode.window.showInformationMessage('Ignore rules were added. Already tracked files remain tracked by Git.');
        }
    }

    private async reset(repo: Repository): Promise<void> {
        this.requireResolved(repo);
        const revision = await vscode.window.showInputBox({ title: 'Reset HEAD', prompt: 'Target commit or revision', value: 'HEAD' });
        if (!revision) return;
        const hash = await resolveRevision(repo.rootUri.fsPath, revision);
        const mode = await vscode.window.showQuickPick([
            { label: 'Soft', description: 'Keep index and working files', value: '--soft' },
            { label: 'Mixed', description: 'Reset index, keep working files', value: '--mixed' },
            { label: 'Hard', description: 'Discard tracked local changes throughout this repository', value: '--hard' }
        ], { title: 'Reset HEAD — select mode' });
        if (!mode || !await this.confirm(`${mode.label} reset of ${path.basename(repo.rootUri.fsPath)} to ${revision}? ${mode.description}.`, 'Reset HEAD')) return;
        await gitOutput(repo.rootUri.fsPath, ['reset', mode.value, hash]);
    }

    private async remotes(repo: Repository): Promise<void> {
        const root = repo.rootUri.fsPath;
        const names = (await gitOutput(root, ['remote'])).split(/\r?\n/).filter(Boolean);
        const selected = await vscode.window.showQuickPick([{ label: 'Add Remote...', name: '' }, ...names.map(name => ({ label: name, name }))],
            { title: 'Manage Remotes' });
        if (!selected) return;
        if (!selected.name) {
            const name = await vscode.window.showInputBox({ title: 'Add Remote', prompt: 'Remote name', value: 'origin' });
            if (!name) return;
            if (name.startsWith('-')) throw new Error('Remote names must not start with a hyphen.');
            const url = await vscode.window.showInputBox({ title: 'Add Remote', prompt: 'Remote URL', ignoreFocusOut: true });
            if (url) await repo.addRemote(name, url);
            return;
        }
        const operation = await vscode.window.showQuickPick(['Edit URL...', 'Rename...', 'Remove...'], { title: `Remote: ${selected.name}` });
        if (operation === 'Remove...') {
            if (await this.confirm(`Remove remote ${selected.name}?`, 'Remove Remote')) await repo.removeRemote(selected.name);
        } else if (operation === 'Rename...') {
            const name = await vscode.window.showInputBox({ title: 'Rename Remote', value: selected.name });
            if (!name) return;
            if (name.startsWith('-')) throw new Error('Remote names must not start with a hyphen.');
            await repo.renameRemote(selected.name, name);
        } else if (operation === 'Edit URL...') {
            const current = (await gitOutput(root, ['remote', 'get-url', selected.name])).trim();
            const url = await vscode.window.showInputBox({ title: 'Edit Remote URL', value: current, ignoreFocusOut: true });
            if (url) await gitOutput(root, ['remote', 'set-url', selected.name, url]);
        }
    }
}
