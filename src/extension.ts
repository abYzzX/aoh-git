
import * as vscode from 'vscode';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

enum Status {
    INDEX_MODIFIED,
    INDEX_ADDED,
    INDEX_DELETED,
    INDEX_RENAMED,
    INDEX_COPIED,
    MODIFIED,
    DELETED,
    UNTRACKED,
    IGNORED,
    INTENT_TO_ADD,
    INTENT_TO_RENAME,
    TYPE_CHANGED,
    ADDED_BY_US,
    ADDED_BY_THEM,
    DELETED_BY_US,
    DELETED_BY_THEM,
    BOTH_ADDED,
    BOTH_DELETED,
    BOTH_MODIFIED
}

interface Change {
    readonly uri: vscode.Uri;
    readonly originalUri: vscode.Uri;
    readonly renameUri: vscode.Uri | undefined;
    readonly status: Status;
}

interface Branch {
    readonly name?: string;
    readonly upstream?: { remote: string; name: string; };
    readonly ahead?: number;
    readonly behind?: number;
}

interface RepositoryState {
    readonly HEAD: Branch | undefined;
    readonly indexChanges: Change[];
    readonly workingTreeChanges: Change[];
    readonly untrackedChanges: Change[];
    readonly mergeChanges: Change[];
    readonly onDidChange: vscode.Event<void>;
}

interface Repository {
    readonly rootUri: vscode.Uri;
    readonly state: RepositoryState;
    add(paths: string[]): Promise<void>;
    restore(paths: string[], options?: { staged?: boolean; ref?: string }): Promise<void>;
    commit(message: string, opts?: { all?: boolean | 'tracked'; postCommitCommand?: string | null }): Promise<void>;
    push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
    status(): Promise<void>;
}

interface GitAPI {
    readonly repositories: Repository[];
    readonly onDidOpenRepository: vscode.Event<Repository>;
    readonly onDidCloseRepository: vscode.Event<Repository>;
    toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

interface GitExtension {
    readonly enabled: boolean;
    readonly onDidChangeEnablement: vscode.Event<boolean>;
    getAPI(version: 1): GitAPI;
}

type WebMessage =
    | { type: 'ready' }
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
        vscode.window.registerWebviewViewProvider('aoh.git.view', provider, {
            webviewOptions: { retainContextWhenHidden: true }
        }),
        vscode.commands.registerCommand('aoh.git.refresh', () => provider.refresh()),
        vscode.commands.registerCommand('aoh.git.selectBranch', () => provider.selectBranch()),
        vscode.commands.registerCommand('aoh.git.toggleViewMode', () => provider.toggleViewMode()),
        vscode.commands.registerCommand('aoh.git.fetch', () => provider.runRepositoryAction('fetch')),
        vscode.commands.registerCommand('aoh.git.pull', () => provider.runRepositoryAction('pull')),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('aoh.git')) provider.refresh();
        })
    );
}

class BetterGitViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private api?: GitAPI;
    private repoSubscriptions: vscode.Disposable[] = [];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly extensionUri: vscode.Uri,
        private readonly gitExtension: vscode.Extension<GitExtension>,
        private readonly output: vscode.OutputChannel
    ) {}

    async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
        this.output.appendLine('[webview] Resolving AOH Git view.');
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = this.html(view.webview);

        view.webview.onDidReceiveMessage((message: WebMessage) => this.handle(message));

        try {
            await this.ensureGit();
            this.bindRepositories();
            await this.refresh();
        } catch (err) {
            this.logError('resolveWebviewView', err);
        }

        const git = this.gitExtension.exports;
        git.onDidChangeEnablement(() => {
            this.ensureGit().then(() => {
                this.bindRepositories();
                this.refresh();
            });
        });
    }

    private async ensureGit(): Promise<void> {
        this.output.appendLine(`[git] Extension active=${this.gitExtension.isActive}`);
        if (!this.gitExtension.isActive) {
            this.output.appendLine('[git] Activating built-in Git extension.');
            await this.gitExtension.activate();
        }
        if (this.gitExtension.exports.enabled) {
            const api = this.gitExtension.exports.getAPI(1);
            this.api = api;
            this.output.appendLine(`[git] API ready. repositories=${api.repositories.length}`);
        } else {
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
            this.api.onDidCloseRepository(() => this.refresh())
        );
    }

    async refresh(): Promise<void> {
        if (!this.view) {
            this.output.appendLine('[refresh] Skipped: webview not resolved yet.');
            return;
        }

        try {
            const repositories = this.api?.repositories ?? [];
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
                ...repo.state.untrackedChanges
            ]);

            // Some versions of VS Code's built-in Git extension expose untracked files
            // only through workingTreeChanges. Classify by Git status instead of relying
            // on the optional untrackedChanges collection so the Tracked / Untracked
            // split remains correct.
            const untracked = allChanges.filter(change => change.status === Status.UNTRACKED);
            const tracked = allChanges.filter(change => change.status !== Status.UNTRACKED);
            const stagedFiles = repo.state.indexChanges.map(change => change.uri.fsPath);
            const stagedPathSet = new Set(stagedFiles.map(file => path.normalize(file)));
            const workingPathSet = new Set([...repo.state.workingTreeChanges, ...repo.state.mergeChanges, ...repo.state.untrackedChanges].map(change => path.normalize(change.uri.fsPath)));

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

                branches = localStdout
                    .split(/\r?\n/)
                    .map(branch => branch.trim())
                    .filter(Boolean)
                    .sort((a, b) => a.localeCompare(b));

                const remoteMap = new Map<string, string[]>();
                for (const line of remoteStdout.split(/\r?\n/)) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    const [shortName, symref] = trimmed.split('|', 2);
                    if (symref) continue; // Ignore origin/HEAD-style symbolic refs.

                    const slash = shortName.indexOf('/');
                    if (slash <= 0 || slash === shortName.length - 1) continue;

                    const remote = shortName.slice(0, slash);
                    const remoteBranch = shortName.slice(slash + 1);
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
                tracked: tracked.map(c => ({ ...this.serializeChange(root, c), stagedOnly: stagedPathSet.has(path.normalize(c.uri.fsPath)) && !workingPathSet.has(path.normalize(c.uri.fsPath)) })),
                untracked: untracked.map(c => ({ ...this.serializeChange(root, c), stagedOnly: false })),
                stagedFiles,
                stashes: await this.readStashes(root)
            };
        }));

            const posted = await this.view.webview.postMessage({
                type: 'state',
                listItemSpacing,
                viewMode,
                aiEnabled,
                repositories: repositoryStates
            });
            this.output.appendLine(`[refresh] State posted=${posted}; repositories=${repositoryStates.length}; viewMode=${viewMode}`);
        } catch (err) {
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

    private serializeChange(root: string, change: Change) {
        const rel = path.relative(root, change.uri.fsPath);
        const directory = path.dirname(rel) === '.' ? '' : path.dirname(rel);
        return {
            file: change.uri.fsPath,
            name: path.basename(rel),
            dir: directory,
            dirParts: directory ? directory.split(path.sep).filter(Boolean) : [],
            tooltip: this.statusLabel(change.status),
            status: change.status
        };
    }

    private async readStashes(root: string) {
        try {
            const { stdout } = await execFileAsync(
                'git',
                ['stash', 'list', '--format=%gd%x1f%H%x1f%ct%x1f%gs'],
                { cwd: root, maxBuffer: 10 * 1024 * 1024 }
            );

            const entries = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            return await Promise.all(entries.map(async line => {
                const [ref, hash, timestamp, ...messageParts] = line.split('\x1f');
                const message = messageParts.join('\x1f');
                const untracked = new Set<string>();

                try {
                    const { stdout: untrackedStdout } = await execFileAsync(
                        'git',
                        ['ls-tree', '-r', '--name-only', `${ref}^3`],
                        { cwd: root, maxBuffer: 10 * 1024 * 1024 }
                    );
                    for (const file of untrackedStdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
                        untracked.add(file);
                    }
                } catch {
                    // A stash only has a third parent when untracked files were included.
                }

                const { stdout: filesStdout } = await execFileAsync(
                    'git',
                    ['stash', 'show', '--include-untracked', '--name-status', '--format=', '--no-renames', ref],
                    { cwd: root, maxBuffer: 10 * 1024 * 1024 }
                );

                const files = filesStdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(value => {
                    const tab = value.indexOf('\t');
                    const status = tab >= 0 ? value.slice(0, tab) : 'M';
                    const relativePath = tab >= 0 ? value.slice(tab + 1) : value;
                    return {
                        path: relativePath,
                        name: path.basename(relativePath),
                        dir: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath),
                        status,
                        untracked: untracked.has(relativePath)
                    };
                });

                return {
                    ref,
                    hash,
                    timestamp: Number(timestamp) || 0,
                    message,
                    files
                };
            }));
        } catch (err) {
            this.output.appendLine(`[stash] Failed to enumerate stashes for ${root}: ${this.errorText(err)}`);
            return [];
        }
    }

    private untrackedPathSet(repo: Repository): Set<string> {
        return new Set(
            [
                ...repo.state.workingTreeChanges,
                ...repo.state.mergeChanges,
                ...repo.state.untrackedChanges
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
            vscode.window.showErrorMessage('AOH - Git: repository is no longer available.');
            return;
        }

        try {
            switch (message.type) {
                case 'open':
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.file));
                    break;
                case 'diff': {
                    const uri = vscode.Uri.file(message.file);
                    const title = `${path.basename(message.file)} (${message.staged ? 'Index' : 'Working Tree'})`;

                    // Match the built-in Git extension's diff model:
                    // staged:   HEAD <-> index
                    // unstaged: index <-> working tree
                    // untracked files have no left-hand side, so VS Code opens the file.
                    if (!message.staged && message.status === Status.UNTRACKED) {
                        await vscode.commands.executeCommand('vscode.open', uri);
                        break;
                    }

                    const left = this.api!.toGitUri(uri, message.staged ? 'HEAD' : '~');
                    const right = message.staged ? this.api!.toGitUri(uri, '') : uri;
                    await vscode.commands.executeCommand('vscode.diff', left, right, title);
                    break;
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
                    break;
                case 'generateCommitMessage':
                    await this.generateCommitMessage(repo, message.files);
                    break;
                case 'commit':
                    await this.commit(repo, message.message, false, message.files);
                    break;
                case 'commitPush':
                    await this.commit(repo, message.message, true, message.files);
                    break;
            }
            await repo.status();
            this.refresh();
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`AOH - Git: ${text}`);
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
                ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...relativePaths],
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
            const { stdout } = await execFileAsync(
                'git',
                ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
                { cwd: targetRepo.rootUri.fsPath }
            );

            const current = targetRepo.state.HEAD?.name;
            const branches = stdout
                .split(/\r?\n/)
                .map(b => b.trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));

            const createLabel = '$(add) Create new branch…';
            const picked = await vscode.window.showQuickPick(
                [
                    { label: createLabel, branch: undefined as string | undefined },
                    ...branches.map(branch => ({
                        label: branch === current ? `$(check) ${branch}` : branch,
                        description: branch === current ? 'current branch' : undefined,
                        branch
                    }))
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

    async runRepositoryAction(action: 'fetch' | 'pull'): Promise<void> {
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
                { placeHolder: `${action === 'fetch' ? 'Fetch' : 'Pull'} repository` }
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

            const maxDiffChars = 120_000;
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

            const generated = await this.runAi(command, args, cwd, context, diffForPrompt);
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

    private runAi(command: string, configuredArgs: string[], cwd: string, context: string, diff: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const usesPlaceholder = configuredArgs.some(arg => arg.includes('{Context}') || arg.includes('{Diff}'));
            const args = configuredArgs.map(arg =>
                arg.replaceAll('{Context}', context).replaceAll('{Diff}', diff)
            );

            const child = spawn(command, args, {
                cwd,
                env: process.env,
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data', chunk => stdout += chunk);
            child.stderr.on('data', chunk => stderr += chunk);

            child.on('error', error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    reject(new Error(`AI command '${command}' was not found. Configure aoh.git.ai.command.`));
                    return;
                }
                reject(error);
            });

            child.on('close', code => {
                if (code === 0) {
                    resolve(stdout);
                    return;
                }
                reject(new Error(stderr.trim() || stdout.trim() || `AI command exited with code ${code ?? 'unknown'}.`));
            });

            if (usesPlaceholder) {
                child.stdin.end();
            } else {
                child.stdin.end(`${context}\n\nStaged diff:\n${diff}`);
            }
        });
    }

    private async diffForFiles(repo: Repository, files: string[]): Promise<{ stdout: string; stderr: string }> {
        const root = repo.rootUri.fsPath;
        const relativeFiles = files.map(file => path.relative(root, file));
        const { stdout } = await execFileAsync(
            'git',
            ['diff', 'HEAD', '--no-ext-diff', '--unified=3', '--', ...relativeFiles],
            { cwd: root, maxBuffer: 4 * 1024 * 1024 }
        );

        const untracked = this.untrackedPathSet(repo);
        const untrackedText: string[] = [];
        for (const file of files.filter(file => untracked.has(path.normalize(file)))) {
            try {
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
                untrackedText.push(`diff --git a/${path.relative(root, file)} b/${path.relative(root, file)}\nnew file\n${document.getText()}`);
            } catch {
                // Ignore unreadable/binary untracked files in the AI prompt.
            }
        }

        return { stdout: [String(stdout).trim(), ...untrackedText].filter(Boolean).join('\n\n'), stderr: '' };
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

        const selected = new Set(files.map(file => path.normalize(file)));
        const stagedButNotSelected = repo.state.indexChanges
            .map(change => change.uri.fsPath)
            .filter(file => !selected.has(path.normalize(file)));

        // The checkboxes represent AOH selection, not the Git index. Only now, at the
        // definitive commit action, synchronize the index with that selection.
        if (stagedButNotSelected.length) {
            await repo.restore(stagedButNotSelected, { staged: true });
        }
        await repo.add(files);
        await repo.commit(cleanMessage, { postCommitCommand: null });

        if (push && pushTarget) {
            if (pushTarget.publish) {
                await execFileAsync(
                    'git',
                    ['push', '--set-upstream', pushTarget.remote, pushTarget.branch],
                    { cwd: repo.rootUri.fsPath }
                );
            } else {
                await repo.push();
            }
        }

        this.view?.webview.postMessage({ type: 'committed', repo: repo.rootUri.fsPath });
    }

    private html(webview: vscode.Webview): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
:root { --list-item-spacing: 2px; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
body {
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
}
#app {
    height: 100%;
    display: flex;
    flex-direction: column;
}
#repos {
    flex: 1 1 auto;
    overflow: auto;
    padding: 4px 8px 14px;
}
.empty {
    color: var(--vscode-descriptionForeground);
    padding: 16px 8px;
    line-height: 1.5;
}
.repo { margin-bottom: 16px; }
.repo-header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 4px 5px 7px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
}
.repo-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.branch {
    margin-left: auto;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    font-size: 0.92em;
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 3px;
}
.branch:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
.branch-wrap { position: relative; margin-left: auto; }
.branch-wrap .branch { margin-left: 0; }
.context-menu {
    position: fixed;
    z-index: 10000;
    min-width: 170px;
    padding: 4px 0;
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border));
    border-radius: 4px;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    color: var(--vscode-menu-foreground, var(--vscode-dropdown-foreground));
    box-shadow: 0 4px 14px rgba(0, 0, 0, .3);
}
.context-menu.hidden { display: none; }
.context-menu-item {
    padding: 5px 24px 5px 10px;
    white-space: nowrap;
    cursor: default;
}
.context-menu-item:hover {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
}

