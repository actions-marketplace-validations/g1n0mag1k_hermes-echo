import { type StructuredDiff } from './diff.js';
import type { EchoObservation, EchoProbe } from './types.js';
export interface Contract {
    probe: string;
    command: string;
    accepted_at: string;
    accepted_by: string;
    observations: {
        exit_code: number;
        stdout: string | null;
        stderr: string | null;
    };
    notes: string;
}
export interface ContractComparison {
    matches: boolean;
    exitCodeMatch: boolean;
    stdoutMatch: boolean;
    stderrMatch: boolean;
    notes: string[];
    stdoutDiff: StructuredDiff;
    stderrDiff: StructuredDiff;
}
export declare function probeNameFromProbe(probe: EchoProbe): string;
export declare function contractPath(probeName: string): string;
export declare function ensureContractsDir(): void;
export declare function writeContract(probe: EchoProbe, observation: EchoObservation): string;
export declare function readContract(probeName: string): Contract | null;
export declare function listContracts(): string[];
export declare function compareToContract(contract: Contract, observation: EchoObservation): ContractComparison;
export declare function contractBehaviorSummary(contract: Contract): string;
