import { describe, expect, it } from 'vitest'
import { COPY_IDEAS, COPY_IDEA_RULES, suggestedTileRole } from './copyIdeas'
import { TILE_ROLES } from '../project/types'

describe('COPY_IDEAS', () => {
  it('has an entry for every tile role, in order', () => {
    expect(Object.keys(COPY_IDEAS)).toEqual(TILE_ROLES)
  })

  it.each(TILE_ROLES)('%s has between 4 and 6 formulas', (role) => {
    expect(COPY_IDEAS[role].length).toBeGreaterThanOrEqual(4)
    expect(COPY_IDEAS[role].length).toBeLessThanOrEqual(6)
  })

  it.each(TILE_ROLES)('%s: no formula, translation or example is blank, in either language', (role) => {
    for (const idea of COPY_IDEAS[role]) {
      expect(idea.en.trim()).not.toBe('')
      expect(idea.de.trim()).not.toBe('')
      expect(idea.example.en.trim()).not.toBe('')
      expect(idea.example.de.trim()).not.toBe('')
    }
  })

  it.each(TILE_ROLES)('%s: no dash stands in for punctuation, in the formula or the example', (role) => {
    for (const idea of COPY_IDEAS[role]) {
      expect(idea.en).not.toMatch(/—/)
      expect(idea.de).not.toMatch(/—/)
      expect(idea.example.en).not.toMatch(/—/)
      expect(idea.example.de).not.toMatch(/—/)
    }
  })

  it.each(TILE_ROLES)('%s: every formula within a role is distinct', (role) => {
    const seen = new Set(COPY_IDEAS[role].map((idea) => idea.en))
    expect(seen.size).toBe(COPY_IDEAS[role].length)
  })
})

describe('COPY_IDEA_RULES', () => {
  it('has 3 to 6 non-empty rules', () => {
    expect(COPY_IDEA_RULES.length).toBeGreaterThanOrEqual(3)
    expect(COPY_IDEA_RULES.length).toBeLessThanOrEqual(6)
    for (const rule of COPY_IDEA_RULES) expect(rule.trim()).not.toBe('')
  })
})

describe('suggestedTileRole', () => {
  it('suggests hero for the first tile', () => {
    expect(suggestedTileRole(0, 5)).toBe('hero')
  })

  it('suggests closer for the last tile', () => {
    expect(suggestedTileRole(4, 5)).toBe('closer')
  })

  it('suggests nothing for a tile in the middle', () => {
    expect(suggestedTileRole(2, 5)).toBeUndefined()
  })

  it('suggests hero, not closer, for the only tile', () => {
    expect(suggestedTileRole(0, 1)).toBe('hero')
  })

  it('suggests nothing for an empty set', () => {
    expect(suggestedTileRole(0, 0)).toBeUndefined()
  })
})
