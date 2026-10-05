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

### A slot's shapes

`elements` also takes a second kind of entry: a filled deco shape, no image
involved at all.

```json
{
  "id": "kreis",
  "shape": "circle",
  "color": "#eaf2ff",
  "x": 0.193,
  "y": 0.2,
  "width": 0.666,
  "layer": "behind"
}
```

An entry is a sticker or a shape — exactly one of `artwork` or `shape`,
`forge check` rejects both or neither. `x`, `y`, `width`, `rotate` and `layer`
mean exactly what they do for a sticker (`width` is the shape's outer
diameter, a fraction of the tile width; height always equals width, so it
stays a circle however wide or short the tile is). `color` is `#rgb`,
`#rrggbb` or `#rrggbbaa`. A shape never casts the sticker drop shadow and is
never flagged by the "may cover the headline" warning — it is deco, not
content, and is allowed to sit under or over the copy on purpose. A shape adds
no bytes to the approval hash beyond its own JSON (there is no image to
read), so a set with no shapes hashes exactly as it did before this feature
existed.

`shape` is `"circle"`, `"ring"` or `"blob"`:

- **`ring`** — a stroked circle, not filled. `stroke` sets the stroke width as
  a fraction of the outer diameter (default `0.12`, valid `0.02`–`0.5`; `forge
check` rejects anything outside that range, or on any other shape). The
  ring's outer edge, not its centreline, lands exactly on the box, so it never
  bleeds past its own `width`.
- **`blob`** — a soft, organic filled outline: seven points around a circle,
  each pulled in to somewhere between 0.78 and 1.0 of the radius and nudged
  off its even 7-way angle spacing, closed into a smooth loop. `seed`
  (default `1`, an integer) is the only input — the same seed always draws
  the same blob, in the GUI and under `forge render` alike, since the point
  generator is one small seeded PRNG and nothing else is random. `forge check`
  rejects `seed` on any shape but `blob`.

```json
{ "id": "ring1", "shape": "ring", "color": "#5d47e8", "stroke": 0.08, "x": 0.5, "y": 0.5, "width": 0.5 }
{ "id": "blob1", "shape": "blob", "color": "#eaf2ff", "seed": 3, "x": 0.3, "y": 0.7, "width": 0.6 }
```

In the GUI, "Add circle" / "Add ring" / "Add blob" sit next to "Add sticker"
in the same "Stickers" section; a ring gets a stroke-width slider, a blob a
"Shuffle" button that picks a new seed.

### Device shadow

`settings.deviceShadow` (`"soft" | "hard" | "none"`, default `"soft"`,
overridable per screen like any other setting) is the drop shadow a device
frame casts. `"soft"` reproduces the frame's original, hard-coded shadow
exactly — the default changes no existing export. `"hard"` is flat, with no
blur, offset `0.03` of the frame width down and to the right, in the tile's
own effective `textColor`. `"none"` casts none. It applies to a bezelled frame
and to the bezel-less silhouette alike; a sticker's own `shadow` (still a
plain on/off) and `drawArtwork` are unaffected. In the GUI it is a three-way
toggle in the device section of the tune panel.

### A slot's chips

`elements` also takes a third kind of entry: a floating pill of a short line
of text — a real number or a short claim ("+312 € saved", "Notgroschen: 3 von
6 Monaten") — no image involved, drawn like a sticker rather than laid out
like a headline.

```json
{
  "id": "saved",
  "chip": true,
  "color": "#111114",
  "textColor": "#ffffff",
  "size": 0.03,
  "x": 0.72,
  "y": 0.62,
  "width": 0.5,
  "rotate": -6,
  "layer": "front",
  "shadow": true
}
```

`chip: true` is the discriminator; an entry is a sticker, a shape or a chip —
exactly one of `artwork`, `shape` or `chip`, `forge check` rejects any other
count. `x`, `y`, `rotate` and `layer` mean exactly what they do for a sticker.
`width` is the pill's **maximum** width, a fraction of the tile width like
every other element's — the pill itself hugs its text up to that ceiling, it
never stretches to fill it. `size` is the chip's font size, a fraction of the
tile height (default calibrated to read a touch larger than the subtitle);
`color` is the pill's fill (default: the settings' first highlight colour, or
white with none) and `textColor` the text's own colour (default: the settings'
text colour) — both `#rgb`, `#rrggbb` or `#rrggbbaa`, and both left unset to
inherit rather than pinned to today's colour. `shadow` (default `false`) is the
same soft drop shadow a sticker can cast.

The text itself lives in the copy, not in the set — one line per chip id, per
locale:

```json
{ "saved": { "headline": "…", "subhead": "…", "chips": { "saved": "+312 € gespart" } } }
```

A chip is always meant to carry text: a missing or blank entry for any locale
in the set is a validation error, and so is a line break — a chip never wraps.
`forge check` also warns about a `chips` key with no matching chip element,
the same way it warns about copy for a slot that no longer exists.

