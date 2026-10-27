import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AppearancePreview } from "../AppearancePreview"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const root = () => screen.getByTestId("appearance-preview")

describe("AppearancePreview", () => {
	it("sets nothing for an unset value, so the live CSS fallback chain applies (terminal follows VS Code's editor size)", () => {
		render(<AppearancePreview values={{}} />)
		const style = root().style
		expect(style.getPropertyValue("--zoo-terminal-font-size")).toBe("")
		expect(style.getPropertyValue("--zoo-editor-font-size")).toBe("")
		expect(style.getPropertyValue("--zoo-ui-scale")).toBe("")
		expect(style.getPropertyValue("--zoo-spacing-scale")).toBe("")
	})

	it("sets only the values the user has set, converted the way the live UI converts them", () => {
		render(
			<AppearancePreview values={{ terminalFontSize: 18, interfaceFontScale: 120, spacingScale: undefined }} />,
		)
		const style = root().style
		expect(style.getPropertyValue("--zoo-terminal-font-size")).toBe("18px")
		expect(style.getPropertyValue("--zoo-ui-scale")).toBe("1.2")
		expect(style.getPropertyValue("--zoo-spacing-scale")).toBe("")
		expect(style.getPropertyValue("--zoo-editor-font-size")).toBe("")
	})

	it("clamps out-of-range values like the live UI", () => {
		render(<AppearancePreview values={{ spacingScale: 1000 }} />)
		expect(root().style.getPropertyValue("--zoo-spacing-scale")).toBe("2")
	})

	it("applies the chat font size only when one is set", () => {
		const { rerender } = render(<AppearancePreview values={{}} />)
		expect(root().style.getPropertyValue("--zoo-chat-font-size")).toBe("")
		rerender(<AppearancePreview values={{}} chatFontSize={16} />)
		expect(root().style.getPropertyValue("--zoo-chat-font-size")).toBe("16px")
	})
})
