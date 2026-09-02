# Rules

Invariants, not style preferences. Each one exists because breaking it produced
a real bug.

## Rendering

1. **One renderer.** Preview and export both call `renderScene`. Never draw
   output with CSS/DOM and never add a second export path. If a feature seems to
   need one, it belongs in `renderScene` with a size parameter.

2. **Resolve overrides in exactly one place** — the top of `renderScene`.
   Callers pass the raw `screen` and global `settings`. If preview and export
   both resolved inheritance themselves, they would eventually disagree.

3. **Preload every font before first paint.** Canvas does not trigger webfont
   downloads the way DOM text does; `ctx.font` silently falls back to the system
   font. `preloadFonts()` must `document.fonts.load()` each family at every
   weight the renderer uses. A font that falls back looks fine on screen if you
   don't know the typeface — verify by measuring text width against a monospace
   baseline, not by eye.

4. **Text must never overlap the device.** The text block auto-shrinks to fit the
   gap down to the device band. When adding a size control, measure against that
   real gap, not the nominal band, or the control will fight the shrink and feel
   broken.

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
