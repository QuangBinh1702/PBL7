import { Viewer as MlyViewer } from "mapillary-js";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "mapillary-js/dist/mapillary.css";

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
	const VIDEO_UPLOAD_API = `${LOCAL_API}/uploads/video`;
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
				// Fetch thumb URL via local backend API
				fetch(`${LOCAL_API}/images/provider/${imageId}`)
					.then((r) => r.json())
					.then((json) => {
						if (json.data?.thumb_256_url && hoveredImageId === imageId) {
							hoverImg.src = `http://localhost:3000${json.data.thumb_256_url}`;
							hoverPreview.style.display = "block";
						}
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

			// Build sequence lines from sorted images (connect nearby consecutive points)
			function buildSequenceLines(images) {
				const lines = [];
				// Group images by sequence_id
				const groups = {};
				for (const img of images) {
					if (!img.sequence_id) continue; // skip images without sequence
					if (!groups[img.sequence_id]) groups[img.sequence_id] = [];
					groups[img.sequence_id].push(img);
				}
				// For each sequence, sort by captured_at and build a LineString
				for (const seqId of Object.keys(groups)) {
					const seqImages = groups[seqId];
					if (seqImages.length < 2) continue;
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

			async function loadLocalImages() {
				const empty = { type: "FeatureCollection", features: [] };
				if (map.getZoom() < 10) {
					map.getSource("local-images").setData(empty);
					map.getSource("local-lines").setData(empty);
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
					const images = json.data;

					// Points
					map.getSource("local-images").setData({
						type: "FeatureCollection",
						features: images.map((img) => ({
							type: "Feature",
							geometry: { type: "Point", coordinates: [img.lon, img.lat] },
							properties: {
								id: img.provider_image_id,
								captured_at: img.captured_at,
								compass_angle: img.compass_angle,
								is_pano: img.is_pano,
							},
						})),
					});

					// Lines
					map.getSource("local-lines").setData(buildSequenceLines(images));

					if (LOCAL_ONLY_MODE && !currentImageId && images.length > 0) {
						navigateViewer(String(images[0].provider_image_id));
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
	async function navigateViewer(imageId) {
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
			for (let i = idx + 1; i < seq.length; i++) {
				const result = await navigateViewer(String(seq[i].provider_image_id));
				if (result?.hasThumb) return;
			}
			stopAutoPlay();
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
			scene_text: "SCENE",
			road_text: "ROAD",
			vehicle_text: "VEHICLE",
			sign_text: "SIGN",
			safety_text: "SAFETY",
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
						item.thumb_1024_url ||
						item.thumb_256_url ||
						item.url ||
						item.src ||
						"",
					providerImageId:
						item.provider_image_id || item.image_id || item.providerImageId || null,
					capturedAt: item.captured_at || item.timestamp || "",
				};
			})
			.filter(Boolean);
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
		const form = new FormData();
		form.append("video", selectedUploadFile);

		setUploadState(
			"uploading",
			`Đang gửi ${selectedUploadFile.name} lên pipeline AI. Kết quả frame sẽ xuất hiện ngay khi API phản hồi.`,
		);
		if (submitBtn) submitBtn.disabled = true;
		if (browseBtn) browseBtn.disabled = true;

		try {
			const res = await fetch(VIDEO_UPLOAD_API, {
				method: "POST",
				body: form,
			});
			const payload = await res.json().catch(() => ({}));

			if (!res.ok) {
				throw new Error(payload?.error || `Upload failed with ${res.status}`);
			}

			uploadedFrameResults = normalizeUploadedImages(payload);
			renderUploadResults(uploadedFrameResults);

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
					features: ["mly-feature-points"],
					signs: ["mly-traffic-signs"],
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
		return `${POINT_ICON_BASE}${value}.svg`;
	}
	function getSignIconUrl(value) {
		return `${SIGN_ICON_BASE}${value}.svg`;
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

	async function ensureMapImage(kind, value) {
		const imageId = `${kind}:${value}`;
		if (map.hasImage(imageId)) return;
		if (imageLoadCache.has(imageId)) return imageLoadCache.get(imageId);
		const promise = (async () => {
			try {
				const url =
					kind === "pt" ? getPointIconUrl(value) : getSignIconUrl(value);
				const size = kind === "pt" ? 32 : 36;
				const { data, pixelRatio } = await loadSvgAsMapImage(url, size);
				if (!map.hasImage(imageId)) map.addImage(imageId, data, { pixelRatio });
			} catch (e) {
				// Add fallback
				if (!map.hasImage(imageId)) {
					const color = kind === "pt" ? "#7c3aed" : "#ff8400";
					const fb = createFallbackImage(color, 24);
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
		{ value: "object--traffic-cone", label: "Traffic cone" },
		{
			value: "object--traffic-light--cyclists",
			label: "Traffic light - cyclists",
		},
		{
			value: "object--traffic-light--general-horizontal",
			label: "Traffic light - horizontal",
		},
		{
			value: "object--traffic-light--general-single",
			label: "Traffic light - single",
		},
		{
			value: "object--traffic-light--general-upright",
			label: "Traffic light - upright",
		},
		{ value: "object--traffic-light--other", label: "Traffic light - other" },
		{
			value: "object--traffic-light--pedestrians",
			label: "Traffic light - pedestrians",
		},
		{ value: "object--trash-can", label: "Trash can" },
		{ value: "object--water-valve", label: "Water valve" },
		{
			value: "construction--flat--crosswalk-plain",
			label: "Crosswalk - plain",
		},
		{ value: "construction--flat--driveway", label: "Driveway" },
		{ value: "construction--barrier--temporary", label: "Temporary barrier" },
	];

	const POINT_TYPES_MAP = {};
	POINT_TYPES.forEach((t) => (POINT_TYPES_MAP[t.value] = t));

	// ===== DATA: TRAFFIC SIGN TYPES =====
	const SIGN_TYPES = [
		// Regulatory
		{ value: "regulatory--stop--g1", label: "Stop", cat: "regulatory" },
		{ value: "regulatory--yield--g1", label: "Yield", cat: "regulatory" },
		{ value: "regulatory--no-entry--g1", label: "No entry", cat: "regulatory" },
		{
			value: "regulatory--maximum-speed-limit-30--g1",
			label: "Speed limit 30",
			cat: "regulatory",
		},
		{
			value: "regulatory--maximum-speed-limit-40--g1",
			label: "Speed limit 40",
			cat: "regulatory",
		},
		{
			value: "regulatory--maximum-speed-limit-50--g1",
			label: "Speed limit 50",
			cat: "regulatory",
		},
		{
			value: "regulatory--maximum-speed-limit-60--g1",
			label: "Speed limit 60",
			cat: "regulatory",
		},
		{
			value: "regulatory--maximum-speed-limit-70--g1",
			label: "Speed limit 70",
			cat: "regulatory",
		},
		{
			value: "regulatory--maximum-speed-limit-80--g1",
			label: "Speed limit 80",
			cat: "regulatory",
		},
		{
			value: "regulatory--maximum-speed-limit-100--g1",
			label: "Speed limit 100",
			cat: "regulatory",
		},
		{
			value: "regulatory--maximum-speed-limit-120--g1",
			label: "Speed limit 120",
			cat: "regulatory",
		},
		{
			value: "regulatory--no-overtaking--g1",
			label: "No overtaking",
			cat: "regulatory",
		},
		{
			value: "regulatory--no-parking--g1",
			label: "No parking",
			cat: "regulatory",
		},
		{
			value: "regulatory--no-stopping--g1",
			label: "No stopping",
			cat: "regulatory",
		},
		{
			value: "regulatory--no-u-turn--g1",
			label: "No U-turn",
			cat: "regulatory",
		},
		{
			value: "regulatory--no-left-turn--g1",
			label: "No left turn",
			cat: "regulatory",
		},
		{
			value: "regulatory--no-right-turn--g1",
			label: "No right turn",
			cat: "regulatory",
		},
		{
			value: "regulatory--no-pedestrians--g1",
			label: "No pedestrians",
			cat: "regulatory",
		},
		{
			value: "regulatory--no-bicycles--g1",
			label: "No bicycles",
			cat: "regulatory",
		},
		{
			value: "regulatory--no-motor-vehicles--g1",
			label: "No motor vehicles",
			cat: "regulatory",
		},
		{
			value: "regulatory--no-heavy-goods-vehicles--g1",
			label: "No heavy vehicles",
			cat: "regulatory",
		},
		{
			value: "regulatory--go-straight--g1",
			label: "Go straight",
			cat: "regulatory",
		},
		{
			value: "regulatory--turn-left--g1",
			label: "Turn left",
			cat: "regulatory",
		},
		{
			value: "regulatory--turn-right--g1",
			label: "Turn right",
			cat: "regulatory",
		},
		{
			value: "regulatory--go-straight-or-turn-left--g1",
			label: "Straight or left",
			cat: "regulatory",
		},
		{
			value: "regulatory--go-straight-or-turn-right--g1",
			label: "Straight or right",
			cat: "regulatory",
		},
		{
			value: "regulatory--keep-left--g1",
			label: "Keep left",
			cat: "regulatory",
		},
		{
			value: "regulatory--keep-right--g1",
			label: "Keep right",
			cat: "regulatory",
		},
		{
			value: "regulatory--roundabout--g1",
			label: "Roundabout",
			cat: "regulatory",
		},
		{
			value: "regulatory--one-way-left--g1",
			label: "One way left",
			cat: "regulatory",
		},
		{
			value: "regulatory--one-way-right--g1",
			label: "One way right",
			cat: "regulatory",
		},
		{
			value: "regulatory--pedestrians-only--g1",
			label: "Pedestrians only",
			cat: "regulatory",
		},
		{
			value: "regulatory--bicycles-only--g1",
			label: "Bicycles only",
			cat: "regulatory",
		},
		{
			value: "regulatory--priority-over-oncoming-vehicles--g1",
			label: "Priority over oncoming",
			cat: "regulatory",
		},
		{
			value: "regulatory--give-way-to-oncoming-traffic--g1",
			label: "Give way to oncoming",
			cat: "regulatory",
		},
		{
			value: "regulatory--priority-road--g1",
			label: "Priority road",
			cat: "regulatory",
		},
		{
			value: "regulatory--end-of-priority-road--g1",
			label: "End of priority road",
			cat: "regulatory",
		},
		{
			value: "regulatory--end-of-no-overtaking--g1",
			label: "End of no overtaking",
			cat: "regulatory",
		},
		{
			value: "regulatory--road-closed-to-vehicles--g1",
			label: "Road closed",
			cat: "regulatory",
		},
		{
			value: "regulatory--weight-limit--g1",
			label: "Weight limit",
			cat: "regulatory",
		},
		{
			value: "regulatory--height-limit--g1",
			label: "Height limit",
			cat: "regulatory",
		},
		{
			value: "regulatory--width-limit--g1",
			label: "Width limit",
			cat: "regulatory",
		},
		// Warning
		{ value: "warning--curve-left--g1", label: "Curve left", cat: "warning" },
		{ value: "warning--curve-right--g1", label: "Curve right", cat: "warning" },
		{
			value: "warning--double-curve-first-left--g1",
			label: "Double curve left",
			cat: "warning",
		},
		{
			value: "warning--double-curve-first-right--g1",
			label: "Double curve right",
			cat: "warning",
		},
		{
			value: "warning--steep-ascent--g1",
			label: "Steep ascent",
			cat: "warning",
		},
		{
			value: "warning--steep-descent--g1",
			label: "Steep descent",
			cat: "warning",
		},
		{
			value: "warning--slippery-road-surface--g1",
			label: "Slippery road",
			cat: "warning",
		},
		{
			value: "warning--road-narrows--g1",
			label: "Road narrows",
			cat: "warning",
		},
		{ value: "warning--roadworks--g1", label: "Road works", cat: "warning" },
		{
			value: "warning--traffic-signals--g1",
			label: "Traffic signals",
			cat: "warning",
		},
		{
			value: "warning--pedestrians-crossing--g1",
			label: "Pedestrian crossing",
			cat: "warning",
		},
		{ value: "warning--children--g1", label: "Children", cat: "warning" },
		{
			value: "warning--bicycles-crossing--g1",
			label: "Bicycles crossing",
			cat: "warning",
		},
		{
			value: "warning--wild-animals--g1",
			label: "Wild animals",
			cat: "warning",
		},
		{
			value: "warning--domestic-animals--g1",
			label: "Domestic animals",
			cat: "warning",
		},
		{ value: "warning--crossroads--g1", label: "Crossroads", cat: "warning" },
		{
			value: "warning--roundabout--g1",
			label: "Roundabout ahead",
			cat: "warning",
		},
		{
			value: "warning--two-way-traffic--g1",
			label: "Two-way traffic",
			cat: "warning",
		},
		{
			value: "warning--railroad-crossing--g1",
			label: "Railroad crossing",
			cat: "warning",
		},
		{
			value: "warning--railroad-crossing-with-barriers--g1",
			label: "Railroad w/ barriers",
			cat: "warning",
		},
		{
			value: "warning--railroad-crossing-without-barriers--g1",
			label: "Railroad w/o barriers",
			cat: "warning",
		},
		{
			value: "warning--falling-rocks-or-debris-right--g1",
			label: "Falling rocks",
			cat: "warning",
		},
		{
			value: "warning--other-danger--g1",
			label: "Other danger",
			cat: "warning",
		},
		{ value: "warning--road-bump--g1", label: "Road bump", cat: "warning" },
		{ value: "warning--uneven-road--g1", label: "Uneven road", cat: "warning" },
		{ value: "warning--stop-ahead--g1", label: "Stop ahead", cat: "warning" },
		{ value: "warning--yield-ahead--g1", label: "Yield ahead", cat: "warning" },
		{ value: "warning--t-roads--g1", label: "T-junction", cat: "warning" },
		{
			value: "warning--divided-highway--g1",
			label: "Divided highway",
			cat: "warning",
		},
		{
			value: "warning--narrow-bridge--g1",
			label: "Narrow bridge",
			cat: "warning",
		},
		{
			value: "warning--loose-road-surface--g1",
			label: "Loose road surface",
			cat: "warning",
		},
		// Information
		{ value: "information--parking--g1", label: "Parking", cat: "information" },
		{
			value: "information--hospital--g1",
			label: "Hospital",
			cat: "information",
		},
		{
			value: "information--gas-station--g1",
			label: "Gas station",
			cat: "information",
		},
		{ value: "information--food--g1", label: "Food", cat: "information" },
		{ value: "information--lodging--g1", label: "Lodging", cat: "information" },
		{ value: "information--airport--g1", label: "Airport", cat: "information" },
		{
			value: "information--bus-stop--g1",
			label: "Bus stop",
			cat: "information",
		},
		{
			value: "information--pedestrians-crossing--g1",
			label: "Pedestrian crossing",
			cat: "information",
		},
		{
			value: "information--dead-end--g1",
			label: "Dead end",
			cat: "information",
		},
		{
			value: "information--motorway--g1",
			label: "Motorway",
			cat: "information",
		},
		{
			value: "information--end-of-motorway--g1",
			label: "End of motorway",
			cat: "information",
		},
		{
			value: "information--living-street--g1",
			label: "Living street",
			cat: "information",
		},
		{
			value: "information--highway-exit--g1",
			label: "Highway exit",
			cat: "information",
		},
		{
			value: "information--telephone--g1",
			label: "Telephone",
			cat: "information",
		},
		{ value: "information--camping--g1", label: "Camping", cat: "information" },
		{
			value: "information--disabled-persons--g1",
			label: "Disabled persons",
			cat: "information",
		},
		// Complementary
		{
			value: "complementary--chevron-left--g1",
			label: "Chevron left",
			cat: "complementary",
		},
		{
			value: "complementary--chevron-right--g1",
			label: "Chevron right",
			cat: "complementary",
		},
		{
			value: "complementary--distance--g1",
			label: "Distance",
			cat: "complementary",
		},
		{
			value: "complementary--both-directions--g1",
			label: "Both directions",
			cat: "complementary",
		},
		{
			value: "complementary--obstacle-delineator--g1",
			label: "Obstacle delineator",
			cat: "complementary",
		},
		{
			value: "complementary--one-direction-left--g1",
			label: "One direction left",
			cat: "complementary",
		},
		{
			value: "complementary--one-direction-right--g1",
			label: "One direction right",
			cat: "complementary",
		},
		{
			value: "complementary--tow-away-zone--g1",
			label: "Tow-away zone",
			cat: "complementary",
		},
		{
			value: "complementary--trucks--g1",
			label: "Trucks",
			cat: "complementary",
		},
		{
			value: "complementary--maximum-speed-limit-30--g1",
			label: "Speed 30 (sub)",
			cat: "complementary",
		},
	];
	const SIGN_TYPES_MAP = {};
	SIGN_TYPES.forEach((t) => (SIGN_TYPES_MAP[t.value] = t));

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

		// Build dropdown items — "All" option first
		const allItems = [
			{ value: ALL_OPTION, label: allLabel || "All" },
			...items,
		];
		allItems.forEach((item) => {
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
					// Toggle "All" — clears specific selections
					if (selectedSet.has(ALL_OPTION)) {
						selectedSet.clear();
					} else {
						selectedSet.clear();
						selectedSet.add(ALL_OPTION);
					}
				} else {
					// Toggle specific item — remove "All" if present
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
		});

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
				const meta = items.find((i) => i.value === val);
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

		renderFilterState();
	}

	const ALL_OPTION = "__ALL__";

	function applyPointFilter(selected) {
		if (!map || !map.getLayer("mly-feature-points")) return;
		if (selected.has(ALL_OPTION)) {
			map.setFilter("mly-feature-points", null); // show all
		} else if (selected.size === 0) {
			map.setFilter("mly-feature-points", ["==", ["get", "value"], "__none__"]); // hide all
		} else {
			map.setFilter("mly-feature-points", [
				"match",
				["get", "value"],
				[...selected],
				true,
				false,
			]);
		}
	}

	function applySignFilter(selected) {
		if (!map || !map.getLayer("mly-traffic-signs")) return;
		if (selected.has(ALL_OPTION)) {
			map.setFilter("mly-traffic-signs", null); // show all
		} else if (selected.size === 0) {
			map.setFilter("mly-traffic-signs", ["==", ["get", "value"], "__none__"]); // hide all
		} else {
			map.setFilter("mly-traffic-signs", [
				"match",
				["get", "value"],
				[...selected],
				true,
				false,
			]);
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

		initFilterPanel({
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
	detNextBtn.addEventListener("click", () => {
		detPage++;
		renderDetectionPage();
	});

	function closeDetectionPanel() {
		detPanel.classList.remove("open");
		allDetections = [];
		detPage = 0;
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

			renderDetectionPage();
		} catch (err) {
			console.warn("Detection fetch failed:", err);
			detList.innerHTML =
				'<div style="padding:32px;text-align:center;color:#e05643;">Failed to load detections.</div>';
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
			const thumbUrl = det._thumb?.thumb_1024_url
				? det._thumb.thumb_1024_url.startsWith("/")
					? `http://localhost:3000${det._thumb.thumb_1024_url}`
					: det._thumb.thumb_1024_url
				: "";
			const imgW = det._thumb?.width || 1;
			const imgH = det._thumb?.height || 1;

			const card = document.createElement("div");
			card.className = "detection-card";

			// Decode bounding box from base64 MVT geometry
			let bboxHtml = "";
			if (det.geometry) {
				const bbox = decodeBboxSimple(det.geometry, imgW, imgH);
				if (bbox) {
					bboxHtml = `<div class="detection-bbox" style="left:${bbox.x}%;top:${bbox.y}%;width:${bbox.w}%;height:${bbox.h}%"></div>`;
				}
			}

			card.innerHTML = `
          <div class="detection-card-header">
            <span class="det-num">${num}</span>
          </div>
          <div class="detection-card-img">
            ${thumbUrl ? `<img src="${thumbUrl}" alt="Detection ${num}" loading="lazy">` : '<div style="padding:40px;text-align:center;color:#9ca3af;">No image</div>'}
            ${bboxHtml}
          </div>
        `;

			// Click card → navigate viewer to that image
			card.addEventListener("click", () => {
				navigateViewer(String(det.image.id));
			});

			detList.appendChild(card);
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
