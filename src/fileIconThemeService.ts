import * as vscode from 'vscode';
import * as path from 'path';

export type RenderedThemeIcon =
    | { kind: 'image'; uri: string }
    | {
        kind: 'font';
        character: string;
        fontFamily: string;
        color?: string;
        fontSize?: string;
    };

export interface RenderedFolderIcons {
    closed?: RenderedThemeIcon;
    open?: RenderedThemeIcon;
}

interface IconDefinition {
    iconPath?: string;
    fontCharacter?: string;
    fontColor?: string;
    fontSize?: string;
    fontId?: string;
}

interface IconFontSource {
    path: string;
    format?: string;
}

interface IconFont {
    id: string;
    src: IconFontSource[];
    weight?: string;
    style?: string;
    size?: string;
}

interface FileIconThemeDocument {
    iconDefinitions?: Record<string, IconDefinition>;
    fonts?: IconFont[];
    file?: string;
    folder?: string;
    folderExpanded?: string;
    fileExtensions?: Record<string, string>;
    fileNames?: Record<string, string>;
    folderNames?: Record<string, string>;
    folderNamesExpanded?: Record<string, string>;
    light?: Partial<FileIconThemeDocument>;
    highContrast?: Partial<FileIconThemeDocument>;
}

interface IconThemeContribution {
    id: string;
    path: string;
}

export class FileIconThemeService {
    private theme?: FileIconThemeDocument;
    private themeFilePath?: string;
    private themeExtensionUri?: vscode.Uri;
    private fontFamilies = new Map<string, string>();
    private fontCss = '';

    constructor(private readonly output: vscode.OutputChannel) {}

    get resourceRoot(): vscode.Uri | undefined {
        return this.themeExtensionUri;
    }

    get css(): string {
        return this.fontCss;
    }

    async load(webview: vscode.Webview): Promise<void> {
        this.theme = undefined;
        this.themeFilePath = undefined;
        this.themeExtensionUri = undefined;
        this.fontFamilies.clear();
        this.fontCss = '';

        const themeId = vscode.workspace.getConfiguration('workbench').get<string>('iconTheme');
        if (!themeId) {
            this.output.appendLine('[icons] No active workbench icon theme configured.');
            return;
        }

        const match = this.findThemeContribution(themeId);
        if (!match) {
            this.output.appendLine(`[icons] Could not resolve active icon theme: ${themeId}`);
            return;
        }

        try {
            const themeFilePath = path.resolve(match.extension.extensionPath, match.contribution.path);
            const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(themeFilePath));
            const parsed = parseJsonc(Buffer.from(raw).toString('utf8')) as FileIconThemeDocument;
            const merged = this.applyColorThemeOverride(parsed);

            this.theme = normalizeThemeKeys(merged);
            this.themeFilePath = themeFilePath;
            this.themeExtensionUri = match.extension.extensionUri;
            this.buildFontCss(webview);

            this.output.appendLine(
                `[icons] Using file icon theme ${themeId} from ${match.extension.id}.`
            );
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            this.output.appendLine(`[icons] Failed to load ${themeId}: ${text}`);
        }
    }

    resolveFile(webview: vscode.Webview, filePath: string): RenderedThemeIcon | undefined {
        if (!this.theme) return undefined;

        const name = path.basename(filePath).toLowerCase();
        const iconId = this.theme.fileNames?.[name]
            ?? this.resolveExtensionIcon(name)
            ?? this.theme.file;

        return this.renderDefinition(webview, iconId);
    }

    resolveFolder(webview: vscode.Webview, folderName: string): RenderedFolderIcons {
        if (!this.theme) return {};

        const key = folderName.toLowerCase();
        const closedId = this.theme.folderNames?.[key] ?? this.theme.folder;
        const openId = this.theme.folderNamesExpanded?.[key]
            ?? this.theme.folderExpanded
            ?? closedId;

        return {
            closed: this.renderDefinition(webview, closedId),
            open: this.renderDefinition(webview, openId)
        };
    }

    private findThemeContribution(themeId: string): {
        extension: vscode.Extension<unknown>;
        contribution: IconThemeContribution;
    } | undefined {
        for (const extension of vscode.extensions.all) {
            const contributions = extension.packageJSON?.contributes?.iconThemes as IconThemeContribution[] | undefined;
            const contribution = contributions?.find(candidate => candidate.id === themeId);
            if (contribution) return { extension, contribution };
        }
        return undefined;
    }

    private applyColorThemeOverride(theme: FileIconThemeDocument): FileIconThemeDocument {
        switch (vscode.window.activeColorTheme.kind) {
            case vscode.ColorThemeKind.Light:
                return mergeTheme(theme, theme.light);
            case vscode.ColorThemeKind.HighContrastLight:
                return mergeTheme(mergeTheme(theme, theme.light), theme.highContrast);
            case vscode.ColorThemeKind.HighContrast:
                return mergeTheme(theme, theme.highContrast);
            default:
                return theme;
        }
    }

    private resolveExtensionIcon(fileName: string): string | undefined {
        const extensions = this.theme?.fileExtensions;
        if (!extensions) return undefined;

        const segments = fileName.split('.');
        if (segments.length < 2) return undefined;

        for (let index = 1; index < segments.length; index++) {
            const candidate = segments.slice(index).join('.');
            const icon = extensions[candidate];
            if (icon) return icon;
        }

        return undefined;
    }

    private renderDefinition(webview: vscode.Webview, iconId: string | undefined): RenderedThemeIcon | undefined {
        if (!iconId || !this.theme || !this.themeFilePath) return undefined;
        const definition = this.theme.iconDefinitions?.[iconId];
        if (!definition) return undefined;

        if (definition.iconPath) {
            const iconPath = path.resolve(path.dirname(this.themeFilePath), definition.iconPath);
            return {
                kind: 'image',
                uri: webview.asWebviewUri(vscode.Uri.file(iconPath)).toString()
            };
        }

        if (definition.fontCharacter) {
            const fontId = definition.fontId ?? this.theme.fonts?.[0]?.id;
            const fontFamily = fontId ? this.fontFamilies.get(fontId) : undefined;
            if (!fontFamily) return undefined;

            return {
                kind: 'font',
                character: decodeFontCharacter(definition.fontCharacter),
                fontFamily,
                color: definition.fontColor,
                fontSize: definition.fontSize
            };
        }

        return undefined;
    }

    private buildFontCss(webview: vscode.Webview): void {
        if (!this.theme?.fonts?.length || !this.themeFilePath) return;

        const rules: string[] = [];
        for (const font of this.theme.fonts) {
            const family = `aoh-file-icon-${sanitizeCssIdentifier(font.id)}`;
            this.fontFamilies.set(font.id, family);

            const sources = (font.src ?? []).map(source => {
                const fontPath = path.resolve(path.dirname(this.themeFilePath!), source.path);
                const uri = webview.asWebviewUri(vscode.Uri.file(fontPath)).toString();
                const format = source.format ? ` format('${escapeCssString(source.format)}')` : '';
                return `url('${escapeCssString(uri)}')${format}`;
            });

            if (!sources.length) continue;

            rules.push(
                `@font-face{font-family:'${escapeCssString(family)}';src:${sources.join(',')};` +
                `${font.weight ? `font-weight:${font.weight};` : ''}` +
                `${font.style ? `font-style:${font.style};` : ''}}`
            );
        }

        this.fontCss = rules.join('\n');
    }
}

