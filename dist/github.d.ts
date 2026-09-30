import type { EchoReceipt } from './types.js';
import type { Octokit } from '@octokit/rest';
import { type StructuredDiff } from './diff.js';
export declare const HERMES_ECHO_MARKER = "<!-- hermes-echo-marker -->";
export interface ContractCommentStatus {
    probe: string;
    matches: boolean;
    notes: string[];
    /** Shown in the Contract column, e.g. "exit 0, stderr empty". */
    behavior?: string;
    /** Accepted vs live stdout for drift rendering. */
    expectedStdout?: string;
    actualStdout?: string;
    /** Accepted vs live stderr for drift rendering. */
    expectedStderr?: string;
    actualStderr?: string;
    stdoutDiff?: StructuredDiff;
    stderrDiff?: StructuredDiff;
}
export declare function generateComment(receipts: EchoReceipt[], contracts?: ContractCommentStatus[]): string;
export declare function upsertPRComment(octokit: Octokit, owner: string, repo: string, prNumber: number, body: string): Promise<void>;
