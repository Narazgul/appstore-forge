import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  createProjectHandlers,
  parseSetParam,
  projectRoute,
  resolveSetId,
  validateNewProjectBody,
  validatePutBody,
} from '../vite-plugin-project'
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

  it('keeps the query string of a project route, ?set= included', () => {
    expect(projectRoute({ url: '/api/project?set=promo' })).toBe('/api/project?set=promo')
    expect(projectRoute({ url: '/index.html', originalUrl: '/api/sets?set=promo' })).toBe(
      '/api/sets?set=promo',
    )
  })
})

describe('parseSetParam', () => {
  it('reads ?set= out of a URL', () => {
    expect(parseSetParam('/api/project?set=promo')).toBe('promo')
    expect(parseSetParam('/api/project?other=1&set=promo')).toBe('promo')
  })
  it('is null without a query string or without ?set=', () => {
    expect(parseSetParam('/api/project')).toBeNull()
    expect(parseSetParam('/api/project?other=1')).toBeNull()
  })
})

describe('resolveSetId', () => {
  it('uses the requested set when it is a safe id', () => {
    expect(resolveSetId('/api/project?set=promo', 'default')).toBe('promo')
  })
  it('falls back to the default without a ?set=', () => {
    expect(resolveSetId('/api/project', 'default')).toBe('default')
  })
  it('falls back to the default for a value that could escape the project dir', () => {
    expect(resolveSetId('/api/project?set=..%2F..%2Fetc', 'default')).toBe('default')
    expect(resolveSetId('/api/project?set=a%2Fb', 'default')).toBe('default')
  })
})

describe('validateNewProjectBody', () => {
  it('accepts a body with a valid new id', () => {
    expect(validateNewProjectBody(project({ id: 'promo' }))).toBeNull()
  })
  it('rejects an id that does not match the new-set shape', () => {
    expect(validateNewProjectBody(project({ id: 'Not Valid' }))).toBe('Invalid set id "Not Valid"')
    expect(validateNewProjectBody(project({ id: '../elsewhere' }))).toBe('Invalid set id "../elsewhere"')
    expect(validateNewProjectBody(project({ id: '' }))).toBe('Invalid set id ""')
  })
  it('rejects bodies that are not a project at all', () => {
    expect(validateNewProjectBody(null)).toBe('Body must be a project object')
    expect(validateNewProjectBody({ set: { id: 'promo' } })).toBe('Project copies must be an object')
  })
})

const SET = {
  version: 1,
  id: 'default',
  targets: [
    { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'o/{storeLocale}/{n}.png' },
  ],
  locales: [{ id: 'en', store: { appstore: 'en-US' } }],
  sources: 's/{locale}/{screen}.png',
  settings: {},
  slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: {} }],
  approval: null,
}

async function scaffold() {
  const repo = await mkdtemp(join(tmpdir(), 'forge-'))
  const dir = join(repo, 'aso')
  await mkdir(join(dir, 'copy'), { recursive: true })
  await writeFile(join(dir, 'default.json'), JSON.stringify(SET))
  await writeFile(join(dir, 'copy', 'en.json'), JSON.stringify({ a: { headline: 'Hi', subhead: '' } }))
  return dir
}

/** A body-less GET/PUT never reads `req`, so an empty async-iterable stands in for an IncomingMessage. */
function fakeReq(method: string, url: string, body?: unknown): IncomingMessage {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (text) yield Buffer.from(text)
    },
    destroy() {},
  } as unknown as IncomingMessage
}

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) {
      res.headers[name] = value
    },
    end(chunk?: unknown) {
      if (chunk) res.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    },
  }
  return res as unknown as ServerResponse & typeof res
}

