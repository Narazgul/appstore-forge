import { localeLabel } from '../project/localeLabel'
import { useStore } from '../store'

/** The locale picker of a project set: it swaps the copy under the preview, nothing else. */
export function LocaleSwitch() {
  const project = useStore((s) => s.project)
  const localeId = useStore((s) => s.localeId)
  const setLocale = useStore((s) => s.setLocale)
  if (!project) return null
  return (
    <label className="mt-3 flex items-center gap-2 text-[12px]" style={{ color: 'var(--muted)' }}>
      Language
      <select className="field" value={localeId} onChange={(e) => setLocale(e.target.value)}>
        {project.set.locales.map((l) => (
          <option key={l.id} value={l.id}>
            {localeLabel(l)}
          </option>
        ))}
      </select>
    </label>
  )
}
