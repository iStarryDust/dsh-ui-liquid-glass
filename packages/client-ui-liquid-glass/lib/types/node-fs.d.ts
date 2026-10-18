/**
 * The plugin's single node-face boundary. This package type-checks on the
 * client face (DOM libs, no @types/node), so every Node built-in access is
 * wrapped here behind hand-typed signatures — the host loader runs this file
 * under real Node, where the suppressed imports resolve.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
export { copyFileSync, existsSync, mkdirSync, readFileSync };
/** One directory entry as the listing needs it. */
export interface DirEntry {
    isFile(): boolean;
    name: string;
}
export declare function readDirectory(dir: string): DirEntry[];
export declare function homeDirectory(): string;
/**
 * The DSH home override, when the environment actually names one.
 *
 * An EMPTY `DSH_HOME` counts as absent, deliberately: `env.DSH_HOME` is a
 * non-empty string or undefined under the CLI, but a shell that exports it
 * empty (`DSH_HOME= …`, some CI wrappers) used to hand this function `''`, and
 * `''` is not undefined — so the caller's `?? fallback` never fired and the
 * plugin's data directory became RELATIVE (`ui-liquid-glass/wallpapers`), i.e.
 * wherever the process happened to be started from. Same machine, different
 * working directory, different wallpaper folder.
 */
export declare function dshHomeOverride(): string | undefined;
export declare function joinPath(...parts: string[]): string;
export declare function resolvePath(path: string): string;
export declare function baseName(path: string): string;
export declare function pathFromUrl(url: string): string;
export declare function isFile(path: string): boolean;
/** Write a file wholesale (the wallpaper upload path). */
export declare function writeFile(path: string, data: Uint8Array): void;
/** Remove a file; errors surface to the caller. */
export declare function rmFile(path: string): void;
/** Concatenate uploaded chunks into one body (the Buffer lives behind this boundary). */
export declare function concatChunks(chunks: Uint8Array[]): Uint8Array;
//# sourceMappingURL=node-fs.d.ts.map