import type { EchoObservation, EchoProbe } from './types.js';
export interface Contract {
    probe: string;
    command: string;
    accepted_at: string;
    accepted_by: string;
    observations: {
        exit_code: number;
        stdout_pattern: string | null;
        stderr_empty: boolean;
    };
    notes: string;
}
export declare function probeNameFromProbe(probe: EchoProbe): string;
export declare function contractPath(probeName: string): string;
export declare function ensureContractsDir(): void;
export declare function writeContract(probe: EchoProbe, observation: EchoObservation): string;
export declare function readContract(probeName: string): Contract | null;
export declare function listContracts(): string[];
export declare function compareToContract(contract: Contract, observation: EchoObservation): {
    matches: boolean;
    exitCodeMatch: boolean;
    stderrMatch: boolean;
    notes: string[];
};
export declare function contractBehaviorSummary(contract: Contract): string;
