import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalize, areEquivalent } from '../src/normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function readFixture(...parts: string[]): string {
  return readFileSync(path.join(repoRoot, 'fixtures', ...parts), 'utf8')
}

describe('normalize — strips nondeterminism', () => {
  test('strips UUID', () => {
    const base = readFixture('uuid-change', 'base.txt')
    const head = readFixture('uuid-change', 'head.txt')
    expect(areEquivalent(base, head)).toBe(true)
  })

  test('strips ISO 8601 timestamp', () => {
    const base = readFixture('timestamp-change', 'base.txt')
    const head = readFixture('timestamp-change', 'head.txt')
    expect(areEquivalent(base, head)).toBe(true)
  })

  test('strips /tmp/ path', () => {
    expect(normalize('/tmp/run-839291/output.txt')).toBe('/tmp/<TEMP>/output.txt')
  })

  test('strips memory address', () => {
    expect(normalize('fault at 0x7fff5fbff8a0')).toBe('fault at <ADDRESS>')
  })

  test('strips UUID mid-sentence', () => {
    expect(normalize('session 550e8400-e29b-41d4-a716-446655440000 started')).toBe(
      'session <UUID> started'
    )
  })
})

describe('normalize — preserves real behavioral signals', () => {
  test('record count change is NOT equivalent', () => {
    const base = readFixture('record-count-change', 'base.txt')
    const head = readFixture('record-count-change', 'head.txt')
    expect(areEquivalent(base, head)).toBe(false)
  })

  test('genuine output change is NOT equivalent', () => {
    const base = readFixture('genuine-change', 'base.txt')
    const head = readFixture('genuine-change', 'head.txt')
    expect(areEquivalent(base, head)).toBe(false)
  })

  test('preserves error messages verbatim', () => {
    expect(normalize("Missing region: field 'region' is required")).toBe(
      "Missing region: field 'region' is required"
    )
  })

  test('exit code difference is NOT equivalent', () => {
    const base = readFixture('exit-code-change', 'base.txt')
    const head = readFixture('exit-code-change', 'head.txt')
    expect(areEquivalent(base, head)).toBe(false)
  })
})

describe('areEquivalent', () => {
  test('identical strings are equivalent', () => {
    expect(areEquivalent('Valid configuration', 'Valid configuration')).toBe(true)
  })

  test('timestamp change is equivalent', () => {
    expect(
      areEquivalent(
        'Scan completed at 2026-09-28T14:23:01Z',
        'Scan completed at 2026-09-29T09:11:47Z'
      )
    ).toBe(true)
  })

  test('uuid change is equivalent', () => {
    expect(
      areEquivalent(
        'Run ID: 550e8400-e29b-41d4-a716-446655440000',
        'Run ID: 7c9e6679-7425-40de-944b-e07fc1f90ae7'
      )
    ).toBe(true)
  })

  test('record count change is NOT equivalent', () => {
    expect(areEquivalent('Processed 10 records', 'Processed 11 records')).toBe(false)
  })

  test('empty string equals empty string', () => {
    expect(areEquivalent('', '')).toBe(true)
  })

  test('empty vs non-empty is NOT equivalent', () => {
    expect(areEquivalent('', 'Missing region')).toBe(false)
  })
})
