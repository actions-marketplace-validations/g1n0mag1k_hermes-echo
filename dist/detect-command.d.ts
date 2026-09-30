/**
 * Parse the first console_scripts entry from setup.py content.
 * Handles forms like:
 *   entry_points={'console_scripts': ['myapp=pkg:main']}
 *   entry_points={"console_scripts": ["myapp = pkg:main"]}
 */
export declare function parseSetupPyConsoleScript(content: string): string | null;
/**
 * Parse the first script from pyproject.toml [project.scripts] or
 * [tool.poetry.scripts] tables.
 */
export declare function parsePyprojectConsoleScript(content: string): string | null;
export declare const NO_COMMAND_ERROR = "No command specified and no console_scripts found in setup.py or pyproject.toml. Add 'command: myapp' to your workflow.";
/**
 * Detect the first console script name from setup.py or pyproject.toml
 * in the repository root. Prefer setup.py when both exist.
 */
export declare function detectCommand(repoRoot: string): Promise<string | null>;
/**
 * Resolve the CLI command: explicit input wins; otherwise auto-detect.
 * Throws NO_COMMAND_ERROR when neither is available.
 */
export declare function resolveCommandInput(repoRoot: string, explicit: string | undefined | null): Promise<{
    command: string;
    discovered: boolean;
}>;
