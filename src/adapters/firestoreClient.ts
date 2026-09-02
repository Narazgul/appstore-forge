import type { ProjectStore } from '../project/store'
import type { Project, ProjectCopies, ProjectSet } from '../project/types'

/** The slice of the compat SDK the adapter touches; the host page owns initialisation and login. */
export type CompatFirebase = {
  firestore(): { collection(path: string): { doc(id: string): CompatDoc } }
  storage(): { ref(path: string): { getDownloadURL(): Promise<string> } }
  auth(): { currentUser: { email: string | null } | null }
}
type CompatDoc = {
  get(): Promise<{ exists: boolean; data(): unknown }>
  set(data: unknown): Promise<void>
  onSnapshot(cb: (snap: { data(): unknown }) => void): () => void
}

export const SETS_COLLECTION = 'backoffice/aso/sets'

export const sourceObjectPath = (setId: string, localeId: string, screen: string) =>
  `backoffice/aso/sources/${setId}/${localeId}/${screen}.png`

export function parseSetDoc(data: unknown): Project {
  const d = data as { set?: ProjectSet; copies?: ProjectCopies } | undefined
  if (!d?.set) throw new Error('Document has no set')
  return { set: d.set, copies: d.copies ?? {} }
}

// An image URL that can never load: the store then logs "source screenshot missing" for the
// slot instead of failing the whole project, exactly like a missing file under forge dev.
const MISSING_SOURCE = 'data:image/png;base64,'

export function firestoreProjectStore({
  setId,
  firebase,
}: {
  setId: string
  firebase: CompatFirebase
}): ProjectStore {
  const doc = () => firebase.firestore().collection(SETS_COLLECTION).doc(setId)
  const urls = new Map<string, string>()
  let ownWrite = ''

  return {
    async load() {
      const snap = await doc().get()
      if (!snap.exists) throw new Error(`No set ${setId} in Firestore; run build:aso first`)
      const project = parseSetDoc(snap.data())
      const keys = project.set.locales.flatMap((l) =>
        project.set.slots.map((s) => ({
          key: `${l.id}/${s.screen}`,
          path: sourceObjectPath(setId, l.id, s.screen),
        })),
      )
      const resolved = await Promise.allSettled(
        keys.map(({ path }) => firebase.storage().ref(path).getDownloadURL()),
      )
      resolved.forEach((r, i) => {
        if (r.status === 'fulfilled') urls.set(keys[i].key, r.value)
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
      await doc().set(payload)
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
    subscribe(onChange) {
      return doc().onSnapshot((snap) => {
        const data = snap.data() as { updatedAt?: string } | undefined
        if (data?.updatedAt && data.updatedAt !== ownWrite) onChange()
      })
    },
  }
}
