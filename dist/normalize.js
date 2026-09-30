export const NORMALIZER_VERSION = 1;
export function normalize(text) {
    let result = text;
    // 1. UUIDs
    result = result.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>');
    // 2. ISO 8601 full datetimes
    result = result.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g, '<TIMESTAMP>');
    // 3. Temp paths
    result = result.replace(/\/tmp\/[a-zA-Z0-9_\-\.]+/g, '/tmp/<TEMP>');
    // 4. Memory addresses
    result = result.replace(/\b0x[0-9a-fA-F]{6,16}\b/g, '<ADDRESS>');
    // 5. Home directory paths
    result = result.replace(/\/home\/[^\/\s]+/g, '/home/<USER>');
    // 6. Windows user paths
    result = result.replace(/C:\\Users\\[^\\\s]+/g, 'C:\\Users\\<USER>');
    // 7. PIDs in these exact formats only
    result = result.replace(/\bpid[=: ]\d+\b/gi, 'pid=<PID>');
    return result;
}
export function areEquivalent(base, head) {
    return normalize(base) === normalize(head);
}
