import type { BackgroundChoice, Gallery, ProjectStore } from '../project/store'
import { EMPTY_GALLERY } from '../project/store'
import { backgroundImageSrcs, isSlotSticker, slotScreens } from '../project/types'
import type { Project, ProjectCopies, ProjectSet } from '../project/types'
import { artworkIsShared } from '../project/bridge'

/**
 * The slice of the compat SDK the adapter touches, handed over by the host page as
 * `window.parent.forgeFirebase`; the host owns initialisation, login and the storage bucket.
 */
export type CompatFirebase = {
  firestore(): {
    collection(path: string): {
      doc(id: string): CompatDoc
      get(): Promise<{ docs: { id: string }[] }>
    }
  }
  storage(): { ref(path: string): { getDownloadURL(): Promise<string> } }
  auth(): {
    currentUser: { email: string | null; getIdToken(forceRefresh?: boolean): Promise<string> } | null
  }
}
type CompatDoc = {
  get(): Promise<{ exists: boolean; data(): unknown }>
  /** Only `createSet` may call this — every other write goes through `update`, see `save`. */
  set(data: unknown): Promise<void>
  update(data: unknown): Promise<void>
  onSnapshot(cb: (snap: { data(): unknown }) => void): () => void
}

export const SETS_COLLECTION = 'backoffice/aso/sets'

export const sourceObjectPath = (setId: string, localeId: string, screen: string) =>
  `backoffice/aso/sources/${setId}/${localeId}/${screen}.png`

/** `shared` (see `artworkIsShared`): one file for all languages, so no locale folder. */
export const artworkObjectPath = (setId: string, localeId: string, artwork: string, shared = false) =>
  shared
    ? `backoffice/aso/artwork/${setId}/${artwork}.png`
    : `backoffice/aso/artwork/${setId}/${localeId}/${artwork}.png`

export const nodesObjectPath = (setId: string, localeId: string, screen: string) =>
  `backoffice/aso/nodes/${setId}/${localeId}/${screen}.json`

/** Keyed by the path from the repo root alone, not by set: a picture is the same file whichever set
 *  draws it, and a duplicated set needs no copy of its own. */
export const backgroundObjectPath = (src: string) => `backoffice/aso/backgrounds/${src}`

export function parseSetDoc(data: unknown): Project {
  const d = data as { set?: ProjectSet; copies?: ProjectCopies } | undefined
  if (!d?.set) throw new Error('Document has no set')
  return { set: d.set, copies: d.copies ?? {} }
}

/** The image lists `build:aso` writes alongside the set; absent on sets synced before it did. */
export function parseGalleryDoc(data: unknown): Record<string, Gallery> {
  const raw = (data as { gallery?: Record<string, Partial<Gallery>> } | undefined)?.gallery ?? {}
  const galleries: Record<string, Gallery> = {}
  for (const [localeId, entry] of Object.entries(raw)) {
    galleries[localeId] = { screens: entry?.screens ?? [], artwork: entry?.artwork ?? [] }
  }
  return galleries
}

/** The project's guidelines.md as `build:aso` mirrored it; null on sets synced before it did. */
export function parseGuidelinesDoc(data: unknown): string | null {
  const raw = (data as { guidelines?: unknown } | undefined)?.guidelines
  return typeof raw === 'string' ? raw : null
}

/** The background images `build:aso` uploaded for the picker; absent on sets synced before it did. */
export function parseBackgroundsDoc(data: unknown): BackgroundChoice[] {
  const raw = (data as { backgrounds?: unknown } | undefined)?.backgrounds
  if (!Array.isArray(raw)) return []
  return raw
    .filter((b): b is BackgroundChoice => !!b && typeof (b as BackgroundChoice).src === 'string')
    .map((b) => (typeof b.average === 'string' ? { src: b.src, average: b.average } : { src: b.src }))
}

// An image URL that can never load: the store then logs "source screenshot missing" for the
// slot instead of failing the whole project, exactly like a missing file under forge dev.
const MISSING_SOURCE = 'data:image/png;base64,'

const unique = (names: string[]) => [...new Set(names)]

const isPermissionDenied = (error: unknown) =>
  (error as { code?: string } | null)?.code === 'permission-denied'

