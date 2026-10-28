import { APPEARANCE_SETTINGS, applyAppearanceVariables, clampAppearance } from "../appearance"

describe("clampAppearance", () => {
	it("passes through in-range integers", () => {
		expect(clampAppearance("interfaceFontScale", 110)).toBe(110)
		expect(clampAppearance("terminalFontSize", 14)).toBe(14)
	})

	it("clamps to the setting's range", () => {
		expect(clampAppearance("interfaceFontScale", 10)).toBe(APPEARANCE_SETTINGS.interfaceFontScale.min)
		expect(clampAppearance("editorFontSize", 999)).toBe(APPEARANCE_SETTINGS.editorFontSize.max)
	})

	it("rounds fractional input", () => {
		expect(clampAppearance("spacingScale", 87.6)).toBe(88)
	})

	it("treats null/undefined/NaN as unset", () => {
		expect(clampAppearance("spacingScale", undefined)).toBeUndefined()
		expect(clampAppearance("spacingScale", null)).toBeUndefined()
		expect(clampAppearance("spacingScale", NaN)).toBeUndefined()
	})
})

describe("applyAppearanceVariables", () => {
	let root: HTMLElement

	beforeEach(() => {
		root = document.createElement("div")
	})

	it("writes percent settings as unitless multipliers and px settings as px", () => {
		applyAppearanceVariables(root, {
			interfaceFontScale: 120,
			terminalFontSize: 14,
			editorFontSize: 13,
			spacingScale: 80,
		})
		expect(root.style.getPropertyValue("--zoo-ui-scale")).toBe("1.2")
		expect(root.style.getPropertyValue("--zoo-terminal-font-size")).toBe("14px")
		expect(root.style.getPropertyValue("--zoo-editor-font-size")).toBe("13px")
		expect(root.style.getPropertyValue("--zoo-spacing-scale")).toBe("0.8")
	})

	it("removes overrides for unset values so stylesheet defaults apply", () => {
		applyAppearanceVariables(root, { interfaceFontScale: 120, terminalFontSize: 14 })
		applyAppearanceVariables(root, { interfaceFontScale: undefined, terminalFontSize: null })
		expect(root.style.getPropertyValue("--zoo-ui-scale")).toBe("")
		expect(root.style.getPropertyValue("--zoo-terminal-font-size")).toBe("")
	})

	it("marks the root only while an editor font size is set", () => {
		applyAppearanceVariables(root, { editorFontSize: 15 })
		expect(root.classList.contains("zoo-editor-font-set")).toBe(true)
		applyAppearanceVariables(root, { editorFontSize: undefined })
		expect(root.classList.contains("zoo-editor-font-set")).toBe(false)
	})

	it("clamps out-of-range values before writing", () => {
		applyAppearanceVariables(root, { spacingScale: 1000 })
		expect(root.style.getPropertyValue("--zoo-spacing-scale")).toBe("2")
	})
})
