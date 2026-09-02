# AppStore Forge

A local tool (React + canvas, served by Vite) that turns raw app screenshots into
store-ready App Store and Google Play assets. It ships as an npm package
installed straight from GitHub, not as a packaged desktop app.

It runs in two modes. **Freeform**: everything in the tab, export as a zip.
**Project mode**: the set lives as JSON files in the user's repo (`aso/<setId>.json`
plus `aso/copy/<locale>.json`), edited by the same GUI and rendered headlessly by
the `forge` CLI. Both modes go through one renderer — see `_context/domain.md`,
"Project mode is a second door, not a second app".

Read `_context/` before changing anything:

- `_context/domain.md` — the vocabulary and the data model. Read first.
- `_context/rules.md` — the invariants. These are not style preferences; breaking
  them produces wrong exported pixels.
- `_context/workflows.md` — how to build, run, and verify.

## Run it

```bash
pnpm install          # once
pnpm dev              # the editor in a browser on :4324
```

| Command          | Use it when                                           |
| ---------------- | ----------------------------------------------------- |
| `pnpm dev`       | Iterating on the UI, with hot reload                  |
| `pnpm build`     | Static build in `dist/`                               |
| `pnpm typecheck` | Before any build                                      |
| `pnpm lint`      | ESLint                                                |
| `pnpm test`      | Vitest — pure logic only, see `_context/workflows.md` |
| `pnpm format`    | Prettier over the repo                                |

The CLI is `bin/forge.mjs` → `cli/index.ts`:

| Command                                | Use it when                                     |
| -------------------------------------- | ----------------------------------------------- |
| `forge check --project <dir>`          | Asking whether a set is complete                |
| `forge render --project <dir>`         | Writing the PNGs — RGB, no alpha                |
| `forge approve --project <dir> --by X` | Stamping a set as reviewed                      |
| `forge dev --project <dir>`            | The editor on a project instead of an empty tab |

Exit codes are the contract: `0` fine, `1` usage, `2` the project does not
validate, `3` approval required but missing or stale. README's "Project mode"
section has the full option list; the per-file workflows are "Adding a locale"
and "Adding a target" in `_context/workflows.md`.

## Dependencies

Consumers install this package from GitHub, so everything imported at runtime
belongs in `dependencies`. `devDependencies` is only for what builds, lints, and
tests the repo itself.

## Versioning

`package.json` `version` is the single source of truth. It reaches the sidebar
subtitle via `__APP_VERSION__`, injected by `define` in `vite.config.ts`.

```bash
pnpm version patch --no-git-tag-version   # or minor / major
```

Never hardcode a version string anywhere else.

## Verifying a change

The preview is a `<canvas>`. The DOM tells you nothing about whether the drawing
is correct — a `describe` tree cannot see a wrong bezel, a clipped headline, or a
font that silently fell back. Visual changes must be checked from screenshots,
and pixel-level claims must be checked with `window.__renderExport`.

See `_context/workflows.md` for the automation hooks and the standard checks.