export function firestoreProjectStore({
  setId,
  firebase,
  hostJson = JSON,
}: {
  setId: string
  firebase: CompatFirebase
  /**
   * The `JSON` of the window the SDK was created in. The editor runs in an iframe while the
   * compat SDK belongs to the host page, so an object built here carries THIS frame's
   * `Object.prototype`. The SDK's plain-object check compares against its own and rejects
   * everything else as "a custom Object object" — every write failed on it. Re-parsing the
   * payload with the host's JSON gives the SDK an object from its own realm.
   */
  hostJson?: JSON
}): ProjectStore {
  const collection = () => firebase.firestore().collection(SETS_COLLECTION)
  const doc = (id: string = setId) => collection().doc(id)
  const urls = new Map<string, string>()
  const artworkUrls = new Map<string, string>()
  const backgroundUrls = new Map<string, string>()
  let galleries: Record<string, Gallery> = {}
  let backgrounds: BackgroundChoice[] = []
  let guidelines: string | null = null
  let ownWrite = ''
  // The set THIS set's images actually live under: itself, unless it is a duplicate that has
  // never had its own screenshots synced — set by `load`, read by `createSet`.
  let imagesFrom = setId

  async function write(fields: object) {
    const payload = {
      ...fields,
      updatedAt: new Date().toISOString(),
      updatedBy: firebase.auth().currentUser?.email ?? 'unknown',
    }
    ownWrite = payload.updatedAt
    // `update` and not `set`: the document also carries the gallery lists, which belong to the
    // sync and not to the GUI. A full write would drop them until the next build:aso. And not
    // `set(…, {merge: true})` either — that merges deeply, so a removed slot would linger as a
    // ghost in copies.<locale> and keep counting towards the approval hash.
    const data = hostJson.parse(JSON.stringify(payload)) as Record<string, unknown>
    try {
      await doc().update(data)
    } catch (error) {
      if (!isPermissionDenied(error)) throw error
      // The rule wants request.auth.token.admin, and a custom claim lives in the ID token, not
      // in the account: a tab left open long enough still carries a token from before the claim.
      // Reading keeps working, only the write is refused — so refresh once and try again.
      await firebase.auth().currentUser?.getIdToken(true)
      await doc().update(data)
    }
  }

  return {
    currentSetId: setId,
    async load() {
      const snap = await doc().get()
      if (!snap.exists) throw new Error(`No set ${setId} in Firestore; run build:aso first`)
      const data = snap.data()
      const project = parseSetDoc(data)
      galleries = parseGalleryDoc(data)
      guidelines = parseGuidelinesDoc(data)
      // A set duplicated in the GUI has no images of its own in Storage yet — it draws its
      // predecessor's, named on the doc as `sourcesFrom`, never chained further than one hop
      // (see `createSet`).
      imagesFrom = (data as { sourcesFrom?: string } | undefined)?.sourcesFrom ?? setId
      // The picker offers every image the bucket holds, so their URLs have to be resolved too —
      // a name the set does not reference yet has no entry in the map otherwise.
      const referenced = project.set.slots.flatMap(slotScreens)
      const keys = project.set.locales.flatMap((l) =>
        unique([...referenced, ...(galleries[l.id]?.screens ?? [])]).map((screen) => ({
          key: `${l.id}/${screen}`,
          path: sourceObjectPath(imagesFrom, l.id, screen),
        })),
      )
      // A sticker names its image the same way a slot's own artwork does, so it needs the same
      // resolved-even-before-the-gallery-syncs treatment. A shape has no image to resolve.
      const referencedArtwork = project.set.slots.flatMap((s) =>
        [s.artwork, ...(s.elements ?? []).filter(isSlotSticker).map((el) => el.artwork)].filter(
          (a): a is string => !!a,
        ),
      )
      const sharedArtwork = artworkIsShared(project.set)
      const artworkKeys = project.set.locales.flatMap((l) =>
        unique([...referencedArtwork, ...(galleries[l.id]?.artwork ?? [])]).map((artwork) => ({
          key: `${l.id}/${artwork}`,
          path: artworkObjectPath(imagesFrom, l.id, artwork, sharedArtwork),
        })),
      )
      backgrounds = parseBackgroundsDoc(data)
      const backgroundKeys = unique([
        ...backgroundImageSrcs(project.set),
        ...backgrounds.map((b) => b.src),
      ]).map((src) => ({ key: src, path: backgroundObjectPath(src) }))
      const groups = [
        { rows: keys, into: urls },
        { rows: artworkKeys, into: artworkUrls },
        { rows: backgroundKeys, into: backgroundUrls },
      ]
      const rows = groups.flatMap(({ rows, into }) => rows.map((row) => ({ ...row, into })))
      const paths = unique(rows.map(({ path }) => path))
      const resolved = await Promise.allSettled(
        paths.map((path) => firebase.storage().ref(path).getDownloadURL()),
      )
      const urlOf = new Map<string, string>()
      resolved.forEach((r, i) => {
        if (r.status === 'fulfilled') urlOf.set(paths[i], r.value)
      })
      for (const { key, path, into } of rows) {
        const url = urlOf.get(path)
        if (url) into.set(key, url)
      }
      return project
    },
    async save(project) {
      await write(project)
    },
    guidelines() {
      return guidelines
    },
    async saveGuidelines(text) {
      await write({ guidelines: text })
      guidelines = text
    },
    sourceUrl(localeId, screen) {
      return urls.get(`${localeId}/${screen}`) ?? MISSING_SOURCE
    },
    async sourceBytes(localeId, screen) {
      const url = urls.get(`${localeId}/${screen}`)
      if (!url) throw new Error(`Source missing: ${localeId}/${screen}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Source fetch failed: ${localeId}/${screen}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    artworkUrl(localeId, artwork) {
      return artworkUrls.get(`${localeId}/${artwork}`) ?? MISSING_SOURCE
    },
    async artworkBytes(localeId, artwork) {
      const url = artworkUrls.get(`${localeId}/${artwork}`)
      if (!url) throw new Error(`Artwork missing: ${localeId}/${artwork}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Artwork fetch failed: ${localeId}/${artwork}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    async nodesBytes(localeId, screen) {
      const url = await firebase
        .storage()
        .ref(nodesObjectPath(imagesFrom, localeId, screen))
        .getDownloadURL()
        .catch(() => null)
      if (!url) throw new Error(`Nodes missing: ${localeId}/${screen}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Nodes fetch failed: ${localeId}/${screen}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    backgroundUrl(src) {
      return backgroundUrls.get(src) ?? MISSING_SOURCE
    },
    async backgroundBytes(src) {
      const url = backgroundUrls.get(src)
      if (!url) throw new Error(`Background missing: ${src}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Background fetch failed: ${src}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    backgroundGallery() {
      return backgrounds
    },
    gallery(localeId) {
      return galleries[localeId] ?? EMPTY_GALLERY
    },
    subscribe(onChange) {
      return doc().onSnapshot((snap) => {
        const data = snap.data() as { updatedAt?: string } | undefined
        if (data?.updatedAt && data.updatedAt !== ownWrite) onChange()
      })
    },
    async listSets() {
      const snap = await collection().get()
      return snap.docs.map((d) => d.id).sort()
    },
    async createSet(project) {
      const id = project.set.id
      const target = doc(id)
      const existing = await target.get()
      if (existing.exists) throw new Error(`Set "${id}" already exists`)
      const payload = {
        set: project.set,
        copies: project.copies,
        // A copy of the set it was duplicated from, not a live reference — the new doc starts
        // with whatever that set's images looked like the moment it was duplicated.
        gallery: galleries,
        backgrounds,
        // Never chained: a duplicate of a duplicate still points at the original that actually
        // has images in Storage.
        sourcesFrom: imagesFrom,
        updatedAt: new Date().toISOString(),
        updatedBy: firebase.auth().currentUser?.email ?? 'unknown',
      }
      // Building the payload in the SDK's own realm and using a full `set()` are both only safe
      // here because the document is brand new — see the comment on `save` for why every other
      // write uses `update`.
      const data = hostJson.parse(JSON.stringify(payload)) as Record<string, unknown>
      await target.set(data)
    },
    openSet(id) {
      if (window.parent === window) return
      window.parent.location.search = `?set=${encodeURIComponent(id)}`
    },
  }
}
