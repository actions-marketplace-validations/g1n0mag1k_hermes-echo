import { describe, test, expect } from 'vitest'
import {
  diffLines,
  diffObservations,
  formatDiffBlock,
  structuredDiff,
} from '../src/diff.js'
import { normalize } from '../src/normalize.js'
import type { EchoObservation, EchoProbe } from '../src/types.js'

const probe: EchoProbe = {
  args: ['testcli', 'validate', 'fixtures/valid.yml'],
  confidence: 90,
  source: 'fixture',
}

function makeObservation(
  exitCode: number | null,
  stdout: string,
  stderr: string,
  skipped = false,
  timedOut = false
): EchoObservation {
  return {
    probe,
    exitCode,
    stdout,
    stderr,
    stdoutNormalized: normalize(stdout),
    stderrNormalized: normalize(stderr),
    timedOut,
    skipped,
    durationMs: 10,
    environment: {
      platform: 'linux',
      commit: 'test-commit',
      timestamp: '2026-09-28T12:00:00Z',
    },
  }
}

describe('diff', () => {
  test('unchanged when exit code and outputs match', () => {
    const base = makeObservation(0, 'Valid configuration', '')
    const head = makeObservation(0, 'Valid configuration', '')
    const receipt = diffObservations(probe, base, head)
    expect(receipt.classification).toBe('unchanged')
  })

  test('possible_change when exit code differs', () => {
    const base = makeObservation(0, 'Valid configuration', '')
    const head = makeObservation(1, 'Valid configuration', '')
    const receipt = diffObservations(probe, base, head)
    expect(receipt.classification).toBe('possible_change')
  })

  test('possible_change when stderr differs', () => {
    const base = makeObservation(0, 'Valid configuration', '')
    const head = makeObservation(0, 'Valid configuration', 'Missing region')
    const receipt = diffObservations(probe, base, head)
    expect(receipt.classification).toBe('possible_change')
  })

  test('possible_change when stdout differs', () => {
    const base = makeObservation(0, 'Converted 3 records', '')
    const head = makeObservation(0, 'Converted 4 records', '')
    const receipt = diffObservations(probe, base, head)
    expect(receipt.classification).toBe('possible_change')
  })

  test('skipped takes priority over everything', () => {
    const base = makeObservation(0, '', '', true, false)
    const head = makeObservation(1, '', 'error', false, false)
    const receipt = diffObservations(probe, base, head)
    expect(receipt.classification).toBe('skipped')
  })

  test('timed_out when either side timed out', () => {
    const base = makeObservation(null, '', '', false, true)
    const head = makeObservation(0, '', '', false, false)
    const receipt = diffObservations(probe, base, head)
    expect(receipt.classification).toBe('timed_out')
  })

  test('receipt id is 12 characters', () => {
    const base = makeObservation(0, 'ok', '')
    const head = makeObservation(0, 'ok', '')
    const receipt = diffObservations(probe, base, head)
    expect(receipt.id.length).toBe(12)
  })

  test('receipt stores raw values not normalized', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const base = makeObservation(0, `id: ${uuid}`, '')
    const head = makeObservation(0, `id: ${uuid}`, '')
    const receipt = diffObservations(probe, base, head)
    expect(receipt.observation.stdout).toContain(uuid)
    expect(receipt.observation.stdoutNormalized).toContain('<UUID>')
  })

  test('timestamp change treated as unchanged', () => {
    const base = makeObservation(
      0,
      'Scan completed at 2026-09-28T14:23:01Z',
      ''
    )
    const head = makeObservation(
      0,
      'Scan completed at 2026-09-29T09:11:47Z',
      ''
    )
    const receipt = diffObservations(probe, base, head)
    expect(receipt.classification).toBe('unchanged')
  })
})

describe('diffLines', () => {
  test('identical strings produce no added or removed lines', () => {
    const result = diffLines('a\nb\nc', 'a\nb\nc')
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.unchanged).toBe(3)
  })

  test('detects added lines', () => {
    const result = diffLines('a\nb', 'a\nb\nc')
    expect(result.added).toEqual(['c'])
    expect(result.removed).toEqual([])
    expect(result.unchanged).toBe(2)
  })

  test('detects removed lines', () => {
    const result = diffLines('a\nb\nc', 'a\nc')
    expect(result.removed).toEqual(['b'])
    expect(result.added).toEqual([])
    expect(result.unchanged).toBe(2)
  })

  test('detects mixed add and remove', () => {
    const result = diffLines('keep\nold\nkeep', 'keep\nnew\nkeep')
    expect(result.removed).toEqual(['old'])
    expect(result.added).toEqual(['new'])
    expect(result.unchanged).toBe(2)
  })

  test('empty before becomes all added', () => {
    const result = diffLines('', 'hello\nworld')
    expect(result.added).toEqual(['hello', 'world'])
    expect(result.removed).toEqual([])
    expect(result.unchanged).toBe(0)
  })

  test('empty after becomes all removed', () => {
    const result = diffLines('hello\nworld', '')
    expect(result.removed).toEqual(['hello', 'world'])
    expect(result.added).toEqual([])
    expect(result.unchanged).toBe(0)
  })

  test('trailing newlines do not create phantom empty lines', () => {
    const result = diffLines('a\nb\n', 'a\nb')
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.unchanged).toBe(2)
  })
})

describe('structuredDiff', () => {
  test('coalesces adjacent remove+add into changed', () => {
    const result = structuredDiff('line one\nline two', 'line one\nline TWO')
    expect(result.changed).toEqual(['line two → line TWO'])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.unchanged).toBe(1)
  })
})

describe('formatDiffBlock', () => {
  test('formats as a git-style diff fence', () => {
    const block = formatDiffBlock('old line', 'new line', '**Stdout diff**:')
    expect(block).toContain('**Stdout diff**:')
    expect(block).toContain('```diff')
    expect(block).toContain('-old line')
    expect(block).toContain('+new line')
  })

  test('returns empty string when there is no drift', () => {
    expect(formatDiffBlock('same', 'same')).toBe('')
  })
})
