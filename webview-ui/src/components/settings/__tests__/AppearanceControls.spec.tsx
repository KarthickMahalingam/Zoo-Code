import { CODE_FONT_PRESETS, INTERFACE_FONT_PRESETS, presetIdFor } from "../AppearanceControls"
import { sanitizeFontFamily } from "@/utils/appearance"

describe("font presets", () => {
	it.each([...INTERFACE_FONT_PRESETS, ...CODE_FONT_PRESETS])("$label stack passes sanitization", (preset) => {
		// A preset that the sanitizer rejects would silently fall back to inherit.
		expect(sanitizeFontFamily(preset.stack)).toBe(preset.stack)
	})

	it("has unique ids", () => {
		const ids = [...INTERFACE_FONT_PRESETS, ...CODE_FONT_PRESETS].map((p) => p.id)
		expect(new Set(ids).size).toBe(ids.length)
	})
})

describe("presetIdFor", () => {
	it("maps empty to the default option", () => {
		expect(presetIdFor(undefined, INTERFACE_FONT_PRESETS)).toBe("__default__")
		expect(presetIdFor("", INTERFACE_FONT_PRESETS)).toBe("__default__")
	})

	it("maps a known stack back to its preset", () => {
		expect(presetIdFor(CODE_FONT_PRESETS[2].stack, CODE_FONT_PRESETS)).toBe(CODE_FONT_PRESETS[2].id)
	})

	it("treats anything else as custom", () => {
		expect(presetIdFor("Comic Sans MS", INTERFACE_FONT_PRESETS)).toBe("__custom__")
	})
})
