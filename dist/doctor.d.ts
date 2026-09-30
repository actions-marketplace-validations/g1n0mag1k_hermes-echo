export interface DoctorCheck {
    name: string;
    passed: boolean;
    detail: string;
    fix?: string;
}
export interface DoctorReport {
    checks: DoctorCheck[];
    ready: boolean;
    probeCount: number;
    qualifyingProbeCount: number;
    estimatedRuntimeSeconds: number;
}
export declare function runDoctor(command: string, repoRoot: string): Promise<DoctorReport>;
export declare function formatDoctorReport(report: DoctorReport): string;