Drawing auto-shrinks the font — never the pill's shape, which always hugs
whatever size the text settles on — from `size` down to 70% of it until the
pill (the text plus its own horizontal padding, about 1.6× the font size) fits
inside `width`. Below that floor the render refuses, the same way it refuses a
headline that only "fits" by shrinking past its own floor: `forge render`
stops with `Chip text does not fit for slot <slot>, chip <id>, locale <locale>:
shorten the text or increase its width`. The pill itself is fully rounded,
about 1.9× the font size tall; the text sits weight 700, single line, in the
script and direction (RTL, CJK, …) the locale's language already uses for the
headline and subtitle.

A chip adds no bytes to the approval hash beyond its own JSON and its copy
entry — there is no image to read — so a set naming no chips hashes exactly as
it did before this feature existed. `forge check` does not warn about a chip
covering the headline the way it does for a sticker: the real box depends on
the shrunk font size, which only `forge render` measures (the check measures the headline block, not a chip), so guessing
would as often be wrong as right.

In the GUI, "Add chip" sits next to "Add sticker" and "Add circle" in the same
"Stickers" section, with the geometry and colour controls next to it; a
chip's text is edited per language wherever the slot's headline and subtitle
already are.

### A slot's mosaic cells

The `mosaic` layout is a headline band over a staggered brick-pattern grid of
4–6 rahmenlose (frameless) mini-screens, starting right under the headline and
cut off at the bottom — a closing or overview tile ("everything in one app").
4 cells lay out as two columns of two, with the right one staggered down; 5–6
switch to three columns (6 = 2/2/2, 5 = 2/1/2 — the middle column drops a
cell and its one remains centred between the outer rows), with the middle
column staggered down. Cell 1 is always the slot's own `screen`; cells 2..n
come from `extra`, 3–5 more screen names:

```json
{
  "id": "overview",
  "kind": "screen",
  "screen": "budget_screen",
  "extra": ["accounts_screen", "liga_screen", "planer_screen"],
  "overrides": { "layout": "mosaic" }
}
```

Each name in `extra` resolves through the same `sources` template as `screen`
or `pair` — no second path mechanism. A slot whose effective layout is
`mosaic` needs exactly 3–5 of them (4–6 cells total); `forge check` errors
otherwise, errors if an artwork-kind slot names any (it has no `screen` to be
cell 1), errors on a name repeated in the list, and warns — not an error, since
the layout may still change later — when a slot names `extra` but its
effective layout is something else. No device frame is ever drawn for a mosaic
tile: each cell is a plain white rounded card with today's soft device shadow,
its image cover-fitted and anchored to the top exactly like a screenshot in a
device, no bezel, no notch. A missing or not-yet-rendered cell image still
draws its white card, same as an empty device. `extra`'s bytes feed the
approval hash exactly like a `pair`'s — last, and only for the slots that name
one, so a set with no mosaic slot hashes exactly as it did before this feature
existed.

In the GUI, a slot whose effective layout is `mosaic` shows a "Mosaic cells"
list above the usual per-frame picker, with add/remove and reorder controls.

### A slot's role and copy ideas

A slot may name its place in the deck:

```json
{ "id": "budget-light", "kind": "screen", "screen": "budget_screen", "overrides": {}, "role": "hero" }
```

`role` is one of `"hero"`, `"difference"`, `"feature"`, `"proof"` or
`"closer"` — which job that slide's headline has to do, nothing more. It
draws no pixel and never appears anywhere in the render, so it adds no bytes
to the approval hash and picking one never makes a stamp stale, the same way
a slot's `note` does not. Absent means no role picked.

