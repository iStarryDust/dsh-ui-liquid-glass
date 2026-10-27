window.__ModuleLoader__.load({
	id: "@istarry/dsh-ui-liquid-glass",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/liquid-glass.ts
		/** The original demo's look: clear tint, no blur, and the demo's 0.15 edge
		*  offset expressed as the px width that offset covers on the demo's capsule. */
		const LIQUID_GLASS_DEFAULTS = {
			width: 300,
			height: 200,
			radius: 150,
			density: 0,
			glassBlur: 0,
			contrast: 1,
			brightness: 1.05,
			saturation: 1.1,
			edgeSoftness: 30,
			refraction: 1,
			tintHue: 220,
			tintSaturation: 0,
			rimStrength: 1,
			borderWidth: 0,
			borderOpacity: .85,
			grain: 0
		};
		/** The capsule's rim shading at one strength: the demo's shadow with its two
		*  alphas scaled (1 = the original, 0 = none). Shared with the skin engine,
		*  which publishes the same string per layer. */
		function rimShadowCss(strength) {
			const s = Math.max(0, strength);
			return `0 4px 8px rgba(0, 0, 0, ${(.25 * s).toFixed(3)}), 0 -10px 25px inset rgba(0, 0, 0, ${(.15 * s).toFixed(3)})`;
		}
		/** The capsule tint colour: the original's frosted white at saturation 0; the
		*  lightness derives from the saturation (same curve as the layers' builder —
		*  at full lightness every hue is white and the hue knob would do nothing). */
		function tintCss(density, hue, saturation) {
			const lightness = 100 - Math.max(0, Math.min(1, saturation)) * 50;
			return `hsla(${hue}, ${(saturation * 100).toFixed(1)}%, ${lightness.toFixed(1)}%, ${(density * .5).toFixed(3)})`;
		}
		/** The decorative ring at one width/opacity, as an INSET box-shadow segment
		*  ('' when the width is 0) — it composes onto the rim string, paints inside
		*  the sheet (never clipped by the viewport or a neighbouring column), and
		*  never affects layout. */
		function ringShadowCss(width, opacity) {
			return width > 0 ? `, inset 0 0 0 ${width}px rgba(255, 255, 255, ${opacity.toFixed(3)})` : "";
		}
		/** The grain colour matrix for one intensity (0..1): mid-grey noise whose alpha
		*  the intensity scales — 0 is an exact identity stage. */
		function grainMatrixValues(intensity) {
			return `0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 ${(Math.max(0, intensity) * .5).toFixed(3)} 0`;
		}
		/**
		* Append the de-banding dither stage after `lastResultName`: per-pixel noise
		* added to the filter output. An 8-bit backdrop pushed through contrast and
		* brightness levels without dithering shows the wallpaper gradient's
		* quantization as hard bands (curved ones once displaced); a dither amplitude
		* of ±3/255 breaks the band edges while staying invisible as noise — smaller
		* amplitudes are swallowed whole by the 8-bit raster (measured: ±1 and ±2
		* change not a single pixel). Every glass filter — the capsule's and every
		* layer's — ends with this stage, closed by an alpha mask that keeps the
		* backdrop's own transparency.
		*/
		function appendDitherStage(ns, filter, lastResultName) {
			const turbulence = document.createElementNS(ns, "feTurbulence");
			turbulence.setAttribute("result", "dither-noise");
			turbulence.setAttribute("type", "fractalNoise");
			turbulence.setAttribute("baseFrequency", "1");
			turbulence.setAttribute("numOctaves", "1");
			turbulence.setAttribute("seed", "31");
			turbulence.setAttribute("stitchTiles", "stitch");
			const AMPLITUDE = (6 / 255).toFixed(5);
			const matrix = document.createElementNS(ns, "feColorMatrix");
			matrix.setAttribute("in", "dither-noise");
			matrix.setAttribute("result", "dither");
			matrix.setAttribute("type", "matrix");
			matrix.setAttribute("values", `${AMPLITUDE} 0 0 0 -${(1 / 255).toFixed(5)} 0 ${AMPLITUDE} 0 0 -${(1 / 255).toFixed(5)} 0 0 ${AMPLITUDE} 0 -${(1 / 255).toFixed(5)} 0 0 0 0 1`);
			const mix = document.createElementNS(ns, "feComposite");
			mix.setAttribute("in", lastResultName);
			mix.setAttribute("in2", "dither");
			mix.setAttribute("operator", "arithmetic");
			mix.setAttribute("result", "dithered");
			mix.setAttribute("k1", "0");
			mix.setAttribute("k2", "1");
			mix.setAttribute("k3", "1");
			mix.setAttribute("k4", "0");
			const keepAlpha = document.createElementNS(ns, "feComposite");
			keepAlpha.setAttribute("in", "dithered");
			keepAlpha.setAttribute("in2", "SourceGraphic");
			keepAlpha.setAttribute("operator", "in");
			filter.appendChild(turbulence);
			filter.appendChild(matrix);
			filter.appendChild(mix);
			filter.appendChild(keepAlpha);
		}
		/** Utility functions — verbatim from the original; shared with the layer refraction filters. */
		function smoothStep(a, b, t) {
			t = Math.max(0, Math.min(1, (t - a) / (b - a)));
			return t * t * (3 - 2 * t);
		}
		function length(x, y) {
			return Math.sqrt(x * x + y * y);
		}
		function roundedRectSDF(x, y, width, height, radius) {
			const qx = Math.abs(x) - width + radius;
			const qy = Math.abs(y) - height + radius;
			return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius;
		}
		function texture(x, y) {
			return {
				type: "t",
				x,
				y
			};
		}
		function generateId() {
			return "liquid-glass-" + Math.random().toString(36).slice(2, 11);
		}
		/**
		* The draggable glass capsule. The class body mirrors the original `Shader`:
		* same element tree, same inline cssText, same event wiring and constrain
		* math; parameters replace the literals the demo baked in.
		*/
		var LiquidGlass = class {
			id = generateId();
			/** Viewport boundary offset while dragging. */
			offset = 10;
			/** Displacement-map supersampling; the original ships 1. */
			canvasDPI = 1;
			params;
			container;
			svg;
			canvas;
			context;
			feImage;
			feDisplacementMap;
			grainMatrix;
			fragment;
			teardown = [];
			constructor(params = {}) {
				this.params = {
					...LIQUID_GLASS_DEFAULTS,
					...params
				};
				this.fragment = (uv) => {
					const ix = uv.x - .5;
					const iy = uv.y - .5;
					const scaled = smoothStep(0, 1, smoothStep(.8, 0, roundedRectSDF(ix, iy, .3, .2, .6) - this.params.edgeSoftness / this.params.height)) * this.params.refraction;
					return texture(ix * scaled + .5, iy * scaled + .5);
				};
				this.createElement();
				this.setupEventListeners();
				this.updateShader();
			}
			createElement() {
				const { width, height, radius, density, glassBlur, contrast, brightness, saturation, tintHue, tintSaturation, rimStrength, borderWidth, borderOpacity } = this.params;
				this.container = document.createElement("div");
				this.container.dataset.liquidGlass = "";
				this.container.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        border-radius: ${radius}px;
        background: ${tintCss(density, tintHue, tintSaturation)};
        box-shadow: ${rimShadowCss(rimStrength)}${ringShadowCss(borderWidth, borderOpacity)};
        cursor: grab;
        backdrop-filter: url(#${this.id}_filter) blur(${glassBlur}px) contrast(${contrast}) brightness(${brightness}) saturate(${saturation});
        z-index: 9999;
        pointer-events: auto;
      `;
				this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
				this.svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
				this.svg.setAttribute("width", "0");
				this.svg.setAttribute("height", "0");
				this.svg.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        pointer-events: none;
        z-index: 9998;
      `;
				const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
				const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
				filter.setAttribute("id", `${this.id}_filter`);
				filter.setAttribute("filterUnits", "userSpaceOnUse");
				filter.setAttribute("colorInterpolationFilters", "sRGB");
				filter.setAttribute("x", "0");
				filter.setAttribute("y", "0");
				filter.setAttribute("width", this.params.width.toString());
				filter.setAttribute("height", this.params.height.toString());
				this.feImage = document.createElementNS("http://www.w3.org/2000/svg", "feImage");
				this.feImage.setAttribute("id", `${this.id}_map`);
				this.feImage.setAttribute("width", this.params.width.toString());
				this.feImage.setAttribute("height", this.params.height.toString());
				this.feDisplacementMap = document.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
				this.feDisplacementMap.setAttribute("in", "SourceGraphic");
				this.feDisplacementMap.setAttribute("in2", `${this.id}_map`);
				this.feDisplacementMap.setAttribute("result", "displaced");
				this.feDisplacementMap.setAttribute("xChannelSelector", "R");
				this.feDisplacementMap.setAttribute("yChannelSelector", "G");
				const turbulence = document.createElementNS("http://www.w3.org/2000/svg", "feTurbulence");
				turbulence.setAttribute("result", "grain-noise");
				turbulence.setAttribute("type", "fractalNoise");
				turbulence.setAttribute("baseFrequency", "0.9");
				turbulence.setAttribute("numOctaves", "2");
				turbulence.setAttribute("seed", "7");
				turbulence.setAttribute("stitchTiles", "stitch");
				this.grainMatrix = document.createElementNS("http://www.w3.org/2000/svg", "feColorMatrix");
				this.grainMatrix.setAttribute("in", "grain-noise");
				this.grainMatrix.setAttribute("result", "grain");
				this.grainMatrix.setAttribute("type", "matrix");
				this.grainMatrix.setAttribute("values", grainMatrixValues(this.params.grain));
				const grainMix = document.createElementNS("http://www.w3.org/2000/svg", "feComposite");
				grainMix.setAttribute("in", "displaced");
				grainMix.setAttribute("in2", "grain");
				grainMix.setAttribute("result", "grain-mixed");
				grainMix.setAttribute("operator", "arithmetic");
				grainMix.setAttribute("k1", "0");
				grainMix.setAttribute("k2", "1");
				grainMix.setAttribute("k3", "0.5");
				grainMix.setAttribute("k4", "0");
				filter.appendChild(this.feImage);
				filter.appendChild(this.feDisplacementMap);
				filter.appendChild(turbulence);
				filter.appendChild(this.grainMatrix);
				filter.appendChild(grainMix);
				appendDitherStage("http://www.w3.org/2000/svg", filter, "grain-mixed");
				defs.appendChild(filter);
				this.svg.appendChild(defs);
				this.canvas = document.createElement("canvas");
				this.canvas.width = this.params.width * this.canvasDPI;
				this.canvas.height = this.params.height * this.canvasDPI;
				this.canvas.style.display = "none";
				this.context = this.canvas.getContext("2d");
			}
			constrainPosition(x, y) {
				const viewportWidth = window.innerWidth;
				const viewportHeight = window.innerHeight;
				const minX = this.offset;
				const maxX = viewportWidth - this.params.width - this.offset;
				const minY = this.offset;
				const maxY = viewportHeight - this.params.height - this.offset;
				return {
					x: Math.max(minX, Math.min(maxX, x)),
					y: Math.max(minY, Math.min(maxY, y))
				};
			}
			setupEventListeners() {
				let isDragging = false;
				let startX, startY, initialX, initialY;
				const containerMouseDown = (e) => {
					isDragging = true;
					this.container.style.cursor = "grabbing";
					startX = e.clientX;
					startY = e.clientY;
					const rect = this.container.getBoundingClientRect();
					initialX = rect.left;
					initialY = rect.top;
					e.preventDefault();
				};
				this.container.addEventListener("mousedown", containerMouseDown);
				this.teardown.push(() => {
					this.container.removeEventListener("mousedown", containerMouseDown);
				});
				const documentMouseMove = (e) => {
					if (isDragging) {
						const deltaX = e.clientX - startX;
						const deltaY = e.clientY - startY;
						const newX = initialX + deltaX;
						const newY = initialY + deltaY;
						const constrained = this.constrainPosition(newX, newY);
						this.container.style.left = constrained.x + "px";
						this.container.style.top = constrained.y + "px";
						this.container.style.transform = "none";
					}
				};
				document.addEventListener("mousemove", documentMouseMove);
				this.teardown.push(() => {
					document.removeEventListener("mousemove", documentMouseMove);
				});
				const documentMouseUp = () => {
					isDragging = false;
					this.container.style.cursor = "grab";
				};
				document.addEventListener("mouseup", documentMouseUp);
				this.teardown.push(() => {
					document.removeEventListener("mouseup", documentMouseUp);
				});
				const windowResize = () => {
					if (this.container.style.display === "none") return;
					const rect = this.container.getBoundingClientRect();
					const constrained = this.constrainPosition(rect.left, rect.top);
					if (rect.left !== constrained.x || rect.top !== constrained.y) {
						this.container.style.left = constrained.x + "px";
						this.container.style.top = constrained.y + "px";
						this.container.style.transform = "none";
					}
				};
				window.addEventListener("resize", windowResize);
				this.teardown.push(() => {
					window.removeEventListener("resize", windowResize);
				});
			}
			/** Recompute the displacement map from the current fragment parameters. */
			updateShader() {
				const w = this.params.width * this.canvasDPI;
				const h = this.params.height * this.canvasDPI;
				const data = new Uint8ClampedArray(w * h * 4);
				let maxScale = 0;
				const rawValues = [];
				for (let i = 0; i < data.length; i += 4) {
					const x = i / 4 % w;
					const y = Math.floor(i / 4 / w);
					const pos = this.fragment({
						x: x / w,
						y: y / h
					});
					const dx = pos.x * w - x;
					const dy = pos.y * h - y;
					maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
					rawValues.push(dx, dy);
				}
				maxScale *= .5;
				let index = 0;
				for (let i = 0; i < data.length; i += 4) {
					const dx = rawValues[index];
					const dy = rawValues[index + 1];
					index += 2;
					const r = dx / maxScale + .5;
					const g = dy / maxScale + .5;
					data[i] = r * 255;
					data[i + 1] = g * 255;
					data[i + 2] = 0;
					data[i + 3] = 255;
				}
				this.context.putImageData(new ImageData(data, w, h), 0, 0);
				this.feImage.setAttributeNS("http://www.w3.org/1999/xlink", "href", this.canvas.toDataURL());
				this.feDisplacementMap.setAttribute("scale", (maxScale / this.canvasDPI).toString());
			}
			/** Mount the filter SVG and the capsule under `parent` (the original's appendTo). */
			appendTo(parent) {
				parent.appendChild(this.svg);
				parent.appendChild(this.container);
			}
			/** Apply changed surface/shader values; only the touched pipeline stages re-run. */
			updateParams(next) {
				const before = this.params;
				const sizeChanged = next.width !== void 0 && next.width !== before.width || next.height !== void 0 && next.height !== before.height;
				const radiusChanged = next.radius !== void 0 && next.radius !== before.radius;
				const densityChanged = next.density !== void 0 && next.density !== before.density;
				const filterChanged = next.glassBlur !== void 0 && next.glassBlur !== before.glassBlur || next.contrast !== void 0 && next.contrast !== before.contrast || next.brightness !== void 0 && next.brightness !== before.brightness || next.saturation !== void 0 && next.saturation !== before.saturation;
				const fragmentChanged = next.edgeSoftness !== void 0 && next.edgeSoftness !== before.edgeSoftness || next.refraction !== void 0 && next.refraction !== before.refraction;
				const tintChanged = next.tintHue !== void 0 && next.tintHue !== before.tintHue || next.tintSaturation !== void 0 && next.tintSaturation !== before.tintSaturation;
				const rimChanged = next.rimStrength !== void 0 && next.rimStrength !== before.rimStrength;
				const borderChanged = next.borderWidth !== void 0 && next.borderWidth !== before.borderWidth || next.borderOpacity !== void 0 && next.borderOpacity !== before.borderOpacity;
				const grainChanged = next.grain !== void 0 && next.grain !== before.grain;
				if (!sizeChanged && !radiusChanged && !densityChanged && !filterChanged && !fragmentChanged && !tintChanged && !rimChanged && !borderChanged && !grainChanged) return;
				this.params = {
					...before,
					...next
				};
				if (sizeChanged) {
					this.container.style.width = `${this.params.width}px`;
					this.container.style.height = `${this.params.height}px`;
					this.canvas.width = this.params.width * this.canvasDPI;
					this.canvas.height = this.params.height * this.canvasDPI;
					this.svg.querySelector("filter")?.setAttribute("width", this.params.width.toString());
					this.svg.querySelector("filter")?.setAttribute("height", this.params.height.toString());
					this.feImage.setAttribute("width", this.params.width.toString());
					this.feImage.setAttribute("height", this.params.height.toString());
				}
				if (radiusChanged) this.container.style.borderRadius = `${this.params.radius}px`;
				if (densityChanged || tintChanged) this.container.style.background = tintCss(this.params.density, this.params.tintHue, this.params.tintSaturation);
				if (rimChanged || borderChanged) this.container.style.boxShadow = rimShadowCss(this.params.rimStrength) + ringShadowCss(this.params.borderWidth, this.params.borderOpacity);
				if (grainChanged) this.grainMatrix.setAttribute("values", grainMatrixValues(this.params.grain));
				if (filterChanged) {
					const { glassBlur, contrast, brightness, saturation } = this.params;
					this.container.style.backdropFilter = `url(#${this.id}_filter) blur(${glassBlur}px) contrast(${contrast}) brightness(${brightness}) saturate(${saturation})`;
				}
				if (sizeChanged || fragmentChanged) this.updateShader();
			}
			/** Show or hide the capsule (the filter SVG stays mounted either way).
			*
			*  Hiding is a real saving, not just an opacity trick: `display: none` takes
			*  the element out of the render tree, so its `backdrop-filter` (the two noise
			*  stages and the displacement) stops being evaluated at all — the capsule is
			*  the one glass element this skin paints for no UI purpose. Nothing else
			*  depends on it being on screen: every layer's field is measured against the
			*  capsule's NUMBERS (`setLensReference`), never its box, so the layers cannot
			*  tell the difference. */
			setVisible(visible) {
				this.container.style.display = visible ? "" : "none";
			}
			/** Whether the capsule is currently on screen (the panel's toggle reads it so
			*  its label starts truthful). */
			isVisible() {
				return this.container.style.display !== "none";
			}
			/** Remove every element and listener this instance owns. */
			destroy() {
				for (const dispose of this.teardown) dispose();
				this.teardown = [];
				this.svg.remove();
				this.container.remove();
				this.canvas.remove();
			}
		};
		//#endregion
		//#region src/client/knobs.ts
		/** The shared value formatters: one declaration for the whole registry, so a
		*  new knob reads like every other and the panel's own rows (the capsule tab,
		*  the 主题 rows) format identically. */
		const px = (value) => `${Math.round(value)}px`;
		const ratio = (value) => value.toFixed(2);
		const degrees = (value) => `${Math.round(value)}°`;
		/**
		* The shared 十四根 in the capsule's order (its two shape knobs excluded).
		* Every glass layer exposes exactly this set, in this order, with these ranges,
		* so one tab reads and is managed like every other.
		*/
		const KNOBS = {
			density: {
				key: "density",
				label: "浓度",
				min: 0,
				max: 1,
				step: .05,
				format: ratio
			},
			radius: {
				key: "radius",
				label: "圆角",
				min: 0,
				max: 280,
				step: 2,
				format: px
			},
			refraction: {
				key: "refraction",
				label: "折射强度",
				min: -3,
				max: 6,
				step: .05,
				format: ratio
			},
			edgeSoftness: {
				key: "edgeSoftness",
				label: "边缘柔边",
				min: 0,
				max: 100,
				step: 1,
				format: px
			},
			glassBlur: {
				key: "glassBlur",
				label: "模糊",
				min: 0,
				max: 40,
				step: 1,
				format: px
			},
			contrast: {
				key: "contrast",
				label: "对比度",
				min: .5,
				max: 2,
				step: .01,
				format: ratio
			},
			brightness: {
				key: "brightness",
				label: "亮度",
				min: .5,
				max: 1.6,
				step: .05,
				format: ratio
			},
			saturation: {
				key: "saturation",
				label: "饱和度",
				min: 0,
				max: 3,
				step: .05,
				format: ratio
			},
			tintHue: {
				key: "tintHue",
				label: "色调",
				min: 0,
				max: 360,
				step: 5,
				format: degrees
			},
			tintSaturation: {
				key: "tintSaturation",
				label: "色调饱和度",
				min: 0,
				max: 1,
				step: .05,
				format: ratio
			},
			rimStrength: {
				key: "rimStrength",
				label: "边缘立体",
				min: 0,
				max: 2,
				step: .05,
				format: ratio
			},
			borderWidth: {
				key: "borderWidth",
				label: "描边宽度",
				min: 0,
				max: 4,
				step: .5,
				format: px
			},
			borderOpacity: {
				key: "borderOpacity",
				label: "描边透明度",
				min: 0,
				max: 1,
				step: .05,
				format: ratio
			},
			grain: {
				key: "grain",
				label: "颗粒感",
				min: 0,
				max: 1,
				step: .05,
				format: ratio
			},
			flowStiffness: {
				key: "flowStiffness",
				label: "弹簧刚度",
				min: 40,
				max: 500,
				step: 10,
				format: (value) => `${Math.round(value)}`
			},
			flowDamping: {
				key: "flowDamping",
				label: "阻尼比",
				min: .55,
				max: 1.1,
				step: .01,
				format: ratio
			},
			flowStretch: {
				key: "flowStretch",
				label: "拉伸幅度",
				min: 0,
				max: .6,
				step: .01,
				format: ratio
			},
			flowDroplet: {
				key: "flowDroplet",
				label: "水滴尾巴",
				min: 0,
				max: 1,
				step: .05,
				format: ratio
			},
			hoverAlpha: {
				key: "hoverAlpha",
				label: "悬停浓度",
				min: 0,
				max: 1,
				step: .05,
				format: ratio
			}
		};
		/** The shared fourteen, in capsule order. */
		const GLASS_KNOBS = [
			"density",
			"radius",
			"refraction",
			"edgeSoftness",
			"glassBlur",
			"contrast",
			"brightness",
			"saturation",
			"tintHue",
			"tintSaturation",
			"rimStrength",
			"borderWidth",
			"borderOpacity",
			"grain"
		];
		/** The flow motion's four, appended to the glass set on the 高亮条 tab. */
		const FLOW_KNOBS = [
			"flowStiffness",
			"flowDamping",
			"flowStretch",
			"flowDroplet"
		];
		//#endregion
		//#region src/client/layers.ts
		/**
		* Layer registry: the single declaration of every glass layer the skin
		* paints. A layer owns its tab label, its placement, its starting values, the
		* knobs it exposes, and — the part that keeps the skin generic — the hooks it
		* binds to.
		*
		* WHERE the glass lands is the layer's `placement` (see
		* {@link LayerPlacement}): on the app element itself through the
		* `--lg-<layer>-*` variables, on a plugin-owned sheet fixed behind the app
		* (the columns and pages), or on a sheet mounted inside the host (any host
		* that CONTAINS other glassed controls — a dialog, the composer card, the
		* conversation header — because a nested `backdrop-filter` renders as an
		* opaque black plate instead of glass).
		*
		* Host selectors never name a plugin: they are the shell's structural locals,
		* its ARIA roles, and the app's own theme tokens. Every layer's hook list is
		* tried in order, first match wins.
		*/
		/**
		* 浓度/亮度 by the SHELL's scheme, for the layers that cover a large surface.
		* Glass has to hold up against two very different backdrops: a light wallpaper
		* wants a frosted white plate (a wash plus a lift), while over a dark photo any
		* white wash turns it grey — dark wants plain darkening instead. These are the
		* shipped pairs (2026-10-13.17, the values the author tuned); a layer opts in
		* with `schemeGlass: true`, and its own 浓度/亮度 knobs stay the MANUAL fallback
		* the moment either one is dragged (skin.ts `effectiveValues`, sun-panel.ts's
		* note). Nothing else about a layer follows the scheme.
		*/
		const SCHEME_GLASS = {
			light: {
				density: .5,
				brightness: 1.2
			},
			dark: {
				density: 0,
				brightness: .5
			}
		};
		/** Structural layout locals of the three-column shell. */
		const COLUMN = {
			sidebar: "[class*='sidebarCol']",
			center: "[class*='centerCol']",
			rightbar: "[class*='rightbarCol']"
		};
		/**
		* Composer card: any card that owns a text surface, whoever renders it — but NOT
		* the question card. ui-user-questions' QuestionComposer also holds a `<textarea>`
		* (the custom answer) inside a `[class*='card']`, so it matched this hook and got
		* the 输入区 layer's glass sheet plus a capsule on every option row. It is not the
		* composer, though: its official frame carries `data-question-key` and the card is
		* that frame's DIRECT child, so `:not([data-question-key] > *)` rules it out here,
		* once, for every consumer below (the layer's host, the button areas, the skin.css
		* rule that spells the same selector out).
		*/
		const COMPOSER_CARD = `${COLUMN.center} [class*='card']:has(textarea, [contenteditable='true'], [contenteditable='']):not([data-question-key] > *)`;
		/**
		* The question card itself: the composer-slot chain entry that takes over while
		* an agent question is pending. The official frame carries `data-question-key`
		* and the card is its DIRECT child, so this is exact — and it is deliberately the
		* mirror image of the exclusion above (one says "not the question card", this one
		* says "only the question card").
		*/
		const QUESTION_CARD = `[data-question-key] > [class*='card']`;
		/**
		* The conversation header: the resident strip above the chat — session
		* breadcrumbs, header actions, and the view tabs all sit on one `<header>` the
		* shell keeps mounted across sessions. Bound by its own leading child, which
		* only that header renders, so the hook survives class re-hashing and holds
		* for any future conversation header the shell mounts.
		*/
		const CONVERSATION_HEADER = `${COLUMN.center} header:has(> [data-conversation-header-leading])`;
		/**
		* Page surface: the full-view panel a sidebar entry opens in the centre
		* column. Two shapes exist and both are structural locals, so any present or
		* future entry page inherits the skin without naming a plugin:
		*
		* - `page` — the shell's own page sheet (plugin manager, skill panel) with its
		*   inner blocks excluded: heading, intro, and body carry the same local and
		*   would otherwise each get a glass sheet.
		* - `heroGate` — the agent-suite entry pages (助理档案/助理记忆 and any future
		*   gate page) render inside the conversation slot under one outermost gate
		*   container. That hook is guarded by the shell's own panel-open mark — the
		*   sidebar's active panel row (`aria-current='page'`), which exists only while
		*   an entry page is up. The unguarded case (the app's default page) used to
		*   have its own 首页 layer; it was removed — that page does not exist in the
		*   shell, so the layer never bound to anything.
		*/
		const PAGE_IN_CENTER = [
			`${COLUMN.center} [class*='page']`,
			`:not([class*='pageTitle'])`,
			`:not([class*='pageHead'])`,
			`:not([class*='pageIntro'])`,
			`:not([class*='pageBody'])`,
			`:not([class*='pager'])`
		].join("");
		const SUITE_PAGE_GATE = `body:has([class*='sidebarCol'] [aria-current='page']) ${COLUMN.center} [class*='heroGate']:not([class*='heroGate'] [class*='heroGate'])`;
		/**
		* The right column's own box: the docked panel the shell anchors to the frame's
		* right edge. The panel's content wrapper shares the `panel` local, so it is
		* excluded — it is not the column's box and, unlike the panel, it is never
		* marked hidden.
		*/
		const RIGHTBAR_PANEL = `${COLUMN.rightbar} [class*='panel']:not([class*='panelBody'])`;
		const NEW_CHAT_LABELS = [
			"新建会话",
			"new session",
			"创建 agent",
			"开启新对话",
			"new chat"
		];
		/**
		* The same rows as an EXCLUSION for the selection bar below. A row whose label
		* names "start a conversation" is an ACTION, not a selection: 常驻高亮 owns its
		* paint in EVERY state — including while the shell marks it active
		* (`aria-current` / `aria-selected`), where the two layers used to collide and
		* the bar's mark won on specificity, so a 创建 Agent row flashed the bar's look
		* instead of wearing the highlight it already had. Built from NEW_CHAT_LABELS so
		* the two lists cannot drift apart.
		*/
		const NOT_NEW_CHAT_ROW = `:not([class*='newSession'])` + NEW_CHAT_LABELS.map((label) => `:not([aria-label='${label}' i])`).join("");
		/** The flow highlight's candidate groups — the registry's one declaration of
		*  where the 高亮条 glass may stop, whoever renders the rows. The settings
		*  dialog's active nav cell is its own zone (the nav is the slot registry's,
		*  so plugin-added sections flow exactly like the built-in ones); the
		*  sidebar zone tries the open navigation row (`aria-current='page'`), the
		*  click tracker's row (the freshest human choice, and the only mark lists
		*  whose rows carry no ARIA selection ever get), then the shell's selected
		*  list row (`aria-selected`).
		*
		* There is deliberately no colour scan for the selection token: the shell
		* paints hover and selection with the SAME token (`--dsw-alias-interactive-bg-hover`
		* on session rows), so a computed-colour scan cannot tell a hovered row from a
		* selected one. ARIA is the shell's actual selection contract; hover keeps its
		* own tint-only rule. */
		const FLOW_STOPS = [{
			zone: "settings",
			selectors: [`[data-shortcut-modal='settings'] [aria-current='true']`]
		}, {
			zone: "sidebar",
			selectors: [
				`${COLUMN.sidebar} [aria-selected='true']${NOT_NEW_CHAT_ROW}`,
				`${COLUMN.sidebar} [aria-current='page']${NOT_NEW_CHAT_ROW}`,
				`${COLUMN.sidebar} [data-lg-current]${NOT_NEW_CHAT_ROW}`
			]
		}];
		/** The persistent new-conversation highlight: the shell's own 新会话 pill in
		* every state (wide, collapsed, rail) plus every sidebar row whose accessible
		* label names the same action — the agent-suite's 创建 Agent / 开启新对话
		* panel rows among them. The shell exposes both through its own contracts: the
		* pill carries the `newSession` layout local (its label/content/shortcut
		* children share the stem and are excluded), and a panel row carries its slot
		* label as `aria-label`, so the row hooks are the app's own ARIA text and an
		* absent plugin simply matches nothing. The aria hooks are case-insensitive
		* (`i`) so a language switch cannot drop the highlight; the brand logo button
		* — which also starts a session — is excluded: a glowing logo reads as a
		* defect, not a highlight. Mirrored by the paint rule in skin.css. */
		const NEW_CHAT_HOSTS = [`${COLUMN.sidebar} [class*='newSession']:not([class*='newSessionLabel']):not([class*='newSessionContent']):not([class*='newSessionShortcut'])`, ...NEW_CHAT_LABELS.map((label) => `${COLUMN.sidebar} button[aria-label='${label}' i]:not([class*='brand'])`)];
		/**
		* The 按钮 layer's areas: the structural containers its capsules land in. The
		* stylesheet dresses these same containers (skin.css), and the FIRST one that
		* is present also hosts the layer's refraction filter — a CSS-dressed layer has
		* no single element of its own, and the displacement field has to be measured
		* on a real box or 折射强度/边缘柔边 have nothing to shape. One box, one field,
		* every other consumer slices it (the same contract the 菜单 layer's
		* multi-element rule already rides). Ordered stable-first, and never a
		* container that sits inside another layer's glass (a nested backdrop-filter
		* cannot paint its own functions).
		*/
		const BUTTON_AREAS = [
			`${COMPOSER_CARD} button`,
			`${COMPOSER_CARD} [role='button']`,
			`${COMPOSER_CARD} [aria-haspopup]`
		];
		/** Neutral value of every knob: what a layer starts from before its defaults. */
		const NEUTRAL = {
			density: 0,
			radius: 0,
			refraction: 0,
			edgeSoftness: 15,
			glassBlur: 0,
			contrast: 1,
			brightness: 1,
			saturation: 1,
			tintHue: 220,
			tintSaturation: 0,
			rimStrength: 1,
			borderWidth: 0,
			borderOpacity: .85,
			grain: 0,
			flowStiffness: 150,
			flowDamping: .74,
			flowStretch: .26,
			flowDroplet: 0,
			hoverAlpha: .16
		};
		/** The values every layer shares — **the shipped look** (2026-10-13.7: the
		* author's own tuned values, promoted from a live session, so a fresh install
		* and 重置 open on the look that was actually tuned rather than on a neutral
		* baseline). Each entry below restates only what differs.
		*
		* It used to be derived from the capsule's defaults ("a fresh layer IS the
		* capsule"); it is not any more, deliberately: the capsule's own params are not
		* persisted, so the two sets are independent now (LIQUID_GLASS_DEFAULTS stays
		* the capsule's, and the 胶囊 tab still starts there). 圆角 stays a shape knob —
		* layers keep the shell's panel radius, not the capsule's pill. 边缘柔边 needs no
		* conversion: the fields read it against the capsule's live height (refraction.ts).
		*/
		const DEFAULT_GLASS = {
			density: 0,
			radius: 20,
			refraction: 1,
			edgeSoftness: 75,
			glassBlur: 20,
			contrast: 1,
			brightness: 1,
			saturation: 1.2,
			tintHue: 220,
			tintSaturation: 0,
			rimStrength: 1.5,
			borderWidth: 0,
			borderOpacity: 0,
			grain: 0
		};
		/**
		* Build a layer's tint colour: `hsla(tintHue, tintSaturation%,
		* lightness(density × scale))`. The lightness derives from the saturation —
		* 100% at saturation 0 (byte-identical to the old plain white) and dropping to
		* ~62% as the tint takes colour, because at full lightness every hue is the
		* same white and the 色调 knob would have nothing to turn.
		*/
		const buildTint = (scale) => (values) => {
			const saturation = values.tintSaturation ?? NEUTRAL.tintSaturation;
			const lightness = 100 - saturation * 50;
			return `hsla(${values.tintHue ?? NEUTRAL.tintHue}, ${(saturation * 100).toFixed(1)}%, ${lightness.toFixed(1)}%, ${(Number(values.density ?? 0) * scale).toFixed(3)})`;
		};
		/** Plain translucent white, the panels' tint (saturation 0 at lightness 100). */
		const whiteTint = buildTint;
		/**
		* The theme colour's wash — `"r, g, b"` — set by the engine right before it
		* rebuilds the layers, or null when no theme colour is chosen. Module state on
		* purpose: a theme colour is ONE look for the whole skin, so it enters through
		* the door every layer's tint already reads (this registry) instead of through a
		* layer-id special case in the engine.
		*/
		let themeWash = null;
		/** Point the theme-aware tints at an `"r, g, b"` triple, or at null for none. */
		function setThemeWash(rgb) {
			themeWash = rgb;
		}
		/**
		* The tint of the layer the theme colour owns (新会话 — the new-session pill and
		* the settings' value buttons). Alpha still follows the tint contract
		* (`浓度 × scale`); only the COLOUR half yields, because a theme colour is a
		* colour, not a hue: 纯白 and 高雅黑 cannot be written as `hsl(h, s%, 100−s·50)`
		* (that formula bottoms out at mid grey). With no theme colour chosen this is
		* the ordinary builder, byte for byte.
		*/
		const themeTint = (scale) => (values) => {
			if (themeWash === null) return buildTint(scale)(values);
			return `rgba(${themeWash}, ${(Number(values.density ?? 0) * scale).toFixed(3)})`;
		};
		/**
		* The ONE tint scale every layer uses — the capsule's own (its tint alpha is
		* `density × 0.5`). Declared once so a tab's 玻璃浓度 means the same glass on
		* every layer and on the capsule: one value, one look. A layer that wants a
		* different scale has to say so here, next to the reason.
		*/
		const TINT_SCALE = .5;
		const LAYERS = [
			{
				id: "sidebar",
				label: "侧边栏",
				placement: "behind",
				schemeGlass: true,
				hosts: [COLUMN.sidebar],
				knobs: GLASS_KNOBS,
				defaults: {
					...DEFAULT_GLASS,
					radius: 10,
					glassBlur: 2,
					edgeSoftness: 70
				},
				tint: whiteTint(TINT_SCALE),
				rim: true
			},
			{
				id: "center",
				label: "对话区",
				placement: "behind",
				schemeGlass: true,
				hosts: [COLUMN.center],
				knobs: GLASS_KNOBS,
				defaults: {
					...DEFAULT_GLASS,
					radius: 0,
					glassBlur: 0,
					brightness: .8,
					rimStrength: 0,
					edgeSoftness: 100
				},
				tint: whiteTint(TINT_SCALE),
				rim: true
			},
			{
				id: "rightbar",
				label: "右侧栏",
				placement: "behind",
				schemeGlass: true,
				hosts: [RIGHTBAR_PANEL, COLUMN.rightbar],
				knobs: GLASS_KNOBS,
				defaults: {
					...DEFAULT_GLASS,
					radius: 10,
					glassBlur: 2,
					edgeSoftness: 70
				},
				tint: whiteTint(TINT_SCALE),
				rim: true
			},
			{
				id: "page",
				label: "页面基底",
				placement: "behind",
				schemeGlass: true,
				hosts: [PAGE_IN_CENTER, SUITE_PAGE_GATE],
				knobs: GLASS_KNOBS,
				defaults: {
					...DEFAULT_GLASS,
					radius: 0,
					brightness: .8,
					rimStrength: 0,
					glassBlur: 4
				},
				tint: whiteTint(TINT_SCALE),
				rim: true,
				stack: 1
			},
			{
				id: "input",
				label: "输入区",
				placement: "inside",
				hosts: [COMPOSER_CARD],
				knobs: GLASS_KNOBS,
				defaults: {
					...DEFAULT_GLASS,
					edgeSoftness: 70,
					glassBlur: 4,
					brightness: 1.1,
					rimStrength: .8
				},
				tint: whiteTint(TINT_SCALE)
			},
			{
				id: "question",
				label: "提问卡",
				placement: "element",
				schemeGlass: true,
				hosts: [QUESTION_CARD],
				knobs: GLASS_KNOBS,
				defaults: {
					...DEFAULT_GLASS,
					edgeSoftness: 70,
					glassBlur: 4,
					brightness: 1.1
				},
				tint: whiteTint(TINT_SCALE),
				rim: true
			},
			{
				id: "convheader",
				label: "对话头",
				placement: "inside",
				hosts: [CONVERSATION_HEADER],
				knobs: GLASS_KNOBS,
				defaults: {
					...DEFAULT_GLASS,
					edgeSoftness: 70,
					glassBlur: 2,
					brightness: 1.1,
					rimStrength: .5
				},
				tint: whiteTint(TINT_SCALE)
			},
			{
				id: "highlight",
				label: "选中高亮",
				placement: "element",
				flow: true,
				hosts: FLOW_STOPS.flatMap((group) => group.selectors),
				knobs: [...GLASS_KNOBS, ...FLOW_KNOBS],
				defaults: {
					...DEFAULT_GLASS,
					edgeSoftness: 90,
					glassBlur: 0,
					brightness: 1.6,
					tintSaturation: 1,
					rimStrength: 2,
					flowStiffness: 300,
					flowDamping: .65,
					flowStretch: .3,
					flowDroplet: 0
				},
				tint: whiteTint(TINT_SCALE)
			},
			{
				id: "newchat",
				label: "新会话",
				placement: "element",
				hosts: NEW_CHAT_HOSTS,
				knobs: GLASS_KNOBS,
				defaults: {
					...DEFAULT_GLASS,
					density: 1,
					edgeSoftness: 80,
					glassBlur: 40,
					brightness: 1.2,
					saturation: 3,
					tintSaturation: 1,
					rimStrength: 2
				},
				tint: themeTint(TINT_SCALE),
				themeOwned: true
			},
			{
				id: "buttons",
				label: "输入控件",
				placement: "element",
				hosts: BUTTON_AREAS,
				hover: true,
				knobs: [...GLASS_KNOBS],
				defaults: {
					...DEFAULT_GLASS,
					edgeSoftness: 100,
					glassBlur: 0,
					contrast: 1.02,
					brightness: 1.6,
					saturation: 1.4,
					hoverAlpha: .2
				},
				tint: whiteTint(TINT_SCALE)
			},
			{
				id: "menu",
				label: "弹窗菜单",
				placement: "inside",
				schemeGlass: true,
				hosts: ["[role='dialog']"],
				knobs: GLASS_KNOBS,
				defaults: {
					...DEFAULT_GLASS,
					edgeSoftness: 60,
					glassBlur: 10,
					brightness: 1.1,
					saturation: 1.1,
					rimStrength: 2,
					borderOpacity: 1
				},
				tint: whiteTint(TINT_SCALE)
			}
		];
		/** Apply a layer's defaults on top of the shared neutral values. */
		function defaultValues(layer) {
			return {
				...NEUTRAL,
				...layer.defaults
			};
		}
		//#endregion
		//#region src/client/flow-lens.ts
		/**
		* The highlight lens: the glass stops are marked elements and the lens FLIES
		* between a zone's stops.
		*
		* Two halves, deliberately unequal in authority:
		*
		* - The STOPS (static, authoritative). Each zone marks its active row with
		*   `data-lg-flow-target` and the skin stylesheet paints THAT ROW with the
		*   高亮条 layer's glass — the same element-level paint the skin always
		*   used, above every app fill, text crisp, zero dependence on anything
		*   animated. Zones are independent: the sidebar's chat highlight STAYS LIT
		*   while the settings dialog's nav carries its own — opening settings never
		*   extinguishes the list behind it. Exactly one stop per zone is marked at
		*   any moment.
		*
		* - The FLIGHT (transient, decorative). When a zone's stop changes, a glass
		*   lens spawns on the OLD box — pixel-identical to the row glass that just
		*   handed off — and springs to the new one: one damped spring for centre
		*   and size, stretch conservation along the motion axis, the trailing
		*   droplet chasing at a softer spring. The lens is `position: fixed` ABOVE
		*   the app content (and above the settings overlay — it must be visible
		*   over the dialog it flies in) for the few hundred milliseconds it flies,
		*   and is display:none at rest. Landing pins the lens on the box (identity
		*   transform, pixel-identical to the row glass) and swaps the mark a beat
		*   later, so the handoff never reads as a reset. Every failure of the
		*   flight leaves the static marks untouched.
		*
		* The material is NOT restated: both halves read the 高亮条 layer's
		* `--lg-highlight-*` variables through the skin stylesheet, and the layer's
		* refraction filter hosts on a marked row (the zone that changed last —
		* while settings is open that is the nav cell; the sidebar's glass behind
		* the overlay is dimmed anyway). Only the four motion knobs
		* (flowStiffness/flowDamping/flowStretch/flowDroplet) drive the arithmetic.
		*/
		/** The settings dialog's structural mark: one flow ZONE. The sidebar is the
		*  other. Zones keep their marks independently; the lens flies within one. */
		const SETTINGS_ZONE = "[data-shortcut-modal='settings']";
		/** The mark: the skin stylesheet paints exactly this element. */
		const MARK = "data-lg-flow-target";
		/** Flight speed that maps to full stretch (px/s). */
		const SPEED_NORM = 900;
		/** How long a zone keeps its mark after its stop vanished (list re-renders
		*  swap the row nodes for a frame or two; a disconnected mark paints
		*  nothing, so holding it costs nothing and re-lands silently). */
		const GRACE_MS = 900;
		/** Sub-1 integration step ceiling: a stalled frame must not jump the spring. */
		const MAX_DT = 1 / 30;
		/** Distance (px) below which a "new" stop is the old one re-rendered in
		*  place — no flight, the mark swaps silently. */
		const SAME_SPOT_PX = 2;
		/** Landing thresholds: inside these the lens is VISUALLY on the box — the
		*  spring's remaining sub-pixel wiggle (ζ<1 decays exponentially, so the last
		*  half-pixel takes longer than the whole visible flight) is not worth
		*  delaying the handoff for. */
		const LAND_PX = 2;
		const LAND_SPEED = 25;
		/**
		* The frame source: rAF when the environment issues it. Some embedded
		* preview surfaces never deliver a rAF, so 50ms without one permanently
		* switches to a setTimeout 60fps — the map generation and the animation
		* share the entry, so the glass still forms.
		*/
		let useTimeoutFrames = false;
		function scheduleFrame(callback) {
			if (useTimeoutFrames) {
				setTimeout(() => {
					callback(performance.now());
				}, 1e3 / 60);
				return;
			}
			let ran = false;
			requestAnimationFrame((time) => {
				ran = true;
				callback(time);
			});
			setTimeout(() => {
				if (!ran) {
					useTimeoutFrames = true;
					callback(performance.now());
				}
			}, 50);
		}
		const clamp$2 = (value, min, max) => Math.min(Math.max(value, min), max);
		/** Whether an element currently occupies a box (hidden rows report 0×0). */
		function hasBox(element) {
			const rect = element.getBoundingClientRect();
			return rect.width >= 1 && rect.height >= 1;
		}
		var FlowHighlight = class {
			/** The lens element — the refraction filter attaches to a MARKED ROW, and
			*  the flight borrows its map. */
			lens;
			drop;
			/** Per-zone stop state, keyed by the FLOW_STOPS zone names. */
			zones = /* @__PURE__ */ new Map();
			/** The stop each zone resolved to last time (see {@link pickZone}). */
			pickCache = /* @__PURE__ */ new Map();
			/** Whether the settings dialog currently owns a stop. While it is open the
			*  workspace list must not show a lens of its own: the dialog covers and
			*  dims it, and two live capsules read as a defect. */
			settingsOpen = false;
			/** The dialog's root element, cached: the attribute query used to run on
			*  every sync, and a session switch syncs dozens of times. */
			settingsRoot = null;
			/** The zone a landing mark belongs to, while a flight is in the air. */
			pending = null;
			/** The zone the lens currently flies in (radius + filter priority). */
			flightZone = null;
			/** The lens centre spring and the size spring, one stiffness for all four. */
			centre = {
				x: 0,
				y: 0,
				vx: 0,
				vy: 0
			};
			size = {
				w: 10,
				h: 10,
				vw: 0,
				vh: 0
			};
			/** The droplet: a softer spring chasing the centre. */
			droplet = {
				x: 0,
				y: 0,
				vx: 0,
				vy: 0
			};
			motion = {
				stiffness: 150,
				damping: .74,
				stretch: .26,
				droplet: 0
			};
			running = false;
			lastTime = 0;
			/** Last geometry stamped on the lens: the destination box is constant for a
			*  whole flight, so re-writing it every frame was pure style invalidation. */
			lensBox = null;
			/** Last values stamped on the droplet, same reason — and its position goes
			*  through `transform` (compositor) instead of `left`/`top` (layout). */
			dropShown = false;
			dropDiameter = 0;
			dropX = 0;
			dropY = 0;
			dropOpacity = 0;
			/** Whether the lens is on screen mid-flight. */
			shown = false;
			/** Engine callback: a marked row becomes the refraction filter's host, so
			*  the rest-state knobs (折射强度/边缘柔边/颗粒感) shape that row's glass —
			*  the same wiring the per-row paint always had. */
			onMark;
			onScroll = () => {
				if (!this.shown) return;
				this.followTarget();
				if (!this.running) this.paint();
			};
			onResize = () => {
				if (!this.shown) return;
				this.followTarget();
				this.wake();
			};
			constructor(host, onMark) {
				this.onMark = onMark;
				this.drop = document.createElement("div");
				this.drop.dataset.lgFlowDrop = "drop";
				this.drop.style.display = "none";
				this.drop.style.left = "0px";
				this.drop.style.top = "0px";
				this.lens = document.createElement("div");
				this.lens.dataset.lgFlowLens = "lens";
				this.lens.style.display = "none";
				host.append(this.drop, this.lens);
				window.addEventListener("scroll", this.onScroll, true);
				window.addEventListener("resize", this.onResize);
			}
			/** New motion values (a slider moved); the loop reads them next frame. */
			setMotion(motion) {
				this.motion = motion;
			}
			/**
			* Re-pick every zone's stop and keep the glass on them. The engine's host
			* scan calls this — boot, every coalesced DOM mutation, the periodic sweep,
			* the reveal burst, and the row click — so a click retargets this frame.
			* Zones are independent: a change in one flies the lens there; the other
			* zone's mark is untouched.
			*/
			sync() {
				let dialog = this.settingsRoot;
				if (dialog === null || !dialog.isConnected) {
					dialog = document.querySelector(SETTINGS_ZONE);
					this.settingsRoot = dialog;
				}
				const settingsGroup = FLOW_STOPS.find((group) => group.zone === "settings");
				const settingsStop = dialog === null || !hasBox(dialog) || settingsGroup === void 0 ? null : this.pickZone(settingsGroup);
				this.settingsOpen = settingsStop !== null;
				let wanted = null;
				for (const group of FLOW_STOPS) {
					const state = this.zoneState(group.zone);
					if (this.settingsOpen && group.zone !== "settings") {
						if (state.stop !== null) {
							this.unmarkZone(group.zone);
							state.stop = null;
							state.missingSince = 0;
						}
						state.placed = false;
						if (this.flightZone === group.zone) {
							if (this.shown) this.hide();
							this.pending = null;
							this.flightZone = null;
							this.hostFilter();
						}
						continue;
					}
					const next = group.zone === "settings" ? settingsStop : this.pickZone(group);
					if (next === null) {
						if (state.stop !== null && this.pending?.zone !== group.zone) {
							if (state.missingSince === 0) state.missingSince = performance.now();
							const zoneGone = zoneRoot(group.zone) === null;
							if (this.pending === null && this.flightZone === group.zone && this.shown && zoneGone) {
								this.hide();
								this.flightZone = null;
								this.hostFilter();
							} else if (performance.now() - state.missingSince > GRACE_MS) {
								this.unmarkZone(group.zone);
								state.stop = null;
								state.missingSince = 0;
								if (this.flightZone === group.zone && this.shown) this.hide();
								this.hostFilter();
							}
						}
						continue;
					}
					state.missingSince = 0;
					if (state.stop === next) continue;
					const from = state.box;
					state.stop = next;
					const to = boxOf(next);
					const travelled = Math.abs(to.x - from.x) + Math.abs(to.y - from.y) + Math.abs(to.w - from.w) + Math.abs(to.h - from.h);
					state.box = to;
					if (!state.placed || travelled < SAME_SPOT_PX) {
						this.mark(group.zone, next);
						if (this.pending?.zone === group.zone) {
							this.pending = null;
							this.hide();
						}
						state.placed = true;
						continue;
					}
					wanted = {
						zone: group.zone,
						el: next,
						box: to,
						from
					};
				}
				if (wanted !== null) this.startFlight(wanted.zone, wanted.el, wanted.box, wanted.from);
			}
			destroy() {
				window.removeEventListener("scroll", this.onScroll, true);
				window.removeEventListener("resize", this.onResize);
				this.running = false;
				this.drop.remove();
				this.lens.remove();
				this.zones.clear();
				this.pending = null;
				this.shown = false;
				for (const marked of document.querySelectorAll(`[${MARK}]`)) marked.removeAttribute(MARK);
			}
			/**
			* One zone's candidate hooks — layers.ts's FLOW_STOPS group, resolved live.
			* First LIVE match wins, so exactly one stop per zone exists at any moment.
			* Liveness is deliberately lighter than a surface's: a row that is
			* connected with a real box is a stop, whoever renders it — the shell, an
			* official list, or any plugin's own list (工作区, 聊天记录, a settings
			* section, or a future one).
			*/
			pickZone(group) {
				const cached = this.pickCache.get(group.zone);
				if (cached !== void 0) {
					if (cached.el.isConnected && cached.el.matches(cached.selector) && hasBox(cached.el)) return cached.el;
					this.pickCache.delete(group.zone);
				}
				for (const selector of group.selectors) {
					let fallback = null;
					for (const found of document.querySelectorAll(selector)) {
						if (!found.isConnected || !hasBox(found)) continue;
						if (found.querySelector("[role=\"treeitem\"], li") !== null) {
							fallback ??= found;
							continue;
						}
						this.pickCache.set(group.zone, {
							el: found,
							selector
						});
						return found;
					}
					if (fallback !== null) {
						this.pickCache.set(group.zone, {
							el: fallback,
							selector
						});
						return fallback;
					}
				}
				return null;
			}
			zoneState(zone) {
				let state = this.zones.get(zone);
				if (state === void 0) {
					state = {
						stop: null,
						box: {
							x: 0,
							y: 0,
							w: 10,
							h: 10
						},
						placed: false,
						missingSince: 0
					};
					this.zones.set(zone, state);
				}
				return state;
			}
			/** Move ONE zone's mark: exactly one stop per zone carries the glass, and
			*  the refraction filter re-hosts onto the zone that changed last. */
			mark(zone, next) {
				this.unmarkZone(zone, next);
				next.setAttribute(MARK, "");
				this.onMark?.(next);
			}
			/** Clear a zone's mark (the optional keep is the stop being re-marked). */
			unmarkZone(zone, keep) {
				for (const marked of document.querySelectorAll(`[${MARK}]`)) if (marked !== keep && zoneOf(marked) === zone) marked.removeAttribute(MARK);
			}
			/** The refraction filter follows the freshest live mark: while settings is
			*  open that is the nav cell (the sidebar is dimmed behind the overlay);
			*  after it closes, back to the sidebar's stop. */
			hostFilter() {
				const order = this.flightZone !== null ? [this.flightZone] : [];
				for (const zone of this.zones.keys()) if (!order.includes(zone)) order.push(zone);
				for (const zone of order) {
					const stop = this.zones.get(zone)?.stop ?? null;
					if (stop !== null && stop.isConnected) {
						this.onMark?.(stop);
						return;
					}
				}
			}
			/** Re-measure the flying destination, shifting the springs by the same
			*  delta so a scrolled row drags the mid-flight lens with it. */
			followTarget() {
				if (this.pending === null) return;
				const state = this.zones.get(this.pending.zone);
				if (state === void 0) return;
				const box = boxOf(this.pending.el);
				const dx = box.x - state.box.x;
				const dy = box.y - state.box.y;
				state.box = box;
				if (dx === 0 && dy === 0) return;
				this.centre.x += dx;
				this.centre.y += dy;
				this.droplet.x += dx;
				this.droplet.y += dy;
			}
			/** Start (or retarget) the flight: THE OLD ROW LETS GO first — its mark is
			*  removed and the lens takes its place (`from`), one continuous glass
			*  leaving one spot — then springs to the new stop (`to`). Skipping the
			*  departure unmark is what leaves a stalled glass on the old row while
			*  the capsule flies. */
			startFlight(zone, el, to, from) {
				this.unmarkZone(zone);
				if (!this.shown || this.flightZone !== zone) this.spawnAt(from);
				this.flightZone = zone;
				this.pending = {
					zone,
					el
				};
				this.moveTo(to);
			}
			/** Appear exactly on `box` — the pixel handoff from the row glass. */
			spawnAt(box) {
				const centreX = box.x + box.w / 2;
				const centreY = box.y + box.h / 2;
				this.centre = {
					x: centreX,
					y: centreY,
					vx: 0,
					vy: 0
				};
				this.size = {
					w: box.w,
					h: box.h,
					vw: 0,
					vh: 0
				};
				this.droplet = {
					x: centreX,
					y: centreY,
					vx: 0,
					vy: 0
				};
				this.lens.style.display = "";
				this.lens.style.transform = "translate3d(0, 0, 0) scale(1, 1)";
				this.shown = true;
				this.paintAt(box);
			}
			/** Retarget the flight; layout jumps are invisible by construction — the
			*  paint derives translate and scale from the CURRENT box. */
			moveTo(box) {
				const state = this.pending === null ? void 0 : this.zones.get(this.pending.zone);
				if (state !== void 0) state.box = box;
				this.wake();
			}
			hide() {
				this.lens.style.display = "none";
				this.drop.style.display = "none";
				this.shown = false;
				this.running = false;
			}
			/** Landing: the mark and the lens swap places in the same frame — the
			*  destination's glass appears exactly where the lens is, then the lens is
			*  gone. The eye sees one continuous piece of glass pour across. */
			land() {
				const pending = this.pending;
				this.pending = null;
				if (pending !== null) {
					const state = this.zoneState(pending.zone);
					if (pending.el.isConnected) this.mark(pending.zone, pending.el);
					else {
						state.stop = null;
						this.unmarkZone(pending.zone);
						this.hostFilter();
					}
				}
				this.hide();
			}
			wake() {
				if (this.running || !this.shown) return;
				this.running = true;
				this.lastTime = performance.now();
				scheduleFrame((time) => {
					this.frame(time);
				});
			}
			/** One damped-spring step for the centre and the size, then the droplet's
			*  softer chase (k×0.45, damping capped at 0.85) behind the lens. */
			integrate(dt) {
				const k = this.motion.stiffness;
				const c = 2 * Math.sqrt(k) * this.motion.damping;
				const centreX = this.flightBox().x + this.flightBox().w / 2;
				const centreY = this.flightBox().y + this.flightBox().h / 2;
				this.centre.vx += (k * (centreX - this.centre.x) - c * this.centre.vx) * dt;
				this.centre.x += this.centre.vx * dt;
				this.centre.vy += (k * (centreY - this.centre.y) - c * this.centre.vy) * dt;
				this.centre.y += this.centre.vy * dt;
				this.size.vw += (k * (this.flightBox().w - this.size.w) - c * this.size.vw) * dt;
				this.size.w += this.size.vw * dt;
				this.size.vh += (k * (this.flightBox().h - this.size.h) - c * this.size.vh) * dt;
				this.size.h += this.size.vh * dt;
				const kd = k * .45;
				const cd = 2 * Math.sqrt(kd) * Math.min(this.motion.damping, .85);
				this.droplet.vx += (kd * (this.centre.x - this.droplet.x) - cd * this.droplet.vx) * dt;
				this.droplet.x += this.droplet.vx * dt;
				this.droplet.vy += (kd * (this.centre.y - this.droplet.y) - cd * this.droplet.vy) * dt;
				this.droplet.y += this.droplet.vy * dt;
				return this.isActive();
			}
			/** The flying destination's box (the pending stop's zone box). */
			flightBox() {
				if (this.pending !== null) {
					const state = this.zones.get(this.pending.zone);
					if (state !== void 0) return state.box;
				}
				return {
					x: 0,
					y: 0,
					w: 10,
					h: 10
				};
			}
			/** Still away from rest (position, size, or the droplet catching up). */
			isActive() {
				const eps = .5;
				const vEps = 3;
				const box = this.flightBox();
				const centreX = box.x + box.w / 2;
				const centreY = box.y + box.h / 2;
				const centreGap = Math.abs(this.centre.x - centreX) + Math.abs(this.centre.y - centreY) + Math.abs(this.size.w - box.w) + Math.abs(this.size.h - box.h);
				const dropletGap = Math.abs(this.droplet.x - this.centre.x) + Math.abs(this.droplet.y - this.centre.y);
				return centreGap > eps || dropletGap > eps || Math.abs(this.centre.vx) + Math.abs(this.centre.vy) + Math.abs(this.size.vw) + Math.abs(this.size.vh) > vEps;
			}
			/**
			* Stamp the frame: the layout box is the destination's (the refraction
			* field tracks it through its ResizeObserver, so the map regenerates only
			* when a real size changes), the transform carries the whole flight, and
			* the droplet's diameter follows speed.
			*/
			paint() {
				this.paintAt(this.flightBox());
				const n = clamp$2(Math.hypot(this.centre.vx, this.centre.vy) / SPEED_NORM, 0, 1);
				const s = this.motion.stretch * n;
				const box = this.flightBox();
				let sx = this.size.w / Math.max(1, box.w);
				let sy = this.size.h / Math.max(1, box.h);
				if (Math.abs(this.centre.vx) >= Math.abs(this.centre.vy)) {
					sx *= 1 + s;
					sy /= 1 + s;
				} else {
					sy *= 1 + s;
					sx /= 1 + s;
				}
				const tx = this.centre.x - (box.x + box.w / 2);
				const ty = this.centre.y - (box.y + box.h / 2);
				this.lens.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
				const dia = clamp$2(box.h * .66, 16, 60) * this.motion.droplet * n;
				if (dia < 3) {
					if (this.dropShown) {
						this.drop.style.display = "none";
						this.dropShown = false;
					}
				} else {
					if (!this.dropShown) {
						this.drop.style.display = "";
						this.dropShown = true;
					}
					const diameter = Math.round(dia * 10) / 10;
					if (diameter !== this.dropDiameter) {
						this.drop.style.width = `${diameter.toFixed(1)}px`;
						this.drop.style.height = `${diameter.toFixed(1)}px`;
						this.dropDiameter = diameter;
					}
					const x = Math.round((this.droplet.x - dia / 2) * 10) / 10;
					const y = Math.round((this.droplet.y - dia / 2) * 10) / 10;
					if (x !== this.dropX || y !== this.dropY) {
						this.drop.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
						this.dropX = x;
						this.dropY = y;
					}
					const opacity = Math.round(clamp$2(n * 1.6, 0, 1) * 100) / 100;
					if (opacity !== this.dropOpacity) {
						this.drop.style.opacity = String(opacity);
						this.dropOpacity = opacity;
					}
				}
			}
			/** Stamp the lens ON the box with identity transform — the landing beat's
			*  first half, pixel-identical to the row glass it hands off to. */
			paintAt(box) {
				const left = box.x.toFixed(2);
				const top = box.y.toFixed(2);
				const width = box.w.toFixed(2);
				const height = box.h.toFixed(2);
				const key = `${left}|${top}|${width}|${height}`;
				if (key === this.lensBox) return;
				this.lensBox = key;
				const style = this.lens.style;
				style.left = `${left}px`;
				style.top = `${top}px`;
				style.width = `${width}px`;
				style.height = `${height}px`;
			}
			frame(time) {
				if (!this.running || !this.shown) return;
				const dt = Math.min((time - this.lastTime) / 1e3, MAX_DT);
				this.lastTime = time;
				const active = this.integrate(dt);
				if (this.nearBox()) {
					this.land();
					return;
				}
				this.paint();
				if (active) scheduleFrame((next) => {
					this.frame(next);
				});
				else this.land();
			}
			/** Whether the lens is visually on the box (position and size inside the
			*  landing threshold, slow enough that it is riding the final approach). */
			nearBox() {
				const box = this.flightBox();
				const centreX = box.x + box.w / 2;
				const centreY = box.y + box.h / 2;
				return Math.abs(this.centre.x - centreX) <= LAND_PX && Math.abs(this.centre.y - centreY) <= LAND_PX && Math.abs(this.size.w - box.w) <= LAND_PX && Math.abs(this.size.h - box.h) <= LAND_PX && Math.hypot(this.centre.vx, this.centre.vy) <= LAND_SPEED;
			}
		};
		/** Viewport box of an element. */
		function boxOf(element) {
			const rect = element.getBoundingClientRect();
			return {
				x: rect.left,
				y: rect.top,
				w: rect.width,
				h: rect.height
			};
		}
		/** Which flow zone a stop lives in. */
		function zoneOf(element) {
			return element.closest(SETTINGS_ZONE) !== null ? "settings" : "sidebar";
		}
		/** The element that owns a zone. While it is mounted a missing stop is a
		*  transient re-render, not the zone going away — the lens hangs on. */
		function zoneRoot(zone) {
			return document.querySelector(zone === "settings" ? SETTINGS_ZONE : COLUMN.sidebar);
		}
		//#endregion
		//#region src/client/refraction.ts
		/**
		* Layer refraction: the capsule's own displacement map, rendered per layer.
		*
		* The field is the capsule's fragment VERBATIM as a pure function of uv — the
		* same inner rect (0.3 / 0.2), corner radius (0.6) and falloff span (0.8), the
		* same 边缘柔边 reading (px ÷ the capsule's height), and the pull expressed in
		* the CAPSULE's own pixels. It is encoded exactly like
		* {@link LiquidGlass.updateShader} encodes the capsule's map: one shared norm,
		* the demo's ×0.5 overdrive, clamped channels, the norm as the filter scale.
		* The map then stretches over each filtered ELEMENT's own box (the filter region
		* is the element's bounding box, `preserveAspectRatio="none"`), so at the same
		* relative position every element displaces by exactly what the capsule
		* displaces — same knobs, same glass, whatever the box — and a shared field
		* covers every consumer whole, not just the corner that matches the host.
		*
		* The lens is the capsule sample itself: its live size arrives through
		* setLensSize and is part of the field's signature. The field depends on the
		* knobs and the lens size only — never on the host's absolute size — so a
		* resize re-samples the same field on a new grid instead of changing the pull.
		*/
		/** The capsule fragment's inner rect, in half-box fractions (the demo's own). */
		const INNER_HALF_WIDTH = .3;
		const INNER_HALF_HEIGHT = .2;
		/** The capsule fragment's corner radius, in the same fractions (the demo's 0.6). */
		const CORNER_RADIUS = .6;
		/** Span the rim falloff runs over, in box fractions (the demo's 0.8). */
		const JUMP = .8;
		/** Map grid budget, in pixels. The field is smooth — its only feature is the
		*  rim band, and that band is a constant FRACTION of the box — so a couple of
		*  hundred samples an axis resolve it; one sample per box pixel buys nothing.
		*  The budget follows the box's own area, capped at the capsule sample's own
		*  grid (its live width × height, 300×200 by default): a control the size of
		*  the capsule is therefore sampled exactly like the capsule — the parity
		*  measurement's premise — and a full-column sheet, which is many times the
		*  capsule, spends no more than the capsule does. */
		const MAP_AREA_MIN = 6e3;
		const MAP_SIDE_MIN = 48;
		const MAP_SIDE_MAX = 320;
		/** Samples the grid must carry across the rim band (see gridFor). */
		const EDGE_SAMPLES = 12;
		/** Aspect is quantized so sub-pixel resizes reuse the field; the lens is smooth,
		*  so a couple of percent of stretch is invisible. */
		const ASPECT_STEP = .02;
		/** The pull's clamp and the sample budget are quantized too, so a box that
		*  creeps a pixel reuses its field instead of re-encoding it. Neither is
		*  visible: the clamp only trims the tail that falls off the element, and the
		*  field it holds is smooth. */
		const CLAMP_STEP = 4;
		const GRID_STEP = 32;
		/** How long a box must hold still before its field is re-encoded, and how long
		*  a box that never holds still may go without one. A pane drag or a sliding
		*  track changes a box every frame and each re-encode is a full-grid pass plus
		*  a PNG (measured: 166 encodes = 740ms across a 30-frame resize). The field is
		*  a function of box FRACTIONS and the filter region follows the element, so
		*  the glass keeps its shape throughout the drag — only the sampling density
		*  waits for the box to settle. Knob moves are never debounced: a slider has
		*  to feel live. */
		const BOX_SETTLE_MS = 120;
		const BOX_SETTLE_MAX_MS = 500;
		const fieldCache = /* @__PURE__ */ new Map();
		const FIELD_CACHE_MAX = 24;
		/** One canvas for every encode: the field is produced from scratch each time,
		*  so a per-layer canvas only held eleven idle buffers. */
		let encoderCanvas = null;
		function encoderOf() {
			if (encoderCanvas === null) encoderCanvas = document.createElement("canvas");
			return encoderCanvas.getContext("2d");
		}
		var LayerRefraction = class {
			id;
			svg;
			filter;
			feImage;
			feDisplacementMap;
			/** The grain overlay's alpha scale — the one tunable stage past the map. */
			grainMatrix = null;
			/** Whether the grain stage is currently in the filter graph (see buildTail). */
			grainOn = false;
			host = null;
			observer;
			/** The element the observer is currently observing (see attach/detach). */
			observed = null;
			/** Where to measure when the filtered element has no box of its own — a
			*  suppressed sheet is `display: none` and tracks its host's box instead
			*  (see LayerSurface.hostBox). */
			fallbackBox;
			/** Last applied knobs; null until the first update (the slider range
			*  includes negative refractions, so -1 cannot serve as an "unset" marker). */
			refraction = null;
			edgeSoftness = null;
			grain = 0;
			/** The lens every pull is measured in: the capsule sample's live box. */
			lensWidth = LIQUID_GLASS_DEFAULTS.width;
			lensHeight = LIQUID_GLASS_DEFAULTS.height;
			scheduled = false;
			/** Pending settle timer for a box that is still moving (see BOX_SETTLE_MS). */
			settleTimer;
			settleSince = 0;
			/** Signature of the generated field: the knobs, the lens size and the pull's
			*  clamp box are its inputs; the grid only resamples it. */
			lastSignature = null;
			constructor(id) {
				this.id = id;
				const ns = "http://www.w3.org/2000/svg";
				this.svg = document.createElementNS(ns, "svg");
				this.svg.setAttribute("width", "0");
				this.svg.setAttribute("height", "0");
				this.svg.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;";
				const defs = document.createElementNS(ns, "defs");
				this.filter = document.createElementNS(ns, "filter");
				this.filter.setAttribute("id", `lg-refract-${id}`);
				this.filter.setAttribute("filterUnits", "objectBoundingBox");
				this.filter.setAttribute("colorInterpolationFilters", "sRGB");
				this.filter.setAttribute("x", "0");
				this.filter.setAttribute("y", "0");
				this.filter.setAttribute("width", "1");
				this.filter.setAttribute("height", "1");
				this.feImage = document.createElementNS(ns, "feImage");
				this.feImage.setAttribute("result", "lg-map");
				this.feImage.setAttribute("width", "1");
				this.feImage.setAttribute("height", "1");
				this.feImage.setAttribute("preserveAspectRatio", "none");
				this.feDisplacementMap = document.createElementNS(ns, "feDisplacementMap");
				this.feDisplacementMap.setAttribute("in", "SourceGraphic");
				this.feDisplacementMap.setAttribute("in2", "lg-map");
				this.feDisplacementMap.setAttribute("result", "displaced");
				this.feDisplacementMap.setAttribute("xChannelSelector", "R");
				this.feDisplacementMap.setAttribute("yChannelSelector", "G");
				this.filter.appendChild(this.feImage);
				this.filter.appendChild(this.feDisplacementMap);
				this.buildTail();
				defs.appendChild(this.filter);
				this.svg.appendChild(defs);
				this.feImage.setAttributeNS("http://www.w3.org/1999/xlink", "href", identityMap());
				this.feDisplacementMap.setAttribute("scale", "0");
			}
			/**
			* Rebuild everything after the displacement stage: the grain overlay (only
			* while 颗粒感 is on) and the dither that ends every glass chain.
			*
			* The grain overlay is static fractal noise, colourised to mid grey with a
			* knob-scaled alpha, then arithmetically added over the displaced backdrop
			* (k2 keeps the glass, k3 mixes the speckle in). It must sit BEFORE the
			* dither's alpha mask, or the noise's opaque alpha would re-pin a sample that
			* came back empty — the black-plate failure the mask exists to prevent.
			*/
			buildTail() {
				const ns = "http://www.w3.org/2000/svg";
				while (this.filter.childElementCount > 2) this.filter.lastElementChild.remove();
				if (this.grainOn) {
					const noise = document.createElementNS(ns, "feTurbulence");
					noise.setAttribute("result", "grain-noise");
					noise.setAttribute("type", "fractalNoise");
					noise.setAttribute("baseFrequency", "0.9");
					noise.setAttribute("numOctaves", "2");
					noise.setAttribute("seed", "7");
					noise.setAttribute("stitchTiles", "stitch");
					const matrix = document.createElementNS(ns, "feColorMatrix");
					matrix.setAttribute("in", "grain-noise");
					matrix.setAttribute("result", "grain");
					matrix.setAttribute("type", "matrix");
					matrix.setAttribute("values", grainMatrixValues(this.grain));
					const mix = document.createElementNS(ns, "feComposite");
					mix.setAttribute("in", "displaced");
					mix.setAttribute("in2", "grain");
					mix.setAttribute("result", "grain-mixed");
					mix.setAttribute("operator", "arithmetic");
					mix.setAttribute("k1", "0");
					mix.setAttribute("k2", "1");
					mix.setAttribute("k3", "0.5");
					mix.setAttribute("k4", "0");
					this.grainMatrix = matrix;
					this.filter.append(noise, matrix, mix);
				}
				appendDitherStage(ns, this.filter, this.grainOn ? "grain-mixed" : "displaced");
			}
			/** Attach the filter's SVG and begin tracking `host`'s size. */
			mount(parent) {
				parent.appendChild(this.svg);
			}
			/**
			* Bind a host. The field is generated right here, not on a later frame: a
			* control that mounts mid-frame has to be fully formed by the time it is
			* painted, or it visibly settles a moment after appearing.
			*/
			attach(host, fallbackBox) {
				if (host === this.host) {
					this.fallbackBox = fallbackBox;
					return;
				}
				this.host = host;
				this.fallbackBox = fallbackBox;
				if (this.observed !== null && this.observed !== host) this.observer?.unobserve(this.observed);
				if (this.observer === void 0) this.observer = new ResizeObserver(() => this.queueRegenerate("box"));
				this.observer.observe(host);
				this.observed = host;
				this.regenerate();
			}
			/**
			* Let go of the host. The filter resets to a no-op over the whole viewport so
			* that a control which mounts before the next scan shows neutral glass rather
			* than the previous host's lens, stretched over the wrong box.
			*/
			detach() {
				if (this.observed !== null) this.observer?.unobserve(this.observed);
				this.observed = null;
				this.host = null;
				this.fallbackBox = void 0;
				this.lastSignature = null;
				this.clearSettle();
				this.feImage.setAttributeNS("http://www.w3.org/1999/xlink", "href", identityMap());
				this.feDisplacementMap.setAttribute("scale", "0");
			}
			/** Re-run for knob moves (skips when nothing changed). */
			update(refraction, edgeSoftness, grain = 0) {
				const on = grain > 0;
				if (on !== this.grainOn) {
					this.grainOn = on;
					this.grain = grain;
					this.buildTail();
				} else if (grain !== this.grain) {
					this.grain = grain;
					this.grainMatrix?.setAttribute("values", grainMatrixValues(grain));
				}
				if (refraction === this.refraction && edgeSoftness === this.edgeSoftness) return;
				this.refraction = refraction;
				this.edgeSoftness = edgeSoftness;
				this.queueRegenerate("knob");
			}
			/** Follow the capsule sample's live size: the pull of every layer is
			*  expressed in the capsule's own pixels, so a resized sample re-scales the
			*  whole skin's refraction with it. */
			setLensSize(width, height) {
				if (width === this.lensWidth && height === this.lensHeight) return;
				this.lensWidth = width;
				this.lensHeight = height;
				this.queueRegenerate("knob");
			}
			destroy() {
				this.observer?.disconnect();
				this.observer = void 0;
				this.observed = null;
				this.clearSettle();
				this.svg.remove();
			}
			/**
			* Schedule a regeneration for what changed.
			*
			* - `knob` (or the first field for a host): one pass on the next frame, so a
			*   slider move lands with the frame it was made in.
			* - `box`: a box that is still moving holds its field until it settles. A
			*   collapsing column resizes every frame, and each pass costs a full grid of
			*   field math plus a PNG encode; the field is a function of box FRACTIONS and
			*   the filter's region always follows the element, so nothing about the glass
			*   needs the new grid while the drag is in progress. A box that never settles
			*   (a looping animation) still gets a fresh grid every BOX_SETTLE_MAX_MS.
			*/
			queueRegenerate(source) {
				if (source === "knob" || this.lastSignature === null) {
					this.clearSettle();
					if (this.scheduled) return;
					this.scheduled = true;
					requestAnimationFrame(() => {
						this.scheduled = false;
						this.regenerate();
					});
					return;
				}
				const now = performance.now();
				if (this.settleTimer === void 0) this.settleSince = now;
				else clearTimeout(this.settleTimer);
				const wait = clamp$1(BOX_SETTLE_MS, 0, this.settleSince + BOX_SETTLE_MAX_MS - now);
				this.settleTimer = setTimeout(() => {
					this.settleTimer = void 0;
					this.regenerate();
				}, wait);
			}
			clearSettle() {
				if (this.settleTimer === void 0) return;
				clearTimeout(this.settleTimer);
				this.settleTimer = void 0;
			}
			/** Measure the host's box — the field is generated per host aspect and its
			*  pull is capped against this box. The filter's own region needs no stamping:
			*  it is the element's bounding box (see the constructor). */
			syncRegion() {
				const host = this.host;
				if (host === null) return null;
				const rect = host.getBoundingClientRect();
				const width = Math.max(2, Math.round(rect.width));
				const height = Math.max(2, Math.round(rect.height));
				if (width < 8 || height < 8) {
					const fallback = this.fallbackBox?.();
					if (fallback !== null && fallback !== void 0) return fallback;
				}
				return {
					width,
					height
				};
			}
			regenerate() {
				const host = this.host;
				const { refraction, edgeSoftness } = this;
				if (host === null || refraction === null || edgeSoftness === null) return;
				const box = this.syncRegion();
				if (box === null) return;
				if (box.width < 8 || box.height < 8) return;
				const aspect = quantize(box.width / box.height, ASPECT_STEP);
				const clampHalf = {
					w: Math.max(4, quantize(box.width, CLAMP_STEP)) / 2,
					h: Math.max(4, quantize(box.height, CLAMP_STEP)) / 2
				};
				const band = Math.max(.002, edgeSoftness / this.lensHeight);
				const grid = gridFor(quantize(box.width, GRID_STEP), quantize(box.height, GRID_STEP), aspect, band, this.lensWidth * this.lensHeight);
				const signature = `${grid.width}x${grid.height}:${aspect.toFixed(3)}:${band.toFixed(3)}:${refraction}:${this.lensWidth}x${this.lensHeight}:${clampHalf.w}x${clampHalf.h}`;
				if (signature === this.lastSignature) return;
				this.lastSignature = signature;
				this.renderField(signature, grid, band, refraction, clampHalf.w, clampHalf.h);
			}
			/**
			* Render the displacement field: the capsule's fragment and the capsule's
			* encoder, verbatim. The pixel pull comes out in the capsule's own px, so the
			* scale attribute below is the lens's norm and nothing else — no host size
			* enters the encoded displacement.
			*/
			renderField(signature, grid, band, refraction, halfWidth, halfHeight) {
				const cached = fieldCache.get(signature);
				if (cached !== void 0) {
					this.applyField(cached);
					return;
				}
				const { width: mapWidth, height: mapHeight } = grid;
				const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
				const rawX = new Float32Array(mapWidth * mapHeight);
				const rawY = new Float32Array(mapWidth * mapHeight);
				let maxRaw = 0;
				let index = 0;
				for (let row = 0; row < mapHeight; row++) {
					const iy = (row + .5) / mapHeight - .5;
					for (let col = 0; col < mapWidth; col++, index++) {
						const ix = (col + .5) / mapWidth - .5;
						const scaled = smoothStep(0, 1, smoothStep(JUMP, 0, roundedRectSDF(ix, iy, INNER_HALF_WIDTH, INNER_HALF_HEIGHT, CORNER_RADIUS) - band)) * refraction;
						const dx = clamp$1(ix * (scaled - 1) * this.lensWidth, -halfWidth, halfWidth);
						const dy = clamp$1(iy * (scaled - 1) * this.lensHeight, -halfHeight, halfHeight);
						if (Math.abs(dx) > maxRaw) maxRaw = Math.abs(dx);
						if (Math.abs(dy) > maxRaw) maxRaw = Math.abs(dy);
						rawX[index] = dx;
						rawY[index] = dy;
					}
				}
				let encoded;
				if (!Number.isFinite(maxRaw) || maxRaw === 0) encoded = {
					href: identityMap(),
					scale: "0"
				};
				else {
					const maxScale = maxRaw * .5;
					const inverse = 1 / maxScale;
					for (let i = 0, p = 0; i < data.length; i += 4, p++) {
						data[i] = (rawX[p] * inverse + .5) * 255;
						data[i + 1] = (rawY[p] * inverse + .5) * 255;
						data[i + 2] = 0;
						data[i + 3] = 255;
					}
					const context = encoderOf();
					if (context.canvas.width !== mapWidth) context.canvas.width = mapWidth;
					if (context.canvas.height !== mapHeight) context.canvas.height = mapHeight;
					context.putImageData(new ImageData(data, mapWidth, mapHeight), 0, 0);
					encoded = {
						href: context.canvas.toDataURL(),
						scale: String(maxScale)
					};
				}
				if (fieldCache.size >= FIELD_CACHE_MAX) fieldCache.delete(fieldCache.keys().next().value);
				fieldCache.set(signature, encoded);
				this.applyField(encoded);
			}
			applyField(field) {
				this.feImage.setAttributeNS("http://www.w3.org/1999/xlink", "href", field.href);
				this.feDisplacementMap.setAttribute("scale", field.scale);
			}
		};
		/**
		* The map grid for a box, under one sample budget. The field is smooth and its
		* only feature — the rim band — is a constant fraction of the box, so a couple
		* of hundred samples an axis resolve it; sampling once per box pixel buys
		* nothing. The budget follows the box's own area (clamped), so a 24px chip pays
		* for a chip and a full-column sheet stays under the capsule sample's own scale.
		*
		* The band is the exception: a NARROW rim (边缘柔边 low) needs samples of its
		* own or the falloff comes out stepped, so `EDGE_SAMPLES / band` is a floor on
		* both axes. At the ordinary band (~0.15) that floor is ~80 and the area budget
		* is what decides; only a sliver-thin rim pulls the grid back up.
		*/
		function gridFor(boxWidth, boxHeight, aspect, band, lensArea) {
			const box = Math.max(16, boxWidth) * Math.max(16, boxHeight);
			const area = clamp$1(Math.round(box), MAP_AREA_MIN, Math.max(MAP_AREA_MIN, Math.round(lensArea)));
			let width = clamp$1(Math.round(Math.sqrt(area * aspect)), MAP_SIDE_MIN, MAP_SIDE_MAX);
			let height = clamp$1(Math.round(area / width), MAP_SIDE_MIN, MAP_SIDE_MAX);
			const floor = clamp$1(Math.ceil(EDGE_SAMPLES / band), MAP_SIDE_MIN, MAP_SIDE_MAX);
			if (width < floor) width = floor;
			if (height < floor) height = floor;
			return {
				width,
				height
			};
		}
		function clamp$1(value, min, max) {
			return Math.min(Math.max(value, min), max);
		}
		function quantize(value, step) {
			return Math.round(value / step) * step;
		}
		/**
		* The no-op identity map every layer starts on, encoded once for the whole
		* skin: a filter with no image is an invalid reference, and an invalid `url()`
		* at the head of a backdrop-filter chain voids the whole chain (no blur, no
		* tint) until a real field arrives. Sharing the encode takes the cold canvas
		* work out of every layer's boot.
		*/
		let identityMapHref = null;
		function identityMap() {
			if (identityMapHref !== null) return identityMapHref;
			const canvas = document.createElement("canvas");
			canvas.width = 2;
			canvas.height = 2;
			canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray([
				128,
				128,
				0,
				255,
				128,
				128,
				0,
				255,
				128,
				128,
				0,
				255,
				128,
				128,
				0,
				255
			]), 2, 2), 0, 0);
			identityMapHref = canvas.toDataURL();
			return identityMapHref;
		}
		//#endregion
		//#region src/client/surface.ts
		/**
		* A plugin-owned glass surface: one element that carries a layer's tint,
		* radius, backdrop chain, and rim shading, painted either BEHIND the app or
		* INSIDE its host (see {@link LayerPlacement} in layers.ts).
		*
		* `'behind'` — a `position: fixed` element tracking an app element's box, for
		* the columns and pages. The skin paints those this way instead of styling the
		* app's own element, because a `backdrop-filter` must not sit inside the
		* subtree of another one — nested, the inner layer stops honouring its own
		* filter functions entirely (see skin.css). Keeping every glassed layer on a
		* sibling surface removes the nesting by construction.
		*
		* `'inside'` — a child of the host itself (`position: absolute; inset: 0;
		* z-index: -1`), for hosts that CONTAIN other glassed controls (a dialog, the
		* composer card, the conversation header). It paints above the host's own
		* background and below its content, and — the point — it is a SIBLING of that
		* content, so the controls inside the host are no longer nested in a filtered
		* subtree and can carry their own filter. The host gets no filter of its own
		* (skin.css keys its element rule off `[data-lg-glass-host]`), which is why the
		* surface, not the element, has to hold the layer's glass.
		*
		* The fixed element escapes the hosts' clipping, so it re-checks how the host
		* is being rendered — hidden attribute, computed visibility, off-viewport box —
		* instead of trusting the box alone, and refreshes on host box changes and on
		* attribute changes anywhere up the host's ancestor chain. The inside element
		* needs none of that: it is a real child, so the host's own layout and
		* visibility govern it.
		*/
		/**
		* The capsule's rim shading — its drop shadow plus the top inset shade that
		* give the glass its edge. One constant for the whole skin: rimmed surfaces
		* stamp it inline, and the engine publishes it as `--lg-rim-shadow` for the
		* element-style layers (composer card, highlight rows, dialogs) in skin.css.
		*/
		const RIM_SHADOW = "0 4px 8px rgba(0, 0, 0, 0.25), 0 -10px 25px inset rgba(0, 0, 0, 0.15)";
		/** Attributes that can change how a host (or one of its ancestors) is rendered. */
		const WATCHED_ATTRIBUTES = [
			"class",
			"style",
			"hidden",
			"aria-hidden",
			"data-sidebar-right-open",
			"data-animating"
		];
		/**
		* Whether `element` is currently being rendered where a surface may paint:
		* connected, not inside an `aria-hidden` / `hidden` / `display: none` branch,
		* not turned invisible, and still overlapping the viewport (a docked pane
		* slides off through a transform, which leaves its box unchanged).
		*/
		function isDisplayable(element) {
			if (!element.isConnected) return false;
			const style = getComputedStyle(element);
			if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
			if (element.closest("[hidden], [aria-hidden=\"true\"]") !== null) return false;
			const rect = element.getBoundingClientRect();
			return rect.width >= 1 && rect.height >= 1 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
		}
		const PLAN_HIDE = { kind: "hide" };
		const PLAN_INSIDE = { kind: "inside" };
		var LayerSurface = class {
			element;
			/** How this surface is mounted ('behind' the app or inside its host). */
			placement;
			host = null;
			resizeObserver;
			attributeObserver;
			scheduled = false;
			/** Set whenever something could move this sheet; cleared by a commit. */
			dirty = true;
			mounted = false;
			/** Set while another layer's sheet fully covers this one: the surface stays
			*  bound (its box keeps tracking) but paints nothing, so the two glasses
			*  never stack (doubled refraction, milky doubled tints). */
			suppressed = false;
			/** Host styles this surface had to touch to mount inside it (restored on
			*  detach): an absolutely positioned child needs a containing block, and a
			*  negative z-index child needs a stacking context to stay behind the
			*  host's content. */
			hostStyleTouched = null;
			/** Engine callback for a resize on a RELEASED host: the host is renderable
			*  again (or about to be), and only a host scan can rebind the surface —
			*  the release disconnected everything else that watched it. */
			onHostSignal;
			/** Engine callback that asks for a shared flush (see {@link SurfacePlan}). */
			onInvalidate;
			/** What the last commit painted — the diff base. An unchanged plan writes
			*  nothing at all, so a sweep over twelve still surfaces costs twelve
			*  comparisons instead of forty-eight style writes. */
			applied = PLAN_HIDE;
			/** Last values handed to {@link update}, so a re-apply on an unrelated
			*  scheme flip stops rewriting four properties per surface. */
			appliedPaint = null;
			constructor(layer, rim, stack, placement, onHostSignal, onInvalidate) {
				this.placement = placement;
				this.onHostSignal = onHostSignal;
				this.onInvalidate = onInvalidate;
				this.element = document.createElement("div");
				this.element.dataset.lgSurface = layer;
				this.element.dataset.lgSurfaceMode = placement;
				this.element.style.display = "none";
				this.element.style.zIndex = placement === "inside" ? "-1" : String(stack);
				this.element.style.contain = "layout style";
				if (rim) this.element.style.boxShadow = RIM_SHADOW;
			}
			/** Track `host`; a 'behind' surface joins `parent`, an 'inside' one mounts
			*  as the host's first child. */
			attach(host, parent) {
				if (this.host !== host) {
					this.resizeObserver?.disconnect();
					this.attributeObserver?.disconnect();
					this.releaseHost();
					this.host = host;
					if (this.placement === "behind") {
						this.resizeObserver = new ResizeObserver(() => {
							if (this.host === null) this.onHostSignal?.();
							else this.queueSync();
						});
						this.resizeObserver.observe(host);
						this.attributeObserver = new MutationObserver(() => this.queueSync());
						for (let node = host; node !== null; node = node.parentElement) {
							this.attributeObserver.observe(node, {
								attributes: true,
								attributeFilter: WATCHED_ATTRIBUTES
							});
							if (node === document.body) break;
						}
					} else this.prepareHost(host);
					this.mounted = false;
					this.applied = PLAN_HIDE;
				}
				if (this.placement === "behind") {
					if (!this.mounted) {
						parent.appendChild(this.element);
						this.mounted = true;
					}
				} else if (this.element.parentElement !== host || host.firstElementChild !== this.element) {
					host.prepend(this.element);
					this.mounted = true;
				}
				this.queueSync();
			}
			/**
			* Let go of the host. A 'behind' surface's observer STAYS on the element: a
			* host the shell hides by an unobserved mechanism (an inline style, say) and
			* reshows later reports its resize here, and the release callback asks the
			* engine to rebind — without it the surface would stay dark until the next
			* periodic sweep. An 'inside' surface leaves the DOM with its host.
			*/
			detach() {
				this.attributeObserver?.disconnect();
				this.attributeObserver = void 0;
				this.applied = PLAN_HIDE;
				if (this.placement === "inside") {
					this.element.remove();
					this.releaseHost();
					this.mounted = false;
					this.host = null;
					return;
				}
				this.host = null;
				this.element.style.display = "none";
			}
			/** Re-check box and renderability now (used by the skin's periodic sweep,
			*  which is the safety net for host changes no observer reports). */
			sync() {
				this.queueSync();
			}
			/**
			* The host's live box — what this sheet is sized to whenever it can paint.
			*
			* A suppressed sheet (another layer's page covers the column) is
			* `display: none`, so its OWN box is 0×0 and the layer's displacement field
			* would have nothing to be measured against. The host's box is the right
			* answer: the sheet tracks it, so the field generated for it is exactly the
			* one the sheet needs the moment it paints again.
			*/
			hostBox() {
				const host = this.host;
				if (host === null) return null;
				const rect = host.getBoundingClientRect();
				return {
					width: Math.max(2, Math.round(rect.width)),
					height: Math.max(2, Math.round(rect.height))
				};
			}
			/** Paint nothing while another sheet fully covers this one; the box keeps
			*  tracking, so lifting the cover restores the sheet unchanged. */
			setSuppressed(suppressed) {
				if (this.suppressed === suppressed) return;
				this.suppressed = suppressed;
				this.queueSync();
			}
			update(tint, backdrop, radius, shadow) {
				const paint = `${tint}\u0000${backdrop}\u0000${radius}\u0000${shadow}`;
				if (paint === this.appliedPaint) return;
				this.appliedPaint = paint;
				this.element.style.background = tint;
				this.element.style.backdropFilter = backdrop;
				this.element.style.borderRadius = radius;
				this.element.style.boxShadow = shadow;
			}
			destroy() {
				this.detach();
				this.element.remove();
			}
			/**
			* Whether this surface still owes a stamp. The engine's ordinary flush only
			* measures the surfaces that asked for one (resize, attribute flip, re-bind,
			* knob paint); the sweep and the reveal burst pass `all` and re-measure
			* everything regardless.
			*/
			needsStamp() {
				return this.dirty;
			}
			/** Coalesce resize bursts and attribute flurries to one shared flush per frame. */
			queueSync() {
				this.dirty = true;
				if (this.scheduled) return;
				this.scheduled = true;
				requestAnimationFrame(() => {
					this.scheduled = false;
					if (this.onInvalidate !== void 0) {
						this.onInvalidate();
						return;
					}
					this.commit(this.measure());
				});
			}
			/**
			* Give the host what an absolutely positioned, negative-z child needs, and
			* mark it so the stylesheet hands the layer's glass to this surface
			* (`[data-lg-glass-host]` in skin.css). Only styles the host did not already
			* have are stamped, and detach restores them.
			*/
			prepareHost(host) {
				const element = host;
				const computed = getComputedStyle(element);
				const touched = {
					position: "",
					isolation: ""
				};
				if (computed.position === "static") {
					touched.position = element.style.position;
					element.style.position = "relative";
				}
				if (computed.zIndex === "auto" && computed.isolation !== "isolate") {
					touched.isolation = element.style.isolation;
					element.style.isolation = "isolate";
				}
				this.hostStyleTouched = touched;
				element.dataset.lgGlassHost = "";
			}
			releaseHost() {
				if (this.hostStyleTouched !== null) {
					const element = this.host;
					if (element !== null) {
						if (this.hostStyleTouched.position !== "") element.style.position = this.hostStyleTouched.position;
						if (this.hostStyleTouched.isolation !== "") element.style.isolation = this.hostStyleTouched.isolation;
					}
					this.hostStyleTouched = null;
				}
				if (this.host !== null) delete this.host.dataset.lgGlassHost;
			}
			/** READ phase — everything that forces layout lives here, and the engine
			*  runs it for every surface before any of them writes (see SurfacePlan).
			*  @param quick - Skip the visibility probe (the reveal burst's per-frame
			*                 geometry tracking; see the rect check below). */
			measure(quick = false) {
				const host = this.host;
				if (this.placement === "inside") {
					if (host === null || !host.isConnected || this.suppressed) return PLAN_HIDE;
					return PLAN_INSIDE;
				}
				if (host === null || this.suppressed) return PLAN_HIDE;
				if (!quick && !isDisplayable(host)) return PLAN_HIDE;
				const rect = host.getBoundingClientRect();
				if (rect.width < 1 || rect.height < 1) return PLAN_HIDE;
				return {
					kind: "place",
					left: Math.round(rect.left),
					top: Math.round(rect.top),
					width: Math.round(rect.width),
					height: Math.round(rect.height)
				};
			}
			/** WRITE phase — only what changed since the last commit is stamped. */
			commit(plan) {
				this.dirty = false;
				const style = this.element.style;
				if (plan.kind === "hide") {
					if (this.applied.kind !== "hide") style.display = "none";
					this.applied = plan;
					return;
				}
				if (plan.kind === "inside") {
					if (this.applied.kind !== "inside") style.display = "";
					this.applied = plan;
					const host = this.host;
					if (host !== null && host.firstElementChild !== this.element) host.prepend(this.element);
					return;
				}
				if (this.applied.kind !== "place") style.display = "";
				const prev = this.applied;
				if (prev.kind !== "place" || prev.left !== plan.left) style.left = `${plan.left}px`;
				if (prev.kind !== "place" || prev.top !== plan.top) style.top = `${plan.top}px`;
				if (prev.kind !== "place" || prev.width !== plan.width) style.width = `${plan.width}px`;
				if (prev.kind !== "place" || prev.height !== plan.height) style.height = `${plan.height}px`;
				this.applied = plan;
			}
		};
		//#endregion
		//#region src/client/wallpaper-store.ts
		/** The base URL the node half serves the wallpaper directory under. Absolute,
		*  not relative to the document: the app may be mounted under a sub-path, and a
		*  relative route would then resolve below it and 404. Mirrors the node half's
		*  own WALLPAPER_ROUTE (src/index.ts) — the two halves cannot import each
		*  other, so this is the one place the string is restated. */
		const WALLPAPER_ROUTE = "/ui-liquid-glass/wallpapers";
		/** URL an <img>/background can load one directory wallpaper by. */
		function wallpaperUrl(id) {
			return `${WALLPAPER_ROUTE}/${id.split("/").map(encodeURIComponent).join("/")}`;
		}
		function toEntries(names) {
			if (!Array.isArray(names)) return [];
			return names.filter((name) => typeof name === "string").map((name) => ({
				id: name,
				name
			}));
		}
		/** The current listing, or an empty one when the service is unreachable. */
		async function listWallpapers() {
			try {
				const response = await fetch(WALLPAPER_ROUTE, { cache: "no-store" });
				if (!response.ok) return {
					user: [],
					defaults: []
				};
				const body = await response.json();
				if (body === null || typeof body !== "object") return {
					user: [],
					defaults: []
				};
				const { user, default: defaults } = body;
				return {
					user: toEntries(user),
					defaults: toEntries(defaults)
				};
			} catch {
				return {
					user: [],
					defaults: []
				};
			}
		}
		/** Upload an image file into the wallpaper directory. Throws on failure. */
		async function addWallpaper(file) {
			const response = await fetch(`${WALLPAPER_ROUTE}/${encodeURIComponent(file.name)}`, {
				method: "POST",
				headers: { "content-type": file.type || "application/octet-stream" },
				body: await file.arrayBuffer()
			});
			if (!response.ok) throw new Error(`wallpaper upload failed (${String(response.status)})`);
		}
		/** Remove one user wallpaper from the directory. Throws on failure. */
		async function deleteWallpaper(id) {
			const response = await fetch(`${WALLPAPER_ROUTE}/${encodeURIComponent(id)}`, { method: "DELETE" });
			if (!response.ok) throw new Error(`wallpaper delete failed (${String(response.status)})`);
		}
		//#endregion
		//#region \0dsh-inline-css:E:\dsh\starry-fork\packages\client\ui-liquid-glass\src\client\skin.css.mjs
		var skin_css_default = "[data-lg-wallpaper]{z-index:-2;pointer-events:none;background-color:var(--lg-wall-base);background-position:50%;background-size:cover;position:fixed;inset:0}body[data-lg-skin][data-lg-skin]{background:0 0!important}[data-lg-surfaces]{z-index:-1;pointer-events:none;position:fixed;inset:0}[data-lg-surface]{pointer-events:none;position:fixed}[data-lg-surface][data-lg-surface-mode=inside]{position:absolute;inset:0}[data-lg-glass-host],body[data-lg-skin] [class*=frame]:has(>[class*=sidebarCol],>[class*=centerCol],>[class*=rightbarCol]),body[data-lg-skin] [class*=sidebarCol],body[data-lg-skin] [class*=centerCol],body[data-lg-skin] [class*=rightbarCol]{background:0 0!important}body[data-lg-skin] [class*=sidebarCol],body[data-lg-skin] [class*=centerCol]{border-left-color:#0000!important;border-right-color:#0000!important}body[data-lg-skin] [data-dockkit-host=dock][data-dockkit-column=\"0\"]>[class*=tabHost]{border-left-color:#0000!important}body[data-lg-skin][data-lg-skin]{--dsw-alias-bg-base:transparent!important;--dsw-alias-bg-layer-1:var(--lg-menu-tint)!important;--dsw-specific-sidebar-fill:transparent!important;--dsw-specific-input-major:var(--lg-input-tint)!important;--dsw-specific-sidebar-nav-item-active:var(--lg-highlight-tint)!important;--dsw-specific-sidebar-nav-item-active-accent:var(--lg-highlight-tint)!important;--dsw-font-family:\"HarmonyOS Sans SC\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"PingFang SC\", \"Microsoft YaHei\", \"Hiragino Sans GB\", sans-serif!important;--dsw-alias-interactive-bg-hover:var(--lg-hover-tint)!important;--dsw-specific-sidebar-nav-item-hover:var(--lg-hover-tint)!important;--dsw-menu-surface-fill:var(--lg-menu-tint)!important;--dsw-specific-menu:var(--lg-menu-tint)!important;--dsw-specific-selector:var(--lg-menu-tint)!important;--dsw-alias-bg-layer-2:var(--lg-menu-tint)!important;--dsw-alias-bg-layer-3:var(--lg-menu-tint)!important;--dsw-menu-backdrop-filter:var(--lg-menu-backdrop)!important;--dsw-radius-lg:var(--lg-menu-radius)!important;--dsw-radius-md:var(--lg-menu-radius)!important;--dsw-radius-panel:var(--lg-menu-radius)!important}body[data-lg-theme][data-lg-theme]{--dsw-static-deepseek-400:var(--lg-theme-400)!important;--dsw-static-deepseek-450:var(--lg-theme-450)!important;--dsw-static-deepseek-500:var(--lg-theme-500)!important;--dsw-static-deepseek-600:var(--lg-theme-600)!important}body[data-lg-skin] [data-agent-preset-id] [data-tone=solid]{background:var(--dsw-alias-button-info-fill)!important;color:#fff!important}body[data-lg-text][data-lg-text]{--dsw-alias-label-primary:var(--lg-text-primary)!important;--dsw-alias-label-secondary:var(--lg-text-secondary)!important;--dsw-alias-label-tertiary:var(--lg-text-tertiary)!important;--dsw-alias-label-caption:var(--lg-text-caption)!important}body[data-lg-skin] [class*=centerCol] [class*=card]:has(textarea,[contenteditable=true],[contenteditable=\"\"]):not([data-question-key]>*){border-radius:var(--lg-input-radius);box-shadow:var(--lg-input-rim,var(--lg-rim-shadow))}body[data-lg-skin] [class*=centerCol] [class*=card]:has(textarea,[contenteditable=true],[contenteditable=\"\"]):not([data-question-key]>*):not([data-lg-glass-host]){background:var(--lg-input-tint);backdrop-filter:var(--lg-input-backdrop)}body[data-lg-skin] [data-question-key]>[class*=card]{border-radius:var(--lg-question-radius);box-shadow:var(--lg-question-rim,var(--lg-rim-shadow))}body[data-lg-skin] [data-question-key]>[class*=card]:not([data-lg-glass-host]){background:var(--lg-question-tint);backdrop-filter:var(--lg-question-backdrop)}body[data-lg-skin] [class*=centerCol] [class*=card]:has(textarea,[contenteditable=true],[contenteditable=\"\"]):not([data-question-key]>*) :is(button,[role=button],[aria-haspopup]):not(:has([class*=seatLabel])){background:var(--lg-buttons-tint);border-radius:var(--lg-buttons-radius);backdrop-filter:var(--lg-buttons-backdrop);box-shadow:var(--lg-buttons-rim,var(--lg-rim-shadow))}body[data-lg-skin] [class*=sidebarCol] :is([role=treeitem],[class*=panelRow]):hover,body[data-lg-skin] [class*=sidebarCol] li:not(:has(>button)):not(:has([role=treeitem],[class*=panelRow])):hover,body[data-lg-skin] [data-shortcut-modal=settings] [class*=navCell]:hover{background:var(--lg-hover-tint);border-radius:var(--lg-buttons-radius)}body[data-lg-skin] [class*=centerCol] header:has(>[data-conversation-header-leading]){z-index:10;border-radius:var(--lg-convheader-radius);box-shadow:var(--lg-convheader-rim,var(--lg-rim-shadow));position:relative}body[data-lg-skin] [class*=centerCol] header:has(>[data-conversation-header-leading]):not([data-lg-glass-host]){background:var(--lg-convheader-tint);backdrop-filter:var(--lg-convheader-backdrop)}body[data-lg-skin] [class*=centerCol] [data-conversation-content]{margin-top:-76px}body[data-lg-skin] [class*=centerCol] [data-conversation-scroll]{padding-top:76px}[data-lg-flowhost]{z-index:1100;pointer-events:none;position:fixed;inset:0}[data-lg-flow-lens]{pointer-events:none;will-change:transform;background:var(--lg-highlight-tint);backdrop-filter:var(--lg-highlight-backdrop);border-radius:var(--lg-highlight-radius);box-shadow:var(--lg-highlight-rim,var(--lg-rim-shadow));position:fixed}[data-lg-flow-drop]{pointer-events:none;will-change:transform;background:var(--lg-highlight-tint);backdrop-filter:var(--lg-highlight-backdrop);border-radius:50%;position:fixed}body[data-lg-skin] [data-shortcut-modal=settings] [class*=navCell][aria-current=true]{background:0 0!important}body[data-lg-skin] [data-shortcut-modal=settings] [class*=navCell]{height:34px!important;margin-inline:6px!important;padding-block:6px!important}body[data-lg-skin] [data-shortcut-modal=settings] [class*=navList]{padding-bottom:14px}body[data-lg-skin] [data-shortcut-modal=settings] [class*=navCell][data-lg-flow-target][data-lg-flow-target],body[data-lg-skin] [class*=sidebarCol] [data-lg-flow-target][data-lg-flow-target]{border-radius:var(--lg-highlight-radius);box-shadow:var(--lg-highlight-rim,var(--lg-rim-shadow));background:var(--lg-highlight-tint)!important;backdrop-filter:var(--lg-highlight-backdrop)!important}body[data-lg-skin] [class*=sidebarCol] :is([aria-selected=true],[aria-current=page],[data-lg-current]){background:0 0!important}body[data-lg-skin] [data-shortcut-modal=settings] :is([class*=navCell],[class*=selector]:not([class*=Label]),[class*=switcher]:not([class*=Label]),[class*=stepper]:not([class*=value]),[class*=setting]>button,[class*=themeCube][class*=selected],[class*=cardActive]){border-radius:var(--lg-newchat-radius)}body[data-lg-skin] [data-shortcut-modal=settings] :is([class*=selector],[class*=switcher],[class*=stepper],[class*=setting]>button,[class*=themeCube][class*=selected],[class*=cardActive]){background:var(--lg-newchat-tint);backdrop-filter:var(--lg-newchat-backdrop);box-shadow:var(--lg-newchat-rim,var(--lg-rim-shadow))}body[data-lg-skin] [data-shortcut-modal=settings] [class*=switcher] [class*=Label],body[data-lg-skin] [data-shortcut-modal=settings] [class*=selector] [class*=Label],body[data-lg-skin] [data-shortcut-modal=settings] [class*=stepper] [class*=value]{backdrop-filter:none!important;box-shadow:none!important;background:0 0!important}body[data-lg-skin] [data-shortcut-modal=settings] [role=switch][aria-checked=true]{background:var(--lg-newchat-tint);backdrop-filter:var(--lg-newchat-backdrop);box-shadow:var(--lg-newchat-rim,var(--lg-rim-shadow))}body[data-lg-skin][data-lg-skin] [class*=sidebarCol] :is([class*=newSession]:not([class*=newSessionLabel]):not([class*=newSessionContent]):not([class*=newSessionShortcut]),button[aria-label=新建会话 i]:not([class*=brand]),button[aria-label=new\\ session i]:not([class*=brand]),button[aria-label=创建\\ agent i],button[aria-label=开启新对话 i],button[aria-label=new\\ chat i]){border-radius:var(--lg-newchat-radius);background:var(--lg-newchat-tint)!important;backdrop-filter:var(--lg-newchat-backdrop)!important;box-shadow:var(--lg-newchat-rim,var(--lg-rim-shadow))!important}body[data-lg-skin] [role=dialog]{border-radius:var(--lg-menu-radius);box-shadow:var(--lg-menu-rim,var(--lg-rim-shadow))}body[data-lg-skin] [role=dialog]:not([data-lg-glass-host]){background:var(--lg-menu-tint);backdrop-filter:var(--lg-menu-backdrop)}";
		//#endregion
		//#region src/client/skin.ts
		/**
		* The layered skin engine. Mounting tags `<body data-lg-skin>`, mounts the
		* wallpaper host, one refraction filter and (where the layer calls for it) one
		* glass surface per layer, and injects the static skin stylesheet (see
		* skin.css). Every layer's look is driven by `--lg-*` custom properties that
		* {@link apply} recomputes from the layer state, so live tuning never rebuilds
		* CSS.
		*
		* Layer metadata — labels, defaults, knobs, hosts — lives in layers.ts; knob
		* ranges live in knobs.ts. Nothing here names a plugin: the hooks are the
		* shell's structural locals, its ARIA roles, and the app's own theme tokens, so
		* any present or future plugin that renders into these regions inherits the
		* skin automatically.
		*/
		/** The ramp steps a preset overrides, in one place. */
		const THEME_RAMP_STEPS = [
			"400",
			"450",
			"500",
			"600"
		];
		const THEME_COLORS = [
			{
				id: "blue",
				swatch: "rgb(65, 118, 230)",
				ramp: null,
				wash: null
			},
			{
				id: "gold",
				swatch: "#C69C57",
				ramp: {
					400: "rgb(232, 206, 155)",
					450: "rgb(217, 184, 122)",
					500: "rgb(198, 156, 87)",
					600: "rgb(156, 122, 60)"
				},
				wash: "214, 178, 110"
			},
			{
				id: "white",
				swatch: "#F2F2F2",
				ramp: {
					400: "rgb(255, 255, 255)",
					450: "rgb(245, 245, 245)",
					500: "rgb(232, 232, 232)",
					600: "rgb(207, 207, 207)"
				},
				wash: "255, 255, 255"
			},
			{
				id: "black",
				swatch: "#1A1A1E",
				ramp: {
					400: "rgb(74, 74, 80)",
					450: "rgb(51, 51, 58)",
					500: "rgb(36, 36, 41)",
					600: "rgb(21, 21, 25)"
				},
				wash: "26, 26, 30"
			}
		];
		/** Stamp of the running skin, published on <body> and on the stylesheet tag so
		*  a stale page (browser cache, ungated reload) is one devtools lookup away. */
		const SKIN_VERSION = "2026-10-13.32";
		/** The web-server route the node half serves the bundled fonts under. The two
		*  halves cannot import each other, so this mirrors src/index.ts's FONT_ROUTE. */
		const FONT_ROUTE = "/ui-liquid-glass/fonts";
		/** The @font-face rules for the bundled faces, served by the node half's font
		*  route. The version query busts the browser cache once per skin build (the
		*  route itself answers with a week-long max-age). On hosts without the web
		*  server the fetch simply fails and the fallback stack in skin.css renders. */
		const FONT_FACE_CSS = [
			["HarmonyOSSansSC-Regular.ttf", 400],
			["HarmonyOSSansSC-Medium.ttf", 500],
			["HarmonyOSSansSC-Bold.ttf", 700]
		].map(([file, weight]) => `@font-face{font-family:'HarmonyOS Sans SC';src:url("${FONT_ROUTE}/${file}?v=${SKIN_VERSION}") format('truetype');font-weight:${weight};font-display:swap}`).join("");
		/** Minimum spacing between host scans. The scan runs on the LEADING edge of a
		*  DOM change — a control the shell mounts in response to a click is bound in
		*  the same task, so its glass is already formed at its first paint — and
		*  coalesces to this spacing only under sustained churn (boot, streaming). */
		const HOST_SCAN_INTERVAL_MS = 80;
		/** Attributes whose flip starts a shell reveal or hide: a panel marks itself
		*  (`data-sidebar-right-open`, `aria-hidden`, `hidden`), and the frame raises
		*  `data-animating` across the toggle's track transition. */
		const REVEAL_ATTRIBUTES = [
			"aria-hidden",
			"hidden",
			"data-sidebar-right-open",
			"data-animating"
		];
		/**
		* How long after a reveal flip the engine re-checks every frame. The reveal
		* itself is a CSS transition — the right panel's docked content slides in, the
		* frame's grid track eases to its width — that fires NO mutation, resize, or
		* transition event until it ends, and the host only becomes displayable part
		* way through it (its box enters the viewport, the track grows past zero). The
		* scan that the flip itself triggers still sees the closed state, so without
		* this burst the next look would be the periodic sweep, and the glass would
		* land hundreds of milliseconds after the panel. Each frame re-runs the host
		* scan and re-stamps every surface, so the glass forms the moment the box is
		* renderable and rides the slide instead of popping in at its end.
		*/
		const REVEAL_BURST_MS = 700;
		/**
		* The 时光壁纸 set: one directory image per time bucket, switching
		* automatically through the day. Buckets are hours [start, end), with the
		* night bucket (18–04) wrapping midnight. The set is deliberately
		* scheme-INDEPENDENT: one image serves both 亮暗, so the wallpaper no longer
		* moves when the shell's theme flips.
		*/
		const TIME_WALLPAPERS = [
			{
				start: 4,
				end: 12,
				file: "Default/6-blue-light.png"
			},
			{
				start: 12,
				end: 18,
				file: "Default/7-black-gray-light.png"
			},
			{
				start: 18,
				end: 4,
				file: "Default/8-gray-brown-pink-light.png"
			}
		];
		/** How often the time mode re-checks its bucket (a wall-clock minute suffices). */
		const TIME_WALLPAPER_CHECK_MS = 3e4;
		/** One blur is enough: the two blur stages this skin used to carry
		*  (`blur(a) blur(b)`) compose into a single `blur(sqrt(a² + b²))`, so the
		*  frosted blur was merged into the glass blur rather than kept as a second
		*  knob with the same effect. v2 and v1 stores are folded forward on load. */
		const STORAGE_KEY = "ui-liquid-glass/skin/v4";
		const PREVIOUS_STORAGE_KEYS = [
			"ui-liquid-glass/skin/v3",
			"ui-liquid-glass/skin/v2",
			"ui-liquid-glass/skin/v1"
		];
		/** Keys the pre-registry (v1) storage used, mapped to their current names. */
		const LEGACY_KNOBS = {
			conc: "density",
			edgeBand: "edgeSoftness",
			bright: "brightness",
			sat: "saturation"
		};
		/** Legacy layer ids that were renamed. */
		const LEGACY_LAYERS = { rightcol: "rightbar" };
		/**
		* Build a layer's backdrop-filter chain. The leading `url()` is the layer's
		* refraction map; the rest is the frosted stack the capsule's own glass uses,
		* in the same order. Every layer — capsule included — carries the same chain
		* shape, so 折射强度/边缘柔边/颗粒感 mean the same thing on every tab.
		*
		* A sample the displacement pushes outside the element (a small control, or a
		* container whose box the field was not generated for) comes back TRANSPARENT
		* rather than as an opaque black plate: the dither stage that ends the chain
		* preserves the backdrop's own alpha (see appendDitherStage). That is what
		* keeps a container's own glass from blacking out the controls inside it.
		*
		* `none` is returned only when the whole chain would be an identity operation:
		* a backdrop-filter that filters nothing still creates a backdrop root, and a
		* backdrop root inside another layer's subtree stops that layer's own filter
		* functions from applying. Collapsing to `none` keeps clear layers free.
		*/
		function backdropChain(layer, values) {
			const glassBlur = values.glassBlur ?? 0;
			const contrast = values.contrast ?? 1;
			const brightness = values.brightness ?? 1;
			const saturation = values.saturation ?? 1;
			const refraction = values.refraction ?? 0;
			const grain = values.grain ?? 0;
			if (refraction === 0 && glassBlur === 0 && grain === 0 && contrast === 1 && brightness === 1 && saturation === 1) return "none";
			return `url(#lg-refract-${layer.id}) blur(${glassBlur}px) contrast(${contrast}) brightness(${brightness}) saturate(${saturation})`;
		}
		var SkinEngine = class {
			style;
			wallpaper;
			surfacesHost;
			/** Body-level container of the flow lens — above the surface stack, below
			*  every app surface (see flow-lens.ts for why the lens lives there). */
			flowHost;
			/** The 高亮条 layer's shared flying lens. */
			flow;
			surfaces = /* @__PURE__ */ new Map();
			refractions = /* @__PURE__ */ new Map();
			attachedHosts = /* @__PURE__ */ new Map();
			/** The hook each bound host matched — the scan's fast path (attachHosts). */
			boundHook = /* @__PURE__ */ new Map();
			nestedWarned = /* @__PURE__ */ new Set();
			/** The host each element layer's nesting was last checked on (see
			*  warnIfNested — the walk is not worth repeating for the same element). */
			nestedChecked = /* @__PURE__ */ new Map();
			sweepTimer;
			hostObserver;
			hostScanTimer;
			/** Last host scan, so scans run on the leading edge of a DOM change. */
			lastScanAt = 0;
			/** Per-frame re-check window after a reveal flip (see REVEAL_BURST_MS). */
			revealBurstDeadline = 0;
			revealBurstRunning = false;
			markerObserver;
			/** The user's uploads (root files), cached for the picker. */
			wallpaperUserFiles = [];
			/** The shipped Default set, cached for the time mapping and picker. */
			wallpaperDefaultFiles = [];
			/** The time mode's half-minute bucket check. */
			schemeObserver;
			wallpaperClock;
			/** One shared flush per frame for every surface (read pass, then write
			*  pass): see {@link flushSurfaces}. */
			flushScheduled = false;
			/** One flow sync per frame, asked for by a selection flip. */
			flowSyncScheduled = false;
			/** Last backdrop chain built per layer. `backdropChain()` is a pure function
			*  of the layer id and its five glass knobs — memoising it takes twelve
			*  string builds off every apply that changes none of them. */
			backdropCache = /* @__PURE__ */ new Map();
			/**
			* The ONE shared layer state: the property panel's rows write this object and
			* every apply() consumes it. Handing out two loaded copies would fork the
			* data — rows would move while the engine kept re-applying the stale
			* snapshot, and every backdrop knob would look dead.
			*/
			state = loadSkinState();
			async reloadWallpapers() {
				const listing = await listWallpapers();
				this.wallpaperUserFiles = listing.user.map((entry) => entry.id);
				this.wallpaperDefaultFiles = listing.defaults.map((entry) => entry.id);
			}
			/** Inject the stylesheet, mount the wallpaper and every layer, enable the skin. */
			mount() {
				this.style = document.createElement("style");
				this.style.dataset.plugin = "ui-liquid-glass-skin";
				this.style.dataset.version = SKIN_VERSION;
				this.style.textContent = skin_css_default + FONT_FACE_CSS;
				document.head.appendChild(this.style);
				this.wallpaper = document.createElement("div");
				this.wallpaper.dataset.lgWallpaper = "";
				document.body.appendChild(this.wallpaper);
				this.surfacesHost = document.createElement("div");
				this.surfacesHost.dataset.lgSurfaces = "";
				document.body.appendChild(this.surfacesHost);
				for (const layer of LAYERS) {
					const refraction = new LayerRefraction(layer.id);
					refraction.mount(document.body);
					this.refractions.set(layer.id, refraction);
					if (layer.placement !== "element") this.surfaces.set(layer.id, new LayerSurface(layer.id, layer.rim === true, layer.stack ?? 0, layer.placement, () => this.scheduleHostScan(), () => this.requestFlush()));
				}
				this.flowHost = document.createElement("div");
				this.flowHost.dataset.lgFlowhost = "";
				document.body.appendChild(this.flowHost);
				this.flow = new FlowHighlight(this.flowHost, (row) => {
					this.refractions.get("highlight")?.attach(row);
				});
				document.body.dataset.lgSkin = "";
				document.body.dataset.lgSkinVersion = SKIN_VERSION;
				document.addEventListener("click", this.onRowClick, true);
				this.markerObserver = new MutationObserver(() => this.restoreMarker());
				this.markerObserver.observe(document.body, {
					childList: true,
					subtree: true
				});
				this.hostObserver = new MutationObserver((records) => this.onHostMutation(records));
				this.hostObserver.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: [
						"aria-hidden",
						"hidden",
						"data-sidebar-right-open",
						"data-animating",
						"aria-current",
						"aria-selected"
					]
				});
				this.runHostScan();
				this.sweepTimer = setInterval(() => {
					if (document.hidden) return;
					this.attachHosts();
					this.flushSurfaces(true);
				}, 1500);
				this.startWallpaperClock();
				this.startSchemeWatch();
			}
			/**
			* Notice a host mutation. The scan itself is DEFERRED to the next frame: this
			* callback fires inside the shell's own commit, and a scan reads layout —
			* running it here forced a style/layout flush in the middle of the shell's
			* render, which is what made a workspace switch feel like it had to wind up
			* before the new view appeared. A selection flip additionally retargets the
			* flow on the next frame, so the lens starts moving with the shell's paint
			* instead of waiting out the scan throttle.
			*/
			onHostMutation(records) {
				let selection = false;
				for (const record of records) {
					if (record.type !== "attributes") continue;
					const name = record.attributeName ?? "";
					if (REVEAL_ATTRIBUTES.includes(name)) {
						this.startRevealBurst();
						continue;
					}
					if (name === "aria-selected" || name === "aria-current") selection = true;
				}
				if (selection) this.requestFlowSync();
				this.scheduleHostScan();
			}
			/** One flow sync per frame, asked for by a selection flip (see onHostMutation). */
			requestFlowSync() {
				if (this.flowSyncScheduled) return;
				this.flowSyncScheduled = true;
				requestAnimationFrame(() => {
					this.flowSyncScheduled = false;
					this.flow?.sync();
				});
			}
			startRevealBurst() {
				this.revealBurstDeadline = Math.max(this.revealBurstDeadline, performance.now() + REVEAL_BURST_MS);
				if (this.revealBurstRunning) return;
				this.revealBurstRunning = true;
				const tick = () => {
					if (performance.now() >= this.revealBurstDeadline) {
						this.revealBurstRunning = false;
						return;
					}
					if (this.hasUnboundLayer()) this.attachHosts();
					this.flushSurfaces(true, true);
					requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}
			/** Whether any layer the scan could bind is still unbound. */
			hasUnboundLayer() {
				for (const layer of LAYERS) {
					if (layer.flow === true) continue;
					if (!this.attachedHosts.has(layer.id)) return true;
				}
				return false;
			}
			scheduleHostScan() {
				if (this.hostScanTimer !== void 0) return;
				const wait = Math.max(0, HOST_SCAN_INTERVAL_MS - (performance.now() - this.lastScanAt));
				this.hostScanTimer = setTimeout(() => {
					this.hostScanTimer = void 0;
					requestAnimationFrame(() => this.runHostScan());
				}, wait);
			}
			/**
			* Ask for one shared surface flush on the next frame. Every surface that
			* needs re-stamping routes here instead of scheduling its own rAF, so the
			* frame runs a single READ pass (all boxes measured) followed by a single
			* WRITE pass (only changed properties stamped) — no per-surface
			* read-write-read-write, which forced a fresh layout for each of them.
			*/
			requestFlush() {
				if (this.flushScheduled) return;
				this.flushScheduled = true;
				requestAnimationFrame(() => {
					this.flushScheduled = false;
					this.flushSurfaces();
				});
			}
			/** Read every surface's box first, then commit them all.
			*  @param all - Re-measure even surfaces that did not ask (the sweep's net).
			*  @param quick - Skip the per-surface visibility probe (see measure). */
			flushSurfaces(all = false, quick = false) {
				const plans = [];
				for (const surface of this.surfaces.values()) {
					if (!all && !surface.needsStamp()) continue;
					plans.push({
						surface,
						plan: surface.measure(quick)
					});
				}
				for (const entry of plans) entry.surface.commit(entry.plan);
			}
			runHostScan() {
				this.lastScanAt = performance.now();
				this.attachHosts();
				this.flushSurfaces(true, true);
			}
			/** Resolve every layer's host and (re)bind its surface and refraction map. */
			attachHosts() {
				for (const layer of LAYERS) {
					if (layer.flow === true) continue;
					const current = this.attachedHosts.get(layer.id);
					if (current !== void 0) {
						if (layer.placement === "element" && current.isConnected && current.getAttribute("aria-hidden") !== "true") continue;
						const hook = this.boundHook.get(layer.id);
						if (hook !== void 0 && hook === layer.hosts[0] && current.isConnected && current.matches(hook) && isDisplayable(current)) continue;
						const host = this.findHost(layer);
						if (layer.placement !== "element" && current === host) continue;
						this.attachedHosts.delete(layer.id);
						this.boundHook.delete(layer.id);
						this.surfaces.get(layer.id)?.detach();
						this.refractions.get(layer.id)?.detach();
						this.bind(layer, host);
						continue;
					}
					this.bind(layer, this.findHost(layer));
				}
				this.flow?.sync();
				this.syncColumnCover();
			}
			/** Bind one layer to `host` (null: leave it unbound). */
			bind(layer, host) {
				if (host === null) return;
				this.attachedHosts.set(layer.id, host);
				const hook = layer.hosts.find((selector) => host.matches(selector)) ?? layer.hosts[0];
				if (hook !== void 0) this.boundHook.set(layer.id, hook);
				const surface = this.surfaces.get(layer.id);
				if (surface !== void 0) {
					surface.attach(host, this.surfacesHost);
					this.refractions.get(layer.id)?.attach(surface.element, () => surface.hostBox());
				} else {
					this.refractions.get(layer.id)?.attach(host);
					this.warnIfNested(layer.id, host);
				}
			}
			/**
			* A full-column sheet (页面) sits directly on its column's own glass —
			* stacking two glasses doubles the refraction and milks the doubled tints,
			* and turning the covered column's knobs would visibly change the sheet on
			* top. While a covering layer is bound, the centre surface keeps tracking
			* its box but paints nothing; lifting the cover restores it unchanged.
			*/
			syncColumnCover() {
				this.surfaces.get("center")?.setSuppressed(this.attachedHosts.has("page"));
			}
			/** First host hook that resolves, in the layer's declared order. */
			findHost(layer) {
				for (const selector of layer.hosts) for (const found of document.querySelectorAll(selector)) if (layer.placement !== "element" ? isDisplayable(found) : found.getAttribute("aria-hidden") !== "true") return found;
				return null;
			}
			/**
			* A backdrop-filter nested inside another one stops honouring its own filter
			* functions (measured in Chromium: blur/saturate/brightness/url() all render
			* identically once an ancestor filters the backdrop), so a nested layer can
			* only be tuned through its tint. Report it instead of leaving the panel
			* looking broken — with the register's own layers this never fires.
			*/
			warnIfNested(layer, host) {
				if (this.nestedWarned.has(layer)) return;
				if (this.nestedChecked.get(layer) === host) return;
				this.nestedChecked.set(layer, host);
				for (let el = host.parentElement; el !== null && el !== document.body; el = el.parentElement) if (getComputedStyle(el).backdropFilter !== "none") {
					this.nestedWarned.add(layer);
					console.warn(`[ui-liquid-glass] layer "${layer}" sits inside a filtered element (${el.className || el.tagName}); its backdrop knobs (折射强度/边缘柔边/玻璃模糊/对比度/亮度/饱和度) will not paint there. Only 玻璃浓度 and 圆角 apply.`);
					return;
				}
			}
			/** Follow the capsule sample's live size: every layer's refraction pull is
			*  expressed in the capsule's own pixels (refraction.ts), so a resized
			*  sample re-scales the whole skin's refraction with it. */
			setLensReference(width, height) {
				for (const refraction of this.refractions.values()) refraction.setLensSize(width, height);
			}
			/** The time mode's directory file for right now — what the picker highlights. */
			currentTimeWallpaper() {
				return this.timeWallpaperFile();
			}
			/** Recompute every `--lg-*` variable, surface, and refraction map. */
			apply(state) {
				const variables = {
					"--lg-wall-base": "rgb(16, 18, 23)",
					"--lg-rim-shadow": RIM_SHADOW
				};
				this.applyThemeColor(state.theme);
				for (const layer of LAYERS) {
					const values = effectiveValues(layer, state);
					const tint = layer.tint(values);
					const backdropKey = `${values.refraction ?? 0}|${values.glassBlur ?? 0}|${values.contrast ?? 1}|${values.brightness ?? 1}|${values.saturation ?? 1}|${values.grain ?? 0}`;
					const memo = this.backdropCache.get(layer.id);
					let backdrop;
					if (memo !== void 0 && memo.key === backdropKey) backdrop = memo.chain;
					else {
						backdrop = backdropChain(layer, values);
						this.backdropCache.set(layer.id, {
							key: backdropKey,
							chain: backdrop
						});
					}
					const radius = `${values.radius ?? NEUTRAL.radius}px`;
					const rim = rimShadowCss(values.rimStrength ?? NEUTRAL.rimStrength) + ringShadowCss(values.borderWidth ?? NEUTRAL.borderWidth, values.borderOpacity ?? NEUTRAL.borderOpacity);
					variables[`--lg-${layer.id}-tint`] = tint;
					variables[`--lg-${layer.id}-backdrop`] = backdrop;
					variables[`--lg-${layer.id}-radius`] = radius;
					variables[`--lg-${layer.id}-rim`] = rim;
					this.surfaces.get(layer.id)?.update(tint, backdrop, radius, rim);
					this.refractions.get(layer.id)?.update(values.refraction ?? 0, values.edgeSoftness ?? NEUTRAL.edgeSoftness, values.grain ?? NEUTRAL.grain);
					if (layer.hover === true) {
						const saturation = values.tintSaturation ?? NEUTRAL.tintSaturation;
						const lightness = 100 - saturation * 50;
						const alpha = clamp(values.hoverAlpha ?? NEUTRAL.hoverAlpha, 0, 1);
						variables["--lg-hover-tint"] = `hsla(${values.tintHue ?? NEUTRAL.tintHue}, ${(saturation * 100).toFixed(1)}%, ${lightness.toFixed(1)}%, ${alpha.toFixed(3)})`;
					}
					if (layer.flow === true) this.flow?.setMotion({
						stiffness: values.flowStiffness ?? NEUTRAL.flowStiffness,
						damping: values.flowDamping ?? NEUTRAL.flowDamping,
						stretch: values.flowStretch ?? NEUTRAL.flowStretch,
						droplet: values.flowDroplet ?? NEUTRAL.flowDroplet
					});
				}
				for (const [name, value] of Object.entries(variables)) document.body.style.setProperty(name, value);
				this.applyTextColors(state.theme);
				this.paintWallpaper(state);
			}
			/**
			* 文字颜色: when the theme panel has a hue/lightness pair, publish the four
			* label tokens as `--lg-text-*` and raise the `data-lg-text` gate that
			* skin.css's `!important` overrides hang on; otherwise retract everything so
			* the shell's own palette (including its live theme switches) stands. The
			* hierarchy is kept by lightness steps: primary > secondary > tertiary >
			* caption.
			*/
			/**
			* 主题色: point the shell's accent ramp at the preset, and hand the 新会话 layer
			* its wash (layers.ts `themeTint` reads it back). The shell's default colour
			* chain — brand-primary, link, state-business-primary — all resolve through
			* `--dsw-static-deepseek-<step>`, so four steps re-colour every place the shell
			* paints its own default colour, its buttons included. 官方蓝 is the default
			* preset and publishes nothing (no ramp vars, wash null, gate down), so an
			* untouched install is byte-identical to the shell.
			*/
			applyThemeColor(theme) {
				const body = document.body;
				const preset = THEME_COLORS.find((entry) => entry.id === theme.themeColor) ?? THEME_COLORS[0];
				setThemeWash(preset.wash);
				if (preset.ramp === null) {
					delete body.dataset.lgTheme;
					for (const step of THEME_RAMP_STEPS) body.style.removeProperty(`--lg-theme-${step}`);
					return;
				}
				body.dataset.lgTheme = "";
				for (const step of THEME_RAMP_STEPS) body.style.setProperty(`--lg-theme-${step}`, preset.ramp[step]);
			}
			applyTextColors(theme) {
				const body = document.body;
				if (theme.textHue === null || theme.textLight === null) {
					delete body.dataset.lgText;
					for (const name of [
						"--lg-text-primary",
						"--lg-text-secondary",
						"--lg-text-tertiary",
						"--lg-text-caption"
					]) body.style.removeProperty(name);
					return;
				}
				body.dataset.lgText = "";
				const light = (offset) => hsl(theme.textHue, clamp(theme.textLight - offset, 0, 100));
				body.style.setProperty("--lg-text-primary", light(0));
				body.style.setProperty("--lg-text-secondary", light(14));
				body.style.setProperty("--lg-text-tertiary", light(28));
				body.style.setProperty("--lg-text-caption", light(40));
			}
			/**
			* Paint the wallpaper host for the active mode:
			* - `time` — the bucket's image from the plugin's directory; when the
			*   directory is unreachable (desktop, server down) only the dark base shows.
			* - `static` — one pinned directory image.
			*
			* A static pin only paints while it still resolves: a pin of `null` (an old
			* store's shape) or one the loaded listing does not know any more (the file
			* was deleted out-of-band) falls back to the rotation instead of going dark —
			* "installed" has to mean the 默认壁纸 shows, not a black wall. Before the
			* listing arrives the pin paints by URL as before, so a pinned boot has no
			* flash of the rotation while the directory loads.
			*/
			paintWallpaper(state) {
				if (this.wallpaper === void 0) return;
				const { mode, imageId } = state.wallpaper;
				let file;
				if (mode === "static" && imageId !== null) file = !(this.wallpaperUserFiles.length > 0 || this.wallpaperDefaultFiles.length > 0) || this.wallpaperUserFiles.includes(imageId) || this.wallpaperDefaultFiles.includes(imageId) ? imageId : this.timeWallpaperFile();
				else file = this.timeWallpaperFile();
				this.wallpaper.style.backgroundImage = file === null ? "" : `url("${wallpaperUrl(file)}")`;
			}
			/** The time mode's file for right now, from the bucket table; a bucket whose
			*  file is missing from the directory falls back to the set's first entry, so
			*  a pruned directory degrades instead of going dark. */
			timeWallpaperFile() {
				const hour = (/* @__PURE__ */ new Date()).getHours();
				const index = TIME_WALLPAPERS.findIndex((bucket) => bucket.start <= bucket.end ? hour >= bucket.start && hour < bucket.end : hour >= bucket.start || hour < bucket.end);
				if (index < 0) return null;
				const wanted = TIME_WALLPAPERS[index].file;
				if (this.wallpaperDefaultFiles.includes(wanted)) return wanted;
				return this.wallpaperDefaultFiles[0] ?? null;
			}
			/**
			* Keep the time mode alive: a wall-clock check per half minute catches the
			* bucket change and re-runs the apply pass, which repaints the wallpaper host.
			* Nothing else moves the wallpaper any more — the set does not follow the
			* shell's 亮暗, so there is no attribute to watch.
			*/
			startWallpaperClock() {
				if (this.wallpaperClock !== void 0) return;
				let lastKey = this.wallpaperClockKey();
				this.wallpaperClock = setInterval(() => {
					const key = this.wallpaperClockKey();
					if (key === lastKey) return;
					lastKey = key;
					this.apply(this.state);
				}, TIME_WALLPAPER_CHECK_MS);
			}
			/** What the time mode currently shows, as a change key. */
			/**
			* Re-apply when the shell flips its scheme: the `schemeGlass` layers' 浓度/亮度 are
			* scheme-driven (effectiveValues), so the paint has to follow. This is the ONLY
			* scheme dependence left in the skin — nothing here reads or writes the
			* preference itself, and there is no 亮暗 control (removed on request).
			*/
			startSchemeWatch() {
				if (this.schemeObserver !== void 0) return;
				this.schemeObserver = new MutationObserver(() => {
					this.apply(this.state);
				});
				this.schemeObserver.observe(document.body, {
					attributes: true,
					attributeFilter: ["data-ds-dark-theme"]
				});
			}
			wallpaperClockKey() {
				return String((/* @__PURE__ */ new Date()).getHours());
			}
			/**
			* Track the open chat: clicking a sidebar row moves the `data-lg-current`
			* marker to it, which is the lens's freshest-choice candidate (and the only
			* mark lists without ARIA selection ever get). Rows are generic — list rows
			* of any plugin alike. The scan is scheduled right here because the marker
			* is not in the host observer's attribute filter: a click must retarget the
			* lens this frame, not after the next sweep.
			*/
			currentKey = null;
			/** The sidebar root, cached for the document-level click listener. */
			sidebarRoot = null;
			/** The row currently carrying `data-lg-current` (see markCurrent). */
			markedRow = null;
			onRowClick = (event) => {
				const target = event.target;
				if (target === null) return;
				let sidebar = this.sidebarRoot;
				if (sidebar === null || !sidebar.isConnected) {
					sidebar = document.querySelector(COLUMN.sidebar);
					this.sidebarRoot = sidebar;
				}
				if (sidebar === null || !sidebar.contains(target)) return;
				const row = target.closest("[role=\"treeitem\"]") ?? target.closest("li");
				if (row === null || !sidebar.contains(row)) return;
				if (row.querySelector("[role=\"treeitem\"], li") === null) this.markCurrent(row);
				this.scheduleHostScan();
			};
			markCurrent(row) {
				if (this.markedRow !== null && this.markedRow !== row) this.markedRow.removeAttribute("data-lg-current");
				this.markedRow = row;
				row.setAttribute("data-lg-current", "");
				this.currentKey = rowIdentity(row);
				this.requestFlowSync();
			}
			/**
			* The shell re-renders the session list on every switch, which can discard
			* the marked node — re-find the row by its stable row key (or its title) and
			* re-mark it.
			*/
			restoreMarker() {
				if (this.currentKey === null) return;
				if (this.markedRow !== null && this.markedRow.isConnected) return;
				const sidebar = document.querySelector(COLUMN.sidebar);
				if (sidebar === null) return;
				for (const candidate of sidebar.querySelectorAll("[role=\"treeitem\"], li")) {
					if (rowIdentity(candidate) !== this.currentKey) continue;
					if (candidate.querySelector("[role=\"treeitem\"], li") !== null) continue;
					candidate.setAttribute("data-lg-current", "");
					this.markedRow = candidate;
					return;
				}
			}
			/** Remove the stylesheet, hosts, layers, body tag, and every `--lg-*` variable. */
			destroy() {
				if (this.sweepTimer !== void 0) clearInterval(this.sweepTimer);
				this.sweepTimer = void 0;
				if (this.hostScanTimer !== void 0) clearTimeout(this.hostScanTimer);
				this.hostScanTimer = void 0;
				this.revealBurstDeadline = 0;
				if (this.wallpaperClock !== void 0) clearInterval(this.wallpaperClock);
				this.wallpaperClock = void 0;
				this.schemeObserver?.disconnect();
				this.schemeObserver = void 0;
				this.hostObserver?.disconnect();
				this.hostObserver = void 0;
				this.markerObserver?.disconnect();
				this.markerObserver = void 0;
				this.attachedHosts.clear();
				this.nestedWarned.clear();
				this.nestedChecked.clear();
				document.removeEventListener("click", this.onRowClick, true);
				this.flow?.destroy();
				this.flow = void 0;
				this.flowHost?.remove();
				this.flowHost = void 0;
				this.style?.remove();
				this.style = void 0;
				this.wallpaper?.remove();
				this.wallpaper = void 0;
				this.surfacesHost?.remove();
				this.surfacesHost = void 0;
				for (const surface of this.surfaces.values()) surface.destroy();
				this.surfaces.clear();
				for (const refraction of this.refractions.values()) refraction.destroy();
				this.refractions.clear();
				delete document.body.dataset.lgSkin;
				delete document.body.dataset.lgSkinVersion;
				delete document.body.dataset.lgText;
				delete document.body.dataset.lgTheme;
				setThemeWash(null);
				for (const name of [...document.body.style]) if (name.startsWith("--lg-")) document.body.style.removeProperty(name);
			}
		};
		/** Stable identity of a list row: the shell's own row key, else its label. */
		function rowIdentity(row) {
			return row.getAttribute("data-row-key") ?? (row.textContent ?? "").trim();
		}
		/** Clamp `value` into `min..max`. */
		function clamp(value, min, max) {
			return Math.min(Math.max(value, min), max);
		}
		/**
		* The values a layer actually paints with. For a `schemeGlass` layer on auto that
		* means the scheme's 浓度/亮度 (layers.ts SCHEME_GLASS) instead of its own; every other
		* knob — and every other layer — is untouched. Exported because the panel must read
		* the same numbers the engine paints, and the two may not drift apart.
		*/
		function effectiveValues(layer, state) {
			const values = state.layers[layer.id] ?? defaultValues(layer);
			if (layer.schemeGlass !== true || state.schemeAuto[layer.id] === false) return values;
			const scheme = document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light";
			return {
				...values,
				...SCHEME_GLASS[scheme]
			};
		}
		/** Whether a layer's 浓度/亮度 are the scheme's right now (the panel's tab note). */
		function schemeDrives(layer, state) {
			return layer.schemeGlass === true && state.schemeAuto[layer.id] !== false;
		}
		/** CSS hsl() color from a hue and a lightness percentage (fixed modest saturation). */
		function hsl(hue, lightness) {
			return `hsl(${Math.round(hue)} 22% ${Math.round(lightness)}%)`;
		}
		/** A fresh state: every layer at its registry defaults. The wallpaper starts
		*  on the time × scheme set (the shipped default directory images). */
		function defaultState() {
			const layers = {};
			for (const layer of LAYERS) layers[layer.id] = defaultValues(layer);
			return {
				theme: defaultTheme(),
				wallpaper: {
					mode: "time",
					imageId: null
				},
				schemeAuto: {},
				layers
			};
		}
		/** The 主题 category's starting values: the shell's own text palette (no
		*  override — the `data-lg-text` gate stays down). */
		function defaultTheme() {
			return {
				textHue: null,
				textLight: null,
				themeColor: "blue"
			};
		}
		/**
		* Load the persisted state, falling back per knob to the registry defaults.
		* Reads both the current layout and the pre-registry (v1) one, where each layer
		* was a top-level key and four knobs had different names.
		*/
		function loadSkinState() {
			const state = defaultState();
			try {
				const current = localStorage.getItem(STORAGE_KEY);
				if (current !== null) {
					applySaved(state, JSON.parse(current));
					return state;
				}
				for (const key of PREVIOUS_STORAGE_KEYS) {
					const raw = localStorage.getItem(key);
					if (raw === null) continue;
					applySaved(state, migrateStored(JSON.parse(raw), key.endsWith("/v1")));
					return state;
				}
			} catch {}
			return state;
		}
		function saveSkinState(state) {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			} catch {}
		}
		/** Fold a saved document (current or migrated) into `state`, knob by knob. */
		function applySaved(state, saved) {
			const rawWallpaper = saved.wallpaper;
			if (rawWallpaper !== void 0) {
				if (rawWallpaper.mode === "time" || rawWallpaper.mode === "static") state.wallpaper.mode = rawWallpaper.mode;
				if (typeof rawWallpaper.imageId === "string" || rawWallpaper.imageId === null) state.wallpaper.imageId = rawWallpaper.imageId;
			}
			const rawAuto = saved.schemeAuto;
			if (rawAuto !== void 0 && typeof rawAuto === "object") {
				for (const [id, value] of Object.entries(rawAuto)) if (typeof value === "boolean") state.schemeAuto[id] = value;
			}
			const rawTheme = saved.theme;
			if (rawTheme !== void 0) {
				for (const key of ["textHue", "textLight"]) if (typeof rawTheme[key] === "number" || rawTheme[key] === null) state.theme[key] = rawTheme[key];
				if (THEME_COLORS.some((entry) => entry.id === rawTheme.themeColor)) state.theme.themeColor = rawTheme.themeColor;
			}
			const rawLayers = saved.layers ?? saved;
			for (const layer of LAYERS) {
				const group = rawLayers[layer.id];
				if (group === null || typeof group !== "object") continue;
				if (layer.id === "highlight" && typeof group.hue === "number") state.layers.highlight.tintHue = group.hue;
				for (const [key, value] of Object.entries(group)) {
					if (typeof value !== "number" || !(key in state.layers[layer.id])) continue;
					state.layers[layer.id][key] = value;
				}
				if (group.contrast === 1.2) state.layers[layer.id].contrast = 1;
				if (layer.id === "input" && group.rimStrength === 1.5) state.layers.input.rimStrength = .8;
				if (layer.id === "buttons" && group.hoverAlpha === 0) state.layers.buttons.hoverAlpha = .2;
			}
		}
		/**
		* Fold an older document into the current shape: rename the knobs v1 called
		* differently, split the pre-split `panel` group, merge the frosted blur every
		* version before v3 carried into the glass blur it composed with, and convert
		* the soft edge from the old 0–1 ratio to the px width that ratio described.
		*/
		function migrateStored(saved, legacy) {
			const document = legacy ? migrateLegacyNames(saved) : saved;
			const groups = Object.values(document.layers ?? document);
			for (const group of groups) {
				if (group === null || typeof group !== "object") continue;
				const frosted = group.frostBlur;
				if (typeof frosted === "number") {
					const glass = group.glassBlur;
					group.glassBlur = Math.sqrt((typeof glass === "number" ? glass : 0) ** 2 + frosted ** 2);
					delete group.frostBlur;
				}
				const softness = group.edgeSoftness;
				if (typeof softness === "number" && softness <= 1.5) group.edgeSoftness = softness * BAND_REFERENCE_PX;
			}
			return document;
		}
		/** Soft-edge axis the v1 ratio-to-px conversion resolves against: what the
		*  pre-registry field read 边缘柔边 against. Historical only — current fields
		*  read the knob against the capsule's height (refraction.ts). */
		const BAND_REFERENCE_PX = 300;
		/** Rewrite the v1 key names in place. */
		function migrateLegacyNames(legacy) {
			const panel = legacy.panel;
			if (panel !== void 0) for (const id of [
				"sidebar",
				"center",
				"rightbar"
			]) legacy[id] ??= { ...panel };
			const layers = {};
			for (const [key, value] of Object.entries(legacy)) {
				const id = LEGACY_LAYERS[key] ?? key;
				if (id === "wallpaper" || typeof value !== "object" || value === null) continue;
				const group = {};
				for (const [knob, raw] of Object.entries(value)) {
					const name = knob === "blur" ? "glassBlur" : LEGACY_KNOBS[knob] ?? knob;
					group[name] = raw;
				}
				layers[id] = group;
			}
			return {
				wallpaper: legacy.wallpaper,
				layers
			};
		}
		//#endregion
		//#region \0dsh-css:E:\dsh\starry-fork\packages\client\ui-liquid-glass\src\client\sun-panel.module.css.mjs
		const css = "._5frmAa_button{z-index:10001;color:#ffd479;cursor:pointer;backdrop-filter:blur(12px);background:#161820b8;border:1px solid #ffffff24;border-radius:50%;justify-content:center;align-items:center;width:44px;height:44px;padding:0;transition:background .15s,transform .15s,color .15s;display:flex;position:fixed;bottom:18px;right:18px;box-shadow:0 6px 24px #00000059}._5frmAa_button:hover{background:#262a38d9;transform:scale(1.05)}._5frmAa_buttonActive{color:#fff;background:#48506ce6}._5frmAa_buttonSvg{display:block}._5frmAa_panel{z-index:10001;box-sizing:border-box;backdrop-filter:blur(16px);color:#e8eaf2;user-select:none;background:#14161edb;border:1px solid #ffffff1a;border-radius:14px;width:292px;max-height:min(72vh,620px);padding:14px 16px 12px;font-family:-apple-system,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;font-size:12px;line-height:1.4;position:fixed;bottom:72px;right:18px;overflow-y:auto;box-shadow:0 12px 40px #00000073}._5frmAa_tabs{flex-wrap:wrap;gap:4px;margin-bottom:10px;display:flex}._5frmAa_category{gap:4px;margin-bottom:10px;display:flex}._5frmAa_category ._5frmAa_tab{text-align:center;flex:1;padding:5px 0;font-size:12px}._5frmAa_chips{flex-wrap:wrap;gap:4px;margin-bottom:2px;display:flex}._5frmAa_section{margin-bottom:4px}._5frmAa_sectionTitle{letter-spacing:.04em;color:#9aa1b5;margin:8px 0 6px;font-size:11px;font-weight:600}._5frmAa_tab{color:#b6bccd;cursor:pointer;background:#ffffff0a;border:1px solid #ffffff1a;border-radius:7px;padding:3px 8px;font-family:inherit;font-size:11px}._5frmAa_tab:hover{background:#ffffff1a}._5frmAa_tabActive{color:#14161b;background:#f5b942;border-color:#f5b942;font-weight:600}._5frmAa_panelHidden{display:none}._5frmAa_head{justify-content:space-between;align-items:center;margin-bottom:10px;display:flex}._5frmAa_title{letter-spacing:.02em;font-size:13px;font-weight:600}._5frmAa_close{color:#9aa1b5;cursor:pointer;background:0 0;border:none;border-radius:6px;padding:3px 7px;font-size:14px;line-height:1}._5frmAa_close:hover{color:#fff;background:#ffffff14}._5frmAa_row{align-items:center;gap:8px;margin-bottom:8px;display:flex}._5frmAa_label{white-space:nowrap;color:#b6bccd;flex:none;width:68px}._5frmAa_range{accent-color:#f5b942;cursor:pointer;flex:1;min-width:0;height:18px;margin:0}._5frmAa_value{text-align:right;color:#e8eaf2;font-variant-numeric:tabular-nums;flex:none;width:50px;font-family:ui-monospace,Consolas,monospace;font-size:11px}._5frmAa_foot{gap:8px;margin-top:10px;display:flex}._5frmAa_thumbs{flex-wrap:wrap;gap:8px;margin:2px 0 10px;display:flex}._5frmAa_thumbHint{color:#9aa1b5;margin:2px 0 10px;font-size:11px}._5frmAa_thumb{box-sizing:border-box;cursor:pointer;background-position:50%;background-size:cover;border:1px solid #ffffff2e;border-radius:6px;width:56px;height:36px;padding:0;position:relative}._5frmAa_thumb:hover{border-color:#ffffff73}._5frmAa_thumbActive{border-color:#f5b942;box-shadow:0 0 0 1px #f5b942}._5frmAa_thumbClose{color:#dfe3ee;text-align:center;cursor:pointer;background:#2a2d38;border:1px solid #ffffff40;border-radius:50%;width:15px;height:15px;padding:0;font-size:10px;line-height:13px;position:absolute;top:-6px;right:-6px}._5frmAa_thumbClose:hover{color:#fff;background:#d84a4a}._5frmAa_thumbAdd{color:#b6bccd;background:#ffffff0d;justify-content:center;align-items:center;font-size:16px;display:flex}._5frmAa_thumbAdd:hover{color:#fff;background:#ffffff1f}._5frmAa_ghost{color:#dfe3ee;cursor:pointer;background:#ffffff0f;border:1px solid #ffffff24;border-radius:8px;flex:1;padding:5px 0;font-family:inherit;font-size:12px}._5frmAa_ghost:hover{background:#ffffff1f}._5frmAa_swatches{gap:8px;margin:2px 0;display:flex}._5frmAa_swatch{cursor:pointer;border:1px solid #ffffff2e;border-radius:50%;width:22px;height:22px;padding:0;box-shadow:inset 0 0 0 1px #00000040}._5frmAa_swatch:hover{border-color:#fff6}._5frmAa_swatchActive{border-color:#f5b942;box-shadow:inset 0 0 0 1px #00000040,0 0 0 2px #f5b9428c}";
		const tagId = "@istarry/dsh-ui-liquid-glass/sun-panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@istarry/dsh-ui-liquid-glass";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var sun_panel_module_css_default = {
			"button": "_5frmAa_button",
			"buttonActive": "_5frmAa_buttonActive",
			"buttonSvg": "_5frmAa_buttonSvg",
			"category": "_5frmAa_category",
			"chips": "_5frmAa_chips",
			"close": "_5frmAa_close",
			"foot": "_5frmAa_foot",
			"ghost": "_5frmAa_ghost",
			"head": "_5frmAa_head",
			"label": "_5frmAa_label",
			"panel": "_5frmAa_panel",
			"panelHidden": "_5frmAa_panelHidden",
			"range": "_5frmAa_range",
			"row": "_5frmAa_row",
			"section": "_5frmAa_section",
			"sectionTitle": "_5frmAa_sectionTitle",
			"swatch": "_5frmAa_swatch",
			"swatchActive": "_5frmAa_swatchActive",
			"swatches": "_5frmAa_swatches",
			"tab": "_5frmAa_tab",
			"tabActive": "_5frmAa_tabActive",
			"tabs": "_5frmAa_tabs",
			"thumb": "_5frmAa_thumb",
			"thumbActive": "_5frmAa_thumbActive",
			"thumbAdd": "_5frmAa_thumbAdd",
			"thumbClose": "_5frmAa_thumbClose",
			"thumbHint": "_5frmAa_thumbHint",
			"thumbs": "_5frmAa_thumbs",
			"title": "_5frmAa_title",
			"value": "_5frmAa_value"
		};
		//#endregion
		//#region src/client/sun-panel.ts
		/**
		* The property panel: a bottom-right sun button opening a two-category sheet.
		*
		* 主题 tunes the environment: the wallpaper (switch, add, delete) and the text
		* colors (published over the shell's label tokens). 亮暗 is deliberately NOT
		* offered here — the shell's own settings own that preference, and nothing this
		* plugin paints depends on it any more.
		* 控件 holds one tab per glass surface — the capsule and every layer — each a
		* registry-built slider group. Every row is registry-driven; adding a knob or
		* a layer needs no change here.
		*
		* Plain DOM on purpose — the surfaces it tunes live outside the app's React
		* tree. Every listener is registered through `listen`/`sheetListen` so
		* `destroy` leaves nothing behind.
		*/
		/** Registry knob with the ranges a surface layer uses as-is. */
		const knob = (key) => ({ ...KNOBS[key] });
		/** The 悬停 tab's one knob (the 按钮 layer owns the value; see layerTab's `view`). */
		const HOVER_KNOBS = ["hoverAlpha"];
		/**
		* The capsule tab drives the LiquidGlass instance directly: its two shape
		* knobs first, then the same nine every layer exposes, in the same order.
		*/
		const CAPSULE_SLIDERS = [
			{
				key: "width",
				label: "宽度",
				min: 120,
				max: 640,
				step: 2,
				format: px
			},
			{
				key: "height",
				label: "高度",
				min: 80,
				max: 420,
				step: 2,
				format: px
			},
			knob("density"),
			knob("radius"),
			knob("refraction"),
			knob("edgeSoftness"),
			knob("glassBlur"),
			knob("contrast"),
			knob("brightness"),
			knob("saturation"),
			knob("tintHue"),
			knob("tintSaturation"),
			knob("rimStrength"),
			knob("borderWidth"),
			knob("borderOpacity"),
			knob("grain")
		];
		/**
		* The 主题 rows, grouped by the sheet's sections. The text pair starts unset
		* (`跟随壳层`): moving either knob starts the pair, 重置 returns it to the
		* shell's own palette.
		*/
		const THEME_SLIDERS = [{
			key: "textHue",
			label: "文字色相",
			min: 0,
			max: 360,
			step: 5,
			format: degrees,
			fallback: 220,
			placeholder: "跟随"
		}, {
			key: "textLight",
			label: "文字亮度",
			min: 5,
			max: 95,
			step: 1,
			format: (value) => `${Math.round(value)}%`,
			fallback: 60,
			placeholder: "跟随"
		}];
		/** The capsule tab drives the LiquidGlass instance directly. Resizing the
		*  sample re-scales every layer's refraction with it — the layers' lens IS
		*  this capsule (skin.setLensReference). */
		function capsuleTab(glass, skin) {
			const keyOf = (key) => key;
			const syncLens = () => {
				skin.setLensReference(glass.params.width, glass.params.height);
			};
			return {
				id: "capsule",
				label: "样本胶囊",
				sliders: CAPSULE_SLIDERS,
				read: (key) => glass.params[keyOf(key)],
				write: (key, value) => {
					glass.updateParams({ [keyOf(key)]: value });
					syncLens();
				},
				reset: () => {
					glass.updateParams(LIQUID_GLASS_DEFAULTS);
					syncLens();
				}
			};
		}
		/** One glass layer's tab: reads and writes its group of the shared state. */
		/**
		* A layer's tab. `view` builds a SECOND tab over the same state slot with a knob
		* subset and its own name — how 悬停浓度 got out of the 按钮 list and into a tab of
		* its own: same values object, same write path, and its 重置 restores only the
		* knobs it shows (resetting the whole layer from a one-knob tab would be a
		* surprise).
		*/
		function layerTab(layer, values, state, skin, view) {
			const commit = () => {
				skin.apply(state);
				saveSkinState(state);
			};
			const preset = THEME_COLORS.find((entry) => entry.id === state.theme.themeColor);
			const themeOwnsTint = layer.themeOwned === true && preset?.wash != null;
			const schemeGlass = layer.schemeGlass === true;
			const schemeAuto = schemeDrives(layer, state);
			const listed = (view?.knobs ?? layer.knobs).filter((key) => !(themeOwnsTint && (key === "tintHue" || key === "tintSaturation")));
			return {
				id: view?.id ?? layer.id,
				label: view?.label ?? layer.label,
				sliders: listed.map((key) => knob(key)),
				...themeOwnsTint ? { note: "这一层的颜色由「主题色」接管（选「官方蓝」可交回 色调 / 色调饱和度）" } : schemeGlass ? { note: () => schemeDrives(layer, state) ? "浓度 / 亮度 随亮暗自动（浅色 0.5 / 1.2，深色 0 / 0.5）；拖动其中任一即交回手动" : "浓度 / 亮度 已交回手动（按本页「重置本页」可回到随亮暗自动）" } : {},
				read: (key) => {
					return (schemeAuto ? effectiveValues(layer, state) : values)[key] ?? 0;
				},
				write: (key, value) => {
					if (schemeAuto && (key === "density" || key === "brightness")) state.schemeAuto[layer.id] = false;
					values[key] = value;
					commit();
				},
				reset: () => {
					if (layer.schemeGlass === true) delete state.schemeAuto[layer.id];
					if (view === void 0) {
						Object.assign(values, defaultValues(layer));
						commit();
						return;
					}
					const defaults = defaultValues(layer);
					for (const key of view.knobs) values[key] = defaults[key] ?? 0;
					commit();
				}
			};
		}
		/** The 主题 tab: reads and writes the shared theme group. */
		function themeTab(state, skin) {
			const theme = state.theme;
			const commit = () => {
				skin.apply(state);
				saveSkinState(state);
			};
			return {
				id: "theme",
				label: "主题",
				sliders: THEME_SLIDERS,
				read: (key) => theme[key],
				write: (key, value) => {
					theme[key] = value;
					if (key === "textHue" && theme.textLight === null) theme.textLight = 60;
					if (key === "textLight" && theme.textHue === null) theme.textHue = 220;
					commit();
				},
				reset: () => {
					Object.assign(theme, defaultTheme());
					commit();
				}
			};
		}
		/**
		* The wallpaper picker. The 默认壁纸 chip re-arms the time rotation — while it is
		* active the shipped set is the strip shown. EVERY tile pins (`static`) the image
		* it shows: the user's own uploads (which carry a corner × to delete) and the
		* shipped ones alike, because a shipped image is a bundled wallpaper and has to
		* be selectable, not merely a preview of the rotation. The shipped strip also
		* stays visible while one of ITS images is pinned, so the picked tile keeps its
		* ring instead of the whole strip vanishing under the pick. All add/delete writes
		* go through the node half into the directory under the Harness home.
		*/
		function wallpaperPicker(skin, state, commit) {
			return (container) => {
				const render = () => {
					container.replaceChildren();
					const status = document.createElement("div");
					status.className = sun_panel_module_css_default.thumbHint;
					const say = (text) => {
						status.textContent = text;
						window.setTimeout(() => {
							if (status.textContent === text) status.textContent = "";
						}, 4e3);
					};
					const chip = document.createElement("button");
					chip.type = "button";
					chip.className = sun_panel_module_css_default.tab;
					chip.textContent = "默认壁纸";
					chip.title = "随时间段自动轮换（默认）";
					chip.classList.toggle(sun_panel_module_css_default.tabActive, state.wallpaper.mode === "time");
					chip.addEventListener("click", () => {
						state.wallpaper.mode = "time";
						state.wallpaper.imageId = null;
						commit();
						render();
					});
					container.appendChild(chip);
					const strip = document.createElement("div");
					strip.className = sun_panel_module_css_default.thumbs;
					container.appendChild(strip);
					const upload = document.createElement("button");
					upload.type = "button";
					upload.className = `${sun_panel_module_css_default.thumb} ${sun_panel_module_css_default.thumbAdd}`;
					upload.textContent = "+";
					upload.title = "添加壁纸（存入插件壁纸目录）";
					const file = document.createElement("input");
					file.type = "file";
					file.accept = "image/*";
					file.style.display = "none";
					upload.addEventListener("click", () => {
						file.click();
					});
					file.addEventListener("change", () => {
						const picked = file.files?.[0];
						file.value = "";
						if (picked === void 0) return;
						say(`正在上传 ${picked.name}（${(picked.size / 1024 / 1024).toFixed(1)}MB）…`);
						addWallpaper(picked).then(async () => {
							await skin.reloadWallpapers();
							state.wallpaper.mode = "static";
							state.wallpaper.imageId = picked.name;
							commit();
							render();
						}).catch((error) => {
							render();
							const detail = error instanceof Error ? error.message : String(error);
							if (detail.includes("405")) say("上传失败：服务器还没更新（请重启 dsh 服务器后再试）");
							else if (detail.includes("413")) say("上传失败：图片超过 32MB");
							else if (detail.includes("Failed to fetch")) say("上传失败：连不上壁纸服务（此端没有 Web 服务？）");
							else say(`上传失败：${detail}`);
						});
					});
					strip.appendChild(upload);
					strip.appendChild(file);
					if (skin.wallpaperUserFiles.length === 0 && skin.wallpaperDefaultFiles.length === 0) {
						const hint = document.createElement("div");
						hint.className = sun_panel_module_css_default.thumbHint;
						hint.textContent = "壁纸目录不可用（此端没有 Web 服务）或目录为空";
						container.appendChild(hint);
						return;
					}
					const pinnedShipped = state.wallpaper.mode === "static" && (state.wallpaper.imageId ?? "").startsWith("Default/");
					if (state.wallpaper.mode === "time" || pinnedShipped) for (const name of skin.wallpaperDefaultFiles) {
						const thumb = document.createElement("button");
						thumb.type = "button";
						thumb.className = sun_panel_module_css_default.thumb;
						thumb.dataset.wallId = name;
						thumb.title = "默认壁纸 · " + name;
						thumb.style.backgroundImage = `url("${wallpaperUrl(name)}")`;
						thumb.addEventListener("click", () => {
							state.wallpaper.mode = "static";
							state.wallpaper.imageId = name;
							commit();
							render();
						});
						strip.appendChild(thumb);
					}
					for (const name of skin.wallpaperUserFiles) {
						const thumb = document.createElement("button");
						thumb.type = "button";
						thumb.className = sun_panel_module_css_default.thumb;
						thumb.dataset.wallId = name;
						thumb.title = name;
						thumb.style.backgroundImage = `url("${wallpaperUrl(name)}")`;
						thumb.addEventListener("click", () => {
							state.wallpaper.mode = "static";
							state.wallpaper.imageId = name;
							commit();
							render();
						});
						const close = document.createElement("span");
						close.className = sun_panel_module_css_default.thumbClose;
						close.textContent = "×";
						close.title = "删除壁纸（目录内文件一并删除）";
						close.addEventListener("click", (event) => {
							event.stopPropagation();
							deleteWallpaper(name).then(async () => {
								await skin.reloadWallpapers();
								if (state.wallpaper.imageId === name) {
									state.wallpaper.imageId = null;
									state.wallpaper.mode = "time";
								}
								commit();
								render();
							}).catch((error) => say("删除失败：" + (error instanceof Error ? error.message : String(error))));
						});
						thumb.appendChild(close);
						strip.appendChild(thumb);
					}
					const activeId = state.wallpaper.mode === "static" ? state.wallpaper.imageId : skin.currentTimeWallpaper();
					for (const thumb of strip.children) {
						const el = thumb;
						if (el.dataset.wallId === void 0) continue;
						el.classList.toggle(sun_panel_module_css_default.thumbActive, el.dataset.wallId === activeId);
					}
				};
				render();
			};
		}
		/** Inline SVG sun mark for the round button. */
		function sunIcon(className) {
			return `<svg class="${className}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7"/></svg>`;
		}
		var SunPanel = class {
			glass;
			skin;
			state;
			themeSpec;
			/** Rebuilt when the 主题色 changes (see buildTabs), so not readonly. */
			tabs;
			activeTab;
			category = "theme";
			button;
			panel;
			rows;
			foot;
			tabBar;
			/** Listeners of the currently rendered sheet; swapped on tab change. */
			sheetTeardown = [];
			/** Structural listeners living for the whole panel lifetime. */
			teardown = [];
			constructor(glass, state, skin) {
				this.glass = glass;
				this.skin = skin;
				this.state = state;
				this.themeSpec = themeTab(state, skin);
				this.tabs = this.buildTabs();
				this.activeTab = this.tabs[0];
				this.button = this.buildButton();
				const panel = document.createElement("div");
				panel.className = `${sun_panel_module_css_default.panel} ${sun_panel_module_css_default.panelHidden}`;
				panel.dataset.lgPanel = "";
				this.panel = panel;
				panel.appendChild(this.buildHead(panel));
				panel.appendChild(this.buildCategoryBar());
				const tabBar = this.buildTabBar();
				panel.appendChild(tabBar);
				this.tabBar = tabBar;
				this.rows = document.createElement("div");
				panel.appendChild(this.rows);
				this.foot = document.createElement("div");
				this.foot.className = sun_panel_module_css_default.foot;
				panel.appendChild(this.foot);
				this.syncCategoryChrome();
				this.activate(this.activeTab);
				this.startSchemeWatch();
			}
			/** Append the button and the sheet to `parent` (document.body). */
			/**
			* Re-render the sheet when the shell flips its scheme: the rows of a `schemeGlass`
			* layer show the scheme's 浓度/亮度 (skin.ts effectiveValues), so the numbers on
			* screen would otherwise be one theme stale. Read-only — the panel never writes
			* the preference.
			*/
			startSchemeWatch() {
				const observer = new MutationObserver(() => {
					if (this.category === "controls") this.renderSheet();
				});
				observer.observe(document.body, {
					attributes: true,
					attributeFilter: ["data-ds-dark-theme"]
				});
				this.teardown.push(() => observer.disconnect());
			}
			mount(parent) {
				parent.appendChild(this.panel);
				parent.appendChild(this.button);
			}
			/** Re-render the active sheet (used after async wallpaper loads). */
			rerender() {
				this.renderSheet();
			}
			listen(target, type, handler) {
				target.addEventListener(type, handler);
				this.teardown.push(() => {
					target.removeEventListener(type, handler);
				});
			}
			sheetListen(target, type, handler) {
				target.addEventListener(type, handler);
				this.sheetTeardown.push(() => {
					target.removeEventListener(type, handler);
				});
			}
			/** The tab list. Rebuilt when a 主题色 changes: which knobs a layer lists
			*  depends on the theme (the colour ones disappear while a preset owns the tint),
			*  and the specs are a snapshot — a stale list would keep showing them. */
			buildTabs() {
				return [capsuleTab(this.glass, this.skin), ...LAYERS.flatMap((layer) => {
					const values = this.state.layers[layer.id];
					const main = layerTab(layer, values, this.state, this.skin);
					if (layer.hover !== true) return [main];
					return [main, layerTab(layer, values, this.state, this.skin, {
						id: "hover",
						label: "悬停",
						knobs: HOVER_KNOBS
					})];
				})];
			}
			buildButton() {
				const button = document.createElement("button");
				button.type = "button";
				button.className = sun_panel_module_css_default.button;
				button.setAttribute("aria-label", "液态玻璃设置");
				button.title = "液态玻璃设置";
				button.innerHTML = sunIcon(sun_panel_module_css_default.buttonSvg);
				this.listen(button, "click", () => {
					const hidden = this.panel.classList.toggle(sun_panel_module_css_default.panelHidden);
					button.classList.toggle(sun_panel_module_css_default.buttonActive, !hidden);
					if (!hidden) this.activate(this.activeTab);
				});
				return button;
			}
			buildHead(panel) {
				const head = document.createElement("div");
				head.className = sun_panel_module_css_default.head;
				const title = document.createElement("span");
				title.className = sun_panel_module_css_default.title;
				title.textContent = "液态玻璃设置";
				const close = document.createElement("button");
				close.type = "button";
				close.className = sun_panel_module_css_default.close;
				close.textContent = "✕";
				close.setAttribute("aria-label", "关闭面板");
				this.listen(close, "click", () => {
					panel.classList.add(sun_panel_module_css_default.panelHidden);
					this.button.classList.remove(sun_panel_module_css_default.buttonActive);
				});
				head.append(title, close);
				return head;
			}
			/** The two top-level chips: 主题 / 控件. */
			buildCategoryBar() {
				const bar = document.createElement("div");
				bar.className = sun_panel_module_css_default.category;
				for (const entry of [{
					id: "theme",
					label: "主题"
				}, {
					id: "controls",
					label: "控件"
				}]) {
					const chip = document.createElement("button");
					chip.type = "button";
					chip.className = sun_panel_module_css_default.tab;
					chip.textContent = entry.label;
					chip.dataset.category = entry.id;
					this.listen(chip, "click", () => {
						this.switchCategory(entry.id);
					});
					bar.appendChild(chip);
				}
				return bar;
			}
			switchCategory(category) {
				this.category = category;
				this.syncCategoryChrome();
				this.renderSheet();
			}
			/** Which chips read active, and whether the layer tab strip shows at all. */
			syncCategoryChrome() {
				for (const node of this.panel.querySelectorAll("[data-category]")) node.classList.toggle(sun_panel_module_css_default.tabActive, node.dataset.category === this.category);
				this.tabBar.style.display = this.category === "controls" ? "" : "none";
			}
			buildTabBar() {
				const bar = document.createElement("div");
				bar.className = sun_panel_module_css_default.tabs;
				for (const tab of this.tabs) {
					const chip = document.createElement("button");
					chip.type = "button";
					chip.className = sun_panel_module_css_default.tab;
					chip.textContent = tab.label;
					chip.dataset.tab = tab.id;
					this.listen(chip, "click", () => {
						this.activate(tab);
					});
					bar.appendChild(chip);
				}
				return bar;
			}
			activate(tab) {
				this.activeTab = this.tabs.find((entry) => entry.id === tab.id) ?? tab;
				for (const node of this.tabBar.children) node.classList.toggle(sun_panel_module_css_default.tabActive, node.dataset.tab === tab.id);
				this.renderSheet();
			}
			/** Rebuild the sheet for the active category (listeners swapped with it). */
			renderSheet() {
				for (const dispose of this.sheetTeardown) dispose();
				this.sheetTeardown = [];
				this.rows.replaceChildren();
				if (this.category === "theme") this.renderThemeSheet();
				else this.renderControlsSheet();
			}
			/** The 主题 sheet: 壁纸 / 文字颜色. */
			renderThemeSheet() {
				const themeColor = document.createElement("div");
				const swatches = document.createElement("div");
				swatches.className = sun_panel_module_css_default.swatches;
				this.fillThemeSwatches(swatches);
				themeColor.appendChild(swatches);
				this.rows.appendChild(this.buildSection("主题色", themeColor));
				const wallpaper = document.createElement("div");
				const caption = document.createElement("div");
				caption.className = sun_panel_module_css_default.thumbHint;
				caption.textContent = "默认壁纸：随时间自动轮换 · 点缩略图固定一张 · ×删除 · ＋添加";
				wallpaper.appendChild(caption);
				const picker = document.createElement("div");
				wallpaperPicker(this.skin, this.state, () => {
					this.commit();
				})(picker);
				wallpaper.appendChild(picker);
				this.rows.appendChild(this.buildSection("壁纸", wallpaper));
				const text = document.createElement("div");
				const rows = /* @__PURE__ */ new Map();
				const syncRows = () => {
					for (const key of ["textHue", "textLight"]) {
						const parts = rows.get(key);
						if (parts === void 0) continue;
						const spec = slider(key);
						const current = this.themeSpec.read(key);
						parts.input.value = String(current ?? spec.fallback ?? spec.min);
						parts.value.textContent = current === null ? spec.placeholder ?? spec.format(spec.fallback ?? spec.min) : spec.format(current);
					}
				};
				for (const key of ["textHue", "textLight"]) {
					const row = this.buildRow(slider(key), this.themeSpec, syncRows);
					const input = row.querySelector("input");
					const value = row.querySelector(`.${sun_panel_module_css_default.value}`);
					if (input !== null && value !== null) rows.set(key, {
						input,
						value
					});
					text.appendChild(row);
				}
				this.rows.appendChild(this.buildSection("文字颜色", text));
				this.foot.replaceChildren(...this.buildThemeFoot());
			}
			/** The 主题色 swatches: label-free by request, so the colour IS the control.
			*  Clicking writes the id, commits, and re-marks in place (the container is
			*  discarded with the sheet, so the plain listener needs no teardown). */
			fillThemeSwatches(container) {
				container.replaceChildren();
				for (const preset of THEME_COLORS) {
					const chip = document.createElement("button");
					chip.type = "button";
					chip.className = sun_panel_module_css_default.swatch;
					chip.dataset.lgThemeChoice = preset.id;
					chip.style.background = preset.swatch;
					chip.setAttribute("aria-label", `主题色 ${preset.id}`);
					chip.classList.toggle(sun_panel_module_css_default.swatchActive, this.state.theme.themeColor === preset.id);
					chip.addEventListener("click", () => {
						this.state.theme.themeColor = preset.id;
						this.commit();
						this.tabs = this.buildTabs();
						this.activeTab = this.tabs.find((tab) => tab.id === this.activeTab.id) ?? this.tabs[0];
						this.fillThemeSwatches(container);
						this.renderSheet();
					});
					container.appendChild(chip);
				}
			}
			/** Apply the shared state and persist it: every row's write goes through
			*  here, so the engine and the stored copy can never disagree. */
			commit() {
				this.skin.apply(this.state);
				saveSkinState(this.state);
			}
			renderControlsSheet() {
				const spec = this.activeTab;
				const readNote = () => typeof spec.note === "function" ? spec.note() : spec.note;
				let note;
				const text = readNote();
				if (text !== void 0) {
					note = document.createElement("div");
					note.className = sun_panel_module_css_default.thumbHint;
					note.textContent = text;
					note.dataset.lgTabNote = "";
					this.rows.appendChild(note);
				}
				const refresh = () => {
					if (note === void 0) return;
					note.textContent = readNote() ?? "";
				};
				for (const row of spec.sliders) this.rows.appendChild(this.buildRow(row, spec, refresh));
				this.foot.replaceChildren(...this.buildControlsFoot());
			}
			buildSection(title, ...children) {
				const section = document.createElement("div");
				section.className = sun_panel_module_css_default.section;
				const head = document.createElement("div");
				head.className = sun_panel_module_css_default.sectionTitle;
				head.textContent = title;
				section.appendChild(head);
				section.append(...children);
				return section;
			}
			buildRow(spec, tab, afterWrite) {
				const row = document.createElement("div");
				row.className = sun_panel_module_css_default.row;
				const label = document.createElement("span");
				label.className = sun_panel_module_css_default.label;
				label.textContent = spec.label;
				const input = document.createElement("input");
				input.type = "range";
				input.className = sun_panel_module_css_default.range;
				input.min = String(spec.min);
				input.max = String(spec.max);
				input.step = String(spec.step);
				const initial = tab.read(spec.key);
				const unset = initial === null;
				input.value = String(unset ? spec.fallback ?? spec.min : initial);
				input.setAttribute("aria-label", spec.label);
				const value = document.createElement("span");
				value.className = sun_panel_module_css_default.value;
				value.textContent = unset ? spec.placeholder ?? spec.format(spec.fallback ?? spec.min) : spec.format(initial);
				this.sheetListen(input, "input", () => {
					const next = Number(input.value);
					tab.write(spec.key, next);
					value.textContent = spec.format(next);
					afterWrite?.();
				});
				row.append(label, input, value);
				return row;
			}
			buildThemeFoot() {
				const reset = document.createElement("button");
				reset.type = "button";
				reset.className = sun_panel_module_css_default.ghost;
				reset.textContent = "重置主题";
				this.sheetListen(reset, "click", () => {
					this.themeSpec.reset();
					this.renderSheet();
				});
				return [reset];
			}
			buildControlsFoot() {
				const reset = document.createElement("button");
				reset.type = "button";
				reset.className = sun_panel_module_css_default.ghost;
				reset.textContent = "重置本页";
				this.sheetListen(reset, "click", () => {
					this.activeTab.reset();
					this.renderSheet();
				});
				const buttons = [reset];
				const copy = document.createElement("button");
				copy.type = "button";
				copy.className = sun_panel_module_css_default.ghost;
				copy.textContent = "复制配置";
				this.sheetListen(copy, "click", () => {
					const payload = JSON.stringify({
						capsule: this.glass.params,
						theme: this.state.theme,
						layers: this.state.layers
					}, null, 2);
					const done = () => {
						copy.textContent = "已复制";
						window.setTimeout(() => {
							copy.textContent = "复制配置";
						}, 1200);
					};
					if (navigator.clipboard?.writeText !== void 0) navigator.clipboard.writeText(payload).then(done, () => {
						copy.textContent = "复制失败";
					});
					else {
						const holder = document.createElement("textarea");
						holder.value = payload;
						document.body.appendChild(holder);
						holder.select();
						document.execCommand("copy");
						holder.remove();
						done();
					}
				});
				buttons.push(copy);
				if (this.activeTab.id === "capsule") {
					const visibility = document.createElement("button");
					visibility.type = "button";
					visibility.className = sun_panel_module_css_default.ghost;
					visibility.textContent = this.glass.isVisible() ? "隐藏玻璃" : "显示玻璃";
					this.sheetListen(visibility, "click", () => {
						const show = visibility.textContent === "显示玻璃";
						this.glass.setVisible(show);
						visibility.textContent = show ? "隐藏玻璃" : "显示玻璃";
					});
					buttons.push(visibility);
				}
				return buttons;
			}
			/** Remove every element and listener this panel owns. */
			destroy() {
				for (const dispose of [...this.sheetTeardown, ...this.teardown]) dispose();
				this.sheetTeardown = [];
				this.teardown = [];
				this.panel.remove();
				this.button.remove();
			}
		};
		/** Look up a 主题 row spec by its state key. */
		function slider(key) {
			const spec = THEME_SLIDERS.find((entry) => entry.key === key);
			if (spec === void 0) throw new Error(`unknown theme slider "${key}"`);
			return spec;
		}
		//#endregion
		//#region src/client/index.ts
		function apply(ctx) {
			ctx.effect(() => {
				const skin = new SkinEngine();
				const glass = new LiquidGlass();
				let panel;
				try {
					skin.mount();
					skin.apply(skin.state);
					glass.appendTo(document.body);
					glass.setVisible(false);
					panel = new SunPanel(glass, skin.state, skin);
					panel.mount(document.body);
					(async () => {
						for (let attempt = 0; attempt < 10; attempt++) {
							await skin.reloadWallpapers();
							if (skin.wallpaperUserFiles.length > 0 || skin.wallpaperDefaultFiles.length > 0) break;
							await new Promise((resolve) => setTimeout(resolve, 1e3));
						}
						skin.apply(skin.state);
						panel?.rerender();
					})();
					return () => {
						panel?.destroy();
						glass.destroy();
						skin.destroy();
					};
				} catch (error) {
					panel?.destroy();
					glass.destroy();
					skin.destroy();
					throw error;
				}
			}, "ui-liquid-glass: liquid glass skin");
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map