import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { providerIdentifiers, type ProviderQuota } from "@roo-code/types"

import { formatDateOnly, formatTimeOnly } from "@src/utils/format"

import { ProviderLimits } from "../ProviderLimits"

const post = vi.hoisted(() => vi.fn())
vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: post } }))

const prefs = vi.hoisted(() => ({ timeFormat: "auto" as string, dateFormat: "auto" as string }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => prefs }))

// Render the key plus its interpolation values so assertions can see the formatted output.
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, string>) =>
			options ? `${key} ${Object.values(options).join(" ")}` : key,
	}),
}))

const respond = (providerQuotas: ProviderQuota[]) =>
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: { type: "providerQuotas", providerQuotas } }))
	})

describe("ProviderLimits", () => {
	beforeEach(() => {
		post.mockClear()
		prefs.timeFormat = "auto"
		prefs.dateFormat = "auto"
	})

	it("asks the extension for quotas on mount without forcing", () => {
		render(<ProviderLimits />)
		expect(post).toHaveBeenCalledWith({ type: "requestProviderQuotas", bool: false })
	})

	it("shows a loading row until the first response", () => {
		render(<ProviderLimits />)
		expect(screen.getByTestId("provider-limits")).toBeTruthy()
		expect(screen.queryByTestId(`provider-limit-${providerIdentifiers.githubCopilot}`)).toBeNull()
	})

	it("renders credits with a progress bar and reset date", () => {
		render(<ProviderLimits />)
		respond([
			{
				providerId: providerIdentifiers.githubCopilot,
				ok: true,
				plan: "business",
				fetchedAt: Date.now(),
				windows: [
					{
						id: "premium",
						valueLabel: "39,389.3 / 140,000 used",
						usedPercent: 28.1,
						resetAt: Date.parse("2026-11-01T12:00:00Z"),
					},
				],
			},
		])

		const row = screen.getByTestId(`provider-limit-${providerIdentifiers.githubCopilot}`)
		expect(row.textContent).toContain("GitHub Copilot")
		expect(row.textContent).toContain("business")
		expect(row.textContent).toContain("39,389.3 / 140,000 used")
		expect(row.textContent).toContain("28%")
		const bar = row.querySelector("[role=progressbar]")!
		expect(bar.getAttribute("aria-valuenow")).toBe("28")
		// The translation key plus the formatted reset date, not just the key.
		expect(row.textContent).toContain(
			`settings:usage.limits.resets ${formatDateOnly(Date.parse("2026-11-01T12:00:00Z"))}`,
		)
	})

	it("omits the bar for balance-only providers", () => {
		render(<ProviderLimits />)
		respond([
			{
				providerId: providerIdentifiers.deepseek,
				ok: true,
				fetchedAt: 1,
				windows: [{ id: "balance", valueLabel: "$4.25 left" }],
			},
		])
		const row = screen.getByTestId(`provider-limit-${providerIdentifiers.deepseek}`)
		expect(row.textContent).toContain("$4.25 left")
		expect(row.querySelector("[role=progressbar]")).toBeNull()
	})

	it("formats the reset date and the updated time with the user's date and time preferences", () => {
		prefs.dateFormat = "ymd"
		prefs.timeFormat = "24h"
		render(<ProviderLimits />)
		const resetAt = new Date(2026, 10, 1, 12, 0).getTime()
		const fetchedAt = new Date(2026, 10, 1, 14, 41).getTime()
		respond([
			{
				providerId: providerIdentifiers.openrouter,
				ok: true,
				fetchedAt,
				windows: [{ id: "key_limit", valueLabel: "x", usedPercent: 10, resetAt }],
			},
		])
		const row = screen.getByTestId(`provider-limit-${providerIdentifiers.openrouter}`)
		expect(row.textContent).toContain("settings:usage.limits.resets 2026-11-01")
		expect(screen.getByTestId("provider-limits-refresh").textContent).toContain(
			`settings:usage.limits.updated ${formatTimeOnly(fetchedAt, "24h")}`,
		)
		expect(screen.getByTestId("provider-limits-refresh").textContent).not.toMatch(/\b(AM|PM)\b/i)
	})

	it.each(["noKey", "noCopilot", "signedOut", "unsupported", "error"] as const)(
		"shows the quiet status text for %s",
		(reason) => {
			render(<ProviderLimits />)
			respond([{ providerId: providerIdentifiers.openrouter, ok: false, reason, fetchedAt: 1 }])
			const row = screen.getByTestId(`provider-limit-${providerIdentifiers.openrouter}`)
			expect(row.textContent).toContain(`settings:usage.limits.${reason}`)
			expect(row.querySelector("[role=progressbar]")).toBeNull()
		},
	)

	it.each([
		[50, "bg-vscode-charts-green"],
		[80, "bg-vscode-charts-yellow"],
		[95, "bg-vscode-charts-red"],
	])("colours the bar by how much of the allowance is used (%i%%)", (usedPercent, expected) => {
		render(<ProviderLimits />)
		respond([
			{
				providerId: providerIdentifiers.openrouter,
				ok: true,
				fetchedAt: 1,
				windows: [{ id: "key_limit", valueLabel: "x", usedPercent }],
			},
		])
		const bar = screen
			.getByTestId(`provider-limit-${providerIdentifiers.openrouter}`)
			.querySelector("[role=progressbar] > div")!
		expect(bar.className).toContain(expected)
	})

	it("treats a response without a providerQuotas list as empty", () => {
		render(<ProviderLimits />)
		act(() => {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "providerQuotas" } }))
		})
		expect(screen.queryByTestId("provider-limits")).toBeNull()
	})

	it("hides the whole section when nothing connected has a usage API", () => {
		render(<ProviderLimits />)
		respond([])
		expect(screen.queryByTestId("provider-limits")).toBeNull()
	})

	it("refresh forces a new request", () => {
		render(<ProviderLimits />)
		respond([
			{
				providerId: providerIdentifiers.deepseek,
				ok: true,
				fetchedAt: 1,
				windows: [{ id: "b", valueLabel: "$1.00 left" }],
			},
		])
		post.mockClear()
		fireEvent.click(screen.getByTestId("provider-limits-refresh"))
		expect(post).toHaveBeenCalledWith({ type: "requestProviderQuotas", bool: true })
	})

	it("ignores unrelated messages", () => {
		render(<ProviderLimits />)
		act(() => {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "somethingElse" } }))
		})
		expect(screen.getByTestId("provider-limits")).toBeTruthy()
	})
})
