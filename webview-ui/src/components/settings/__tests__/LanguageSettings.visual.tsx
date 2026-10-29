import { expect, test } from "../../../../playwright/coverage-fixture"
import { expectBoundedLayout } from "../../../../playwright/layout-contracts"
import { mountedStory } from "../../../../playwright/mounted-story"
import { applyVisualTheme, visualThemes } from "../../../../playwright/themes"

for (const theme of visualThemes) {
	test(`renders the Language tab date and time settings in the VS Code ${theme.name} theme`, async ({
		mount,
		page,
	}) => {
		const component = mountedStory(await mount("language-settings"))
		await applyVisualTheme(page, theme)
		const story = component.getByTestId("language-settings-story")

		await expect(story.getByTestId("time-format-24h")).toBeVisible()
		await expect(story.getByTestId("date-format-select")).toBeVisible()
		await expect(story.getByTestId("time-format-preview")).toBeVisible()

		await expect(story).toHaveScreenshot(`language-settings-${theme.name}.png`)
		await expectBoundedLayout(page, story, { focusedControl: story.getByTestId("time-format-24h") })
	})
}

// Real focus and key events: the unit tests cannot cover these, because the unit test setup stubs `focus()`.
test("the time format is one tab stop and the arrow keys move between the options", async ({ mount, page }) => {
	const component = mountedStory(await mount("language-settings"))
	const story = component.getByTestId("language-settings-story")
	const option = (format: "auto" | "12h" | "24h") => story.getByTestId(`time-format-${format}`)
	// The group selects an option when focus arrives while an arrow key is still held, as with a real keypress.
	// Playwright's default press releases the key immediately, before the focus has moved.
	const arrow = (key: "ArrowLeft" | "ArrowRight") => page.keyboard.press(key, { delay: 100 })

	// The story starts on 24-hour.
	await expect(option("24h")).toHaveAttribute("aria-checked", "true")

	// The group is entered on the selected option.
	await option("24h").focus()
	await expect(option("24h")).toBeFocused()

	// Arrow keys move the focus and the selection together, and wrap at both ends.
	await arrow("ArrowRight")
	await expect(option("auto")).toBeFocused()
	await expect(option("auto")).toHaveAttribute("aria-checked", "true")
	await expect(option("24h")).toHaveAttribute("aria-checked", "false")

	await arrow("ArrowRight")
	await expect(option("12h")).toBeFocused()
	await expect(option("12h")).toHaveAttribute("aria-checked", "true")

	await arrow("ArrowLeft")
	await expect(option("auto")).toBeFocused()
	await arrow("ArrowLeft")
	await expect(option("24h")).toBeFocused()
	await expect(option("24h")).toHaveAttribute("aria-checked", "true")

	// Only the selected option is a tab stop: Tab leaves the group instead of stepping through its options.
	await expect(option("24h")).toHaveAttribute("tabindex", "0")
	await expect(option("auto")).toHaveAttribute("tabindex", "-1")
	await page.keyboard.press("Tab")
	for (const format of ["auto", "12h", "24h"] as const) await expect(option(format)).not.toBeFocused()

	// The preview follows the keyboard selection.
	await option("12h").focus()
	await page.keyboard.press("Space")
	await expect(story.getByTestId("preview-chat")).toContainText(/2:41\s?PM/i)
})
