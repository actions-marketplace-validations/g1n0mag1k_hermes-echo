import { createHash } from 'node:crypto'
import type { EchoProbe, EchoObservation, EchoReceipt } from './types.js'
import { areEquivalent } from './normalize.js'

/** Receipt with the baseline observation attached for PR comment rendering. */
export type EchoReceiptWithBase = EchoReceipt & {
  base: EchoObservation
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
