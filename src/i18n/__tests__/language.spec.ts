// npx vitest i18n/__tests__/language.spec.ts

import { afterEach, describe, expect, it } from "vitest"

import { changeLanguage, getLanguage, initializeI18n } from "../index"

describe("getLanguage", () => {
	const original = getLanguage()

	afterEach(() => {
		changeLanguage(original ?? "en")
	})

	it("reports the language that was last set", () => {
		changeLanguage("fr")
		expect(getLanguage()).toBe("fr")

		changeLanguage("ja")
		expect(getLanguage()).toBe("ja")
	})

	it("follows initializeI18n", () => {
		initializeI18n("de")
		expect(getLanguage()).toBe("de")
	})
})
