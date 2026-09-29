import { describe, test, expect } from 'vitest'
import { diffObservations } from '../src/diff.js'
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
