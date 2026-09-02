import { useCallback, useRef, useState } from 'react'
import { Footer } from './components/Footer'
import { Rail } from './components/Rail'
import { CopyStep } from './components/steps/CopyStep'
import { LookStep } from './components/steps/LookStep'
import { ReviewStep } from './components/steps/ReviewStep'
import { ShotsStep } from './components/steps/ShotsStep'
import { TargetStep } from './components/steps/TargetStep'
import { TuneStep } from './components/steps/TuneStep'
import { exportAll, type ExportResult } from './lib/export'
import { useStore } from './store'

export function App() {
  const screens = useStore((s) => s.screens)
  const images = useStore((s) => s.images)
  const settings = useStore((s) => s.settings)
  const format = useStore((s) => s.format)
  const addFiles = useStore((s) => s.addFiles)
  const step = useStore((s) => s.step)
  const setStep = useStore((s) => s.setStep)
  // A project draws its screenshots from the repo, so dropping files does nothing at all.
  const project = useStore((s) => s.project)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)

  // Files can land on any step; they always go where screenshots are shown.
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (project) return
      const files = Array.from(e.dataTransfer.files)
      if (!files.length) return
      void addFiles(files)
      if (step !== 'tune') setStep('shots')
    },
    [addFiles, project, step, setStep],
  )

  const onExport = useCallback(async () => {
    setExporting(true)
    setError(null)
    setResult(null)
    try {
      setResult(await exportAll(screens, settings, images, format))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }, [screens, settings, images, format])

  const browse = () => inputRef.current?.click()

  return (
    <div className="flex h-full">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <main
          className="relative flex-1 overflow-auto p-8"
          onDragOver={(e) => {
            // Cancelling dragover is what stops the browser from navigating to the dropped
            // file; only the drop affordance is off in project mode.
            e.preventDefault()
            if (!project) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />

          {step === 'target' && <TargetStep />}
          {step === 'look' && <LookStep />}
          {step === 'shots' && <ShotsStep onBrowse={browse} dragging={dragging} />}
          {step === 'copy' && <CopyStep />}
          {step === 'tune' && <TuneStep />}
          {step === 'review' && <ReviewStep />}

          {dragging && !project && step !== 'shots' && (
            <div
              className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-2xl border-2 border-dashed text-[14px] font-semibold"
              style={{
                borderColor: 'var(--accent)',
                background: 'rgba(30,111,245,0.06)',
                color: 'var(--accent)',
              }}
            >
              Drop to add screenshots
            </div>
          )}

          {result && (
            <div className="toast">
              <span>{`Downloaded ${result.count} file${result.count === 1 ? '' : 's'}`}</span>
              <button onClick={() => setResult(null)}>Dismiss</button>
            </div>
          )}

          {error && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-lg bg-red-600 px-4 py-2 text-[12px] text-white">
              {error}
            </div>
          )}
        </main>
        <Footer onExport={onExport} exporting={exporting} />
      </div>
    </div>
  )
}
