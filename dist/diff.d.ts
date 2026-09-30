import type { EchoProbe, EchoObservation, EchoReceipt } from './types.js';
/** Receipt with the baseline observation attached for PR comment rendering. */
export type EchoReceiptWithBase = EchoReceipt & {
    base: EchoObservation;
};
export declare function diffObservations(probe: EchoProbe, base: EchoObservation, head: EchoObservation): EchoReceipt;
