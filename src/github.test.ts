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

  test('shows stdout diff as a git-style diff block when drifted', () => {
    const body = generateComment([receipt('unchanged')], [
      {
        probe: 'validate',
        matches: false,
        notes: ['Stdout drifted: 1 line(s) changed'],
        behavior: 'exit 0, stderr empty',
        expectedStdout: 'Configuration valid\n3 checks passed',
        actualStdout: 'Configuration valid\n4 checks passed',
        stdoutDiff: {
          added: [],
          removed: [],
          changed: ['3 checks passed → 4 checks passed'],
          unchanged: 1,
        },
      },
    ])
    expect(body).toContain('**Stdout diff** (`validate`):')
    expect(body).toContain('```diff')
    expect(body).toContain('-3 checks passed')
    expect(body).toContain('+4 checks passed')
  })

  test('shows stderr diff as a git-style diff block when drifted', () => {
    const body = generateComment([receipt('unchanged')], [
      {
        probe: 'validate',
        matches: false,
        notes: ['Stderr drifted: 1 line(s) added'],
        behavior: 'exit 0, stderr present',
        expectedStderr: '',
        actualStderr: 'error: missing region',
        stderrDiff: {
          added: ['error: missing region'],
          removed: [],
          changed: [],
          unchanged: 0,
        },
      },
    ])
    expect(body).toContain('**Stderr diff** (`validate`):')
    expect(body).toContain('```diff')
    expect(body).toContain('+error: missing region')
  })

  test('does not render diff block when contract holds', () => {
    const body = generateComment([receipt('unchanged')], [
      {
        probe: 'validate',
        matches: true,
        notes: [],
        behavior: 'exit 0, stderr empty',
        expectedStdout: 'ok',
        actualStdout: 'ok',
        stdoutDiff: { added: [], removed: [], changed: [], unchanged: 1 },
      },
    ])
    expect(body).not.toContain('```diff')
    expect(body).not.toContain('Stdout diff')
  })

  test('renders both stdout and stderr diffs for a drifted probe', () => {
    const body = generateComment([receipt('unchanged')], [
      {
        probe: 'convert',
        matches: false,
        notes: [
          'Stdout drifted: 1 line(s) changed',
          'Stderr drifted: 1 line(s) added',
        ],
        behavior: 'exit 0, stderr empty',
        expectedStdout: 'Converted 3 records',
        actualStdout: 'Converted 4 records',
        expectedStderr: '',
        actualStderr: 'warn: slow',
        stdoutDiff: {
          added: [],
          removed: [],
          changed: ['Converted 3 records → Converted 4 records'],
          unchanged: 0,
        },
        stderrDiff: {
          added: ['warn: slow'],
          removed: [],
          changed: [],
          unchanged: 0,
        },
      },
    ])
    expect(body).toContain('**Stdout diff** (`convert`):')
    expect(body).toContain('-Converted 3 records')
    expect(body).toContain('+Converted 4 records')
    expect(body).toContain('**Stderr diff** (`convert`):')
    expect(body).toContain('+warn: slow')
  })
})
