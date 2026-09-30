import type { EchoProbe } from './types.js';
export interface DiscoveryResult {
    probes: EchoProbe[];
    skipped: EchoProbe[];
    discoveredSubcommands: string[];
    totalCandidates: number;
}
export declare function parseSubcommandsFromHelp(helpText: string): string[];
export declare function discoverProbes(command: string, repoRoot: string, options?: {
    minConfidence?: number;
    maxProbes?: number;
}): Promise<DiscoveryResult>;
