import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { EchoProbe } from './types.js'
import { DAEMON_KEYWORDS, executeProbe } from './execute.js'

export interface DiscoveryResult {
  probes: EchoProbe[]
  skipped: EchoProbe[]
  discoveredSubcommands: string[]
  totalCandidates: number
}

const FIXTURE_DIRS = [
  'fixtures',
  'examples',
  'testdata',
  'tests/fixtures',
  'test/fixtures',
  'tests/data',
  'test/data',
  'data',
]

const FIXTURE_EXTENSIONS = new Set([
  '.yml',
  '.yaml',
  '.json',
  '.toml',
  '.cfg',
  '.conf',
  '.txt',
  '.csv',
  '.ini',
])

const README_NAMES = ['README.md', 'README.rst', 'README.txt']
const MAX_FIXTURES_PER_SUBCOMMAND = 5
const MAX_README_PROBES = 10
const MAX_TEST_PROBES = 10

const COMMANDS_HEADER = /Commands:|Subcommands:|Available commands:/i
const COMMAND_LINE = /^\s{2,4}(\w[\w-]*)\s/
const CLICK_BRACE = /\{([^{}]+)\}/
const SHELL_VAR = /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*/
const FENCE = /```[^\n]*\n([\s\S]*?)```/g

function hasDaemonArg(args: string[]): boolean {
  return args.slice(1).some((arg) => DAEMON_KEYWORDS.includes(arg))
}

function parseSubcommandsFromHelp(helpText: string): string[] {
  const found = new Set<string>()
  const lines = helpText.split(/\r?\n/)

  let inCommands = false
  for (const line of lines) {
    if (COMMANDS_HEADER.test(line)) {
      inCommands = true
      continue
    }
    if (inCommands) {
      const match = line.match(COMMAND_LINE)
      if (match) {
        found.add(match[1])
      }
    }

    const brace = line.match(CLICK_BRACE)
    if (brace) {
      for (const part of brace[1].split(/[,|]/)) {
        const name = part.trim()
        if (/^\w[\w-]*$/.test(name)) {
          found.add(name)
        }
      }
    }
  }

  return [...found]
}

async function listFixtureFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []

  for (const dir of FIXTURE_DIRS) {
    const absDir = path.join(repoRoot, dir)
    let entries
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!FIXTURE_EXTENSIONS.has(ext)) continue
      results.push(path.join(dir, entry.name))
    }
  }

  results.sort()
  return results
}

function shellSplit(line: string): string[] | null {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (quote) {
      if (ch === quote) {
        quote = null
      } else if (ch === '\\' && quote === '"' && i + 1 < line.length) {
        current += line[++i]
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }

    if (ch === '\\' && i + 1 < line.length) {
      current += line[++i]
      continue
    }

    current += ch
  }

  if (quote) return null
  if (current.length > 0) args.push(current)
  return args.length > 0 ? args : null
}

async function discoverReadmeProbes(
  command: string,
  repoRoot: string,
  skipped: EchoProbe[]
): Promise<EchoProbe[]> {
  const probes: EchoProbe[] = []

  for (const name of README_NAMES) {
    const abs = path.join(repoRoot, name)
    let content: string
    try {
      content = await fs.readFile(abs, 'utf8')
    } catch {
      continue
    }

    for (const match of content.matchAll(FENCE)) {
      const block = match[1]
      for (const rawLine of block.split(/\r?\n/)) {
        if (probes.length >= MAX_README_PROBES) return probes

        let line = rawLine.trim()
        if (!line) continue

        if (line.startsWith('$')) {
          line = line.slice(1).trim()
        }

        if (!(line === command || line.startsWith(command + ' '))) {
          continue
        }

        if (SHELL_VAR.test(line)) continue

        let args: string[] | null
        try {
          args = shellSplit(line)
        } catch {
          continue
        }
        if (!args || args[0] !== command) continue

        if (hasDaemonArg(args)) {
          skipped.push({ args, confidence: 100, source: 'readme' })
          continue
        }

        probes.push({ args, confidence: 100, source: 'readme' })
      }
    }
  }

  return probes
}

function extractLiteralStringArray(text: string): string[] | null {
  const matches = [...text.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)]
  if (matches.length === 0) return null
  return matches.map((m) => (m[1] !== undefined ? m[1] : m[2]))
}

