import * as vscode from 'vscode';

import { Status } from './gitStatus';
export { Status } from './gitStatus';

export interface Change {
    readonly uri: vscode.Uri;
    readonly originalUri: vscode.Uri;
    readonly renameUri: vscode.Uri | undefined;
    readonly status: Status;
}

export interface Branch {
    readonly name?: string;
    readonly upstream?: { remote: string; name: string };
    readonly ahead?: number;
    readonly behind?: number;
}

export interface RepositoryState {
    readonly HEAD: Branch | undefined;
    readonly indexChanges: Change[];
    readonly workingTreeChanges: Change[];
    readonly untrackedChanges?: Change[];
    readonly mergeChanges: Change[];
    readonly onDidChange: vscode.Event<void>;
}

export interface Repository {
    readonly rootUri: vscode.Uri;
    readonly state: RepositoryState;
    add(paths: string[]): Promise<void>;
    restore(paths: string[], options?: { staged?: boolean; ref?: string }): Promise<void>;
    commit(message: string, opts?: { all?: boolean | 'tracked'; postCommitCommand?: string | null }): Promise<void>;
    push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
    status(): Promise<void>;
}

export interface GitAPI {
    readonly repositories: Repository[];
    readonly onDidOpenRepository: vscode.Event<Repository>;
    readonly onDidCloseRepository: vscode.Event<Repository>;
    toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

export interface GitExtension {
    readonly enabled: boolean;
    readonly onDidChangeEnablement: vscode.Event<boolean>;
    getAPI(version: 1): GitAPI;
}
