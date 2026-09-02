import { effectiveSettings } from '../../lib/settings'
import { getLayout } from '../../presets/layouts'
import { getSize } from '../../presets/sizes'
import { useStore } from '../../store'
import { ScreenPreview } from '../ScreenPreview'
import { StepFrame, Tip } from './StepFrame'

const THUMB = 96
/** Above this the renderer starts shrinking the headline to keep it off the device. */
const HEADLINE_SOFT = 38
const SUBHEAD_SOFT = 90

/** Headline and subtitle per screen, with a live thumbnail and gentle length guidance. */
export function CopyStep() {
  const screens = useStore((s) => s.screens)
  const settings = useStore((s) => s.settings)
  const updateScreen = useStore((s) => s.updateScreen)
  const project = useStore((s) => s.project)
  const setCopy = useStore((s) => s.setCopy)
  const size = getSize(settings.sizeId)
  const thumbH = Math.round((THUMB * size.h) / size.w)

  return (
    <StepFrame
      title="Write the copy"
      lead={
        project
          ? 'One benefit per screen, one line per language. en and de are maintained by hand; the other languages come from the translation run.'
          : 'One benefit per screen, said the way a shopper would say it. Short headlines stay big; the renderer shrinks anything that would collide with the phone.'
      }
    >
      {screens.length === 0 ? (
        <Tip>Add screenshots first — each one gets a headline and an optional subtitle.</Tip>
      ) : (
        <div className="flex flex-col gap-3">
          {screens.map((screen, i) => {
            const layout = getLayout(effectiveSettings(screen, settings).layout)
            const hasCopy = layout.text !== null
            const headLen = screen.headline.replace(/\*/g, '').length
            return (
              <div key={screen.id} className="copy-row">
                <ScreenPreview screen={screen} width={THUMB} height={thumbH} />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] font-semibold">Screen {i + 1}</span>
                    <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                      {hasCopy ? layout.label : `${layout.label} — no copy on this layout`}
                    </span>
                  </div>
                  {hasCopy ? (
                    project ? (
                      <div className="flex flex-col gap-2">
                        {project.set.locales.map((l) => {
                          const copy = project.copies[l.id]?.[screen.id] ?? { headline: '', subhead: '' }
                          const len = copy.headline.replace(/\*/g, '').length
                          return (
                            <div key={l.id} className="flex items-center gap-2">
                              <span
                                className="w-10 shrink-0 text-[11px] font-semibold"
                                data-required={l.id === 'en' || l.id === 'de'}
                              >
                                {l.id}
                              </span>
                              <input
                                className="field"
                                value={copy.headline}
                                placeholder="Headline, *stars* to highlight"
                                onChange={(e) => setCopy(l.id, screen.id, { headline: e.target.value })}
                              />
                              <span className="count" data-over={len > HEADLINE_SOFT}>
                                {len}
                              </span>
                              <input
                                className="field"
                                value={copy.subhead}
                                placeholder="Subtitle (optional)"
                                onChange={(e) => setCopy(l.id, screen.id, { subhead: e.target.value })}
                              />
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            className="field"
                            value={screen.headline}
                            placeholder="Headline — the benefit, *stars* to highlight"
                            onChange={(e) => updateScreen(screen.id, { headline: e.target.value })}
                          />
                          <span className="count" data-over={headLen > HEADLINE_SOFT}>
                            {headLen}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            className="field"
                            value={screen.subhead}
                            placeholder="Subtitle (optional) — one short sentence"
                            onChange={(e) => updateScreen(screen.id, { subhead: e.target.value })}
                          />
                          <span className="count" data-over={screen.subhead.length > SUBHEAD_SOFT}>
                            {screen.subhead.length}
                          </span>
                        </div>
                      </>
                    )
                  ) : (
                    <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                      This composition is a breather: the device speaks for itself. Change its layout in
                      Fine-tune if you want copy here.
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <Tip>
        Lead with what the user gets, not the feature name: "Hands full? *Just say it.*" beats "Voice input".
        Keep headlines under ~{HEADLINE_SOFT} characters so they stay at full size.
      </Tip>
    </StepFrame>
  )
}
