import type { EchoObservation, EchoProbe } from './types.js';
export declare const DAEMON_KEYWORDS: string[];
export declare function executeProbe(probe: EchoProbe, options?: {
    timeoutMs?: number;
    commit?: string;
}): Promise<EchoObservation>;
