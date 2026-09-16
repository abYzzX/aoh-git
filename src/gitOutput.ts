export interface RemoteBranchGroup {
    readonly name: string;
    readonly branches: string[];
}

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
