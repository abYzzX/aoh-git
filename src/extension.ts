import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FileIconThemeService } from './fileIconThemeService';

import { Status, Change, Repository, GitAPI, GitExtension } from './gitApi';
import { parseLocalBranches, parseRemoteBranches, splitRemoteBranch } from './gitOutput';
import { renderWebview } from './webview';
import { ContextActions } from './contextActions';
import { ContextAction, isContextAction } from './contextMenu';
import { relativePaths } from './contextGit';
import { RefreshQueue } from './refreshQueue';
import { StashStore } from './stashStore';
import { runAi } from './ai';
import { commitSelection } from './commit';
import { selectedDiff, maxDiffChars } from './selectedDiff';

const execFileAsync = promisify(execFile);

type WebMessage =
    | { type: 'ready' }
    | { type: 'selectCommitMessage'; repo: string }
    | { type: 'contextAction'; action: ContextAction; repo: string; files: string[]; folder?: string }
    | { type: 'open'; repo: string; file: string }
    | { type: 'diff'; repo: string; file: string; staged: boolean; status: Status }
    | { type: 'commit'; repo: string; message: string; files: string[] }
    | { type: 'commitPush'; repo: string; message: string; files: string[] }
    | { type: 'generateCommitMessage'; repo: string; files: string[] }
    | { type: 'refresh' }
    | { type: 'selectBranch'; repo: string }
    | { type: 'branchAction'; repo: string; action: 'checkout' | 'checkoutRemote' | 'create' | 'createFrom' | 'merge' | 'delete' | 'deleteRemote' | 'pull' | 'fetch' | 'push'; branch?: string; remote?: string; remoteBranch?: string }
    | { type: 'toggleViewMode' }
    | { type: 'rollback'; repo: string; files: string[] }
    | { type: 'createStash'; repo: string; message: string; includeUntracked: boolean }
    | { type: 'stashAction'; repo: string; action: 'apply' | 'pop' | 'drop'; ref: string }
    | { type: 'loadStash'; repo: string; hash: string }
    | { type: 'stashDiff'; repo: string; ref: string; file: string; untracked: boolean }
    | { type: 'debug'; message: string };

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('AOH - Git');
    context.subscriptions.push(output);
    output.appendLine('[activate] AOH - Git starting.');

    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
        output.appendLine('[activate] ERROR: built-in Git extension was not found.');
        output.show(true);
        vscode.window.showErrorMessage('AOH - Git: built-in Git extension was not found.');
        return;
    }

    const provider = new BetterGitViewProvider(context, context.extensionUri, gitExtension, output);
    context.subscriptions.push(
        provider,
        vscode.window.registerWebviewViewProvider('aoh.git.view', provider, {
            webviewOptions: { retainContextWhenHidden: true }
        }),
        vscode.commands.registerCommand('aoh.git.refresh', () => provider.refresh()),
        vscode.commands.registerCommand('aoh.git.selectBranch', () => provider.selectBranch()),
        vscode.commands.registerCommand('aoh.git.toggleViewMode', () => provider.toggleViewMode()),
        vscode.commands.registerCommand('aoh.git.fetch', () => provider.runRepositoryAction('fetch')),
        vscode.commands.registerCommand('aoh.git.pull', () => provider.runRepositoryAction('pull')),
        vscode.commands.registerCommand('aoh.git.push', () => provider.runRepositoryAction('push')),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('workbench.iconTheme')) {
                provider.reloadFileIconTheme();
            } else if (e.affectsConfiguration('aoh.git')) {
                provider.refresh();
            }
        }),
        vscode.window.onDidChangeActiveColorTheme(() => provider.reloadFileIconTheme())
    );
}

class BetterGitViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private view?: vscode.WebviewView;
    private api?: GitAPI;
    private enablementSubscription?: vscode.Disposable;
    private repoSubscriptions: vscode.Disposable[] = [];
    private readonly refreshQueue = new RefreshQueue(() => this.refreshState());
    private readonly stashStore = new StashStore();
    private readonly loadingStashes = new Set<string>();
    private readonly generatingRepos = new Set<string>();
    private readonly committingRepos = new Set<string>();
    private readonly contextOperations = new Set<string>();
    private readonly contextActions = new ContextActions(() => this.api, {
        rollback: (repo, files) => this.rollback(repo, files),
        branch: (root, action) => this.handleBranchAction(root, action),
        branches: root => this.selectBranch(root),
        diff: (repo, file) => this.openContextDiff(repo, file)
    });
    private selectingCommitMessage = false;
    private lastState = '';
    private readonly fileIconTheme: FileIconThemeService;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly extensionUri: vscode.Uri,
        private readonly gitExtension: vscode.Extension<GitExtension>,
        private readonly output: vscode.OutputChannel
    ) {
        this.fileIconTheme = new FileIconThemeService(output);
    }

    async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
        this.output.appendLine('[webview] Resolving AOH Git view.');
        this.view = view;
        this.lastState = '';
        await this.fileIconTheme.load(view.webview);
        this.applyWebviewOptions();
        view.webview.html = renderWebview(view.webview);

        const messages = view.webview.onDidReceiveMessage((message: WebMessage) => this.handle(message));
        view.onDidDispose(() => {
            messages.dispose();
            if (this.view === view) this.view = undefined;
        });

        try {
            await this.ensureGit();
            this.bindRepositories();
            await this.refresh();
        } catch (err) {
            this.logError('resolveWebviewView', err);
        }

    }

    dispose(): void {
        this.refreshQueue.dispose();
        for (const subscription of this.repoSubscriptions) subscription.dispose();
        this.repoSubscriptions = [];
        this.view = undefined;
    }

    async reloadFileIconTheme(): Promise<void> {
        if (!this.view) return;
        await this.fileIconTheme.load(this.view.webview);
        this.applyWebviewOptions();
        await this.refresh();
    }

    private applyWebviewOptions(): void {
        if (!this.view) return;
        const roots = [this.extensionUri];
        if (this.fileIconTheme.resourceRoot) roots.push(this.fileIconTheme.resourceRoot);
        this.view.webview.options = {
            enableScripts: true,
            localResourceRoots: roots
        };
    }

    private async ensureGit(): Promise<void> {
        this.output.appendLine(`[git] Extension active=${this.gitExtension.isActive}`);
        if (!this.gitExtension.isActive) {
            this.output.appendLine('[git] Activating built-in Git extension.');
            await this.gitExtension.activate();
        }
        if (!this.enablementSubscription) {
            this.enablementSubscription = this.gitExtension.exports.onDidChangeEnablement(() => {
                void this.ensureGit().then(() => {
                    this.bindRepositories();
                    return this.refresh();
                }).catch(error => this.logError('git', error));
            });
            this.context.subscriptions.push(this.enablementSubscription);
        }
        if (this.gitExtension.exports.enabled) {
            const api = this.gitExtension.exports.getAPI(1);
            this.api = api;
            this.output.appendLine(`[git] API ready. repositories=${api.repositories.length}`);
        } else {
            this.api = undefined;
            this.output.appendLine('[git] Built-in Git extension is disabled.');
        }
    }

    private bindRepositories(): void {
        for (const d of this.repoSubscriptions) {
            d.dispose();
        }
        this.repoSubscriptions = [];

        if (!this.api) {
            return;
        }

        for (const repo of this.api.repositories) {
            this.repoSubscriptions.push(repo.state.onDidChange(() => this.refresh()));
        }

        this.repoSubscriptions.push(
            this.api.onDidOpenRepository(repo => {
                this.repoSubscriptions.push(repo.state.onDidChange(() => this.refresh()));
                this.refresh();
            }),
            this.api.onDidCloseRepository(() => { this.bindRepositories(); void this.refresh(); })
        );
    }

    refresh(): Promise<void> {
        return this.refreshQueue.request();
    }

    private async refreshState(): Promise<void> {
        if (!this.view) {
            this.output.appendLine('[refresh] Skipped: webview not resolved yet.');
            return;
        }

        try {
            const repositories = this.api?.repositories ?? [];
            this.stashStore.retain(new Set(repositories.map(repo => repo.rootUri.fsPath)));
            this.output.appendLine(`[refresh] Start. repositories=${repositories.length}`);
            const listItemSpacing = vscode.workspace.getConfiguration('aoh.git').get<number>('listItemSpacing', 2);
            const viewMode = this.context.workspaceState.get<'flat' | 'tree'>('aoh.git.viewMode', 'flat');
            const aiEnabled = vscode.workspace.getConfiguration('aoh.git').get<boolean>('ai.enabled', false);

            const repositoryStates = await Promise.all(repositories.map(async repo => {
                const root = repo.rootUri.fsPath;
                const allChanges = this.dedupe([
                    ...repo.state.workingTreeChanges,
                    ...repo.state.mergeChanges,
                    ...repo.state.indexChanges,
                    ...(repo.state.untrackedChanges ?? [])
                ]);

                // Some versions of VS Code's built-in Git extension expose untracked files
                // only through workingTreeChanges. Classify by Git status instead of relying
                // on the optional untrackedChanges collection so the Tracked / Untracked
                // split remains correct.
                const untracked = allChanges.filter(change => change.status === Status.UNTRACKED);
                const tracked = allChanges.filter(change => change.status !== Status.UNTRACKED);
                const stagedFiles = repo.state.indexChanges.map(change => change.uri.fsPath);
                const stagedPathSet = new Set(stagedFiles.map(file => path.normalize(file)));
                const workingPathSet = new Set([...repo.state.workingTreeChanges, ...repo.state.mergeChanges, ...(repo.state.untrackedChanges ?? [])].map(change => path.normalize(change.uri.fsPath)));

                let branches: string[] = [];
                let remotes: Array<{ name: string; branches: string[] }> = [];
                try {
                    const [{ stdout: localStdout }, { stdout: remoteStdout }, { stdout: remoteNamesStdout }] = await Promise.all([
                        execFileAsync(
                            'git',
                            ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
                            { cwd: root }
                        ),
                        execFileAsync(
                            'git',
                            ['for-each-ref', '--format=%(refname:short)|%(symref)', 'refs/remotes/'],
                            { cwd: root }
                        ),
                        execFileAsync('git', ['remote'], { cwd: root })
                    ]);

                    branches = parseLocalBranches(localStdout);

                    const remoteMap = new Map<string, string[]>();
                    for (const shortName of parseRemoteBranches(remoteStdout)) {
                        const { remote, branch: remoteBranch } = splitRemoteBranch(shortName);
                        if (!remote) continue;
                        const list = remoteMap.get(remote) ?? [];
                        list.push(remoteBranch);
                        remoteMap.set(remote, list);
                    }

                    const remoteNames = remoteNamesStdout
                        .split(/\r?\n/)
                        .map(name => name.trim())
                        .filter(Boolean);

                    remotes = remoteNames.map(name => ({
                        name,
                        branches: (remoteMap.get(name) ?? []).sort((a, b) => a.localeCompare(b))
                    }));
                } catch (err) {
                    this.output.appendLine(`[refresh] Branch enumeration failed for ${root}: ${this.errorText(err)}`);
                    // Keep the view usable even if branch enumeration fails temporarily.
                }

                return {
                    root,
                    name: path.basename(root),
                    branch: repo.state.HEAD?.name ?? 'detached HEAD',
                    branches,
                    remotes,
                    ahead: repo.state.HEAD?.ahead ?? 0,
                    behind: repo.state.HEAD?.behind ?? 0,
                    hasUpstream: !!repo.state.HEAD?.upstream,
                    tracked: tracked.map(c => ({ ...this.serializeChange(root, c, this.view!.webview), stagedOnly: stagedPathSet.has(path.normalize(c.uri.fsPath)) && !workingPathSet.has(path.normalize(c.uri.fsPath)) })),
                    untracked: untracked.map(c => ({ ...this.serializeChange(root, c, this.view!.webview), stagedOnly: false })),
                    stagedFiles,
                    stashes: await this.stashStore.list(root).catch(error => {
                        this.output.appendLine(`[stash] Failed to list stashes: ${this.errorText(error)}`);
                        return [];
                    })
                };
            }));

            const folderNames = new Set<string>();
            for (const repoState of repositoryStates) {
                for (const file of [...repoState.tracked, ...repoState.untracked]) {
                    for (const part of file.dirParts) folderNames.add(part);
                }
            }

            const folderIcons = Object.fromEntries(
                [...folderNames].map(name => [name.toLowerCase(), this.fileIconTheme.resolveFolder(this.view!.webview, name)])
            );

            const state = {
                type: 'state',
                listItemSpacing,
                viewMode,
                aiEnabled,
                fileIconTheme: {
                    css: this.fileIconTheme.css,
                    defaultFolder: this.fileIconTheme.resolveFolder(this.view.webview, ''),
                    folders: folderIcons
                },
                repositories: repositoryStates
            };
            if (!this.view || this.refreshQueue.superseded) return;
            const serialized = JSON.stringify(state);
            if (serialized === this.lastState) return;
            const posted = await this.view.webview.postMessage(state);
            if (posted) this.lastState = serialized;
            this.output.appendLine(`[refresh] State posted=${posted}; repositories=${repositoryStates.length}; viewMode=${viewMode}`);
        } catch (err) {
            this.lastState = '';
            this.logError('refresh', err);
            this.view?.webview.postMessage({ type: 'fatalError', message: this.errorText(err) });
        }
    }

    private errorText(err: unknown): string {
        return err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack}` : ''}` : String(err);
    }

    private logError(area: string, err: unknown): void {
        this.output.appendLine(`[${area}] ERROR: ${this.errorText(err)}`);
        this.output.show(true);
    }

    private dedupe(changes: Change[]): Change[] {
        const seen = new Set<string>();
        return changes.filter(c => {
            const key = c.uri.fsPath;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    private serializeChange(root: string, change: Change, webview: vscode.Webview) {
        const rel = path.relative(root, change.uri.fsPath);
        const directory = path.dirname(rel) === '.' ? '' : path.dirname(rel);
        return {
            file: change.uri.fsPath,
            name: path.basename(rel),
            dir: directory,
            dirParts: directory ? directory.split(path.sep).filter(Boolean) : [],
            tooltip: this.statusLabel(change.status),
            status: change.status,
            icon: this.fileIconTheme.resolveFile(webview, change.uri.fsPath)
        };
    }

    private untrackedPathSet(repo: Repository): Set<string> {
        return new Set(
            [
                ...repo.state.workingTreeChanges,
                ...repo.state.mergeChanges,
                ...(repo.state.untrackedChanges ?? [])
            ]
                .filter(change => change.status === Status.UNTRACKED)
                .map(change => path.normalize(change.uri.fsPath))
        );
    }

    private statusLabel(status: Status): string {
        switch (status) {
            case Status.MODIFIED:
            case Status.INDEX_MODIFIED: return 'Modified';
            case Status.DELETED:
            case Status.INDEX_DELETED: return 'Deleted';
            case Status.UNTRACKED: return 'Untracked';
            case Status.INDEX_ADDED: return 'Added';
            case Status.INDEX_RENAMED: return 'Renamed';
            case Status.INDEX_COPIED: return 'Copied';
            case Status.BOTH_MODIFIED: return 'Merge conflict';
            default: return 'Changed';
        }
    }

    private repository(root: string): Repository | undefined {
        return this.api?.repositories.find(r => r.rootUri.fsPath === root);
    }

    private async handle(message: WebMessage): Promise<void> {
        if (message.type === 'debug') {
            this.output.appendLine(`[webview] ${message.message}`);
            return;
        }

        if (message.type === 'ready' || message.type === 'refresh') {
            if (message.type === 'ready') this.lastState = '';
            this.output.appendLine(`[webview] ${message.type}`);
            this.refresh();
            return;
        }

        if (message.type === 'toggleViewMode') {
            await this.toggleViewMode();
            return;
        }

        if (message.type === 'selectBranch') {
            await this.selectBranch(message.repo);
            return;
        }

        if (message.type === 'branchAction') {
            await this.handleBranchAction(message.repo, message.action, message.branch, message.remote, message.remoteBranch);
            return;
        }

        const repo = this.repository(message.repo);
        if (!repo) {
            if (message.type === 'selectCommitMessage') this.view?.webview.postMessage({ type: 'commitMessageHistoryFinished' });
            vscode.window.showErrorMessage('AOH - Git: repository is no longer available.');
            return;
        }

        try {
            switch (message.type) {
                case 'selectCommitMessage':
                    if (this.selectingCommitMessage) return;
                    this.selectingCommitMessage = true;
                    try { await this.selectCommitMessage(repo); }
                    finally {
                        this.selectingCommitMessage = false;
                        this.view?.webview.postMessage({ type: 'commitMessageHistoryFinished' });
                    }
                    return;
                case 'contextAction':
                    await this.handleContextAction(repo, message);
                    return;
                case 'loadStash': {
                    const key = JSON.stringify([message.repo, message.hash]);
                    if (this.loadingStashes.has(key)) return;
                    this.loadingStashes.add(key);
                    try {
                        await this.stashStore.load(message.repo, message.hash);
                        await this.refresh();
                    } catch (error) {
                        this.view?.webview.postMessage({ type: 'stashLoadError', repo: message.repo, hash: message.hash });
                        throw error;
                    } finally {
                        this.loadingStashes.delete(key);
                    }
                    return;
                }
                case 'open':
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.file));
                    return;
                case 'diff': {
                    const uri = vscode.Uri.file(message.file);
                    const title = `${path.basename(message.file)} (${message.staged ? 'Index' : 'Working Tree'})`;

                    // Match the built-in Git extension's diff model:
                    // staged:   HEAD <-> index
                    // unstaged: index <-> working tree
                    // untracked files have no left-hand side, so VS Code opens the file.
                    if (!message.staged && message.status === Status.UNTRACKED) {
                        await vscode.commands.executeCommand('vscode.open', uri);
                        return;
                    }

                    const left = this.api!.toGitUri(uri, message.staged ? 'HEAD' : '~');
                    const right = message.staged ? this.api!.toGitUri(uri, '') : uri;
                    await vscode.commands.executeCommand('vscode.diff', left, right, title);
                    return;
                }
                case 'rollback':
                    await this.rollback(repo, message.files);
                    break;
                case 'createStash':
                    await this.createStash(repo, message.message, message.includeUntracked);
                    break;
                case 'stashAction':
                    await this.handleStashAction(repo, message.action, message.ref);
                    break;
                case 'stashDiff':
                    await this.openStashDiff(repo, message.ref, message.file, message.untracked);
                    return;
                case 'generateCommitMessage':
                    if (this.generatingRepos.has(message.repo)) return;
                    this.generatingRepos.add(message.repo);
                    try { await this.generateCommitMessage(repo, message.files); }
                    finally {
                        this.generatingRepos.delete(message.repo);
                        this.view?.webview.postMessage({ type: 'commitMessageGeneration', repo: message.repo, running: false });
                    }
                    return;
                case 'commit':
                case 'commitPush':
                    if (this.committingRepos.has(message.repo) || this.contextOperations.has(message.repo)) {
                        this.view?.webview.postMessage({ type: 'commitFinished', repo: message.repo });
                        return;
                    }
                    this.committingRepos.add(message.repo);
                    try {
                        await this.commit(repo, message.message, message.type === 'commitPush', message.files);
                    } finally {
                        this.committingRepos.delete(message.repo);
                        this.view?.webview.postMessage({ type: 'commitFinished', repo: message.repo });
                        await repo.status();
                        await this.refresh();
                    }
                    return;
            }
            await repo.status();
            this.refresh();
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`AOH - Git: ${text}`);
        }
    }

    private async selectCommitMessage(repo: Repository): Promise<void> {
        const commits = repo.state.HEAD?.commit ? await repo.log({ maxEntries: 100 }) : [];
        if (!commits.length) {
            await vscode.window.showInformationMessage('This repository has no previous commit messages.');
            return;
        }
        const picked = await vscode.window.showQuickPick(commits.map(commit => {
            const [subject, ...body] = commit.message.split(/\r?\n/);
            return {
                label: subject || '(Empty commit message)',
                description: commit.hash.slice(0, 10),
                detail: body.join(' ').trim() || undefined,
                message: commit.message
            };
        }), {
            title: `Recent Commit Messages — ${path.basename(repo.rootUri.fsPath)}`,
            placeHolder: 'Select a message to reuse (latest 100 commits)',
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (picked) this.view?.webview.postMessage({
            type: 'commitMessageSelected', repo: repo.rootUri.fsPath, message: picked.message
        });
    }

    private async handleContextAction(repo: Repository, message: Extract<WebMessage, { type: 'contextAction' }>): Promise<void> {
        if (!isContextAction(message.action)) throw new Error('This menu action is not available.');
        if (!Array.isArray(message.files) || !message.files.every(file => typeof file === 'string')) throw new Error('Invalid file selection.');
        const root = repo.rootUri.fsPath;
        if (this.contextOperations.has(root) || this.committingRepos.has(root)) {
            vscode.window.showInformationMessage('Wait for the current repository operation to finish.');
            return;
        }
        const files = [...new Set(message.files)];
        relativePaths(root, files);
        if (message.folder !== undefined) {
            if (typeof message.folder !== 'string') throw new Error('Invalid folder selection.');
            relativePaths(root, [path.resolve(root, message.folder)]);
        }
        this.contextOperations.add(root);
        const mutates = new Set<ContextAction>(['add', 'rollback', 'delete', 'ignore', 'stash', 'push', 'pull', 'fetch',
            'merge', 'rebase', 'branches', 'newBranch', 'newTag', 'reset', 'remotes']);
        try {
            // Refresh before validating paths from a potentially stale webview snapshot.
            if (mutates.has(message.action)) await repo.status();
            const known = new Set([...repo.state.workingTreeChanges, ...repo.state.indexChanges,
                ...repo.state.mergeChanges, ...(repo.state.untrackedChanges ?? [])].map(change => path.normalize(change.uri.fsPath)));
            if (message.action !== 'refresh' && files.some(file => !known.has(path.normalize(file)))) throw new Error('The selection has changed. Refresh and select the files again.');
            await this.contextActions.execute(message.action, repo, files, message.folder);
        } finally {
            try {
                if (mutates.has(message.action) || message.action === 'refresh') {
                    await repo.status();
                    await this.refresh();
                }
            } finally {
                this.contextOperations.delete(root);
            }
        }
    }

    private async openContextDiff(repo: Repository, file: string): Promise<void> {
        const working = [...repo.state.workingTreeChanges, ...repo.state.mergeChanges, ...(repo.state.untrackedChanges ?? [])]
            .find(change => change.uri.fsPath === file);
        const change = working ?? repo.state.indexChanges.find(change => change.uri.fsPath === file);
        if (working?.status === Status.DELETED) {
            const empty = await vscode.workspace.openTextDocument({ content: '' });
            await vscode.commands.executeCommand('vscode.diff', this.api!.toGitUri(vscode.Uri.file(file), '~'), empty.uri,
                `${path.basename(file)} (Deleted)`);
        } else if (change) {
            await this.handle({ type: 'diff', repo: repo.rootUri.fsPath, file, staged: !working, status: change.status });
        }
    }

    private async createStash(repo: Repository, message: string, includeUntracked: boolean): Promise<void> {
        const args = ['stash', 'push'];
        if (includeUntracked) args.push('--include-untracked');
        if (message.trim()) args.push('-m', message.trim());

        this.output.appendLine(`[stash] Creating stash in ${repo.rootUri.fsPath}; includeUntracked=${includeUntracked}`);
        await execFileAsync('git', args, { cwd: repo.rootUri.fsPath, maxBuffer: 10 * 1024 * 1024 });
    }

    private async handleStashAction(repo: Repository, action: 'apply' | 'pop' | 'drop', ref: string): Promise<void> {
        if (action === 'drop') {
            const confirmed = await vscode.window.showWarningMessage(
                `Drop ${ref}? This permanently deletes the stash.`,
                { modal: true },
                'Drop Stash'
            );
            if (confirmed !== 'Drop Stash') return;
        }

        this.output.appendLine(`[stash] ${action} ${ref} in ${repo.rootUri.fsPath}`);
        try {
            await execFileAsync('git', ['stash', action, ref], { cwd: repo.rootUri.fsPath, maxBuffer: 10 * 1024 * 1024 });
        } finally {
            await repo.status();
            await this.refresh();
        }
    }

    private async openStashDiff(repo: Repository, ref: string, relativePath: string, untracked: boolean): Promise<void> {
        const uri = vscode.Uri.file(path.join(repo.rootUri.fsPath, relativePath));
        const title = `${path.basename(relativePath)} (${ref})`;

        if (untracked) {
            const right = this.api!.toGitUri(uri, `${ref}^3`);
            await vscode.commands.executeCommand('vscode.open', right, { preview: true });
            return;
        }

        const left = this.api!.toGitUri(uri, `${ref}^1`);
        const right = this.api!.toGitUri(uri, ref);
        await vscode.commands.executeCommand('vscode.diff', left, right, title);
    }

    private async rollback(repo: Repository, files: string[]): Promise<void> {
        const uniqueFiles = [...new Set(files)].filter(Boolean);
        if (!uniqueFiles.length) return;

        const label = uniqueFiles.length === 1
            ? path.basename(uniqueFiles[0])
            : `${uniqueFiles.length} files`;
        const confirmed = await vscode.window.showWarningMessage(
            `Rollback ${label}? All local changes in the selection will be permanently discarded.`,
            { modal: true },
            'Rollback'
        );
        if (confirmed !== 'Rollback') {
            this.output.appendLine(`[rollback] Cancelled: ${label}`);
            return;
        }

        const root = repo.rootUri.fsPath;
        const untracked = this.untrackedPathSet(repo);
        const untrackedFiles = uniqueFiles.filter(file => untracked.has(path.normalize(file)));
        const trackedFiles = uniqueFiles.filter(file => !untracked.has(path.normalize(file)));

        this.output.appendLine(`[rollback] repo=${root}; selected=${uniqueFiles.length}; tracked=${trackedFiles.length}; untracked=${untrackedFiles.length}`);

        if (trackedFiles.length) {
            const relativePaths = trackedFiles.map(file => path.relative(root, file));
            await execFileAsync(
                'git',
                ['--literal-pathspecs', 'restore', '--source=HEAD', '--staged', '--worktree', '--', ...relativePaths],
                { cwd: root, maxBuffer: 10 * 1024 * 1024 }
            );
        }

        for (const file of untrackedFiles) {
            this.output.appendLine(`[rollback] Removing untracked file: ${file}`);
            await vscode.workspace.fs.delete(vscode.Uri.file(file), { recursive: true, useTrash: false });
        }

        this.output.appendLine(`[rollback] Completed: ${label}`);
    }

    async toggleViewMode(): Promise<void> {
        const current = this.context.workspaceState.get<'flat' | 'tree'>('aoh.git.viewMode', 'flat');
        await this.context.workspaceState.update('aoh.git.viewMode', current === 'flat' ? 'tree' : 'flat');
        this.refresh();
    }

    async selectBranch(repoRoot?: string): Promise<void> {
        const repositories = this.api?.repositories ?? [];
        if (!repositories.length) {
            vscode.window.showWarningMessage('AOH - Git: no Git repository found.');
            return;
        }

        let repo = repoRoot ? this.repository(repoRoot) : undefined;
        if (!repo && repositories.length === 1) {
            repo = repositories[0];
        }

        if (!repo) {
            const pickedRepo = await vscode.window.showQuickPick(
                repositories.map(r => ({
                    label: path.basename(r.rootUri.fsPath),
                    description: r.state.HEAD?.name ?? 'detached HEAD',
                    repo: r
                })),
                { placeHolder: 'Select Git repository' }
            );
            if (!pickedRepo) return;
            repo = pickedRepo.repo;
        }

        if (!repo) return;
        const targetRepo = repo;

        try {
            const [{ stdout }, { stdout: remoteStdout }] = await Promise.all([
                execFileAsync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd: targetRepo.rootUri.fsPath }),
                execFileAsync('git', ['for-each-ref', '--format=%(refname:short)|%(symref)', 'refs/remotes/'], { cwd: targetRepo.rootUri.fsPath })
            ]);

            const current = targetRepo.state.HEAD?.name;
            const branches = parseLocalBranches(stdout);

            const createLabel = '$(add) Create new branch…';
            const picked = await vscode.window.showQuickPick(
                [
                    { label: createLabel, branch: undefined as string | undefined, remote: false },
                    ...branches.map(branch => ({
                        label: branch === current ? `$(check) ${branch}` : branch,
                        description: branch === current ? 'current branch' : undefined,
                        branch, remote: false
                    })),
                    ...parseRemoteBranches(remoteStdout).map(branch => ({ label: branch, description: 'remote', branch, remote: true }))
                ],
                { placeHolder: `Switch branch — ${path.basename(targetRepo.rootUri.fsPath)}` }
            );

            if (!picked) return;

            if (!picked.branch) {
                const name = await vscode.window.showInputBox({
                    title: 'Create Branch',
                    prompt: 'Name of the new branch',
                    placeHolder: 'feature/my-branch',
                    ignoreFocusOut: true
                });
                if (!name?.trim()) return;

                await execFileAsync('git', ['switch', '-c', name.trim()], { cwd: targetRepo.rootUri.fsPath });
            } else if (picked.remote) {
                const { remote, branch } = splitRemoteBranch(picked.branch);
                await this.handleBranchAction(targetRepo.rootUri.fsPath, 'checkoutRemote', undefined, remote, branch);
                return;
            } else if (picked.branch !== current) {
                await execFileAsync('git', ['switch', picked.branch], { cwd: targetRepo.rootUri.fsPath });
            } else {
                return;
            }

            await targetRepo.status();
            this.refresh();
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`AOH - Git: ${text}`);
        }
    }

    async runRepositoryAction(action: 'fetch' | 'pull' | 'push'): Promise<void> {
        const repositories = this.api?.repositories ?? [];
        if (!repositories.length) {
            vscode.window.showWarningMessage('AOH - Git: no Git repository found.');
            return;
        }

        let repo = repositories[0];
        if (repositories.length > 1) {
            const picked = await vscode.window.showQuickPick(
                repositories.map(candidate => ({
                    label: path.basename(candidate.rootUri.fsPath),
                    description: candidate.rootUri.fsPath,
                    repo: candidate
                })),
                { placeHolder: `${action === 'fetch' ? 'Fetch' : action === 'pull' ? 'Pull' : 'Push'} repository` }
            );
            if (!picked) return;
            repo = picked.repo;
        }

        await this.handleBranchAction(repo.rootUri.fsPath, action);
    }

    private async handleBranchAction(
        repoRoot: string,
        action: 'checkout' | 'checkoutRemote' | 'create' | 'createFrom' | 'merge' | 'delete' | 'deleteRemote' | 'pull' | 'fetch' | 'push',
        branch?: string,
        remote?: string,
        remoteBranch?: string
    ): Promise<void> {
        const repo = this.repository(repoRoot);
        if (!repo) {
            vscode.window.showErrorMessage('AOH - Git: repository is no longer available.');
            return;
        }

        const cwd = repo.rootUri.fsPath;
        const current = repo.state.HEAD?.name;

        try {
            switch (action) {
                case 'checkout':
                    if (!branch || branch === current) return;
                    await execFileAsync('git', ['switch', branch], { cwd });
                    break;

                case 'checkoutRemote': {
                    if (!remote || !remoteBranch) return;
                    const localExists = await this.localBranchExists(cwd, remoteBranch);
                    if (localExists) {
                        await execFileAsync('git', ['switch', remoteBranch], { cwd });
                    } else {
                        await execFileAsync('git', ['switch', '--track', `${remote}/${remoteBranch}`], { cwd });
                    }
                    break;
                }

                case 'create': {
                    const name = await this.askBranchName('Create Branch', current ? `Create from ${current}` : undefined);
                    if (!name) return;
                    await execFileAsync('git', ['switch', '-c', name], { cwd });
                    break;
                }

                case 'createFrom': {
                    if (!branch) return;
                    const name = await this.askBranchName('New Branch from Here', `Create from ${branch}`);
                    if (!name) return;
                    await execFileAsync('git', ['switch', '-c', name, branch], { cwd });
                    break;
                }

                case 'merge': {
                    if (!branch || branch === current) return;
                    await execFileAsync('git', ['merge', branch], { cwd });
                    break;
                }

                case 'delete': {
                    if (!branch) return;
                    if (branch === current) {
                        vscode.window.showWarningMessage(`AOH - Git: cannot delete the currently checked out branch "${branch}".`);
                        return;
                    }

                    const answer = await vscode.window.showWarningMessage(
                        `Delete local branch "${branch}"?`,
                        { modal: true },
                        'Delete'
                    );
                    if (answer !== 'Delete') return;

                    await execFileAsync('git', ['branch', '-d', branch], { cwd });
                    break;
                }

                case 'deleteRemote': {
                    if (!remote || !remoteBranch) return;
                    const answer = await vscode.window.showWarningMessage(
                        `Delete remote branch "${remote}/${remoteBranch}"?`,
                        { modal: true },
                        'Delete Remote Branch'
                    );
                    if (answer !== 'Delete Remote Branch') return;

                    await execFileAsync('git', ['push', remote, '--delete', remoteBranch], { cwd });
                    break;
                }

                case 'pull':
                    await execFileAsync('git', ['pull'], { cwd });
                    break;

                case 'fetch':
                    await execFileAsync('git', ['fetch', '--all', '--prune'], { cwd });
                    break;

                case 'push': {
                    const pushTarget = await this.resolvePushTarget(repo, remote);
                    if (!pushTarget) return;

                    if (pushTarget.publish) {
                        await execFileAsync(
                            'git',
                            ['push', '--set-upstream', pushTarget.remote, pushTarget.branch],
                            { cwd }
                        );
                    } else if (remote) {
                        await execFileAsync('git', ['push', remote, pushTarget.branch], { cwd });
                    } else {
                        await repo.push();
                    }
                    break;
                }
            }

            await repo.status();
            await this.refresh();
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`AOH - Git: ${text}`);
        }
    }

    private async resolvePushTarget(
        repo: Repository,
        requestedRemote?: string
    ): Promise<{ branch: string; remote: string; publish: boolean } | undefined> {
        const branch = repo.state.HEAD?.name;
        if (!branch) {
            vscode.window.showWarningMessage('AOH - Git: cannot push a detached HEAD.');
            return undefined;
        }

        const upstream = repo.state.HEAD?.upstream;
        if (upstream) {
            return {
                branch,
                remote: requestedRemote ?? upstream.remote,
                publish: false
            };
        }

        let remote = requestedRemote;
        if (!remote) {
            try {
                const { stdout } = await execFileAsync('git', ['remote'], { cwd: repo.rootUri.fsPath });
                const remotes = stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
                remote = remotes.includes('origin') ? 'origin' : remotes[0];
            } catch {
                remote = undefined;
            }
        }

        if (!remote) {
            vscode.window.showWarningMessage('AOH - Git: no remote is configured for this repository.');
            return undefined;
        }

        const answer = await vscode.window.showInformationMessage(
            `The branch "${branch}" has no remote branch. Publish this branch?`,
            { modal: true },
            'Publish Branch'
        );
        if (answer !== 'Publish Branch') return undefined;

        return { branch, remote, publish: true };
    }

    private async localBranchExists(cwd: string, branch: string): Promise<boolean> {
        try {
            await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd });
            return true;
        } catch {
            return false;
        }
    }

    private async askBranchName(title: string, prompt?: string): Promise<string | undefined> {
        const name = await vscode.window.showInputBox({
            title,
            prompt,
            placeHolder: 'feature/my-branch',
            ignoreFocusOut: true,
            validateInput: value => value.trim() ? undefined : 'Enter a branch name.'
        });

        return name?.trim() || undefined;
    }

    private async generateCommitMessage(repo: Repository, files: string[]): Promise<void> {
        const config = vscode.workspace.getConfiguration('aoh.git');
        if (!config.get<boolean>('ai.enabled', false)) {
            vscode.window.showInformationMessage('AOH - Git: AI support is disabled. Enable aoh.git.ai.enabled first.');
            return;
        }

        if (!files.length) {
            vscode.window.showWarningMessage('Select at least one file before generating a commit message.');
            return;
        }

        this.view?.webview.postMessage({
            type: 'commitMessageGeneration',
            repo: repo.rootUri.fsPath,
            running: true
        });

        try {
            const cwd = repo.rootUri.fsPath;
            const [{ stdout: diff }, { stdout: history }] = await Promise.all([
                this.diffForFiles(repo, files),
                execFileAsync('git', ['log', '-8', '--pretty=%s'], {
                    cwd,
                    maxBuffer: 512 * 1024
                }).catch(() => ({ stdout: '', stderr: '' }))
            ]);

            const cleanDiff = String(diff).trim();
            if (!cleanDiff) {
                vscode.window.showWarningMessage('The selected diff is empty.');
                return;
            }

            const truncated = cleanDiff.length > maxDiffChars;
            const diffForPrompt = truncated ? cleanDiff.slice(0, maxDiffChars) : cleanDiff;

            const context = [
                'Generate a concise Git commit message for the selected changes.',
                '',
                'Rules:',
                '- Return only the commit message. No Markdown, quotes, explanation, or code fences.',
                '- Prefer one short subject line. Add a body only if the changes genuinely need explanation.',
                '- Describe what changed and, when useful, why.',
                '- Match the style of the recent commit subjects when possible.',
                '- Do not invent changes that are not present in the diff.',
                '',
                'Recent commit subjects:',
                String(history).trim() || '(none available)',
                ...(truncated ? ['', `Note: the selected diff was truncated to ${maxDiffChars} characters.`] : [])
            ].join('\n');

            const command = config.get<string>('ai.command', 'codex').trim() || 'codex';
            const configuredArgs = config.get<string[]>('ai.arguments', ['exec', '--color', 'never', '-']);
            const args = Array.isArray(configuredArgs) ? configuredArgs : [];

            const generated = await runAi(command, args, cwd, context, diffForPrompt);
            const commitMessage = generated.trim();
            if (!commitMessage) {
                throw new Error('AI command returned an empty commit message.');
            }

            this.view?.webview.postMessage({
                type: 'generatedCommitMessage',
                repo: repo.rootUri.fsPath,
                message: commitMessage
            });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`AOH - Git: Could not generate a commit message. ${detail}`);
        } finally {
            this.view?.webview.postMessage({
                type: 'commitMessageGeneration',
                repo: repo.rootUri.fsPath,
                running: false
            });
        }
    }

    private async diffForFiles(repo: Repository, files: string[]): Promise<{ stdout: string; stderr: string }> {
        return { stdout: await selectedDiff(repo.rootUri.fsPath, files, this.untrackedPathSet(repo)), stderr: '' };
    }

    private async commit(repo: Repository, message: string, push: boolean, files: string[]): Promise<void> {
        const cleanMessage = message.trim();
        if (!cleanMessage) {
            vscode.window.showWarningMessage('Enter a commit message first.');
            return;
        }

        if (!files.length) {
            vscode.window.showWarningMessage('Select at least one file to commit.');
            return;
        }

        if (push && vscode.workspace.getConfiguration('aoh.git').get<boolean>('confirmPush', false)) {
            const answer = await vscode.window.showWarningMessage(
                `Commit and push "${cleanMessage}"?`,
                { modal: true },
                'Commit & Push'
            );
            if (answer !== 'Commit & Push') {
                return;
            }
        }

        const pushTarget = push ? await this.resolvePushTarget(repo) : undefined;
        if (push && !pushTarget) return;

        await commitSelection(repo, files, cleanMessage, () => {
            this.view?.webview.postMessage({ type: 'committed', repo: repo.rootUri.fsPath });
        }, pushTarget ? async () => {
            if (pushTarget.publish) {
                await execFileAsync('git', ['push', '--set-upstream', pushTarget.remote, pushTarget.branch],
                    { cwd: repo.rootUri.fsPath });
            } else {
                await repo.push();
            }
        } : undefined);
    }

}

export function deactivate() {}
