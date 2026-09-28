# Rules

Invariants, not style preferences. Each one exists because breaking it produced
a real bug.

## Rendering

1. **One renderer.** Preview and export both call `renderScene`. Never draw
   output with CSS/DOM and never add a second export path. If a feature seems to
   need one, it belongs in `renderScene` with a size parameter.

   The canvas editor's selection frame, handles and snap guides are the one sanctioned exception
   to "never draw output with DOM" — because they are not output: DOM over the preview
   (`components/CanvasEditor.tsx`), never passed to or drawn by `renderScene`, so no export can
   contain them. Their geometry, in turn, must come from the renderer's own functions
   (`render/targets.ts`), never a copy of its arithmetic, or the frame drifts off what was drawn.

   A generated shape counts as a second render path the moment its geometry needs
   anything beyond its own fields: `blobPoints` in `render/frames.ts` draws a blob
   from its `seed` alone, never `Math.random` or the clock. Picking a _new_ seed
   (the GUI's "Shuffle" button) may be random; the shape drawn from a seed may not.

2. **Resolve overrides in exactly one place** — the top of `renderScene`.
   Callers pass the raw `screen` and global `settings`. If preview and export
   both resolved inheritance themselves, they would eventually disagree.

3. **Preload every font before first paint.** Canvas does not trigger webfont
   downloads the way DOM text does; `ctx.font` silently falls back to the system
   font. `preloadFonts()` must `document.fonts.load()` each family at every
   weight the renderer uses. A font that falls back looks fine on screen if you
   don't know the typeface — verify by measuring text width against a monospace
   baseline, not by eye.

   The CLI has the opposite trap: Skia ignores the weight in `ctx.font` for a
   variable face and draws its default instance (Inter at 400, the Noto CJK
   fonts at 100). Set text fonts only through `setFont` in `render/text.ts`,
   which also sets the `wght` axis. `cli/fonts.test.ts` guards it: width for
   Latin (Skia's fake bold keeps advance widths), ink for CJK.

   Never set text with `textBaseline = 'top'`. Skia puts "top" at the bounding
   box of the stack's first face, Chrome at its em box, so an Arabic line landed
   0.6 em lower in the CLI than in the preview. `drawLine` sets every line on the
   alphabetic baseline `BASELINE` below the top of its em box; `text.test.ts`
   guards it.

4. **Text must never overlap the device.** The text block auto-shrinks to fit the
   gap down to the device band. When adding a size control, measure against that
   real gap, not the nominal band, or the control will fight the shrink and feel
   broken.

   `deviceOffset` and `textOffset` are the deliberate exception: a move the user made by hand.
   They are applied after the shrink and the lift, never fed into either — a shrink that reacted
   to the drag would change the type size under the pointer.

   A `deviceless` layout (`text-only`, `feature-wall`) has no device band to leave
   room for, so its own text band is the shrink's limit instead (`availableTextHeight`
   in `render/text.ts`). `composeDevices` returns no boxes at all for one, whatever
   the slot's kind or arrangement — a new deviceless layout gets this for free; a new
   deviceless _feature_ elsewhere does not, and has to check `layout.deviceless` itself
   the way `render/scene.ts`'s backdrop does.

5. **Fit source screenshots top-anchored, not centred.** Cover-fit anchored to
   the top keeps the status bar visible and crops the bottom.

## State

6. **Never put side effects inside a React state updater.** React may invoke an
   updater more than once; a second invocation sees the already-changed value and
   writes the opposite. This shipped once as "sidebar collapse state reverts on
   reload". Compute the next value, call `setState(next)`, then do the effect.

7. **zustand selectors must return stable references.** A selector building a
   fresh object trips React's `getSnapshot` cache check in zustand v5 and loops.
   Wrap in `useShallow`.

8. **Overrides are `undefined`-means-inherit.** Never write a resolved value into
   `screen.overrides` to represent "same as global" — that silently pins it and
   the screen stops following the global.

9. **One gesture, one write.** A canvas drag, corner pull or turn draws live from local state
   (`screenWithEdit`) and reaches the store once, when the pointer lets go — one undo step, one
   save. Writing on every pointer move would fill the undo stack with one entry per pixel and,
   once the 300 ms save debounce runs out mid-drag, send a PUT (or a Firestore `update`) while
   the user is still dragging. A gesture that ends where it began, or is Escaped, writes nothing.
   "Where it began" is judged on the values the gesture started from, before `resolveOverrides`
   (`GestureSession.end`): resolving first turns a pin that merely repeats the global into a
   "drop it", which is a write — a save, an undo step and a lost approval.

## Packaging

9. **Runtime deps stay in `dependencies`.** Consumers install this package
   straight from GitHub, so everything the editor and the CLI import at runtime
   must be a real dependency — a `devDependencies` entry is not installed for
   them and the tool breaks on someone else's machine.

## Verification

10. **Screenshots decide visual correctness, not `describe`.** The preview is a
    canvas; the accessibility tree cannot see a wrong bezel or a clipped
    headline.

11. **Pixel claims need `window.__renderExport`.** "It looks right in the
    preview" is not evidence that it reaches the export. Hash the returned bytes
    and compare — and check that untouched screens stay byte-identical, which is
    what catches cross-screen leaks.
