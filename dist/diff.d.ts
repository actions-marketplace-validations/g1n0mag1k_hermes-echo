import type { EchoProbe, EchoObservation, EchoReceipt } from './types.js';
/** Receipt with the baseline observation attached for PR comment rendering. */
export type EchoReceiptWithBase = EchoReceipt & {
    base: EchoObservation;
};
export interface LineDiff {
    added: string[];
    removed: string[];
    unchanged: number;
}
export interface StructuredDiff extends LineDiff {
    /** Adjacent remove+add pairs coalesced as "before → after". */
    changed: string[];
}
/**
 * Line-by-line diff of two strings via LCS.
 * Returns added lines, removed lines, and the count of unchanged lines.
 */
export declare function diffLines(before: string, after: string): LineDiff;
/**
 * Like diffLines, but coalesces adjacent remove+add pairs into `changed`.
 */
export declare function structuredDiff(before: string, after: string): StructuredDiff;
/** Format a line diff as a GitHub ```diff fenced block. */
export declare function formatDiffBlock(before: string, after: string, label?: string): string;
export declare function diffObservations(probe: EchoProbe, base: EchoObservation, head: EchoObservation): EchoReceipt;
