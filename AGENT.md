# AOH - Git — Agent Instructions

Read `AOH-RULES.md`, this file, `EXTENSION-DESIGN.md`, and the `Unreleased` section of `CHANGELOG.md` before changing the repository.

## Project focus

AOH - Git provides a compact, Rider-inspired Git workflow inside VS Code. Keep the extension focused on everyday Git operations and avoid rebuilding Git itself or hiding Git semantics from the user.

## Implementation rules

- Use the built-in `vscode.git` extension API when it already exposes the required repository state or operation reliably.
- Use the Git CLI for operations or information not suitably exposed by the VS Code Git API.
- Never parse human-formatted Git output when a stable machine-readable format is available.
- Keep destructive operations explicit and confirmed where the existing UX requires confirmation.
- Do not silently resolve merge conflicts or discard unmerged work.
- Preserve multi-repository workspace support.
- AI commit-message support must remain optional and provider-neutral. The configured external CLI is the integration boundary; do not add provider SDKs without an explicit requirement.
- Do not log tokens, credentials, complete secret-bearing command lines, or sensitive environment values.

## Tests

Pure Git-output parsing and other deterministic logic should live outside VS Code-dependent classes when practical so it can be tested with Node's built-in test runner.

Run:

```bash
npm test
```

This compiles the extension and executes the tests from `out/test`.

When fixing a deterministic regression, add a regression test if the behavior can be isolated without mocking the whole VS Code runtime.

## Documentation

- User-visible features, commands, settings, and requirements: `README.md`
- Architecture and design decisions: `EXTENSION-DESIGN.md`
- User-visible changes: `CHANGELOG.md` under `Unreleased`
- Shared AOH rules: `AOH-RULES.md`

This repository intentionally contains no repository-local Gitea Actions pipeline or GitVersion configuration. Do not add either unless explicitly requested.
