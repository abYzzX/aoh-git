# Contributing to AOH - Git

Thanks for contributing to AOH - Git.

Before changing code, read `AOH-RULES.md`, `AGENT.md`, `EXTENSION-DESIGN.md`, and `CHANGELOG.md`.

## Workflow

Create a focused branch for the change and keep commits scoped. Avoid mixing unrelated cleanup with a feature or fix. Submit changes through a pull request rather than developing directly on the stable branch.

## Validation

Install dependencies and run:

```bash
npm test
```

`npm test` compiles the TypeScript sources and runs the automated Node tests. For UI or Git-integration changes, also test the extension in a real VS Code Extension Development Host.

## Tests

Add focused tests for deterministic behavior when practical, especially parsers, path handling, sorting, state transformations, and regressions. Do not build a large mock VS Code environment just to increase coverage.

## Documentation

Update `README.md` when users need to know about changed features, commands, settings, or requirements. Update `EXTENSION-DESIGN.md` for architecture or deliberate design changes. Add every user-visible change to the `Unreleased` section of `CHANGELOG.md`.

## Build and release infrastructure

This repository intentionally does not contain a Gitea Actions pipeline or GitVersion configuration. Do not add repository-local release infrastructure as part of an unrelated contribution.

## License

By contributing, you agree that your contribution is provided under the repository's MIT license.