.branch-menu {
    position: absolute;
    z-index: 100;
    top: calc(100% + 3px);
    right: 0;
    min-width: 210px;
    padding: 4px 0;
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border));
    border-radius: 4px;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    color: var(--vscode-menu-foreground, var(--vscode-dropdown-foreground));
    box-shadow: 0 4px 14px rgba(0,0,0,.28);
}
.branch-menu.hidden { display: none; }
.branch-menu-separator {
    height: 1px;
    margin: 4px 0;
    background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border));
}
.branch-entry,
.branch-action {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 26px;
    padding: 3px 9px;
    white-space: nowrap;
    cursor: default;
    user-select: none;
}
.branch-entry:hover,
.branch-action:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-menu-selectionForeground, var(--vscode-foreground)); }
.branch-entry.current { font-weight: 600; }
.branch-check { width: 13px; text-align: center; }
.branch-entry-arrow { margin-left: auto; color: var(--vscode-descriptionForeground); }
.branch-submenu {
    display: none;
    position: absolute;
    z-index: 110;
    top: -4px;
    left: 100%;
    right: auto;
    min-width: 190px;
    padding: 4px 0;
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border));
    border-radius: 4px;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    box-shadow: 0 4px 14px rgba(0,0,0,.28);
}
.branch-submenu.open { display: block; }
.remote-entry {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 26px;
    padding: 3px 9px;
    white-space: nowrap;
    cursor: default;
    user-select: none;
}
.remote-entry:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-menu-selectionForeground, var(--vscode-foreground)); }
.remote-submenu.open { display: block; }
.remote-submenu {
    display: none;
    position: absolute;
    z-index: 115;
    top: -4px;
    left: 100%;
    right: auto;
    min-width: 210px;
    padding: 4px 0;
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border));
    border-radius: 4px;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    box-shadow: 0 4px 14px rgba(0,0,0,.28);
}
.remote-branch-entry { position: relative; }


.menu-header {
    display: flex;
    align-items: center;
    min-height: 28px;
    padding: 3px 9px;
    font-weight: 600;
    border-bottom: 1px solid var(--vscode-menu-separatorBackground, var(--vscode-widget-border));
    cursor: pointer;
    user-select: none;
}
.menu-header:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); }
.branch-submenu, .remote-submenu {
    top: -4px !important;
    left: auto !important;
    right: 0 !important;
    min-width: 100% !important;
}