In the GUI it drives the "Ideas" menu next to the headline field: pick a
role, get that role's headline formulas with a filled-in example, and click
one to drop it into the headline of the language you are editing — one
undoable edit, brackets and all, for you to replace with the app's own words.
An unfilled slot is offered a suggestion (the first tile `hero`, the last
`closer`), but nothing is written until you actually pick one.

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
    "textAlign": "left",
    "background": { "kind": "solid", "color": "#f7f4ff" },
    "highlights": ["#ffe27a"],
    "accentBar": "#5d47e8",
    "subheadStyle": "label"
  },
  "slots": [
    {
      "id": "feature",
      "kind": "artwork",
      "overrides": {},
      "elements": [
        {
          "id": "circle",
          "shape": "circle",
          "color": "#eaf2ff",
          "x": 0.19,
          "y": 0.2,
          "width": 0.67,
          "layer": "behind"
        },
        { "id": "mascot", "artwork": "mascot", "x": 0.26, "y": 0.55, "width": 0.42 }
      ]
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

Two settings shape the copy of a banner (both work on any slot, both are off by default):
`accentBar` draws a short rounded bar in that colour above the text block, aligned like the text;
`subheadStyle: "label"` sets each subtitle line in weight 600, fully opaque, on a rounded box in
the first highlight colour (the contrast check then measures the subtitle against that box).

### Layouts without a device

`text-only` and `feature-wall` (`presets/layouts.ts`, `deviceless: true`) draw no device and no
artwork placement at all — a set willing to break the "handset parade" for one tile. A `screen`
slot still names a source image (the type does not require otherwise), but nothing ever draws it;
`forge check` warns rather than blocks, since the slot may still carry stickers or copy worth
keeping. `text-only` is large display type, vertically centred in its own band, no device to leave
room for — eyebrow, accent bar, stickers and shapes all work exactly as on any other layout.

`feature-wall` is a closing tile: the ordinary headline band on top, a keyword list filling the
rest. Give a slot a `list` in its copy file, one entry per line:

```json
{
  "wall": {
    "headline": "*Everything* in one app",
    "subhead": "",
    "list": ["Budget", "Sparziele", "Notgroschen"]
  }
}
```

2–8 non-empty, single-line entries per locale; `forge check` errors otherwise. Every row shares one
size — the largest that keeps each row inside the band and every row stacked inside it, capped at
1.3× the headline's own size (the list is this layout's hero, so it may read bigger, not merely as
big) — and `*word*` markup, RTL and `textAlign` all follow the headline's own rules. `list` on any
other layout is ignored and `forge check` warns about it; an absent or empty `list` changes nothing
in the approval hash.

### Moving things on the canvas

In the Screenshots step every tile preview is also a canvas editor. Click a
sticker, shape or chip, the device arrangement or the copy to select it, then:

- **drag** to move it — an element's `x`/`y`, or a new offset for the device
  and the copy (below);
- pull the **square corner handle** to scale it — an element's `width` (a
  chip's font `size` with it, so the pill keeps its shape), or the device's
  `deviceScale`;
- turn the **round handle** above it — an element's `rotate`, or the device's
  `tilt`. Shift rests on multiples of 15°.

The copy only moves. A circle or a ring has no turn handle (it looks the same at
every angle), and the mosaic grid has no scale handle (`deviceScale` does not
size it). Tiles without a device (`text-only`, `feature-wall`, an artwork slot)
offer no device to grab. A centre dragged within 1 % of the tile's middle line
(x or y — on a panorama also the seam) snaps onto it, and so does the place the
part started from, so dragging away and back changes nothing; a thin pink line
shows the snap, Alt switches it off. The arrow keys move the selection by 0.5 %
of the tile, Shift by 5 %, whenever no text field has the focus.

The canvas stops where the tune panel's sliders stop, so a slider can always
show what a gesture wrote: an element's `x`/`y` at −0.2 to 1.2, its `width` at
0.02 to 2 tile widths, a chip's `size` at 0.01 to 0.2 of the tile height, and
its `rotate` anywhere on the circle (−180° to 180°, a Rotate slider for every
element that has a turn handle, blobs included). `forge check` stays looser:
a hand-written value outside these ranges is still valid.

One gesture is one undo step and one save: the preview redraws on every pointer
move without touching the store, and letting go writes once (after the usual
300 ms debounce). Escape — or ⌘Z — mid-drag puts the part back where the
gesture found it. The frame, the handles and the guides are HTML on top of the
canvas; `renderScene` never draws them, so no export can contain them.

Two optional settings carry the moves the layout has no key for, overridable
per slot like `tilt`:

```json
"overrides": {
  "layout": "hero",
  "deviceOffset": { "dx": 0.06, "dy": 0.04 },
  "textOffset": { "dx": -0.03, "dy": 0.02 }
}
```

- **`deviceOffset`** moves the whole arrangement — every placement together,
  the frameless artwork too, the mosaic grid as one unit.
- **`textOffset`** moves the copy — accent bar, eyebrow, headline, subhead,
  and `feature-wall`'s list with it.

`dx` is a fraction of the composition width (tile width × span, the unit a
placement's own `dx` and a sticker's `x` use), `dy` of the tile height. Each
is a pure move applied after the layout: the device lift and the text
auto-shrink never see it, so the part lands exactly that far from where the
layout alone puts it — which also means a moved headline can overlap the
device; that is the point of moving it. Nothing is mirrored for an RTL
language, same as a sticker. `forge check` rejects anything but an object with
finite `dx`/`dy` within ±1 and warns when a slot's offset targets a part the
tile does not draw, or when `textOffset` pushes the headline partly or
entirely off the tile. The "may cover the headline" warning judges the
headline where it really lands — moved, and for `feature-wall` centred with
its list — measured with the renderer's own text layout. Absent means no
move: the GUI never writes `{ "dx": 0, "dy": 0 }` — a drag back to the
start, or the tune panel's **Reset** next to the offset row (Adjust for the
device, Type for the copy), removes the key — so a set that never used
either keeps its exact approval hash.

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
sync gives it real images. Capture nodes follow the same rule
(`backoffice/aso/nodes/<set>/<locale>/<screen>.json`, fetched on demand); background pictures are
keyed by their path from the repo root alone (`backoffice/aso/backgrounds/<src>`, a duplicate needs
no copy), resolved at load for every picture the set draws and every one in the document's
`backgrounds` list (`[{ src, average }]`, the picker). So `node` effects and marks and background
pictures draw in the backoffice too, and its approval check hashes the same bytes as `forge approve`.
**The backoffice's `build:aso`/`pull:aso` scripts need to learn about
this**: they must sync images (and update `gallery`) for every set id found in
`backoffice/aso/sets`, not only `default`, or a duplicated set stays on its source's screenshots
forever even after someone means to replace them.

