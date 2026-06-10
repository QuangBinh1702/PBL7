const SIGN_ICON_BASE =
	"https://raw.githubusercontent.com/mapillary/mapillary_sprite_source/master/package_signs/";

const ICON_LABELS = [
	"Pedestrian Crossing",
	"Equal-level Intersection",
	"No Entry",
	"Right Turn Only",
	"Intersection",
	"Intersection with a non-priority road",
	"Danger zone on the left",
	"No Left Turn",
	"Bus Stop",
	"Roundabout",
	"No Stopping and No Parking",
	"U-Turn Allowed",
	"Lane Allocation",
	"Slow Down",
	"No Trucks Allowed",
	"Narrow Road on the Right",
	"Height Limit",
	"No U-Turn",
	"No Passenger Cars and Trucks",
	"No U-Turn and No Right Turn",
	"No Cars Allowed",
	"Narrow Road on the Left",
	"Uneven Road",
	"No Two or Three-wheeled Vehicles",
	"Customs Checkpoint",
	"Motorcycles Only",
	"Obstacle on the Road",
	"Children Present",
	"Trucks and Containers",
	"No Motorcycles Allowed",
	"Trucks Only",
	"Road with Surveillance Camera",
	"No Right Turn",
	"Double curve first to right",
	"No Containers Allowed",
	"No Left or Right Turn",
	"No Straight and Right Turn",
	"Intersection with T-Junction",
	"Speed limit (50km/h)",
	"Speed limit (60km/h)",
	"Speed limit (80km/h)",
	"Speed limit (40km/h)",
	"Left Turn",
	"Low Clearance",
	"Other Danger",
	"One-way street",
	"No Parking",
	"No U-Turn for Cars",
	"Level Crossing with Barriers",
	"No U-Turn and No Left Turn",
	"Danger zone on the right",
	"Warning: Obstacle ahead - pass on the right",
];

const MA_ICON_CODES = [
	"W.224",
	"W.205c",
	"P.102",
	"R.302a",
	"W.205a",
	"W.207",
	"W.201a",
	"P.123a",
	"I.434a",
	"R.303",
	"P.130",
	"I.409",
	"R.415a",
	"W.245a",
	"P.106a*Xe tải",
	"W.203c",
	"P.117*",
	"P.124a*",
	"P.107",
	"P.124d",
	"P.103a",
	"W.203b",
	"W.221b",
	"P.111",
	"P.129",
	"S.505a*Xe máy",
	"W.246a",
	"W.225",
	"S.505a*Xe tải và công",
	"P.104",
	"S.505a*Xe tải",
	"Camera",
	"P.123b",
	"W.202b",
	"B.8a",
	"P.137",
	"P.139",
	"W.205b",
	"P.127*50",
	"P.127*60",
	"P.127*80",
	"P.127*40",
	"R.301e",
	"W.239b*",
	"W.233",
	"I.407a",
	"P.131a",
	"P.124b1",
	"W.210",
	"P.124c",
	"W.201b",
	"W.246c",
];

const MA_CODE_TO_LABEL = new Map();
const LABEL_CANONICAL = new Map();

function registerMaMapping(code, label) {
	const trimmed = String(code || "").trim();
	if (!trimmed || !label) return;
	MA_CODE_TO_LABEL.set(trimmed, label);
	MA_CODE_TO_LABEL.set(trimmed.toLowerCase(), label);
	const base = trimmed.split("*")[0].trim();
	if (base) {
		MA_CODE_TO_LABEL.set(base, label);
		MA_CODE_TO_LABEL.set(base.toLowerCase(), label);
	}
}

ICON_LABELS.forEach((label) => {
	LABEL_CANONICAL.set(label.toLowerCase(), label);
});

MA_ICON_CODES.forEach((code, index) => {
	registerMaMapping(code, ICON_LABELS[index] || code);
});