.branch-action.disabled { opacity: .45; pointer-events: none; }
.tabs {
    flex: 0 0 auto;
    display: flex;
    padding: 0 8px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
}
.tab {
    appearance: none;
    min-height: 32px;
    padding: 0 10px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: transparent;
    color: var(--vscode-descriptionForeground);
}
.tab:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
.tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
.stash-create {
    margin: 8px 5px 12px;
    padding: 8px;
    border: 1px solid var(--vscode-sideBarSectionHeader-border);
    border-radius: 4px;
}
.stash-create-row { display: flex; gap: 6px; }
.stash-message {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 4px 7px;
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font: inherit;
    outline: none;
}
.stash-message:focus { border-color: var(--vscode-focusBorder); }
.stash-create-button { min-height: 28px; padding: 0 10px; }
.stash-options { margin-top: 7px; color: var(--vscode-descriptionForeground); font-size: .9em; }
.stash-options label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.stash-card { margin: 8px 5px; border: 1px solid var(--vscode-sideBarSectionHeader-border); border-radius: 4px; overflow: hidden; }
.stash-summary { display: flex; align-items: center; gap: 7px; min-height: 32px; padding: 4px 7px; cursor: pointer; list-style: none; }
.stash-summary::-webkit-details-marker { display: none; }
.stash-summary::before { content: '▸'; width: 12px; color: var(--vscode-descriptionForeground); }
.stash-card[open] > .stash-summary::before { content: '▾'; }
.stash-summary:hover { background: var(--vscode-list-hoverBackground); }
.stash-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stash-ref { color: var(--vscode-descriptionForeground); font-size: .9em; }
.stash-actions { display: flex; gap: 4px; padding: 6px 7px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border); }
.stash-action { min-height: 25px; padding: 0 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.stash-files { border-top: 1px solid var(--vscode-sideBarSectionHeader-border); padding: 4px 0; }
.stash-file { display: flex; align-items: baseline; gap: 8px; min-height: 26px; padding: 3px 8px; cursor: pointer; }
.stash-file:hover { background: var(--vscode-list-hoverBackground); }
.stash-status { width: 14px; flex: 0 0 14px; color: var(--vscode-descriptionForeground); font-weight: 600; }
.stash-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stash-file-dir { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: .9em; }
.stash-meta { color: var(--vscode-descriptionForeground); font-size: .85em; white-space: nowrap; }
.group { margin-top: 8px; }
.group-title {
    display: flex;
    align-items: center;
    min-height: 30px;
    padding: 0 5px;
    font-weight: 600;
    color: var(--vscode-sideBarSectionHeader-foreground);
}
.count {
    margin-left: 7px;
    color: var(--vscode-descriptionForeground);
    font-weight: 400;
}
.group-spacer { flex: 1; }
.group-check,
.folder-check {
    appearance: none;
    width: 15px;
    height: 15px;
    flex: 0 0 15px;
    margin: 0 7px 0 0;
    border: 1px solid var(--vscode-checkbox-border);
    border-radius: 3px;
    background: var(--vscode-checkbox-background);
    cursor: pointer;
    position: relative;
}
.group-check:checked,
.folder-check:checked {
    background: var(--vscode-checkbox-selectBackground, var(--vscode-button-background));
    border-color: var(--vscode-checkbox-selectBorder, var(--vscode-button-background));
}
.group-check:checked::after,
.folder-check:checked::after {
    content: "✓";
    position: absolute;
    inset: -4px 0 0 1px;
    color: var(--vscode-checkbox-foreground, var(--vscode-button-foreground));
    font-size: 15px;
}
.file-row {
    min-height: 26px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 7px;
    border-radius: 4px;
    margin-bottom: var(--list-item-spacing);
    cursor: default;
}
.file-row:hover { background: var(--vscode-list-hoverBackground); }
.file-row:focus-within { background: var(--vscode-list-focusBackground); }
.file-row.git-modified .file-name {
    color: var(--vscode-gitDecoration-modifiedResourceForeground);
}
.file-row.git-added .file-name {
    color: var(--vscode-gitDecoration-addedResourceForeground);
}
.file-row.git-deleted .file-name {
    color: var(--vscode-gitDecoration-deletedResourceForeground);
}
.file-row.git-renamed .file-name {
    color: var(--vscode-gitDecoration-renamedResourceForeground);
}
.file-row.git-conflict .file-name {
    color: var(--vscode-gitDecoration-conflictingResourceForeground);
}
.file-row.git-ignored .file-name {
    color: var(--vscode-gitDecoration-ignoredResourceForeground);
}
.file-check {
    appearance: none;
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    border: 1px solid var(--vscode-checkbox-border);
    border-radius: 3px;
    background: var(--vscode-checkbox-background);
    cursor: pointer;
    position: relative;
}
.file-check:checked {
    background: var(--vscode-checkbox-selectBackground, var(--vscode-button-background));
    border-color: var(--vscode-checkbox-selectBorder, var(--vscode-button-background));
}
.file-check:checked::after {
    content: "✓";
    position: absolute;
    inset: -3px 0 0 2px;
    color: var(--vscode-checkbox-foreground, var(--vscode-button-foreground));
    font-size: 15px;
}
.file-main {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 8px;
    cursor: pointer;
}
.file-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.file-dir {
    min-width: 0;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.tree-root { padding-left: 0; }
.tree-folder { margin: 0; }
.tree-folder > summary {
    min-height: 26px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 7px;
    cursor: pointer;
    user-select: none;
    color: var(--vscode-foreground);
    list-style: none;
}
.tree-folder > summary::-webkit-details-marker { display: none; }
.tree-folder > summary::before {
    content: "▾";
    width: 12px;
    color: var(--vscode-descriptionForeground);
}
.tree-folder:not([open]) > summary::before { content: "▸"; }
.tree-folder > summary:hover { background: var(--vscode-list-hoverBackground); }
.tree-children { padding-left: 14px; }
.tree-file .file-main { gap: 6px; }
.view-mode-label {
    margin-left: auto;
    color: var(--vscode-descriptionForeground);
    font-size: 0.82em;
    font-weight: 400;
}
.commit-area {
    flex: 0 0 auto;
    border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
    background: var(--vscode-sideBar-background);
    padding: 10px;
}
.message-wrap {
    position: relative;
}
textarea {
    display: block;
    width: 100%;
    min-height: 82px;
    max-height: 180px;
    resize: vertical;
    padding: 8px 38px 8px 9px;
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font: inherit;
    outline: none;
}
textarea:focus { border-color: var(--vscode-focusBorder); }
.ai-button {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 26px;
    height: 26px;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    font-size: 16px;
    line-height: 26px;
    cursor: pointer;
    opacity: .85;
}
.ai-button:hover {
    background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-foreground);
    opacity: 1;
}
.ai-button:disabled {
    opacity: .45;
    cursor: default;
}
.ai-button.generating {
    animation: ai-pulse 900ms ease-in-out infinite alternate;
}
@keyframes ai-pulse {
    from { opacity: .35; transform: scale(.92); }
    to { opacity: 1; transform: scale(1.08); }
}
.buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 8px;
}
button {
    min-height: 30px;
    border: 1px solid transparent;
    border-radius: 3px;
    font: inherit;
    cursor: pointer;
}
button.primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
}
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
}
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: .55; cursor: default; }

</style>
</head>
<body>
<div id="app">
    <div class="tabs">
        <button id="changesTab" class="tab active">Changes</button>
        <button id="stashesTab" class="tab">Stashes</button>
    </div>
    <div id="repos"><div class="empty">Loading Git repositories…</div></div>
    <div class="commit-area">
        <div class="message-wrap">
            <textarea id="message" placeholder="Commit message (Ctrl+Enter to commit)"></textarea>
            <button
                id="generateCommitMessage"
                class="ai-button"
                title="Generate commit message with AI"
                aria-label="Generate commit message with AI">✦</button>
        </div>
        <div class="buttons">
            <button id="commit" class="secondary">Commit</button>
            <button id="commitPush" class="primary">Commit &amp; Push</button>
        </div>
    </div>
