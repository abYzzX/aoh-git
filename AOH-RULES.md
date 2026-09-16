# AOH — Repository Rules

This document contains shared development rules for AOH extension repositories. It is intentionally extension-independent and should be reusable without project-specific changes.

Extension behavior, architecture, integrations, commands, settings, limitations, and release infrastructure belong in repository-specific documentation.

## Development philosophy

- Keep changes small and scoped to the requested problem.
- Preserve existing behavior unless a change is explicitly intended.
- Prefer VS Code and ecosystem APIs over parallel implementations.
- Prefer simple, explicit solutions over speculative abstraction.
- Integrate where useful; introduce dependencies only when they provide clear value.
- Do not perform unrelated cleanup during a focused change.
- Treat a known-good version as a stable baseline, not as the end of development.

## Required project documentation

Every AOH extension repository should keep these roles separate:

- `AOH-RULES.md` — shared AOH-wide rules.
- `AGENT.md` — repository-specific instructions for coding agents.
- `EXTENSION-DESIGN.md` — repository-specific requirements, architecture, decisions, supported behavior, and limitations.
- `README.md` — user-facing documentation.
- `CONTRIBUTING.md` — contribution workflow.
- `CHANGELOG.md` — released changes and current `Unreleased` work.

Do not put extension-specific implementation details in this file.

## Before changing code

1. Read the request completely.
2. Read `AOH-RULES.md`.
3. Read `AGENT.md`.
4. Read `EXTENSION-DESIGN.md`.
5. Read `CHANGELOG.md`, especially `Unreleased`.
6. Inspect the existing implementation before replacing anything.
7. Identify the smallest existing responsibility that should own the change.

## Development workflow

1. Implement the smallest reasonable change.
2. Add or update deterministic tests where useful.
3. Run the repository's documented test command.
4. Ensure the project compiles.
5. Update `README.md` for user-facing behavior, settings, commands, requirements, or features.
6. Update `EXTENSION-DESIGN.md` for architecture, requirements, trade-offs, limitations, or integrations.
7. Add user-visible changes to `CHANGELOG.md` under `Unreleased`.
8. Do not modify build, release, or publishing infrastructure unless explicitly requested.

## Testing

Prefer tests for pure and deterministic behavior: parsing, path handling, sorting, state transitions, configuration parsing, transformations, and regressions. Avoid large mocks of the complete VS Code API merely to increase coverage. Real-world testing in VS Code remains important but does not replace useful automated tests.

## Security

Never commit or log passwords, bearer tokens, PATs, private keys, or other authentication material. Prefer existing platform authentication mechanisms and keep credentials scoped to the service that needs them.

## Versioning and releases

Versioning, CI, release, and publishing mechanisms are repository/infrastructure concerns and may differ between AOH projects. Follow the repository-specific documentation and external build configuration. Do not introduce or change a release mechanism as a side effect of feature work.

## Changelog

`CHANGELOG.md` is part of the development process. Every user-visible change belongs under `Unreleased`, normally in `Added`, `Changed`, `Fixed`, or `Removed`. Write entries for users and describe observable behavior rather than internal implementation trivia.

## Definition of done

A change is complete when the requested behavior is implemented, relevant tests pass, the project compiles, documentation matches actual behavior, user-visible changes are recorded, no secrets are exposed, and unrelated behavior has not changed.
