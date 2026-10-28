import { fireEvent, screen, waitFor } from "@testing-library/react"
import { QueryClient } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithExtensionState } from "@/utils/test-utils"
import { vscode } from "@src/utils/vscode"

import SettingsView from "../SettingsView"
import { answerSave, lastSaveRequestId } from "./saveAcknowledgement"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("@/utils/TelemetryClient", () => ({ telemetryClient: { capture: vi.fn() } }))

const postMessage = vi.mocked(vscode.postMessage)

const posted = (type: string) =>
	postMessage.mock.calls.map((call) => call[0] as { type: string }).filter((message) => message.type === type)

const renderUiTab = () =>
	renderWithExtensionState(<SettingsView onDone={vi.fn()} targetSection="ui" />, {
		queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	})

/** Edit a setting so Save becomes available. */
const makeAnEdit = async () => {
	const checkbox = await screen.findByTestId("collapse-thinking-checkbox")
	fireEvent.click(checkbox)
	await waitFor(() => expect(screen.getByTestId("save-button")).toBeEnabled())
}

describe("SettingsView – save acknowledgement", () => {
	beforeEach(() => postMessage.mockClear())

	it("sends the settings with a request id and holds back the follow-up messages until the host confirms", async () => {
		renderUiTab()
		await makeAnEdit()

		fireEvent.click(screen.getByTestId("save-button"))

		const [save] = posted("updateSettings") as Array<{ type: string; requestId?: string }>
		expect(save.requestId).toMatch(/^settings-save-\d+$/)
		// Nothing else is sent, and the unsaved flag stays on, until the host answers.
		expect(posted("upsertApiConfiguration")).toHaveLength(0)
		expect(posted("telemetrySetting")).toHaveLength(0)
		expect(posted("debugSetting")).toHaveLength(0)
		expect(screen.getByTestId("save-button")).toBeDisabled()
	})

	it("sends the rest of the save and clears the unsaved flag once the host confirms", async () => {
		renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))

		answerSave(lastSaveRequestId(postMessage), { success: true })

		await waitFor(() => expect(posted("upsertApiConfiguration")).toHaveLength(1))
		expect(posted("telemetrySetting")).toHaveLength(1)
		expect(posted("debugSetting")).toHaveLength(1)
		// Saved: nothing left to save.
		expect(screen.getByTestId("save-button")).toBeDisabled()
	})

	it("keeps the edits and the unsaved flag when the host reports a failure, so the user can retry", async () => {
		renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))

		answerSave(lastSaveRequestId(postMessage), { success: false, error: "disk full" })

		// No follow-up writes after a failed save.
		expect(posted("upsertApiConfiguration")).toHaveLength(0)
		expect(posted("telemetrySetting")).toHaveLength(0)
		// The edit is still there, still unsaved, and Save is available again.
		await waitFor(() => expect(screen.getByTestId("save-button")).toBeEnabled())
		// The checkbox defaults to checked; the user unchecked it, and that edit survives the failed save.
		expect((screen.getByTestId("collapse-thinking-checkbox") as HTMLInputElement).checked).toBe(false)

		// Retrying sends a fresh request with a new id.
		const firstId = lastSaveRequestId(postMessage)
		fireEvent.click(screen.getByTestId("save-button"))
		expect(lastSaveRequestId(postMessage)).not.toBe(firstId)
		expect(posted("updateSettings")).toHaveLength(2)
	})

	it("does not send a second save while one is waiting for the host", async () => {
		renderUiTab()
		await makeAnEdit()

		fireEvent.click(screen.getByTestId("save-button"))
		fireEvent.click(screen.getByTestId("save-button"))
		fireEvent.click(screen.getByTestId("save-button"))

		expect(posted("updateSettings")).toHaveLength(1)
	})

	it("ignores an answer for a different save, or one that arrives with no id", async () => {
		renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))

		answerSave("settings-save-999", { success: true })
		answerSave(undefined, { success: true })

		expect(posted("upsertApiConfiguration")).toHaveLength(0)
		expect(screen.getByTestId("save-button")).toBeDisabled()

		// The real answer still works afterwards.
		answerSave(lastSaveRequestId(postMessage), { success: true })
		await waitFor(() => expect(posted("upsertApiConfiguration")).toHaveLength(1))
	})

	it("ignores a save result when nothing is being saved", async () => {
		renderUiTab()
		await screen.findByTestId("collapse-thinking-checkbox")
		answerSave("settings-save-1", { success: true })
		expect(posted("upsertApiConfiguration")).toHaveLength(0)
	})
})
