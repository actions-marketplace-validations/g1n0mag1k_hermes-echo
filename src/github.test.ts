import { describe, test, expect } from 'vitest'
import { generateComment } from './github.js'
import type { EchoReceipt } from './types.js'
import type { EchoProbe } from './types.js'

const probe: EchoProbe = {
  args: ['testcli', 'validate'],
  confidence: 90,
  source: 'fixture',
}

function receipt(classification: EchoReceipt['classification']): EchoReceipt {
  return {
    id: 'abc123',
    probe,
    classification,
    generatedAt: '2026-01-01T00:00:00Z',
    observation: {
      probe,
      exitCode: 0,
      stdout: '',
      stderr: '',
      stdoutNormalized: '',
      stderrNormalized: '',
      timedOut: false,
      skipped: false,
      durationMs: 1,
      environment: {
        platform: 'linux',
        commit: 'head',
        timestamp: '2026-01-01T00:00:00Z',
      },
    },
  }
}

describe('generateComment contracts', () => {
  test('defaults to verified when no diffs and no contracts', () => {
    const body = generateComment([receipt('unchanged')])
    expect(body).toContain('ECHO VERIFIED')
  })

  test('includes Echo Contracts section when contracts provided', () => {
    const body = generateComment([receipt('unchanged')], [
      {
        probe: 'validate',
        matches: true,
        notes: [],
        behavior: 'exit 0, stderr empty',
      },
    ])
    expect(body).toContain('## Echo Contracts')
    expect(body).toContain('1 of 1 accepted contracts verified')
    expect(body).toContain('✓ HOLDS')
  })

  test('contract drift triggers ECHO DETECTED A CHANGE', () => {
    const body = generateComment([receipt('unchanged')], [
      {
        probe: 'validate',
        matches: false,
        notes: ['Exit code was 1, contract expects 0'],
        behavior: 'exit 0, stderr empty',
      },
    ])
    expect(body).toContain('ECHO DETECTED A CHANGE')
    expect(body).toContain('✗ DRIFTED')
    expect(body).toContain('Exit code was 1')
  })

  test('possible_change still triggers change headline with holding contracts', () => {
    const body = generateComment([receipt('possible_change')], [
      {
        probe: 'validate',
        matches: true,
        notes: [],
        behavior: 'exit 0, stderr empty',
      },
    ])
    expect(body).toContain('ECHO DETECTED A CHANGE')
  })
})