</div>
<div id="contextMenu" class="context-menu hidden">
  <div id="rollbackContext" class="context-menu-item">Rollback</div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const repos = document.getElementById('repos');
const message = document.getElementById('message');
const commit = document.getElementById('commit');
const commitPush = document.getElementById('commitPush');
const generateCommitMessage = document.getElementById('generateCommitMessage');
const contextMenu = document.getElementById('contextMenu');
const rollbackContext = document.getElementById('rollbackContext');
const changesTab = document.getElementById('changesTab');
const stashesTab = document.getElementById('stashesTab');
const commitArea = document.querySelector('.commit-area');

let contextTarget = null;
let state = { repositories: [], aiEnabled: false };
let activeRepo = '';
let activeTab = 'changes';
const selectedFiles = new Map();
const initializedRepos = new Set();

function debug(message) {
    vscode.postMessage({ type: 'debug', message: String(message) });
}
window.addEventListener('error', event => debug('JS error: ' + event.message + ' @ ' + event.filename + ':' + event.lineno));
window.addEventListener('unhandledrejection', event => debug('Unhandled rejection: ' + String(event.reason)));
debug('Script initialized.');

function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
}

function repoForCommit() {
    if (state.repositories.length === 1) return state.repositories[0];
    return state.repositories.find(r => r.root === activeRepo) ?? state.repositories[0];
}

function hideContextMenu() {
    contextMenu.classList.add('hidden');
    contextTarget = null;
}

function showRollbackMenu(event, repo, files) {
    event.preventDefault();
    event.stopPropagation();
    if (!files?.length) return;

    contextTarget = { repo, files };
    contextMenu.classList.remove('hidden');

    const margin = 6;
    const rect = contextMenu.getBoundingClientRect();
    const left = Math.min(event.clientX, window.innerWidth - rect.width - margin);
    const top = Math.min(event.clientY, window.innerHeight - rect.height - margin);
    contextMenu.style.left = Math.max(margin, left) + 'px';
    contextMenu.style.top = Math.max(margin, top) + 'px';
}

function initializeSelection(repo) {
    const visible = new Set([...(repo.tracked || []), ...(repo.untracked || [])].map(file => file.file));
    let selected = selectedFiles.get(repo.root);
    if (!initializedRepos.has(repo.root)) {
        selected = new Set((repo.stagedFiles || []).filter(file => visible.has(file)));
        selectedFiles.set(repo.root, selected);
        initializedRepos.add(repo.root);
    } else {
        for (const file of [...selected]) if (!visible.has(file)) selected.delete(file);
    }
}

function selectedForRepo(repoRoot) {
    return [...(selectedFiles.get(repoRoot) || new Set())];
}

function isSelected(repoRoot, file) {
    return selectedFiles.get(repoRoot)?.has(file) || false;
}

function setSelected(repoRoot, files, checked) {
    let selected = selectedFiles.get(repoRoot);
    if (!selected) {
        selected = new Set();
        selectedFiles.set(repoRoot, selected);
    }
    for (const file of files) checked ? selected.add(file) : selected.delete(file);
}

function selectionAttrs(repoRoot, files) {
    const selectedCount = files.filter(file => isSelected(repoRoot, file)).length;
    return selectedCount === files.length && files.length ? 'checked ' : '';
}

function syncVisibleChecks(repoRoot) {
    document.querySelectorAll('.file-check').forEach(input => {
        if (input.dataset.repo === repoRoot) input.checked = isSelected(repoRoot, input.dataset.file);
    });
    updateParentChecks(repoRoot);
}

function updateParentChecks(repoRoot) {
    document.querySelectorAll('.group-check, .folder-check').forEach(input => {
        if (input.dataset.repo !== repoRoot) return;
        const files = JSON.parse(input.dataset.files || '[]');
        const selectedCount = files.filter(file => isSelected(repoRoot, file)).length;
        input.checked = files.length > 0 && selectedCount === files.length;
        input.indeterminate = selectedCount > 0 && selectedCount < files.length;
    });
}

function render() {
    document.documentElement.style.setProperty('--list-item-spacing', (state.listItemSpacing ?? 2) + 'px');
    changesTab.classList.toggle('active', activeTab === 'changes');
    stashesTab.classList.toggle('active', activeTab === 'stashes');
    commitArea.style.display = activeTab === 'changes' ? '' : 'none';

    if (!state.repositories.length) {
        repos.innerHTML = '<div class="empty">No Git repository found in this workspace.</div>';
        commit.disabled = true;
        commitPush.disabled = true;
        generateCommitMessage.disabled = true;
        generateCommitMessage.style.display = state.aiEnabled ? '' : 'none';
        return;
    }

    commit.disabled = false;
    commitPush.disabled = false;
    generateCommitMessage.style.display = state.aiEnabled ? '' : 'none';
    generateCommitMessage.disabled = !state.aiEnabled;

    repos.innerHTML = activeTab === 'changes'
      ? state.repositories.map(renderChangesRepository).join('')
      : state.repositories.map(renderStashRepository).join('');

    document.querySelectorAll('.repo').forEach(el => {
        el.addEventListener('mousedown', () => activeRepo = el.dataset.repo || '');
    });

    if (activeTab === 'stashes') {
        bindStashEvents();
        return;
    }

    bindChangeEvents();
}

function renderChangesRepository(repo) {
    const branchInfo = repo.branch +
        (repo.ahead ? ' ↑' + repo.ahead : '') +
        (repo.behind ? ' ↓' + repo.behind : '');
    initializeSelection(repo);
    const tracked = renderGroup(repo, 'Tracked', repo.tracked);
    const untracked = renderGroup(repo, 'Untracked', repo.untracked);

    return '<section class="repo" data-repo="' + esc(repo.root) + '">' +
        '<div class="repo-header"><span class="repo-title">' + esc(repo.name) + '</span>' +
        '<div class="branch-wrap"><span class="branch" title="Branch actions" data-repo="' + esc(repo.root) + '">' + esc(branchInfo) + ' ▾</span>' +
        renderBranchMenu(repo) + '</div></div>' +
        tracked + untracked +
        '</section>';
}

