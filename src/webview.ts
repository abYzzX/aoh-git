import type * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { gitStatusClasses } from './gitStatus';

export function renderWebview(webview: vscode.Webview): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
.tree-file { padding-left: 24px; }
.tree-file .file-main { gap: 6px; }
.node-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
}
.node-icon img { width: 16px; height: 16px; display: block; object-fit: contain; }
.node-icon-font { line-height: 16px; text-align: center; }
.folder-icon-open { display: inline-flex; }
.folder-icon-closed { display: none; }
.tree-folder:not([open]) > summary .folder-icon-open { display: none; }
.tree-folder:not([open]) > summary .folder-icon-closed { display: inline-flex; }
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
<style id="file-icon-theme-fonts"></style>
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
const detailStates = new Map();
const stashDrafts = new Map();
const pendingStashes = new Set();
const failedStashes = new Set();
const generatingRepos = new Set();
const committingRepos = new Set();
let renderedState = '';
let renderedTab = '';
const renderedRepositories = new Map();

function stashKey(repo, hash) { return JSON.stringify([repo, hash]); }

function updateButtons() {
    const repo = repoForCommit();
    const committing = !!repo && committingRepos.has(repo.root);
    const generating = !!repo && generatingRepos.has(repo.root);
    commit.disabled = !repo || committing;
    commitPush.disabled = !repo || committing;
    generateCommitMessage.style.display = state.aiEnabled ? '' : 'none';
    generateCommitMessage.disabled = !repo || !state.aiEnabled || generating;
    generateCommitMessage.classList.toggle('generating', generating);
    generateCommitMessage.textContent = generating ? '✧' : '✦';
    generateCommitMessage.title = generating ? 'AI is generating a commit message…' : 'Generate commit message with AI';
}

function preserveView() {
    repos.querySelectorAll('details[data-key]').forEach(el => detailStates.set(el.dataset.key, el.open));
    repos.querySelectorAll('.repo').forEach(el => {
        const input = el.querySelector('.stash-message');
        if (input) stashDrafts.set(el.dataset.repo, { message: input.value, untracked: el.querySelector('.stash-untracked').checked });
    });
}

