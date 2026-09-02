# Workflows

## Adding a device frame

`src/presets/devices.ts` — one object:

```ts
{ id: 'pixel-10', label: 'Pixel 10', group: 'Android',
  screenAspect: 1280 / 2856, bezel: 0.026, radius: 0.085, notch: 'punch' }
```

`bezel` and `radius` are fractions of the **outer frame width**. `frameAspect()`
derives the outer ratio; nothing else needs touching. Give families distinct
character — Pixels rounder, Samsungs squarer with thinner bezels, budget phones
thicker — or the picker feels fake.

## Adding a setting

1. Add the key to `Settings` in `types.ts`. It becomes overridable automatically
   unless it must be global (like `sizeId`, excluded via `OverridableKey`).
2. Default it in `DEFAULT_SETTINGS` in `store.ts`.
3. Consume it in `renderScene`.
4. Add the control to the matching section in `components/tune/` using
   `settings.<key>` to read and `put({...})` to write — `put` routes to the
   selected screen or the global scope, and a section never needs to know which.
   `TunePanel.tsx` itself owns only the scope switch. If the setting is a
   first-order decision (like store size), it belongs in a step instead
   (`components/steps/`).
5. List the key in `SECTION_KEYS` in `lib/settings.ts` so the section's override
   dot and "Reset to all screens" link know about it.

Do not add a bespoke per-screen field. That was the original `tilt: number | null`
mistake; overrides replaced it.

## Adding a layout

`src/presets/layouts.ts`. Vertical values are fractions of the tile height;
horizontal ones of the _composition_ width (`tile × span`). Leave `device.width`
out to fit the band (the classic behaviour); set it, plus `cx`/`cy`, for a
Goldie-style absolute placement (`hero`, `panorama`). `text.left`/`text.width`
put the copy somewhere other than the padded tile — a panorama keeps it on the
left tile. Nothing else needs touching: preview, gallery strips, the store page
and export all read `span` from the layout.

## Adding a rhythm

`src/presets/rhythms.ts` — a list of `STEP`s (layout + arrangement + alignment).
The picker's glyph is drawn from `composeDevices`, the same geometry the
renderer uses, so a new step needs no artwork. A set template whose variants
follow a built-in rhythm names it in `rhythm`; otherwise its own compositions
appear in the picker as "<Template> (template)".

## Adding an arrangement

`src/presets/positions.ts`. Placements draw back to front. `dx`/`dy` are offsets
from the slot centre as fractions of canvas width/height. `source` picks which
screenshot fills that frame — `'self' | 'next' | 'prev'` — and indices wrap, so a
multi-device arrangement still works with one screen loaded.

Watch the edges: flanking devices bleeding off-canvas is fine, but cutting into
legible content in the neighbouring screenshot is not.

## Adding a template

`src/presets/templates.ts` — one object. `settings` is laid over `DEFAULT_SETTINGS`
(a template is a reset, so only list what differs). `variants` is optional; when
present, screen `i` is pinned to `variants[i % n]`. Any key in `Settings` except
`sizeId` / `deviceId` works in both. If the look needs geometry that no layout
provides, add a layout in `presets/layouts.ts` first — never special-case a
template inside `renderScene`.

`variants.length` is the slot count — a set template with five variants opens
five slots. `samples[i]` is the copy an unfilled slot `i` shows (and `samples[0]`
is the gallery thumbnail), so give one sample per variant. Use `*stars*` in them
if the highlight colours are part of its character. Omit `variants` for a
freeform template.

## Adding a locale

To a project (`aso/<setId>.json`), not to a preset file.

1. One entry in `locales`, with a store locale for **every** target — the folder
   name that store wants, which is rarely the same string as the id:

   ```json
   { "id": "de", "store": { "ios": "de-DE", "play": "de-DE" } }
   ```

   A target without a store locale is a validation error, not a fallback.

2. The source screenshots. `sources` is a template (`screenshots/{locale}/{screen}.png`)
   resolved against the **parent** of the project folder, and every slot's
   `screen` must exist for the new locale.

3. `copy/de.json` — `{ "<slotId>": { "headline": "...", "subhead": "" } }`. A
   missing or blank headline is an error; a subhead is optional. Copy for a slot
   that no longer exists is a warning, and the GUI drops it when the slot goes.

4. A non-Latin script needs a face. Inter covers Latin, Cyrillic, Greek and
   Vietnamese; anything else is a row in `src/presets/scripts.ts` plus the TTF in
   `fonts/`. The CLI registers every family up front (`cli/fonts.ts`, Skia has no
   fallback we control); the browser fetches only the families the project's
   locales need (`preloadScriptFonts`) and **throws** if one is not available —
   a silent fallback would be a wrong export (rules.md, rule 3). Hebrew is
   detected as RTL but has no bundled face.

