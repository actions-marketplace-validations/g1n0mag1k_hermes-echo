import { describe, test, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverProbes } from '../src/discover.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const repoRoot = path.join(projectRoot, 'testcli/base')

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
})
