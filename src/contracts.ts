import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dump as yamlDump, load as yamlLoad } from 'js-yaml'
import type { EchoObservation, EchoProbe } from './types.js'

export interface Contract {
  probe: string
  command: string
  accepted_at: string
  accepted_by: string
  observations: {
    exit_code: number
    stdout_pattern: string | null
    stderr_empty: boolean
  }
  notes: string
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

export function probeNameFromProbe(probe: EchoProbe): string {
  const subcommand = probe.args[1]
  if (!subcommand || subcommand === '--help') {
    return 'help'
  }
  return subcommand
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

function stdoutPattern(stdout: string): string | null {
  const trimmed = stdout.replace(/\n+$/, '')
  if (trimmed === '') return null
  return trimmed.slice(0, 60)
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
      stdout_pattern: stdoutPattern(observation.stdout),
      stderr_empty: observation.stderr.replace(/\s+$/, '') === '',
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
): {
  matches: boolean
  exitCodeMatch: boolean
  stderrMatch: boolean
  notes: string[]
} {
  const exitCodeMatch =
    observation.exitCode !== null &&
    observation.exitCode === contract.observations.exit_code

  const stderrEmpty = observation.stderr.replace(/\s+$/, '') === ''
  const stderrMatch = stderrEmpty === contract.observations.stderr_empty

  const notes: string[] = []
  if (!exitCodeMatch) {
    notes.push(
      `Exit code was ${observation.exitCode ?? 'unknown'}, contract expects ${contract.observations.exit_code}`
    )
  }
  if (!stderrMatch) {
    const observed = stderrEmpty ? 'empty' : 'present'
    const expected = contract.observations.stderr_empty ? 'empty' : 'present'
    notes.push(`Stderr was ${observed}, contract expects ${expected}`)
  }

  return {
    matches: exitCodeMatch && stderrMatch,
    exitCodeMatch,
    stderrMatch,
    notes,
  }
}

export function contractBehaviorSummary(contract: Contract): string {
  const stderr = contract.observations.stderr_empty ? 'empty' : 'present'
  return `exit ${contract.observations.exit_code}, stderr ${stderr}`
}
