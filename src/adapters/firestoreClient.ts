import type { Gallery, ProjectStore } from '../project/store'
import { EMPTY_GALLERY } from '../project/store'
import { slotScreens } from '../project/types'
import type { Project, ProjectCopies, ProjectSet } from '../project/types'

/**
 * The slice of the compat SDK the adapter touches, handed over by the host page as
 * `window.parent.forgeFirebase`; the host owns initialisation, login and the storage bucket.
 */
export type CompatFirebase = {
  firestore(): { collection(path: string): { doc(id: string): CompatDoc } }
  storage(): { ref(path: string): { getDownloadURL(): Promise<string> } }
  auth(): {
    currentUser: { email: string | null; getIdToken(forceRefresh?: boolean): Promise<string> } | null
  }
}
type CompatDoc = {
  get(): Promise<{ exists: boolean; data(): unknown }>
  update(data: unknown): Promise<void>
  onSnapshot(cb: (snap: { data(): unknown }) => void): () => void
}

export const SETS_COLLECTION = 'backoffice/aso/sets'

export const sourceObjectPath = (setId: string, localeId: string, screen: string) =>
  `backoffice/aso/sources/${setId}/${localeId}/${screen}.png`

export const artworkObjectPath = (setId: string, localeId: string, artwork: string) =>
  `backoffice/aso/artwork/${setId}/${localeId}/${artwork}.png`

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

// An image URL that can never load: the store then logs "source screenshot missing" for the
// slot instead of failing the whole project, exactly like a missing file under forge dev.
const MISSING_SOURCE = 'data:image/png;base64,'

const unique = (names: string[]) => [...new Set(names)]

const isPermissionDenied = (error: unknown) =>
  (error as { code?: string } | null)?.code === 'permission-denied'

export function firestoreProjectStore({
  setId,
  firebase,
}: {
  setId: string
  firebase: CompatFirebase
}): ProjectStore {
  const doc = () => firebase.firestore().collection(SETS_COLLECTION).doc(setId)
  const urls = new Map<string, string>()
  const artworkUrls = new Map<string, string>()
  let galleries: Record<string, Gallery> = {}
  let ownWrite = ''

  return {
    async load() {
      const snap = await doc().get()
      if (!snap.exists) throw new Error(`No set ${setId} in Firestore; run build:aso first`)
      const data = snap.data()
      const project = parseSetDoc(data)
      galleries = parseGalleryDoc(data)
      // The picker offers every image the bucket holds, so their URLs have to be resolved too —
      // a name the set does not reference yet has no entry in the map otherwise.
      const referenced = project.set.slots.flatMap(slotScreens)
      const keys = project.set.locales.flatMap((l) =>
        unique([...referenced, ...(galleries[l.id]?.screens ?? [])]).map((screen) => ({
          key: `${l.id}/${screen}`,
          path: sourceObjectPath(setId, l.id, screen),
        })),
      )
      const referencedArtwork = project.set.slots.map((s) => s.artwork).filter((a): a is string => !!a)
      const artworkKeys = project.set.locales.flatMap((l) =>
        unique([...referencedArtwork, ...(galleries[l.id]?.artwork ?? [])]).map((artwork) => ({
          key: `${l.id}/${artwork}`,
          path: artworkObjectPath(setId, l.id, artwork),
        })),
      )
      const resolved = await Promise.allSettled(
        [...keys, ...artworkKeys].map(({ path }) => firebase.storage().ref(path).getDownloadURL()),
      )
      resolved.forEach((r, i) => {
        if (r.status !== 'fulfilled') return
        if (i < keys.length) urls.set(keys[i].key, r.value)
        else artworkUrls.set(artworkKeys[i - keys.length].key, r.value)
      })
      return project
    },
    async save(project) {
      const payload = {
        ...project,
        updatedAt: new Date().toISOString(),
        updatedBy: firebase.auth().currentUser?.email ?? 'unknown',
      }
      ownWrite = payload.updatedAt
      // `update` and not `set`: the document also carries the gallery lists, which belong to the
      // sync and not to the GUI. A full write would drop them until the next build:aso. And not
      // `set(…, {merge: true})` either — that merges deeply, so a removed slot would linger as a
      // ghost in copies.<locale> and keep counting towards the approval hash.
      try {
        await doc().update(payload)
      } catch (error) {
        if (!isPermissionDenied(error)) throw error
        // The rule wants request.auth.token.admin, and a custom claim lives in the ID token, not
        // in the account: a tab left open long enough still carries a token from before the claim.
        // Reading keeps working, only the write is refused — so refresh once and try again.
        await firebase.auth().currentUser?.getIdToken(true)
        await doc().update(payload)
      }
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
    gallery(localeId) {
      return galleries[localeId] ?? EMPTY_GALLERY
    },
    subscribe(onChange) {
      return doc().onSnapshot((snap) => {
        const data = snap.data() as { updatedAt?: string } | undefined
        if (data?.updatedAt && data.updatedAt !== ownWrite) onChange()
      })
    },
  }
}
