# Agent Preferences

Use these preferences when working in this repository.

## Engineering Style

- Keep code concise, robust, modern, and easy to reason about.
- Prefer simple, direct solutions over over-engineered abstractions.
- Follow current best practices and current stable APIs.
- Use the existing project style and structure unless there is a clear reason to improve it.
- Avoid hacky behavior, hidden assumptions, and fragile workarounds.
- Favor explicit, defensible behavior over guessing when an API does not expose reliable state.

## Redundancy

- Avoid duplicate or redundant code.
- Do not write explicit types when TypeScript can infer them cleanly.
- Avoid tiny one-use helpers unless they remove real complexity or clarify a non-obvious operation.
- Do not create abstractions just to make code look organized.
- Remove unused template files, dependencies, tooling, and stale docs.

## Performance

- Do not do expensive work at startup.
- Prefer lazy detection, caching, and narrowly scoped checks.
- Avoid blocking the UI or running broad filesystem/process scans.
- Keep command execution paths efficient and predictable.
- Be careful with cross-platform checks so one environment does not accidentally probe or depend on another.

## Robustness

- Handle common edge cases, malformed settings, missing files, unusual paths, and unsupported environments.
- Use platform-aware path and shell handling rather than ad hoc string guesses.
- Prefer official APIs over parsing UI text, terminal output, clipboard state, or other brittle signals.
- Make behavior configurable when reasonable, but do not overcomplicate defaults.
- Keep cross-platform behavior in mind for Windows, macOS, Linux, WSL, and remote environments.

## Testing

- Add focused tests for base cases and edge cases.
- Cover parsing, quoting, path handling, config handling, runtime/tool detection, and platform-specific behavior when relevant.
- Tests should protect behavior without becoming noisy or overbroad.
- Run compile, lint, and tests before considering the work done.

## UX And Docs

- Keep UI minimal, clear, and uncluttered.
- Use familiar icons and visible, readable colors when UI elements need to stand out.
- Prefer settings for user-adjustable behavior instead of hardcoding personal preferences.
- Keep README and changelog concise and accurate.
- For an initial release, write the changelog as an initial-release summary, not as a list of internal iteration fixes.
