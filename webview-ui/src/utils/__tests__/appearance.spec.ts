import { applyFontVariable, sanitizeFontFamily } from "../appearance"

describe("sanitizeFontFamily", () => {
	it.each([
		["Inter", "Inter"],
		["  Inter, sans-serif  ", "Inter, sans-serif"],
		['"JetBrains Mono", monospace', '"JetBrains Mono", monospace'],
		["'Fira Code', Menlo", "'Fira Code', Menlo"],
		["Noto Sans CJK JP", "Noto Sans CJK JP"],
		["ヒラギノ角ゴ", "ヒラギノ角ゴ"],
	])("accepts %j", (input, expected) => {
		expect(sanitizeFontFamily(input)).toBe(expected)
	})

	it.each([
		["", "empty"],
		["   ", "whitespace"],
		["Inter; color: red", "semicolon"],
		["Inter}body{display:none", "braces"],
		["url(http://evil)", "url()"],
		["Inter</style>", "angle brackets"],
		["a".repeat(257), "too long"],
	])("rejects %j (%s)", (input) => {
		expect(sanitizeFontFamily(input)).toBeUndefined()
	})

	it("handles null/undefined", () => {
		expect(sanitizeFontFamily(null)).toBeUndefined()
		expect(sanitizeFontFamily(undefined)).toBeUndefined()
	})
})

describe("applyFontVariable", () => {
	let root: HTMLElement

	beforeEach(() => {
		root = document.createElement("div")
	})

	it("sets the variable for a valid font", () => {
		applyFontVariable("--zoo-chat-font-family", "Inter, sans-serif", root)
		expect(root.style.getPropertyValue("--zoo-chat-font-family")).toBe("Inter, sans-serif")
	})

	it("removes the variable when cleared", () => {
		applyFontVariable("--zoo-chat-font-family", "Inter", root)
		applyFontVariable("--zoo-chat-font-family", undefined, root)
		expect(root.style.getPropertyValue("--zoo-chat-font-family")).toBe("")
	})

	it("removes the variable for an invalid value instead of applying it", () => {
		applyFontVariable("--zoo-chat-font-family", "Inter", root)
		applyFontVariable("--zoo-chat-font-family", "Inter; x: y", root)
		expect(root.style.getPropertyValue("--zoo-chat-font-family")).toBe("")
	})
})