### Studio sets: pictures for a website or a post

A set with `"purpose": "studio"` makes pictures that never go to a store — a guide's step images,
an Open Graph card, a story. It is an ordinary set file with three rules relaxed:

- **one language is enough**, and a locale needs no `store` codes (`"locales": [{ "id": "de" }]`);
  `out` writes under the locale id via `{locale}` (required once there is more than one locale);
- **no approval stamp**: `forge approve` refuses a studio set and `--require-approval` ignores it;
- **an empty headline is fine**: a picture may be the screen alone.

A studio target may write **WebP** (`out` ending `.webp`, quality 90); a store set refuses WebP, and
any `out` must end in `.png` or `.webp`. The studio sizes are `studio-4x5` (1080×1350),
`studio-square` (1080×1080), `studio-16x9` (1920×1080), `open-graph` (1200×630) and `story`
(1080×1920), and three landscape layouts give the copy room beside or above an upright device:
`landscape-left`, `landscape-right` and `landscape-center`. In `landscape-left` and `landscape-right`
the rows of the copy share one edge: with `textAlign: "center"` the block as a whole is centred in its
half, and a short subhead starts where the headline starts instead of sitting centred beneath it.

A store set has no `purpose` key at all, so its approval hash is exactly what it was before studio
sets existed.

### Tools for an agent: `forge tool`

Every operation an agent needs to build and fix pictures is a named tool with a description and a
JSON input schema (`src/project/tools.ts`). Each write goes through the same `projectAfter*`
functions the GUI calls, saves, and answers with the set's issues as `forge check` reports them; a
`forge dev` tab on the same project picks every change up through its file watcher.

```bash
forge tool --project ./studio                                # every tool with its input schema
forge tool list_sets --project ./studio
forge tool set_copy --project ./studio --json '{"set":"ratgeber","locale":"de","slot":"eins","headline":"Ziel *setzen*"}'
forge tool preview --project ./studio --json '{"set":"ratgeber","slots":["eins"]}'
forge tool update_slot --project ./studio --json @patch.json
```

| Tool                                                  | Does                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `list_sets`, `get_set`, `list_images`, `list_presets` | read the project, the images a locale holds, the valid ids           |
| `create_set`                                          | a new set (studio by default); never overwrites                      |
| `add_slot`, `remove_slot`, `update_slot`              | tiles: source images, overrides (`null` = inherit again), note, role |
| `update_settings`, `update_target`                    | the set-wide look; a target's size or device                         |
| `set_copy`                                            | one locale's headline, subhead, eyebrow, list, chip texts            |
| `add_element`, `update_element`, `remove_element`     | stickers, shapes, chips, screen effects, marks (step, arrow, …)      |
| `check`, `preview`, `render`                          | validate; PNGs into a scratch folder to look at; the real render     |
| `guidelines`, `remember`                              | read `guidelines.md`; append a dated design rule to it               |

`preview` writes `<tmp>/forge-preview/<repo>-<project>/<set>/<target>/<locale>/<slot>.png` and
never touches a target's `out`. There is deliberately no `approve` tool: the stamp is a person's
judgement. The result is JSON on stdout, a refused call prints `{ "error": … }` with exit code 2.

**`guidelines.md`** in the project folder holds the project's design rules, one dated line each
(`remember` appends one). It changes no pixel and is not part of the approval hash.

### Screenshots with positions: `forge capture`

Takes a screenshot of the debug app on an Android device and writes the position of every
element next to it, so effects and arrows can aim at a `testTag` instead of guessing from pixels.

```bash
forge capture --project ./studio --serial emulator-5554 --out aufnahmen/de/budget --screen budget
forge capture --project ./studio --serial emulator-5554 --out aufnahmen/de/budget --seed --store google --screen budget
forge capture --project ./studio --serial emulator-5554 --out aufnahmen/de/liga --call dev_goto_screen --args '{"screen":"league"}'
```

