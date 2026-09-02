# Domain

## The problem

Shipping a mobile app means producing 5–10 marketing screenshots per store, per
device family, every release. The raw captures from a simulator are not
acceptable as-is — stores expect framed, captioned, designed images at exact
pixel sizes. Doing this by hand in Figma each release is the pain this app
exists to remove.

The important consequence: **the second release matters more than the first.**
Anything that makes re-doing a set cheap is worth more than another styling
option.

## Vocabulary

| Term                       | Meaning                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen**                 | One output image. Owns a source screenshot, a headline, a subtitle, and its overrides.                                                                                                                                                                                                                                                                              |
| **Source screenshot**      | The raw PNG the user dropped in. Never modified — only drawn into a device frame.                                                                                                                                                                                                                                                                                   |
| **Settings**               | The global look: background, device, layout, arrangement, type, tilt, scale, export size.                                                                                                                                                                                                                                                                           |
| **Override**               | A setting pinned on one Screen. Absent key = inherit from Settings.                                                                                                                                                                                                                                                                                                 |
| **Device frame**           | The phone/tablet body drawn around a source screenshot. Pure geometry, no bitmaps.                                                                                                                                                                                                                                                                                  |
| **Layout**                 | One composition: the text box, the device band (or a fixed device width and centre), and its **span** — how many store tiles it covers. A span-2 layout (panorama) is drawn once at double width and sliced into two PNGs on export.                                                                                                                                |
| **Arrangement** (position) | How many device frames appear and where. May pull in neighbouring Screens.                                                                                                                                                                                                                                                                                          |
| **Template**               | A complete look: a Settings preset plus per-screen **variants**. A template _with_ variants is a **set template**: it has a fixed number of **slots** (one per variant) that are laid out the moment it is chosen. A template without variants (Classic) is **freeform** — any number of screens.                                                                   |
| **Rhythm**                 | The strip's sequence of compositions (layout + arrangement + alignment per tile), independent of the look — Goldie's "template". `applyRhythm` pins those three keys as overrides by screen index and leaves colours alone. `uniform` clears them.                                                                                                                  |
| **Slot**                   | A Screen created by a set template. `imageId: null` while unfilled; it previews with the drawn placeholder and carries the template's sample copy. Export is gated until every slot is filled. In a Project the word is literal: a slot is one entry in `set.slots`, an id plus the source screen it draws and its overrides, and it becomes one Screen per Locale. |
| **Project**                | A set kept in files inside the user's repo instead of in the tab: `aso/<setId>.json` plus `aso/copy/<locale>.json`. The GUI and the CLI are two views on the same files. The alternative is **freeform mode** — no project, everything in memory, export as a zip.                                                                                                  |
| **Project set**            | One `<setId>.json`: targets, locales, sources template, shared settings, slots, approval. `default` is the set you get without asking; a second set is `promo.json` with its copy under `copy/promo/`.                                                                                                                                                              |
| **Target**                 | One store output: an export size, a device and an `out` path template with `{storeLocale}` and `{n}`. Targets share the set's slots, copy and settings — only canvas size and device differ.                                                                                                                                                                        |
| **Locale**                 | One language of the set: an id used for the source path, the copy file name and the renderer's `lang` (script font, RTL), plus one **store locale** per target — the folder name the store wants (`en-US`, `de-DE`).                                                                                                                                                |
| **Copy**                   | Headline and subhead per slot, per locale. Lives outside the set file so a translator touches one small JSON and nothing else.                                                                                                                                                                                                                                      |
| **Approval**               | A stamp — hash, who, when — over the set, all copy and the bytes of every source image. Any edit to any of the three makes it stale. `--require-approval` turns it into a gate on rendering.                                                                                                                                                                        |
| **Highlight**              | A marker band drawn behind `*starred*` words in a headline. Spans cycle through `settings.highlights`.                                                                                                                                                                                                                                                              |
| **Backdrop**               | A rounded card drawn behind the device band, between background and text.                                                                                                                                                                                                                                                                                           |
| **Export size**            | Target canvas in pixels. Global — a set cannot mix sizes.                                                                                                                                                                                                                                                                                                           |

## Data model

```ts
Screen   = { id, headline, subhead, imageId, overrides: Partial<Settings>, lang? }
Settings = { background, backdropColor, deviceId, frameColorId, positionId, layout,
             tilt, deviceScale, textColor, textAlign, highlights, fontId,
             headlineScale, subheadScale, headlineTracking, sizeId }
Template = { id, label, settings: Partial<Settings>, variants?: ScreenOverrides[], sample }
```

`lang` is the copy's BCP-47 language. It picks the script font stack and the text
direction; absent means Latin and LTR.

A project (`src/project/types.ts`) is the same material, keyed instead of listed:

```ts
Project = { set: ProjectSet, copies: ProjectCopies }
ProjectSet = { version: 1, id, targets, locales, sources, settings, slots, approval }
ProjectTarget = { id, sizeId, deviceId, out } // out: 'store/ios/{storeLocale}/{n}.png'
ProjectLocale = { id, store: Record<targetId, string> } // { ios: 'en-US', play: 'en-US' }
ProjectSlot = { id, kind: 'screen' | 'artwork', screen, overrides: ScreenOverrides }
ProjectCopies = Record<localeId, Record<slotId, { headline; subhead }>>
Approval = { hash, by, at } | null
```

`sources` is one path template with `{locale}` and `{screen}`; `settings` is
`Settings` minus `sizeId` and `deviceId`, which the target owns. `kind: 'artwork'`
exists in the type and is rejected by validation — it is a placeholder, not a
feature.

