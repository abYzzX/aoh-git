export function parseLocalBranches(output: string): string[] {
    return output
        .split(/\r?\n/)
        .map(value => value.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}

export function parseRemoteBranches(output: string): string[] {
    return output
        .split(/\r?\n/)
        .map(value => value.trim())
        .filter(Boolean)
        .map(line => {
            const [name, symref] = line.split('|', 2);
            return { name, symref };
        })
        .filter(({ name, symref }) => Boolean(name) && !symref && !name.endsWith('/HEAD'))
        .map(({ name }) => name)
        .sort((a, b) => a.localeCompare(b));
}

export function splitRemoteBranch(remoteBranch: string): { remote: string; branch: string } {
    const slash = remoteBranch.indexOf('/');
    if (slash < 1 || slash === remoteBranch.length - 1) {
        return { remote: '', branch: remoteBranch };
    }

    return {
        remote: remoteBranch.slice(0, slash),
        branch: remoteBranch.slice(slash + 1)
    };
}

export function parseNullPaths(output: string): string[] {
    return output.split('\0').filter(value => value.length > 0);
}

/** --name-status -z --no-renames emits alternating status/path fields. */
export function parseNameStatus(output: string): Array<{ status: string; path: string }> {
    const fields = parseNullPaths(output);
    if (fields.length % 2) throw new Error('Invalid Git name-status output.');
    const files = [];
    for (let i = 0; i < fields.length; i += 2) {
        files.push({ status: fields[i], path: fields[i + 1] });
    }
    return files;
}

export function parseStashes(output: string) {
    const fields = output.split('\0');
    if (fields.at(-1) === '') fields.pop();
    if (fields.length % 5) throw new Error('Invalid Git stash-list output.');
    const entries = [];
    for (let i = 0; i < fields.length; i += 5) {
        entries.push({
            ref: fields[i], hash: fields[i + 1], timestamp: Number(fields[i + 2]) || 0,
            message: fields[i + 3], parents: fields[i + 4].split(' ').filter(Boolean)
        });
    }
    return entries;
}
