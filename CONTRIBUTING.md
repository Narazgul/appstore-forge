# Contributing

Thanks for looking. AppStore Forge is a small, opinionated tool — it does one
thing (turn raw app screenshots into store-ready assets) and tries to do it
without a server, an account, or a subscription.

## Getting set up

```bash
pnpm install
pnpm dev              # the editor on :4324, with hot reload
```

Other useful commands:

| Command           | What it does            |
| ----------------- | ----------------------- |
| `pnpm build`      | Static build in `dist/` |
| `pnpm typecheck`  | TypeScript, no emit     |
| `pnpm lint`       | ESLint                  |
| `pnpm test`       | Vitest, once            |
| `pnpm test:watch` | Vitest, watching        |
| `pnpm format`     | Prettier over the repo  |

It runs anywhere Node runs — there is no packaged app and no platform target.

## Read this before changing rendering code

`_context/` is the map, and it is short:

- **`_context/domain.md`** — the vocabulary and the data model. Read first.
- **`_context/rules.md`** — the invariants. These are not style preferences;
  breaking them produces wrong exported pixels.
- **`_context/workflows.md`** — build, run, version, verify.

The single most important one: **the preview and the export run the same code.**
`renderScene(ctx, w, h, screen, settings, sources)` is called at ~230px wide for
the preview and at 1320×2868 for the export. If you add a visual feature, it goes
in the renderer — never in CSS on top of the canvas, or the two drift apart and
what the user sees stops being what they get.

## How the code is laid out

```
src/
  render/scene.ts        the renderer — background, backdrop, device placement
  render/text.ts         markup, line breaking, auto-shrink, marker bands
  render/frames.ts       device body, bezel, screen clip, Dynamic Island / punch-hole
  presets/               devices, backgrounds, fonts, layouts, rhythms, templates, sizes
  components/steps/      one file per step of the guided flow
  components/tune/       one file per section of the fine-tune panel
  lib/export.ts          renders every screen full-size, then zips the set
  store.ts               zustand: screens, decoded images, settings
```

## Adding presets

Most contributions are new presets, and most of them are a few lines:

- **A device** — one object in `src/presets/devices.ts`. Frames are drawn from a
  geometric description (screen aspect, bezel, corner radius, notch kind), so
  there is no artwork to produce or license.
- **A background, font, layout, rhythm, or template** — one object in the
  matching file under `src/presets/`.

`src/presets/presets.test.ts` checks that every id you reference actually
resolves and that the numbers are in a sane range. Run `pnpm test` — a typo in a
preset id degrades silently into a fallback at runtime rather than throwing, so
that test is the thing that catches it.

## Tests

Unit tests cover the pure logic: markup parsing, line breaking and auto-shrink,
device geometry, settings inheritance, readiness, and preset integrity. Anything
that needs a real canvas is **not** unit-tested — a DOM assertion cannot see a
wrong bezel or a font that silently fell back. Verify those visually, and check
pixel-level claims with `window.__renderExport` (see `_context/workflows.md`).

## Sending a change

1. Branch off `main`.
2. Make the change. Match the surrounding style — the codebase leans on short
   functions and comments that explain _why_, not _what_.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all clean.
4. For anything visible, attach a before/after screenshot to the PR.
5. Conventional commit messages (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).

Open an issue first for anything large — it saves you building something that
does not fit the tool's shape.

## Scope

Things that fit: more devices, more looks, better typography, more store sizes,
export ergonomics, accessibility.

Things that do not: accounts, cloud sync, uploading images anywhere, analytics,
or anything that requires a server. The privacy story — _the images never leave
the machine_ — is the point, not an implementation detail.

By contributing you agree that your work is licensed under the
[MIT License](LICENSE).
