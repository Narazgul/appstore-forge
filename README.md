<h1 align="center">AppStore Forge</h1>

<p align="center">
  Turn raw app screenshots into store-ready App Store and Google Play assets.<br>
  Runs locally in your browser. No account, no upload, no server — the images never leave your machine.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="Walking through the four steps: choosing a store target, picking a look, filling and tuning the screenshots, and reviewing the finished set" width="820">
</p>

---

Drop your PNGs in, pick a background and a device frame, write a headline per
screen, download the set. Four steps, and the app tells you at every point what is
still missing before the set can be uploaded.

- **Frames without artwork.** Devices are drawn with canvas primitives from a
  geometric description, so there are no bitmap assets to ship, scale, or
  license — and adding a phone is a five-line object.
- **What you see is what ships.** The preview and the export call the same
  renderer. There is no CSS-to-canvas translation layer to drift out of sync.
- **Panoramas.** A composition can span two store tiles and gets sliced into
  consecutive PNGs on export.
- **Rhythms.** Vary the composition across the strip — a panorama opener, a hero,
  an offset, a breather — instead of ten identical tiles.
- **Nothing leaves the machine.** No network calls at all.

## Build and run it

You need Node and [pnpm](https://pnpm.io/installation):

```bash
git clone https://github.com/hebertporto/appstore-forge.git
cd appstore-forge
pnpm install
pnpm dev             # browser version on :4324
```

Installed as a package, the same editor opens a set that lives in your repo as
files — see [Project mode](#project-mode):

```bash
forge dev --project ./aso
```

| Command          | What it does                       |
| ---------------- | ---------------------------------- |
| `pnpm dev`       | The editor in a browser on `:4324` |
| `pnpm build`     | Static build in `dist/`            |
| `pnpm typecheck` | TypeScript, no emit                |
| `pnpm lint`      | ESLint                             |
| `pnpm test`      | Vitest — pure logic only           |

### What you should expect

- **It runs anywhere Node runs.** There is no packaged app and no platform
  restriction; the editor is a normal web build served from your own machine.
- **No releases, no binaries.** Nothing to download and nothing to trust — the
  source is the distribution.

## How it works

The one design decision everything else follows from: **the preview and the
export run the same code.**

`src/render/scene.ts` exposes a single
`renderScene(ctx, w, h, screen, settings, sources)`. The preview calls it at
~230px wide; the export calls it at 1320×2868. Nothing is re-implemented between
the two, so what is on screen is exactly what lands on disk.

```
src/
  render/scene.ts      the renderer — background, backdrop, device placement
  render/text.ts       markup, line breaking, auto-shrink, marker bands
  render/frames.ts     device body, bezel, screen clip, Dynamic Island / punch-hole
  presets/             devices, backgrounds, fonts, layouts, rhythms, templates, sizes
  components/steps/    one file per step of the guided flow
  components/tune/     one file per section of the fine-tune panel
  lib/export.ts        renders every screen full-size, then zips the set
  store.ts             zustand: screens, decoded images, settings
fonts/                 the bundled faces — one per selectable Latin font, plus one per script
samples/               four fake app screenshots for trying it out
_context/              domain model, invariants, and workflows — read before changing code
```

### Headline markup

Wrap words in stars to give them a marker band: `Everything in *one place*`.
Spans cycle through the highlight colours, so a second `*starred*` phrase picks
up the second colour.

## Export

Export renders every screen at full store resolution and downloads them as
`store-screenshots-<size-id>.zip`.

Only the largest device per family is required — both stores downscale for the rest.

| Store       | Target      | Pixels      |
| ----------- | ----------- | ----------- |
| App Store   | iPhone 6.9" | 1320 × 2868 |
| App Store   | iPhone 6.5" | 1242 × 2688 |
| App Store   | iPad 13"    | 2064 × 2752 |
| Google Play | Phone       | 1080 × 1920 |
| Google Play | Tablet      | 1600 × 2560 |

Google Play's **feature graphic** (1024 × 500) is a different shape entirely — landscape, one
image, no device frame — and is a project-mode target, not a browser export; see
[Feature graphic](#feature-graphic) under Project mode.

> **Alpha channel.** App Store Connect rejects images carrying an alpha channel,
> and canvas always writes RGBA for PNG even when every pixel is opaque. If an
> upload is refused, flip the format toggle to JPEG and re-export.

## Project mode

The browser version keeps the set in the tab. **Project mode** keeps it in files
next to your app repo, so the set is reviewable, diffable and re-renderable
without opening anything. The GUI and the CLI read and write the same files —
the editor is a view on them, not a separate copy.

A project is a folder (`aso/` by convention) inside your repo:

```
myapp/
  aso/
    default.json          the set: targets, locales, slots, shared settings, approval
    copy/en.json          headline + subhead per slot, one file per language
    copy/de.json
  screenshots/en/home.png the raw captures
  store/ios/en-US/1.png   what forge render writes
```

`aso/<setId>.json` is one **set**. `default` is the set name you get for free; a
second set lives in `aso/promo.json` with its copy under `copy/promo/<locale>.json`.

```json
{
  "version": 1,
  "id": "default",
  "targets": [
    {
      "id": "ios",
      "sizeId": "iphone-6-9",
      "deviceId": "iphone-17-pro",
      "out": "store/ios/{storeLocale}/{n}.png"
    },
    {
      "id": "play",
      "sizeId": "android-phone",
      "deviceId": "pixel-9-pro",
      "out": "store/play/{storeLocale}/{n}.png"
    }
  ],
  "locales": [{ "id": "en", "store": { "ios": "en-US", "play": "en-US" } }],
  "sources": "screenshots/{locale}/{screen}.png",
  "artworkSources": "aso/artwork/{artwork}.png",
  "settings": { "background": { "kind": "solid", "color": "#111114" }, "layout": "hero" },
  "slots": [{ "id": "budget", "kind": "screen", "screen": "home", "overrides": {} }],
  "approval": null
}
```

`sources`, `artworkSources` and every target's `out` are relative to the
**parent** of the project folder, so they read as normal repo paths. A **slot** is one output image: it
names a source screen and carries its own overrides, and the text for it lives
per language in `copy/<locale>.json` keyed by slot id.

The locale id is also the renderer's language: it picks the script font and, for
an RTL language, sets the canvas `direction` to `rtl` so a run is shaped and
ordered right to left inside each word. If the set's chosen font does not cover
that language's glyphs (Baloo 2 has no Cyrillic, for instance), the renderer
draws it in Inter instead — deterministically, the same way in the GUI and the
CLI — and `forge check` warns about it per locale.

### A slot's extra images

Two optional keys on a slot feed the multi-device arrangements:

```json
{
  "id": "pain",
  "kind": "screen",
  "screen": "budget_screen",
  "pair": "account_screen",
  "artwork": "pain-points",
  "overrides": { "layout": "duo", "positionId": "duo-artwork" }
}
```

- **`pair`** names the screen the arrangement draws in its `next` frame, instead
  of the next slot's. A duo can then show any screen — including one that is in
  no slot at all — without repeating it later in the strip. `prev` still follows
  the neighbour. `pair` resolves through the same `sources` template as `screen`.
- **`artwork`** names a frameless image: a file name with no directory and no
  extension, resolved through **`artworkSources`**, a second path template that
  defaults to `aso/artwork/{artwork}.png`. `{artwork}` is mandatory in it,
  `{locale}` is optional and lets a language have its own file. The `duo-artwork`
  and `duo-artwork-tilt` arrangements put the screen in its device frame on the
  left and this image, bare and contain-fitted, on the right — no body, no
  bezel, no notch, and an alpha channel comes through onto the background.

A slot whose arrangement has an `artwork` placement but names no `artwork` is a
validation error, and so is an artwork or a `pair` whose file is not there. Both
files feed the approval hash exactly like a screenshot: change one and the stamp
goes stale. Note that `kind: "artwork"` is something else entirely — that slot
kind is still rejected.

### A slot's stickers

A slot can carry free-standing images — stickers — independent of any device
frame:

```json
{
  "id": "budget-light",
  "kind": "screen",
  "screen": "budget_screen",
  "overrides": {},
  "elements": [
    {
      "id": "badge",
      "artwork": "new-badge",
      "x": 0.78,
      "y": 0.18,
      "width": 0.28,
      "rotate": -12,
      "layer": "front",
      "shadow": true
    }
  ]
}
```

Each entry in `elements`:

- **`artwork`** names a file exactly like a slot's own `artwork` — no directory,
  no extension, resolved through the same `artworkSources` template. There is
  no second path mechanism.
- **`x`, `y`** are the sticker's centre. `x` is a fraction of the
  _composition_ width (tile width × the layout's span, so a sticker can sit
  across a panorama seam like a device); `y` is a fraction of the tile height —
  the same convention every layout already uses.
- **`width`** is a fraction of the tile width; the drawn height follows the
  image's own aspect ratio, so there is no separate height to keep in sync.
- **`rotate`** is degrees, clockwise positive, like a placement's `rotate`.
  Default `0`.
- **`layer`** is `"front"` (default) or `"behind"`. The draw order is
  background → backdrop → behind-stickers → headline/subhead → devices →
  front-stickers, so a `"behind"` sticker sits under the text and the devices,
  and a `"front"` one sits over everything, including the device frame.
- **`shadow`** (default `false`) adds the same soft drop shadow a device frame
  casts, scaled to the sticker's own width.

A sticker with a missing artwork file draws nothing (and `forge check` reports
it, worded exactly like a missing slot artwork); one that would cover the
headline only gets a warning, since the check does not always know the image's
real proportions. A sticker may deliberately bleed off the tile.

Adding, removing, or moving a sticker changes the approval hash through the set
JSON; re-imaging one (same file name, new bytes) changes it through the
artwork's bytes, exactly like a slot's own artwork. A slot with no `elements`
key hashes and renders exactly as it did before this feature existed — the GUI
never writes an empty `elements: []`.

In the GUI, stickers live in the tune panel's "Stickers" section, shown only
when exactly one screen is selected (a sticker belongs to a slot, not to the
shared settings).

### Feature graphic

Google Play's feature graphic (1024 × 500, one image per locale, no device frame) is a second
**project set**, built from an `artwork`-kind slot instead of a `screen`-kind one. An artwork slot
has no source screenshot at all — it draws background → backdrop → stickers → text, with the
mascots as `elements` (stickers), exactly like any other slot. Recipe: `aso/feature.json` next to
your usual `aso/default.json`, its own copy folder, one slot, one target.

```json
{
  "version": 1,
  "id": "feature",
  "targets": [
    {
      "id": "play-feature",
      "sizeId": "play-feature-graphic",
      "deviceId": "pixel-9-pro",
      "out": "fastlane/metadata/android/{storeLocale}/images/featureGraphic.png"
    }
  ],
  "locales": [{ "id": "en", "store": { "play-feature": "en-US" } }],
  "sources": "screenshots/{locale}/{screen}.png",
  "settings": {
    "layout": "banner-right",
    "background": { "kind": "solid", "color": "#eaf2ff" },
    "highlights": ["#ffe27a"]
  },
  "slots": [
    {
      "id": "feature",
      "kind": "artwork",
      "overrides": {},
      "elements": [{ "id": "mascot", "artwork": "mascot", "x": 0.26, "y": 0.55, "width": 0.42 }]
    }
  ],
  "approval": null
}
```

`aso/copy/feature/en.json`:

```json
{ "feature": { "headline": "GetALife", "subhead": "Digital cash stuffing" } }
```

`deviceId` on the target is required by the type but never drawn — an artwork slot has no
`screen`, no `pair`, no `pairPrev` (validation rejects any of the three on one), and its
`elements` resolve through the same `artworkSources` template as any other slot's stickers.
`play-feature-graphic` is the size preset (`presets/sizes.ts`); `banner-left`/`banner-right`
(`presets/layouts.ts`) put the copy in one half of the tile, vertically centred, at a
`textScale` bold enough to read as a headline on a short, wide tile — both are ordinary layouts,
usable by a regular `screen` slot too. `forge check` and `forge render` work exactly as for a
screenshot set; `--set feature` selects this one.

### Custom product pages: more sets

App Store Custom Product Pages and Google Play's custom store listings both need extra sets of the
same screenshots — a different headline angle per campaign, rendered from the same slots and
copy structure as the default set. Project mode already keyed everything by set id
(`aso/<setId>.json` + `aso/copy/<setId>/<locale>.json`); the GUI adds a switcher and a duplicate
action on top of that file layout, so building a second set is a few clicks instead of hand-copying
JSON.

**In the GUI**, the Rail header shows the open set next to the locale switch (`Set: default ▾`).
Opening it lists every set the project holds and offers **Duplicate set…**: name a new id (lowercase
letters, digits and hyphens, `^[a-z0-9][a-z0-9-]{0,39}$`) and the whole current set — slots,
overrides, stickers, copy for every locale — is deep-copied under that id. The dialog refuses an id
that already exists; duplicating never overwrites a set. Switching sets navigates the whole editor
away (a full reload), so it warns first if the current tab has unsaved edits.

A duplicate's targets are rewritten so it can never render into the folders the store upload tools
read: `out` becomes `outputs/cpp/<newId>/<targetId>/{storeLocale}/{n}.png` (or, for a single-tile
target like a feature graphic, the same folder plus the original file name, still without `{n}`).
The duplicated set's own `approval` is cleared — nobody has reviewed the new copy yet.

**On disk (file mode)**, this is just more files: `aso/promo.json` next to `aso/default.json`, its
copy under `aso/copy/promo/<locale>.json`, same as adding a set by hand (see above). `forge dev`,
`forge check` and `forge render` all take `--set promo` exactly as they do for `default`; the dev
server also understands `?set=promo` on `/api/project`, so a GUI tab can switch sets without a
restart, and its file watcher follows whichever set the tab currently has open.

**In the backoffice (Firestore mode)**, a duplicated set has no screenshots of its own in Cloud
Storage yet — only `default` (or whichever set `build:aso` actually synced) does. The new set's
document therefore carries a `sourcesFrom: <original set id>` field (never chained: duplicating a
duplicate still points at the set that actually has images), and the adapter resolves every source,
artwork and sticker URL under `sourcesFrom` instead of the new set's own id until the backoffice's
sync gives it real images. **The backoffice's `build:aso`/`pull:aso` scripts need to learn about
this**: they must sync images (and update `gallery`) for every set id found in
`backoffice/aso/sets`, not only `default`, or a duplicated set stays on its source's screenshots
forever even after someone means to replace them.

### The four commands

```bash
forge check --project ./aso                       # is the set complete?
forge render --project ./aso                      # write every target × locale
forge approve --project ./aso --by hofi           # stamp the set as reviewed
forge dev --project ./aso                         # the editor on this project
```

| Option               | Meaning                                                  |
| -------------------- | -------------------------------------------------------- |
| `--project <dir>`    | The project folder. Required.                            |
| `--set <id>`         | Which set file. Default `default`.                       |
| `--target <id>`      | Render only this target. Repeatable.                     |
| `--locale <id>`      | Render only this language. Repeatable.                   |
| `--require-approval` | `check` and `render` insist on a current approval stamp. |
| `--by <name>`        | Who approves. Required for `approve`.                    |
| `--port <n>`         | Dev server port. Default `4324`.                         |

`render` clears stale files from an earlier run before it writes — but only the ones matching
this target's own file name shape (`{n}` as digits, `{storeLocale}` as that locale's value,
everything else literal), not every PNG in the folder. A file with a different name pattern —
`icon.png`, another target's files, anything not forge's — is left alone even if it sits in the
same directory. **Behaviour change:** earlier versions deleted every `.png` in the folder; a stale
file whose name no longer matches the current template is now left behind instead of removed.
`{n}` restarts at 1 for every target and locale, so two targets may share a folder only if the
file name keeps them apart — and `out` may omit `{n}` entirely only when the set renders exactly
one tile per target and locale (one slot, span 1, like the feature graphic above); otherwise
`forge check` rejects it, since a second tile would silently overwrite the first.

```bash
forge render --project ./aso --target play --locale de --locale en --require-approval
```

**Approval** is a hash over the set file, all copy files and the bytes of every
source screenshot, paired screen and artwork. Change a headline, swap a screenshot or move a slot and the
stamp goes stale — `--require-approval` then refuses to render. That is the gate
between "someone looked at this" and "this went to the store".

| Exit code | Meaning                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `0`       | Fine.                                                                                                                            |
| `1`       | Usage mistake or an unexpected failure.                                                                                          |
| `2`       | The project does not validate — missing headline, missing source, or a headline that only fits by shrinking past the size floor. |
| `3`       | Approval required but missing or stale.                                                                                          |

### The PNGs are RGB

`forge render` writes true RGB PNGs with no alpha channel, so they go straight
into App Store Connect. The browser export cannot do that — canvas always hands
back RGBA — which is why that path offers a JPEG toggle instead. In project mode
the JPEG detour is unnecessary.

## Automation

The zustand store is exposed as `window.__store`, so an agent driving the app
over CDP (Argent, Playwright) or the devtools console can script it:

```js
await window.__store.getState().addFiles([file])
window.__store.getState().setSettings({ layout: 'bleed', sizeId: 'android-phone' })
```

`window.__renderExport` runs the real export renderer without triggering a
download. This is a local tool with no untrusted content — scripting it is a
feature, not an exposure.

## Contributing

Contributions are welcome, and most of them are small: a device, a background, a
font, a layout, a rhythm, a template are each one object in `src/presets/`.

Start with [CONTRIBUTING.md](CONTRIBUTING.md), and read `_context/rules.md`
before touching anything that renders — those invariants are not style
preferences, breaking them produces wrong exported pixels.

```bash
pnpm install
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
```

## Not built yet

- Pulling screenshots straight off a booted simulator or emulator
- Exporting every required size in one pass from the browser version
- A background shape or decoration (a circle, a rule above the headline) —
  `background` is still only a solid colour or a gradient
- A marker band under the _subhead_; `*starred*` highlighting only ever
  applies to the headline
- A Firestore adapter. `ProjectStore` is the seam a remote backend would plug
  into; the file adapter behind `forge dev` is the only implementation
- Two editors on one project. There is no locking, so the last write wins
- A placement-aware text floor. The lift that keeps a device out of the copy is
  measured from the base frame, not from each placement, so a duo or trio
  arrangement whose flanking frames sit higher or larger can still reach up into
  the headline
- A bundled Hebrew face — `he` is detected as RTL but renders in the system font

## License

[MIT](LICENSE) © Hebert Porto
