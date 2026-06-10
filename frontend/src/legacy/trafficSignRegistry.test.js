import test from "node:test";
import assert from "node:assert/strict";
import {
	createTrafficSignRegistry,
	resolveSignLabel,
} from "./trafficSignRegistry.js";

test("maps Vietnamese sign codes from ma_icon.txt to English labels", () => {
	assert.equal(resolveSignLabel("R.302a"), "Right Turn Only");
	assert.equal(resolveSignLabel("P.127*50"), "Speed limit (50km/h)");
	assert.equal(resolveSignLabel("Camera"), "Road with Surveillance Camera");
	assert.equal(resolveSignLabel("Right Turn Only"), "Right Turn Only");
});

test("resolves known labels to existing show-traffic-sign values", () => {
	const registry = createTrafficSignRegistry([
		{ value: "regulatory--turn-right--g1", label: "Right Turn Only", cat: "regulatory" },
	]);
	assert.equal(registry.resolveSignValue("R.302a"), "regulatory--turn-right--g1");
});

test("creates dynamic sign value and generated icon for unknown labels", () => {
	const registry = createTrafficSignRegistry([]);
	const value = registry.resolveSignValue("Brand New Sign Type");
	assert.equal(value, "ai-sign--brand-new-sign-type");
	assert.equal(registry.signTypesMap[value].label, "Brand New Sign Type");
	assert.match(registry.signIconOverrides[value], /^data:image\/svg\+xml/);
});
