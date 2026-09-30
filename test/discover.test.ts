import { describe, test, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeNameFromProbe } from '../src/contracts.js'
import {
  discoverProbes,
  parseSubcommandsFromHelp,
} from '../src/discover.js'
import type { EchoProbe } from '../src/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const repoRoot = path.join(projectRoot, 'testcli/base')

function probe(args: string[]): EchoProbe {
  return { args, confidence: 70, source: 'baseline' }
}

describe('discover', () => {
  test('always includes baseline --help probe at confidence 90', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    expect(
      result.probes.some(
        (p) =>
          p.args.length === 2 &&
          p.args[0] === 'testcli' &&
          p.args[1] === '--help' &&
          p.confidence === 90
      )
    ).toBe(true)
  })

  test('discovers validate, convert, inspect subcommands', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    expect(result.discoveredSubcommands).toContain('validate')
    expect(result.discoveredSubcommands).toContain('convert')
    expect(result.discoveredSubcommands).toContain('inspect')
  })

  test('does NOT include serve in probes', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    expect(result.probes.every((p) => !p.args.includes('serve'))).toBe(true)
    expect(result.skipped.some((p) => p.args.includes('serve'))).toBe(true)
  })

  test('pairs fixture files with subcommands at confidence 70', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    expect(
      result.probes.some(
        (p) =>
          p.args.includes('validate') &&
          p.args.some((a) => a.endsWith('valid.yml')) &&
          p.confidence === 70
      )
    ).toBe(true)
  })

  test('README examples score 100', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    expect(
      result.probes.some(
        (p) => p.args.includes('validate') && p.confidence === 100
      )
    ).toBe(true)
  })

  test('probes are sorted by confidence descending', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    for (let i = 0; i < result.probes.length - 1; i++) {
      expect(result.probes[i].confidence).toBeGreaterThanOrEqual(
        result.probes[i + 1].confidence
      )
    }
  })

  test('respects probe budget of 30', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    expect(result.probes.length).toBeLessThanOrEqual(30)
  })

  test('confidence 50 probes excluded by default', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    expect(result.probes.every((p) => p.confidence >= 70)).toBe(true)
  })

  test('serve appears in skipped not probes', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    expect(result.skipped.some((p) => p.args.includes('serve'))).toBe(true)
    expect(result.probes.every((p) => !p.args.includes('serve'))).toBe(true)
  })

  test('discovers nested subcommands like env show and env create', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    expect(
      result.probes.some(
        (p) =>
          p.args[1] === 'env' &&
          p.args[2] === 'show' &&
          p.confidence === 70
      )
    ).toBe(true)
    expect(
      result.probes.some(
        (p) =>
          p.args[1] === 'env' &&
          p.args[2] === 'create' &&
          p.confidence === 70
      )
    ).toBe(true)
    expect(
      result.probes.some(
        (p) =>
          p.args[1] === 'env' &&
          p.args[2] === 'prune' &&
          p.confidence === 70
      )
    ).toBe(true)
  })

  test('prefers nested leaves over bare parent group probes', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    expect(
      result.probes.some(
        (p) =>
          p.args.length === 2 &&
          p.args[0] === 'testcli' &&
          p.args[1] === 'env'
      )
    ).toBe(false)
  })

  test('nested subcommand probes use confidence 70', async () => {
    const result = await discoverProbes('testcli', repoRoot)
    const nested = result.probes.filter(
      (p) => p.args.length === 3 && p.args[1] === 'env'
    )

    expect(nested.length).toBeGreaterThan(0)
    expect(nested.every((p) => p.confidence === 70)).toBe(true)
  })

  test('probe naming joins nested subcommands with hyphens', () => {
    expect(probeNameFromProbe(probe(['hatch', 'env', 'show']))).toBe(
      'env-show'
    )
    expect(probeNameFromProbe(probe(['hatch', 'env', 'create']))).toBe(
      'env-create'
    )
    expect(probeNameFromProbe(probe(['hatch', 'fmt', 'check']))).toBe(
      'fmt-check'
    )
  })

  test('probe naming keeps single-level and help names', () => {
    expect(probeNameFromProbe(probe(['hatch', 'build']))).toBe('build')
    expect(probeNameFromProbe(probe(['hatch', '--help']))).toBe('help')
    expect(
      probeNameFromProbe(probe(['testcli', 'validate', 'fixtures/valid.yml']))
    ).toBe('validate')
  })

  test('discovered nested probes map to hyphenated names', async () => {
    const result = await discoverProbes('testcli', repoRoot)
    const names = result.probes.map((p) => probeNameFromProbe(p))

    expect(names).toContain('env-show')
    expect(names).toContain('env-create')
    expect(names).toContain('fmt-check')
  })

  test('does not recurse more than one level deep', async () => {
    const result = await discoverProbes('testcli', repoRoot)

    // One level: env deep is allowed
    expect(
      result.probes.some(
        (p) => p.args[1] === 'env' && p.args[2] === 'deep' && p.args.length === 3
      )
    ).toBe(true)

    // Two levels: env deep nested must NOT appear
    expect(
      result.probes.every(
        (p) =>
          !(
            p.args[1] === 'env' &&
            p.args[2] === 'deep' &&
            p.args[3] === 'nested'
          )
      )
    ).toBe(true)
    expect(
      result.probes.every((p) => probeNameFromProbe(p) !== 'env-deep-nested')
    ).toBe(true)
  })

  test('parseSubcommandsFromHelp finds nested Commands section', () => {
    const help = `
Usage: hatch env [OPTIONS] COMMAND [ARGS]...

Options:
  -h, --help  Show this message and exit.

Commands:
  create  Create environments
  find    Locate environments
  prune   Remove all environments
  show    Show the available environments
`
    const found = parseSubcommandsFromHelp(help)
    expect(found).toContain('create')
    expect(found).toContain('show')
    expect(found).toContain('prune')
    expect(found).toContain('find')
  })
})
