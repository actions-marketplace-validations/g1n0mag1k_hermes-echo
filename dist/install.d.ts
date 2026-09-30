export interface InstallResult {
    success: boolean;
    strategy?: string;
    error?: string;
    durationMs: number;
}
export declare function installProject(repoRoot: string): Promise<InstallResult>;