Steps, in this order: forward the dev MCP port (`adb forward tcp:<port> tcp:8765`), run the dev
MCP calls (`--seed` = `dev_seed_screenshot_data` with a five minute limit, `--screen` =
`dev_goto_screen`, then every `--call <tool> [--args '<json>']`), wait `--settle` ms (default 1500),
check that the device is ready (below), with `--hide-ime` close the keyboard, put the status bar into demo mode (9:41, full battery, full Wi-Fi and mobile signal, no
notification icons), `adb exec-out screencap -p` to `<out>.png`, `uiautomator dump` to
`<out>.nodes.json`, leave demo mode (also when something failed). Every adb call carries `-s <serial>`.

| Option                    | Meaning                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `--out <path>`            | PNG path relative to the project folder; `.png` is added. Required.                           |
| `--serial <id>`           | adb serial. Required, or set `FORGE_ADB_SERIAL`.                                              |
| `--port <n>`              | Local dev MCP port, default 8765 (or `FORGE_DEV_MCP_PORT`).                                   |
| `--screen <name>`         | `dev_goto_screen`.                                                                            |
| `--seed`, `--store <s>`   | `dev_seed_screenshot_data`, optionally `apple` or `google`.                                   |
| `--call`, `--args <json>` | Any dev MCP tool; `--args` belongs to the `--call` before it. Repeatable.                     |
| `--settle <ms>`           | Wait before the shot. Default 1500.                                                           |
| `--hide-ime`              | Close the on-screen keyboard before the shot (see below).                                     |
| `--package <id>`          | App that must be in front. Default `FORGE_APP_PACKAGE`, else `app.tinygiants.getalife.debug`. |

Before the shot the capture refuses, with an error and without writing a file, when the screen is
not on (`dumpsys power`, `mWakefulness` other than `Awake`), when a dev MCP step answered
`vaultUnlockRequired: true` ("Tresor gesperrt: in der App entsperren") or when another app is in front
(`dumpsys activity activities`, `topResumedActivity`): after standby a capture once wrote the launcher
of a private phone into the set. `--hide-ime` (tool: `hideIme: true`) reads `dumpsys input_method`
and sends Back (`input keyevent 4`) only while `mInputShown=true`, then checks again and fails if the
keyboard is still up; Back without a keyboard would leave the app, and Escape does nothing on Samsung.

```bash
forge capture --project ./studio --serial R5CX… --out aufnahmen/de/sprache --call dev_voice_stage --args '{"stage":"result"}' --hide-ime
```

`<out>.nodes.json`:

```json
{ "width": 1080, "height": 2400, "nodes": [{ "tag": "emergency_bar", "text": "…", "desc": "…", "bounds": [l, t, r, b] }] }
```

`tag` is the resource-id (a Compose `testTag` when the app sets `testTagsAsResourceId` at its
root; a `pkg:id/` prefix is cut off), `desc` the content description. Only nodes with at least one
of the three and an area are kept, in dump order. The dev MCP is spoken to over its SSE transport
(`GET /`, the `endpoint` event, JSON-RPC posts, answers on the stream) by a small client in
`cli/capture.ts`, not the MCP SDK, which is not a dependency of the fork. The same operation is
the tool `capture` (`forge tool capture --json …`); it exists only in the CLI host, because it
needs adb. Android only.

### Effects on the screen: lift, loupe, focus, redact

Four element kinds work on a slot's own screenshot inside its device, so a picture can show
exactly one thing. They sit in `elements` like stickers, but carry `effect` instead of
`artwork`/`shape`/`chip` and have no `x`, `y`, `width`, `rotate` or `layer`:

```json
"elements": [
  { "id": "up",    "effect": "lift",   "node": "emergency_bar", "pad": 0.01, "scale": 1.08, "dim": 0.35, "gray": 0 },
  { "id": "row",   "effect": "lift",   "node": ["🏠", "Rent", "$1,000"], "pad": 0.01 },
  { "id": "glass", "effect": "loupe",  "node": "balance_amount", "zoom": 2, "place": "right", "ring": "#ffffff" },
  { "id": "sharp", "effect": "focus",  "rect": { "x": 0, "y": 0.3, "w": 1, "h": 0.12 }, "strength": 0.012, "dim": 0 },
  { "id": "iban",  "effect": "redact", "node": "account_iban", "style": "pixelate", "strength": 0.03 }
]
```

