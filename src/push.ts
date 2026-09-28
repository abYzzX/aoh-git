export interface PushTarget { branch: string; remote: string; publish: boolean }

export function needsPublication(
    branch: string, upstream?: { remote: string; name: string }, requestedRemote?: string
): boolean {
    return !upstream || upstream.name !== branch || (!!requestedRemote && requestedRemote !== upstream.remote);
}

/** Explicit destination avoids push.default and configured push refspec surprises. */
export function pushArguments(target: PushTarget): string[] {
    return ['push', ...(target.publish ? ['--set-upstream'] : []), '--', target.remote,
        `HEAD:refs/heads/${target.branch}`];
}
