import type { EchoReceipt } from './types.js'
import type { EchoObservation } from './types.js'
import type { Octokit } from '@octokit/rest'
import {
  formatDiffBlock,
  type EchoReceiptWithBase,
  type StructuredDiff,
} from './diff.js'

export const HERMES_ECHO_MARKER = '<!-- hermes-echo-marker -->'

export interface ContractCommentStatus {
  probe: string
  matches: boolean
  notes: string[]
  /** Shown in the Contract column, e.g. "exit 0, stderr empty". */
  behavior?: string
  /** Accepted vs live stdout for drift rendering. */
  expectedStdout?: string
  actualStdout?: string
  /** Accepted vs live stderr for drift rendering. */
  expectedStderr?: string
  actualStderr?: string
  stdoutDiff?: StructuredDiff
  stderrDiff?: StructuredDiff
}

const COMMENT_MAX_LENGTH = 50_000
const OUTPUT_TRUNCATE_AT = 400
const OUTPUT_HEAD_CHARS = 200
const OUTPUT_TAIL_CHARS = 150
const TRUNCATION_NOTE =
  'Output truncated — view full evidence in workflow artifacts.'

function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_TRUNCATE_AT) return text
  return (
    text.slice(0, OUTPUT_HEAD_CHARS) +
    ' ... ' +
    text.slice(-OUTPUT_TAIL_CHARS)
  )
}

function displayValue(text: string): string {
  const trimmed = text.replace(/\n+$/, '')
  if (trimmed === '') return '(empty)'
  return truncateOutput(trimmed)
}

function getBase(receipt: EchoReceipt): EchoObservation {
  const withBase = receipt as EchoReceiptWithBase
  if (withBase.base) return withBase.base
  return receipt.observation
}

function getHead(receipt: EchoReceipt): EchoObservation {
  return receipt.observation
}

function formatChangedProbe(receipt: EchoReceipt): string {
  const base = getBase(receipt)
  const head = getHead(receipt)
  const argsLabel = receipt.probe.args.join(' ')

  const rows: string[] = ['| | Base | PR |', '|---|---|---|']

  if (base.exitCode !== head.exitCode) {
    rows.push(`| Exit code | \`${base.exitCode}\` | \`${head.exitCode}\` |`)
  }

  if (base.stderrNormalized !== head.stderrNormalized) {
    rows.push(
      `| Stderr | \`${displayValue(base.stderr)}\` | \`${displayValue(head.stderr)}\` |`
    )
  }

  if (base.stdoutNormalized !== head.stdoutNormalized) {
    rows.push(
      `| Stdout | \`${displayValue(base.stdout)}\` | \`${displayValue(head.stdout)}\` |`
    )
  }

  return [
    `### ⚠ \`${argsLabel}\``,
    rows.join('\n'),
    '> Possible behavior change. No existing test covers',
    '> this invocation.',
  ].join('\n')
}

function buildChangeComment(receipts: EchoReceipt[]): string {
  const total = receipts.length
  const unchanged = receipts.filter((r) => r.classification === 'unchanged')
  const changed = receipts.filter(
    (r) =>
      r.classification === 'possible_change' ||
      r.classification === 'contract_violation'
  )
  const skipped = receipts.filter((r) => r.classification === 'skipped')

  const sections: string[] = [
    HERMES_ECHO_MARKER,
    '## 🔬 Hermes Echo · ECHO DETECTED A CHANGE',
    `**${total} probes executed** · **${unchanged.length} unchanged** · **${changed.length} possible changes** · **${skipped.length} skipped**`,
    '---',
  ]

  for (const receipt of changed) {
    sections.push(formatChangedProbe(receipt))
    sections.push('---')
  }

  sections.push(`### ✅ ${unchanged.length} probes unchanged`)
  sections.push('---')
  sections.push('Your tests passed. The echo changed.')
  sections.push(
    '*[Hermes Echo](https://hermesrelay.dev/echo) · [what is this?](https://hermesrelay.dev/echo)*'
  )

  return sections.join('\n')
}

function hasDiffContent(diff?: StructuredDiff): boolean {
  if (!diff) return false
  return (
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.changed.length > 0
  )
}

