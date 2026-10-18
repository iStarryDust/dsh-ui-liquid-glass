/**
 * The plugin's single node-face boundary. This package type-checks on the
 * client face (DOM libs, no @types/node), so every Node built-in access is
 * wrapped here behind hand-typed signatures — the host loader runs this file
 * under real Node, where the suppressed imports resolve.
 */
// @ts-expect-error — node built-ins have no type definitions on this face.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
// @ts-expect-error — see above.
import { homedir } from 'node:os';
// @ts-expect-error — see above.
import { basename, join, resolve } from 'node:path';
// @ts-expect-error — see above.
import { fileURLToPath } from 'node:url';
export { copyFileSync, existsSync, mkdirSync, readFileSync };
export function readDirectory(dir) {
    return readdirSync(dir, { withFileTypes: true });
}
export function homeDirectory() {
    return homedir();
}
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
export function dshHomeOverride() {
    const env = process.env;
    const value = env.DSH_HOME?.trim();
    return value === undefined || value === '' ? undefined : value;
}
export function joinPath(...parts) {
    return join(...parts);
}
export function resolvePath(path) {
    return resolve(path);
}
export function baseName(path) {
    return basename(path);
}
export function pathFromUrl(url) {
    return fileURLToPath(url);
}
export function isFile(path) {
    try {
        return statSync(path).isFile();
    }
    catch {
        return false;
    }
}
/** Write a file wholesale (the wallpaper upload path). */
export function writeFile(path, data) {
    writeFileSync(path, data);
}
/** Remove a file; errors surface to the caller. */
export function rmFile(path) {
    rmSync(path);
}
/** Concatenate uploaded chunks into one body (the Buffer lives behind this boundary). */
export function concatChunks(chunks) {
    // @ts-expect-error — Buffer lives behind this boundary.
    return Buffer.concat(chunks);
}
//# sourceMappingURL=node-fs.js.map