function restoreView() {
    repos.querySelectorAll('details[data-key]').forEach(el => {
        if (detailStates.has(el.dataset.key)) el.open = detailStates.get(el.dataset.key);
    });
    repos.querySelectorAll('.repo').forEach(el => {
        const draft = stashDrafts.get(el.dataset.repo);
        const input = el.querySelector('.stash-message');
        if (draft && input) {
            input.value = draft.message;
            el.querySelector('.stash-untracked').checked = draft.untracked;
        }
    });
}


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
    updateButtons();
    const snapshot = JSON.stringify(state);
    if (snapshot === renderedState && renderedTab === activeTab) return;
    preserveView();
    const scrollTop = repos.scrollTop;
    const focused = document.activeElement;
    const focusedRepo = focused?.closest('.repo')?.dataset.repo;
    const wasStashInput = focused?.classList.contains('stash-message');
    const selectionStart = wasStashInput ? focused.selectionStart : null;
    const selectionEnd = wasStashInput ? focused.selectionEnd : null;
    renderedState = snapshot;
    renderedTab = activeTab;
    document.documentElement.style.setProperty('--list-item-spacing', (state.listItemSpacing ?? 2) + 'px');
    changesTab.classList.toggle('active', activeTab === 'changes');
    stashesTab.classList.toggle('active', activeTab === 'stashes');
    commitArea.style.display = activeTab === 'changes' ? '' : 'none';

    if (!state.repositories.length) {
        repos.innerHTML = '<div class="empty">No Git repository found in this workspace.</div>';
        renderedRepositories.clear();
        commit.disabled = true;
        commitPush.disabled = true;
        generateCommitMessage.disabled = true;
        generateCommitMessage.style.display = state.aiEnabled ? '' : 'none';
        return;
    }

    const roots = new Set(state.repositories.map(repo => repo.root));
    for (const [root, rendered] of renderedRepositories) {
        if (!roots.has(root)) {
            rendered.element.remove();
            renderedRepositories.delete(root);
            selectedFiles.delete(root);
            initializedRepos.delete(root);
        }
    }
    if (!renderedRepositories.size) repos.replaceChildren();
    const changedSections = [];
    state.repositories.forEach((repo, index) => {
        const html = activeTab === 'changes' ? renderChangesRepository(repo) : renderStashRepository(repo);
        let rendered = renderedRepositories.get(repo.root);
        if (!rendered || rendered.html !== html || rendered.tab !== activeTab) {
            const template = document.createElement('template');
            template.innerHTML = html;
            const element = template.content.firstElementChild;
            if (rendered) rendered.element.replaceWith(element);
            rendered = { html, element, tab: activeTab };
            renderedRepositories.set(repo.root, rendered);
            changedSections.push(element);
            element.addEventListener('mousedown', () => { activeRepo = repo.root; updateButtons(); });
        }
        if (repos.children[index] !== rendered.element) repos.insertBefore(rendered.element, repos.children[index] || null);
    });

    restoreView();
    repos.scrollTop = scrollTop;
    if (wasStashInput) {
        const input = [...repos.querySelectorAll('.stash-message')].find(el => el.dataset.repo === focusedRepo);
        if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(selectionStart, selectionEnd); }
    }
    if (activeTab === 'stashes') {
        changedSections.forEach(bindStashEvents);
        return;
    }

    changedSections.forEach(bindChangeEvents);
    for (const repo of state.repositories) updateParentChecks(repo.root);
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
    const loaded = Array.isArray(stash.files);
    const key = stashKey(repo.root, stash.hash);
    if (loaded) pendingStashes.delete(key);
    const fileRows = files.length ? files.map(file =>
      '<div class="stash-file" data-repo="' + esc(repo.root) + '" data-ref="' + esc(stash.hash) + '" data-file="' + esc(file.path) + '" data-untracked="' + (file.untracked ? 'true' : 'false') + '" title="Open stash diff">' +
        '<span class="stash-status">' + esc(file.status) + '</span>' +
        '<span class="stash-file-name">' + esc(file.name) + '</span>' +
        (file.dir ? '<span class="stash-file-dir">' + esc(file.dir) + '</span>' : '') +
      '</div>'
    ).join('') : '<div class="empty">' + (loaded ? 'No changed files.' : failedStashes.has(key) ? 'Could not load files. Close and reopen to retry.' : 'Loading files…') + '</div>';

    return '<details class="stash-card" data-key="' + esc(key) + '" data-repo="' + esc(repo.root) + '" data-hash="' + esc(stash.hash) + '" data-loaded="' + loaded + '">' +
      '<summary class="stash-summary">' +
        '<span class="stash-title">' + esc(stash.message || stash.ref) + '</span>' +
        '<span class="stash-meta">' + (loaded ? files.length + ' file' + (files.length === 1 ? '' : 's') : 'Expand to load files') + '</span>' +
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

