import { expect, test } from "../../../../playwright/coverage-fixture"
import { mountedStory } from "../../../../playwright/mounted-story"
import { applyVisualTheme, visualThemes } from "../../../../playwright/themes"

for (const theme of visualThemes) {
	test(`renders the appearance preview in the VS Code ${theme.name} theme`, async ({ mount, page }) => {
		const component = mountedStory(await mount("appearance-preview"))
		await applyVisualTheme(page, theme)
		// Saved values on <html>, as the app writes them. The "reset" preview must not pick these up.
		await page.evaluate(() => {
			const root = document.documentElement
			root.style.setProperty("--zoo-terminal-font-size", "30px")
			root.style.setProperty("--zoo-editor-font-size", "30px")
			root.style.setProperty("--zoo-ui-scale", "2")
			root.style.setProperty("--zoo-spacing-scale", "2")
			root.style.setProperty("--zoo-chat-font-size", "30px")
		})
		const story = component.getByTestId("appearance-preview-story")
		await expect(story.getByTestId("appearance-preview-set")).toBeVisible()
		await expect(story.getByTestId("appearance-preview-reset")).toBeVisible()
		await expect(story).toHaveScreenshot(`appearance-preview-${theme.name}.png`)
	})
}

test("a reset preview ignores saved root values and uses the live fallbacks", async ({ mount, page }) => {
	const component = mountedStory(await mount("appearance-preview"))
	await page.evaluate(() => {
		const root = document.documentElement
		root.style.setProperty("--zoo-terminal-font-size", "30px")
		root.style.setProperty("--zoo-ui-scale", "2")
	})
	const reset = component.getByTestId("appearance-preview-reset").getByTestId("appearance-preview")
	const terminal = reset.locator("pre").nth(1)
	const size = await terminal.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
	// Not the saved 30px: the terminal falls back to VS Code's editor font size.
	expect(size).toBeLessThan(30)
	expect(await reset.evaluate((el) => getComputedStyle(el).getPropertyValue("--zoo-ui-scale").trim())).toBe("")
})
