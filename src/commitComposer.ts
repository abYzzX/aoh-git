import * as vscode from 'vscode';
import { generateCommitMessage, isAiEnabled } from './ai';
import { commitMessage } from './commitInput';
import { Repository } from './gitApi';

interface ComposerMessage {
    readonly type: 'commit' | 'commitPush' | 'generateAi' | 'ready';
    readonly message?: string;
}

export class CommitComposerProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aoh.git.commitView';

    private view: vscode.WebviewView | undefined;
    private busy = false;

    public constructor(
        private readonly resolveRepository: () => Promise<Repository | undefined>,
        private readonly onRepositoryChanged: () => void
    ) {}

    public resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {
            enableScripts: true
        };
        view.webview.html = this.getHtml(view.webview);

        view.webview.onDidReceiveMessage(async (message: ComposerMessage) => {
            await this.handleMessage(message);
        });
    }

    public refreshConfiguration(): void {
        this.post({
            type: 'aiEnabled',
            enabled: isAiEnabled()
        });
    }

    public async focus(): Promise<void> {
        await vscode.commands.executeCommand(`${CommitComposerProvider.viewType}.focus`);
        this.post({ type: 'focus' });
    }

    private async handleMessage(message: ComposerMessage): Promise<void> {
        if (message.type === 'ready') {
            this.refreshConfiguration();
            return;
        }

        if (this.busy) {
            return;
        }

        const repo = await this.resolveRepository();
        if (!repo) {
            this.showError('No Git repository selected.');
            return;
        }

        if (message.type === 'generateAi') {
            await this.generateAiMessage(repo);
            return;
        }

        if (message.type === 'commit' || message.type === 'commitPush') {
            await this.commit(repo, message.message ?? '', message.type === 'commitPush');
        }
    }

    private async generateAiMessage(repo: Repository): Promise<void> {
        if (!isAiEnabled()) {
            this.showError('AI support is disabled in the AOH - Git settings.');
            return;
        }

        this.setBusy(true, 'Generating commit message…');

        try {
            const generated = (await generateCommitMessage(repo)).trim();

            if (!generated) {
                throw new Error('AI command returned an empty commit message.');
            }

            this.post({
                type: 'setMessage',
                value: generated
            });
            this.post({
                type: 'status',
                value: ''
            });
        } catch (error) {
            this.showError(error instanceof Error ? error.message : String(error));
        } finally {
            this.setBusy(false);
        }
    }

    private async commit(repo: Repository, message: string, push: boolean): Promise<void> {
        this.setBusy(true, push ? 'Committing and pushing…' : 'Committing…');

        try {
            const before = repo.state.indexChanges.length;
            await commitMessage(repo, message, push);

            // A cancelled confirmation leaves the staged changes untouched.
            if (before > 0 && repo.state.indexChanges.length < before) {
                this.post({ type: 'clearMessage' });
                this.post({ type: 'status', value: push ? 'Committed and pushed.' : 'Committed.' });
            }

            this.onRepositoryChanged();
        } catch (error) {
            this.showError(error instanceof Error ? error.message : String(error));
        } finally {
            this.setBusy(false);
        }
    }

    private showError(message: string): void {
        this.post({
            type: 'status',
            value: message,
            error: true
        });
    }

    private setBusy(busy: boolean, status = ''): void {
        this.busy = busy;
        this.post({
            type: 'busy',
            busy,
            status
        });
    }

    private post(message: unknown): void {
        void this.view?.webview.postMessage(message);
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const aiEnabled = isAiEnabled();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style>
        * { box-sizing: border-box; }
        body {
            padding: 8px 10px 10px;
            margin: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        .composer { position: relative; }
        textarea {
            width: 100%;
            min-height: 78px;
            resize: vertical;
            padding: 7px 34px 7px 8px;
            border: 1px solid var(--vscode-input-border, transparent);
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
            font-family: inherit;
            font-size: inherit;
            line-height: 1.4;
            outline: none;
        }
        textarea:focus {
            border-color: var(--vscode-focusBorder);
        }
        textarea:disabled { opacity: 0.7; }
        #ai {
            position: absolute;
            top: 4px;
            right: 4px;
            width: 27px;
            height: 27px;
            padding: 0;
            border: none;
            border-radius: 3px;
            color: var(--vscode-icon-foreground);
            background: transparent;
            cursor: pointer;
            font-size: 16px;
        }
        #ai:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        #ai[hidden] { display: none; }
        .actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            margin-top: 7px;
        }
        .actions button {
            min-height: 28px;
            padding: 4px 8px;
            border: 1px solid var(--vscode-button-border, transparent);
            color: var(--vscode-button-foreground);
            background: var(--vscode-button-background);
            cursor: pointer;
        }
        .actions button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button:disabled {
            cursor: default;
            opacity: 0.55;
        }
        #status {
            min-height: 18px;
            margin-top: 5px;
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }
        #status.error {
            color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <div class="composer">
        <textarea id="message" rows="3" placeholder="Commit message…" spellcheck="false"></textarea>
        <button id="ai" title="Generate commit message with AI" aria-label="Generate commit message with AI" ${aiEnabled ? '' : 'hidden'}>✦</button>
    </div>
    <div class="actions">
        <button id="commit">Commit</button>
        <button id="commitPush">Commit &amp; Push</button>
    </div>
    <div id="status" role="status"></div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const message = document.getElementById('message');
        const ai = document.getElementById('ai');
        const commit = document.getElementById('commit');
        const commitPush = document.getElementById('commitPush');
        const status = document.getElementById('status');

        let busy = false;

        function updateButtons() {
            const empty = !message.value.trim();
            message.disabled = busy;
            ai.disabled = busy;
            commit.disabled = busy || empty;
            commitPush.disabled = busy || empty;
        }

        function setStatus(value, error = false) {
            status.textContent = value || '';
            status.classList.toggle('error', error);
        }

        message.addEventListener('input', () => {
            vscode.setState({ message: message.value });
            updateButtons();
        });

        message.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !commit.disabled) {
                event.preventDefault();
                vscode.postMessage({ type: 'commit', message: message.value });
            }
        });

        ai.addEventListener('click', () => vscode.postMessage({ type: 'generateAi' }));
        commit.addEventListener('click', () => vscode.postMessage({ type: 'commit', message: message.value }));
        commitPush.addEventListener('click', () => vscode.postMessage({ type: 'commitPush', message: message.value }));

        window.addEventListener('message', event => {
            const data = event.data;

            switch (data.type) {
                case 'setMessage':
                    message.value = data.value || '';
                    vscode.setState({ message: message.value });
                    updateButtons();
                    message.focus();
                    message.setSelectionRange(message.value.length, message.value.length);
                    break;
                case 'clearMessage':
                    message.value = '';
                    vscode.setState({ message: '' });
                    updateButtons();
                    break;
                case 'busy':
                    busy = !!data.busy;
                    if (data.status !== undefined) setStatus(data.status, false);
                    updateButtons();
                    break;
                case 'status':
                    setStatus(data.value, !!data.error);
                    break;
                case 'aiEnabled':
                    ai.hidden = !data.enabled;
                    break;
                case 'focus':
                    message.focus();
                    break;
            }
        });

        const previous = vscode.getState();
        if (previous?.message) message.value = previous.message;
        updateButtons();
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';

    for (let i = 0; i < 32; i++) {
        value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }

    return value;
}
