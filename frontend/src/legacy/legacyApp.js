import { Viewer as MlyViewer } from "mapillary-js";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "mapillary-js/dist/mapillary.css";
import { createTrafficSignRegistry, resolveSignLabel } from "./trafficSignRegistry";

/* eslint-disable no-unused-vars, no-empty */
export function startLegacyMapillaryApp() {
	const mapillary = { Viewer: MlyViewer };
	// ===== CONFIG =====
	const DEFAULT_LAT = 16.074492656166598;
	const DEFAULT_LNG = 108.14910494442813;
	const DEFAULT_ZOOM = 18;
	const DEFAULT_PKEY = "1137674664114306";
	const STORAGE_KEY = "mapillary_token";
	const LOCAL_API = "http://localhost:3000/api/v1";
	const VIDEO_SUBMIT_URL_API = "https://emsimv10--pbl7-pipelineapi-web-dev.modal.run/pipeline/submit-url";
	const VIDEO_STATUS_URL_BASE = "https://emsimv10--pbl7-pipelineapi-web-dev.modal.run/pipeline/status";
	const VIDEO_STATUS_POLL_INTERVAL_MS = 20000;
	const VIDEO_STATUS_MAX_POLLS = 720;
	const RECENT_SEARCHES_KEY = "mapillary_recent_searches";
	const LOCAL_ONLY_MODE = true;
	const MAP_STYLES = {
		standard: [
			"https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
			"https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
			"https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
			"https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
		],
		light: [
			"https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
			"https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
			"https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
			"https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
		],
		dark: [
			"https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
			"https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
			"https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
			"https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
		],
	};
	const BASE_RASTER_PAINT = {
		"raster-saturation": 0.22,
		"raster-contrast": -0.02,
		"raster-brightness-min": 0.1,
		"raster-brightness-max": 1,
	};

	// ===== STATE =====
	let mlToken = LOCAL_ONLY_MODE ? "" : localStorage.getItem(STORAGE_KEY) || "";
	let viewer = null;
	let map = null;
	let currentImageId = null;
	let currentLngLat = null;
	let currentBearing = 0;
	let syncingFromViewer = false;
	let syncingFromMap = false;
	let urlUpdateTimer = null;
	let searchMarker = null;
	let seenImageHtmlMarkers = [];
	let searchAbortController = null;
	let searchSuggestionAbort = null;
	let activeSuggestions = [];
	let currentAnalysis = null;
	let activeAnalysisField = "scene_text";
	let analysisPopupOpen = false;
	let viewerExpanded = false;
	let viewerMinimized = false;
	let viewerClosed = false;
	let viewerAutoPlay = false;
	let autoPlayTimer = null;
	let viewerNavTargets = {};
	let uploadPanelOpen = false;
	let selectedUploadFile = null;
	let uploadedFrameResults = [];

	function loadRecentSearches() {
		try {
			const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
			const parsed = JSON.parse(raw || "[]");
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	function saveRecentSearch(entry) {
		if (!entry?.label) return;
		const recent = loadRecentSearches().filter(
			(item) => item.label !== entry.label,
		);
		recent.unshift({
			label: entry.label,
			lat: entry.lat,
			lon: entry.lon,
			kind: "recent",
		});
		localStorage.setItem(
			RECENT_SEARCHES_KEY,
			JSON.stringify(recent.slice(0, 6)),
		);
	}

	// ===== URL PARAMS =====
	function getUrlParams() {
		const p = new URLSearchParams(window.location.search);
		return {
			lat: parseFloat(p.get("lat")) || DEFAULT_LAT,
			lng: parseFloat(p.get("lng")) || DEFAULT_LNG,
			z: parseFloat(p.get("z")) || DEFAULT_ZOOM,
			pKey: p.get("pKey") || DEFAULT_PKEY,
		};
	}

	function updateUrl(lat, lng, z, pKey) {
		clearTimeout(urlUpdateTimer);
		urlUpdateTimer = setTimeout(() => {
			const url = new URL(window.location);
			url.searchParams.set("lat", lat.toFixed(7));
			url.searchParams.set("lng", lng.toFixed(7));
			url.searchParams.set("z", z.toFixed(2));
			if (pKey) url.searchParams.set("pKey", pKey);
			history.replaceState(null, "", url.toString());
		}, 150);
	}

	// ===== TOKEN FLOW =====
	const tokenPrompt = document.getElementById("tokenPrompt");
	const tokenInput = document.getElementById("tokenInput");
	const tokenSubmit = document.getElementById("tokenSubmit");
	const tokenError = document.getElementById("tokenError");

	if (LOCAL_ONLY_MODE) {
		tokenPrompt?.classList.add("hidden");
		initApp("");
	} else if (mlToken) {
		tokenPrompt.classList.add("hidden");
		initApp(mlToken);
	}

	tokenSubmit?.addEventListener("click", handleTokenSubmit);
	tokenInput?.addEventListener("keydown", (e) => {
		if (e.key === "Enter") handleTokenSubmit();
	});

	function handleTokenSubmit() {
		const val = tokenInput.value.trim();
		if (!val) {
			tokenError.textContent = "Vui lòng nhập token.";
			return;
		}
		tokenError.textContent = "";
		mlToken = val;
		localStorage.setItem(STORAGE_KEY, val);
		tokenPrompt.classList.add("hidden");
		initApp(val);
	}

	// ===== MAIN INIT =====
	function initApp(token) {
		const params = getUrlParams();
		if (!LOCAL_ONLY_MODE) {
			initViewer(token, params);
		} else {
			document.getElementById("viewerLoading")?.classList.add("hidden");
		}
		initMap(token, params);
		initDivider();
		initLayerToggles();
		initMapControls();
		initMapStyleControl();
		initAnalysisDots();
		initUploadPanel();
	}

	// ===== MAPILLARY VIEWER =====
	function initViewer(token, params) {
		const { Viewer: MlyViewer } = mapillary;

		viewer = new MlyViewer({
			accessToken: token,
			container: "viewer",
			imageId: params.pKey,
			component: {
				cover: false,
				bearing: true,
				direction: true,
				sequence: true,
				zoom: true,
				keyboard: true,
				pointer: true,
				image: true,
				cache: true,
			},
		});

		const loadingEl = document.getElementById("viewerLoading");

		viewer.on("load", () => {
			loadingEl.classList.add("hidden");
		});

		viewer.on("image", (e) => {
			const img = e.image;
			currentImageId = img.id;
			currentLngLat = img.lngLat;
			currentBearing = img.compassAngle || 0;

			// Fetch and show date
			fetchImageDate(img.id);
			fetchImageAnalysis(img.id);

			// Sync map
			if (!syncingFromMap && map) {
				syncingFromViewer = true;
				map.easeTo({
					center: [img.lngLat.lng, img.lngLat.lat],
					duration: 500,
				});
				updateCameraMarker(img.lngLat.lng, img.lngLat.lat, currentBearing);
				setTimeout(() => {
					syncingFromViewer = false;
				}, 600);
			}

			// Update URL
			if (map) {
				updateUrl(img.lngLat.lat, img.lngLat.lng, map.getZoom(), img.id);
			}
		});

		viewer.on("bearing", (e) => {
			currentBearing = e.bearing;
			if (currentLngLat && map) {
				updateCameraMarker(currentLngLat.lng, currentLngLat.lat, e.bearing);
			}
		});

		viewer.on("position", async () => {
			try {
				const pos = await viewer.getPosition();
				currentLngLat = pos;
				document.getElementById("infoCoords").textContent =
					`${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;

				if (!syncingFromMap && map) {
					syncingFromViewer = true;
					map.easeTo({ center: [pos.lng, pos.lat], duration: 300 });
					updateCameraMarker(pos.lng, pos.lat, currentBearing);
					setTimeout(() => {
						syncingFromViewer = false;
					}, 400);
				}
			} catch (e) {}
		});
	}

	// ===== MAPLIBRE MAP =====
	function initMap(token, params) {
		const encodedToken = encodeURIComponent(token);

		map = new maplibregl.Map({
			container: "map",
			center: [params.lng, params.lat],
			zoom: params.z,
			bearing: 0,
			pitch: 0,
			style: {
				version: 8,
				glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
				sources: {
					freshBase: {
						type: "raster",
						tiles: MAP_STYLES.standard,
						tileSize: 256,
					},
				},
				layers: [
					{
						id: "fresh-base",
						type: "raster",
						source: "freshBase",
						paint: BASE_RASTER_PAINT,
					},
				],
			},
		});

		map.addControl(new maplibregl.ScaleControl(), "bottom-right");

		map.on("load", () => {
			// Custom Vietnamese labels avoid relying on basemap labels for these islands.
			map.addSource("vietnam-island-labels", {
				type: "geojson",
				data: {
					type: "FeatureCollection",
					features: [
						{
							type: "Feature",
							properties: { name: "Hoàng Sa, Việt Nam", rank: "island" },
							geometry: { type: "Point", coordinates: [112.35, 16.5] },
						},
						{
							type: "Feature",
							properties: { name: "Trường Sa, Việt Nam", rank: "island" },
							geometry: { type: "Point", coordinates: [114.25, 10.2] },
						},
						{
							type: "Feature",
							properties: { name: "Việt Nam", rank: "country" },
							geometry: { type: "Point", coordinates: [107.8, 15.9] },
						},
						{
							type: "Feature",
							properties: { name: "Lào", rank: "country" },
							geometry: { type: "Point", coordinates: [103.8, 18.4] },
						},
						{
							type: "Feature",
							properties: { name: "Campuchia", rank: "country" },
							geometry: { type: "Point", coordinates: [104.9, 12.7] },
						},
						{
							type: "Feature",
							properties: { name: "Thái Lan", rank: "country" },
							geometry: { type: "Point", coordinates: [101.0, 15.4] },
						},
						{
							type: "Feature",
							properties: { name: "Trung Quốc", rank: "country" },
							geometry: { type: "Point", coordinates: [104.1, 35.8] },
						},
						{
							type: "Feature",
							properties: { name: "Philippines", rank: "country" },
							geometry: { type: "Point", coordinates: [122.9, 12.9] },
						},
						{
							type: "Feature",
							properties: { name: "Malaysia", rank: "country" },
							geometry: { type: "Point", coordinates: [102.3, 4.2] },
						},
						{
							type: "Feature",
							properties: { name: "Indonesia", rank: "country" },
							geometry: { type: "Point", coordinates: [113.9, -2.4] },
						},
						{
							type: "Feature",
							properties: { name: "Singapore", rank: "country" },
							geometry: { type: "Point", coordinates: [103.8, 1.35] },
						},
						{
							type: "Feature",
							properties: { name: "Myanmar", rank: "country" },
							geometry: { type: "Point", coordinates: [96.1, 21.9] },
						},
						{
							type: "Feature",
							properties: { name: "Ấn Độ", rank: "country" },
							geometry: { type: "Point", coordinates: [78.9, 22.8] },
						},
						{
							type: "Feature",
							properties: { name: "Nhật Bản", rank: "country" },
							geometry: { type: "Point", coordinates: [138.2, 37.6] },
						},
						{
							type: "Feature",
							properties: { name: "Hàn Quốc", rank: "country" },
							geometry: { type: "Point", coordinates: [127.8, 36.4] },
						},
						{
							type: "Feature",
							properties: { name: "Hoa Kỳ", rank: "country" },
							geometry: { type: "Point", coordinates: [-98.6, 39.8] },
						},
						{
							type: "Feature",
							properties: { name: "Úc", rank: "country" },
							geometry: { type: "Point", coordinates: [134.5, -25.7] },
						},
					],
				},
			});

			map.addLayer({
				id: "vietnam-island-labels",
				type: "symbol",
				source: "vietnam-island-labels",
				minzoom: 1,
				layout: {
					"text-field": ["get", "name"],
					"text-font": ["Open Sans Bold"],
					"text-size": [
						"interpolate",
						["linear"],
						["zoom"],
						1,
						["match", ["get", "rank"], "island", 13, 12],
						6,
						["match", ["get", "rank"], "island", 17, 15],
					],
					"text-anchor": "center",
					"text-allow-overlap": true,
					"text-ignore-placement": true,
				},
				paint: {
					"text-color": [
						"match",
						["get", "rank"],
						"island",
						"#d13030",
						"#168a4c",
					],
					"text-halo-color": "rgba(255,255,255,0.98)",
					"text-halo-width": 2.6,
				},
			});

			if (!LOCAL_ONLY_MODE) {
				// ===== COVERAGE SOURCE =====
				map.addSource("mly-coverage", {
					type: "vector",
					tiles: [
						`https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${encodedToken}`,
					],
					minzoom: 0,
					maxzoom: 14,
				});

				// Sequence lines (green coverage)
				map.addLayer({
					id: "mly-sequences",
					type: "line",
					source: "mly-coverage",
					"source-layer": "sequence",
					minzoom: 6,
					layout: { "line-cap": "round", "line-join": "round" },
					paint: {
						"line-color": "#05CB63",
						"line-width": [
							"interpolate",
							["linear"],
							["zoom"],
							6,
							1,
							14,
							2,
							18,
							3,
						],
						"line-opacity": 0.75,
					},
				});

				// Image dots
				map.addLayer({
					id: "mly-images",
					type: "circle",
					source: "mly-coverage",
					"source-layer": "image",
					minzoom: 14,
					paint: {
						"circle-radius": [
							"interpolate",
							["linear"],
							["zoom"],
							14,
							3,
							20,
							6,
						],
						"circle-color": "#ffffff",
						"circle-stroke-color": "#05CB63",
						"circle-stroke-width": 2,
						"circle-opacity": 0.9,
					},
				});
			}

			// ===== MAP FEATURES (POINTS) — served from local backend MVT =====
			map.addSource("mly-features", {
				type: "vector",
				tiles: [
					`${LOCAL_API.replace("/api/v1", "")}/api/v1/tiles/map-features/{z}/{x}/{y}.mvt?scope=has-images`,
				],
				minzoom: 14,
				maxzoom: 14,
			});

			map.addLayer({
				id: "mly-feature-points",
				type: "symbol",
				source: "mly-features",
				"source-layer": "point",
				minzoom: 14,
				layout: {
					"icon-image": ["concat", "pt:", ["get", "value"]],
					"icon-size": [
						"interpolate",
						["linear"],
						["zoom"],
						14,
						0.6,
						18,
						0.85,
						20,
						1.0,
					],
					"icon-allow-overlap": true,
					"icon-ignore-placement": true,
					"icon-rotation-alignment": "viewport",
					"icon-pitch-alignment": "viewport",
				},
			});

			// ===== TRAFFIC SIGNS — served from local backend MVT =====
			map.addSource("mly-signs", {
				type: "vector",
				tiles: [
					`${LOCAL_API.replace("/api/v1", "")}/api/v1/tiles/traffic-signs/{z}/{x}/{y}.mvt?scope=has-images`,
				],
				minzoom: 14,
				maxzoom: 14,
			});

			map.addLayer({
				id: "mly-traffic-signs",
				type: "symbol",
				source: "mly-signs",
				"source-layer": "traffic_sign",
				minzoom: 14,
				layout: {
					"icon-image": ["concat", "sg:", ["get", "value"]],
					"icon-size": [
						"interpolate",
						["linear"],
						["zoom"],
						14,
						0.5,
						18,
						0.7,
						20,
						0.9,
					],
					"icon-allow-overlap": true,
					"icon-ignore-placement": true,
					"icon-rotation-alignment": "viewport",
					"icon-pitch-alignment": "viewport",
				},
			});

			// ===== CAMERA MARKER SOURCE =====
			map.addSource("camera-point", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});

			map.addSource("camera-cone", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});

			// Camera cone fill
			map.addLayer({
				id: "camera-cone-fill",
				type: "fill",
				source: "camera-cone",
				paint: {
					"fill-color": "#05CB63",
					"fill-opacity": 0.2,
				},
			});

			// Camera cone outline
			map.addLayer({
				id: "camera-cone-line",
				type: "line",
				source: "camera-cone",
				paint: {
					"line-color": "#05CB63",
					"line-width": 2,
					"line-opacity": 0.6,
				},
			});

			// Camera dot
			map.addLayer({
				id: "camera-dot",
				type: "circle",
				source: "camera-point",
				paint: {
					"circle-radius": 7,
					"circle-color": "#05CB63",
					"circle-stroke-color": "#ffffff",
					"circle-stroke-width": 3,
				},
			});

			// Initial camera marker
			if (params.lat && params.lng) {
				updateCameraMarker(params.lng, params.lat, 0);
			}

			// ===== HOVER & SELECTION RING LAYERS =====
			const EMPTY_FC = { type: "FeatureCollection", features: [] };

			map.addSource("feature-hover", { type: "geojson", data: EMPTY_FC });
			map.addSource("feature-selected", { type: "geojson", data: EMPTY_FC });

			// Selected ring (larger, colored fill)
			map.addLayer({
				id: "feature-selected-ring",
				type: "circle",
				source: "feature-selected",
				paint: {
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						14,
						14,
						20,
						24,
					],
					"circle-color": [
						"match",
						["get", "kind"],
						"sign",
						"rgba(255,132,0,0.18)",
						"rgba(124,58,237,0.18)",
					],
					"circle-stroke-color": [
						"match",
						["get", "kind"],
						"sign",
						"#ff8400",
						"#7c3aed",
					],
					"circle-stroke-width": 3,
				},
			});

			// Hover ring (white for features, green for images)
			map.addLayer({
				id: "feature-hover-ring",
				type: "circle",
				source: "feature-hover",
				paint: {
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						14,
						11,
						20,
						19,
					],
					"circle-color": [
						"match",
						["get", "kind"],
						"image",
						"rgba(5,203,99,0.15)",
						"rgba(255,255,255,0)",
					],
					"circle-stroke-color": [
						"match",
						["get", "kind"],
						"image",
						"#05CB63",
						"#ffffff",
					],
					"circle-stroke-width": 2.5,
					"circle-stroke-opacity": 0.9,
				},
			});

			// ===== HIT TESTING HELPERS =====
			const FEATURE_LAYERS = ["mly-feature-points", "mly-traffic-signs"];
			const IMAGE_LAYERS = ["mly-images", "mly-sequences"];
			let hoveredKey = null;
			let selectedKey = null;

			function featureKey(f) {
				return `${f.layer.id}|${f.properties.id || ""}|${f.geometry.coordinates.join(",")}`;
			}

			function getFeatureAtPoint(point, padding) {
				const bbox = [
					[point.x - padding, point.y - padding],
					[point.x + padding, point.y + padding],
				];
				return (
					map.queryRenderedFeatures(bbox, { layers: FEATURE_LAYERS })[0] || null
				);
			}

			function setRingData(sourceId, feature) {
				const kind =
					feature.layer.id === "mly-traffic-signs" ? "sign" : "point";
				map.getSource(sourceId).setData({
					type: "FeatureCollection",
					features: [
						{
							type: "Feature",
							geometry: feature.geometry,
							properties: { kind, value: feature.properties.value || "" },
						},
					],
				});
			}

			function clearRing(sourceId) {
				const src = map.getSource(sourceId);
				if (src) src.setData(EMPTY_FC);
			}

			// ===== HOVER WITH PREVIEW =====
			const hoverPreview = document.getElementById("imageHoverPreview");
			const hoverImg = document.getElementById("imageHoverImg");
			let hoveredImageId = null;
			const previewTimeout = null;

			map.on("mousemove", (e) => {
				// Coords
				document.getElementById("coordsDisplay").textContent =
					`${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)} | Z${map.getZoom().toFixed(1)}`;

				// Check feature hit (padded for easier hover)
				const feat = getFeatureAtPoint(e.point, 12);

				if (feat) {
					map.getCanvas().style.cursor = "pointer";
					const key = featureKey(feat);
					if (key !== hoveredKey) {
						hoveredKey = key;
						setRingData("feature-hover", feat);
					}
					hideImagePreview();
					return;
				}

				// Check image dots for hover preview + ring (both Coverage AND Local DB)
				const aiPointLayers = ["ai-object-points-dots", "ai-traffic-sign-points-dots"].filter((id) =>
					map.getLayer(id),
				);
				const objectHit = aiPointLayers.length
					? map.queryRenderedFeatures(
							[
								[e.point.x - 8, e.point.y - 8],
								[e.point.x + 8, e.point.y + 8],
							],
							{ layers: aiPointLayers },
						)[0]
					: null;
				if (objectHit) {
					map.getCanvas().style.cursor = "pointer";
					if (hoveredKey) {
						hoveredKey = null;
						clearRing("feature-hover");
					}
					if (map.getSource("local-hover"))
						map
							.getSource("local-hover")
							.setData({ type: "FeatureCollection", features: [] });
					if (map.getSource("local-compass"))
						map
							.getSource("local-compass")
							.setData({ type: "FeatureCollection", features: [] });
					hideImagePreview();
					return;
				}

				const imgLayers = [];
				if (!LOCAL_ONLY_MODE && map.getLayer("mly-images"))
					imgLayers.push("mly-images");
				if (map.getLayer("local-images-dots"))
					imgLayers.push("local-images-dots");
				if (map.getLayer("search-results-dots"))
					imgLayers.push("search-results-dots");

				const imgHit = map.queryRenderedFeatures(
					[
						[e.point.x - 8, e.point.y - 8],
						[e.point.x + 8, e.point.y + 8],
					],
					{ layers: imgLayers },
				)[0];

				if (imgHit) {
					map.getCanvas().style.cursor = "pointer";
					if (hoveredKey) {
						hoveredKey = null;
						clearRing("feature-hover");
					}

					const isLocal =
						imgHit.layer.id === "local-images-dots" ||
						imgHit.layer.id === "search-results-dots";
					const imgId = imgHit.properties.id;
					const ringColor = isLocal ? "local" : "image";

					// Show hover ring — cyan for local, green for coverage
					const emptyFC = { type: "FeatureCollection", features: [] };
					if (isLocal && map.getSource("local-hover")) {
						map.getSource("local-hover").setData({
							type: "FeatureCollection",
							features: [
								{ type: "Feature", geometry: imgHit.geometry, properties: {} },
							],
						});
						clearRing("feature-hover");

						// Show compass fan (mini cone showing camera direction)
						const compass = imgHit.properties.compass_angle;
						if (compass != null && map.getSource("local-compass")) {
							const [lng, lat] = imgHit.geometry.coordinates;
							const fanFov = 70;
							const fanDist = 8; // meters
							const fanSteps = 8;
							const fanCoords = [[lng, lat]];
							for (let fi = 0; fi <= fanSteps; fi++) {
								const angle = compass - fanFov / 2 + (fanFov * fi) / fanSteps;
								fanCoords.push(offsetPoint(lng, lat, angle, fanDist));
							}
							fanCoords.push([lng, lat]);
							map.getSource("local-compass").setData({
								type: "FeatureCollection",
								features: [
									{
										type: "Feature",
										geometry: { type: "Polygon", coordinates: [fanCoords] },
										properties: {},
									},
								],
							});
						}
					} else {
						map.getSource("feature-hover").setData({
							type: "FeatureCollection",
							features: [
								{
									type: "Feature",
									geometry: imgHit.geometry,
									properties: { kind: "image" },
								},
							],
						});
						if (map.getSource("local-hover"))
							map.getSource("local-hover").setData(emptyFC);
						if (map.getSource("local-compass"))
							map.getSource("local-compass").setData(emptyFC);
					}

					// Show thumbnail preview
					if (imgId && String(imgId) !== String(hoveredImageId)) {
						hoveredImageId = imgId;
						showImagePreview(String(imgId), e.originalEvent);
					} else {
						positionPreview(e.originalEvent);
					}
					return;
				}

				// Check sequences for cursor
				const seqHit =
					!LOCAL_ONLY_MODE && map.getLayer("mly-sequences")
						? map.queryRenderedFeatures(
								[
									[e.point.x - 6, e.point.y - 6],
									[e.point.x + 6, e.point.y + 6],
								],
								{ layers: ["mly-sequences"] },
							)[0]
						: null;
				map.getCanvas().style.cursor = seqHit ? "pointer" : "";

				if (hoveredKey) {
					hoveredKey = null;
					clearRing("feature-hover");
				}
				if (map.getSource("local-hover"))
					map
						.getSource("local-hover")
						.setData({ type: "FeatureCollection", features: [] });
				if (map.getSource("local-compass"))
					map
						.getSource("local-compass")
						.setData({ type: "FeatureCollection", features: [] });
				hideImagePreview();
			});

			function showImagePreview(imageId, evt) {
				clearTimeout(previewTimeout);
				fetch(`${LOCAL_API}/images/provider/${imageId}`)
					.then((r) => r.json())
					.then((json) => {
						if (!json.data || hoveredImageId !== imageId) return;
						if (json.data.thumb_256_url) {
							hoverImg.src = `http://localhost:3000${json.data.thumb_256_url}`;
						}
						hoverPreview.dataset.summary = "";
						hoverPreview.classList.remove("has-summary");
						hoverPreview.style.display = "block";
					})
					.catch(() => {});
				positionPreview(evt);
			}

			function positionPreview(evt) {
				if (hoverPreview.style.display === "none") return;
				hoverPreview.style.left = evt.clientX + 16 + "px";
				hoverPreview.style.top = evt.clientY - 130 + "px";
			}

			function hideImagePreview() {
				hoveredImageId = null;
				hoverPreview.style.display = "none";
				hoverPreview.dataset.summary = "";
				hoverPreview.classList.remove("has-summary");
				hoverImg.src = "";
			}

			map.on("mouseleave", () => {
				hideImagePreview();
				clearRing("feature-hover");
				hoveredKey = null;
			});

			// ===== CLICK =====
			map.on("click", (e) => {
				hideImagePreview();

				// 1. Check feature points/signs first
				const feat = getFeatureAtPoint(e.point, 12);
				if (feat) {
					selectedKey = featureKey(feat);
					setRingData("feature-selected", feat);
					const val = feat.properties.value || "Unknown";
					const featureId = feat.properties.id;
					const isSigns = feat.layer.id === "mly-traffic-signs";

					// Open detection panel with images
					if (featureId) {
						const label = isSigns
							? SIGN_TYPES_MAP[val]?.label ||
								val.replace(/--/g, " › ").replace(/_/g, " ")
							: POINT_TYPES_MAP[val]?.label || val;
						const iconUrl = isSigns
							? getSignIconUrl(val)
							: getPointIconUrl(val);
						openDetectionPanel(
							featureId,
							label,
							iconUrl,
							feat.geometry.coordinates,
						);
					}

					// Also navigate to nearest image
					findNearestImage(
						feat.geometry.coordinates[0],
						feat.geometry.coordinates[1],
					);
					return;
				}

				const aiPointLayers = ["ai-object-points-dots", "ai-traffic-sign-points-dots"].filter((id) =>
					map.getLayer(id),
				);
				const objectHit = aiPointLayers.length
					? map.queryRenderedFeatures(
							[
								[e.point.x - 10, e.point.y - 10],
								[e.point.x + 10, e.point.y + 10],
							],
							{ layers: aiPointLayers },
						)[0]
					: null;
				if (objectHit) {
					openAiObjectDetectionPanel(
						objectHit.properties,
						objectHit.geometry?.coordinates || null,
					);
					selectedKey = null;
					return;
				}

				const seenImgLayers = ["object-seen-images-dots"].filter((id) => map.getLayer(id));
				const seenImgHit = seenImgLayers.length
					? map.queryRenderedFeatures(
							[
								[e.point.x - 12, e.point.y - 12],
								[e.point.x + 12, e.point.y + 12],
							],
							{ layers: seenImgLayers },
						)[0]
					: null;
				if (seenImgHit?.properties?.image_id) {
					openObjectImageModalFromMap(
						String(seenImgHit.properties.image_id),
						seenImgHit.properties.instance_id,
					);
					return;
				}

				// 2. Check image dots (Coverage + Local DB)
				const clickImgLayers = [];
				if (!LOCAL_ONLY_MODE && map.getLayer("mly-images"))
					clickImgLayers.push("mly-images");
				if (map.getLayer("local-images-dots"))
					clickImgLayers.push("local-images-dots");
				if (map.getLayer("search-results-dots"))
					clickImgLayers.push("search-results-dots");

				const imgHit = map.queryRenderedFeatures(
					[
						[e.point.x - 6, e.point.y - 6],
						[e.point.x + 6, e.point.y + 6],
					],
					{ layers: clickImgLayers },
				)[0];
				if (imgHit) {
					const imageId = imgHit.properties.id;
					const isLocal = imgHit.layer.id === "local-images-dots";
					const [selectedLng, selectedLat] = imgHit.geometry.coordinates;
					currentLngLat = { lng: selectedLng, lat: selectedLat };
					currentBearing =
						imgHit.properties.compass_angle || currentBearing || 0;
					updateCameraMarker(selectedLng, selectedLat, currentBearing);

					// Show selected ring
					if (isLocal && map.getSource("local-selected")) {
						map.getSource("local-selected").setData({
							type: "FeatureCollection",
							features: [
								{ type: "Feature", geometry: imgHit.geometry, properties: {} },
							],
						});
						clearRing("feature-selected");
					} else {
						if (map.getSource("local-selected")) {
							map
								.getSource("local-selected")
								.setData({ type: "FeatureCollection", features: [] });
						}
					}

					if (imageId) navigateViewer(String(imageId));
					selectedKey = null;
					return;
				}

				// 3. Check sequence lines
				const seqHit =
					!LOCAL_ONLY_MODE && map.getLayer("mly-sequences")
						? map.queryRenderedFeatures(
								[
									[e.point.x - 8, e.point.y - 8],
									[e.point.x + 8, e.point.y + 8],
								],
								{ layers: ["mly-sequences"] },
							)[0]
						: null;
				if (seqHit) {
					const imageId = seqHit.properties.image_id || seqHit.properties.id;
					if (imageId) navigateViewer(String(imageId));
					else findNearestImage(e.lngLat.lng, e.lngLat.lat);
					selectedKey = null;
					clearRing("feature-selected");
					return;
				}

				// 4. Clicked empty map — clear selection
				selectedKey = null;
				clearRing("feature-selected");
				if (map.getSource("local-selected")) {
					map
						.getSource("local-selected")
						.setData({ type: "FeatureCollection", features: [] });
				}
				if (currentPopup) currentPopup.remove();
				closeDetectionPanel();
			});

			// Update URL on map move
			map.on("moveend", () => {
				if (!syncingFromViewer) {
					const c = map.getCenter();
					updateUrl(c.lat, c.lng, map.getZoom(), currentImageId);
				}
			});

			// Setup icon loading & filter panels
			setupIconLoading();
			initFilterPanels();

			// ===== LOCAL API LAYER =====
			// Sources — use buffer: true to let MapLibre process on worker thread
			map.addSource("local-images", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
				buffer: 64,
			});
			map.addSource("local-lines", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
				buffer: 64,
			});
			map.addSource("local-hover", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});
			map.addSource("local-selected", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});
			map.addSource("local-compass", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});
			map.addSource("search-results", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});
			map.addSource("ai-object-points", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});
			map.addSource("object-seen-images", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});

			// Sequence lines — cyan, like coverage green lines
			map.addLayer({
				id: "local-lines-layer",
				type: "line",
				source: "local-lines",
				minzoom: 10,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": "#05CB63",
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						10,
						1.2,
						14,
						2.4,
						18,
						3.8,
					],
					"line-opacity": 0.82,
				},
			});

			// Image dots — white with cyan border
			map.addLayer({
				id: "local-images-dots",
				type: "circle",
				source: "local-images",
				minzoom: 14,
				paint: {
					"circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 20, 6],
					"circle-color": "#ffffff",
					"circle-stroke-color": "#05CB63",
					"circle-stroke-width": 2,
					"circle-opacity": 0.9,
				},
			});

			// Compass fan (mini cone) on hover
			map.addLayer({
				id: "local-compass-fill",
				type: "fill",
				source: "local-compass",
				paint: {
					"fill-color": "#00bdff",
					"fill-opacity": 0.25,
				},
			});
			map.addLayer({
				id: "local-compass-line",
				type: "line",
				source: "local-compass",
				paint: {
					"line-color": "#00bdff",
					"line-width": 2,
					"line-opacity": 0.6,
				},
			});

			// Hover ring
			map.addLayer({
				id: "local-hover-ring",
				type: "circle",
				source: "local-hover",
				paint: {
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						14,
						11,
						20,
						19,
					],
					"circle-color": "rgba(0,189,255,0.15)",
					"circle-stroke-color": "#00bdff",
					"circle-stroke-width": 2.5,
					"circle-stroke-opacity": 0.9,
				},
			});

			// Selected ring
			map.addLayer({
				id: "local-selected-ring",
				type: "circle",
				source: "local-selected",
				paint: {
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						14,
						14,
						20,
						24,
					],
					"circle-color": "rgba(0,189,255,0.18)",
					"circle-stroke-color": "#00bdff",
					"circle-stroke-width": 3,
				},
			});

			map.addLayer({
				id: "search-results-dots",
				type: "circle",
				source: "search-results",
				paint: {
					"circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 4, 18, 7],
					"circle-color": "#ff7a59",
					"circle-stroke-color": "#ffffff",
					"circle-stroke-width": 2,
					"circle-opacity": 0.95,
				},
			});

			map.addLayer({
				id: "ai-object-points-dots",
				type: "symbol",
				source: "ai-object-points",
				minzoom: 14,
				filter: ["!", ["has", "sign_value"]],
				layout: {
					"icon-image": ["concat", "pt:", ["get", "icon_value"]],
					"icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.72, 20, 1.05],
					"icon-allow-overlap": true,
					"icon-ignore-placement": true,
				},
			});

			map.addLayer({
				id: "ai-traffic-sign-points-dots",
				type: "symbol",
				source: "ai-object-points",
				minzoom: 14,
				filter: ["has", "sign_value"],
				layout: {
					"icon-image": ["concat", "sg:", ["get", "sign_value"]],
					"icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.58, 20, 0.95],
					"icon-allow-overlap": true,
					"icon-ignore-placement": true,
				},
			});

			// Invisible hit targets; numbered pins are HTML markers (seen-image-seq-marker).
			map.addLayer({
				id: "object-seen-images-dots",
				type: "circle",
				source: "object-seen-images",
				minzoom: 12,
				paint: {
					"circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 14, 16, 16, 20, 18],
					"circle-opacity": 0,
				},
			});

			function isViewableSequenceImage(img) {
				if (!img) return false;
				if (img.has_image === true || img.has_thumb === true || img.is_viewable === true) return true;
				if (img.thumb_256_url || img.thumb_1024_url || img.image_path) return true;
				if (String(img.provider_image_id || "").startsWith("ai-")) return true;
				return img.status === "downloaded" || img.provider === "ai_upload";
			}

			// Build sequence lines from sorted images. A sequence is rendered only if at least one frame is viewable;
			// missing middle frames stay in the LineString so playback and route continuity remain intact.
			function buildSequenceLines(images) {
				const lines = [];
				const groups = {};
				for (const img of images) {
					if (!img.sequence_id) continue;
					if (!groups[img.sequence_id]) groups[img.sequence_id] = [];
					groups[img.sequence_id].push(img);
				}

				for (const seqId of Object.keys(groups)) {
					const seqImages = groups[seqId];
					if (seqImages.length < 2) continue;
					if (!seqImages.some(isViewableSequenceImage)) continue;
					seqImages.sort(
						(a, b) => new Date(a.captured_at) - new Date(b.captured_at),
					);
					const coords = seqImages.map((img) => [img.lon, img.lat]);
					lines.push({
						type: "Feature",
						geometry: { type: "LineString", coordinates: coords },
						properties: { sequence_id: seqId },
					});
				}
				return { type: "FeatureCollection", features: lines };
			}

			// Fetch & render local images — with debounce + abort
			let _loadAbort = null;
			let _loadTimer = null;
			let _lastBbox = "";

			async function loadAiObjectPoints(bbox, signal) {
				if (!map.getSource("ai-object-points")) return;
				const res = await fetch(`${LOCAL_API}/ai-object-points?bbox=${bbox}&limit=5000`, { signal });
				const json = await res.json();
				if (signal.aborted) return;
				const points = Array.isArray(json.data) ? json.data : [];
				let addedDynamicSign = false;
				for (const point of points) {
					if (!isAiTrafficSignPoint(point) || !point.sign_name) continue;
					const before = trafficSignRegistry.dynamicValues.size;
					mapAiSignNameToSignValue(point.sign_name);
					if (trafficSignRegistry.dynamicValues.size > before) addedDynamicSign = true;
				}
				if (addedDynamicSign) rebuildSignFilterDropdown();
				const features = points.map((point) => ({
					type: "Feature",
					geometry: { type: "Point", coordinates: [point.lon, point.lat] },
					properties: buildAiObjectPointProperties(point),
				}));
				map.getSource("ai-object-points").setData({
					type: "FeatureCollection",
					features,
				});
				const signValues = new Set(
					features.map((feature) => feature.properties.sign_value).filter(Boolean),
				);
				await Promise.all([...signValues].map((value) => ensureMapImage("sg", value)));
			}

			async function loadLocalImages() {
				const empty = { type: "FeatureCollection", features: [] };
				if (map.getZoom() < 10) {
					map.getSource("local-images").setData(empty);
					map.getSource("local-lines").setData(empty);
					map.getSource("ai-object-points")?.setData(empty);
					return;
				}
				const bounds = map.getBounds();
				const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

				// Skip if bbox hasn't changed
				if (bbox === _lastBbox) return;
				_lastBbox = bbox;

				// Abort previous in-flight request
				if (_loadAbort) _loadAbort.abort();
				_loadAbort = new AbortController();
				const signal = _loadAbort.signal;

				const zoom = map.getZoom();
				const limit =
					zoom >= 16 ? 5000 : zoom >= 14 ? 3000 : zoom >= 12 ? 1500 : 500;
				try {
					const res = await fetch(
						`${LOCAL_API}/images?bbox=${bbox}&limit=${limit}`,
						{ signal },
					);
					if (signal.aborted) return;
					const json = await res.json();
					if (signal.aborted) return;
					const images = Array.isArray(json.data) ? json.data : [];
					const sequencedImages = images.filter((img) => img.sequence_id);
					const visibleImages = sequencedImages.filter(isViewableSequenceImage);

					// Points
					map.getSource("local-images").setData({
						type: "FeatureCollection",
						features: visibleImages.map((img) => ({
							type: "Feature",
							geometry: { type: "Point", coordinates: [img.lon, img.lat] },
							properties: {
								id: img.provider_image_id,
								captured_at: img.captured_at,
								compass_angle: img.compass_angle,
								is_pano: img.is_pano,
								segmentation_summary: img.segmentation_summary || "",
								provider: img.provider || "mapillary",
								has_image: isViewableSequenceImage(img),
								missing_image: !isViewableSequenceImage(img),
							},
						})),
					});

					// Lines
					map.getSource("local-lines").setData(buildSequenceLines(sequencedImages));
					await loadAiObjectPoints(bbox, signal);

					if (LOCAL_ONLY_MODE && !currentImageId && visibleImages.length > 0) {
						navigateViewer(String(visibleImages[0].provider_image_id));
					}
				} catch (e) {
					if (e.name === "AbortError") return;
				}
			}

			function debouncedLoadLocalImages() {
				clearTimeout(_loadTimer);
				_loadTimer = setTimeout(loadLocalImages, 200);
			}

			map.on("moveend", debouncedLoadLocalImages);
			loadLocalImages();
		});
	}

	// ===== NAVIGATE VIEWER =====
	async function navigateViewer(imageId, options = {}) {
		if (!options.keepSegmentationHover) {
			disableViewerSegmentationHover();
		}
		restoreViewerFromClosed();
		if (LOCAL_ONLY_MODE) {
			currentImageId = imageId;
			const imageResult = await showLocalViewerImage(imageId);
			const imageData = imageResult?.data || null;
			syncLocalMapSelection(imageData);
			refreshViewerNavigationTargets();
			fetchImageDate(imageId);
			fetchImageAnalysis(imageId);
			return imageResult;
		}
		if (!viewer || !imageId) return;
		syncingFromMap = true;
		try {
			await viewer.moveTo(imageId);
		} catch (err) {
			console.warn("Navigation failed:", err);
		}
		setTimeout(() => {
			syncingFromMap = false;
		}, 600);
	}

	function toComparableImageKey(value) {
		return String(value || "")
			.split(/[\\/]/)
			.pop()
			.replace(/\.[^.]+$/, "")
			.toLowerCase()
			.replace(/^ai[-_]/, "")
			.replace(/-(jpg|jpeg|png)$/i, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	function parseSeenInEntries(properties) {
		try {
			const raw =
				typeof properties?.seen_in === "string"
					? JSON.parse(properties.seen_in)
					: properties?.seen_in;
			return Array.isArray(raw) ? raw : [];
		} catch {
			return [];
		}
	}

	function seenInEntryImageName(entry) {
		if (typeof entry === "string") return entry;
		if (entry?.image && typeof entry.image === "object") {
			return (
				entry.image.provider_image_id ||
				entry.image.image_path ||
				entry.image_path ||
				entry.img_stem ||
				""
			);
		}
		return entry?.image || entry?.image_path || entry?.img_stem || "";
	}

	function findLocalImageCoordsByKey(imageName) {
		if (!imageName || !map?.getSource("local-images")) return null;
		const features = map.getSource("local-images")._data?.features || [];
		const seenKey = toComparableImageKey(imageName);
		const match = features.find((feature) => {
			const idKey = toComparableImageKey(feature.properties?.id);
			return idKey === seenKey || idKey.includes(seenKey) || seenKey.includes(idKey);
		});
		if (!match) return null;
		const [lon, lat] = match.geometry.coordinates;
		return {
			lon,
			lat,
			provider_image_id: match.properties?.id || "",
		};
	}

	function normalizeObjectSeenItems(items) {
		return (items || [])
			.map((item, index) => {
				const imageName = item.image_name || seenInEntryImageName(item);
				let providerImageId = item.image?.provider_image_id || item.provider_image_id || "";
				let lon = Number(item.image?.lon ?? item.lon);
				let lat = Number(item.image?.lat ?? item.lat);

				if (!providerImageId && imageName) {
					const resolved = findLocalImageCoordsByKey(imageName);
					if (resolved) {
						providerImageId = resolved.provider_image_id;
						lon = resolved.lon;
						lat = resolved.lat;
					}
				}

				if ((!Number.isFinite(lon) || !Number.isFinite(lat)) && (providerImageId || imageName)) {
					const resolved = findLocalImageCoordsByKey(providerImageId || imageName);
					if (resolved) {
						providerImageId = resolved.provider_image_id || providerImageId;
						lon = resolved.lon;
						lat = resolved.lat;
					}
				}

				if (!providerImageId || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;

				return {
					image: { provider_image_id: providerImageId, lon, lat },
					instance_id: item.instance_id ?? null,
					thumb_url: item.thumb_url,
					_order: index,
				};
			})
			.filter(Boolean);
	}

	function buildObjectSeenItemsFromSeenIn(seenIn) {
		return buildSeenInMarkerItems(seenIn, []);
	}

	function indexResolvedSeenImages(resolvedRows) {
		const imageByKey = new Map();
		for (const row of resolvedRows || []) {
			const img = row?.image || row;
			if (!img) continue;
			const keys = [
				img.provider_image_id,
				String(img.provider_image_id || "").replace(/^ai[-_]/i, ""),
				seenInEntryImageName(row),
			];
			for (const key of keys) {
				const comparable = toComparableImageKey(key);
				if (!comparable) continue;
				imageByKey.set(comparable, img);
				imageByKey.set(comparable.replace(/-/g, "_"), img);
			}
		}
		return imageByKey;
	}

	function buildMarkerItemsFromResolvedRows(resolvedRows) {
		return (resolvedRows || [])
			.map((row) => {
				const img = row?.image || row;
				const lon = Number(img?.lon);
				const lat = Number(img?.lat);
				if (!img || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
				return {
					image: {
						provider_image_id: img.provider_image_id || "",
						lon,
						lat,
					},
					instance_id: row?.instance_id ?? null,
				};
			})
			.filter(Boolean);
	}

	function buildSeenInMarkerItems(seenIn, resolvedRows) {
		const imageByKey = indexResolvedSeenImages(resolvedRows);
		const items = [];
		for (const entry of seenIn || []) {
			const imageName = seenInEntryImageName(entry);
			if (!imageName) continue;
			const comparable = toComparableImageKey(imageName);
			let img =
				imageByKey.get(comparable) ||
				imageByKey.get(comparable.replace(/-/g, "_"));
			if (!img) {
				const local = findLocalImageCoordsByKey(imageName);
				if (local) img = local;
			}
			const lon = Number(img?.lon);
			const lat = Number(img?.lat);
			if (!img || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
			items.push({
				image: {
					provider_image_id: img.provider_image_id || imageName,
					lon,
					lat,
				},
				instance_id: typeof entry === "object" ? (entry.instance_id ?? null) : null,
			});
		}
		if (items.length) return items;
		return buildMarkerItemsFromResolvedRows(resolvedRows);
	}

	function buildDetectionMarkerItems(detections) {
		return (detections || [])
			.map((det) => {
				const imageId = det?.image?.id;
				if (!imageId) return null;
				const resolved = findLocalImageCoordsByKey(String(imageId));
				if (!resolved) return null;
				return {
					image: {
						provider_image_id: String(imageId),
						lon: resolved.lon,
						lat: resolved.lat,
					},
					instance_id: null,
				};
			})
			.filter(Boolean);
	}

	function ensureObjectSeenLayersOnTop() {
		if (!map?.getLayer("object-seen-images-dots")) return;
		map.moveLayer("object-seen-images-dots");
	}

	function updateSeenInMarkers(seenIn, resolvedRows) {
		updateObjectSeenImageMarkers(buildSeenInMarkerItems(seenIn, resolvedRows));
	}

	function clearSeenImageHtmlMarkers() {
		for (const marker of seenImageHtmlMarkers) marker.remove();
		seenImageHtmlMarkers = [];
	}

	function updateObjectSeenImageMarkers(items) {
		const pointSource = map?.getSource("object-seen-images");
		if (!pointSource || !map) return;

		clearSeenImageHtmlMarkers();

		const normalized = Array.isArray(items) && items.length && items[0]?.image?.lon != null
			? items
			: normalizeObjectSeenItems(items);
		const features = normalized.map((item, index) => {
			const lon = Number(item.image.lon);
			const lat = Number(item.image.lat);
			const num = index + 1;
			if (Number.isFinite(lon) && Number.isFinite(lat)) {
				const el = document.createElement("button");
				el.type = "button";
				el.className = "seen-image-seq-marker";
				el.textContent = String(num);
				el.title = `Ảnh ${num}`;
				el.setAttribute("aria-label", `Ảnh ${num}`);
				el.addEventListener("click", (ev) => {
					ev.stopPropagation();
					openObjectImageModalFromMap(
						item.image.provider_image_id,
						item.instance_id ?? null,
					);
				});
				const marker = new maplibregl.Marker({ element: el, anchor: "center" })
					.setLngLat([lon, lat])
					.addTo(map);
				seenImageHtmlMarkers.push(marker);
			}
			return {
				type: "Feature",
				geometry: {
					type: "Point",
					coordinates: [item.image.lon, item.image.lat],
				},
				properties: {
					num: String(num),
					image_id: item.image.provider_image_id,
					instance_id:
						item.instance_id != null && item.instance_id !== ""
							? String(item.instance_id)
							: "",
				},
			};
		});

		pointSource.setData({ type: "FeatureCollection", features });
		ensureObjectSeenLayersOnTop();
	}

	function clearObjectSeenImageMarkers() {
		clearSeenImageHtmlMarkers();
		const empty = { type: "FeatureCollection", features: [] };
		map?.getSource("object-seen-images")?.setData(empty);
	}

	function fitMapToObjectSeenSequence(items, objectCoords) {
		if (!map) return;
		const coords = (items || [])
			.map((item) => {
				const lon = Number(item.image?.lon);
				const lat = Number(item.image?.lat);
				return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
			})
			.filter(Boolean);
		if (Array.isArray(objectCoords) && objectCoords.length >= 2) {
			coords.push([objectCoords[0], objectCoords[1]]);
		}
		if (!coords.length) return;
		const bounds = coords.reduce(
			(acc, coord) => acc.extend(coord),
			new maplibregl.LngLatBounds(coords[0], coords[0]),
		);
		map.fitBounds(bounds, { padding: { top: 90, bottom: 90, left: 340, right: 90 }, maxZoom: 19, duration: 650 });
	}

	function getRelatedImageIdForAiObject(properties) {
		try {
			const seenIn = typeof properties.seen_in === "string" ? JSON.parse(properties.seen_in) : properties.seen_in;
			const first = Array.isArray(seenIn) ? seenIn[0] : null;
			const imageName =
				typeof first === "string" ? first : first?.image || first?.image_path || first?.img_stem;
			if (!imageName || !map?.getSource("local-images")) return null;
			const features = map.getSource("local-images")._data?.features || [];
			const seenKey = toComparableImageKey(imageName);
			const match = features.find((feature) => {
				const idKey = toComparableImageKey(feature.properties?.id);
				return idKey === seenKey || idKey.includes(seenKey) || seenKey.includes(idKey);
			});
			return match?.properties?.id || null;
		} catch {
			return null;
		}
	}

	async function showLocalViewerImage(imageId) {
		const imageEl = document.getElementById("localViewerImage");
		const emptyEl = document.getElementById("localViewerEmpty");
		const loadingEl = document.getElementById("viewerLoading");
		if (!imageEl || !imageId) return null;

		loadingEl?.classList.remove("hidden");
		try {
			const res = await fetch(`${LOCAL_API}/images/provider/${imageId}`);
			const json = await res.json();
			const data = json.data || {};
			const thumbUrl = data.thumb_1024_url || data.thumb_256_url;

			if (thumbUrl) {
				imageEl.src = thumbUrl.startsWith("http")
					? thumbUrl
					: `http://localhost:3000${thumbUrl}`;
				imageEl.classList.add("visible");
				emptyEl?.classList.add("hidden");
				imageEl.onload = () => {
					if (viewerSegmentationSession?.providerImageId === imageId) {
						viewerSegmentationSession.onImageReady?.();
						return;
					}
					clearViewerSegmentationOverlay();
				};
			} else {
				imageEl.removeAttribute("src");
				imageEl.classList.remove("visible");
				emptyEl?.classList.remove("hidden");
				if (emptyEl) emptyEl.textContent = "Frame này chưa có ảnh hiển thị.";
			}
			return { data, hasThumb: Boolean(thumbUrl) };
		} catch (e) {
			imageEl.removeAttribute("src");
			imageEl.classList.remove("visible");
			emptyEl?.classList.remove("hidden");
			if (emptyEl) emptyEl.textContent = "Không tải được frame này.";
			return { data: null, hasThumb: false };
		} finally {
			loadingEl?.classList.add("hidden");
		}
	}

	function clearViewerSegmentationOverlay() {
		disableViewerSegmentationHover();
		const legend = document.getElementById("segmentationLegend");
		if (!legend) return;
		legend.hidden = true;
		legend.innerHTML = "";
	}

	function syncLocalMapSelection(imageData) {
		if (!LOCAL_ONLY_MODE || !map || !imageData) return;
		const lon = Number(imageData.lon ?? imageData.lng ?? imageData.longitude);
		const lat = Number(imageData.lat ?? imageData.latitude);
		if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

		const bearing = Number(
			imageData.compass_angle ?? imageData.compass ?? currentBearing ?? 0,
		);
		currentLngLat = { lng: lon, lat };
		currentBearing = Number.isFinite(bearing) ? bearing : 0;
		updateCameraMarker(lon, lat, currentBearing);
		const bounds = map.getBounds?.();
		if (viewerAutoPlay || (bounds && !bounds.contains([lon, lat]))) {
			map.easeTo({ center: [lon, lat], duration: 450 });
		}

		const selectedFeature = {
			type: "Feature",
			geometry: { type: "Point", coordinates: [lon, lat] },
			properties: { id: imageData.provider_image_id || imageData.id || currentImageId },
		};
		if (map.getSource("local-selected")) {
			map.getSource("local-selected").setData({
				type: "FeatureCollection",
				features: [selectedFeature],
			});
		}
		if (map.getSource("local-hover")) {
			map.getSource("local-hover").setData({
				type: "FeatureCollection",
				features: [selectedFeature],
			});
		}
		if (map.getSource("local-compass")) {
			map.getSource("local-compass").setData(makeCompassCone(lon, lat, currentBearing));
		}
	}

	function makeCompassCone(lng, lat, bearingDeg) {
		const fanFov = 70;
		const fanDist = 8;
		const fanSteps = 8;
		const fanCoords = [[lng, lat]];
		for (let i = 0; i <= fanSteps; i++) {
			const angle = bearingDeg - fanFov / 2 + (fanFov * i) / fanSteps;
			fanCoords.push(offsetPoint(lng, lat, angle, fanDist));
		}
		fanCoords.push([lng, lat]);
		return {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: { type: "Polygon", coordinates: [fanCoords] },
					properties: {},
				},
			],
		};
	}

	function restoreViewerFromClosed() {
		if (!viewerClosed) return;
		viewerClosed = false;
		const viewerEl = document.getElementById("viewer");
		viewerEl?.classList.remove("closed");
	}

	// ===== NEAREST IMAGE FALLBACK =====
	async function findNearestImage(lng, lat) {
		try {
			const res = await fetch(
				`${LOCAL_API}/images/nearby?lat=${lat}&lon=${lng}&radius=50&limit=5`,
			);
			const json = await res.json();
			if (json.data && json.data.length > 0) {
				navigateViewer(String(json.data[0].provider_image_id));
			}
		} catch (e) {
			console.warn("Nearest image search failed:", e);
		}
	}

	// ===== IMAGE DATE FETCHER =====
	const dateCache = new Map();
	async function fetchImageDate(imageId) {
		const dateEl = document.getElementById("viewerDate");
		const miniToggleEl = document.getElementById("viewerMiniToggle");
		if (dateCache.has(imageId)) {
			const cached = dateCache.get(imageId);
			dateEl.textContent = cached.date;
			if (miniToggleEl) miniToggleEl.title = cached.date;
			return;
		}
		dateEl.textContent = "...";
		try {
			const res = await fetch(`${LOCAL_API}/images/provider/${imageId}`);
			const json = await res.json();
			if (json.data?.captured_at) {
				const d = new Date(json.data.captured_at);
				const formatted = d.toLocaleDateString("en-US", {
					month: "short",
					day: "numeric",
					year: "numeric",
				});
				dateCache.set(imageId, { date: formatted });
				if (currentImageId === imageId) {
					dateEl.textContent = formatted;
					if (miniToggleEl) miniToggleEl.title = formatted;
				}
			} else {
				dateCache.set(imageId, { date: "—" });
				if (currentImageId === imageId) {
					dateEl.textContent = "—";
					if (miniToggleEl) miniToggleEl.title = "Chưa có metadata";
				}
			}
		} catch (e) {
			dateEl.textContent = "—";
			if (miniToggleEl) miniToggleEl.title = "Không tải được metadata";
		}
	}

	function stopAutoPlay() {
		viewerAutoPlay = false;
		if (autoPlayTimer) {
			clearInterval(autoPlayTimer);
			autoPlayTimer = null;
		}
		const playBtn = document.getElementById("viewerPlayBtn");
		if (playBtn) {
			playBtn.textContent = "▶";
			playBtn.title = "Phát / dừng";
		}
	}

	async function getCurrentSequenceImages() {
		if (!LOCAL_ONLY_MODE || !map || !currentImageId) return [];
		const bounds = map.getBounds();
		const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
		const res = await fetch(`${LOCAL_API}/images?bbox=${bbox}&limit=3000`);
		const json = await res.json();
		const images = Array.isArray(json.data) ? json.data : [];
		const current = images.find(
			(img) => String(img.provider_image_id) === String(currentImageId),
		);
		const seqId = current?.sequence_id;
		if (!seqId) return [];
		return images
			.filter((img) => img.sequence_id === seqId)
			.sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
	}

	function normalizeAngle(angle) {
		return ((angle % 360) + 360) % 360;
	}

	function shortestAngleDiff(fromAngle, toAngle) {
		return ((toAngle - fromAngle + 540) % 360) - 180;
	}

	function bearingBetweenPoints(from, to) {
		const lat1 = (Number(from.lat) * Math.PI) / 180;
		const lat2 = (Number(to.lat) * Math.PI) / 180;
		const deltaLng = ((Number(to.lon) - Number(from.lon)) * Math.PI) / 180;
		const y = Math.sin(deltaLng) * Math.cos(lat2);
		const x =
			Math.cos(lat1) * Math.sin(lat2) -
			Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
		return normalizeAngle((Math.atan2(y, x) * 180) / Math.PI);
	}

	function distanceMeters(a, b) {
		const earthRadius = 6371000;
		const lat1 = (Number(a.lat) * Math.PI) / 180;
		const lat2 = (Number(b.lat) * Math.PI) / 180;
		const dLat = lat2 - lat1;
		const dLng = ((Number(b.lon) - Number(a.lon)) * Math.PI) / 180;
		const h =
			Math.sin(dLat / 2) ** 2 +
			Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
		return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
	}

	function classifyNavSlot(relativeAngle) {
		const abs = Math.abs(relativeAngle);
		if (abs <= 45) return "forward";
		if (abs >= 135) return "back";
		return relativeAngle < 0 ? "left" : "right";
	}

	function setViewerNavButtons(targets = {}) {
		viewerNavTargets = targets;
		document.querySelectorAll("[data-nav-slot]").forEach((btn) => {
			const slot = btn.dataset.navSlot;
			const target = targets[slot];
			btn.disabled = !target;
			btn.classList.toggle("is-hidden", !target);
			if (target) {
				btn.title = `Đi ${slot}`;
				btn.setAttribute("aria-label", `Đi ${slot}`);
			}
		});
	}

	async function refreshViewerNavigationTargets() {
		if (!LOCAL_ONLY_MODE || !currentImageId) return;
		try {
			const seq = await getCurrentSequenceImages();
			const current = seq.find(
				(img) => String(img.provider_image_id) === String(currentImageId),
			);
			if (!current) {
				setViewerNavButtons({});
				return;
			}
			const heading = Number.isFinite(Number(current.compass_angle))
				? Number(current.compass_angle)
				: Number(currentBearing) || 0;
			const currentIndex = seq.findIndex(
				(img) => String(img.provider_image_id) === String(currentImageId),
			);
			const candidates = seq
				.map((img, index) => {
					if (String(img.provider_image_id) === String(currentImageId)) return null;
					const distance = distanceMeters(current, img);
					if (!Number.isFinite(distance) || distance <= 0.2 || distance > 80)
						return null;
					const bearing = bearingBetweenPoints(current, img);
					const relative = shortestAngleDiff(heading, bearing);
					const slot = classifyNavSlot(relative);
					const sequencePenalty = Math.abs(index - currentIndex) * 0.8;
					return { img, slot, distance, score: distance + sequencePenalty };
				})
				.filter(Boolean)
				.sort((a, b) => a.score - b.score);
			const targets = {};
			for (const candidate of candidates) {
				if (!targets[candidate.slot]) targets[candidate.slot] = candidate.img;
			}
			setViewerNavButtons(targets);
		} catch (error) {
			console.warn("Viewer navigation target refresh failed:", error);
		}
	}

	async function navigateDirectionalFrame(slot) {
		const target = viewerNavTargets[slot];
		if (!target) return;
		await navigateViewer(String(target.provider_image_id));
	}

	async function navigateAdjacentFrame(step) {
		if (!currentImageId) return;
		try {
			const seq = await getCurrentSequenceImages();
			const idx = seq.findIndex(
				(img) => String(img.provider_image_id) === String(currentImageId),
			);
			if (idx < 0) return;
			const next = seq[idx + step];
			if (!next) return;
			await navigateViewer(String(next.provider_image_id));
		} catch (error) {
			console.warn("Adjacent frame navigation failed:", error);
		}
	}

	async function playNextFrame() {
		try {
			const seq = await getCurrentSequenceImages();
			const idx = seq.findIndex(
				(img) => String(img.provider_image_id) === String(currentImageId),
			);
			if (idx < 0) {
				stopAutoPlay();
				return;
			}
			const next = seq[idx + 1];
			if (!next) {
				stopAutoPlay();
				return;
			}
			await navigateViewer(String(next.provider_image_id));
		} catch {
			stopAutoPlay();
		}
	}

	function toggleViewerMinimized(forceState = null) {
		const viewerEl = document.getElementById("viewer");
		const appContainer = document.getElementById("appContainer");
		restoreViewerFromClosed();
		const nextState =
			typeof forceState === "boolean" ? forceState : !viewerMinimized;
		viewerMinimized = nextState;
		if (viewerMinimized) {
			viewerExpanded = false;
			appContainer?.classList.remove("viewer-expanded");
		}
		viewerEl.classList.toggle("minimized", viewerMinimized);
		appContainer?.classList.toggle("viewer-minimized", viewerMinimized);
		if (viewerMinimized) stopAutoPlay();
		setTimeout(() => {
			if (viewer) viewer.resize();
			if (map) map.resize();
		}, 350);
	}

	function closeViewerCompletely() {
		disableViewerSegmentationHover();
		stopAutoPlay();
		viewerClosed = true;
		viewerMinimized = false;
		viewerExpanded = false;
		currentAnalysis = null;
		analysisPopupOpen = false;
		const viewerEl = document.getElementById("viewer");
		const appContainer = document.getElementById("appContainer");
		viewerEl?.classList.remove("minimized");
		viewerEl?.classList.add("closed");
		appContainer?.classList.remove("viewer-expanded", "viewer-minimized");
		document.getElementById("analysisPopup").hidden = true;
		document.querySelectorAll(".analysis-dot").forEach((btn) => {
			btn.classList.remove("active");
		});
	}

	function toggleViewerExpanded(forceState = null) {
		const viewerEl = document.getElementById("viewer");
		const appContainer = document.getElementById("appContainer");
		const expandBtn = document.getElementById("viewerExpandBtn");
		restoreViewerFromClosed();
		if (viewerMinimized) {
			viewerMinimized = false;
			viewerEl?.classList.remove("minimized");
			appContainer?.classList.remove("viewer-minimized");
		}
		viewerExpanded =
			typeof forceState === "boolean" ? forceState : !viewerExpanded;
		appContainer?.classList.toggle("viewer-expanded", viewerExpanded);
		if (expandBtn) {
			expandBtn.textContent = "⇄";
			expandBtn.title = viewerExpanded
				? "Đổi về bản đồ lớn"
				: "Đổi viewer và bản đồ";
			expandBtn.setAttribute(
				"aria-label",
				viewerExpanded ? "Đổi về bản đồ lớn" : "Đổi viewer và bản đồ",
			);
		}
		setTimeout(() => {
			if (viewer) viewer.resize();
			if (map) map.resize();
		}, 360);
	}

	async function fetchImageAnalysis(imageId) {
		const analysisPopup = document.getElementById("analysisPopup");
		const analysisBody = document.getElementById("analysisBody");
		const analysisSource = document.getElementById("analysisSource");
		const analysisPopupTitle = document.getElementById("analysisPopupTitle");
		if (!imageId) return;

		currentAnalysis = null;
		analysisPopupOpen = true;
		analysisSource.textContent = "";
		analysisPopupTitle.textContent = "Phân tích ảnh";
		analysisBody.textContent = "Đang tải mô tả hiện trường...";
		analysisPopup.hidden = false;
		setActiveAnalysisField(activeAnalysisField);

		try {
			let json = null;
			const snapshot = await captureViewerSnapshot();

			if (snapshot) {
				const postRes = await fetch(
					`${LOCAL_API}/images/provider/${imageId}/analysis`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ image_base64: snapshot }),
					},
				);
				json = await postRes.json();
				if (!postRes.ok)
					throw new Error(json.error || "Snapshot analysis failed");
			} else {
				const res = await fetch(
					`${LOCAL_API}/images/provider/${imageId}/analysis`,
				);
				json = await res.json();
				if (!json.data) throw new Error("No analysis data");
			}

			currentAnalysis = json.data;
			analysisSource.textContent = "";
			setActiveAnalysisField(activeAnalysisField);
		} catch (e) {
			analysisSource.textContent = "";
			analysisPopupTitle.textContent = "Phân tích ảnh";
			analysisBody.textContent = "Không tải được mô tả ảnh.";
		}
	}

	async function captureViewerSnapshot() {
		try {
			const viewerEl = document.getElementById("viewer");
			const canvas = viewerEl.querySelector("canvas");
			if (!canvas) return null;
			return canvas.toDataURL("image/jpeg", 0.92);
		} catch (e) {
			console.warn("Viewer snapshot failed:", e);
			return null;
		}
	}

	function setActiveAnalysisField(field) {
		activeAnalysisField = field;
		const analysisPopup = document.getElementById("analysisPopup");
		const analysisBody = document.getElementById("analysisBody");
		const analysisPopupTitle = document.getElementById("analysisPopupTitle");
		const labels = {
			scene_text: "Tổng quan",
			vehicle_text: "Phương tiện",
			road_text: "Tình trạng đường xá",
			safety_text: "An toàn",
			sign_text: "Sự cố",
		};

		document.querySelectorAll(".analysis-dot").forEach((btn) => {
			btn.classList.toggle("active", btn.dataset.field === field);
		});

		analysisPopup.hidden = !analysisPopupOpen;
		analysisPopupTitle.textContent = labels[field] || "Phân tích ảnh";
		analysisBody.textContent =
			currentAnalysis?.[field] || "Chưa có nội dung cho mục này.";
	}

	function setUploadPanelOpen(nextOpen) {
		uploadPanelOpen = nextOpen;
		const panel = document.getElementById("uploadPanel");
		const trigger = document.getElementById("uploadTrigger");
		if (!panel || !trigger) return;
		panel.hidden = !nextOpen;
		trigger.setAttribute("aria-expanded", String(nextOpen));
		document.body.classList.toggle("upload-mode", nextOpen);
		if (nextOpen) {
			document.querySelectorAll(".filter-dropdown-list.open").forEach((el) => {
				el.classList.remove("open");
			});
		}
	}

	function setUploadState(state, message) {
		const board = document.getElementById("uploadStatusBoard");
		const chip = document.getElementById("uploadStatusChip");
		const text = document.getElementById("uploadStatusText");
		if (board) board.dataset.state = state;
		if (chip) {
			chip.textContent =
				state === "uploading"
					? "Uploading"
					: state === "ready"
						? "Ready"
						: state === "error"
							? "Failed"
							: "Idle";
		}
		if (text) text.textContent = message;
	}

	function formatUploadFileSize(size) {
		if (!Number.isFinite(size) || size <= 0) return "";
		const units = ["B", "KB", "MB", "GB"];
		let value = size;
		let unitIndex = 0;
		while (value >= 1024 && unitIndex < units.length - 1) {
			value /= 1024;
			unitIndex++;
		}
		return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
	}

	function updateSelectedUploadMeta(file) {
		const nameEl = document.getElementById("uploadSelectedName");
		const hintEl = document.getElementById("uploadSelectedHint");
		updateUploadJobMeta(file?.name || "", file ? "Đã chọn video" : "Chưa gửi");
		if (!nameEl || !hintEl) return;
		if (!file) {
			nameEl.textContent = "Chưa chọn video";
			hintEl.textContent =
				"Hỗ trợ MP4, MOV, AVI hoặc video survey từ điện thoại.";
			return;
		}
		nameEl.textContent = file.name;
		hintEl.textContent = `${file.type || "video/*"} • ${formatUploadFileSize(file.size)}`;
	}

	function updateUploadJobMeta(fileName, statusText, url = "") {
		const nameEl = document.getElementById("uploadJobName");
		const statusEl = document.getElementById("uploadJobStatus");
		const urlEl = document.getElementById("uploadJobUrl");
		if (nameEl) nameEl.textContent = fileName || "Chưa có video";
		if (statusEl) statusEl.textContent = statusText || "Chưa gửi";
		if (urlEl) {
			urlEl.textContent = url || "";
			urlEl.hidden = !url;
			urlEl.title = url || "";
		}
	}

	async function uploadVideoToR2(file) {
		const res = await fetch(`${LOCAL_API}/r2/videos`, {
			method: "POST",
			headers: {
				"Content-Type": file.type || "application/octet-stream",
				"X-File-Name": encodeURIComponent(file.name),
			},
			body: file,
		});
		const payload = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(payload?.error || `R2 upload failed with ${res.status}`);
		}
		if (!payload?.file_name || !payload?.url) {
			throw new Error("R2 upload response thiếu file_name hoặc url.");
		}
		return payload;
	}

	async function submitR2VideoToAi({ file_name, url }) {
		const res = await fetch(VIDEO_SUBMIT_URL_API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ file_name, url }),
		});
		const payload = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(payload?.detail || payload?.error || `AI submit failed with ${res.status}`);
		}
		return payload;
	}

	function delay(ms) {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}

	async function fetchAiVideoStatus(fileName) {
		const statusUrl = `${VIDEO_STATUS_URL_BASE.replace(/\/+$/, "")}/${encodeURIComponent(fileName)}`;
		const res = await fetch(statusUrl);
		const payload = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(payload?.detail || payload?.error || `AI status failed with ${res.status}`);
		}
		if (payload?.error) {
			throw new Error(payload.error);
		}
		return payload;
	}

	function isAiSubmitReady(payload) {
		return payload?.status === true || payload?.ready === true || payload?.done === true;
	}

	function getAiSubmitResultPayload(payload) {
		return payload?.result || payload?.payload || payload?.data?.result || payload?.data || payload;
	}

	async function waitForAiVideoResult(fileName, r2Url) {
		for (let attempt = 1; attempt <= VIDEO_STATUS_MAX_POLLS; attempt += 1) {
			const statusPayload = await fetchAiVideoStatus(fileName);
			const ready = isAiSubmitReady(statusPayload);
			updateUploadJobMeta(
				statusPayload?.file_name || fileName,
				ready ? "AI đã xử lý xong" : "AI đang xử lý",
				r2Url,
			);

			if (ready) return statusPayload;

			uploadedFrameResults = [];
			renderUploadResults(uploadedFrameResults);
			setUploadState(
				"uploading",
				`Server AI đang xử lý ${statusPayload?.file_name || fileName}. Chưa có ảnh xử lý.`,
			);
			await delay(VIDEO_STATUS_POLL_INTERVAL_MS);
		}

		throw new Error("Quá thời gian chờ server AI xử lý video.");
	}

	async function syncAndRenderReadyAiPayload(aiPayload) {
		const localPayload = await syncAiUploadToLocalDatabase(getAiSubmitResultPayload(aiPayload));
		const signValues = registerAiSignNamesFromPayload(localPayload);
		await Promise.all(signValues.map((value) => ensureMapImage("sg", value)));
		uploadedFrameResults = normalizeUploadedImages(localPayload);
		renderUploadResults(uploadedFrameResults);
		if (map) {
			const empty = { type: "FeatureCollection", features: [] };
			map.getSource("local-images")?.setData(empty);
			map.getSource("ai-object-points")?.setData(empty);
		}
		return uploadedFrameResults;
	}

	function normalizeUploadedImages(payload) {
		const rawItems =
			payload?.data?.images ||
			payload?.data?.frames ||
			payload?.images ||
			payload?.frames ||
			payload?.data ||
			[];

		if (!Array.isArray(rawItems)) return [];

		return rawItems
			.map((item, index) => {
				if (typeof item === "string") {
					return {
						id: `frame-${index + 1}`,
						label: `Frame ${index + 1}`,
						imageUrl: item,
						providerImageId: null,
						capturedAt: "",
					};
				}

				if (!item || typeof item !== "object") return null;

				return {
					id:
						item.id ||
						item.provider_image_id ||
						item.image_id ||
						item.frame_id ||
						`frame-${index + 1}`,
					label:
						item.label ||
						item.name ||
						item.title ||
						item.provider_image_id ||
						`Frame ${index + 1}`,
					imageUrl:
						item.image_url ||
						item.image_path ||
						item.thumb_1024_url ||
						item.thumb_256_url ||
						item.url ||
						item.src ||
						"",
					providerImageId:
						item.provider_image_id || item.image_id || item.providerImageId || null,
					capturedAt: item.captured_at || item.timestamp || "",
					segmentationPath: item.segmentation_path || item.segmentationPath || "",
				};
			})
			.filter(Boolean);
	}

	function rgbForSegmentationInstance(meta) {
		const rgb = meta?.rgb;
		if (Array.isArray(rgb) && rgb.length >= 3) {
			return [rgb[0] | 0, rgb[1] | 0, rgb[2] | 0];
		}
		const id = Number(meta?.class_id ?? meta?.instance_id ?? 0);
		return [(id * 37) % 256, (id * 67) % 256, (id * 97) % 256];
	}

	function getImageContainFit(naturalW, naturalH, canvasW, canvasH) {
		const scale = Math.min(canvasW / naturalW, canvasH / naturalH);
		const drawW = naturalW * scale;
		const drawH = naturalH * scale;
		return {
			naturalW,
			naturalH,
			scale,
			drawW,
			drawH,
			offsetX: (canvasW - drawW) / 2,
			offsetY: (canvasH - drawH) / 2,
		};
	}

	function getImageCoverFit(naturalW, naturalH, canvasW, canvasH) {
		const scale = Math.max(canvasW / naturalW, canvasH / naturalH);
		const drawW = naturalW * scale;
		const drawH = naturalH * scale;
		return {
			naturalW,
			naturalH,
			scale,
			drawW,
			drawH,
			offsetX: (canvasW - drawW) / 2,
			offsetY: (canvasH - drawH) / 2,
		};
	}

	function canvasPointToMatrix(x, y, fit, matrixW, matrixH) {
		const imageX = (x - fit.offsetX) / fit.scale;
		const imageY = (y - fit.offsetY) / fit.scale;
		if (imageX < 0 || imageY < 0 || imageX >= fit.naturalW || imageY >= fit.naturalH) {
			return null;
		}
		return {
			mx: Math.min(matrixW - 1, Math.max(0, Math.floor((imageX * matrixW) / fit.naturalW))),
			my: Math.min(matrixH - 1, Math.max(0, Math.floor((imageY * matrixH) / fit.naturalH))),
		};
	}

	const SEGMENTATION_MASK_ALPHA = 0.55;
	let viewerSegmentationSession = null;
	let objectImageModalSession = null;

	function formatSegmentationTooltip(meta, instanceId) {
		const rawName = meta.sign_name || meta.class_name || `class_${meta.class_id ?? instanceId}`;
		const name = meta.sign_name ? resolveSignLabel(meta.sign_name) : rawName;
		const score = meta.score != null ? Number(meta.score).toFixed(3) : "n/a";
		return `<strong>${name}</strong><span>instance #${instanceId} · score ${score}</span>`;
	}

	async function loadInstanceSegmentationState(providerImageId) {
		const [matrixRes, segmentsRes] = await Promise.all([
			fetch(`${LOCAL_API}/ai-images/${encodeURIComponent(providerImageId)}/instance-matrix`),
			fetch(`${LOCAL_API}/ai-images/${encodeURIComponent(providerImageId)}/segments`),
		]);
		if (!matrixRes.ok) throw new Error("Không tải được segmentation matrix");
		const matrixJson = await matrixRes.json();
		const segmentsJson = await segmentsRes.json().catch(() => ({ data: [] }));
		const matrix = matrixJson.instance_matrix || matrixJson.mask_matrix;
		if (!Array.isArray(matrix) || !matrix.length || !Array.isArray(matrix[0])) {
			throw new Error("Segmentation matrix không hợp lệ");
		}
		const instances = new Map();
		const registerInstance = (raw, label) => {
			if (raw?.instance_id == null) return;
			instances.set(Number(raw.instance_id), {
				...raw,
				class_name: raw.class_name || label || raw.label,
				score: raw.score ?? raw.confidence,
			});
		};
		(segmentsJson.data || []).forEach((row) => registerInstance(row.raw_json || {}, row.label));
		(matrixJson.instances || []).forEach((raw) => registerInstance(raw));
		return {
			matrix,
			matrixH: matrix.length,
			matrixW: matrix[0].length,
			instances,
		};
	}

	function createInstanceOverlayCanvas(
		instanceId,
		meta,
		fit,
		canvas,
		matrix,
		matrixW,
		matrixH,
		alpha,
		fillRgb = null,
	) {
		const overlay = document.createElement("canvas");
		overlay.width = canvas.width;
		overlay.height = canvas.height;
		const octx = overlay.getContext("2d");
		const imageData = octx.createImageData(canvas.width, canvas.height);
		const buf = imageData.data;
		const [r, g, b] = fillRgb || rgbForSegmentationInstance(meta);
		const opacity = Math.round(alpha * 255);
		const targetId = Number(instanceId);

		for (let y = 0; y < canvas.height; y++) {
			for (let x = 0; x < canvas.width; x++) {
				const point = canvasPointToMatrix(x, y, fit, matrixW, matrixH);
				if (!point || Number(matrix[point.my]?.[point.mx]) !== targetId) continue;
				const idx = (y * canvas.width + x) * 4;
				buf[idx] = r;
				buf[idx + 1] = g;
				buf[idx + 2] = b;
				buf[idx + 3] = opacity;
			}
		}
		octx.putImageData(imageData, 0, 0);
		return overlay;
	}

	function positionViewerSegmentationTooltip(tooltip, clientX, clientY) {
		const viewer = document.getElementById("viewer");
		if (!viewer || !tooltip) return;
		const rect = viewer.getBoundingClientRect();
		let left = clientX - rect.left + 14;
		let top = clientY - rect.top + 14;
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
		requestAnimationFrame(() => {
			if (left + tooltip.offsetWidth > rect.width - 8) {
				left = Math.max(8, left - tooltip.offsetWidth - 28);
			}
			if (top + tooltip.offsetHeight > rect.height - 8) {
				top = Math.max(8, top - tooltip.offsetHeight - 28);
			}
			tooltip.style.left = `${left}px`;
			tooltip.style.top = `${top}px`;
		});
	}

	function disableViewerSegmentationHover() {
		viewerSegmentationSession?.disable();
		viewerSegmentationSession = null;
	}

	async function enableViewerSegmentationHover(providerImageId) {
		disableViewerSegmentationHover();
		const viewerEl = document.getElementById("viewer");
		const canvas = document.getElementById("segmentationCanvas");
		const imageEl = document.getElementById("localViewerImage");
		const tooltip = document.getElementById("viewerSegmentationTooltip");
		if (!viewerEl || !canvas || !imageEl || !tooltip) return;

		let state = null;
		let loading = null;
		let overlayCache = new Map();
		let hoverRaf = 0;

		const resizeCanvas = () => {
			const width = Math.max(1, imageEl.clientWidth);
			const height = Math.max(1, imageEl.clientHeight);
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
				overlayCache.clear();
			}
		};

		const clearHover = () => {
			const ctx = canvas.getContext("2d");
			ctx?.clearRect(0, 0, canvas.width, canvas.height);
			tooltip.hidden = true;
		};

		const drawHover = async (clientX, clientY) => {
			const resolved = state || (await (loading = loading || loadInstanceSegmentationState(providerImageId)));
			if (!resolved) return;
			state = resolved;
			if (!imageEl.complete || !imageEl.naturalWidth) return;
			resizeCanvas();
			const rect = canvas.getBoundingClientRect();
			const x = Math.floor((clientX - rect.left) * (canvas.width / rect.width));
			const y = Math.floor((clientY - rect.top) * (canvas.height / rect.height));
			const fit = getImageContainFit(
				imageEl.naturalWidth,
				imageEl.naturalHeight,
				canvas.width,
				canvas.height,
			);
			const point = canvasPointToMatrix(x, y, fit, resolved.matrixW, resolved.matrixH);
			const instanceId = point ? Number(resolved.matrix[point.my]?.[point.mx]) : 0;
			const meta = instanceId ? resolved.instances.get(instanceId) : null;
			const ctx = canvas.getContext("2d");
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			if (!instanceId || !meta) {
				tooltip.hidden = true;
				return;
			}
			const key = `${instanceId}:${canvas.width}x${canvas.height}`;
			if (!overlayCache.has(key)) {
				overlayCache.set(
					key,
					createInstanceOverlayCanvas(
						instanceId,
						meta,
						fit,
						canvas,
						resolved.matrix,
						resolved.matrixW,
						resolved.matrixH,
						SEGMENTATION_MASK_ALPHA,
					),
				);
			}
			ctx.drawImage(overlayCache.get(key), 0, 0);
			tooltip.innerHTML = formatSegmentationTooltip(meta, instanceId);
			tooltip.hidden = false;
			positionViewerSegmentationTooltip(tooltip, clientX, clientY);
		};

		const onMove = (event) => {
			if (hoverRaf) return;
			hoverRaf = requestAnimationFrame(() => {
				hoverRaf = 0;
				drawHover(event.clientX, event.clientY);
			});
		};
		const onLeave = () => clearHover();

		canvas.classList.add("segmentation-interactive");
		viewerEl.addEventListener("mousemove", onMove);
		viewerEl.addEventListener("mouseleave", onLeave);

		const onImageReady = () => {
			resizeCanvas();
			clearHover();
		};

		viewerSegmentationSession = {
			providerImageId,
			onImageReady,
			disable: () => {
				viewerEl.removeEventListener("mousemove", onMove);
				viewerEl.removeEventListener("mouseleave", onLeave);
				canvas.classList.remove("segmentation-interactive");
				clearHover();
			},
		};

		onImageReady();
	}

	function positionObjectImageModalTooltip(tooltip, stage, clientX, clientY) {
		if (!tooltip || !stage) return;
		const rect = stage.getBoundingClientRect();
		let left = clientX - rect.left + 14;
		let top = clientY - rect.top + 14;
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
		requestAnimationFrame(() => {
			if (left + tooltip.offsetWidth > rect.width - 8) {
				left = Math.max(8, left - tooltip.offsetWidth - 28);
			}
			if (top + tooltip.offsetHeight > rect.height - 8) {
				top = Math.max(8, top - tooltip.offsetHeight - 28);
			}
			tooltip.style.left = `${left}px`;
			tooltip.style.top = `${top}px`;
		});
	}

	function closeObjectImageModal() {
		objectImageModalSession?.close();
		objectImageModalSession = null;
	}

	async function openObjectImageModal(providerImageId, cardEl, focusInstanceId = null) {
		if (!providerImageId) return;
		closeObjectImageModal();

		document
			.querySelectorAll(".detection-card.selected")
			.forEach((el) => el.classList.remove("selected"));
		cardEl?.classList.add("selected");

		const modal = document.getElementById("objectImageModal");
		const stage = document.getElementById("objectImageModalStage");
		const canvas = document.getElementById("objectImageModalCanvas");
		const tooltip = document.getElementById("objectImageModalTooltip");
		if (!modal || !stage || !canvas || !tooltip) return;

		const resolvedFocusInstanceId =
			focusInstanceId ?? cardEl?.dataset?.instanceId ?? null;

		const img = new Image();
		img.decoding = "async";
		img.src = `${LOCAL_API}/ai-images/${encodeURIComponent(providerImageId)}/image`;

		let state = null;
		let loading = null;
		let overlayCache = new Map();
		let hoverRaf = 0;
		let blinkRaf = 0;
		let closed = false;

		const resizeCanvas = () => {
			const width = Math.max(1, Math.round(stage.clientWidth));
			const height = Math.max(1, Math.round(stage.clientHeight));
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
				overlayCache.clear();
			}
		};

		const getFit = () =>
			getImageContainFit(img.naturalWidth, img.naturalHeight, canvas.width, canvas.height);

		const drawBase = () => {
			const ctx = canvas.getContext("2d");
			const fit = getFit();
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(img, fit.offsetX, fit.offsetY, fit.drawW, fit.drawH);
			return fit;
		};

		const getCachedInstanceOverlay = (instanceId, meta, fit, resolved, variant = "color") => {
			const key = `${instanceId}:${canvas.width}x${canvas.height}:${variant}`;
			if (!overlayCache.has(key)) {
				const fillRgb = variant === "white" ? [255, 255, 255] : null;
				overlayCache.set(
					key,
					createInstanceOverlayCanvas(
						instanceId,
						meta,
						fit,
						canvas,
						resolved.matrix,
						resolved.matrixW,
						resolved.matrixH,
						SEGMENTATION_MASK_ALPHA,
						fillRgb,
					),
				);
			}
			return overlayCache.get(key);
		};

		const drawFocusedInstanceOverlay = (instanceId, variant, resolved) => {
			const targetId = Number(instanceId);
			const meta = resolved.instances.get(targetId);
			if (!meta) return;
			const fit = drawBase();
			const ctx = canvas.getContext("2d");
			ctx.drawImage(getCachedInstanceOverlay(targetId, meta, fit, resolved, variant), 0, 0);
		};

		const stopFocusBlink = () => {
			if (!blinkRaf) return;
			cancelAnimationFrame(blinkRaf);
			blinkRaf = 0;
		};

		const startFocusInstanceBlink = async (instanceId) => {
			const targetId = Number(instanceId);
			if (!Number.isFinite(targetId) || targetId <= 0) return;
			const resolved =
				state || (await (loading = loading || loadInstanceSegmentationState(providerImageId)));
			if (!resolved || closed || !resolved.instances.has(targetId)) return;
			state = resolved;
			stopFocusBlink();
			const startedAt = performance.now();

			const tick = (now) => {
				if (closed) return;
				const elapsed = now - startedAt;
				const isWhitePhase = Math.floor(elapsed / 520) % 2 === 0;
				drawFocusedInstanceOverlay(targetId, isWhitePhase ? "white" : "color", resolved);
				blinkRaf = requestAnimationFrame(tick);
			};

			blinkRaf = requestAnimationFrame(tick);
		};

		const drawHover = async (clientX, clientY) => {
			if (closed || !img.complete || !img.naturalWidth) return;
			const resolved =
				state || (await (loading = loading || loadInstanceSegmentationState(providerImageId)));
			if (!resolved || closed) return;
			state = resolved;
			resizeCanvas();
			const fit = drawBase();
			const rect = canvas.getBoundingClientRect();
			const x = Math.floor((clientX - rect.left) * (canvas.width / rect.width));
			const y = Math.floor((clientY - rect.top) * (canvas.height / rect.height));
			const point = canvasPointToMatrix(x, y, fit, resolved.matrixW, resolved.matrixH);
			const instanceId = point ? Number(resolved.matrix[point.my]?.[point.mx]) : 0;
			const meta = instanceId ? resolved.instances.get(instanceId) : null;
			const ctx = canvas.getContext("2d");
			if (!instanceId || !meta) {
				tooltip.hidden = true;
				if (resolvedFocusInstanceId != null && resolvedFocusInstanceId !== "") {
					startFocusInstanceBlink(resolvedFocusInstanceId);
				} else {
					drawBase();
				}
				return;
			}
			ctx.drawImage(getCachedInstanceOverlay(instanceId, meta, fit, resolved), 0, 0);
			tooltip.innerHTML = formatSegmentationTooltip(meta, instanceId);
			tooltip.hidden = false;
			positionObjectImageModalTooltip(tooltip, stage, clientX, clientY);
		};

		const onMove = (event) => {
			stopFocusBlink();
			if (hoverRaf) return;
			hoverRaf = requestAnimationFrame(() => {
				hoverRaf = 0;
				drawHover(event.clientX, event.clientY);
			});
		};
		const onLeave = () => {
			tooltip.hidden = true;
			if (resolvedFocusInstanceId != null && resolvedFocusInstanceId !== "") {
				startFocusInstanceBlink(resolvedFocusInstanceId);
				return;
			}
			stopFocusBlink();
			drawBase();
		};
		const onResize = () => {
			resizeCanvas();
			tooltip.hidden = true;
			if (resolvedFocusInstanceId != null && resolvedFocusInstanceId !== "") {
				startFocusInstanceBlink(resolvedFocusInstanceId);
				return;
			}
			stopFocusBlink();
			drawBase();
		};
		const onKeyDown = (event) => {
			if (event.key === "Escape") closeObjectImageModal();
		};

		const close = () => {
			if (closed) return;
			closed = true;
			stopFocusBlink();
			canvas.removeEventListener("mousemove", onMove);
			canvas.removeEventListener("mouseleave", onLeave);
			window.removeEventListener("resize", onResize);
			document.removeEventListener("keydown", onKeyDown);
			document.body.classList.remove("object-image-modal-open");
			modal.hidden = true;
			tooltip.hidden = true;
			const ctx = canvas.getContext("2d");
			ctx?.clearRect(0, 0, canvas.width, canvas.height);
			if (objectImageModalSession?.close === close) {
				objectImageModalSession = null;
			}
		};

		objectImageModalSession = { close };
		modal.hidden = false;
		document.body.classList.add("object-image-modal-open");

		canvas.addEventListener("mousemove", onMove);
		canvas.addEventListener("mouseleave", onLeave);
		window.addEventListener("resize", onResize);
		document.addEventListener("keydown", onKeyDown);

		try {
			await new Promise((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error("Không tải được ảnh"));
			});
			if (closed) return;
			resizeCanvas();
			drawBase();
			if (resolvedFocusInstanceId != null && resolvedFocusInstanceId !== "") {
				await startFocusInstanceBlink(resolvedFocusInstanceId);
			}
		} catch (error) {
			close();
			console.error(error);
		}
	}

	function initObjectImageModal() {
		document
			.getElementById("objectImageModalClose")
			?.addEventListener("click", closeObjectImageModal);
		document
			.getElementById("objectImageModalBackdrop")
			?.addEventListener("click", closeObjectImageModal);
	}

	async function syncAiUploadToLocalDatabase(aiPayload) {
		const res = await fetch(`${LOCAL_API}/ai-uploads`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(aiPayload),
		});
		const payload = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(payload?.error || `Local database sync failed with ${res.status}`);
		}
		return payload;
	}

	function toAbsoluteAssetUrl(url) {
		if (!url) return "";
		if (url.startsWith("http://") || url.startsWith("https://")) return url;
		if (url.startsWith("/")) return `http://localhost:3000${url}`;
		return url;
	}

	function renderUploadResults(items) {
		const grid = document.getElementById("uploadResultsGrid");
		const title = document.getElementById("uploadResultsTitle");
		if (!grid || !title) return;

		if (!items.length) {
			title.textContent = "Danh sách ảnh sẽ xuất hiện ở đây";
			grid.innerHTML = `<div class="upload-empty-state">
				<strong>Chưa có frame nào</strong>
				<p>Sau khi API xử lý xong video, các ảnh đại diện sẽ xuất hiện để bạn bấm xem nhanh.</p>
			</div>`;
			return;
		}

		title.textContent = `${items.length} ảnh trả về từ video`;
		grid.innerHTML = "";

		items.forEach((item, index) => {
			const card = document.createElement("button");
			card.type = "button";
			card.className = "upload-result-card";
			const imageUrl = toAbsoluteAssetUrl(item.imageUrl);
			const meta = item.capturedAt
				? new Date(item.capturedAt).toLocaleString("vi-VN")
				: item.providerImageId
					? `Image ${item.providerImageId}`
					: `Frame ${index + 1}`;

			card.innerHTML = `
				<div class="upload-result-thumb">
					${
						imageUrl
							? `<img src="${imageUrl}" alt="${item.label}" loading="lazy">`
							: '<div class="upload-result-placeholder">No preview</div>'
					}
				</div>
				<div class="upload-result-body">
					<strong>${item.label}</strong>
					<span>${meta}</span>
				</div>
			`;

			card.addEventListener("click", async () => {
				if (item.providerImageId) {
					await navigateViewer(String(item.providerImageId));
					return;
				}

				if (!imageUrl) return;
				const imageEl = document.getElementById("localViewerImage");
				const emptyEl = document.getElementById("localViewerEmpty");
				if (imageEl) {
					imageEl.src = imageUrl;
					imageEl.classList.add("visible");
				}
				emptyEl?.classList.add("hidden");
			});

			grid.appendChild(card);
		});
	}

	async function submitVideoUpload() {
		if (!selectedUploadFile) {
			setUploadState("error", "Chưa có file video. Hãy chọn video trước khi đẩy lên API.");
			return;
		}

		const submitBtn = document.getElementById("uploadSubmitBtn");
		const browseBtn = document.getElementById("uploadBrowseBtn");

		setUploadState(
			"uploading",
			`Đang tải ${selectedUploadFile.name} lên Cloudflare R2.`,
		);
		updateUploadJobMeta(selectedUploadFile.name, "Đang tải lên R2");
		if (submitBtn) submitBtn.disabled = true;
		if (browseBtn) browseBtn.disabled = true;

		try {
			const r2Video = await uploadVideoToR2(selectedUploadFile);
			updateUploadJobMeta(r2Video.file_name, "Đã upload R2, đang gửi sang AI", r2Video.url);
			setUploadState(
				"uploading",
				`Đã upload video lên R2. Đang gửi URL sang server AI.`,
			);

			const aiSubmitPayload = await submitR2VideoToAi(r2Video);
			const aiReady = isAiSubmitReady(aiSubmitPayload);
			updateUploadJobMeta(
				aiSubmitPayload?.file_name || r2Video.file_name,
				aiReady ? "AI đã xử lý xong" : "AI đang xử lý",
				r2Video.url,
			);

			const readyPayload = aiReady
				? aiSubmitPayload
				: await waitForAiVideoResult(aiSubmitPayload?.file_name || r2Video.file_name, r2Video.url);
			await syncAndRenderReadyAiPayload(readyPayload);

			if (!uploadedFrameResults.length) {
				setUploadState(
					"ready",
					"API đã nhận video nhưng chưa trả về frame nào. Kiểm tra lại payload phản hồi của backend.",
				);
				return;
			}

			setUploadState(
				"ready",
				`Hoàn tất. Nhận ${uploadedFrameResults.length} ảnh từ video và sẵn sàng rà soát trên giao diện.`,
			);
		} catch (error) {
			console.warn("Video upload failed:", error);
			setUploadState(
				"error",
				error?.message ||
					"Không thể upload video lúc này. Cần backend trả về danh sách ảnh sau bước AI xử lý.",
			);
		} finally {
			if (submitBtn) submitBtn.disabled = false;
			if (browseBtn) browseBtn.disabled = false;
		}
	}

	function initUploadPanel() {
		const panel = document.getElementById("uploadPanel");
		const trigger = document.getElementById("uploadTrigger");
		const closeBtn = document.getElementById("uploadPanelClose");
		const input = document.getElementById("uploadVideoInput");
		const browseBtn = document.getElementById("uploadBrowseBtn");
		const submitBtn = document.getElementById("uploadSubmitBtn");
		const dropzone = document.getElementById("uploadDropzone");

		if (!panel || !trigger || !input || !browseBtn || !submitBtn || !dropzone) return;

		setUploadPanelOpen(false);
		updateSelectedUploadMeta(null);
		renderUploadResults([]);
		setUploadState("idle", "Chọn video để bắt đầu pipeline upload.");

		trigger.addEventListener("click", () => {
			setUploadPanelOpen(!uploadPanelOpen);
		});

		closeBtn?.addEventListener("click", () => {
			setUploadPanelOpen(false);
		});

		browseBtn.addEventListener("click", () => {
			input.click();
		});

		input.addEventListener("change", () => {
			selectedUploadFile = input.files?.[0] || null;
			updateSelectedUploadMeta(selectedUploadFile);
			setUploadState(
				"idle",
				selectedUploadFile
					? "Video đã sẵn sàng. Bấm “Đẩy lên xử lý” để gọi API và lấy danh sách frame."
					: "Chọn video để bắt đầu pipeline upload.",
			);
		});

		submitBtn.addEventListener("click", submitVideoUpload);

		dropzone.addEventListener("dragover", (event) => {
			event.preventDefault();
			dropzone.style.borderColor = "rgba(255, 224, 164, 0.72)";
		});

		dropzone.addEventListener("dragleave", () => {
			dropzone.style.borderColor = "";
		});

		dropzone.addEventListener("drop", (event) => {
			event.preventDefault();
			dropzone.style.borderColor = "";
			const file = event.dataTransfer?.files?.[0] || null;
			if (!file) return;
			selectedUploadFile = file;
			const transfer = new DataTransfer();
			transfer.items.add(file);
			input.files = transfer.files;
			updateSelectedUploadMeta(file);
			setUploadState(
				"idle",
				"Video đã sẵn sàng. Bấm “Đẩy lên xử lý” để gọi API và lấy danh sách frame.",
			);
		});

		document.addEventListener("click", (event) => {
			if (!uploadPanelOpen) return;
			if (panel.contains(event.target) || trigger.contains(event.target)) return;
			setUploadPanelOpen(false);
		});
	}

	// ===== VIEWER CONTROLS =====
	document.getElementById("viewerMinBtn").addEventListener("click", () => {
		if (viewerExpanded) {
			toggleViewerExpanded(false);
		}
		toggleViewerMinimized(true);
	});

	document.getElementById("viewerMiniToggle").addEventListener("click", () => {
		toggleViewerMinimized(false);
	});

	document.getElementById("viewerCloseBtn").addEventListener("click", () => {
		closeViewerCompletely();
	});

	document.getElementById("viewerPrevBtn").addEventListener("click", () => {
		navigateAdjacentFrame(-1);
	});

	document.getElementById("viewerNextBtn").addEventListener("click", () => {
		navigateAdjacentFrame(1);
	});

	document.querySelectorAll("[data-nav-slot]").forEach((btn) => {
		btn.addEventListener("click", () => {
			navigateDirectionalFrame(btn.dataset.navSlot);
		});
	});

	document
		.getElementById("viewerPlayBtn")
		.addEventListener("click", async () => {
			if (viewerMinimized) return;
			if (viewerAutoPlay) {
				stopAutoPlay();
				return;
			}
			viewerAutoPlay = true;
			const playBtn = document.getElementById("viewerPlayBtn");
			playBtn.textContent = "❚❚";
			playBtn.title = "Phát / dừng";
			await playNextFrame();
			autoPlayTimer = setInterval(playNextFrame, 1700);
		});

	document
		.getElementById("viewerExpandBtn")
		.addEventListener("click", () => {
			toggleViewerExpanded();
		});

	document
		.getElementById("viewerFloatingSwap")
		.addEventListener("click", () => {
			toggleViewerExpanded();
		});

	// ===== CAMERA MARKER =====
	function updateCameraMarker(lng, lat, bearingDeg) {
		if (!map || !map.getSource("camera-point")) return;

		// Update point
		map.getSource("camera-point").setData({
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: { type: "Point", coordinates: [lng, lat] },
				},
			],
		});

		// Build cone polygon
		const fovDeg = 70;
		const lengthM = 25;
		const leftAngle = bearingDeg - fovDeg / 2;
		const rightAngle = bearingDeg + fovDeg / 2;

		const steps = 12;
		const coords = [[lng, lat]];
		for (let i = 0; i <= steps; i++) {
			const angle = leftAngle + (rightAngle - leftAngle) * (i / steps);
			const pt = offsetPoint(lng, lat, angle, lengthM);
			coords.push(pt);
		}
		coords.push([lng, lat]);

		map.getSource("camera-cone").setData({
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: { type: "Polygon", coordinates: [coords] },
				},
			],
		});
	}

	function offsetPoint(lng, lat, bearingDeg, distanceMeters) {
		const R = 6371000;
		const d = distanceMeters / R;
		const brng = (bearingDeg * Math.PI) / 180;
		const lat1 = (lat * Math.PI) / 180;
		const lng1 = (lng * Math.PI) / 180;
		const lat2 = Math.asin(
			Math.sin(lat1) * Math.cos(d) +
				Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
		);
		const lng2 =
			lng1 +
			Math.atan2(
				Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
				Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
			);
		return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
	}

	// ===== FEATURE POPUP =====
	let currentPopup = null;
	function showFeaturePopup(lngLat, label, color, iconUrl) {
		if (currentPopup) currentPopup.remove();
		const iconHtml = iconUrl
			? `<img src="${iconUrl}" style="width:24px;height:24px;object-fit:contain;" onerror="this.outerHTML='<span style=\\'width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;\\'></span>'">`
			: `<span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>`;
		currentPopup = new maplibregl.Popup({
			closeButton: true,
			maxWidth: "280px",
		})
			.setLngLat(lngLat)
			.setHTML(`
          <div style="font-size:0.82rem;color:#333;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              ${iconHtml}
              <strong style="text-transform:capitalize">${label}</strong>
            </div>
            <div style="font-size:0.72rem;color:#666;">${lngLat.lat.toFixed(6)}, ${lngLat.lng.toFixed(6)}</div>
          </div>
        `)
			.addTo(map);
	}

	// ===== DIVIDER (disabled — overlay layout) =====
	function initDivider() {
		// No-op: viewer is now an overlay panel
	}

	// Resize handler
	window.addEventListener("resize", () => {
		if (map) map.resize();
		if (viewer) viewer.resize();
	});

	// ===== LAYER TOGGLES =====
	function initLayerToggles() {
		document.querySelectorAll(".layer-toggle").forEach((btn) => {
			btn.addEventListener("click", () => {
				btn.classList.toggle("active");
				const layer = btn.dataset.layer;
				const visible = btn.classList.contains("active");

				if (!map) return;

				const layerMap = {
					sequences: LOCAL_ONLY_MODE
						? [
								"local-lines-layer",
								"local-images-dots",
								"local-hover-ring",
								"local-selected-ring",
								"local-compass-fill",
								"local-compass-line",
							]
						: ["mly-sequences", "mly-images"],
					features: ["mly-feature-points", "ai-object-points-dots"],
					signs: ["mly-traffic-signs", "ai-traffic-sign-points-dots"],
					local: [
						"local-lines-layer",
						"local-images-dots",
						"local-hover-ring",
						"local-selected-ring",
						"local-compass-fill",
						"local-compass-line",
					],
				};

				(layerMap[layer] || []).forEach((id) => {
					if (map.getLayer(id)) {
						map.setLayoutProperty(
							id,
							"visibility",
							visible ? "visible" : "none",
						);
					}
				});
			});
		});
	}

	// ===== MAP CONTROLS =====
	function initMapControls() {
		document
			.getElementById("btnZoomIn")
			.addEventListener("click", () => map && map.zoomIn());
		document
			.getElementById("btnZoomOut")
			.addEventListener("click", () => map && map.zoomOut());
		document.getElementById("btnLocate").addEventListener("click", () => {
			if (currentLngLat && map) {
				map.flyTo({
					center: [currentLngLat.lng, currentLngLat.lat],
					zoom: 18,
					duration: 1000,
				});
			} else if (map) {
				const btn = document.getElementById("btnLocate");
				btn.title = "Chọn một ảnh trên bản đồ trước";
				setTimeout(() => {
					btn.title = "Vị trí ảnh đang chọn";
				}, 1600);
			}
		});
		const searchInput = document.getElementById("searchInput");
		const searchSuggestions = document.getElementById("searchSuggestions");
		const searchStatus = document.getElementById("searchStatus");
		let activeIndex = -1;
		let searchSuggestTimer = null;

		function setSearchStatus(text) {
			searchStatus.textContent = text || "";
			searchStatus.classList.toggle("visible", Boolean(text));
		}

		function hideSuggestions() {
			searchSuggestions.classList.remove("visible");
			searchSuggestions.innerHTML = "";
			activeSuggestions = [];
			activeIndex = -1;
		}

		function setSearchResultFeatures(images) {
			if (!map || !map.getSource("search-results")) return;
			map.getSource("search-results").setData({
				type: "FeatureCollection",
				features: images.map((img) => ({
					type: "Feature",
					geometry: { type: "Point", coordinates: [img.lon, img.lat] },
					properties: {
						id: img.provider_image_id,
						distance_m: img.distance_m || 0,
					},
				})),
			});
		}

		function getSearchBiasParams() {
			const center = map ? map.getCenter() : null;
			const zoom = map ? map.getZoom() : 16;
			if (!center) return `zoom=${encodeURIComponent(zoom.toFixed(2))}`;
			return `lat=${encodeURIComponent(center.lat.toFixed(6))}&lon=${encodeURIComponent(center.lng.toFixed(6))}&zoom=${encodeURIComponent(zoom.toFixed(2))}`;
		}

		async function performAddressSearch(query) {
			if (!query) return;
			if (searchAbortController) searchAbortController.abort();
			searchAbortController = new AbortController();
			setSearchStatus("");

			try {
				const res = await fetch(
					`${LOCAL_API}/search/images?q=${encodeURIComponent(query)}&radius=50&limit=50&${getSearchBiasParams()}`,
					{
						signal: searchAbortController.signal,
					},
				);
				const json = await res.json();
				if (!res.ok) throw new Error(json.error || "Search failed");

				const center = [json.center.lon, json.center.lat];
				map.flyTo({ center, zoom: 17, duration: 1400, essential: true });
				saveRecentSearch({
					label: json.selected_address,
					lat: json.center.lat,
					lon: json.center.lon,
				});

				if (searchMarker) searchMarker.remove();
				const pinEl = document.createElement("div");
				pinEl.className = "search-pin";
				searchMarker = new maplibregl.Marker({
					element: pinEl,
					anchor: "bottom",
				})
					.setLngLat(center)
					.setPopup(
						new maplibregl.Popup({ offset: 24 }).setText(json.selected_address),
					)
					.addTo(map);

				setSearchResultFeatures(json.data || []);
				setSearchStatus("");

				if (json.data && json.data.length > 0) {
					navigateViewer(String(json.data[0].provider_image_id));
				}
			} catch (e) {
				if (e.name === "AbortError") return;
				setSearchResultFeatures([]);
				setSearchStatus("");
				console.warn("Address search failed:", e);
			}
		}

		function renderSuggestions(items) {
			activeSuggestions = items;
			activeIndex = -1;
			if (!items.length) {
				hideSuggestions();
				return;
			}

			searchSuggestions.innerHTML = items
				.map(
					(item, index) =>
						`<button class="search-suggestion-item" data-index="${index}" type="button">
            <span class="search-suggestion-icon">${item.kind === "recent" ? "◷" : "📍"}</span>
            <span class="search-suggestion-label">${item.label}</span>
          </button>`,
				)
				.join("");
			searchSuggestions.classList.add("visible");

			searchSuggestions
				.querySelectorAll(".search-suggestion-item")
				.forEach((btn) => {
					btn.addEventListener("click", async () => {
						const idx = Number(btn.dataset.index);
						const item = activeSuggestions[idx];
						if (!item) return;
						searchInput.value = item.label;
						hideSuggestions();
						await performAddressSearch(item.label);
					});
				});
		}

		searchInput.addEventListener("input", () => {
			const q = searchInput.value.trim();
			clearTimeout(searchSuggestTimer);

			if (!q) {
				const recent = loadRecentSearches();
				renderSuggestions(recent);
				setSearchStatus("");
				return;
			}

			if (q.length < 2) {
				const recent = loadRecentSearches().filter((item) =>
					item.label.toLowerCase().includes(q.toLowerCase()),
				);
				renderSuggestions(recent);
				setSearchStatus("");
				return;
			}

			searchSuggestTimer = setTimeout(async () => {
				try {
					if (searchSuggestionAbort) searchSuggestionAbort.abort();
					searchSuggestionAbort = new AbortController();
					const res = await fetch(
						`${LOCAL_API}/geocode/suggest?q=${encodeURIComponent(q)}&limit=5&${getSearchBiasParams()}`,
						{
							signal: searchSuggestionAbort.signal,
						},
					);
					const json = await res.json();
					const recent = loadRecentSearches().filter((item) =>
						item.label.toLowerCase().includes(q.toLowerCase()),
					);
					const remote = (json.data || []).map((item) => ({
						...item,
						kind: "address",
					}));
					const merged = [...recent, ...remote].filter(
						(item, index, arr) =>
							item?.label &&
							arr.findIndex((x) => x.label === item.label) === index,
					);
					renderSuggestions(merged);
				} catch (e) {
					if (e.name === "AbortError") return;
					const recent = loadRecentSearches().filter((item) =>
						item.label.toLowerCase().includes(q.toLowerCase()),
					);
					renderSuggestions(recent);
				}
			}, 250);
		});

		searchInput.addEventListener("focus", () => {
			const q = searchInput.value.trim();
			if (!q) {
				renderSuggestions(loadRecentSearches());
			}
		});

		searchInput.addEventListener("keydown", async (e) => {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				if (!activeSuggestions.length) return;
				e.preventDefault();
				activeIndex =
					e.key === "ArrowDown"
						? (activeIndex + 1) % activeSuggestions.length
						: (activeIndex - 1 + activeSuggestions.length) %
							activeSuggestions.length;
				searchSuggestions
					.querySelectorAll(".search-suggestion-item")
					.forEach((el, idx) => {
						el.classList.toggle("active", idx === activeIndex);
					});
				return;
			}

			if (e.key === "Enter") {
				e.preventDefault();
				if (activeIndex >= 0) {
					const item = activeSuggestions[activeIndex];
					if (!item) return;
					searchInput.value = item.label;
					hideSuggestions();
					await performAddressSearch(item.label);
					return;
				}

				hideSuggestions();
				await performAddressSearch(searchInput.value.trim());
				return;
			}

			if (e.key === "Escape") hideSuggestions();
		});

		document.addEventListener("click", (e) => {
			if (!searchSuggestions.contains(e.target) && e.target !== searchInput) {
				hideSuggestions();
			}
		});
	}

	function initMapStyleControl() {
		const control = document.getElementById("mapStyleControl");
		const trigger = document.getElementById("mapStyleTrigger");
		const popover = document.getElementById("mapStylePopover");

		function setMapStyleOpen(open) {
			if (!control || !trigger || !popover) return;
			control.classList.toggle("open", open);
			popover.hidden = !open;
			trigger.setAttribute("aria-expanded", String(open));
		}

		trigger?.addEventListener("click", (e) => {
			e.stopPropagation();
			setMapStyleOpen(!control.classList.contains("open"));
		});

		function applyBaseMapStyle(tiles) {
			if (!map || !tiles) return;
			const beforeLayer = map.getLayer("vietnam-island-labels")
				? "vietnam-island-labels"
				: undefined;

			if (map.getLayer("fresh-base")) {
				map.removeLayer("fresh-base");
			}
			if (map.getSource("freshBase")) {
				map.removeSource("freshBase");
			}

			map.addSource("freshBase", {
				type: "raster",
				tiles,
				tileSize: 256,
				attribution: "© OpenStreetMap contributors © CARTO",
			});
			map.addLayer(
				{
					id: "fresh-base",
					type: "raster",
					source: "freshBase",
					paint: BASE_RASTER_PAINT,
				},
				beforeLayer,
			);
		}

		document.querySelectorAll(".map-style-option").forEach((btn) => {
			btn.addEventListener("click", () => {
				const styleName = btn.dataset.style;
				const tiles = MAP_STYLES[styleName];
				if (!tiles) return;

				applyBaseMapStyle(tiles);

				document.querySelectorAll(".map-style-option").forEach((option) => {
					option.classList.toggle("active", option === btn);
				});
				const activeSwatch = btn.querySelector(".map-style-swatch");
				const triggerIcon = document.querySelector(".map-style-trigger-icon");
				if (activeSwatch && triggerIcon) {
					triggerIcon.className = `map-style-trigger-icon ${[...activeSwatch.classList].find((name) => name.startsWith("swatch-")) || "swatch-standard"}`;
				}
				setMapStyleOpen(false);
			});
		});

		document.addEventListener("click", (e) => {
			if (control && !control.contains(e.target)) {
				setMapStyleOpen(false);
			}
		});
	}

	function initAnalysisDots() {
		document.querySelectorAll(".analysis-dot").forEach((btn) => {
			btn.addEventListener("click", () => {
				const field = btn.dataset.field;
				if (activeAnalysisField === field && analysisPopupOpen) {
					analysisPopupOpen = false;
					document.getElementById("analysisPopup").hidden = true;
					btn.classList.remove("active");
					return;
				}

				analysisPopupOpen = true;
				setActiveAnalysisField(field);
			});
		});
		analysisPopupOpen = false;
		document.getElementById("analysisPopup").hidden = true;
		setActiveAnalysisField(activeAnalysisField);
	}
	// ===== ICON LOADING SYSTEM =====
	const POINT_ICON_BASE =
		"https://raw.githubusercontent.com/mapillary/mapillary_sprite_source/master/package_objects/";
	const SIGN_ICON_BASE =
		"https://raw.githubusercontent.com/mapillary/mapillary_sprite_source/master/package_signs/";
	const imageLoadCache = new Map();

	function getPointIconUrl(value) {
		if (POINT_ICON_OVERRIDES[value]) return POINT_ICON_OVERRIDES[value];
		return `${POINT_ICON_BASE}${value}.svg`;
	}
	function getSignIconUrl(value) {
		return trafficSignRegistry.getSignIconUrl(value);
	}

	async function loadSvgAsMapImage(url, cssSize) {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`${res.status}`);
		const svgText = await res.text();
		const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
		const blobUrl = URL.createObjectURL(blob);
		try {
			const img = new Image();
			img.src = blobUrl;
			await img.decode();
			const pr = 2;
			const canvas = document.createElement("canvas");
			canvas.width = cssSize * pr;
			canvas.height = cssSize * pr;
			const ctx = canvas.getContext("2d");
			const scale = Math.min(
				canvas.width / img.width,
				canvas.height / img.height,
			);
			const dw = img.width * scale,
				dh = img.height * scale;
			ctx.drawImage(
				img,
				(canvas.width - dw) / 2,
				(canvas.height - dh) / 2,
				dw,
				dh,
			);
			return {
				data: ctx.getImageData(0, 0, canvas.width, canvas.height),
				pixelRatio: pr,
			};
		} finally {
			URL.revokeObjectURL(blobUrl);
		}
	}

	// Create a fallback colored circle image
	function createFallbackImage(color, size) {
		const pr = 2;
		const canvas = document.createElement("canvas");
		canvas.width = size * pr;
		canvas.height = size * pr;
		const ctx = canvas.getContext("2d");
		ctx.beginPath();
		ctx.arc(
			canvas.width / 2,
			canvas.height / 2,
			canvas.width / 2 - 2,
			0,
			Math.PI * 2,
		);
		ctx.fillStyle = color;
		ctx.fill();
		ctx.strokeStyle = "#fff";
		ctx.lineWidth = 3;
		ctx.stroke();
		return {
			data: ctx.getImageData(0, 0, canvas.width, canvas.height),
			pixelRatio: pr,
		};
	}

	function createPointFallbackImage(value, size) {
		const pr = 2;
		const canvas = document.createElement("canvas");
		canvas.width = size * pr;
		canvas.height = size * pr;
		const ctx = canvas.getContext("2d");
		const w = canvas.width;
		const h = canvas.height;
		const cx = w / 2;
		const cy = h / 2;
		const color = AI_CLASS_COLORS[value] || "#4b5563";

		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = "#111827";
		ctx.lineWidth = 2.5 * pr;
		ctx.fillStyle = color;

		if (value === "object--traffic-light" || value.startsWith("object--traffic-light--")) {
			const x = cx - 4 * pr;
			const y = cy - 10 * pr;
			ctx.fillStyle = "#1f2937";
			ctx.fillRect(x, y, 8 * pr, 20 * pr);
			ctx.strokeRect(x, y, 8 * pr, 20 * pr);
			["#ef4444", "#facc15", "#22c55e"].forEach((dotColor, idx) => {
				ctx.beginPath();
				ctx.fillStyle = dotColor;
				ctx.arc(cx, y + (4 + idx * 6) * pr, 2 * pr, 0, Math.PI * 2);
				ctx.fill();
			});
		} else if (value === "object--traffic-sign--front" || value === "object--traffic-sign--back") {
			ctx.beginPath();
			ctx.moveTo(cx, cy - 11 * pr);
			ctx.lineTo(cx + 10 * pr, cy - 1 * pr);
			ctx.lineTo(cx, cy + 9 * pr);
			ctx.lineTo(cx - 10 * pr, cy - 1 * pr);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(cx, cy + 9 * pr);
			ctx.lineTo(cx, cy + 13 * pr);
			ctx.stroke();
		} else if (value === "construction--flat--crosswalk-plain" || value === "marking--crosswalk-zebra") {
			ctx.fillStyle = "#111827";
			ctx.fillRect(cx - 11 * pr, cy - 9 * pr, 22 * pr, 18 * pr);
			ctx.fillStyle = "#f9fafb";
			for (let i = -8; i <= 8; i += 8) {
				ctx.fillRect(cx + i * pr, cy - 8 * pr, 4 * pr, 16 * pr);
			}
		} else if (value === "marking--general") {
			ctx.fillStyle = "#374151";
			ctx.fillRect(cx - 11 * pr, cy - 9 * pr, 22 * pr, 18 * pr);
			ctx.strokeStyle = "#f9fafb";
			ctx.lineWidth = 3 * pr;
			ctx.beginPath();
			ctx.moveTo(cx - 8 * pr, cy);
			ctx.lineTo(cx + 8 * pr, cy);
			ctx.stroke();
		} else if (value === "object--street-light" || value.startsWith("object--support--")) {
			ctx.strokeStyle = color;
			ctx.lineWidth = 4 * pr;
			ctx.beginPath();
			ctx.moveTo(cx, cy + 11 * pr);
			ctx.lineTo(cx, cy - 9 * pr);
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(cx + 5 * pr, cy - 9 * pr, 4 * pr, 0, Math.PI * 2);
			ctx.fillStyle = "#fde68a";
			ctx.fill();
			ctx.strokeStyle = "#111827";
			ctx.lineWidth = 1.5 * pr;
			ctx.stroke();
		} else {
			ctx.beginPath();
			ctx.arc(cx, cy, cx - 2 * pr, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = "#ffffff";
			ctx.lineWidth = 3 * pr;
			ctx.stroke();
		}

		return {
			data: ctx.getImageData(0, 0, canvas.width, canvas.height),
			pixelRatio: pr,
		};
	}

	async function ensureMapImage(kind, value) {
		const imageId = `${kind}:${value}`;
		if (map.hasImage(imageId)) return;
		if (imageLoadCache.has(imageId)) return imageLoadCache.get(imageId);
		const promise = (async () => {
			try {
				if (kind === "sg") await trafficSignRegistry.ensureSignIconOverride(value);
				const url =
					kind === "pt" ? getPointIconUrl(value) : getSignIconUrl(value);
				const size = kind === "pt" ? 32 : 36;
				const { data, pixelRatio } = await loadSvgAsMapImage(url, size);
				if (!map.hasImage(imageId)) map.addImage(imageId, data, { pixelRatio });
			} catch (e) {
				if (!map.hasImage(imageId)) {
					if (kind === "sg") {
						const label = SIGN_TYPES_MAP[value]?.label || value;
						try {
							const generatedUrl =
								SIGN_ICON_OVERRIDES[value] ||
								trafficSignRegistry.buildGeneratedSignIconUrl(label);
							const { data, pixelRatio } = await loadSvgAsMapImage(generatedUrl, 36);
							map.addImage(imageId, data, { pixelRatio });
							return;
						} catch {
							// fall through to colored circle
						}
					}
					const color = kind === "pt" ? AI_CLASS_COLORS[value] || "#4b5563" : "#ff8400";
					const fb = kind === "pt"
						? createPointFallbackImage(value, 24)
						: createFallbackImage(color, 24);
					map.addImage(imageId, fb.data, { pixelRatio: fb.pixelRatio });
				}
			}
		})();
		imageLoadCache.set(imageId, promise);
		await promise;
		imageLoadCache.delete(imageId);
	}

	function setupIconLoading() {
		// Lazy-load any missing icon
		map.on("styleimagemissing", (e) => {
			const id = e.id;
			if (id.startsWith("pt:")) ensureMapImage("pt", id.slice(3));
			else if (id.startsWith("sg:")) ensureMapImage("sg", id.slice(3));
		});

		// Preload point icons (small finite set)
		POINT_TYPES.forEach((t) => ensureMapImage("pt", t.value));
	}

	// ===== DATA: POINT TYPES =====
	const POINT_TYPES = [
		{ value: "marking--general", label: "Road marking" },
		{
			value: "construction--flat--crosswalk-plain",
			label: "Crosswalk - plain",
		},
		{ value: "marking--crosswalk-zebra", label: "Crosswalk - zebra" },
		{ value: "object--banner", label: "Banner" },
		{ value: "object--bench", label: "Bench" },
		{ value: "object--bike-rack", label: "Bike rack" },
		{ value: "object--catch-basin", label: "Catch basin" },
		{ value: "object--cctv-camera", label: "CCTV camera" },
		{ value: "object--fire-hydrant", label: "Fire hydrant" },
		{ value: "object--junction-box", label: "Junction box" },
		{ value: "object--mailbox", label: "Mailbox" },
		{ value: "object--manhole", label: "Manhole" },
		{ value: "object--parking-meter", label: "Parking meter" },
		{ value: "object--phone-booth", label: "Phone booth" },
		{ value: "object--sign--advertisement", label: "Signage - Advertisement" },
		{ value: "object--sign--information", label: "Signage - Information" },
		{ value: "object--sign--store", label: "Signage - Store" },
		{ value: "object--street-light", label: "Street light" },
		{ value: "object--support--pole", label: "Pole" },
		{
			value: "object--support--traffic-sign-frame",
			label: "Traffic sign frame",
		},
		{ value: "object--support--utility-pole", label: "Utility pole" },
		{ value: "object--traffic-light", label: "Traffic light" },
		{ value: "object--traffic-sign--back", label: "Traffic sign - back" },
		{ value: "object--traffic-sign--front", label: "Traffic sign - front" },
		{ value: "object--trash-can", label: "Trash can" },
	];

	const POINT_TYPES_MAP = {};
	POINT_TYPES.forEach((t) => (POINT_TYPES_MAP[t.value] = t));
	function svgDataUri(svg) {
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	}
	const POINT_ICON_OVERRIDES = {
		"marking--general": svgDataUri(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="5" y="10" width="22" height="12" rx="2" fill="#374151"/><path d="M8 16h16" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
		),
		"marking--crosswalk-zebra": svgDataUri(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="8" width="24" height="16" rx="2" fill="#111827"/><path d="M9 9v14M16 9v14M23 9v14" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>',
		),
		"object--traffic-light": svgDataUri(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="11" y="4" width="10" height="24" rx="3" fill="#1f2937" stroke="#111827" stroke-width="2"/><circle cx="16" cy="10" r="3" fill="#ef4444"/><circle cx="16" cy="16" r="3" fill="#facc15"/><circle cx="16" cy="22" r="3" fill="#22c55e"/></svg>',
		),
		"object--traffic-sign--back": svgDataUri(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 3 28 15 16 27 4 15Z" fill="#c0c0c0" stroke="#111827" stroke-width="2"/><path d="M16 27v4" stroke="#111827" stroke-width="2" stroke-linecap="round"/></svg>',
		),
		"object--traffic-sign--front": svgDataUri(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 3 28 15 16 27 4 15Z" fill="#dcdc00" stroke="#111827" stroke-width="2"/><path d="M16 27v4" stroke="#111827" stroke-width="2" stroke-linecap="round"/></svg>',
		),
	};
	const AI_CLASS_COLORS = {
		"marking--general": "rgb(255,255,255)",
		"construction--flat--crosswalk-plain": "rgb(140,140,200)",
		"marking--crosswalk-zebra": "rgb(200,128,128)",
		"object--banner": "rgb(255,255,128)",
		"object--bench": "rgb(250,0,30)",
		"object--bike-rack": "rgb(100,140,180)",
		"object--catch-basin": "rgb(220,128,128)",
		"object--cctv-camera": "rgb(222,40,40)",
		"object--fire-hydrant": "rgb(100,170,30)",
		"object--junction-box": "rgb(40,40,40)",
		"object--mailbox": "rgb(33,33,33)",
		"object--manhole": "rgb(100,128,160)",
		"object--phone-booth": "rgb(142,0,0)",
		"object--street-light": "rgb(210,170,100)",
		"object--support--pole": "rgb(153,153,153)",
		"object--support--traffic-sign-frame": "rgb(128,128,128)",
		"object--support--utility-pole": "rgb(0,0,80)",
		"object--traffic-light": "rgb(250,170,30)",
		"object--traffic-light--general-upright": "rgb(250,170,30)",
		"object--traffic-sign--back": "rgb(192,192,192)",
		"object--traffic-sign--front": "rgb(220,220,0)",
		"object--trash-can": "rgb(140,140,20)",
	};
	const AI_CLASS_TO_POINT_VALUE = {
		"object--traffic-light--general-upright": "object--traffic-light",
		"object--traffic-light--general-horizontal": "object--traffic-light",
		"object--traffic-light--general-single": "object--traffic-light",
		"object--traffic-light--cyclists": "object--traffic-light",
		"object--traffic-light--pedestrians": "object--traffic-light",
		"object--traffic-light--other": "object--traffic-light",
	};
	function mapAiClassToPointValue(value) {
		const raw = String(value || "").trim();
		if (!raw) return "object--banner";
		if (POINT_TYPES_MAP[raw]) return raw;
		return AI_CLASS_TO_POINT_VALUE[raw] || "object--banner";
	}

	function isAiTrafficSignPoint(point) {
		const label = String(point?.label || "");
		return point?.class_id === 53 || label === "object--traffic-sign--front";
	}

	// ===== DATA: TRAFFIC SIGN TYPES =====
	const SIGN_TYPES = [
		{ value: "warning--pedestrians-crossing--g1", label: "Pedestrian Crossing", cat: "warning" },
		{ value: "warning--crossroads--g1", label: "Equal-level Intersection", cat: "warning" },
		{ value: "regulatory--no-entry--g1", label: "No Entry", cat: "regulatory" },
		{ value: "regulatory--turn-right--g1", label: "Right Turn Only", cat: "regulatory" },
		{ value: "warning--crossroads--g1", label: "Intersection", cat: "warning" },
		{ value: "warning--crossroads-with-priority-to-the-right--g1", label: "Intersection with a non-priority road", cat: "warning" },
		{ value: "ai-sign--danger-left", label: "Danger zone on the left", cat: "warning" },
		{ value: "regulatory--no-left-turn--g1", label: "No Left Turn", cat: "regulatory" },
		{ value: "information--bus-stop--g1", label: "Bus Stop", cat: "information" },
		{ value: "regulatory--roundabout--g1", label: "Roundabout", cat: "regulatory" },
		{ value: "regulatory--no-stopping-no-parking--g1", label: "No Stopping and No Parking", cat: "regulatory" },
		{ value: "ai-sign--u-turn-allowed", label: "U-Turn Allowed", cat: "regulatory" },
		{ value: "ai-sign--lane-allocation", label: "Lane Allocation", cat: "information" },
		{ value: "ai-sign--slow-down", label: "Slow Down", cat: "warning" },
		{ value: "regulatory--no-heavy-goods-vehicles--g1", label: "No Trucks Allowed", cat: "regulatory" },
		{ value: "warning--road-narrows-right--g1", label: "Narrow Road on the Right", cat: "warning" },
		{ value: "regulatory--height-limit--g1", label: "Height Limit", cat: "regulatory" },
		{ value: "regulatory--no-u-turn--g1", label: "No U-Turn", cat: "regulatory" },
		{ value: "ai-sign--no-cars-trucks", label: "No Passenger Cars and Trucks", cat: "regulatory" },
		{ value: "ai-sign--no-u-turn-right", label: "No U-Turn and No Right Turn", cat: "regulatory" },
		{ value: "regulatory--no-motor-vehicles--g1", label: "No Cars Allowed", cat: "regulatory" },
		{ value: "warning--road-narrows-left--g1", label: "Narrow Road on the Left", cat: "warning" },
		{ value: "warning--uneven-road--g1", label: "Uneven Road", cat: "warning" },
		{ value: "ai-sign--no-two-three-wheeled", label: "No Two or Three-wheeled Vehicles", cat: "regulatory" },
		{ value: "ai-sign--customs-checkpoint", label: "Customs Checkpoint", cat: "regulatory" },
		{ value: "regulatory--motorcycles-only--g1", label: "Motorcycles Only", cat: "regulatory" },
		{ value: "complementary--obstacle-delineator--g1", label: "Obstacle on the Road", cat: "complementary" },
		{ value: "warning--children--g1", label: "Children Present", cat: "warning" },
		{ value: "complementary--trucks--g1", label: "Trucks and Containers", cat: "complementary" },
		{ value: "regulatory--no-motorcycles--g1", label: "No Motorcycles Allowed", cat: "regulatory" },
		{ value: "ai-sign--trucks-only", label: "Trucks Only", cat: "regulatory" },
		{ value: "ai-sign--surveillance-camera", label: "Road with Surveillance Camera", cat: "information" },
		{ value: "regulatory--no-right-turn--g1", label: "No Right Turn", cat: "regulatory" },
		{ value: "warning--double-curve-first-right--g1", label: "Double curve first to right", cat: "warning" },
		{ value: "ai-sign--no-containers", label: "No Containers Allowed", cat: "regulatory" },
		{ value: "ai-sign--no-left-right-turn", label: "No Left or Right Turn", cat: "regulatory" },
		{ value: "ai-sign--no-straight-right-turn", label: "No Straight and Right Turn", cat: "regulatory" },
		{ value: "warning--t-roads--g1", label: "Intersection with T-Junction", cat: "warning" },
		{ value: "regulatory--maximum-speed-limit-50--g1", label: "Speed limit (50km/h)", cat: "regulatory" },
		{ value: "regulatory--maximum-speed-limit-60--g1", label: "Speed limit (60km/h)", cat: "regulatory" },
		{ value: "regulatory--maximum-speed-limit-80--g1", label: "Speed limit (80km/h)", cat: "regulatory" },
		{ value: "regulatory--maximum-speed-limit-40--g1", label: "Speed limit (40km/h)", cat: "regulatory" },
		{ value: "regulatory--turn-left--g1", label: "Left Turn", cat: "regulatory" },
		{ value: "regulatory--height-limit--g1", label: "Low Clearance", cat: "regulatory" },
		{ value: "warning--other-danger--g1", label: "Other Danger", cat: "warning" },
		{ value: "regulatory--one-way-right--g1", label: "One-way street", cat: "regulatory" },
		{ value: "regulatory--no-parking--g1", label: "No Parking", cat: "regulatory" },
		{ value: "ai-sign--no-u-turn-cars", label: "No U-Turn for Cars", cat: "regulatory" },
		{ value: "warning--railroad-crossing-with-barriers--g1", label: "Level Crossing with Barriers", cat: "warning" },
		{ value: "ai-sign--no-u-turn-left", label: "No U-Turn and No Left Turn", cat: "regulatory" },
		{ value: "ai-sign--danger-right", label: "Danger zone on the right", cat: "warning" },
		{ value: "ai-sign--obstacle-pass-right", label: "Warning: Obstacle ahead - pass on the right", cat: "warning" },
	];
	function signSvg(body, bg = "#ffffff", border = "#111827") {
		return svgDataUri(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" rx="6" fill="${bg}" stroke="${border}" stroke-width="3"/>${body}</svg>`,
		);
	}
	function warningSignSvg(symbol) {
		return svgDataUri(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M20 4 37 34H3Z" fill="#facc15" stroke="#111827" stroke-width="3" stroke-linejoin="round"/>${symbol}</svg>`,
		);
	}
	function prohibitionSignSvg(symbol) {
		return svgDataUri(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="#fff" stroke="#dc2626" stroke-width="4"/><path d="M10 30 30 10" stroke="#dc2626" stroke-width="4" stroke-linecap="round"/>${symbol}</svg>`,
		);
	}
	function textSignSvg(text, bg = "#2563eb") {
		return signSvg(
			`<text x="20" y="24" text-anchor="middle" font-family="Arial,sans-serif" font-size="${text.length > 3 ? 8 : 12}" font-weight="700" fill="#fff">${text}</text>`,
			bg,
			"#1e3a8a",
		);
	}
	const SIGN_ICON_OVERRIDES = {
		"ai-sign--danger-left": warningSignSvg('<path d="M24 12 14 20l10 8" fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'),
		"ai-sign--danger-right": warningSignSvg('<path d="M16 12 26 20l-10 8" fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'),
		"ai-sign--u-turn-allowed": signSvg('<path d="M25 29V15a6 6 0 0 0-12 0v2" fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round"/><path d="M9 17h8l-4 5Z" fill="#111827"/>'),
		"ai-sign--lane-allocation": textSignSvg("LANE"),
		"ai-sign--slow-down": warningSignSvg('<text x="20" y="25" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#111827">SLOW</text>'),
		"ai-sign--no-cars-trucks": prohibitionSignSvg('<text x="20" y="23" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#111827">CAR</text>'),
		"ai-sign--no-u-turn-right": prohibitionSignSvg('<path d="M16 27V15a4 4 0 0 1 8 0v2" fill="none" stroke="#111827" stroke-width="3" stroke-linecap="round"/><path d="M24 17h7l-4 5Z" fill="#111827"/>'),
		"ai-sign--no-two-three-wheeled": prohibitionSignSvg('<text x="20" y="23" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#111827">2/3W</text>'),
		"ai-sign--customs-checkpoint": textSignSvg("HQ", "#0f766e"),
		"ai-sign--trucks-only": textSignSvg("TRK", "#2563eb"),
		"ai-sign--surveillance-camera": signSvg('<path d="M12 17h12l4-4v14l-4-4H12Z" fill="#111827"/><circle cx="17" cy="20" r="2" fill="#fff"/>', "#e0f2fe", "#0369a1"),
		"ai-sign--no-containers": prohibitionSignSvg('<text x="20" y="23" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#111827">CONT</text>'),
		"ai-sign--no-left-right-turn": prohibitionSignSvg('<path d="M20 28V14M20 14l-7 6M20 14l7 6" fill="none" stroke="#111827" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
		"ai-sign--no-straight-right-turn": prohibitionSignSvg('<path d="M15 28V12M15 12l-5 5M15 12l5 5M20 20h8l-4-4" fill="none" stroke="#111827" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
		"ai-sign--no-u-turn-cars": prohibitionSignSvg('<text x="20" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#111827">U</text><text x="20" y="26" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#111827">CAR</text>'),
		"ai-sign--no-u-turn-left": prohibitionSignSvg('<path d="M24 27V15a4 4 0 0 0-8 0v2" fill="none" stroke="#111827" stroke-width="3" stroke-linecap="round"/><path d="M16 17H9l4 5Z" fill="#111827"/>'),
		"ai-sign--obstacle-pass-right": warningSignSvg('<path d="M14 27h5l7-14h-5Z" fill="#111827"/><path d="M27 20h6l-4-4" fill="none" stroke="#111827" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
		"regulatory--no-stopping-no-parking--g1": prohibitionSignSvg('<path d="M14 12v16M26 12v16" stroke="#111827" stroke-width="3" stroke-linecap="round"/>'),
		"warning--road-narrows-right--g1": warningSignSvg('<path d="M14 28V13M26 28 21 13" stroke="#111827" stroke-width="4" stroke-linecap="round"/>'),
		"warning--road-narrows-left--g1": warningSignSvg('<path d="M26 28V13M14 28l5-15" stroke="#111827" stroke-width="4" stroke-linecap="round"/>'),
		"regulatory--motorcycles-only--g1": textSignSvg("MOTO", "#2563eb"),
		"regulatory--no-motorcycles--g1": prohibitionSignSvg('<text x="20" y="23" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#111827">MOTO</text>'),
	};
	const trafficSignRegistry = createTrafficSignRegistry(SIGN_TYPES, SIGN_ICON_OVERRIDES);
	const SIGN_TYPES_MAP = trafficSignRegistry.signTypesMap;
	const SIGN_LABEL_TO_VALUE = trafficSignRegistry.signLabelToValue;
	let rebuildSignFilterDropdown = () => {};

	function mapAiSignNameToSignValue(value) {
		const raw = String(value || "").trim();
		if (!raw) return "";
		if (SIGN_TYPES_MAP[raw]) return raw;
		return trafficSignRegistry.resolveSignValue(raw);
	}

	function buildAiObjectPointProperties(point) {
		const signValue = isAiTrafficSignPoint(point) ? mapAiSignNameToSignValue(point.sign_name || point.label) : "";
		const objectValue = mapAiClassToPointValue(point.icon_value || point.label);
		return {
			id: point.point_id,
			label: point.label,
			value: signValue || objectValue,
			icon_value: objectValue,
			sign_value: signValue || undefined,
			confidence: point.confidence,
			num_obs: point.num_obs,
			residual_m: point.residual_m,
			seen_in: JSON.stringify(point.seen_in || []),
		};
	}

	// ===== FILTER STATE =====
	const activePointFilters = new Set();
	const activeSignFilters = new Set();

	// ===== GENERIC FILTER PANEL =====
	function initFilterPanel({
		dropdownBtnId,
		dropdownListId,
		tagsId,
		countId,
		downloadBtnId,
		items,
		selectedSet,
		getIconUrl,
		layerId,
		onApply,
		allLabel,
	}) {
		const dropdownBtn = document.getElementById(dropdownBtnId);
		const dropdownList = document.getElementById(dropdownListId);
		const tagsEl = document.getElementById(tagsId);
		const countEl = document.getElementById(countId);
		const downloadBtn = document.getElementById(downloadBtnId);

		// Add search input for filtering
		const searchEl = document.createElement("div");
		searchEl.style.cssText =
			"padding:8px 10px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:#fff;z-index:1;";
		searchEl.innerHTML =
			'<input type="text" placeholder="Search..." style="width:100%;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.82rem;outline:none;">';
		dropdownList.appendChild(searchEl);
		const searchInput = searchEl.querySelector("input");
		searchInput.addEventListener("input", () => {
			const q = searchInput.value.toLowerCase();
			dropdownList.querySelectorAll(".filter-dropdown-item").forEach((el) => {
				const text = el.textContent.toLowerCase();
				el.style.display = text.includes(q) ? "" : "none";
			});
		});
		searchInput.addEventListener("click", (e) => e.stopPropagation());

		function appendDropdownItem(item) {
			const el = document.createElement("div");
			el.className = "filter-dropdown-item";
			el.dataset.value = item.value;
			let iconHtml;
			if (item.value === ALL_OPTION) {
				iconHtml = '<span class="obj-icon" style="font-size:1.1rem;">🔵</span>';
			} else if (getIconUrl) {
				iconHtml = `<span class="obj-icon"><img src="${getIconUrl(item.value)}" alt="" loading="lazy" onerror="this.style.display='none'"></span>`;
			} else {
				iconHtml = `<span class="obj-icon" style="width:24px;height:24px;border-radius:4px;background:#ff8400;"></span>`;
			}
			el.innerHTML = `${iconHtml}<span>${item.label}${item.desc ? `<br><small style="color:#9ca3af;font-size:0.7rem">${item.desc}</small>` : ""}</span>`;
			el.addEventListener("click", () => {
				if (item.value === ALL_OPTION) {
					if (selectedSet.has(ALL_OPTION)) {
						selectedSet.clear();
					} else {
						selectedSet.clear();
						selectedSet.add(ALL_OPTION);
					}
				} else {
					selectedSet.delete(ALL_OPTION);
					if (selectedSet.has(item.value)) {
						selectedSet.delete(item.value);
					} else {
						selectedSet.add(item.value);
					}
				}
				renderFilterState();
				dropdownList.classList.remove("open");
			});
			dropdownList.appendChild(el);
		}

		function rebuildDropdownItems() {
			dropdownList.querySelectorAll(".filter-dropdown-item").forEach((el) => el.remove());
			appendDropdownItem({ value: ALL_OPTION, label: allLabel || "All" });
			items.forEach((item) => appendDropdownItem(item));
			renderFilterState();
		}

		rebuildDropdownItems();

		// Toggle dropdown
		dropdownBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			// Close other dropdowns
			document.querySelectorAll(".filter-dropdown-list.open").forEach((el) => {
				if (el !== dropdownList) el.classList.remove("open");
			});
			dropdownList.classList.toggle("open");
		});

		// Download
		if (downloadBtn) {
			downloadBtn.addEventListener("click", () =>
				downloadLayerFeatures(layerId),
			);
		}

		function renderFilterState() {
			// Tags
			tagsEl.innerHTML = "";
			selectedSet.forEach((val) => {
				const meta =
					val === ALL_OPTION
						? { label: allLabel || "All" }
						: items.find((i) => i.value === val) || SIGN_TYPES_MAP[val];
				if (!meta) return;
				const tag = document.createElement("span");
				tag.className = "filter-tag";
				const imgTag = getIconUrl
					? `<img src="${getIconUrl(val)}" alt="">`
					: "";
				tag.innerHTML = `${imgTag}${meta.label}<span class="tag-x">✕</span>`;
				tag.querySelector(".tag-x").addEventListener("click", () => {
					selectedSet.delete(val);
					renderFilterState();
				});
				tagsEl.appendChild(tag);
			});

			// Update dropdown selected state
			dropdownList.querySelectorAll(".filter-dropdown-item").forEach((el) => {
				el.classList.toggle("selected", selectedSet.has(el.dataset.value));
			});

			// Count text
			if (selectedSet.size === 0) {
				countEl.textContent = "";
			} else {
				countEl.textContent = `Filtered: ${selectedSet.size} type${selectedSet.size > 1 ? "s" : ""}`;
			}

			// Apply map filter
			onApply(selectedSet);
		}

		return rebuildDropdownItems;
	}

	const ALL_OPTION = "__ALL__";

	function applyPointFilter(selected) {
		if (!map) return;
		const layerFilters = [];
		if (map.getLayer("mly-feature-points")) layerFilters.push(["mly-feature-points", null]);
		if (map.getLayer("ai-object-points-dots")) layerFilters.push(["ai-object-points-dots", ["!", ["has", "sign_value"]]]);
		if (!layerFilters.length) return;
		if (selected.has(ALL_OPTION)) {
			layerFilters.forEach(([id, baseFilter]) => map.setFilter(id, baseFilter)); // show all
		} else if (selected.size === 0) {
			layerFilters.forEach(([id, baseFilter]) =>
				map.setFilter(id, baseFilter ? ["all", baseFilter, ["==", ["get", "value"], "__none__"]] : ["==", ["get", "value"], "__none__"]),
			); // hide all
		} else {
			layerFilters.forEach(([id, baseFilter]) =>
				map.setFilter(id, baseFilter ? ["all", baseFilter, ["match", ["get", "value"], [...selected], true, false]] : ["match", ["get", "value"], [...selected], true, false]),
			);
		}
	}

	function applySignFilter(selected) {
		if (!map) return;
		const layerFilters = [];
		if (map.getLayer("mly-traffic-signs")) layerFilters.push(["mly-traffic-signs", null]);
		if (map.getLayer("ai-traffic-sign-points-dots")) layerFilters.push(["ai-traffic-sign-points-dots", ["has", "sign_value"]]);
		if (!layerFilters.length) return;
		if (selected.has(ALL_OPTION)) {
			layerFilters.forEach(([id, baseFilter]) => map.setFilter(id, baseFilter)); // show all
		} else if (selected.size === 0) {
			layerFilters.forEach(([id, baseFilter]) =>
				map.setFilter(id, baseFilter ? ["all", baseFilter, ["==", ["get", "value"], "__none__"]] : ["==", ["get", "value"], "__none__"]),
			); // hide all
		} else {
			layerFilters.forEach(([id, baseFilter]) =>
				map.setFilter(id, baseFilter ? ["all", baseFilter, ["match", ["get", "value"], [...selected], true, false]] : ["match", ["get", "value"], [...selected], true, false]),
			);
		}
	}

	function downloadLayerFeatures(layerId) {
		if (!map) return;
		const features = map.queryRenderedFeatures({ layers: [layerId] });
		if (!features.length) {
			alert("Không có dữ liệu hiển thị để tải.");
			return;
		}
		const geojson = {
			type: "FeatureCollection",
			features: features.map((f) => ({
				type: "Feature",
				geometry: f.geometry,
				properties: f.properties,
			})),
		};
		const blob = new Blob([JSON.stringify(geojson, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = layerId + ".json";
		a.click();
		URL.revokeObjectURL(url);
	}

	// ===== INIT BOTH PANELS =====
	function initFilterPanels() {
		initFilterPanel({
			dropdownBtnId: "pointsDropdownBtn",
			dropdownListId: "pointsDropdownList",
			tagsId: "pointsTags",
			countId: "pointsCount",
			downloadBtnId: "downloadPointsBtn",
			items: POINT_TYPES,
			selectedSet: activePointFilters,
			getIconUrl: getPointIconUrl,
			layerId: "mly-feature-points",
			onApply: applyPointFilter,
			allLabel: "All points",
		});

		rebuildSignFilterDropdown = initFilterPanel({
			dropdownBtnId: "signsDropdownBtn",
			dropdownListId: "signsDropdownList",
			tagsId: "signsTags",
			countId: "signsCount",
			downloadBtnId: "downloadSignsBtn",
			items: SIGN_TYPES,
			selectedSet: activeSignFilters,
			getIconUrl: getSignIconUrl,
			layerId: "mly-traffic-signs",
			onApply: applySignFilter,
			allLabel: "All signs",
		});
	}

	function registerAiSignNamesFromPayload(payload) {
		let addedDynamicSign = false;
		const names = new Set();
		const collect = (value) => {
			const raw = String(value || "").trim();
			if (raw) names.add(raw);
		};
		for (const point of payload?.object_points || []) collect(point.sign_name);
		for (const frame of payload?.data || []) {
			for (const seg of frame.segmentations || []) collect(seg.sign_name);
		}
		for (const name of names) {
			const before = trafficSignRegistry.dynamicValues.size;
			mapAiSignNameToSignValue(name);
			if (trafficSignRegistry.dynamicValues.size > before) addedDynamicSign = true;
		}
		if (addedDynamicSign) rebuildSignFilterDropdown();
		return [...names].map((name) => mapAiSignNameToSignValue(name)).filter(Boolean);
	}

	// Close dropdowns on outside click
	document.addEventListener("click", (e) => {
		if (!e.target.closest(".filter-panel")) {
			document
				.querySelectorAll(".filter-dropdown-list.open")
				.forEach((el) => el.classList.remove("open"));
		}
	});

	// ===== DETECTION PANEL =====
	const detPanel = document.getElementById("detectionPanel");
	const detList = document.getElementById("detectionList");
	const detTitle = document.getElementById("detectionTitle");
	const detIcon = document.getElementById("detectionIcon");
	const detPageInfo = document.getElementById("detectionPageInfo");
	const detNextBtn = document.getElementById("detectionNextBtn");

	let allDetections = [];
	let detPage = 0;
	const DET_PER_PAGE = 3;

	document
		.getElementById("detectionClose")
		.addEventListener("click", closeDetectionPanel);
	initObjectImageModal();
	detNextBtn.addEventListener("click", () => {
		detPage++;
		renderDetectionPage();
	});

	function closeDetectionPanel() {
		closeObjectImageModal();
		detPanel.classList.remove("open");
		allDetections = [];
		detPage = 0;
		clearObjectSeenImageMarkers();
	}

	async function openDetectionPanel(mapFeatureId, label, iconUrl, coords) {
		// Show panel immediately with loading state
		detTitle.textContent = label;
		detIcon.src = iconUrl;
		detIcon.onerror = () => {
			detIcon.style.display = "none";
		};
		detList.innerHTML =
			'<div style="padding:32px;text-align:center;color:#9ca3af;">Loading detections...</div>';
		detPageInfo.textContent = "";
		detNextBtn.style.display = "none";
		detPanel.classList.add("open");
		clearObjectSeenImageMarkers();

		try {
			// Fetch detections via local backend API (cache-on-read)
			const res = await fetch(
				`http://localhost:3000/api/v1/map-features/${mapFeatureId}/detections`,
			);
			const json = await res.json();
			const detData = json.data || [];

			if (detData.length === 0) {
				detList.innerHTML =
					'<div style="padding:32px;text-align:center;color:#9ca3af;">No detections found.</div>';
				return;
			}

			// Detections already have _thumb data from backend (cached with thumb URLs)
			allDetections = detData;
			detPage = 0;
			const markerItems = buildDetectionMarkerItems(detData);
			if (markerItems.length) {
				updateObjectSeenImageMarkers(markerItems);
				fitMapToObjectSeenSequence(markerItems, coords);
			}

			renderDetectionPage();
		} catch (err) {
			console.warn("Detection fetch failed:", err);
			detList.innerHTML =
				'<div style="padding:32px;text-align:center;color:#e05643;">Failed to load detections.</div>';
		}
	}

	async function openAiObjectDetectionPanel(properties, objectCoords = null) {
		const pointId = properties?.id;
		if (!pointId) return;
		const label = properties.sign_value
			? SIGN_TYPES_MAP[properties.sign_value]?.label || properties.sign_value
			: POINT_TYPES_MAP[properties.icon_value]?.label || properties.label || pointId;
		const iconUrl = properties.sign_value
			? getSignIconUrl(properties.sign_value)
			: getPointIconUrl(properties.icon_value || properties.label);
		const seenIn = parseSeenInEntries(properties);

		detTitle.textContent = label;
		detIcon.style.display = "";
		detIcon.src = iconUrl;
		detIcon.onerror = () => {
			detIcon.style.display = "none";
		};
		detList.innerHTML =
			'<div style="padding:32px;text-align:center;color:#9ca3af;">Loading AI object images...</div>';
		detPageInfo.textContent = "";
		detNextBtn.style.display = "none";
		detPanel.classList.add("open");

		if (seenIn.length) {
			updateSeenInMarkers(seenIn, []);
		} else {
			clearObjectSeenImageMarkers();
		}

		try {
			const res = await fetch(`${LOCAL_API}/ai-object-points/${encodeURIComponent(pointId)}/images`);
			const json = await res.json();
			if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
			const items = json.data || [];
			const markerItems = buildSeenInMarkerItems(seenIn, items);
			const displayItems = markerItems.length ? markerItems : items;
			if (!displayItems.length) {
				if (!seenIn.length) clearObjectSeenImageMarkers();
				detList.innerHTML =
					'<div style="padding:32px;text-align:center;color:#9ca3af;">No AI upload images found for this object.</div>';
				return;
			}
			detTitle.textContent = `${label} · ${displayItems.length} ảnh trên sequence`;
			allDetections = displayItems.map((item) => {
				const providerImageId = item.image?.provider_image_id;
				return {
				type: "ai-object-image",
				image: item.image,
				instance_id: item.instance_id,
				thumb_url: item.thumb_url || (providerImageId ? `/api/v1/ai-images/${encodeURIComponent(providerImageId)}/image` : ""),
				};
			});
			detPage = 0;
			if (displayItems.length) {
				updateObjectSeenImageMarkers(displayItems);
				fitMapToObjectSeenSequence(displayItems, objectCoords);
			}
			renderDetectionPage();
		} catch (err) {
			console.warn("AI object image fetch failed:", err);
			detList.innerHTML =
				'<div style="padding:32px;text-align:center;color:#e05643;">Failed to load AI object images.</div>';
		}
	}

	function openObjectImageModalFromMap(providerImageId, instanceId = null) {
		if (!providerImageId) return;
		const card = document.querySelector(
			`.detection-card[data-image-id="${CSS.escape(providerImageId)}"]`,
		);
		openObjectImageModal(
			providerImageId,
			card || null,
			instanceId ?? card?.dataset?.instanceId ?? null,
		);
	}

	function resolveBboxImageDimensions(matrix, imageWidth, imageHeight, imageSize, naturalW, naturalH) {
		if (naturalW > 0 && naturalH > 0) {
			return { sourceW: naturalW, sourceH: naturalH };
		}
		const matrixW = matrix?.[0]?.length || 1;
		const matrixH = matrix?.length || 1;
		const matrixAspect = matrixW / matrixH;
		const candidates = [];
		if (Array.isArray(imageSize) && imageSize.length >= 2) {
			candidates.push([imageSize[0], imageSize[1]], [imageSize[1], imageSize[0]]);
		}
		if (imageWidth > 0 && imageHeight > 0) {
			candidates.push([imageWidth, imageHeight], [imageHeight, imageWidth]);
		}
		if (!candidates.length) {
			return { sourceW: matrixW, sourceH: matrixH };
		}
		let best = candidates[0];
		let bestDiff = Infinity;
		for (const [w, h] of candidates) {
			const diff = Math.abs(w / h - matrixAspect);
			if (diff < bestDiff) {
				bestDiff = diff;
				best = [w, h];
			}
		}
		return { sourceW: best[0], sourceH: best[1] };
	}

	function bboxStyleForCover(bbox, sourceW, sourceH, container) {
		if (!bbox || !sourceW || !sourceH || !container) return "";
		const rect = container.getBoundingClientRect();
		const containerW = rect.width || container.clientWidth || 1;
		const containerH = rect.height || container.clientHeight || 1;
		const scale = Math.max(containerW / sourceW, containerH / sourceH);
		const drawW = sourceW * scale;
		const drawH = sourceH * scale;
		const offsetX = (containerW - drawW) / 2;
		const offsetY = (containerH - drawH) / 2;
		const left = ((bbox.x * scale + offsetX) / containerW) * 100;
		const top = ((bbox.y * scale + offsetY) / containerH) * 100;
		const width = (bbox.w * scale / containerW) * 100;
		const height = (bbox.h * scale / containerH) * 100;
		return `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
	}

	function computeInstanceBbox(matrix, instanceId, imageWidth, imageHeight) {
		const target = Number(instanceId);
		if (!target || !Array.isArray(matrix) || !matrix.length) return null;
		const matrixW = matrix[0]?.length || 1;
		const matrixH = matrix.length;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -1;
		let maxY = -1;
		for (let y = 0; y < matrixH; y++) {
			const row = matrix[y];
			if (!Array.isArray(row)) continue;
			for (let x = 0; x < row.length; x++) {
				if (Number(row[x]) !== target) continue;
				if (x < minX) minX = x;
				if (y < minY) minY = y;
				if (x > maxX) maxX = x;
				if (y > maxY) maxY = y;
			}
		}
		if (maxX < minX || maxY < minY) return null;
		const sourceW = Number(imageWidth) || matrixW;
		const sourceH = Number(imageHeight) || matrixH;
		const scaleX = sourceW / matrixW;
		const scaleY = sourceH / matrixH;
		return {
			x: minX * scaleX,
			y: minY * scaleY,
			w: (maxX - minX + 1) * scaleX,
			h: (maxY - minY + 1) * scaleY,
			sourceW,
			sourceH,
		};
	}

	async function attachAiObjectBbox(card, imageId, instanceId, imageWidth, imageHeight) {
		if (!card || !imageId || instanceId == null) return;
		const imgBox = card.querySelector(".detection-card-img");
		if (!imgBox) return;
		try {
			const res = await fetch(`${LOCAL_API}/ai-images/${encodeURIComponent(imageId)}/instance-matrix`);
			const json = await res.json();
			if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
			const matrix = json.instance_matrix || json.mask_matrix;
			if (!Array.isArray(matrix) || !matrix.length) return;
			let box = imgBox.querySelector(".detection-bbox");
			if (!box) {
				box = document.createElement("div");
				box.className = "detection-bbox";
				imgBox.appendChild(box);
			}
			const img = imgBox.querySelector("img");
			const paintBbox = () => {
				const dims = resolveBboxImageDimensions(
					matrix,
					imageWidth,
					imageHeight,
					json.image_size,
					img?.naturalWidth,
					img?.naturalHeight,
				);
				const bbox = computeInstanceBbox(matrix, instanceId, dims.sourceW, dims.sourceH);
				if (!bbox) return;
				box.setAttribute(
					"style",
					bboxStyleForCover(bbox, dims.sourceW, dims.sourceH, imgBox),
				);
			};
			paintBbox();
			if (img) {
				if (img.complete) paintBbox();
				else img.addEventListener("load", paintBbox, { once: true });
			}
		} catch (err) {
			console.warn("AI object bbox failed:", err);
		}
	}

	function renderDetectionPage() {
		const start = detPage * DET_PER_PAGE;
		const pageItems = allDetections.slice(start, start + DET_PER_PAGE);
		const total = allDetections.length;
		const hasMore = start + DET_PER_PAGE < total;

		detList.innerHTML = "";

		pageItems.forEach((det, i) => {
			const num = start + i + 1;
			const isAiObjectImage = det.type === "ai-object-image";
			const thumbSource = isAiObjectImage ? det.thumb_url : det._thumb?.thumb_1024_url;
			const thumbUrl = thumbSource
				? thumbSource.startsWith("/")
					? `http://localhost:3000${thumbSource}`
					: thumbSource
				: "";
			const imgW = (isAiObjectImage ? det.image?.width : det._thumb?.width) || 1;
			const imgH = (isAiObjectImage ? det.image?.height : det._thumb?.height) || 1;

			const card = document.createElement("div");
			card.className = "detection-card";
			if (isAiObjectImage && det.image?.provider_image_id) {
				card.dataset.imageId = det.image.provider_image_id;
			}
			if (isAiObjectImage && det.instance_id != null) {
				card.dataset.instanceId = String(det.instance_id);
			}

			// Decode bounding box from base64 MVT geometry
			let bboxHtml = "";
			if (!isAiObjectImage && det.geometry) {
				const bbox = decodeBboxSimple(det.geometry, imgW, imgH);
				if (bbox) {
					bboxHtml = `<div class="detection-bbox" style="left:${bbox.x}%;top:${bbox.y}%;width:${bbox.w}%;height:${bbox.h}%"></div>`;
				}
			}
			const instanceHtml =
				isAiObjectImage && det.instance_id != null
					? `<span class="det-instance">instance #${det.instance_id}</span>`
					: "";

			card.innerHTML = `
          <div class="detection-card-header">
            <span class="det-num">${num}</span>
            ${instanceHtml}
          </div>
          <div class="detection-card-img">
            ${thumbUrl ? `<img src="${thumbUrl}" alt="Detection ${num}" loading="lazy">` : '<div style="padding:40px;text-align:center;color:#9ca3af;">No image</div>'}
            ${bboxHtml}
          </div>
        `;

			card.addEventListener("click", async () => {
				const imageId = isAiObjectImage ? det.image?.provider_image_id : det.image?.id;
				if (!imageId) return;
				if (isAiObjectImage) {
					await openObjectImageModal(imageId, card, det.instance_id);
					return;
				}
				navigateViewer(String(imageId));
			});

			detList.appendChild(card);
			if (isAiObjectImage) {
				attachAiObjectBbox(
					card,
					det.image?.provider_image_id,
					det.instance_id,
					det.image?.width,
					det.image?.height,
				);
			}
		});

		detPageInfo.textContent = `${Math.min(start + DET_PER_PAGE, total)} of ${total}`;
		detNextBtn.style.display = hasMore ? "" : "none";
		detNextBtn.textContent = `Next ${Math.min(DET_PER_PAGE, total - start - DET_PER_PAGE)}`;

		detList.scrollTop = 0;
	}

	// Decode base64 MVT geometry to a simple bounding box (percentage)
	function decodeBboxSimple(base64Geom, imgW, imgH) {
		try {
			const binary = Uint8Array.from(atob(base64Geom), (c) => c.charCodeAt(0));
			// Parse simple MVT to extract coordinates
			// MVT uses protobuf — we'll do a lightweight parse for the geometry
			const coords = extractMVTCoords(binary);
			if (!coords || coords.length < 3) return null;

			// Find bounding box of the polygon
			let minX = Infinity,
				minY = Infinity,
				maxX = -Infinity,
				maxY = -Infinity;
			const extent = 4096; // standard MVT extent
			coords.forEach(([x, y]) => {
				const nx = x / extent;
				const ny = y / extent;
				if (nx < minX) minX = nx;
				if (ny < minY) minY = ny;
				if (nx > maxX) maxX = nx;
				if (ny > maxY) maxY = ny;
			});

			return {
				x: (minX * 100).toFixed(1),
				y: (minY * 100).toFixed(1),
				w: ((maxX - minX) * 100).toFixed(1),
				h: ((maxY - minY) * 100).toFixed(1),
			};
		} catch (e) {
			return null;
		}
	}

	// Lightweight MVT protobuf coordinate extractor
	function extractMVTCoords(data) {
		try {
			// MVT structure: tile → layers → features → geometry
			// We'll scan for geometry field (tag 4 in feature) using zigzag decoding
			// This is a simplified parser that works for Mapillary detection geometries

			let pos = 0;
			function readVarint() {
				let result = 0,
					shift = 0;
				while (pos < data.length) {
					const b = data[pos++];
					result |= (b & 0x7f) << shift;
					if ((b & 0x80) === 0) return result;
					shift += 7;
				}
				return result;
			}

			function skipField(wireType) {
				if (wireType === 0) readVarint();
				else if (wireType === 1) pos += 8;
				else if (wireType === 2) pos += readVarint();
				else if (wireType === 5) pos += 4;
			}

			// Find the geometry commands in the MVT
			// Scan through the protobuf to find repeated uint32 (field 4, type 2 packed)
			const coords = [];
			const cx = 0,
				cy = 0;

			// Simple approach: find all varint sequences that look like geometry commands
			function parseGeometry(geomData) {
				let gp = 0;
				const pts = [];
				let px = 0,
					py = 0;

				function gReadVarint() {
					let r = 0,
						s = 0;
					while (gp < geomData.length) {
						const b = geomData[gp++];
						r |= (b & 0x7f) << s;
						if ((b & 0x80) === 0) return r;
						s += 7;
					}
					return r;
				}

				while (gp < geomData.length) {
					const cmdInt = gReadVarint();
					const cmd = cmdInt & 0x7;
					const count = cmdInt >> 3;

					if (cmd === 1 || cmd === 2) {
						for (let i = 0; i < count; i++) {
							const dx = gReadVarint();
							const dy = gReadVarint();
							px += (dx >> 1) ^ -(dx & 1);
							py += (dy >> 1) ^ -(dy & 1);
							pts.push([px, py]);
						}
					} else if (cmd === 7) {
						// ClosePath
					}
				}
				return pts;
			}

			// Parse top-level: find layer → feature → geometry
			while (pos < data.length) {
				const tag = readVarint();
				const fieldNum = tag >> 3;
				const wireType = tag & 0x7;

				if (wireType === 2) {
					const len = readVarint();
					const end = pos + len;

					if (fieldNum === 3) {
						// layers
						const layerEnd = end;
						while (pos < layerEnd) {
							const ltag = readVarint();
							const lfn = ltag >> 3;
							const lwt = ltag & 0x7;
							if (lwt === 2) {
								const llen = readVarint();
								const lend = pos + llen;
								if (lfn === 2) {
									// feature
									const featEnd = lend;
									while (pos < featEnd) {
										const ftag = readVarint();
										const ffn = ftag >> 3;
										const fwt = ftag & 0x7;
										if (fwt === 2 && ffn === 4) {
											// geometry (packed uint32)
											const glen = readVarint();
											const geomBytes = data.slice(pos, pos + glen);
											pos += glen;
											return parseGeometry(geomBytes);
										} else {
											skipField(fwt);
										}
									}
								} else {
									pos = lend;
								}
							} else {
								skipField(lwt);
							}
						}
					} else {
						pos = end;
					}
				} else {
					skipField(wireType);
				}
			}
			return null;
		} catch (e) {
			return null;
		}
	}
}
