import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import {
  contractPath,
  ensureContractsDir,
  writeContract,
  readContract,
  listContracts,
  compareToContract,
  type Contract,
} from './contracts.js'
import type { EchoObservation, EchoProbe } from './types.js'
import { normalize } from './normalize.js'

let tmpDir: string
let previousRoot: string | undefined

beforeEach(() => {
  previousRoot = process.env.HERMES_ECHO_PROJECT_ROOT
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-contracts-'))
  process.env.HERMES_ECHO_PROJECT_ROOT = tmpDir
})

afterEach(() => {
  if (previousRoot === undefined) {
    delete process.env.HERMES_ECHO_PROJECT_ROOT
  } else {
    process.env.HERMES_ECHO_PROJECT_ROOT = previousRoot
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function makeProbe(args: string[]): EchoProbe {
  return { args, confidence: 90, source: 'fixture' }
}

function makeObservation(
  probe: EchoProbe,
  exitCode: number | null,
  stdout = '',
  stderr = ''
): EchoObservation {
  return {
    probe,
    exitCode,
    stdout,
    stderr,
    stdoutNormalized: normalize(stdout),
    stderrNormalized: normalize(stderr),
    timedOut: false,
    skipped: false,
    durationMs: 1,
    environment: {
      platform: 'linux',
      commit: 'abc',
      timestamp: '2026-01-15T10:30:00Z',
    },
  }
}

describe('contractPath', () => {
  test('returns correct path for valid probe name', () => {
    expect(contractPath('validate')).toBe('.hermes/contracts/validate.yml')
  })

  test('throws on empty probe name', () => {
    expect(() => contractPath('')).toThrow(/required/i)
  })

  test('throws on invalid characters', () => {
    expect(() => contractPath('val/id')).toThrow(/invalid/i)
    expect(() => contractPath('has space')).toThrow(/invalid/i)
  })
})

describe('ensureContractsDir', () => {
  test('creates directory when missing', () => {
    ensureContractsDir()
    expect(fs.existsSync(path.join(tmpDir, '.hermes/contracts'))).toBe(true)
  })

  test('is idempotent when directory exists', () => {
    ensureContractsDir()
    expect(() => ensureContractsDir()).not.toThrow()
  })
})

describe('writeContract and readContract', () => {
  test('writes valid YAML with expected fields', () => {
    const probe = makeProbe(['testcli', 'validate', 'fixtures/valid.yml'])
    const observation = makeObservation(probe, 0, 'Configuration valid', '')

    const written = writeContract(probe, observation)
    expect(written).toBe('.hermes/contracts/validate.yml')
    expect(fs.existsSync(path.join(tmpDir, written))).toBe(true)

    const raw = fs.readFileSync(path.join(tmpDir, written), 'utf8')
    const parsed = yamlLoad(raw.replace(/^#.*\n/, '')) as Contract
    expect(parsed.observations.exit_code).toBe(0)
    expect(parsed.command).toBe('testcli validate fixtures/valid.yml')
    expect(parsed.accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(parsed.accepted_by).toMatch(/^hermes-echo v/)
  })

  test('readContract returns null for missing file', () => {
    expect(readContract('missing')).toBeNull()
  })

  test('readContract returns parsed contract', () => {
    const probe = makeProbe(['app', 'run'])
    writeContract(probe, makeObservation(probe, 0))

    const contract = readContract('run')
    expect(contract?.probe).toBe('run')
    expect(contract?.observations.exit_code).toBe(0)
  })

  test('readContract throws on corrupted YAML', () => {
    ensureContractsDir()
    fs.writeFileSync(
      path.join(tmpDir, '.hermes/contracts/bad.yml'),
      'probe: [unclosed',
      'utf8'
    )
    expect(() => readContract('bad')).toThrow()
  })

  test('writeContract throws when exit code is missing', () => {
    const probe = makeProbe(['app', 'run'])
    const observation = makeObservation(probe, null)
    expect(() => writeContract(probe, observation)).toThrow(/not been executed/i)
  })
})

describe('listContracts', () => {
  test('returns empty array when directory does not exist', () => {
    expect(listContracts()).toEqual([])
  })

  test('returns probe names for existing contracts', () => {
    const validate = makeProbe(['testcli', 'validate'])
    const convert = makeProbe(['testcli', 'convert'])
    writeContract(validate, makeObservation(validate, 0))
    writeContract(convert, makeObservation(convert, 1))

    expect(listContracts()).toEqual(['convert', 'validate'])
  })
})

describe('compareToContract', () => {
  const contract: Contract = {
    probe: 'validate',
    command: 'testcli validate',
    accepted_at: '2026-01-15T10:30:00Z',
    accepted_by: 'hermes-echo v0.1.0',
    observations: {
      exit_code: 0,
      stdout_pattern: 'ok',
      stderr_empty: true,
    },
    notes: '',
  }

  test('matches when exit code and stderr match', () => {
    const probe = makeProbe(['testcli', 'validate'])
    const observation = makeObservation(probe, 0, 'ok', '')
    const result = compareToContract(contract, observation)
    expect(result.matches).toBe(true)
    expect(result.exitCodeMatch).toBe(true)
    expect(result.stderrMatch).toBe(true)
    expect(result.notes).toHaveLength(0)
  })

  test('detects exit code mismatch', () => {
    const probe = makeProbe(['testcli', 'validate'])
    const observation = makeObservation(probe, 1, 'ok', '')
    const result = compareToContract(contract, observation)
    expect(result.matches).toBe(false)
    expect(result.exitCodeMatch).toBe(false)
    expect(result.notes.some((n) => n.includes('Exit code'))).toBe(true)
  })

  test('detects stderr_empty mismatch', () => {
    const probe = makeProbe(['testcli', 'validate'])
    const observation = makeObservation(probe, 0, 'ok', 'warning')
    const result = compareToContract(contract, observation)
    expect(result.matches).toBe(false)
    expect(result.stderrMatch).toBe(false)
    expect(result.notes.some((n) => n.includes('Stderr'))).toBe(true)
  })
})
