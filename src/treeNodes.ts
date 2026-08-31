import * as vscode from 'vscode';
import { Change, Repository } from './gitApi';

export type StageSide = 'staged' | 'unstaged';

export interface BaseNode {
    readonly kind: string;
}

export interface RepositoryNode extends BaseNode {
    readonly kind: 'repository';
    readonly repo: Repository;
}

export interface GroupNode extends BaseNode {
    readonly kind: 'group';
    readonly repo: Repository;
    readonly side: StageSide;
    readonly changes: Change[];
}

export interface FolderNode extends BaseNode {
    readonly kind: 'folder';
    readonly repo: Repository;
    readonly side: StageSide;
    readonly relativePath: string;
    readonly changes: Change[];
}

export interface FileNode extends BaseNode {
    readonly kind: 'file';
    readonly repo: Repository;
    readonly side: StageSide;
    readonly change: Change;
}

export type GitTreeNode = RepositoryNode | GroupNode | FolderNode | FileNode;

export function isCheckable(node: GitTreeNode): node is GroupNode | FolderNode | FileNode {
    return node.kind === 'group' || node.kind === 'folder' || node.kind === 'file';
}

export function changesForNode(node: GroupNode | FolderNode | FileNode): Change[] {
    return node.kind === 'file' ? [node.change] : node.changes;
}

export function checkboxState(side: StageSide): vscode.TreeItemCheckboxState {
    return side === 'staged'
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
}
