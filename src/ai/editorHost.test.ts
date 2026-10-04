import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectStore } from '../project/store'
import { runTool } from '../project/tools'
import type { Project } from '../project/types'
import { flushSave, useStore } from '../store'
import { canRemember, editorHost } from './editorHost'

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_url: string) {
    queueMicrotask(() => this.onload?.())
  }
}

const project = (): Project => ({
  set: {
    version: 1,
    id: 'feature',
    targets: [
      { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'o/{storeLocale}/{n}.png' },
    ],
    locales: [{ id: 'en', store: { appstore: 'en-US' } }],
    sources: 's/{locale}/{screen}.png',
    settings: {},
    slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: {} }],
    approval: { hash: 'h', by: 'x', at: 't' },
  },
  copies: { en: { a: { headline: 'Hi', subhead: '' } } },
})

function backend(over: Partial<ProjectStore> = {}) {
  const saved: Project[] = []
  const store: ProjectStore = {
    load: async () => project(),
    save: async (p) => void saved.push(p),
    sourceUrl: (l, s) => `/sources/${l}/${s}.png`,
    sourceBytes: async () => new Uint8Array(),
    gallery: () => ({ screens: ['shot', 'other'], artwork: [] }),
    ...over,
  }
  return { store, saved }
}

async function open(store: ProjectStore) {
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('document', {
    fonts: { load: () => Promise.resolve([]), ready: Promise.resolve(), check: () => true },
  })
  await useStore.getState().openProject(store)
}

const host = (job = 'ai:job-1') =>
  editorHost(job, { state: () => useStore.getState(), check: () => [], preview: async () => [] })

afterEach(() => {
  vi.unstubAllGlobals()
  useStore.setState({
    project: null,
    projectStore: null,
    screens: [],
    images: {},
    nodes: {},
    lastError: null,
  })
})

describe('editorHost', () => {
  it('writes like a hand edit: the approval goes, one job is one undo step, the save goes through the adapter', async () => {
    const { store, saved } = backend()
    await open(store)
    const h = host()
    await runTool(h, 'update_slot', { set: 'feature', slot: 'a', overrides: { tilt: 3 } })
    await runTool(h, 'set_copy', { set: 'feature', locale: 'en', slot: 'a', headline: 'New' })
    const state = useStore.getState()
    expect(state.project!.set.approval).toBeNull()
    expect(state.project!.copies.en.a.headline).toBe('New')
    expect(state.undoStack).toHaveLength(1)

    await flushSave()
    expect(saved).toHaveLength(1)
    expect(saved[0].set.slots[0].overrides.tilt).toBe(3)

    useStore.getState().undo()
    expect(useStore.getState().project!.set.slots[0].overrides.tilt).toBeUndefined()
    expect(useStore.getState().project!.copies.en.a.headline).toBe('Hi')
  })

  it('makes a second job its own undo step', async () => {
    await open(backend().store)
    await runTool(host('ai:one'), 'update_slot', { set: 'feature', slot: 'a', overrides: { tilt: 1 } })
    await runTool(host('ai:two'), 'update_slot', { set: 'feature', slot: 'a', overrides: { tilt: 2 } })
    expect(useStore.getState().undoStack).toHaveLength(2)
  })

  it('loads a screenshot the set newly names before the tool answers', async () => {
    await open(backend().store)
    await runTool(host(), 'update_slot', { set: 'feature', slot: 'a', screen: 'other' })
    expect(useStore.getState().images['en/other']).toBeDefined()
    expect(useStore.getState().screens[0].imageId).toBe('en/other')
  })

  it('reaches only the open set', async () => {
    await open(backend().store)
    await expect(runTool(host(), 'get_set', { set: 'default' })).rejects.toThrow(
      /Only the open set "feature"/,
    )
    await expect(runTool(host(), 'render', { set: 'feature' })).rejects.toThrow(/not available/)
  })

  it('keeps the guidelines read-only where the backend cannot write them', async () => {
    await open(backend({ guidelines: () => '# Guidelines\n' }).store)
    expect(canRemember(useStore.getState())).toBe(false)
    expect(await runTool(host(), 'guidelines', {})).toEqual({ guidelines: '# Guidelines\n' })
    await expect(runTool(host(), 'remember', { rule: 'Always blue' })).rejects.toThrow(/read-only/)
  })

  it('appends a rule where the backend can write the guidelines', async () => {
    const saveGuidelines = vi.fn(async () => {})
    await open(backend({ guidelines: () => null, saveGuidelines }).store)
    expect(canRemember(useStore.getState())).toBe(true)
    await runTool(host(), 'remember', { rule: 'Always blue' })
    expect(saveGuidelines).toHaveBeenCalledWith(expect.stringMatching(/- \d{4}-\d\d-\d\d: Always blue\n$/))
  })

  it('reports a failed save through flushSave', async () => {
    await open(backend({ save: () => Promise.reject(new Error('permission-denied')) }).store)
    await runTool(host(), 'update_slot', { set: 'feature', slot: 'a', overrides: { tilt: 3 } })
    await expect(flushSave()).rejects.toThrow('permission-denied')
    expect(useStore.getState().lastError).toMatch(/^Not saved:/)
  })
})
