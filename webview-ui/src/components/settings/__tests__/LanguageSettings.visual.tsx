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