function renderStashRepository(repo) {
    const stashes = repo.stashes || [];
    const stashHtml = stashes.length
      ? stashes.map(stash => renderStash(repo, stash)).join('')
      : '<div class="empty">No stashes in this repository.</div>';

    return '<section class="repo" data-repo="' + esc(repo.root) + '">' +
      '<div class="repo-header"><span class="repo-title">' + esc(repo.name) + '</span>' +
      '<span class="stash-ref">' + stashes.length + ' stash' + (stashes.length === 1 ? '' : 'es') + '</span></div>' +
      '<div class="stash-create">' +
        '<div class="stash-create-row">' +
          '<input class="stash-message" data-repo="' + esc(repo.root) + '" placeholder="Stash message (optional)">' +
          '<button class="stash-create-button primary" data-repo="' + esc(repo.root) + '">Stash</button>' +
        '</div>' +
        '<div class="stash-options"><label><input class="stash-untracked" data-repo="' + esc(repo.root) + '" type="checkbox"> Include untracked files</label></div>' +
      '</div>' + stashHtml + '</section>';
}

function renderStash(repo, stash) {
    const date = stash.timestamp ? new Date(stash.timestamp * 1000).toLocaleString() : '';
    const files = stash.files || [];
    const fileRows = files.length ? files.map(file =>
      '<div class="stash-file" data-repo="' + esc(repo.root) + '" data-ref="' + esc(stash.ref) + '" data-file="' + esc(file.path) + '" data-untracked="' + (file.untracked ? 'true' : 'false') + '" title="Open stash diff">' +
        '<span class="stash-status">' + esc(file.status) + '</span>' +
        '<span class="stash-file-name">' + esc(file.name) + '</span>' +
        (file.dir ? '<span class="stash-file-dir">' + esc(file.dir) + '</span>' : '') +
      '</div>'
    ).join('') : '<div class="empty">No changed files.</div>';

    return '<details class="stash-card">' +
      '<summary class="stash-summary">' +
        '<span class="stash-title">' + esc(stash.message || stash.ref) + '</span>' +
        '<span class="stash-meta">' + files.length + ' file' + (files.length === 1 ? '' : 's') + '</span>' +
        '<span class="stash-ref">' + esc(stash.ref) + '</span>' +
      '</summary>' +
      '<div class="stash-files">' + fileRows + '</div>' +
      '<div class="stash-actions">' +
        '<button class="stash-action" data-action="apply" data-repo="' + esc(repo.root) + '" data-ref="' + esc(stash.ref) + '">Apply</button>' +
        '<button class="stash-action" data-action="pop" data-repo="' + esc(repo.root) + '" data-ref="' + esc(stash.ref) + '">Pop</button>' +
        '<button class="stash-action" data-action="drop" data-repo="' + esc(repo.root) + '" data-ref="' + esc(stash.ref) + '">Drop</button>' +
        '<span class="stash-meta" style="margin-left:auto;align-self:center">' + esc(date) + '</span>' +
      '</div>' +
    '</details>';
}

function bindStashEvents() {
    document.querySelectorAll('.stash-create-button').forEach(button => {
        button.addEventListener('click', () => createStash(button.dataset.repo));
    });
    document.querySelectorAll('.stash-message').forEach(input => {
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                createStash(input.dataset.repo);
            }
        });
    });
    document.querySelectorAll('.stash-action').forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            vscode.postMessage({
                type: 'stashAction',
                repo: button.dataset.repo,
                action: button.dataset.action,
                ref: button.dataset.ref
            });
        });
    });
    document.querySelectorAll('.stash-file').forEach(file => {
        file.addEventListener('dblclick', event => {
            event.preventDefault();
            vscode.postMessage({
                type: 'stashDiff',
                repo: file.dataset.repo,
                ref: file.dataset.ref,
                file: file.dataset.file,
                untracked: file.dataset.untracked === 'true'
            });
        });
    });
}

function createStash(repo) {
    const section = document.querySelector('.repo[data-repo="' + CSS.escape(repo) + '"]');
    if (!section) return;
    const input = section.querySelector('.stash-message');
    const untracked = section.querySelector('.stash-untracked');
    vscode.postMessage({
        type: 'createStash',
        repo,
        message: input?.value || '',
        includeUntracked: !!untracked?.checked
    });
}

function bindChangeEvents() {
    document.querySelectorAll('.file-row').forEach(el => {
        el.addEventListener('contextmenu', event => {
            const file = el.querySelector('.file-main');
            if (!file) return;
            showRollbackMenu(event, file.dataset.repo, [file.dataset.file]);
        });
    });

    document.querySelectorAll('.tree-folder > summary').forEach(el => {
        el.addEventListener('contextmenu', event => {
            const input = el.querySelector('.folder-check');
            if (!input) return;
            const files = JSON.parse(input.dataset.files || '[]');
            showRollbackMenu(event, input.dataset.repo, files);
        });
    });

    document.querySelectorAll('.branch').forEach(el => {
        el.addEventListener('click', event => {
            event.stopPropagation();
            const trigger = event.currentTarget;
            const menu = trigger.parentElement.querySelector('.branch-menu');
            document.querySelectorAll('.branch-menu').forEach(other => {
                if (other !== menu) other.classList.add('hidden');
            });
            menu.classList.toggle('hidden');
        });
    });

    document.querySelectorAll('.branch-entry[data-submenu], .remote-entry[data-submenu]').forEach(el => {
        el.addEventListener('click', event => {
            event.stopPropagation();
            const entry = event.currentTarget;
            const submenu = entry.querySelector(':scope > .branch-submenu, :scope > .remote-submenu');
            if (submenu) submenu.classList.add('open');
        });
    });

    document.querySelectorAll('.menu-header').forEach(el => {
        el.addEventListener('click', event => {
            event.stopPropagation();
            event.currentTarget.parentElement.classList.remove('open');
        });
    });

    document.querySelectorAll('.push-entry[data-push-default]').forEach(el => {
        el.addEventListener('click', event => {
            event.stopPropagation();
            const push = event.currentTarget;
            document.querySelectorAll('.branch-menu').forEach(menu => menu.classList.add('hidden'));
            vscode.postMessage({ type: 'branchAction', repo: push.dataset.repo, action: 'push', remote: push.dataset.remote || undefined });
        });
    });

    document.querySelectorAll('.branch-action[data-action]').forEach(el => {
        el.addEventListener('click', event => {
            event.stopPropagation();
            const action = event.currentTarget;
            if (action.classList.contains('disabled')) return;
            document.querySelectorAll('.branch-menu').forEach(menu => menu.classList.add('hidden'));
            vscode.postMessage({
                type: 'branchAction', repo: action.dataset.repo, action: action.dataset.action,
                branch: action.dataset.branch || undefined, remote: action.dataset.remote || undefined,
                remoteBranch: action.dataset.remoteBranch || undefined
            });
        });
    });

    document.querySelectorAll('.file-check').forEach(el => {
        el.addEventListener('change', event => {
            const input = event.currentTarget;
            setSelected(input.dataset.repo, [input.dataset.file], input.checked);
            updateParentChecks(input.dataset.repo);
        });
    });

    document.querySelectorAll('.folder-check').forEach(el => el.addEventListener('click', event => event.stopPropagation()));
    document.querySelectorAll('.group-check, .folder-check').forEach(el => {
        el.addEventListener('change', event => {
            const input = event.currentTarget;
            const files = JSON.parse(input.dataset.files || '[]');
            setSelected(input.dataset.repo, files, input.checked);
            syncVisibleChecks(input.dataset.repo);
        });
    });

    document.querySelectorAll('.file-main').forEach(el => {
        el.addEventListener('dblclick', event => {
            event.stopPropagation();
            const row = event.currentTarget;
            vscode.postMessage({
                type: 'diff', repo: row.dataset.repo, file: row.dataset.file,
                staged: row.dataset.staged === 'true', status: Number(row.dataset.status)
            });
        });
    });
}