function bindStashEvents(scope) {
    scope.querySelectorAll('.stash-card').forEach(card => {
        card.addEventListener('toggle', () => {
            const key = card.dataset.key;
            if (!card.open) { failedStashes.delete(key); return; }
            if (card.dataset.loaded === 'true' || pendingStashes.has(key) || failedStashes.has(key)) return;
            // Failed requests retry only after the user closes and reopens the card.
            if (failedStashes.has(key)) failedStashes.delete(key);
            pendingStashes.add(key);
            vscode.postMessage({ type: 'loadStash', repo: card.dataset.repo, hash: card.dataset.hash });
        });
    });
    scope.querySelectorAll('.stash-create-button').forEach(button => {
        button.addEventListener('click', () => createStash(button.dataset.repo));
    });
    scope.querySelectorAll('.stash-message').forEach(input => {
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                createStash(input.dataset.repo);
            }
        });
    });
    scope.querySelectorAll('.stash-action').forEach(button => {
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
    scope.querySelectorAll('.stash-file').forEach(file => {
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

function bindChangeEvents(scope) {
    scope.querySelectorAll('.file-row').forEach(el => {
        el.addEventListener('contextmenu', event => {
            const file = el.querySelector('.file-main');
            if (!file) return;
            showRollbackMenu(event, file.dataset.repo, [file.dataset.file]);
        });
    });

    scope.querySelectorAll('.tree-folder > summary').forEach(el => {
        el.addEventListener('contextmenu', event => {
            const input = el.querySelector('.folder-check');
            if (!input) return;
            const files = JSON.parse(input.dataset.files || '[]');
            showRollbackMenu(event, input.dataset.repo, files);
        });
    });

    scope.querySelectorAll('.branch').forEach(el => {
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

    scope.querySelectorAll('.branch-entry[data-submenu], .remote-entry[data-submenu]').forEach(el => {
        el.addEventListener('click', event => {
            event.stopPropagation();
            const entry = event.currentTarget;
            const submenu = entry.querySelector(':scope > .branch-submenu, :scope > .remote-submenu');
            if (submenu) submenu.classList.add('open');
        });
    });

    scope.querySelectorAll('.menu-header').forEach(el => {
        el.addEventListener('click', event => {
            event.stopPropagation();
            event.currentTarget.parentElement.classList.remove('open');
        });
    });

    scope.querySelectorAll('.push-entry[data-push-default]').forEach(el => {
        el.addEventListener('click', event => {
            event.stopPropagation();
            const push = event.currentTarget;
            document.querySelectorAll('.branch-menu').forEach(menu => menu.classList.add('hidden'));
            vscode.postMessage({ type: 'branchAction', repo: push.dataset.repo, action: 'push', remote: push.dataset.remote || undefined });
        });
    });

    scope.querySelectorAll('.branch-action[data-action]').forEach(el => {
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

    scope.querySelectorAll('.file-check').forEach(el => {
        el.addEventListener('change', event => {
            const input = event.currentTarget;
            setSelected(input.dataset.repo, [input.dataset.file], input.checked);
            updateParentChecks(input.dataset.repo);
        });
    });

    scope.querySelectorAll('.folder-check').forEach(el => el.addEventListener('click', event => event.stopPropagation()));
    scope.querySelectorAll('.group-check, .folder-check').forEach(el => {
        el.addEventListener('change', event => {
            const input = event.currentTarget;
            const files = JSON.parse(input.dataset.files || '[]');
            setSelected(input.dataset.repo, files, input.checked);
            syncVisibleChecks(input.dataset.repo);
        });
    });

    scope.querySelectorAll('.file-main').forEach(el => {
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
      ? renderTree(repo, files, title)
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

const statusClasses = ${JSON.stringify(gitStatusClasses)};
function gitStatusClass(status) {
    return statusClasses[status] || '';
}

function themeIconHtml(icon, extraClass) {
    if (!icon) return '';
    const classes = 'node-icon' + (extraClass ? ' ' + extraClass : '');
    if (icon.kind === 'image') {
        return '<span class="' + classes + '" aria-hidden="true"><img src="' + esc(icon.uri) + '"></span>';
    }
    if (icon.kind === 'font') {
        const style = [
            'font-family:' + JSON.stringify(icon.fontFamily),
            icon.color ? 'color:' + icon.color : '',
            icon.fontSize ? 'font-size:' + icon.fontSize : ''
        ].filter(Boolean).join(';');
        return '<span class="' + classes + ' node-icon-font" aria-hidden="true" style="' + esc(style) + '">' + esc(icon.character) + '</span>';
    }
    return '';
}

function fileThemeIcon(file) {
    return themeIconHtml(file.icon, 'file-theme-icon');
}

function folderThemeIcons(name) {
    const theme = state.fileIconTheme || {};
    const pair = (theme.folders && theme.folders[String(name || '').toLowerCase()]) || theme.defaultFolder || {};
    const open = themeIconHtml(pair.open || pair.closed, 'folder-icon-open');
    const closed = themeIconHtml(pair.closed || pair.open, 'folder-icon-closed');
    return open + closed;
}

function renderFileRow(repo, file, treeFile) {
    const statusClass = gitStatusClass(file.status);
    return '<div class="file-row' + (treeFile ? ' tree-file' : '') + (statusClass ? ' ' + statusClass : '') + '" title="' + esc(file.tooltip) + '">' +
      '<input class="file-check" type="checkbox" ' + (isSelected(repo.root, file.file) ? 'checked ' : '') +
        'data-repo="' + esc(repo.root) + '" data-file="' + esc(file.file) + '">' +
      fileThemeIcon(file) +
      '<div class="file-main" data-repo="' + esc(repo.root) + '" data-file="' + esc(file.file) + '" data-staged="' + (file.stagedOnly ? 'true' : 'false') + '" data-status="' + file.status + '">' +
        '<span class="file-name">' + esc(file.name) + '</span>' +
        (!treeFile && file.dir ? '<span class="file-dir">' + esc(file.dir) + '</span>' : '') +
      '</div></div>';
}

function renderTree(repo, files, group) {
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

    function nodeHtml(node, parts = []) {
        const dirs = [...node.dirs.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([name, child]) => {
            const descendants = descendantFiles(child);
            const filesJson = esc(JSON.stringify(descendants));
            const childParts = [...parts, name];
            const key = JSON.stringify([repo.root, group, ...childParts]);
            return '<details class="tree-folder" data-key="' + esc(key) + '" open>' +
              '<summary>' +
                '<input class="folder-check" type="checkbox" ' + selectionAttrs(repo.root, descendants) +
                  'title="Select folder"' +
                  'data-repo="' + esc(repo.root) + '" data-files="' + filesJson + '">' +
                folderThemeIcons(name) +
                '<span>' + esc(name) + '</span>' +
              '</summary>' +
              '<div class="tree-children">' + nodeHtml(child, childParts) + '</div>' +
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
    if (!repo || committingRepos.has(repo.root)) return;
    committingRepos.add(repo.root);
    updateButtons();
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

    generatingRepos.add(repo.root);
    updateButtons();
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
        const iconFontStyle = document.getElementById('file-icon-theme-fonts');
        if (iconFontStyle) iconFontStyle.textContent = state.fileIconTheme?.css || '';
        if (!state.repositories.some(repo => repo.root === activeRepo)) activeRepo = state.repositories[0]?.root || '';
        render();
    } else if (data.type === 'fatalError') {
        repos.innerHTML = '<div class="empty">AOH - Git failed to load. Check Output → AOH - Git.</div>';
        renderedRepositories.clear();
        renderedState = '';
        debug('Backend fatal error: ' + data.message);
    } else if (data.type === 'commitMessageGeneration') {
        data.running ? generatingRepos.add(data.repo) : generatingRepos.delete(data.repo);
        updateButtons();
    } else if (data.type === 'generatedCommitMessage') {
        if (activeRepo === data.repo || state.repositories.length === 1) {
            message.value = data.message || '';
            message.focus();
            message.setSelectionRange(message.value.length, message.value.length);
        }
    } else if (data.type === 'commitFinished') {
        committingRepos.delete(data.repo);
        updateButtons();
    } else if (data.type === 'stashLoadError') {
        const key = stashKey(data.repo, data.hash);
        pendingStashes.delete(key);
        failedStashes.add(key);
        const card = [...repos.querySelectorAll('.stash-card')].find(card => card.dataset.key === key);
        if (card) card.querySelector('.stash-files').textContent = 'Could not load files. Close and reopen to retry.';
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

function getNonce(): string {
    return randomBytes(24).toString('base64');
}