Headlines carry light markup: `*word*` highlights the word. `parseMarkup` in
`render/scene.ts` is the only parser; `stripMarkup` feeds filenames.

Applying a template (`applyTemplate` in the store) is `DEFAULT_SETTINGS` +
`template.settings`, keeping the user's `sizeId` and `deviceId`. A set template
then lays out `max(slots, filledScreens)` screens: screens that already hold an
image are kept (with `overrides = variants[i]`), the rest are empty slots with the
template's sample copy. A freeform template drops empty slots. `addFiles` fills
empty slots in order before appending; `setImage` fills one slot; `clearImage`
empties it without removing it. Variant overrides are ordinary overrides — they
travel with the screen when reordered and reset like any other.

Resolution is `{ ...settings, ...screen.overrides }`, computed in exactly one
place: the top of `renderScene`. `sizeId` is excluded from `ScreenOverrides` at
the type level — a set must share one canvas size.

## Architecture

```
src/render/scene.ts   THE renderer: background → text → device placements
src/render/frames.ts  device body, bezel, screen clip, Dynamic Island / punch-hole
src/presets/          backgrounds, devices, fonts, layouts, rhythms, templates, positions, sizes
src/render/placeholder.ts  drawn stand-in screenshot for template thumbnails
src/lib/settings.ts   override resolution + section grouping
src/lib/export.ts     full-size render → zip download
src/store.ts          zustand: screens, decoded images, settings, selection, step
src/lib/progress.ts   readiness(): the one reading of "how far along is the set" — rail, footer and review all use it
src/components/Rail.tsx          the guided flow: six steps with status; navigation, never a gate
src/components/Footer.tsx        status line + the step's one primary action (Next / Export)
src/components/steps/*           Target → Look → Screenshots → Copy → Fine-tune → Review & export
src/components/TunePanel.tsx     the full control set, scoped to all screens or the selected one
src/components/StorePreview.tsx  the set inside a mock App Store product page (Review step)
src/render/placeholder.ts  drawn stand-in screenshot for template thumbnails
src/lib/settings.ts   override resolution + section grouping
src/lib/export.ts     full-size render → zip download
src/store.ts          zustand: screens, decoded images, settings, selection, page
```

### The one decision everything rests on

`renderScene(ctx, w, h, screen, settings, sources)` draws the preview at ~230px
and the export at 1320×2868. Same function, same call, only `w`/`h` differ.
`w`/`h` are one store _tile_; a span-2 layout draws `2w` wide, and the caller
sizes the canvas with `sceneSpan(screen, settings)` — the only other place that
resolves overrides, and it delegates to `effectiveSettings`.

There is deliberately **no second rendering path**. Any feature added as
CSS-in-the-preview would immediately drift from the export and reintroduce the
"looked right in the app, wrong in the PNG" failure this design exists to
prevent.

### Device frames are drawn, not imported

A device is a geometric description — screen aspect, bezel fraction, corner
radius fraction, notch kind — rendered with canvas primitives. No bitmap assets
to scale or license, and adding a device is a one-line object in
`presets/devices.ts`.

### The flow is a checklist, not a wizard

The six steps follow the order the decisions depend on (size shapes the canvas,
the look shapes the slots, the slots take screenshots, copy sits on them). But
nothing is locked: every step is clickable at any time, files can be dropped on
any step, headlines are editable in both Screenshots and Copy, and Export is in
the footer on every step — disabled only while a slot is empty, with the reason
as its label. Colour is used for status only: green = done, amber = needs
attention, the accent = the current step and the primary action.

### Project mode is a second door, not a second app

```
src/project/types.ts     the file format
src/project/validate.ts  validateProject(project, sourceExists) → Issue[]; errors block, warns do not
src/project/hash.ts      approvalHash(): canonical JSON of set + copies, then every source image's bytes
src/project/bridge.ts    screensFor / settingsFor: project (locale, target) → the Screen[] + Settings the renderer takes
src/project/store.ts     ProjectStore — load, save, sourceUrl, sourceBytes, subscribe. The seam a backend plugs into
src/adapters/fileClient.ts  the only implementation: talks to the dev server over /api/project and /sources
cli/index.ts             argument parsing and the exit codes
cli/commands.ts          check / render / approve on top of the same validate and hash
cli/render.ts            headless render via @napi-rs/canvas, written as RGB PNG (pngjs, colorType 2)
cli/fonts.ts             registers every family with Skia up front — it has no fallback we control
vite-plugin-project.ts   GET/PUT /api/project, /sources/*, and a watcher that pushes `project:changed`
```

The bridge is the whole idea: a project is turned into the `Screen[]` and
`Settings` the existing renderer already takes, so nothing about drawing knows
that project mode exists. There is one renderer (rules.md, rule 1) and project
mode did not get to add a second.

The GUI reaches the files only through `ProjectStore`. Everything above it —
locale switch, Copy step, Review grid, Approve — is written against that
interface, so a remote backend is a new adapter and no store change. There is no
locking: two editors on one project overwrite each other, last write wins.

`approval` is excluded from its own hash, so stamping does not invalidate the
stamp. Every write path in the store sets `approval: null` — an edit must not
keep a stamp alive.

## Store constraints worth knowing

- Only the largest device per family is required; stores downscale for the rest.
- App Store Connect **rejects images carrying an alpha channel**. Canvas always
  writes RGBA for PNG even when fully opaque — hence the JPEG toggle.
- Google Play: 2–8 phone screenshots, max 2:1 aspect.
