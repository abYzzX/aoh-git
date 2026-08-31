import * as vscode from 'vscode';
import * as path from 'path';
import { Change, GitAPI, Repository, Status } from './gitApi';
import {
    checkboxState,
    FileNode,
    FolderNode,
    GitTreeNode,
    GroupNode,
    RepositoryNode,
    StageSide
} from './treeNodes';

export class GitTreeProvider implements vscode.TreeDataProvider<GitTreeNode> {
    private readonly emitter = new vscode.EventEmitter<GitTreeNode | undefined | void>();
    readonly onDidChangeTreeData = this.emitter.event;

    constructor(
        private readonly getApi: () => GitAPI | undefined,
        private readonly getViewMode: () => 'flat' | 'tree'
    ) {}

    refresh(): void {
        this.emitter.fire();
    }

    getTreeItem(node: GitTreeNode): vscode.TreeItem {
        switch (node.kind) {
            case 'repository':
                return this.repositoryItem(node);
            case 'group':
                return this.groupItem(node);
            case 'folder':
                return this.folderItem(node);
            case 'file':
                return this.fileItem(node);
        }
    }

    getChildren(node?: GitTreeNode): GitTreeNode[] {
        if (!node) {
            return (this.getApi()?.repositories ?? []).map(repo => ({
                kind: 'repository',
                repo
            }));
        }

        switch (node.kind) {
            case 'repository':
                return this.repositoryChildren(node.repo);
            case 'group':
                return this.changeChildren(node.repo, node.side, node.changes, '');
            case 'folder':
                return this.changeChildren(node.repo, node.side, node.changes, node.relativePath);
            case 'file':
                return [];
        }
    }

    private repositoryChildren(repo: Repository): GitTreeNode[] {
        const staged = this.dedupe(repo.state.indexChanges);
        const unstaged = this.dedupe([
            ...repo.state.workingTreeChanges,
            ...repo.state.untrackedChanges,
            ...repo.state.mergeChanges
        ]);

        const nodes: GitTreeNode[] = [];
        if (staged.length) {
            nodes.push({ kind: 'group', repo, side: 'staged', changes: staged });
        }
        if (unstaged.length) {
            nodes.push({ kind: 'group', repo, side: 'unstaged', changes: unstaged });
        }
        return nodes;
    }

    private changeChildren(
        repo: Repository,
        side: StageSide,
        changes: Change[],
        parentPath: string
    ): GitTreeNode[] {
        if (this.getViewMode() === 'flat') {
            if (parentPath) return [];
            return changes
                .slice()
                .sort((a, b) => this.relative(repo, a).localeCompare(this.relative(repo, b)))
                .map(change => ({ kind: 'file', repo, side, change }));
        }

        const folders = new Map<string, Change[]>();
        const files: Change[] = [];

        for (const change of changes) {
            const relative = this.relative(repo, change);
            const dir = path.dirname(relative) === '.' ? '' : path.dirname(relative);

            if (dir === parentPath) {
                files.push(change);
                continue;
            }

            const remainder = parentPath
                ? dir.slice(parentPath.length + 1)
                : dir;
            const first = remainder.split(path.sep)[0];
            if (!first) {
                files.push(change);
                continue;
            }

            const folderPath = parentPath ? path.join(parentPath, first) : first;
            const bucket = folders.get(folderPath) ?? [];
            bucket.push(change);
            folders.set(folderPath, bucket);
        }

        const folderNodes: FolderNode[] = [...folders.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([relativePath, folderChanges]) => ({
                kind: 'folder',
                repo,
                side,
                relativePath,
                changes: folderChanges
            }));

        const fileNodes: FileNode[] = files
            .sort((a, b) => path.basename(this.relative(repo, a)).localeCompare(path.basename(this.relative(repo, b))))
            .map(change => ({ kind: 'file', repo, side, change }));

        return [...folderNodes, ...fileNodes];
    }

    private repositoryItem(node: RepositoryNode): vscode.TreeItem {
        const repo = node.repo;
        const item = new vscode.TreeItem(
            path.basename(repo.rootUri.fsPath),
            vscode.TreeItemCollapsibleState.Expanded
        );
        const head = repo.state.HEAD;
        const branch = head?.name ?? 'detached HEAD';
        const arrows = [
            head?.ahead ? `↑${head.ahead}` : '',
            head?.behind ? `↓${head.behind}` : ''
        ].filter(Boolean).join(' ');

        item.description = arrows ? `${branch}  ${arrows}` : branch;
        item.contextValue = 'aoh.repository';
        item.iconPath = new vscode.ThemeIcon('repo');
        item.tooltip = repo.rootUri.fsPath;
        return item;
    }

    private groupItem(node: GroupNode): vscode.TreeItem {
        const label = node.side === 'staged' ? 'Staged Changes' : 'Changes';
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
        item.description = String(node.changes.length);
        item.contextValue = `aoh.${node.side}.group`;
        item.checkboxState = checkboxState(node.side);
        return item;
    }

    private folderItem(node: FolderNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            path.basename(node.relativePath),
            vscode.TreeItemCollapsibleState.Collapsed
        );
        item.contextValue = `aoh.${node.side}.folder`;
        item.checkboxState = checkboxState(node.side);
        item.iconPath = vscode.ThemeIcon.Folder;
        item.tooltip = node.relativePath;
        return item;
    }

    private fileItem(node: FileNode): vscode.TreeItem {
        const relative = this.relative(node.repo, node.change);
        const item = new vscode.TreeItem(path.basename(relative), vscode.TreeItemCollapsibleState.None);
        const dir = path.dirname(relative);
        item.description = this.getViewMode() === 'flat' && dir !== '.' ? dir : undefined;
        item.contextValue = `aoh.${node.side}.file`;
        item.checkboxState = checkboxState(node.side);
        item.resourceUri = node.change.uri;
        item.tooltip = `${relative} — ${this.statusLabel(node.change.status)}`;
        item.command = {
            command: 'aoh.git.openDiff',
            title: 'Open Diff',
            arguments: [node]
        };
        return item;
    }

    private relative(repo: Repository, change: Change): string {
        return path.relative(repo.rootUri.fsPath, change.uri.fsPath);
    }

    private dedupe(changes: Change[]): Change[] {
        const seen = new Set<string>();
        return changes.filter(change => {
            const key = change.uri.fsPath;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
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


}
