import { readiness } from '../../lib/progress'
import { getSize } from '../../presets/sizes'
import { getTemplateSpec } from '../../presets/templates'
import { slotCount, useStore } from '../../store'
import { ScreenCard } from '../ScreenCard'
import { TunePanel } from '../TunePanel'
import { StepFrame, Tip } from './StepFrame'

const PREVIEW_WIDTH = 210

/**
 * The workbench: the tiles of the set with their copy, order and sources, next to the full
 * control set. The panel writes to every screen or, once a card is clicked, to that one alone.
 */
export function ShotsStep({ onBrowse, dragging }: { onBrowse: () => void; dragging: boolean }) {
  const screens = useStore((s) => s.screens)
  const settings = useStore((s) => s.settings)
  const template = useStore((s) => getTemplateSpec(s.templateId))
  const selectScreen = useStore((s) => s.selectScreen)
  const project = useStore((s) => s.project)
  const addSlot = useStore((s) => s.addSlot)
  const canAdd = useStore((s) => (s.gallery[s.localeId]?.screens.length ?? 0) > 0)
  const r = readiness(screens, settings)
  const slots = slotCount(template)
  const size = getSize(settings.sizeId)
  const previewHeight = Math.round((PREVIEW_WIDTH * size.h) / size.w)

  // In project mode the sources come from the repo, so there is nothing to drop — but every
  // capture the repo holds can be put into any frame of any slot.
  const lead = project
    ? 'The screenshots come from the project sources. Pick which capture sits in which frame, write the headline, order the tiles, and adjust anything the template decided — for all screens at once, or click one card to change only that one.'
    : slots > 0
      ? `${template.label} is a ${slots}-screen template. Fill each slot in the order shoppers will see them; the first two do most of the selling. Everything the template decided is adjustable in the panel.`
      : 'Add as many screenshots as you like, in the order shoppers will see them. The first two do most of the selling, and everything the template decided is adjustable in the panel.'

  const dropLabel =
    r.total === 0
      ? 'Drop your app screenshots here'
      : r.missingShots > 0
        ? `Drop ${r.missingShots} more screenshot${r.missingShots === 1 ? '' : 's'} to fill ${template.label}`
        : 'Drop more screenshots to add screens'

  return (
    <StepFrame title="Screenshots" lead={lead} wide>
      {!project && (
        <button
          onClick={onBrowse}
          className="flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-dashed px-8 py-6"
          style={{
            borderColor: dragging || r.missingShots > 0 ? 'var(--accent)' : 'var(--line)',
            background: dragging ? 'rgba(30,111,245,0.06)' : 'transparent',
          }}
        >
          <span className="text-[14px] font-semibold">{dropLabel}</span>
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            PNGs straight from the simulator or a device — or click to browse
          </span>
        </button>
      )}

      <div className="flex items-start gap-6">
        <TunePanel />
        <div className="flex min-w-0 flex-1 flex-wrap gap-5" onClick={() => selectScreen(null)}>
          {r.total === 0 && !canAdd ? (
            <p className="text-[13px]" style={{ color: 'var(--muted)' }}>
              Add screenshots to see the controls take effect. Changes to all screens still apply to
              screens you add later.
            </p>
          ) : (
            screens.map((screen, i) => (
              <ScreenCard
                key={screen.id}
                screen={screen}
                index={i}
                total={screens.length}
                isSlot={i < slots}
                width={PREVIEW_WIDTH}
                height={previewHeight}
              />
            ))
          )}
          {project && canAdd && (
            <button
              className="add-tile"
              style={{ width: PREVIEW_WIDTH + 24, height: previewHeight }}
              onClick={(e) => {
                e.stopPropagation()
                void addSlot()
              }}
            >
              <span className="text-[22px] leading-none">+</span>
              <span className="text-[12px] font-semibold">Add a tile</span>
              <span className="text-[11px]" style={{ opacity: 0.75 }}>
                Pick its pictures on the card
              </span>
            </button>
          )}
        </div>
      </div>

      <Tip>
        Lead with what the user gets, not the feature name: "Hands full? *Just say it.*" beats "Voice
        input". Captures are fitted top-anchored, so the status bar stays and the bottom crops.
      </Tip>
    </StepFrame>
  )
}
