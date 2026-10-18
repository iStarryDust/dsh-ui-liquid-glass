import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
//#region lib/types/node-fs.js
/**
* The plugin's single node-face boundary. This package type-checks on the
* client face (DOM libs, no @types/node), so every Node built-in access is
* wrapped here behind hand-typed signatures — the host loader runs this file
* under real Node, where the suppressed imports resolve.
*/
function readDirectory(dir) {
	return readdirSync(dir, { withFileTypes: true });
}
function homeDirectory() {
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
function dshHomeOverride() {
	const value = process.env.DSH_HOME?.trim();
	return value === void 0 || value === "" ? void 0 : value;
}
function joinPath(...parts) {
	return join(...parts);
}
function resolvePath(path) {
	return resolve(path);
}
function baseName(path) {
	return basename(path);
}
function pathFromUrl(url) {
	return fileURLToPath(url);
}
function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}
/** Write a file wholesale (the wallpaper upload path). */
function writeFile(path, data) {
	writeFileSync(path, data);
}
/** Remove a file; errors surface to the caller. */
function rmFile(path) {
	rmSync(path);
}
/** Concatenate uploaded chunks into one body (the Buffer lives behind this boundary). */
function concatChunks(chunks) {
	return Buffer.concat(chunks);
}
//#endregion
//#region lib/types/index.js
/**
* Liquid-glass skin, node half. Owns the plugin's data directory under the
* Harness home — `<home>/ui-liquid-glass/wallpapers` — and serves it to the
* browser half over the host web server:
*
* - `GET /ui-liquid-glass/wallpapers` → JSON list of the image files present;
* - `GET /ui-liquid-glass/wallpapers/<file name>` → the image bytes;
* - `POST /ui-liquid-glass/wallpapers/<file name>` (body = image bytes) → add;
* - `DELETE /ui-liquid-glass/wallpapers/<file name>` → remove.
*
* First activation seeds the directory with the shipped wallpapers (never
* overwriting), so user wallpapers survive plugin reinstalls and upgrades.
* Hosts without a web server (the desktop shell) never settle the route; the
* client detects the missing endpoint and hides the picker's add/delete.
*/
/** The plugin's data directory under the Harness home. */
const PLUGIN_DIR_NAME = "ui-liquid-glass";
/** The wallpapers folder inside it: the one place wallpapers live on disk. */
const WALLPAPER_DIR_NAME = "wallpapers";
/** Sub-folder of the wallpaper directory holding the shipped time-rotation set. */
const DEFAULT_SUBDIR = "Default";
/**
* Shipped wallpapers, seeded into the data directory on first activation. The
* folder mirrors the runtime layout — see `seedDefaults` — so adding a wallpaper
* to the plugin is dropping a file in the right level here, nothing else.
*
* Resolved from THIS module's URL, so the folder has to travel with the build
* output: `assets/wallpapers` must sit beside `lib/` inside the installed
* package (`files` in package.json + the build's deploy step carry it). A
* missing folder used to fail SILENTLY — a fresh environment simply had no
* default wallpapers and nothing said why — so it now warns once, and the
* second candidate covers a layout that puts the assets next to `lib/`.
*/
function resolveShippedDefaults() {
	const candidates = [new URL("../assets/wallpapers", import.meta.url), new URL("./assets/wallpapers", import.meta.url)];
	for (const candidate of candidates) {
		const dir = pathFromUrl(candidate.href);
		if (existsSync(dir)) return dir;
	}
	console.warn("[ui-liquid-glass] 随包壁纸目录缺失（assets/wallpapers）：默认壁纸不会播种。 打包/部署时请把 assets/ 与 lib/ 一起带上（package.json 的 files 与构建的 deploy 步骤）。");
	return pathFromUrl(candidates[0].href);
}
const SHIPPED_DEFAULTS_DIR = resolveShippedDefaults();
/** The web-server route prefix for this plugin's wallpaper files. */
const WALLPAPER_ROUTE = "/ui-liquid-glass/wallpapers";
/** The web-server route prefix for the bundled UI fonts. Unlike wallpapers
*  these are NOT seeded into the data directory — they ship with the package
*  (`assets/fonts`, carried by `files` and the build's sync) and are served
*  straight from it, read-only. Uninstalling the plugin removes them. */
const FONT_ROUTE = "/ui-liquid-glass/fonts";
/** Resolve the bundled font folder next to the build output (same candidate
*  logic as `resolveShippedDefaults`: the assets folder must travel with lib/). */
function resolveBundledFonts() {
	const candidates = [new URL("../assets/fonts", import.meta.url), new URL("./assets/fonts", import.meta.url)];
	for (const candidate of candidates) {
		const dir = pathFromUrl(candidate.href);
		if (existsSync(dir)) return dir;
	}
	console.warn("[ui-liquid-glass] 随包字体目录缺失（assets/fonts）：HarmonyOS Sans 不可用。");
	return pathFromUrl(candidates[0].href);
}
const BUNDLED_FONTS_DIR = resolveBundledFonts();
const FONT_MIME = {
	".ttf": "font/ttf",
	".otf": "font/otf",
	".woff2": "font/woff2"
};
/** Serve one bundled font file by name. Read-only GET; names are the build's
*  own (ASCII, whitelisted extensions), but the same traversal guards apply. */
function serveFont(name, res) {
	const safe = baseName(name);
	if (safe === "" || safe !== name || safe.startsWith(".") || safe.includes("\\") || !/\.(ttf|otf|woff2)$/i.test(safe)) {
		notFound(res);
		return;
	}
	const file = resolvePath(joinPath(BUNDLED_FONTS_DIR, safe));
	if (!isFile(file)) {
		notFound(res);
		return;
	}
	const type = FONT_MIME[file.slice(file.lastIndexOf(".")).toLowerCase()];
	if (type === void 0) {
		notFound(res);
		return;
	}
	res.writeHead(200, {
		"content-type": type,
		"cache-control": "public, max-age=604800"
	});
	try {
		res.end(new Uint8Array(readFileSync(file)));
	} catch {
		res.end(new Uint8Array(0));
	}
}
/** `<home>/ui-liquid-glass/wallpapers`, honoring DSH_HOME like the CLI does. */
function wallpaperDirectory() {
	return joinPath(dshHomeOverride() ?? joinPath(homeDirectory(), ".dsh"), PLUGIN_DIR_NAME, WALLPAPER_DIR_NAME);
}
/** `<home>/ui-liquid-glass/wallpapers/Default` — the shipped time-rotation set. */
function defaultDirectory() {
	return joinPath(wallpaperDirectory(), DEFAULT_SUBDIR);
}
/**
* Resolve a client-side wallpaper id to a file on disk. An id is either a bare
* file name in the wallpaper root (user uploads) or `Default/<name>` (the
* shipped set). Anything else — traversal, dot files, deeper nesting, foreign
* sub-folders — is rejected (null).
*/
function resolveWallpaperFile(id) {
	if (id === "" || id.startsWith(".")) return null;
	const segments = id.split("/");
	if (segments.length === 1) {
		const name = baseName(id);
		if (name !== id || name.startsWith(".")) return null;
		return resolvePath(joinPath(wallpaperDirectory(), name));
	}
	if (segments.length === 2 && segments[0] === DEFAULT_SUBDIR) {
		const name = baseName(segments[1]);
		if (name !== segments[1] || name.startsWith(".")) return null;
		return resolvePath(joinPath(defaultDirectory(), name));
	}
	return null;
}
/** Image file names directly inside one directory. */
function listImageFiles(dir) {
	if (!existsSync(dir)) return [];
	try {
		return readDirectory(dir).filter((entry) => entry.isFile() && !entry.name.startsWith(".") && /\.(png|jpe?g|webp|gif|bmp)$/i.test(entry.name)).map((entry) => entry.name).sort((a, b) => a < b ? -1 : 1);
	} catch {
		return [];
	}
}
/** The wallpaper listing: user uploads (root) and the shipped Default set. */
function listWallpapers() {
	return {
		user: listImageFiles(wallpaperDirectory()),
		default: listImageFiles(defaultDirectory()).map((name) => `${DEFAULT_SUBDIR}/${name}`)
	};
}
/**
* Seed the shipped wallpapers into the data directory. The shipped folder
* mirrors the runtime layout, and each level means the same thing in both:
*
* - image files DIRECTLY in `assets/wallpapers/` land in the wallpaper ROOT —
*   the folder the picker's own ＋ writes to, so a bundled extra shows up as an
*   ordinary wallpaper: selectable, and deletable with the tile's ✕;
* - images in `assets/wallpapers/Default/` land in the `Default/` sub-folder,
*   the plugin-managed time-rotation set.
*
* Only MISSING files are copied, so an upgrade never overwrites what the user
* already has. `Default/` is the plugin's own folder and is pruned to the
* shipped set; the ROOT is the user's folder and is never pruned — only its
* legacy copy of a rotation name is migrated into `Default/` (the .7 seed put
* the whole set there).
*/
function seedDefaults() {
	const isImage = (name) => /\.(png|jpe?g|webp)$/i.test(name);
	let rootShipped;
	try {
		rootShipped = readDirectory(SHIPPED_DEFAULTS_DIR).filter((entry) => entry.isFile() && isImage(entry.name));
	} catch {
		return;
	}
	let defaultShipped = [];
	try {
		defaultShipped = readDirectory(joinPath(SHIPPED_DEFAULTS_DIR, DEFAULT_SUBDIR)).filter((entry) => entry.isFile() && isImage(entry.name));
	} catch {}
	mkdirSync(wallpaperDirectory(), { recursive: true });
	mkdirSync(defaultDirectory(), { recursive: true });
	for (const entry of rootShipped) {
		const target = joinPath(wallpaperDirectory(), entry.name);
		if (existsSync(target)) continue;
		try {
			copyFileSync(joinPath(SHIPPED_DEFAULTS_DIR, entry.name), target);
		} catch {}
	}
	for (const entry of defaultShipped) {
		const target = joinPath(defaultDirectory(), entry.name);
		if (existsSync(target)) continue;
		const legacy = joinPath(wallpaperDirectory(), entry.name);
		try {
			if (existsSync(legacy)) {
				copyFileSync(legacy, target);
				rmFile(legacy);
			} else copyFileSync(joinPath(SHIPPED_DEFAULTS_DIR, DEFAULT_SUBDIR, entry.name), target);
		} catch {}
	}
	let present;
	try {
		present = readDirectory(defaultDirectory());
	} catch {
		return;
	}
	for (const entry of present) {
		if (!isImage(entry.name)) continue;
		if (defaultShipped.some((seeded) => seeded.name === entry.name)) continue;
		try {
			rmFile(joinPath(defaultDirectory(), entry.name));
		} catch {}
	}
}
const MIME_BY_EXTENSION = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".bmp": "image/bmp"
};
function notFound(res) {
	res.writeHead(404);
	res.end("not found");
}
function safeName(raw) {
	const name = baseName(raw);
	if (name === "" || name !== raw || name.startsWith(".") || name.includes("\\")) return null;
	if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) return null;
	return name;
}
function serveList(res) {
	res.writeHead(200, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(listWallpapers()));
}
function serveFile(id, res) {
	const file = resolveWallpaperFile(id);
	if (file === null || !isFile(file)) {
		notFound(res);
		return;
	}
	const type = MIME_BY_EXTENSION[file.slice(file.lastIndexOf(".")).toLowerCase()];
	if (type === void 0) {
		notFound(res);
		return;
	}
	res.writeHead(200, {
		"content-type": type,
		"cache-control": "no-store"
	});
	try {
		res.end(new Uint8Array(readFileSync(file)));
	} catch {
		res.end(new Uint8Array(0));
	}
}
/** Upload: stream the request body into `<dir>/<name>` (user uploads live in
*  the wallpaper root; the Default set is plugin-managed). 32 MB cap. */
function serveUpload(name, req, res) {
	const safe = safeName(name);
	if (safe === null) {
		res.writeHead(400);
		res.end("bad name");
		return;
	}
	const chunks = [];
	let size = 0;
	let rejected = false;
	req.on?.("data", (chunk) => {
		if (rejected) return;
		size += chunk.length;
		if (size > 32 * 1024 * 1024) {
			rejected = true;
			chunks.length = 0;
			res.writeHead(413);
			res.end("too large");
			return;
		}
		chunks.push(chunk);
	});
	req.on?.("end", () => {
		if (rejected) return;
		try {
			writeFile(joinPath(wallpaperDirectory(), safe), concatChunks(chunks));
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store"
			});
			res.end(JSON.stringify(listWallpapers()));
		} catch {
			res.writeHead(500);
			res.end("write failed");
		}
	});
}
/** Delete: remove `<dir>/<name>` (any wallpaper may go; the time mode falls back). */
function serveDelete(name, res) {
	const safe = safeName(name);
	if (safe === null) {
		res.writeHead(400);
		res.end("bad name");
		return;
	}
	try {
		rmFile(joinPath(wallpaperDirectory(), safe));
		serveList(res);
	} catch {
		notFound(res);
	}
}
/** Host plugin body: data directory + wallpaper route (dark on desktop). */
function apply(ctx) {
	mkdirSync(wallpaperDirectory(), { recursive: true });
	seedDefaults();
	let unregister;
	let unregisterFonts;
	let settled = false;
	const tryRegister = () => {
		if (settled) return;
		const webServer = ctx.reflect?.get("webServer", false);
		if (webServer === void 0 || typeof webServer.register !== "function") return;
		settled = true;
		clearInterval(timer);
		try {
			unregister = webServer.register({
				kind: "prefix",
				path: WALLPAPER_ROUTE,
				handler: (req, res) => {
					const method = req.method ?? "GET";
					const rest = (req.url ?? "").slice(27).split("?")[0] ?? "";
					if (rest === "" || rest === "/") {
						if (method === "GET") serveList(res);
						else {
							res.writeHead(405, { allow: "GET" });
							res.end("method not allowed");
						}
						return;
					}
					let name;
					try {
						name = decodeURIComponent(rest.slice(1));
					} catch {
						notFound(res);
						return;
					}
					if (method === "GET") serveFile(name, res);
					else if (method === "POST") serveUpload(name, req, res);
					else if (method === "DELETE") serveDelete(name, res);
					else {
						res.writeHead(405, { allow: "GET, POST, DELETE" });
						res.end("method not allowed");
					}
				}
			});
		} catch {
			settled = false;
		}
		if (settled) try {
			unregisterFonts = webServer.register({
				kind: "prefix",
				path: FONT_ROUTE,
				handler: (req, res) => {
					const method = req.method ?? "GET";
					const rest = (req.url ?? "").slice(22).split("?")[0] ?? "";
					if (method !== "GET") {
						res.writeHead(405, { allow: "GET" });
						res.end("method not allowed");
						return;
					}
					let name;
					try {
						name = decodeURIComponent(rest.slice(1));
					} catch {
						notFound(res);
						return;
					}
					serveFont(name, res);
				}
			});
		} catch {
			unregisterFonts = void 0;
		}
	};
	const timer = setInterval(tryRegister, 1e3);
	tryRegister();
	return () => {
		clearInterval(timer);
		unregister?.();
		unregisterFonts?.();
	};
}
//#endregion
export { FONT_ROUTE, WALLPAPER_ROUTE, apply, wallpaperDirectory };
