import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { providerIdentifiers, type ProviderQuota } from "@roo-code/types"

import { ProviderLimits } from "../ProviderLimits"

const post = vi.hoisted(() => vi.fn())
vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: post } }))

const respond = (providerQuotas: ProviderQuota[]) =>
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: { type: "providerQuotas", providerQuotas } }))
	})

describe("ProviderLimits", () => {
	beforeEach(() => post.mockClear())

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
		expect(row.textContent).toContain("resets")
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

	it.each(["noKey", "signedOut", "unsupported", "error"] as const)("shows a quiet status for %s", (reason) => {
		render(<ProviderLimits />)
		respond([{ providerId: providerIdentifiers.openrouter, ok: false, reason, fetchedAt: 1 }])
		const row = screen.getByTestId(`provider-limit-${providerIdentifiers.openrouter}`)
		expect(row.textContent).toContain(`settings:usage.limits.${reason}`.split(".").pop()!)
		expect(row.querySelector("[role=progressbar]")).toBeNull()
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
