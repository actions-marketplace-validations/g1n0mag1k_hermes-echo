import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dump as yamlDump, load as yamlLoad } from 'js-yaml'
import { structuredDiff, type StructuredDiff } from './diff.js'
import { areEquivalent } from './normalize.js'
import type { EchoObservation, EchoProbe } from './types.js'

export interface Contract {
  probe: string
  command: string
  accepted_at: string
  accepted_by: string
  observations: {
    exit_code: number
    stdout: string | null
    stderr: string | null
  }
  notes: string
}

export interface ContractComparison {
  matches: boolean
  exitCodeMatch: boolean
  stdoutMatch: boolean
  stderrMatch: boolean
  notes: string[]
  stdoutDiff: StructuredDiff
  stderrDiff: StructuredDiff
}

const PROBE_NAME_RE = /^[A-Za-z0-9_-]+$/

function projectRoot(): string {
  return process.env.HERMES_ECHO_PROJECT_ROOT ?? process.cwd()
}

function contractsDirAbs(): string {
  return path.join(projectRoot(), '.hermes', 'contracts')
}

function packageVersionLabel(): string {
  const pkgPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'package.json'
  )
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
  return `hermes-echo v${pkg.version}`
}

function storeOutput(text: string): string | null {
  return text === '' ? null : text
}

function outputValue(value: string | null | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '')
}

export function probeNameFromProbe(probe: EchoProbe): string {
  const parts: string[] = []
  for (let i = 1; i < probe.args.length; i++) {
    const arg = probe.args[i]
    if (!arg || arg === '--help') {
      break
    }
    // Stop before flags, paths, and filenames — those are probe args, not names
    if (arg.startsWith('-') || arg.includes('.') || arg.includes('/')) {
      break
    }
    parts.push(arg)
  }
  if (parts.length === 0) {
    return 'help'
  }
  return parts.join('-')
}

export function contractPath(probeName: string): string {
  if (!probeName) {
    throw new Error('Probe name is required')
  }
  if (!PROBE_NAME_RE.test(probeName)) {
    throw new Error(
      `Invalid probe name '${probeName}': use only letters, numbers, hyphens, and underscores`
    )
  }
  return `.hermes/contracts/${probeName}.yml`
}

function contractFileAbs(probeName: string): string {
  return path.join(contractsDirAbs(), `${probeName}.yml`)
}

export function ensureContractsDir(): void {
  mkdirSync(contractsDirAbs(), { recursive: true })
}

export function writeContract(probe: EchoProbe, observation: EchoObservation): string {
  if (observation.exitCode === null || observation.exitCode === undefined) {
    throw new Error('Cannot write contract: probe has not been executed successfully')
  }

  const probeName = probeNameFromProbe(probe)
  const acceptedAt = new Date().toISOString()
  const contract: Contract = {
    probe: probeName,
    command: probe.args.join(' '),
    accepted_at: acceptedAt,
    accepted_by: packageVersionLabel(),
    observations: {
      exit_code: observation.exitCode,
      stdout: storeOutput(observation.stdout),
      stderr: storeOutput(observation.stderr),
    },
    notes: '',
  }

  ensureContractsDir()
  const filePath = contractFileAbs(probeName)
  const header = `# Echo Contract — accepted ${acceptedAt}\n`
  const body = yamlDump(contract, { lineWidth: 120, noRefs: true })
  writeFileSync(filePath, header + body, 'utf8')
  return contractPath(probeName)
}

export function readContract(probeName: string): Contract | null {
  const filePath = contractFileAbs(probeName)
  if (!existsSync(filePath)) {
    return null
  }
  const raw = readFileSync(filePath, 'utf8')
  const withoutHeader = raw.replace(/^#.*\n/, '')
  const parsed = yamlLoad(withoutHeader)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Corrupted contract file: ${filePath}`)
  }
  return parsed as Contract
}

export function listContracts(): string[] {
  const dir = contractsDirAbs()
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => name.slice(0, -4))
    .sort()
}

export function compareToContract(
  contract: Contract,
  observation: EchoObservation
): ContractComparison {
  const exitCodeMatch =
    observation.exitCode !== null &&
    observation.exitCode === contract.observations.exit_code

  const expectedStdout = outputValue(contract.observations.stdout)
  const expectedStderr = outputValue(contract.observations.stderr)
  const actualStdout = outputValue(observation.stdout)
  const actualStderr = outputValue(observation.stderr)

  const stdoutMatch = areEquivalent(expectedStdout, actualStdout)
  const stderrMatch = areEquivalent(expectedStderr, actualStderr)

  const emptyDiff = (text: string): StructuredDiff => ({
    added: [],
    removed: [],
    changed: [],
    unchanged: text === '' ? 0 : text.split('\n').length,
  })

  const stdoutDiff = stdoutMatch
    ? emptyDiff(expectedStdout)
    : structuredDiff(expectedStdout, actualStdout)
  const stderrDiff = stderrMatch
    ? emptyDiff(expectedStderr)
    : structuredDiff(expectedStderr, actualStderr)

  const notes: string[] = []
  if (!exitCodeMatch) {
    notes.push(
      `Exit code was ${observation.exitCode ?? 'unknown'}, contract expects ${contract.observations.exit_code}`
    )
  }
  if (!stdoutMatch) {
    const parts: string[] = []
    if (stdoutDiff.removed.length > 0) {
      parts.push(`${stdoutDiff.removed.length} line(s) removed`)
    }
    if (stdoutDiff.added.length > 0) {
      parts.push(`${stdoutDiff.added.length} line(s) added`)
    }
    if (stdoutDiff.changed.length > 0) {
      parts.push(`${stdoutDiff.changed.length} line(s) changed`)
    }
    notes.push(
      parts.length > 0
        ? `Stdout drifted: ${parts.join(', ')}`
        : 'Stdout drifted from accepted contract'
    )
  }
  if (!stderrMatch) {
    const parts: string[] = []
    if (stderrDiff.removed.length > 0) {
      parts.push(`${stderrDiff.removed.length} line(s) removed`)
    }
    if (stderrDiff.added.length > 0) {
      parts.push(`${stderrDiff.added.length} line(s) added`)
    }
    if (stderrDiff.changed.length > 0) {
      parts.push(`${stderrDiff.changed.length} line(s) changed`)
    }
    notes.push(
      parts.length > 0
        ? `Stderr drifted: ${parts.join(', ')}`
        : 'Stderr drifted from accepted contract'
    )
  }

  return {
    matches: exitCodeMatch && stdoutMatch && stderrMatch,
    exitCodeMatch,
    stdoutMatch,
    stderrMatch,
    notes,
    stdoutDiff,
    stderrDiff,
  }
}

export function contractBehaviorSummary(contract: Contract): string {
  const stderr =
    contract.observations.stderr === null ||
    contract.observations.stderr.replace(/\s+$/, '') === ''
      ? 'empty'
      : 'present'
  return `exit ${contract.observations.exit_code}, stderr ${stderr}`
}
