import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LanguageSettings } from "../LanguageSettings"

// The shared translation mock drops interpolation values; interpolate like i18next does
// so the preview text (the thing under test) is observable.
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, string>) =>
			options ? Object.entries(options).reduce((acc, [k, v]) => `${acc} ${k}=${v}`, key) : key,
	}),
}))

describe("LanguageSettings – time format", () => {
	it("defaults to auto and shows a live example", () => {
		render(<LanguageSettings language="en" setCachedStateField={vi.fn()} />)
		expect(screen.getByTestId("time-format-select")).toBeTruthy()
		expect(screen.getByTestId("time-format-preview").textContent).toMatch(/\d{1,2}:41/)
	})

	it("previews 24-hour time without an AM/PM marker", () => {
		render(<LanguageSettings language="en" timeFormat="24h" setCachedStateField={vi.fn()} />)
		const text = screen.getByTestId("time-format-preview").textContent!
		expect(text).toContain("14:41")
		// Look only at the formatted example (after "example="), not the translation key text.
		expect(text.split("example=")[1]).not.toMatch(/\b(AM|PM)\b/i)
	})

	it("previews 12-hour time with an AM/PM marker", () => {
		render(<LanguageSettings language="en" timeFormat="12h" setCachedStateField={vi.fn()} />)
		expect(screen.getByTestId("time-format-preview").textContent).toMatch(/2:41\s?PM/i)
	})

	it("keeps the language selector", () => {
		const { container } = render(<LanguageSettings language="en" setCachedStateField={vi.fn()} />)
		expect(container.querySelectorAll("[role=combobox]").length).toBeGreaterThanOrEqual(2)
		fireEvent.click(screen.getByTestId("time-format-select"))
	})
})