async function discoverTestProbes(
  command: string,
  repoRoot: string,
  skipped: EchoProbe[]
): Promise<EchoProbe[]> {
  const probes: EchoProbe[] = []
  const testDirs = ['tests', 'test']

  for (const dir of testDirs) {
    const absDir = path.join(repoRoot, dir)
    let entries: string[]
    try {
      entries = await walkPyFiles(absDir)
    } catch {
      continue
    }

    for (const file of entries) {
      let content: string
      try {
        content = await fs.readFile(file, 'utf8')
      } catch {
        continue
      }

      for (const rawLine of content.split(/\r?\n/)) {
        if (probes.length >= MAX_TEST_PROBES) return probes

        const line = rawLine
        if (
          !line.includes('subprocess.run(') &&
          !line.includes('subprocess.call(') &&
          !line.includes('CliRunner().invoke(')
        ) {
          continue
        }

        if (line.includes('f"') || line.includes("f'") || line.includes('+')) {
          continue
        }

        let arrayMatch =
          line.match(/subprocess\.(?:run|call)\(\s*\[([^\]]*)\]/) ||
          line.match(/CliRunner\(\)\.invoke\([^,]+,\s*\[([^\]]*)\]/)

        if (!arrayMatch) continue

        const arrayBody = arrayMatch[1]
        // Reject variable references inside the array (identifiers not in quotes)
        if (/[^'"\s,][A-Za-z_]/.test(arrayBody.replace(/'[^']*'|"[^"]*"/g, ''))) {
          continue
        }

        const args = extractLiteralStringArray(arrayBody)
        if (!args || args.length === 0) continue
        if (args[0] !== command) continue

        if (hasDaemonArg(args)) {
          skipped.push({ args, confidence: 95, source: 'test' })
          continue
        }

        probes.push({ args, confidence: 95, source: 'test' })
      }
    }
  }

  return probes
}

async function walkPyFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkPyFiles(full)))
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      out.push(full)
    }
  }
  return out
}

export async function discoverProbes(
  command: string,
  repoRoot: string,
  options?: {
    minConfidence?: number
    maxProbes?: number
  }
): Promise<DiscoveryResult> {
  const minConfidence = options?.minConfidence ?? 70
  const maxProbes = options?.maxProbes ?? 30

  const skipped: EchoProbe[] = []
  const candidates: EchoProbe[] = []

  // ALWAYS: baseline --help
  candidates.push({
    args: [command, '--help'],
    confidence: 90,
    source: 'baseline',
  })

  // LEVEL 1 — --help parsing
  const helpObs = await executeProbe({
    args: [command, '--help'],
    confidence: 90,
    source: 'baseline',
  })
  const helpText = `${helpObs.stdout}\n${helpObs.stderr}`
  const discoveredSubcommands = parseSubcommandsFromHelp(helpText)

  for (const sub of discoveredSubcommands) {
    const bareArgs = [command, sub]

    if (DAEMON_KEYWORDS.includes(sub)) {
      skipped.push({
        args: bareArgs,
        confidence: 50,
        source: 'baseline',
      })
      continue
    }

    const confirm = await executeProbe({
      args: [command, sub, '--help'],
      confidence: 50,
      source: 'baseline',
    })

    if (
      confirm.skipped ||
      confirm.timedOut ||
      confirm.exitCode === null ||
      confirm.exitCode !== 0
    ) {
      continue
    }

    candidates.push({
      args: bareArgs,
      confidence: 50,
      source: 'baseline',
    })
  }

  // LEVEL 2 — fixture file pairing
  const fixtures = await listFixtureFiles(repoRoot)
  for (const sub of discoveredSubcommands) {
    let count = 0
    for (const fixturePath of fixtures) {
      if (count >= MAX_FIXTURES_PER_SUBCOMMAND) break
      const args = [command, sub, fixturePath]
      count++

      if (hasDaemonArg(args)) {
        skipped.push({
          args,
          confidence: 70,
          source: 'fixture',
        })
        continue
      }

      candidates.push({
        args,
        confidence: 70,
        source: 'fixture',
      })
    }
  }

  // LEVEL 3 — README scanning
  const readmeProbes = await discoverReadmeProbes(command, repoRoot, skipped)
  candidates.push(...readmeProbes)

  // LEVEL 4 — test file scanning
  const testProbes = await discoverTestProbes(command, repoRoot, skipped)
  candidates.push(...testProbes)

  const allCandidates = [...candidates].sort(
    (a, b) => b.confidence - a.confidence
  )
  const totalCandidates = allCandidates.length

  const probes = allCandidates
    .filter((p) => p.confidence >= minConfidence)
    .slice(0, maxProbes)

  return {
    probes,
    skipped,
    discoveredSubcommands,
    totalCandidates,
  }
}
