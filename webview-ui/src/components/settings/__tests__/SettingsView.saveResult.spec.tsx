import { act, fireEvent, screen, waitFor } from "@testing-library/react"
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
		// An id no save was ever issued with (earlier tests may leave their own saves unanswered).
		answerSave("settings-save-never-issued", { success: true })
		expect(posted("upsertApiConfiguration")).toHaveLength(0)
	})
	it("keeps an edit made while the save was pending unsaved, so Save stays available for it", async () => {
		renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))

		// A second edit lands before the host answers; it is not in what was sent.
		fireEvent.click(screen.getByTestId("enter-behavior-checkbox"))
		answerSave(lastSaveRequestId(postMessage), { success: true })

		await waitFor(() => expect(posted("upsertApiConfiguration")).toHaveLength(1))
		await waitFor(() => expect(screen.getByTestId("save-button")).toBeEnabled())
	})

	it("sends the API configuration under the profile name it was submitted with", async () => {
		renderWithExtensionState(<SettingsView onDone={vi.fn()} targetSection="ui" />, {
			state: { currentApiConfigName: "first-profile" },
			queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
		})
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))

		// The user switches profile before the host answers.
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "state", state: { currentApiConfigName: "other-profile" } },
				}),
			)
		})
		answerSave(lastSaveRequestId(postMessage), { success: true })

		await waitFor(() => expect(posted("upsertApiConfiguration")).toHaveLength(1))
		expect(posted("upsertApiConfiguration")[0]).toMatchObject({ text: "first-profile" })
	})
	it("sends the rest of a save even when the view is gone before the host answers", async () => {
		const view = renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))
		const id = lastSaveRequestId(postMessage)

		// The user leaves Settings (and discards) while the host is still storing the settings.
		view.unmount()
		expect(posted("upsertApiConfiguration")).toHaveLength(0)

		answerSave(id, { success: true })
		expect(posted("upsertApiConfiguration")).toHaveLength(1)
		expect(posted("telemetrySetting")).toHaveLength(1)
		expect(posted("debugSetting")).toHaveLength(1)

		// A second answer for the same save does nothing.
		answerSave(id, { success: true })
		expect(posted("upsertApiConfiguration")).toHaveLength(1)
	})

	it("sends nothing more when the host reports a failure after the view is gone", async () => {
		const view = renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))
		const id = lastSaveRequestId(postMessage)
		view.unmount()

		answerSave(id, { success: false, error: "disk full" })
		expect(posted("upsertApiConfiguration")).toHaveLength(0)
	})

	it("never reuses a request id across mounts, and answers each save for itself", async () => {
		const first = renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))
		const earlierId = lastSaveRequestId(postMessage)
		first.unmount()

		renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))
		const laterId = lastSaveRequestId(postMessage)
		expect(laterId).not.toBe(earlierId)

		// The earlier save's answer completes the earlier save only: the new one is still pending.
		answerSave(earlierId, { success: true })
		expect(posted("upsertApiConfiguration")).toHaveLength(1)
		expect(screen.getByTestId("save-button")).toBeDisabled()

		answerSave(laterId, { success: true })
		expect(posted("upsertApiConfiguration")).toHaveLength(2)
	})
})