5. `forge check --project ./aso`. Exit 2 lists what is missing, per slot and
   locale.

Adding a locale invalidates the approval stamp, and it should: nobody has looked
at the new language yet.

## Adding a target

1. One entry in `targets`:

   ```json
   {
     "id": "play",
     "sizeId": "android-phone",
     "deviceId": "pixel-9-pro",
     "out": "store/play/{storeLocale}/{n}.png"
   }
   ```

   `sizeId` comes from `presets/sizes.ts`, `deviceId` from `presets/devices.ts`;
   an unknown id is an error rather than the usual silent first-row fallback.

2. Add the new target id to the `store` map of every locale.

3. Watch the `out` template. A render pass clears the PNGs in each folder it
   writes to (once per folder, so locales sharing one survive each other), and
   `{n}` restarts at 1 per target and locale — two targets may share a folder
   only if the file name keeps them apart. A span-2 layout produces two files and
   advances `{n}` twice, so `{n}` is a file counter, not a slot index.

4. Nothing else. A target only carries size and device; the look lives in the
   set's `settings` and the slots' overrides, so all targets stay in step. In the
   GUI the Target step edits the active target's size and device through
   `updateTarget` and writes back to the same file.

Render one target while iterating: `forge render --project ./aso --target play`.

## Adding a step or a readiness rule

The rail, footer and Review step all read `readiness()` in `lib/progress.ts`;
add a rule there and every surface picks it up. A new step is a `StepId` in
`store.ts`, a component in `components/steps/`, a title in `Rail.tsx` and a
"Next" label in `Footer.tsx`. Keep it navigable — no step may block another.

## Automation hooks

This is a local tool with no untrusted content, and scripting it is a feature.

```js
window.__store // the zustand store; __store.getState().setStep('review') jumps steps
window.__renderExport(screens, settings, images, 'png')
// the real export renderer, no download
```

Load images without faking drag-and-drop:

```js
const blob = await new Promise((r) => canvas.toBlob(r))
await window.__store.getState().addFiles([new File([blob], 'x.png', { type: 'image/png' })])
```

## Tests

`pnpm test` (Vitest, node environment). The suite covers the pure logic only:

- `render/text.test.ts` — markup parsing, line breaking, auto-shrink
- `render/scene.test.ts` — device geometry, span
- `lib/settings.test.ts` — override inheritance, `SECTION_KEYS` completeness
- `lib/progress.test.ts` — readiness and store limits
- `presets/presets.test.ts` — every preset id resolves, every number is in range
- `presets/scripts.test.ts` — script detection and RTL per language tag
- `store.test.ts` — variant cycling, slot counts, template reset
- `project/*.test.ts` — validation issues, the approval hash, the bridge
- `cli/*.test.ts` — the commands and their exit codes, project read/write, the
  headless render (real canvas via `@napi-rs/canvas`, so these do produce pixels),
  and the dev server's PUT guard

In the browser, nothing that needs a real canvas is unit-tested, and that is
deliberate: a DOM assertion cannot see a wrong bezel, a clipped headline, or a
font that silently fell back. Those are verified from screenshots (below).

The CLI render is the one exception, because `@napi-rs/canvas` gives node a real
canvas. Even there the assertions stay outside the drawing — file names, counts,
and the PNG header (size and `colorType: 2`, which is what proves the output
carries no alpha). Whether the picture is right is still a screenshot question.

The preset test earns its keep because a bad preset id does not throw — every
lookup falls back to the first row — so a typo ships as a silently wrong render.

Import discipline: the test environment is node, so a module that touches
`window` at import time must guard it (`store.ts` and `lib/export.ts` do, for
their automation handles).

## Verifying a visual change

Drive the dev server (`pnpm dev`, `:4324`) over CDP. Start from a fresh page —
a stale tab with leftover state will otherwise be reused and you will verify the
wrong thing. For project mode use `forge dev --project <dir>`, which serves the
same app on the same port with the project middleware attached.

Then:

1. Load synthetic screens with **visually distinct** content (different header
   colours and words). You cannot tell which screenshot landed in which frame if
   they all look alike — this is what catches multi-device arrangements
   repeating one image.
2. Screenshot after each change. Judge from the image, not the DOM.
3. For anything touching output pixels, prove it with `__renderExport`: hash the
   bytes before and after, confirm the target screen changed **and** the others
   are byte-identical.

## Known trap: canvas fonts

If a headline renders in the wrong typeface only in the export, the font was not
loaded before `ctx.font` used it. Check:

```js
document.fonts.check('700 100px "Poppins"') // must be true
```

and compare `measureText` width against a monospace baseline — equal widths mean
it fell back.

## Release checklist

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm version patch --no-git-tag-version
```

Then confirm the sidebar subtitle shows the new version.