describe('createProjectHandlers', () => {
  it('GET /api/sets lists only the files that are actually valid sets', async () => {
    const dir = await scaffold()
    await writeFile(join(dir, 'promo.json'), JSON.stringify({ ...SET, id: 'promo' }))
    await writeFile(join(dir, 'not-a-set.json'), JSON.stringify({ foo: 'bar' }))
    await writeFile(join(dir, 'mismatched.json'), JSON.stringify({ ...SET, id: 'other-id' }))
    const handlers = createProjectHandlers({ projectDir: dir, setId: 'default' })
    const res = fakeRes()
    expect(await handlers.serve(fakeReq('GET', '/api/sets'), res)).toBe(true)
    expect(JSON.parse(res.body)).toEqual(['default', 'promo'])
  })

  it('POST /api/sets writes the set file and its own copy dir', async () => {
    const dir = await scaffold()
    const handlers = createProjectHandlers({ projectDir: dir, setId: 'default' })
    const body = { set: { ...SET, id: 'promo' }, copies: { en: { a: { headline: 'Hallo', subhead: '' } } } }
    const res = fakeRes()
    expect(await handlers.serve(fakeReq('POST', '/api/sets', body), res)).toBe(true)
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body)).toEqual({ id: 'promo' })
    expect(await readFile(join(dir, 'promo.json'), 'utf8')).toContain('"id": "promo"')
    expect(await readFile(join(dir, 'copy', 'promo', 'en.json'), 'utf8')).toContain('Hallo')
    // The default set's own copy dir is untouched by a second set's creation.
    expect(await readFile(join(dir, 'copy', 'en.json'), 'utf8')).toContain('Hi')
  })

  it('POST /api/sets refuses to overwrite an existing set', async () => {
    const dir = await scaffold()
    const handlers = createProjectHandlers({ projectDir: dir, setId: 'default' })
    const body = { set: { ...SET, id: 'default' }, copies: {} }
    const res = fakeRes()
    await handlers.serve(fakeReq('POST', '/api/sets', body), res)
    expect(res.statusCode).toBe(409)
  })

  it('POST /api/sets rejects an invalid id before writing anything', async () => {
    const dir = await scaffold()
    const handlers = createProjectHandlers({ projectDir: dir, setId: 'default' })
    const body = { set: { ...SET, id: 'Not Valid' }, copies: {} }
    const res = fakeRes()
    await handlers.serve(fakeReq('POST', '/api/sets', body), res)
    expect(res.statusCode).toBe(400)
  })

  it('GET /api/project?set=<id> reads that set instead of the startup default', async () => {
    const dir = await scaffold()
    await writeFile(join(dir, 'promo.json'), JSON.stringify({ ...SET, id: 'promo' }))
    const handlers = createProjectHandlers({ projectDir: dir, setId: 'default' })
    const res = fakeRes()
    await handlers.serve(fakeReq('GET', '/api/project?set=promo'), res)
    expect(JSON.parse(res.body).set.id).toBe('promo')
  })

  it('GET /api/project without ?set= serves the startup default', async () => {
    const dir = await scaffold()
    const handlers = createProjectHandlers({ projectDir: dir, setId: 'default' })
    const res = fakeRes()
    await handlers.serve(fakeReq('GET', '/api/project'), res)
    expect(JSON.parse(res.body).set.id).toBe('default')
  })

  it('PUT /api/project?set=<id> writes that set, into its own copy dir', async () => {
    const dir = await scaffold()
    await writeFile(join(dir, 'promo.json'), JSON.stringify({ ...SET, id: 'promo' }))
    await mkdir(join(dir, 'copy', 'promo'), { recursive: true })
    const handlers = createProjectHandlers({ projectDir: dir, setId: 'default' })
    const body = { set: { ...SET, id: 'promo' }, copies: { en: { a: { headline: 'Servus', subhead: '' } } } }
    const res = fakeRes()
    await handlers.serve(fakeReq('PUT', '/api/project?set=promo', body), res)
    expect(res.statusCode).toBe(204)
    expect(await readFile(join(dir, 'copy', 'promo', 'en.json'), 'utf8')).toContain('Servus')
    // The default set's copy file is untouched by a write to the other set.
    expect(await readFile(join(dir, 'copy', 'en.json'), 'utf8')).toContain('Hi')
  })

  it('a GET or PUT with ?set= makes that the set the watcher follows', async () => {
    const dir = await scaffold()
    await writeFile(join(dir, 'promo.json'), JSON.stringify({ ...SET, id: 'promo' }))
    const handlers = createProjectHandlers({ projectDir: dir, setId: 'default' })
    expect(handlers.getCurrentSetId()).toBe('default')
    await handlers.serve(fakeReq('GET', '/api/project?set=promo'), fakeRes())
    expect(handlers.getCurrentSetId()).toBe('promo')
  })

  it('creating a set also makes it the one the watcher follows', async () => {
    const dir = await scaffold()
    const handlers = createProjectHandlers({ projectDir: dir, setId: 'default' })
    const body = { set: { ...SET, id: 'promo' }, copies: {} }
    await handlers.serve(fakeReq('POST', '/api/sets', body), fakeRes())
    expect(handlers.getCurrentSetId()).toBe('promo')
  })

  it('checkForOutsideChange reports the currently open set, not only the startup one', async () => {
    const dir = await scaffold()
    await writeFile(join(dir, 'promo.json'), JSON.stringify({ ...SET, id: 'promo' }))
    const handlers = createProjectHandlers({ projectDir: dir, setId: 'default' })
    await handlers.serve(fakeReq('GET', '/api/project?set=promo'), fakeRes())
    // The baseline is unset until a write happens through this handler; the first check for the
    // now-open set establishes it rather than reporting a change out of nowhere.
    await handlers.checkForOutsideChange()
    expect(await handlers.checkForOutsideChange()).toBe(false)
    await mkdir(join(dir, 'copy', 'promo'), { recursive: true })
    await writeFile(
      join(dir, 'copy', 'promo', 'en.json'),
      JSON.stringify({ a: { headline: 'New', subhead: '' } }),
    )
    expect(await handlers.checkForOutsideChange()).toBe(true)
  })
})