function renderBranchMenu(repo) {
    const branchItems = (repo.branches || []).map(branch => {
        const current = branch === repo.branch;
        const branchAttr = esc(branch);
        return '<div class="branch-entry' + (current ? ' current' : '') + '" data-submenu="true">' +
          '<span class="branch-check">' + (current ? '✓' : '') + '</span>' +
          '<span>' + esc(branch) + '</span>' +
          '<span class="branch-entry-arrow">›</span>' +
          '<div class="branch-submenu">' +
            '<div class="menu-header">‹ ' + esc(branch) + '</div>' +
            '<div class="branch-action' + (current ? ' disabled' : '') + '" data-action="checkout" data-repo="' + esc(repo.root) + '" data-branch="' + branchAttr + '">Checkout</div>' +
            (!current ? '<div class="branch-action" data-action="merge" data-repo="' + esc(repo.root) + '" data-branch="' + branchAttr + '">Merge into current branch</div>' : '') +
            '<div class="branch-action" data-action="createFrom" data-repo="' + esc(repo.root) + '" data-branch="' + branchAttr + '">New Branch from Here…</div>' +
            '<div class="branch-action' + (current ? ' disabled' : '') + '" data-action="delete" data-repo="' + esc(repo.root) + '" data-branch="' + branchAttr + '">Delete</div>' +
          '</div>' +
        '</div>';
    }).join('');

    const remoteItems = (repo.remotes || []).map(remote => {
        const remoteBranches = (remote.branches || []).map(branch => {
            const ref = remote.name + '/' + branch;
            return '<div class="branch-entry remote-branch-entry" data-submenu="true">' +
              '<span class="branch-check"></span>' +
              '<span>' + esc(branch) + '</span>' +
              '<span class="branch-entry-arrow">›</span>' +
              '<div class="branch-submenu">' +
                '<div class="menu-header">‹ ' + esc(branch) + '</div>' +
                '<div class="branch-action" data-action="checkoutRemote" data-repo="' + esc(repo.root) + '" data-remote="' + esc(remote.name) + '" data-remote-branch="' + esc(branch) + '">Checkout</div>' +
                (branch !== repo.branch ? '<div class="branch-action" data-action="merge" data-repo="' + esc(repo.root) + '" data-branch="' + esc(ref) + '">Merge into current branch</div>' : '') +
                '<div class="branch-action" data-action="createFrom" data-repo="' + esc(repo.root) + '" data-branch="' + esc(ref) + '">New Branch from Here…</div>' +
                '<div class="branch-action" data-action="deleteRemote" data-repo="' + esc(repo.root) + '" data-remote="' + esc(remote.name) + '" data-remote-branch="' + esc(branch) + '">Delete</div>' +
              '</div>' +
            '</div>';
        }).join('');

        return '<div class="remote-entry" data-submenu="true">' +
          '<span class="branch-check"></span>' +
          '<span>' + esc(remote.name) + '</span>' +
          '<span class="branch-entry-arrow">›</span>' +
          '<div class="remote-submenu">' +
            '<div class="menu-header">‹ ' + esc(remote.name) + '</div>' + remoteBranches +
          '</div>' +
        '</div>';
    }).join('');

    const pushRemotes = (repo.remotes || []).map(remote =>
        '<div class="branch-action" data-action="push" data-repo="' + esc(repo.root) + '" data-remote="' + esc(remote.name) + '">' + esc(remote.name) + '</div>'
    ).join('');
    const firstRemote = (repo.remotes || [])[0]?.name;
    const pushItem = firstRemote
      ? ((repo.remotes || []).length > 1
          ? '<div class="branch-entry push-entry" data-submenu="true">' +
              '<span class="branch-check"></span><span>Push</span>' +
              '<span class="branch-entry-arrow">›</span>' +
              '<div class="branch-submenu"><div class="menu-header">‹ Push</div>' + pushRemotes + '</div>' +
            '</div>'
          : '<div class="branch-action" data-action="push" data-repo="' + esc(repo.root) + '" data-remote="' + esc(firstRemote) + '">Push</div>')
      : '<div class="branch-action disabled">Push</div>';

    return '<div class="branch-menu hidden">' +
      branchItems +
      (remoteItems ? '<div class="branch-menu-separator"></div>' + remoteItems : '') +
      '<div class="branch-menu-separator"></div>' +
      '<div class="branch-action" data-action="create" data-repo="' + esc(repo.root) + '">Create Branch…</div>' +
      '<div class="branch-menu-separator"></div>' +
      pushItem +
      '</div>';
}

function renderGroup(repo, title, files) {
    if (!files.length) return '';
    const mode = state.viewMode || 'flat';
    const content = mode === 'tree'
      ? renderTree(repo, files)
      : files.map(file => renderFileRow(repo, file, false)).join('');
    const filesJson = esc(JSON.stringify(files.map(file => file.file)));

    return '<div class="group">' +
      '<div class="group-title">' +
      '<input class="group-check" type="checkbox" ' + selectionAttrs(repo.root, files.map(file => file.file)) +
        'title="Select group"' +
        'data-repo="' + esc(repo.root) + '" data-files="' + filesJson + '">' +
      title + '<span class="count">' + files.length + '</span>' +
      '</div>' +
      content +
      '</div>';
}