| Effect   | Does                                                                    | Own fields (default)                                                                                                                    |
| -------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `lift`   | raises the target, enlarged and with a shadow; may reach past the frame | `scale` 1–1.5 (1.08), `dim` 0–0.9 (0.35) and `gray` 0–1 (0) for the rest of the screen                                                  |
| `loupe`  | a round glass with the target magnified, over it or beside it           | `zoom` 1.2–4 (2), `size` 0.05–0.9 of the tile width (from the target), `place` over/above/below/left/right (over), `ring` hex (#ffffff) |
| `focus`  | everything but the target blurred                                       | `strength` blur radius 0.002–0.05 of the screenshot width (0.012), `dim` 0–0.9 (0)                                                      |
| `redact` | the target pixelated or blurred for good                                | `style` pixelate/blur (pixelate), `strength` block size or radius 0.005–0.1 (0.03)                                                      |

**The target** is exactly one of `rect` (fractions of the screenshot: `x`, `w` of its width, `y`,
`h` of its height) or `node`, looked up in the capture's `nodes.json` next to the screenshot (the
source path with `.nodes.json` for its extension, the file `forge capture` writes): first an exact
`tag`, then an exact `text`, then an exact `desc`. `node` may also be a list of at least two names, for a row the
app draws as several text nodes: each is resolved by the same rules, every one must resolve, and
the target is the rectangle around all of them (`pad` comes on top). A node that matches nothing, several nodes on
the step that matched first, or a missing nodes file is an error in `forge check` (per locale) and
the effect is not drawn; a position is never guessed. `pad` (0–0.2, a fraction of the screenshot
width) adds a margin on every side.

Redact and focus happen once on the screenshot at its own resolution, in integer steps, so every
render is byte-identical in the CLI and the editor. Whatever samples the screen afterwards — the
lifted part, the loupe — sees the redaction. Effects draw on the slot's own framed screen (the
first `self` placement), turn with the device, and sit under the front stickers. On a deviceless
layout, on `mosaic` or in an arrangement without its own framed screen they draw nothing
(warning); on an artwork slot they are an error. A set without effects renders and hashes exactly
as before; the effect fields are part of the approval hash, and so are the nodes file bytes of
every slot whose effect aims at a `node`. In the editor effects render and are listed in the
Stickers panel (reorder, remove); dragging them is not built yet.

### Marks: steps, arrows, highlighter, outline, label

Marks annotate a picture for a help article or a guide. They sit in `elements` with `mark`
instead of `artwork`/`shape`/`chip`/`effect`, have no `x`, `y`, `width`, `rotate` or `layer`, and
draw over everything else on the tile, in list order:

```json
"elements": [
  { "id": "s1",  "mark": "step",      "n": 1, "node": ["🏠", "Rent", "$1,000"] },
  { "id": "to",  "mark": "arrow",     "from": { "textBlock": true, "side": "bottom" }, "to": { "node": "$8,430" }, "curve": 0.3 },
  { "id": "hl",  "mark": "highlight", "node": ["Rent", "$1,000"] },
  { "id": "box", "mark": "outline",   "node": ["Available", "$8,430"], "pad": 0.02 },
  { "id": "cap", "mark": "label",     "node": ["Available", "$8,430"], "side": "right" },
  { "id": "one", "mark": "step",      "n": "A", "at": { "x": 0.08, "y": 0.5 } }
]
```

