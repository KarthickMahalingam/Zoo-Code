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

	it("sends the settings with a request id, plus the API configuration, telemetry and debug as before", async () => {
		renderUiTab()
		await makeAnEdit()

		fireEvent.click(screen.getByTestId("save-button"))

		const [save] = posted("updateSettings") as Array<{ type: string; requestId?: string }>
		expect(save.requestId).toMatch(/^settings-save-\d+$/)
		// These do not wait for the host's answer, exactly as before the acknowledgement existed.
		expect(posted("upsertApiConfiguration")).toHaveLength(1)
		expect(posted("telemetrySetting")).toHaveLength(1)
		expect(posted("debugSetting")).toHaveLength(1)
		// Save stays unavailable, and the edit stays unsaved, until the host answers.
		expect(screen.getByTestId("save-button")).toBeDisabled()
	})

	it("clears the unsaved flag once the host confirms, and sends nothing more", async () => {
		renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))

		answerSave(lastSaveRequestId(postMessage), { success: true })

		// Saved: nothing left to save.
		await waitFor(() => expect(screen.getByTestId("save-button")).toBeDisabled())
		expect(posted("upsertApiConfiguration")).toHaveLength(1)
		expect(posted("updateSettings")).toHaveLength(1)
	})

	it("keeps the edits and the unsaved flag when the host reports a failure, so the user can retry", async () => {
		renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))

		answerSave(lastSaveRequestId(postMessage), { success: false, error: "disk full" })

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
		expect(posted("upsertApiConfiguration")).toHaveLength(1)
	})

	it("ignores an answer for a different save, or one that arrives with no id", async () => {
		renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))

		answerSave("settings-save-never-issued", { success: true })
		answerSave(undefined, { success: true })
		expect(screen.getByTestId("save-button")).toBeDisabled()

		// The real answer still works afterwards: the edit is saved and Save is idle.
		answerSave(lastSaveRequestId(postMessage), { success: false })
		await waitFor(() => expect(screen.getByTestId("save-button")).toBeEnabled())
	})

	it("ignores a save result when nothing is being saved", async () => {
		renderUiTab()
		await makeAnEdit()
		answerSave("settings-save-never-issued", { success: true })
		// The unsaved edit is untouched.
		expect(screen.getByTestId("save-button")).toBeEnabled()
	})

	it("keeps an edit made while the save was pending unsaved, so Save stays available for it", async () => {
		renderUiTab()
		await makeAnEdit()
		fireEvent.click(screen.getByTestId("save-button"))

		// A second edit lands before the host answers; it is not in what was sent.
		fireEvent.click(screen.getByTestId("enter-behavior-checkbox"))
		answerSave(lastSaveRequestId(postMessage), { success: true })

		await waitFor(() => expect(screen.getByTestId("save-button")).toBeEnabled())
	})

	it("does nothing, and does not fail, when the answer arrives after the view is gone", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			const view = renderUiTab()
			await makeAnEdit()
			fireEvent.click(screen.getByTestId("save-button"))
			const id = lastSaveRequestId(postMessage)
			view.unmount()

			answerSave(id, { success: true })
			expect(posted("upsertApiConfiguration")).toHaveLength(1)
			expect(consoleError).not.toHaveBeenCalled()
		} finally {
			consoleError.mockRestore()
		}
	})

	it("never reuses a request id across mounts, so an earlier save's answer cannot complete a later one", async () => {
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

		// The earlier save's answer arrives while the new save is pending: it must not complete it.
		answerSave(earlierId, { success: true })
		expect(screen.getByTestId("save-button")).toBeDisabled()

		answerSave(laterId, { success: false })
		await waitFor(() => expect(screen.getByTestId("save-button")).toBeEnabled())
	})
})
