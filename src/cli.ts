#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDoctor, formatDoctorReport } from './doctor.js'
import { discoverProbes } from './discover.js'
import { executeProbe } from './execute.js'
import {
  probeNameFromProbe,
  readContract,
  writeContract,
} from './contracts.js'

async function detectCommand(repoRoot: string): Promise<string | null> {
  const setupPath = path.join(repoRoot, 'setup.py')
  try {
    const content = await fs.readFile(setupPath, 'utf8')
    const match = content.match(
      /console_scripts['"]\s*:\s*\[\s*['"]([^'"]+)['"]/
    )
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) return undefined
  return args[index + 1]
}

function stripFlags(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--command') {
      i++
      continue
    }
    out.push(args[i])
  }
  return out
}

async function resolveCommand(
  repoRoot: string,
  extraArgs: string[]
): Promise<string> {
  const fromFlag = parseFlag(extraArgs, '--command')
  if (fromFlag) return fromFlag
  const detected = await detectCommand(repoRoot)
  if (detected) return detected
  throw new Error(
    'Could not detect CLI command. Pass --command <name> (console script from setup.py).'
  )
}

async function runAccept(repoRoot: string, command: string, probeArg?: string) {
  const report = await runDoctor(command, repoRoot)
  if (!report.ready) {
    console.log(formatDoctorReport(report))
    process.exit(1)
  }

  const discovery = await discoverProbes(command, repoRoot, {
    minConfidence: 70,
  })
  const probes = discovery.probes

  const acceptProbe = async (probe: typeof probes[number]) => {
    const name = probeNameFromProbe(probe)
    const existing = readContract(name)
    if (existing) {
      console.log(`↺ Updating existing contract: ${name}`)
    }
    const observation = await executeProbe(probe)
    if (
      observation.skipped ||
      observation.timedOut ||
      observation.exitCode === null ||
      observation.exitCode === undefined
    ) {
      const reason =
        observation.skipReason ||
        (observation.timedOut ? 'timed out' : 'no exit code')
      console.error(`Cannot accept probe '${name}': ${reason}`)
      process.exit(1)
    }
    const written = writeContract(probe, observation)
    const stderrLabel =
      observation.stderr.replace(/\s+$/, '') === '' ? 'empty' : 'present'
    console.log(`✓ Contract accepted: ${name}`)
    console.log(`  Command: ${probe.args.join(' ')}`)
    console.log(
      `  Observed: exit ${observation.exitCode}, stderr ${stderrLabel}`
    )
    console.log(`  Written to: ${written}`)
    return name
  }

  if (probeArg) {
    const matches = probes.filter(
      (p) => probeNameFromProbe(p).toLowerCase() === probeArg.toLowerCase()
    )
    if (matches.length === 0) {
      console.error(`No probe found matching '${probeArg}'`)
      process.exit(1)
    }
    const best = matches.sort((a, b) => b.confidence - a.confidence)[0]
    await acceptProbe(best)
    return
  }

  let count = 0
  const seen = new Set<string>()
  for (const probe of probes) {
    const name = probeNameFromProbe(probe)
    if (seen.has(name)) continue
    seen.add(name)
    if (readContract(name)) {
      console.log(`↺ Updating existing contract: ${name}`)
    }
    const observation = await executeProbe(probe)
    if (
      observation.skipped ||
      observation.timedOut ||
      observation.exitCode === null ||
      observation.exitCode === undefined
    ) {
      const reason =
        observation.skipReason ||
        (observation.timedOut ? 'timed out' : 'no exit code')
      console.log(`⊘ Skipped contract for ${name}: ${reason}`)
      continue
    }
    writeContract(probe, observation)
    count++
  }

  console.log(`✓ ${count} contracts accepted`)
  console.log('  Written to .hermes/contracts/')
}

async function runDoctorCommand(repoRoot: string, command: string) {
  const report = await runDoctor(command, repoRoot)
  console.log(formatDoctorReport(report))
  if (!report.ready) {
    process.exit(1)
  }
}

function packageVersion(): string {
  const pkgPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'package.json'
  )
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
  return pkg.version
}

async function main() {
  const argv = process.argv.slice(2)
  const subcommand = argv[0]
  const repoRoot = process.cwd()
  const rest = stripFlags(argv.slice(1))

  if (subcommand === '--version' || subcommand === '-v') {
    console.log(packageVersion())
    process.exit(0)
  }

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(`hermes-echo — behavioral echo for CLIs

Usage:
  hermes-echo doctor [--command <name>]
  hermes-echo accept [probe-name] [--command <name>]

Options:
  --command   Console script name (default: from setup.py entry point)
`)
    process.exit(0)
  }

  const command = await resolveCommand(repoRoot, argv)

  switch (subcommand) {
    case 'doctor':
      await runDoctorCommand(repoRoot, command)
      break
    case 'accept':
      await runAccept(repoRoot, command, rest[0])
      break
    case 'demo':
    case 'run':
      console.error(
        `${subcommand} is not implemented in this build. Use doctor or accept.`
      )
      process.exit(1)
      break
    default:
      console.error(`Unknown command: ${subcommand}`)
      process.exit(1)
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(message)
  process.exit(1)
})
