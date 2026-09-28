/** Include Git API/CLI diagnostics without exposing URL credentials or auth headers. */
export function diagnosticText(error: unknown): string {
    const value = error as { message?: string; stderr?: string; gitErrorCode?: string; code?: unknown } | null;
    const text = typeof error === 'string' ? error : value && typeof value === 'object'
        ? [value.message, value.stderr, value.gitErrorCode, value.code].filter(Boolean).join('\n') || String(error)
        : String(error);
    return text.replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
        .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+\S+/gi, '$1[redacted]')
        .replace(/([?&](?:access_token|token|password)=)[^\s&]+/gi, '$1[redacted]');
}
