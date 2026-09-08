import { describe, expect, it } from 'vitest'
import { projectRoute, validatePutBody } from '../vite-plugin-project'
import type { Project } from '../src/project/types'

const project = (overrides: Partial<Project['set']> = {}, copies: Project['copies'] = {}): unknown => ({
  set: {
    version: 1,
    id: 'default',
    targets: [],
    locales: [],
    sources: '',
    settings: {},
    slots: [],
    approval: null,
    ...overrides,
  },
  copies,
})

describe('validatePutBody', () => {
  it('accepts a body whose set id matches and whose locale keys are plain names', () => {
    expect(validatePutBody(project({}, { en: {}, 'pt-BR': {}, zh_Hant: {} }), 'default')).toBeNull()
  })

  it('rejects a set id that is not the one this server serves', () => {
    expect(validatePutBody(project({ id: '../../elsewhere' }), 'default')).toBe(
      'Project set id must be "default"',
    )
    expect(validatePutBody(project({ id: 'other' }), 'default')).toBe('Project set id must be "default"')
  })

  it('rejects a locale key that would write outside the copy folder', () => {
    expect(validatePutBody(project({}, { '../../etc/passwd': {} }), 'default')).toBe(
      'Invalid locale id "../../etc/passwd"',
    )
    expect(validatePutBody(project({}, { 'en/../..': {} }), 'default')).toBe('Invalid locale id "en/../.."')
  })

  it('rejects bodies that are not a project at all', () => {
    expect(validatePutBody(null, 'default')).toBe('Body must be a project object')
    expect(validatePutBody('nope', 'default')).toBe('Body must be a project object')
    expect(validatePutBody({ set: { id: 'default' } }, 'default')).toBe('Project copies must be an object')
  })
})

describe('projectRoute', () => {
  it('takes the url as it is when it already names a project route', () => {
    expect(projectRoute({ url: '/api/project' })).toBe('/api/project')
    expect(projectRoute({ url: '/sources/en/shot.png' })).toBe('/sources/en/shot.png')
    expect(projectRoute({ url: '/artwork/en/pain-points.png' })).toBe('/artwork/en/pain-points.png')
  })

  it("recovers the request's own path after the SPA fallback rewrote it", () => {
    expect(projectRoute({ url: '/index.html', originalUrl: '/api/project' })).toBe('/api/project')
    expect(projectRoute({ url: '/index.html', originalUrl: '/sources/de/shot.png' })).toBe(
      '/sources/de/shot.png',
    )
    expect(projectRoute({ url: '/index.html', originalUrl: '/artwork/de/pain-points.png' })).toBe(
      '/artwork/de/pain-points.png',
    )
  })

  it('leaves anything that is not a project route to the next middleware', () => {
    expect(projectRoute({ url: '/index.html', originalUrl: '/some/page' })).toBe('/index.html')
    expect(projectRoute({})).toBe('')
  })
})