function gitStatusClass(status) {
    switch (status) {
        case 0:  // INDEX_MODIFIED
        case 5:  // MODIFIED
        case 12: // TYPE_CHANGED
            return 'git-modified';

        case 1:  // INDEX_ADDED
        case 7:  // UNTRACKED
        case 9:  // INTENT_TO_ADD
            return 'git-added';

        case 2:  // INDEX_DELETED
        case 6:  // DELETED
        case 15: // DELETED_BY_US
        case 16: // DELETED_BY_THEM
        case 18: // BOTH_DELETED
            return 'git-deleted';

        case 3:  // INDEX_RENAMED
        case 4:  // INDEX_COPIED
        case 10: // INTENT_TO_RENAME
            return 'git-renamed';

        case 13: // ADDED_BY_US
        case 14: // ADDED_BY_THEM
        case 17: // BOTH_ADDED
        case 19: // BOTH_MODIFIED
            return 'git-conflict';

        case 8:  // IGNORED
            return 'git-ignored';

        default:
            return '';
    }
}

function renderFileRow(repo, file, treeFile) {
    const statusClass = gitStatusClass(file.status);
    return '<div class="file-row' + (treeFile ? ' tree-file' : '') + (statusClass ? ' ' + statusClass : '') + '" title="' + esc(file.tooltip) + '">' +
      '<input class="file-check" type="checkbox" ' + (isSelected(repo.root, file.file) ? 'checked ' : '') +
        'data-repo="' + esc(repo.root) + '" data-file="' + esc(file.file) + '">' +
      '<div class="file-main" data-repo="' + esc(repo.root) + '" data-file="' + esc(file.file) + '" data-staged="' + (file.stagedOnly ? 'true' : 'false') + '" data-status="' + file.status + '">' +
        '<span class="file-name">' + esc(file.name) + '</span>' +
        (!treeFile && file.dir ? '<span class="file-dir">' + esc(file.dir) + '</span>' : '') +
      '</div></div>';
}

function renderTree(repo, files) {
    const root = { dirs: new Map(), files: [] };

    for (const file of files) {
        const parts = Array.isArray(file.dirParts)
          ? file.dirParts
          : (file.dir ? file.dir.split(String.fromCharCode(92)).join('/').split('/').filter(Boolean) : []);
        let node = root;
        for (const part of parts) {
            if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
            node = node.dirs.get(part);
        }
        node.files.push(file);
    }

    function descendantFiles(node) {
        return [
            ...node.files.map(file => file.file),
            ...[...node.dirs.values()].flatMap(child => descendantFiles(child))
        ];
    }

    function nodeHtml(node) {
        const dirs = [...node.dirs.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([name, child]) => {
            const filesJson = esc(JSON.stringify(descendantFiles(child)));
            return '<details class="tree-folder" open>' +
              '<summary>' +
                '<input class="folder-check" type="checkbox" ' + selectionAttrs(repo.root, descendantFiles(child)) +
                  'title="Select folder"' +
                  'data-repo="' + esc(repo.root) + '" data-files="' + filesJson + '">' +
                '<span>' + esc(name) + '</span>' +
              '</summary>' +
              '<div class="tree-children">' + nodeHtml(child) + '</div>' +
            '</details>';
          }).join('');

        const rows = node.files
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(file => renderFileRow(repo, file, true))
          .join('');

        return dirs + rows;
    }

    return '<div class="tree-root">' + nodeHtml(root) + '</div>';
}

function doCommit(push) {
    const repo = repoForCommit();
    if (!repo) return;
    vscode.postMessage({
        type: push ? 'commitPush' : 'commit',
        repo: repo.root,
        message: message.value,
        files: selectedForRepo(repo.root)
    });
}

generateCommitMessage.addEventListener('click', () => {
    const repo = repoForCommit();
    if (!repo || generateCommitMessage.disabled) return;

    vscode.postMessage({
        type: 'generateCommitMessage',
        repo: repo.root,
        files: selectedForRepo(repo.root)
    });
});

commit.addEventListener('click', () => doCommit(false));
commitPush.addEventListener('click', () => doCommit(true));

rollbackContext.addEventListener('click', event => {
    event.stopPropagation();
    if (!contextTarget) return;
    const target = contextTarget;
    hideContextMenu();
    vscode.postMessage({ type: 'rollback', repo: target.repo, files: target.files });
});

message.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        doCommit(false);
    }
});

document.addEventListener('click', () => {
    document.querySelectorAll('.branch-menu').forEach(menu => menu.classList.add('hidden'));
    hideContextMenu();
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        document.querySelectorAll('.branch-menu').forEach(menu => menu.classList.add('hidden'));
        hideContextMenu();
    }
});

window.addEventListener('message', event => {
    const data = event.data;
    if (data.type === 'state') {
        debug('State received. repositories=' + (data.repositories?.length ?? 0) + ', viewMode=' + data.viewMode);
        state = data;
        if (!activeRepo && state.repositories.length) activeRepo = state.repositories[0].root;
        render();
    } else if (data.type === 'fatalError') {
        repos.innerHTML = '<div class="empty">AOH - Git failed to load. Check Output → AOH - Git.</div>';
        debug('Backend fatal error: ' + data.message);
    } else if (data.type === 'commitMessageGeneration') {
        const applies = activeRepo === data.repo || state.repositories.length === 1;
        if (applies) {
            generateCommitMessage.disabled = !!data.running;
            generateCommitMessage.classList.toggle('generating', !!data.running);
            generateCommitMessage.textContent = data.running ? '✧' : '✦';
            generateCommitMessage.title = data.running
                ? 'AI is generating a commit message…'
                : 'Generate commit message with AI';
        }
    } else if (data.type === 'generatedCommitMessage') {
        if (activeRepo === data.repo || state.repositories.length === 1) {
            message.value = data.message || '';
            message.focus();
            message.setSelectionRange(message.value.length, message.value.length);
        }
    } else if (data.type === 'committed') {
        if (activeRepo === data.repo || state.repositories.length === 1) {
            message.value = '';
        }
    }
});

changesTab.addEventListener('click', () => { activeTab = 'changes'; render(); });
stashesTab.addEventListener('click', () => { activeTab = 'stashes'; render(); });

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let i = 0; i < 32; i++) {
        value += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return value;
}

export function deactivate() {}
