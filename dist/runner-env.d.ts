export declare function runnerPath(): string;
/**
 * Build an env object with runner PATH applied.
 * On Windows, avoid duplicate Path/PATH keys — Node keeps only the
 * lexicographically first case-insensitive match when spawning, which
 * can drop PATH updates and break console-script discovery.
 */
export declare function withRunnerPath(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