| Mark        | Draws                                       | Own fields (default)                                                                                                           |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `step`      | a numbered circle beside the target         | `n` 0–999 or up to three characters, `size` diameter 0.02–0.3 (0.062), `color`, `textColor`                                    |
| `arrow`     | a curved arrow from `from` to `to`          | `from`, `to` (each a target), `curve` −1–1 of its length, the sign picks the side (0.25), `stroke` 0.002–0.05 (0.009), `color` |
| `highlight` | a highlighter stroke over the target        | `opacity` 0.1–1 (0.85), `color` (the set's first highlight)                                                                    |
| `outline`   | a rounded frame around the target           | `stroke` 0.002–0.05 (0.008), `color`                                                                                           |
| `label`     | a short caption in a pill beside the target | `size` font size 0.008–0.2 of the tile height (0.024), `color`, `textColor`; the text is copy (below)                          |

**The target** (for an arrow: each of `from` and `to`) is exactly one of `rect` or `node` — a part
of the slot's own screenshot, resolved exactly like an effect's, with `pad` — or `at` (a point or
box on the tile: centre `x` as a fraction of the composition width, `y` of the tile height,
optional `w` of the tile width and `h` of the tile height), or `textBlock: true` (the tile's
headline block). `side` (`center`, `left`, `right`, `top`, `bottom`) puts a step or a label beside
that edge of the target, or starts or ends an arrow there; without it a step sits left of a screen
target, a label right of it (both centred on anything else), and an arrow leaves and enters each
target on the edge facing the other one. A screen target follows the device: turned with it, cut
to the visible screen. A node that does not resolve is an error in `forge check` and the mark is
not drawn; on an artwork slot a screen target is an error, on a deviceless layout, `mosaic` or an
arrangement without its own framed screen a warning, like an effect. A tile target works on any slot.

Sizes and line widths are fractions of the tile's shorter side, so a mark reads the same on 4:5
and on 16:9. Colours default to the set's accent (`accentBar`, else `eyebrowColor`), else a strong
red that reads on light and dark screens; numbers and label text are white, or near-black on a light
colour. Steps, arrows and outlines get a thin contrasting rim and a soft shadow, so they hold up
over the screenshot and over the background alike. The highlighter multiplies over a light page;
over a dark one (measured under the target) it lays a translucent band in its colour behind the text
with a lightening blend (`screen`) and a glowing rim, so light text stays the lightest thing in it.

A label's text is copy, one line per locale, stored under `chips` with the label's id like a chip's
(`set_copy` and `add_element`'s `chipText` take it; a missing one is an error). Mark fields are part
of the approval hash, and so are the nodes file bytes of every slot whose mark aims at a `node`. In
the editor marks render and are listed in the Stickers panel (reorder, remove); there are no
handles for them.

### Frames and depth: browser window, blurred back device, fade-out

- **Browser window.** The device `browser` (`deviceId` of a target, or a slot override) frames a
  website screenshot (16:10 page, cover-fitted from the top like a phone screen) in a window with a
  title bar, three window buttons and an address field. `browserUrl` (a setting, per slot as an
  override) is the text in the field; absent leaves it empty. The bar is light; the frame colour
  `black` makes it dark. Effects and marks aim into the page exactly as into a phone screen.
- **`backBlur: true`** blurs every frame of a multi-device arrangement (duo, trio, wings, …) but
  the front one (the last drawn), by 0.009 of the tile width. A single device stays sharp.
- **`deviceFade`** lets the devices run out at the bottom of what they show: `"dark"` lays a black
  gradient over the whole width (and keeps it dark below), `"background"` erases them along the
  same band, so the background shows through. Mosaic tiles take neither.

All three are optional settings; absent, a tile draws exactly as before and the approval hash is
unchanged. In the editor they sit in the Device frame panel, for all screens or one: an Address
field (only with the browser device), Back blur (only for an arrangement with more than one frame)
and Fade out (Off, Dark, Background; not on mosaic). Switching one off on a single screen writes
`false` or an empty address over an inherited value; a fade has no "off" value of its own, so there
Off only returns the screen to the set-wide fade. Blur and fade work on a layer in integer steps (premultiplied), so the CLI and the
editor draw them identically on every run.

### Background pictures and finishes

`background` (set-wide, per slot in `overrides`, or in a palette's contrast pair) may carry a
picture and a list of finishes on top of its colour or gradient:

```json
"background": {
  "kind": "solid",
  "color": "#5a665e",
  "image": { "src": "studio/hintergruende/wiese.jpg", "focusX": 0.5, "focusY": 0.55, "zoom": 1, "blur": 0, "brightness": 1 },
  "finish": [{ "kind": "grain", "amount": 0.07, "seed": 1 }]
}
```

`image.src` is a path from the repo root, like `sources`. The picture is cover-fitted to the whole
composition (both tiles of a panorama), `focusX`/`focusY` (0–1, 0.5) are the point kept nearest the
centre, `zoom` (1–4, 1) crops further in around it, `blur` (0–0.1 of the tile width, 0) softens it
and `brightness` (0–2, 1) multiplies it. The colour underneath shows while the picture loads, so set
it to the picture's mean colour (`forge bg fetch` prints it as `average`). The contrast checks of
`forge check` (headline, subhead, eyebrow) read the picture itself: the background is painted as the
render paints it (blur, brightness, finishes) and the mean colour of the area behind the text block is
measured for every locale and target; the worst one counts ("on background image behind the text").
Without the image file the checks fall back to the colour.

Finishes work on the background alone, before anything else is drawn: never on a device, the copy,
a sticker or a shape. Lengths are fractions of the tile width, so a finish looks the same at every
export size; noise comes from `seed` only, so every render is byte-identical.

| Finish      | Look                                                    | Fields (default)                                                                                   |
| ----------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `grain`     | film grain                                              | `amount` 0–0.5 (0.08), `size` 0.0003–0.02 (0.0012), `mono` (true), `seed` (1)                      |
| `motion`    | motion blur                                             | `length` 0.002–0.3 (0.05), `angle` degrees (0)                                                     |
| `halftone`  | colour dots on paper                                    | `cell` 0.003–0.08 (0.014), `angle` (45), `paper` hex (#ffffff)                                     |
| `newsprint` | one ink in dots on newsprint, a little grain            | `cell` (0.01), `angle` (45), `ink` (#1c1c1c), `paper` (#efe9dc), `seed` (1)                        |
| `dither`    | 1-bit (Atkinson)                                        | `pixel` 0.0005–0.02 (0.0025), `dark` (#1b1b1f), `light` (#f2efe6)                                  |
| `riso`      | two inks fitted to the picture, second one slightly off | `inks` two hex (#ff6c2f, #3255a4), `paper` (#f5f0e6), `offset` 0–0.05 (0.004), `grain` 0–0.5 (0.1) |
| `duotone`   | shadows to one colour, highlights to another            | `dark` (#1f2a44), `light` (#f6d7a7)                                                                |
| `reeded`    | fluted glass                                            | `rib` 0.005–0.2 (0.04), `strength` 0–1 (0.6), `direction` vertical/horizontal (vertical)           |

Finishes run in list order, so `[{ "kind": "duotone" }, { "kind": "grain" }]` grains the duotone.
They also work without a picture (grain on a gradient).

**In the editor.** The Background panel shows every picture in `<project>/hintergruende/` (the dev
server lists them at `/api/backgrounds`, with the `average` from `credits.json`) plus any the set
already draws, as thumbnails. Picking one makes the background solid in the picture's mean colour
(from the credits, or measured on 16 × 16 for a picture without one), because that colour is what
shows while it loads; Remove image keeps the colour. Sliders set focus, zoom, blur and brightness
within the limits `forge check` allows. Finish picks one finish and shows its fields (sizes, angle,
colours, mono, direction) with the defaults from the table; several finishes are shown by name and
edited in the file.

**Getting pictures: `forge bg fetch`.** Loads a picture once into `<project>/hintergruende/` and
records where it came from in `hintergruende/credits.json`, so every render uses the same bytes:

```bash
forge bg fetch unsplash meadow clouds --project studio --list --orientation portrait   # candidates only
forge bg fetch unsplash id:v10lH6UUEGw --name wiese --project studio
forge bg fetch met wheat field --pick 2 --project studio    # The Met, public domain (CC0) only
forge bg fetch aic id:60755 --name ruisdael --project studio # Art Institute of Chicago, CC0 only
```

Unsplash needs `UNSPLASH_ACCESS_KEY` (a demo key allows 50 requests an hour: `--list` costs one, a
fetch two, the photo search plus the download report the API guidelines require for every photo
that is used). `UNSPLASH_APP_NAME` sets the `utm_source` of the credit links. Museum photographs
lose a flat mount at their edges; anything longer than 3200 px is scaled down. The answer names
`src` for `background.image` and the `average` colour.

**Painted backgrounds: `forge bg paint`.** Repaints a picture once through fal.ai
(`fal-ai/flux-pro/kontext`, image to image, $0.04 an image, key in `FAL_AI`) and keeps it next to
the source as `<name>-<style>.jpg`, about one megapixel:

```bash
forge bg paint studio/hintergruende/wiese.jpg --style watercolor --seed 7 --project studio --dry-run
```

Styles: `oil`, `watercolor`, `ink`, `gouache`. Every call costs money; `--dry-run` shows the
request and the price only. The credit records model, prompt and seed, and carries the source's
own credit in `basedOn`: a painted photo still needs its photographer's name.

**Credits.** `hintergruende/credits.json` is the record, keyed by file name. A studio set's render
also writes `credits.json` next to its pictures with the credits of the backgrounds they use
(path from the repo root as key, `attribution` the line the page shows), so whoever puts a picture
on a page has its credit at hand. Store sets write none: a store listing has no place for it.

A background without `image` and `finish` renders and hashes exactly as before. The image and
finish fields are part of the set JSON and so of the approval hash, and every background picture's
bytes are hashed after everything else, once each. The tools `bg_fetch` and `bg_paint` do the same
through `forge tool` (CLI only); `list_presets` lists the finishes with their defaults and the
paint styles.

### The four commands

```bash
forge check --project ./aso                       # is the set complete?
forge render --project ./aso                      # write every target × locale
forge approve --project ./aso                     # stamp the set as reviewed
forge dev --project ./aso                         # the editor on this project
```

| Option               | Meaning                                                  |
| -------------------- | -------------------------------------------------------- |
| `--project <dir>`    | The project folder. Required.                            |
| `--set <id>`         | Which set file. Default `default`.                       |
| `--target <id>`      | Render only this target. Repeatable.                     |
| `--locale <id>`      | Render only this language. Repeatable.                   |
| `--require-approval` | `check` and `render` insist on a current approval stamp. |
| `--port <n>`         | Dev server port. Default `4324`.                         |
| `--json <input>`     | `tool` only: the input as JSON, or `@file` to read it.   |

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
between "someone looked at this" and "this went to the store". The stamp is `{ hash, at }`, no name,
and only the CLI sets it: the person looks at the set (GUI Review step, or the rendered PNGs) and
says so, then `forge approve` stamps exactly the bytes they saw. The GUI shows whether the stamp is
current but has no Approve button. A stamp written by an older version still carries `by`; it is
ignored and changes nothing about the hash.

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
- Two editors on one project. There is no locking, so the last write wins
- A placement-aware text floor. The lift that keeps a device out of the copy is
  measured from the base frame, not from each placement, so a duo or trio
  arrangement whose flanking frames sit higher or larger can still reach up into
  the headline
- A bundled Hebrew face — `he` is detected as RTL but renders in the system font

## License

[MIT](LICENSE) © Hebert Porto
