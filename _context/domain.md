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

| Term                       | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen**                 | One output image. Owns a source screenshot, a headline, a subtitle, and its overrides.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Source screenshot**      | The raw PNG the user dropped in. Never modified — only drawn into a device frame.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Settings**               | The global look: background, device, layout, arrangement, type, tilt, scale, export size.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Override**               | A setting pinned on one Screen. Absent key = inherit from Settings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Device frame**           | The phone/tablet body drawn around a source screenshot. Pure geometry, no bitmaps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Layout**                 | One composition: the text box, the device band (or a fixed device width and centre), and its **span** — how many store tiles it covers. A span-2 layout (panorama) is drawn once at double width and sliced into two PNGs on export. `textScale` multiplies the base type sizes — a landscape banner's tile is short, so its headline needs a multiplier well above the default `1` to read as a headline. `banner-left`/`banner-right` are the two landscape layouts, built for an artwork slot but usable by any slot. `deviceless: true` (`text-only`, `feature-wall`) draws no device and no artwork placement at all — a break in the "handset parade" for one tile. `feature-wall` also carries a second band, `list`, for its keyword rows.                                                                                                                                                                                                  |
| **Arrangement** (position) | How many device frames appear and where. May pull in neighbouring Screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Template**               | A complete look: a Settings preset plus per-screen **variants**. A template _with_ variants is a **set template**: it has a fixed number of **slots** (one per variant) that are laid out the moment it is chosen. A template without variants (Classic) is **freeform** — any number of screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Rhythm**                 | The strip's sequence of compositions (layout + arrangement + alignment per tile), independent of the look — Goldie's "template". `applyRhythm` pins those three keys as overrides by screen index and leaves colours alone. `uniform` clears them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Slot**                   | A Screen created by a set template. `imageId: null` while unfilled; it previews with the drawn placeholder and carries the template's sample copy. Export is gated until every slot is filled. In a Project the word is literal: a slot is one entry in `set.slots`, an id plus the source screen it draws and its overrides, and it becomes one Screen per Locale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Project**                | A set kept in files inside the user's repo instead of in the tab: `aso/<setId>.json` plus `aso/copy/<locale>.json`. The GUI and the CLI are two views on the same files. The alternative is **freeform mode** — no project, everything in memory, export as a zip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Project set**            | One `<setId>.json`: targets, locales, sources template, shared settings, slots, approval. `default` is the set you get without asking; a second set is `promo.json` with its copy under `copy/promo/`. The GUI can switch between a project's sets and duplicate one into a fresh id — see `ProjectStore`'s optional `listSets`/`createSet`/`openSet` below and README "Custom product pages: more sets" for the full picture; a set the GUI duplicated has its targets' `out` rewritten under `outputs/cpp/<id>/` so it never renders into another set's store folders.                                                                                                                                                                                                                                                                                                                                                                            |
| **Target**                 | One store output: an export size, a device and an `out` path template with `{storeLocale}` and `{n}`. Targets share the set's slots, copy and settings — only canvas size and device differ.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Locale**                 | One language of the set: an id used for the source path, the copy file name and the renderer's `lang` (script font, RTL), plus one **store locale** per target — the folder name the store wants (`en-US`, `de-DE`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Copy**                   | Headline and subhead per slot, per locale — plus an optional `eyebrow`, a chip's own text (keyed by the chip's id, `SlotCopy.chips`) and, for a `feature-wall` slot, `list`. Lives outside the set file so a translator touches one small JSON and nothing else.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Approval**               | A stamp — hash, who, when — over the set, all copy and the bytes of every source image. Any edit to any of the three makes it stale. `--require-approval` turns it into a gate on rendering.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Highlight**              | A marker band drawn behind `*starred*` words in a headline. Spans cycle through `settings.highlights`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Backdrop**               | A rounded card drawn behind the device band, between background and text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Accent bar**             | `settings.accentBar` (hex or `null`, default `null`): a short, fully rounded bar drawn above the block — above the eyebrow if there is one, else above the headline. Em-relative to the headline size; counted into `blockHeight` and the auto-shrink like everything else in the block. Purely decorative — not contrast-checked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Subhead style**          | `settings.subheadStyle` (`'plain' \| 'label'`, default `'plain'`): `'label'` draws each subhead line on a rounded box in `highlights[0]`, weight 600, fully opaque, instead of the default translucent line. Falls back to `'plain'` when `highlights` is empty (`forge check` warns).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Export size**            | Target canvas in pixels. Global — a set cannot mix sizes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Sticker**                | A free-standing image on a slot, independent of any device frame — a `SlotElement` in `set.slots[i].elements`, resolved to a `SceneElement` for the renderer. Positioned like a layout (`x`/`width` fractions of the composition width, `y` a fraction of the tile height), drawn `behind` or `front` of the rest of the composition, optionally with a soft drop shadow. Resolves its own image through the same `artworkSources` template as a slot's `artwork`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Shape**                  | A filled deco shape on a slot — one of two non-image `SlotElement`/`SceneElement` kinds alongside a sticker and a chip, same `elements` array, same `x`/`y`/`width`/`rotate`/`layer` positioning, but a `shape` (`'circle'`, `'ring'` or `'blob'`) and a `color` instead of an image, and never a shadow. A ring's `stroke` (fraction of the outer diameter, default `0.12`, valid `0.02`–`0.5`) and a blob's `seed` (default `1`) are each only valid on their own kind — `validateProject` rejects the other. No image bytes, so a shape costs nothing in the approval hash beyond its own JSON, and it is exempt from the "may cover the headline" warning — a shape is deco, not content, and may sit under the copy on purpose.                                                                                                                                                                                                                |
| **Chip**                   | A floating pill of a short line of text on a slot — the third kind of `SlotElement`/`SceneElement`, discriminated by `chip: true`. Same `x`/`y`/`rotate`/`layer` positioning as a sticker or a shape, but `width` is the pill's _maximum_ width, not its actual one — the pill hugs its (auto-shrinking) text up to that ceiling, at a font size that is itself a fraction of the tile height. Its text lives in the copy, keyed by the chip's own id (`SlotCopy.chips`), one per locale — the same reason headline and subhead live outside the set file. No image, so no approval-hash bytes beyond its own JSON and its copy; exempt from the "may cover the headline" warning like a shape, for a narrower reason (see `SlotChip` in `project/types.ts`).                                                                                                                                                                                       |
| **Blob**                   | A shape kind: seven points on the unit circle, radius `[0.78, 1.0]` jittered per point and angle jittered off an even 7-way spacing, all from a seeded PRNG (`mulberry32` in `render/frames.ts`) keyed only by `seed`, closed into a smooth loop with a Catmull-Rom-to-Bézier conversion. No randomness outside the seed — same seed, same shape, in the GUI and the CLI alike, exactly like a device frame is one geometric description drawn twice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Device shadow**          | `settings.deviceShadow` (`'soft' \| 'hard' \| 'none'`, default `'soft'`, overridable per screen): the drop shadow a device frame casts. `'soft'` is the frame's original, hard-coded blur — the default keeps every existing export byte-identical. `'hard'` is flat (no blur), offset `0.03`× the frame width down and right, in the tile's own effective `textColor`. `'none'` casts none. `applyShadow` in `render/frames.ts` is the one place that sets it, so a sticker's own shadow (still a plain boolean, unchanged) and a future frameless element can share the same numbers.                                                                                                                                                                                                                                                                                                                                                             |
| **Role**                   | A slot's place in the deck's sequence (`hero`, `difference`, `feature`, `proof`, `closer`) — which job its headline has to do. Feeds the editor's "Ideas" menu; draws no pixel itself, so it is absent from the approval hash like a `note`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Mosaic**                 | An overview/closer layout (`layout: 'mosaic'`): a headline band, then a staggered brick-pattern grid of 4–6 rahmenlose (frameless) mini-screens starting right under the band and cut off at the bottom. 4 cells are two columns of two (the right one staggered down); 5–6 switch to three columns (6 = 2/2/2, 5 = 2/1/2, the middle one staggered down). Cell 1 is the slot's own `screen`; cells 2–n come from `ProjectSlot.extra` (3–5 names, `Screen.extraIds` on the bridged `Screen`), each resolved through `sources` exactly like `screen`/`pair`/`pairPrev`. No device frame is ever drawn for it — `mosaicCells` in `render/scene.ts` computes the cell boxes (shrinking them if a count/offset combination would otherwise leave one less than half on-canvas) and `drawMosaicCell` in `render/frames.ts` paints each one as a white rounded card with today's device drop shadow, image cover-fitted top-anchored, no bezel, no notch. |
| **Offset**                 | `settings.deviceOffset` / `settings.textOffset` (`{ dx, dy }`, optional, no default, overridable per screen): a pure move of the device arrangement (every placement, the mosaic grid as one unit) or of the copy (text block plus `feature-wall`'s list), `dx` a fraction of the composition width, `dy` of the tile height — a placement's own units. Applied after layout, lift and auto-shrink; absent = no move. See "Canvas moves" below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Canvas editor**          | The direct manipulation on each tile preview (`components/CanvasEditor.tsx`): select, drag, scale, turn, snap. Its frames and handles are DOM over the canvas, never part of `renderScene`; its geometry comes from `render/targets.ts`, its math from `lib/canvasEdit.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Data model

```ts
Screen   = { id, headline, subhead, imageId, overrides: Partial<Settings>, lang?, elements?: SceneElement[], extraIds?: string[] }
Settings = { background, backdropColor, deviceId, frameColorId, deviceShadow, positionId, layout,
             tilt, deviceScale, deviceOffset?, textOffset?, textColor, textAlign, highlights, fontId,
             headlineScale, subheadScale, headlineTracking, accentBar, subheadStyle, sizeId }
Offset   = { dx, dy }   // dx: fraction of the composition width, dy: of the tile height
Template = { id, label, settings: Partial<Settings>, variants?: ScreenOverrides[], sample }
SceneElement = StickerElement | ShapeElement | ChipElement   // all three share { id, x, y, width, rotate, layer }
StickerElement = { ...base, imageId, shadow }
ShapeElement   = { ...base, shape, color, stroke?, seed? }   // stroke: ring only, seed: blob only
ChipElement    = { ...base, text, color?, textColor?, size, shadow }
```

`lang` is the copy's BCP-47 language. It picks the script font stack and the text
direction; absent means Latin and LTR.

**Artwork slot.** `kind: 'artwork'` is a slot with no source screenshot and no device frame —
its `screen`, `pair` and `pairPrev` must be absent (validation rejects any of the three). It
renders background → backdrop → stickers → text, plus its own `artwork` (see below) if the
arrangement asks for one, exactly as a `screen` slot would. The renderer learns "draw no devices"
from `Screen.kind` (`types.ts`), set by `screensFor` in `project/bridge.ts`; `renderScene` in
`render/scene.ts` skips every placement except an `artwork`-sourced one when `screen.kind ===
'artwork'` — one `if` in the existing device loop, not a second render path. This is the shape
Google Play's feature graphic uses: no device to frame, the mascots as stickers, a headline.

A project (`src/project/types.ts`) is the same material, keyed instead of listed:

```ts
Project = { set: ProjectSet, copies: ProjectCopies }
ProjectSet = { version: 1, id, targets, locales, sources, settings, slots, approval }
ProjectTarget = { id, sizeId, deviceId, out } // out: 'store/ios/{storeLocale}/{n}.png'
ProjectLocale = { id, store: Record<targetId, string> } // { ios: 'en-US', play: 'en-US' }
ProjectSlot = { id, kind: 'screen' | 'artwork', screen, pair?, artwork?, elements?: SlotElement[], extra?: string[], overrides: ScreenOverrides, role?: TileRole }
SlotElement = SlotSticker | SlotShape | SlotChip   // all three share { id, x, y, width, rotate?, layer? }
SlotSticker = { ...base, artwork, shadow? }
SlotShape   = { ...base, shape, color, stroke?, seed? }   // stroke: ring only, seed: blob only
SlotChip    = { ...base, chip: true, color?, textColor?, size?, shadow? }
ProjectCopies = Record<localeId, Record<slotId, { headline; subhead; eyebrow?; list?: string[]; chips?: Record<chipId, string> }>>
Approval = { hash, by, at } | null
```

`sources` is one path template with `{locale}` and `{screen}`; `settings` is
`Settings` minus `sizeId` and `deviceId`, which the target owns. `kind: 'artwork'`
is the artwork-slot shape described above.

A slot's `pair` names the screen the arrangement's `next` frame draws, instead of
the neighbouring slot's, and resolves through the same `sources` template. Its
`artwork` names a frameless image resolved through `artworkSources` (default
`aso/artwork/{artwork}.png`, `{artwork}` mandatory, `{locale}` optional) and drawn
by a placement with `source: 'artwork'` — contain-fitted, no frame, no fallback to
the screenshot. Both feed the approval hash, appended after the sources and only
for the slots that name them, so a set using neither hashes exactly as before.

A slot's `elements` are free-standing material, independent of any device
frame: a sticker, a shape or a chip, one `SlotElement` union with three members
(`project/types.ts`). A sticker names `artwork` and resolves its image through
the same `artworkSources` template as a slot's own `artwork` — there is no
second path mechanism. A shape names `shape` (`'circle'`, `'ring'` or `'blob'`,
typed as a `ShapeKind` union so more can join later) and a `color` instead —
no image at all. A ring also takes `stroke` (fraction of the outer diameter,
default `0.12`, valid `0.02`–`0.5`) and a blob a `seed` (default `1`); each is
only valid on its own kind, `validateProject` rejects it on the other or out
of range. A chip names `chip: true` and carries no image either — its text
lives in the copy (`SlotCopy.chips`, keyed by the chip's own id), so it can
differ per locale like a headline. `validateProject` requires exactly one of
`artwork`/`shape`/`chip` per element. `screensFor` in `project/bridge.ts` maps
each `SlotElement` to a `SceneElement` (same union, mirrored in `types.ts`),
defaulting `rotate` to `0`, `layer` to `'front'` (all three — a freshly added
shape starts on `'behind'` only because the GUI writes that layer explicitly,
not because the bridge defaults there) and `shadow` to `false` (a sticker or a
chip — a shape never has one), so the renderer never has to ask "or else
what". A chip's `color`/`textColor` are the one exception: the bridge leaves
them `undefined` when the slot names none, because their default depends on
the slot's _effective_ settings (`highlights[0]`, `textColor`), which the
bridge does not resolve — `renderScene` does, at draw time, on top of the one
place inheritance itself resolves (rules.md #2). `renderScene` draws in this
order: background → backdrop → `behind` elements → text block → list block
(`feature-wall` only) → devices → `front` elements — within one layer, array
order — a `behind` element sits under the copy and the device frame, a
`front` one sits over everything. `x`/`width` are fractions of the
composition width and tile width respectively (the same convention every
layout uses), `y` a fraction of the tile height; a sticker's drawn height
follows its image's own aspect ratio, a shape's always equals its width (a
circle's diameter), and a chip's pill hugs its own (possibly auto-shrunk)
text — none of the three ever has a second, independent height to keep in
sync. Like a slot's artwork, a sticker's bytes are appended to the approval
hash — last, and only for the slots that have one — so a set with no
stickers hashes exactly as it did before this feature existed; a shape or a
chip adds nothing here, since neither has image bytes, but their fields (and
a chip's copy) are already part of the set JSON and the copies map hashed
above. `validateProject` reports a missing sticker image the same way it
reports a missing slot artwork (a shape or a chip names no file, so neither
can ever be missing one), and warns (never blocks) when a `front` sticker's
approximate box overlaps the text block where it really lands — `textOffset`
and `feature-wall`'s centring included, measured by `forge check` with the
renderer's own `textShifts`/`textBlockBox` (`cli/commands.ts`), otherwise the
layout band moved by the offset (`approxTextBlock` in `project/validate.ts`) —
the same block also yields a warning when `textOffset` pushes the headline
partly or entirely off the tile. A shape is deco, not
content, and is exempt: it may sit under the headline on purpose, which is
exactly what the feature graphic's background circle does. A chip is exempt
from the same warning for a different reason: its real box depends on the
shrunk font size, which the check has no canvas to measure — see "A slot's
chips" in the README for what it checks instead (a chip must have non-blank,
single-line text for every locale in the set).

**Deviceless layouts.** `text-only` and `feature-wall` set `deviceless: true`
on the layout (`presets/layouts.ts`) — `renderScene` draws no device and no
artwork placement for one, whatever the slot's kind or arrangement asks for;
`composeDevices` (`render/scene.ts`) simply returns no boxes, so the rhythm
glyphs and the layout picker's own glyph show no device either, for free. A
slot's stickers and shapes are unaffected — they draw exactly as they would on
any other layout. A `screen`-kind slot on a deviceless layout still names a
source image (the type does not forbid it), but nothing ever draws it;
`validateProject` warns rather than errors, since the slot may still carry
stickers or copy worth keeping. `text-only` gives its whole text band, not a
gap to a device, as the auto-shrink's limit (rules.md, rule 4).

`feature-wall` is a closing tile: the ordinary headline band on top, a second
band below it — `layout.list` — for a short keyword list. A slot's `list`
(`SlotCopy.list`, a `string[]`, alongside `headline`/`subhead`/`eyebrow` in
`copy/<locale>.json`) becomes `Screen.list`, one row per entry, drawn by
`drawListBlock` in `render/text.ts`. Every row shares one size — the largest
that keeps each row inside the band's width and every row stacked inside its
height, capped at the headline's own base size (`headlineBaseSize`) times
`LIST_CAP_MULT` (1.3) — the list is this layout's hero, so it may read up to
30% bigger than the headline above it — and shrunk no further than the
headline's own floor (`MIN_TEXT_SIZE`). A row never
wraps — `validateProject` requires 2–8 non-empty, single-line entries per
locale for a `feature-wall` slot, and reports a row that only "fits" past that
floor the same way it reports an overlong headline. `*word*` markup, RTL and
`textAlign` all follow the headline's own rules, reusing `parseMarkup`/`wrap`/
`drawLine` rather than a second definition of what a marker band or an RTL row
looks like. `list` on a slot whose effective layout is not `feature-wall` is
ignored by the renderer and warned about by `validateProject`; an absent or
empty `list` changes nothing in the approval hash, same as an absent `eyebrow`.

A slot's `extra` feeds the mosaic layout's cells 2..n (cell 1 is `screen`
itself) — 3–5 names, each resolved through `sources` exactly like `pair`. A
slot whose effective layout (override → set → default, same order as every
other setting) is `mosaic` needs 3–5 of them; `validateProject` errors
otherwise, errors if an artwork-kind slot (which has no `screen` to be cell 1)
names any, errors on a name repeated within the list, and warns — not errors,
since the layout may still change — when a slot names `extra` but its
effective layout is something else. `screensFor` in `project/bridge.ts` maps
`extra` to `Screen.extraIds` (image-registry keys, same convention as
`pairId`), absent rather than empty when the slot has none. `renderScene`
replaces the whole device-drawing step with the mosaic grid when the resolved
layout is `mosaic` — no device is ever drawn for it, exactly like an artwork
screen replaces it with the frameless artwork placement. Like a slot's `pair`,
`extra`'s bytes are appended to the approval hash — last of everything, and
only for the slots that have one, so a set using no mosaic cell hashes exactly
as it did before this feature existed.

**Canvas moves.** `deviceOffset` and `textOffset` are the only `Settings` keys with no entry in
`DEFAULT_SETTINGS` (`OptionalSettingKey`, listed in `OPTIONAL_SETTING_KEYS`): absent is their own
meaningful default, "where the layout puts it", so a template reset (`projectAfterTemplate`) or a
set that never used them writes nothing. `renderScene` hands `deviceOffset` to `composeDevices`
(added to every box after the lift) and to `mosaicGrid` (the grid as one unit), and `textOffset`,
multiplied out by `shiftFor`, to `drawTextBlock`/`drawListBlock` (added to the band's left and
top). Nothing else sees them: the lift, the auto-shrink, `availableTextHeight` and the backdrop
are computed exactly as without — the moved part lands exactly the offset away, and may overlap
what the layout kept apart. No RTL mirroring, like an element's `x`. `validateProject` requires an
object with finite `dx`/`dy` within ±`OFFSET_LIMIT` (1) at set and slot level, and warns when a
slot's own offset targets a part its tile never draws (a deviceless layout or an artwork slot with
no artwork placement for `deviceOffset`, `text: null` for `textOffset`). Absent keys change no
approval hash; the GUI writes an offset only when it differs from what the tile would inherit
(`resolveOverrides`), so a 0/0 lands in the file only to overrule a set-wide offset.

The canvas editor writes these two plus the existing `tilt`/`deviceScale` (device) and an
element's `x`/`y`/`width`/`rotate` (and a chip's `size`) — nothing else. `sceneTargets`
(`render/targets.ts`) lists what a tile offers, bottom first in draw order, from the renderer's
own geometry functions (`elementBox`, `chipGeometry`, `textBlockBox`/`listBlockBox`,
`composeDevices`, `mosaicGrid`); `lib/canvasEdit.ts` holds the pure gesture math (pointer → scene
pixels → fractions, hit-testing turned boxes, snap, scale, turn, the `GestureSession` lifecycle).
A gesture draws live through `screenWithEdit` in `ScreenPreview` without touching the store and
commits once through `applyCanvasEdit` — one undo step with a history kind unique to the gesture,
one `scheduleSave`; arrow-key nudges share one kind per part so a held key coalesces like a slider.

A slot's `role` (`TileRole`: `'hero' | 'difference' | 'feature' | 'proof' | 'closer'`,
`project/types.ts`) names its place in the deck, purely to drive the editor's
"Ideas" menu (`components/CopyIdeasMenu.tsx`) next to the headline field —
picking a role shows that role's headline formulas (`presets/copyIdeas.ts`,
ported with attribution from `ParthJadhav/app-store-screenshots`, see
`NOTICE`), in German when the copy being edited is `de` and English
otherwise; clicking one drops it into the current locale's headline as one
undoable edit, brackets and all — the user fills them in. An unset slot is
offered a suggestion (the first slot `hero`, the last `closer`) but nothing is
written until the user actually picks a role. `role` draws no pixel, so it
stays out of the approval hash exactly like `note` (`project/hash.ts`); unlike
`note`, it is an ordinary document edit and travels through undo/redo like any
other (`store.ts`'s `setSlotRole`/`projectAfterRole`) — and undoing or redoing it
keeps the stamp as well: undo/redo drop an approval only when the step changes
`approvalContent` (`project/hash.ts`), the same text the hash is built from.

The Review step's `StorePreview.tsx` also has a "Thumbnail test" toggle: it
redraws the same strip through the same `ScreenPreview` canvas at App Store /
Play search-result tile size (~160px) instead of the product-page size, and
fences the leading tiles the search result actually shows (a span-2 layout
still counts as two). A panorama straddling the boundary is fenced whole, but
its caption counts only the tiles really shown (at most three), and the half
past the boundary is dimmed with "Only the left half shows in the search
result" (`shown` in `lib/thumbnailGroup.ts`). It is pure view state — a local
`useState`, never written to the project, Firestore or undo/redo.

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

`deviceShadow` (`'soft' | 'hard' | 'none'`, default `'soft'`) is an ordinary
overridable setting, resolved the same way. `'soft'` reproduces the frame's
original, hard-coded shadow exactly, so the default changes no existing
export. `applyShadow` in `render/frames.ts` is the one function that sets a
shadow on the canvas context; `drawDevice`, `drawMosaicCell` (a mosaic cell is
a frameless device in every way that matters to its shadow) and (for its own
boolean `shadow`) `drawSticker` all call it, so a future frameless element
gets the same shadow for free instead of re-deriving the constants.

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
src/components/Rail.tsx          the guided flow: four steps with status; navigation, never a gate
src/components/Footer.tsx        status line + the step's one primary action (Next / Export)
src/components/steps/*           Target → Look → Screenshots → Review & export
src/components/TunePanel.tsx     the full control set, scoped to all screens or the selected one (lives in the Screenshots step)
src/components/StorePreview.tsx  the set inside a mock App Store product page (Review step)
src/components/CanvasEditor.tsx  select/drag/scale/turn on a tile preview — DOM over the canvas, never drawn
src/render/targets.ts            what the editor can grab, from the renderer's own geometry
src/lib/canvasEdit.ts            the editor's pure gesture math
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

The four steps follow the order the decisions depend on (size shapes the canvas,
the look shapes the slots, the slots take screenshots, copy and the controls sit
on them). Screenshots is the workbench: pictures, copy, order and the full
control set in one place, because every one of those is judged by looking at the
same tile. But nothing is locked: every step is clickable at any time, files can
be dropped on any step (freeform mode only — a project takes its screenshots
from the repo, so the drop zone and the replace/clear controls are hidden
there), and Export is in the footer on every step — disabled only while a slot
is empty, with the reason as its label. Colour is used for status only:
green = done, amber = needs attention, the accent = the current step and the
primary action.

### Project mode is a second door, not a second app

```
src/project/types.ts     the file format
src/project/validate.ts  validateProject(project, sourceExists) → Issue[]; errors block, warns do not
src/project/hash.ts      approvalHash(): canonical JSON of set + copies, then every source image's bytes
src/project/bridge.ts    screensFor / settingsFor: project (locale, target) → the Screen[] + Settings the renderer takes
src/project/store.ts     ProjectStore — load, save, sourceUrl, sourceBytes, subscribe, and the optional
                         listSets/createSet/openSet/currentSetId a backend may add to let the GUI
                         switch and duplicate sets. Absent means the GUI hides that part of the UI.
src/project/duplicate.ts duplicateProject(): the pure, tested transform behind "Duplicate set…"
src/adapters/fileClient.ts    talks to the dev server over /api/project (?set=), /api/sets and /sources
src/adapters/firestoreClient.ts  the backoffice's adapter; a duplicated set carries `sourcesFrom`
                         (the id it was copied from, never chained) until its own images are synced
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
locale switch, copy fields, Review grid, Approve — is written against that
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
