import React from "react"
import { render, screen } from "@/utils/test-utils"
import type { ClineMessage } from "@roo-code/types"

import { ChatRowContent } from "../ChatRow"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

let mockState: Record<string, unknown> = {}
vi.mock("@src/context/ExtensionStateContext", async (importOriginal) => ({
	...(await importOriginal<typeof import("@src/context/ExtensionStateContext")>()),
	useExtensionState: () => ({
		mcpServers: [],
		alwaysAllowMcp: false,
		currentCheckpoint: null,
		mode: "code",
		apiConfiguration: {},
		clineMessages: [],
		currentTaskItem: undefined,
		...mockState,
	}),
}))

vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({ info: { supportsImages: true } }),
}))

const renderRow = (message: ClineMessage, isStreaming = false) =>
	render(
		<ChatRowContent
			message={message}
			isExpanded={false}
			isLast={false}
			isStreaming={isStreaming}
			onToggleExpand={() => {}}
			onSuggestionClick={() => {}}
			onBatchFileResponse={() => {}}
			onFollowUpUnmount={() => {}}
			isFollowUpAnswered={false}
		/>,
	)

describe("ChatRow – message timestamp", () => {
	beforeEach(() => {
		mockState = {}
	})

	it("shows when a user message was sent", () => {
		renderRow({ ts: Date.now(), type: "say", say: "user_feedback", text: "hello there" })
		expect(screen.getByTestId("message-timestamp").textContent).toContain("Today")
	})

	it("uses the message's own timestamp, not the current time", () => {
		const d = new Date()
		d.setDate(d.getDate() - 1)
		d.setHours(11, 43, 0, 0)
		renderRow({ ts: d.getTime(), type: "say", say: "user_feedback", text: "an older message" })
		expect(screen.getByTestId("message-timestamp").textContent).toContain("Yesterday")
	})

	it("is rendered after the message bubble (under it), not before", () => {
		const { container } = renderRow({ ts: Date.now(), type: "say", say: "user_feedback", text: "ordering" })
		const html = container.innerHTML
		expect(html.indexOf("ordering")).toBeGreaterThan(-1)
		expect(html.indexOf("message-timestamp")).toBeGreaterThan(html.indexOf("ordering"))
	})

	it("applies the user's time and date format settings", () => {
		const d = new Date()
		d.setHours(14, 41, 0, 0)
		mockState = { timeFormat: "24h", dateFormat: "ymd" }
		renderRow({ ts: d.getTime(), type: "say", say: "user_feedback", text: "formats" })
		expect(screen.getByTestId("message-timestamp").textContent).toContain("14:41")
	})

	describe("assistant text", () => {
		it("shows when the reply was sent, under the reply", () => {
			const { container } = renderRow({ ts: Date.now(), type: "say", say: "text", text: "assistant reply" })
			expect(screen.getByTestId("message-timestamp").textContent).toContain("Today")
			const html = container.innerHTML
			expect(html.indexOf("message-timestamp")).toBeGreaterThan(html.indexOf("assistant reply"))
		})

		it("uses the reply's own timestamp and the user's formats", () => {
			const d = new Date()
			d.setHours(14, 41, 0, 0)
			mockState = { timeFormat: "24h", dateFormat: "ymd" }
			renderRow({ ts: d.getTime(), type: "say", say: "text", text: "formatted reply" })
			expect(screen.getByTestId("message-timestamp").textContent).toContain("14:41")
		})

		it("waits until the reply has finished streaming", () => {
			const { rerender } = renderRow({
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "still typing",
				partial: true,
			})
			expect(screen.queryByTestId("message-timestamp")).toBeNull()

			rerender(
				<ChatRowContent
					message={{ ts: Date.now(), type: "say", say: "text", text: "still typing", partial: false }}
					isExpanded={false}
					isLast={false}
					isStreaming={false}
					onToggleExpand={() => {}}
					onSuggestionClick={() => {}}
					onBatchFileResponse={() => {}}
					onFollowUpUnmount={() => {}}
					isFollowUpAnswered={false}
				/>,
			)
			expect(screen.getByTestId("message-timestamp")).toBeTruthy()
		})

		it("shows the time of a finished completion result, and waits while it streams", () => {
			const { rerender } = renderRow({
				ts: Date.now(),
				type: "say",
				say: "completion_result",
				text: "all done",
				partial: true,
			})
			expect(screen.queryByTestId("message-timestamp")).toBeNull()

			rerender(
				<ChatRowContent
					message={{
						ts: Date.now(),
						type: "say",
						say: "completion_result",
						text: "all done",
						partial: false,
					}}
					isExpanded={false}
					isLast={false}
					isStreaming={false}
					onToggleExpand={() => {}}
					onSuggestionClick={() => {}}
					onBatchFileResponse={() => {}}
					onFollowUpUnmount={() => {}}
					isFollowUpAnswered={false}
				/>,
			)
			expect(screen.getByTestId("message-timestamp").textContent).toContain("Today")
		})

		it("shows nothing for an assistant message with an invalid timestamp", () => {
			renderRow({ ts: 0, type: "say", say: "text", text: "no time" })
			expect(screen.queryByTestId("message-timestamp")).toBeNull()
		})
	})

	describe("date format on an older message, for every row that shows a time", () => {
		// Years back, so the date (not "Today" or a weekday) is shown, whatever day the tests run.
		const OLD = new Date(2024, 2, 7, 14, 41, 0, 0).getTime()

		const rows: Array<[string, ClineMessage]> = [
			["a user message", { ts: OLD, type: "say", say: "user_feedback", text: "u" }],
			["an assistant reply", { ts: OLD, type: "say", say: "text", text: "a", partial: false }],
			["a completion result", { ts: OLD, type: "say", say: "completion_result", text: "c", partial: false }],
		]
		const formats: Array<{ settings: Record<string, string>; date: string; time: RegExp }> = [
			{ settings: { dateFormat: "ymd", timeFormat: "24h" }, date: "2024-03-07", time: /14:41/ },
			{ settings: { dateFormat: "dmy", timeFormat: "12h" }, date: "07/03/2024", time: /2:41\s?PM/i },
			{ settings: { dateFormat: "mdy", timeFormat: "24h" }, date: "03/07/2024", time: /14:41/ },
		]

		describe.each(rows)("%s", (_name, message) => {
			it.each(formats)("writes the date as $date when the date format is $settings.dateFormat", (format) => {
				mockState = format.settings
				renderRow(message)

				const text = screen.getByTestId("message-timestamp").textContent!
				expect(text).toContain(format.date)
				expect(text).toMatch(format.time)
				// Not a relative day: an old message is dated.
				expect(text).not.toMatch(/Today|Yesterday/)
			})

			it("uses the locale's own short date when the date format is automatic", () => {
				mockState = { dateFormat: "auto", timeFormat: "24h" }
				renderRow(message)

				const text = screen.getByTestId("message-timestamp").textContent!
				expect(text).toContain("Mar 7, 2024")
				expect(text).toContain("14:41")
			})

			it("carries the exact time as a machine-readable value", () => {
				mockState = { dateFormat: "ymd", timeFormat: "24h" }
				renderRow(message)

				expect(screen.getByTestId("message-timestamp")).toHaveAttribute("datetime", new Date(OLD).toISOString())
			})
		})
	})

	it("keeps the message visible while streaming", () => {
		renderRow({ ts: Date.now(), type: "say", say: "user_feedback", text: "streaming" }, true)
		expect(screen.getByTestId("message-timestamp")).toBeTruthy()
	})
})