function slugifySignLabel(label) {
	return String(label || "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function abbreviateSignLabel(label) {
	const words = String(label || "")
		.replace(/[()]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
	if (!words.length) return "?";
	const speed = label.match(/(\d+)\s*km\/h/i);
	if (speed) return speed[1];
	if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
	return words
		.slice(0, 3)
		.map((word) => word[0])
		.join("")
		.toUpperCase();
}

function svgDataUri(svg) {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function textSignSvg(text, bg = "#2563eb") {
	const fontSize = text.length > 3 ? 8 : 12;
	return svgDataUri(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" rx="6" fill="${bg}" stroke="#1e3a8a" stroke-width="3"/><text x="20" y="24" text-anchor="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="#fff">${text}</text></svg>`,
	);
}

export function resolveSignLabel(signName) {
	const raw = String(signName || "").trim();
	if (!raw) return "";
	if (LABEL_CANONICAL.has(raw.toLowerCase())) {
		return LABEL_CANONICAL.get(raw.toLowerCase());
	}
	if (MA_CODE_TO_LABEL.has(raw)) return MA_CODE_TO_LABEL.get(raw);
	if (MA_CODE_TO_LABEL.has(raw.toLowerCase())) return MA_CODE_TO_LABEL.get(raw.toLowerCase());
	const base = raw.split("*")[0].trim();
	if (MA_CODE_TO_LABEL.has(base)) return MA_CODE_TO_LABEL.get(base);
	if (MA_CODE_TO_LABEL.has(base.toLowerCase())) return MA_CODE_TO_LABEL.get(base.toLowerCase());
	return raw;
}

function guessSignCategory(label) {
	const lower = label.toLowerCase();
	if (lower.includes("speed limit") || lower.startsWith("no ") || lower.includes("only")) return "regulatory";
	if (lower.includes("danger") || lower.includes("warning") || lower.includes("narrow") || lower.includes("curve")) {
		return "warning";
	}
	if (lower.includes("bus") || lower.includes("camera") || lower.includes("lane")) return "information";
	return "regulatory";
}

function buildMapillaryCandidates(label) {
	const slug = slugifySignLabel(label);
	if (!slug) return [];
	const prefixes = ["regulatory", "warning", "information", "complementary"];
	const suffixes = ["g1", "g2", "g3"];
	const candidates = new Set();
	for (const prefix of prefixes) {
		for (const suffix of suffixes) {
			candidates.add(`${prefix}--${slug}--${suffix}`);
		}
	}
	const compact = slug
		.replace(/-and-/g, "-")
		.replace(/-with-/g, "-")
		.replace(/-the-/g, "-")
		.replace(/-on-/g, "-")
		.replace(/-of-/g, "-");
	if (compact !== slug) {
		for (const prefix of prefixes) {
			candidates.add(`${prefix}--${compact}--g1`);
		}
	}
	if (label.toLowerCase().includes("speed limit")) {
		const speed = label.match(/(\d+)/);
		if (speed) candidates.add(`regulatory--maximum-speed-limit-${speed[1]}--g1`);
	}
	if (label.toLowerCase().includes("right turn only")) candidates.add("regulatory--turn-right--g1");
	if (label.toLowerCase().includes("left turn")) candidates.add("regulatory--turn-left--g1");
	if (label.toLowerCase().includes("no entry")) candidates.add("regulatory--no-entry--g1");
	if (label.toLowerCase().includes("no parking")) candidates.add("regulatory--no-parking--g1");
	if (label.toLowerCase().includes("pedestrian")) candidates.add("warning--pedestrians-crossing--g1");
	return [...candidates];
}

const mapillaryProbeCache = new Map();

export async function probeMapillarySpriteUrl(label) {
	const key = String(label || "").trim().toLowerCase();
	if (!key) return null;
	if (mapillaryProbeCache.has(key)) return mapillaryProbeCache.get(key);

	const candidates = buildMapillaryCandidates(label);
	for (const candidate of candidates) {
		const url = `${SIGN_ICON_BASE}${candidate}.svg`;
		try {
			const res = await fetch(url, { method: "HEAD", cache: "force-cache" });
			if (res.ok) {
				mapillaryProbeCache.set(key, url);
				return url;
			}
		} catch {
			// try next candidate
		}
	}
	mapillaryProbeCache.set(key, null);
	return null;
}

export function buildGeneratedSignIconUrl(label) {
	return textSignSvg(abbreviateSignLabel(label));
}

export function createTrafficSignRegistry(initialSignTypes, initialOverrides = {}) {
	const signTypes = initialSignTypes;
	const signTypesMap = {};
	const signLabelToValue = {};
	const signIconOverrides = initialOverrides;
	const dynamicValues = new Set();

	signTypes.forEach((entry) => {
		signTypesMap[entry.value] = entry;
		signLabelToValue[entry.label.toLowerCase()] = entry.value;
	});

	function registerSignType(entry, iconOverride) {
		if (!entry?.value || signTypesMap[entry.value]) {
			if (iconOverride && entry?.value) signIconOverrides[entry.value] = iconOverride;
			return entry?.value || "";
		}
		signTypes.push(entry);
		signTypesMap[entry.value] = entry;
		signLabelToValue[entry.label.toLowerCase()] = entry.value;
		if (iconOverride) signIconOverrides[entry.value] = iconOverride;
		dynamicValues.add(entry.value);
		return entry.value;
	}

	function resolveSignValue(signName) {
		const label = resolveSignLabel(signName);
		if (!label) return "";

		const known = signLabelToValue[label.toLowerCase()];
		if (known) return known;

		if (signTypesMap[label]) return label;

		const slug = slugifySignLabel(label);
		const dynamicValue = slug ? `ai-sign--${slug}` : "";
		if (!dynamicValue) return "";

		registerSignType(
			{
				value: dynamicValue,
				label,
				cat: guessSignCategory(label),
			},
			buildGeneratedSignIconUrl(label),
		);
		return dynamicValue;
	}

	function getSignIconUrl(value) {
		if (!value) return "";
		if (signIconOverrides[value]) return signIconOverrides[value];
		return `${SIGN_ICON_BASE}${value}.svg`;
	}

	async function ensureSignIconOverride(value) {
		const entry = signTypesMap[value];
		if (!entry || signIconOverrides[value]) return;
		if (!value.startsWith("ai-sign--")) return;
		const mapillaryUrl = await probeMapillarySpriteUrl(entry.label);
		if (!mapillaryUrl) return;
		try {
			const res = await fetch(mapillaryUrl, { cache: "force-cache" });
			if (!res.ok) return;
			const svgText = await res.text();
			signIconOverrides[value] = svgDataUri(svgText);
			const existing = signTypes.find((item) => item.value === value);
			if (existing) {
				const spriteName = mapillaryUrl.split("/").pop()?.replace(/\.svg$/, "");
				if (spriteName && !spriteName.startsWith("ai-sign--")) {
					existing.mapillaryValue = spriteName;
				}
			}
		} catch {
			// keep generated fallback icon
		}
	}

	return {
		signTypes,
		signTypesMap,
		signLabelToValue,
		signIconOverrides,
		dynamicValues,
		resolveSignLabel,
		resolveSignValue,
		registerSignType,
		getSignIconUrl,
		ensureSignIconOverride,
		buildGeneratedSignIconUrl,
	};
}
