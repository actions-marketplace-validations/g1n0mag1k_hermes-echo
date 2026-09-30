import type { EchoReceipt } from './types.js';
import type { Octokit } from '@octokit/rest';
export declare const HERMES_ECHO_MARKER = "<!-- hermes-echo-marker -->";
export interface ContractCommentStatus {
    probe: string;
    matches: boolean;
    notes: string[];
    /** Shown in the Contract column, e.g. "exit 0, stderr empty". */
    behavior?: string;
}
export declare function generateComment(receipts: EchoReceipt[], contracts?: ContractCommentStatus[]): string;
export declare function upsertPRComment(octokit: Octokit, owner: string, repo: string, prNumber: number, body: string): Promise<void>;