function mergeTheme(
    base: FileIconThemeDocument,
    override: Partial<FileIconThemeDocument> | undefined
): FileIconThemeDocument {
    if (!override) return base;

    return {
        ...base,
        ...override,
        iconDefinitions: { ...(base.iconDefinitions ?? {}), ...(override.iconDefinitions ?? {}) },
        fileExtensions: { ...(base.fileExtensions ?? {}), ...(override.fileExtensions ?? {}) },
        fileNames: { ...(base.fileNames ?? {}), ...(override.fileNames ?? {}) },
        folderNames: { ...(base.folderNames ?? {}), ...(override.folderNames ?? {}) },
        folderNamesExpanded: { ...(base.folderNamesExpanded ?? {}), ...(override.folderNamesExpanded ?? {}) },
        fonts: override.fonts ?? base.fonts
    };
}

function normalizeThemeKeys(theme: FileIconThemeDocument): FileIconThemeDocument {
    return {
        ...theme,
        fileExtensions: lowerCaseKeys(theme.fileExtensions),
        fileNames: lowerCaseKeys(theme.fileNames),
        folderNames: lowerCaseKeys(theme.folderNames),
        folderNamesExpanded: lowerCaseKeys(theme.folderNamesExpanded)
    };
}

function lowerCaseKeys<T>(source: Record<string, T> | undefined): Record<string, T> | undefined {
    if (!source) return undefined;
    return Object.fromEntries(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]));
}

function decodeFontCharacter(value: string): string {
    const match = /^\\([0-9a-fA-F]{1,6})\s?$/.exec(value);
    if (!match) return value;

    try {
        return String.fromCodePoint(Number.parseInt(match[1], 16));
    } catch {
        return value;
    }
}

function sanitizeCssIdentifier(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function escapeCssString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function parseJsonc(text: string): unknown {
    const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return JSON.parse(removeTrailingCommas(stripComments(withoutBom)));
}

function stripComments(text: string): string {
    let result = '';
    let inString = false;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = 0; index < text.length; index++) {
        const current = text[index];
        const next = text[index + 1];

        if (lineComment) {
            if (current === '\n' || current === '\r') {
                lineComment = false;
                result += current;
            } else {
                result += ' ';
            }
            continue;
        }

        if (blockComment) {
            if (current === '*' && next === '/') {
                blockComment = false;
                result += '  ';
                index++;
            } else {
                result += current === '\n' || current === '\r' ? current : ' ';
            }
            continue;
        }

        if (inString) {
            result += current;
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === '"') {
                inString = false;
            }
            continue;
        }

        if (current === '"') {
            inString = true;
            result += current;
            continue;
        }

        if (current === '/' && next === '/') {
            lineComment = true;
            result += '  ';
            index++;
            continue;
        }

        if (current === '/' && next === '*') {
            blockComment = true;
            result += '  ';
            index++;
            continue;
        }

        result += current;
    }

    return result;
}

function removeTrailingCommas(text: string): string {
    const chars = [...text];
    let inString = false;
    let escaped = false;

    for (let index = 0; index < chars.length; index++) {
        const current = chars[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === '"') {
                inString = false;
            }
            continue;
        }

        if (current === '"') {
            inString = true;
            continue;
        }

        if (current !== ',') continue;

        let next = index + 1;
        while (next < chars.length && /\s/.test(chars[next])) next++;
        if (chars[next] === '}' || chars[next] === ']') chars[index] = ' ';
    }

    return chars.join('');
}