function formatContractOutputDiff(contract: ContractCommentStatus): string {
  const blocks: string[] = []

  if (
    hasDiffContent(contract.stdoutDiff) &&
    contract.expectedStdout !== undefined &&
    contract.actualStdout !== undefined
  ) {
    const block = formatDiffBlock(
      contract.expectedStdout,
      contract.actualStdout,
      `**Stdout diff** (\`${contract.probe}\`):`
    )
    if (block) blocks.push(block)
  }

  if (
    hasDiffContent(contract.stderrDiff) &&
    contract.expectedStderr !== undefined &&
    contract.actualStderr !== undefined
  ) {
    const block = formatDiffBlock(
      contract.expectedStderr,
      contract.actualStderr,
      `**Stderr diff** (\`${contract.probe}\`):`
    )
    if (block) blocks.push(block)
  }

  return blocks.join('\n\n')
}

function buildContractsSection(contracts: ContractCommentStatus[]): string {
  const verified = contracts.filter((c) => c.matches).length
  const lines: string[] = [
    '## Echo Contracts',
    `${verified} of ${contracts.length} accepted contracts verified`,
    '',
    '| Probe | Contract | Status |',
    '|-------|----------|--------|',
  ]

  const driftBlocks: string[] = []

  for (const contract of contracts) {
    const summary =
      contract.behavior ??
      (contract.matches ? 'per accepted contract' : '—')
    const status = contract.matches ? '✓ HOLDS' : '✗ DRIFTED'
    lines.push(`| ${contract.probe} | ${summary} | ${status} |`)
    if (!contract.matches && contract.notes.length > 0) {
      lines.push(`| | ${contract.notes.join('; ')} | |`)
    }
    if (!contract.matches) {
      const diff = formatContractOutputDiff(contract)
      if (diff) driftBlocks.push(diff)
    }
  }

  if (driftBlocks.length > 0) {
    lines.push('')
    lines.push(...driftBlocks)
  }

  return lines.join('\n')
}

function appendContractsSection(
  body: string,
  contracts: ContractCommentStatus[]
): string {
  if (contracts.length === 0) return body
  const section = buildContractsSection(contracts)
  const divider = '---'
  const firstBreak = body.indexOf(divider)
  if (firstBreak === -1) {
    return `${body}\n\n${section}`
  }
  const insertAt = firstBreak + divider.length
  return `${body.slice(0, insertAt)}\n\n${section}\n${body.slice(insertAt)}`
}

function buildVerifiedComment(receipts: EchoReceipt[]): string {
  const total = receipts.length
  const unchanged = receipts.filter((r) => r.classification === 'unchanged')
    .length

  return [
    HERMES_ECHO_MARKER,
    '## ✅ Hermes Echo · ECHO VERIFIED',
    `**${total} probes executed · ${unchanged} unchanged · 0 unexplained changes**`,
    'The observable behavioral surface remains consistent',
    'with the baseline.',
    'Your tests passed. The echo confirmed it.',
    '---',
    '*[Hermes Echo](https://hermesrelay.dev/echo) by [Hermes Relay](https://hermesrelay.dev)*',
  ].join('\n')
}

function enforceLengthLimit(body: string): string {
  if (body.length <= COMMENT_MAX_LENGTH) return body

  // Aggressively shrink fenced/backticked output cells, then append note.
  let truncated = body
  // Replace long backtick spans with shortened versions
  truncated = truncated.replace(/`([^`]+)`/g, (_match, inner: string) => {
    if (inner.length <= 80) return `\`${inner}\``
    return (
      '`' +
      inner.slice(0, 40) +
      ' ... ' +
      inner.slice(-30) +
      '`'
    )
  })

  if (truncated.length > COMMENT_MAX_LENGTH) {
    truncated =
      truncated.slice(0, COMMENT_MAX_LENGTH - TRUNCATION_NOTE.length - 2) +
      '\n\n' +
      TRUNCATION_NOTE
  } else if (!truncated.includes(TRUNCATION_NOTE)) {
    truncated = truncated + '\n\n' + TRUNCATION_NOTE
  }

  return truncated
}

export function generateComment(
  receipts: EchoReceipt[],
  contracts: ContractCommentStatus[] = []
): string {
  const receiptChanges = receipts.some(
    (r) =>
      r.classification === 'possible_change' ||
      r.classification === 'contract_violation'
  )
  const contractDrift = contracts.some((c) => !c.matches)
  const hasChanges = receiptChanges || contractDrift

  let body = hasChanges
    ? buildChangeComment(receipts)
    : buildVerifiedComment(receipts)

  body = appendContractsSection(body, contracts)

  return enforceLengthLimit(body)
}

export async function upsertPRComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  })

  const existing = comments.find((c) =>
    (c.body ?? '').includes(HERMES_ECHO_MARKER)
  )

  if (existing) {
    await octokit.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    })
    return
  }

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  })
}
