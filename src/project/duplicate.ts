import type { Project } from './types'

/** Valid new-set id: lowercase, starts alphanumeric, at most 40 characters. */
export const SET_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/**
 * A duplicated set renders under its own folder so it never overwrites the files the store
 * upload tools read from the original set's targets. Keeps whatever file name the original `out`
 * ended in — `{n}.png` for a multi-tile target, the literal file name for the single-tile case
 * (rules.md: `out` may drop `{n}` only for a set with exactly one slot at span 1) — so neither
 * shape needs special-casing here.
 */
export function rewriteTargetOut(out: string, newId: string, targetId: string): string {
  const fileName = out.split('/').pop() ?? out
  return `outputs/cpp/${newId}/${targetId}/{storeLocale}/${fileName}`
}

/**
 * Builds the project for a new set duplicated from `project`: a full deep copy (mutating the
 * result must never touch the original), a fresh id, no inherited approval stamp, and every
 * target's `out` moved out of the store folders. Slot notes, roles and copy travel unchanged.
 */
export function duplicateProject(project: Project, newId: string): Project {
  const duplicate = structuredClone(project)
  duplicate.set.id = newId
  duplicate.set.approval = null
  duplicate.set.targets = duplicate.set.targets.map((target) => ({
    ...target,
    out: rewriteTargetOut(target.out, newId, target.id),
  }))
  return duplicate
}
