import { createHash } from 'node:crypto'
import type { EchoProbe, EchoObservation, EchoReceipt } from './types.js'
import { areEquivalent } from './normalize.js'

/** Receipt with the baseline observation attached for PR comment rendering. */
export type EchoReceiptWithBase = EchoReceipt & {
  base: EchoObservation
}

export interface LineDiff {
  added: string[]
  removed: string[]
  unchanged: number
}

export interface StructuredDiff extends LineDiff {
  /** Adjacent remove+add pairs coalesced as "before → after". */
  changed: string[]
}

function splitLines(text: string): string[] {
  if (text === '') return []
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n$/, '')
  if (normalized === '') return []
  return normalized.split('\n')
}

/**
 * Line-by-line diff of two strings via LCS.
 * Returns added lines, removed lines, and the count of unchanged lines.
 */
export function diffLines(before: string, after: string): LineDiff {
  const a = splitLines(before)
  const b = splitLines(after)
  const m = a.length
  const n = b.length

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array<number>(n + 1).fill(0)
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const added: string[] = []
  const removed: string[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      added.unshift(b[j - 1])
      j--
    } else {
      removed.unshift(a[i - 1])
      i--
    }
  }

  return { added, removed, unchanged: dp[m][n] }
}

/**
 * Like diffLines, but coalesces adjacent remove+add pairs into `changed`.
 */
export function structuredDiff(before: string, after: string): StructuredDiff {
  const a = splitLines(before)
  const b = splitLines(after)
  const m = a.length
  const n = b.length

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array<number>(n + 1).fill(0)
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  type Op =
    | { kind: 'equal' }
    | { kind: 'add'; line: string }
    | { kind: 'remove'; line: string }

  const ops: Op[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ kind: 'equal' })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ kind: 'add', line: b[j - 1] })
      j--
    } else {
      ops.unshift({ kind: 'remove', line: a[i - 1] })
      i--
    }
  }

  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  let unchanged = 0

  let idx = 0
  while (idx < ops.length) {
    const op = ops[idx]
    if (op.kind === 'equal') {
      unchanged++
      idx++
      continue
    }

    const remBatch: string[] = []
    const addBatch: string[] = []
    while (idx < ops.length && ops[idx].kind !== 'equal') {
      const cur = ops[idx]
      if (cur.kind === 'remove') remBatch.push(cur.line)
      else if (cur.kind === 'add') addBatch.push(cur.line)
      idx++
    }

    const pairs = Math.min(remBatch.length, addBatch.length)
    for (let p = 0; p < pairs; p++) {
      changed.push(`${remBatch[p]} → ${addBatch[p]}`)
    }
    removed.push(...remBatch.slice(pairs))
    added.push(...addBatch.slice(pairs))
  }

  return { added, removed, changed, unchanged }
}

/** Format a line diff as a GitHub ```diff fenced block. */
export function formatDiffBlock(before: string, after: string, label?: string): string {
  const { added, removed } = diffLines(before, after)
  if (added.length === 0 && removed.length === 0) return ''

  const lines: string[] = []
  if (label) lines.push(label)
  lines.push('```diff')
  for (const line of removed) {
    lines.push(`-${line}`)
  }
  for (const line of added) {
    lines.push(`+${line}`)
  }
  lines.push('```')
  return lines.join('\n')
}

export function diffObservations(
  probe: EchoProbe,
  base: EchoObservation,
  head: EchoObservation
): EchoReceipt {
  let classification: EchoReceipt['classification']

  if (base.skipped || head.skipped) {
    classification = 'skipped'
  } else if (base.timedOut || head.timedOut) {
    classification = 'timed_out'
  } else if (
    base.exitCode !== head.exitCode ||
    !areEquivalent(base.stdout, head.stdout) ||
    !areEquivalent(base.stderr, head.stderr)
  ) {
    classification = 'possible_change'
  } else {
    classification = 'unchanged'
  }

  const id = createHash('sha256')
    .update(
      probe.args.join(' ') +
        base.environment.commit +
        head.environment.commit
    )
    .digest('hex')
    .slice(0, 12)

  const receipt: EchoReceiptWithBase = {
    id,
    probe,
    observation: head,
    base,
    classification,
    generatedAt: new Date().toISOString(),
  }

  return receipt
}
