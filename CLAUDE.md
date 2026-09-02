# AppStore Forge

A local tool (React + canvas, served by Vite) that turns raw app screenshots into
store-ready App Store and Google Play assets. It ships as an npm package
installed straight from GitHub, not as a packaged desktop app.

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
