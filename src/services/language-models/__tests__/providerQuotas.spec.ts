import { beforeEach, describe, expect, it, vi } from "vitest"

import { providerIdentifiers } from "@roo-code/types"

vi.mock("vscode", () => ({ version: "1.0.0", authentication: { getSession: vi.fn() } }))
vi.mock("../copilotQuota", () => ({
	getGitHubCopilotQuota: vi.fn(async () => ({
		ok: true,
		quota: {
			plan: "business",
			unlimited: false,
			entitlement: 140000,
			used: 39389.3,
			usedPercent: 28.1,
			resetAt: 1,
			fetchedAt: 2,
		},
	})),
}))

import {
	getProviderQuotas,
	loadProfiles,
	parseDeepSeekBalance,
	parseMoonshotBalance,
	parseOpenRouterKey,
	resetProviderQuotaCache,
} from "../providerQuotas"

describe("parseOpenRouterKey", () => {
	it("reports a bounded key limit as used / limit with a percent", () => {
		expect(parseOpenRouterKey({ data: { limit: 50, limit_remaining: 37.6 } })).toEqual([
			{ id: "key_limit", valueLabel: "$12.40 / $50.00 used", usedPercent: expect.closeTo(24.8, 5) },
		])
	})

	it("falls back to monthly spend for unlimited keys", () => {
		expect(parseOpenRouterKey({ data: { limit: null, usage_monthly: 3.2 } })).toEqual([
			{ id: "spend", valueLabel: "$3.20 spent this month" },
		])
	})

	it("returns undefined without data", () => {
		expect(parseOpenRouterKey({})).toBeUndefined()
		expect(parseOpenRouterKey({ data: {} })).toBeUndefined()
	})
})

describe("parseDeepSeekBalance", () => {
	it("prefers a positive USD balance", () => {
		expect(
			parseDeepSeekBalance({
				balance_infos: [
					{ currency: "CNY", total_balance: "10.00" },
					{ currency: "USD", total_balance: "4.25" },
				],
			}),
		).toEqual([{ id: "balance", valueLabel: "$4.25 left" }])
	})

	it("uses ¥ for a CNY-only balance", () => {
		expect(parseDeepSeekBalance({ balance_infos: [{ currency: "CNY", total_balance: "8" }] })).toEqual([
			{ id: "balance", valueLabel: "¥8.00 left" },
		])
	})

	it("returns undefined for empty or malformed payloads", () => {
		expect(parseDeepSeekBalance({ balance_infos: [] })).toBeUndefined()
		expect(parseDeepSeekBalance(null)).toBeUndefined()
	})
})

describe("parseDeepSeekBalance – fallbacks", () => {
	it("falls back to a zero USD balance, then to the first row", () => {
		expect(
			parseDeepSeekBalance({
				balance_infos: [
					{ currency: "EUR", total_balance: "0" },
					{ currency: "USD", total_balance: "0" },
				],
			}),
		).toEqual([{ id: "balance", valueLabel: "$0.00 left" }])
		expect(parseDeepSeekBalance({ balance_infos: [{ currency: "EUR", total_balance: "3" }] })).toEqual([
			{ id: "balance", valueLabel: "$3.00 left" },
		])
	})
})

describe("parseMoonshotBalance", () => {
	it("reads available_balance", () => {
		expect(parseMoonshotBalance({ data: { available_balance: 19.5 } })).toEqual([
			{ id: "balance", valueLabel: "$19.50 left" },
		])
	})
})

describe("getProviderQuotas", () => {
	beforeEach(() => resetProviderQuotaCache())

	const okFetch = vi.fn(async () => new Response(JSON.stringify({ data: { limit: 10, limit_remaining: 5 } })))

	it("only queries providers that are connected", async () => {
		const result = await getProviderQuotas([{ apiProvider: providerIdentifiers.anthropic } as never], {}, okFetch)
		expect(result).toEqual([])
		expect(okFetch).not.toHaveBeenCalled()
	})

	it("returns Copilot credits formatted for display", async () => {
		const [copilot] = await getProviderQuotas([{ apiProvider: providerIdentifiers.githubCopilot } as never])
		expect(copilot).toMatchObject({
			providerId: providerIdentifiers.githubCopilot,
			ok: true,
			plan: "business",
			windows: [{ id: "premium", valueLabel: "39,389.3 / 140,000 used", usedPercent: 28.1, resetAt: 1 }],
		})
	})

	it("reports noKey when the profile has no API key", async () => {
		const [q] = await getProviderQuotas([{ apiProvider: providerIdentifiers.openrouter } as never], {}, okFetch)
		expect(q).toMatchObject({ providerId: providerIdentifiers.openrouter, ok: false, reason: "noKey" })
		expect(okFetch).not.toHaveBeenCalled()
	})

	it("treats a malformed custom base URL as a different host and never sends the key", async () => {
		const fetchSpy = vi.fn(okFetch)
		const [q] = await getProviderQuotas(
			[
				{
					apiProvider: providerIdentifiers.openrouter,
					openRouterApiKey: "sk",
					openRouterBaseUrl: "not a url",
				} as never,
			],
			{},
			fetchSpy,
		)
		expect(q).toMatchObject({ ok: false, reason: "unsupported" })
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("accepts the provider's own host written with a trailing path or slash", async () => {
		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: { limit: 10, limit_remaining: 5 } })))
		const [q] = await getProviderQuotas(
			[
				{
					apiProvider: providerIdentifiers.openrouter,
					openRouterApiKey: "sk",
					openRouterBaseUrl: "https://openrouter.ai/api/v1/",
				} as never,
			],
			{},
			fetchSpy,
		)
		expect(q).toMatchObject({ ok: true })
	})

	it("never sends a key to a custom base URL", async () => {
		const fetchSpy = vi.fn(okFetch)
		const [q] = await getProviderQuotas(
			[
				{
					apiProvider: providerIdentifiers.openrouter,
					openRouterApiKey: "sk",
					openRouterBaseUrl: "https://evil.example/api/v1",
				} as never,
			],
			{},
			fetchSpy,
		)
		expect(q).toMatchObject({ ok: false, reason: "unsupported" })
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("calls the provider's own host with the saved key", async () => {
		const fetchSpy = vi.fn(okFetch)
		const [q] = await getProviderQuotas(
			[{ apiProvider: providerIdentifiers.openrouter, openRouterApiKey: "sk-test" } as never],
			{},
			fetchSpy,
		)
		expect(fetchSpy).toHaveBeenCalledWith(
			"https://openrouter.ai/api/v1/key",
			expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer sk-test" }) }),
		)
		expect(q).toMatchObject({ ok: true, windows: [{ valueLabel: "$5.00 / $10.00 used" }] })
	})

	it("maps 401 to noKey", async () => {
		const [q] = await getProviderQuotas(
			[{ apiProvider: providerIdentifiers.deepseek, deepSeekApiKey: "bad" } as never],
			{},
			vi.fn(async () => new Response("", { status: 401 })),
		)
		expect(q).toMatchObject({ providerId: providerIdentifiers.deepseek, ok: false, reason: "noKey" })
	})

	it("caches results for the same set of providers unless forced", async () => {
		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: { limit: 10, limit_remaining: 5 } })))
		const profiles = [{ apiProvider: providerIdentifiers.openrouter, openRouterApiKey: "sk" } as never]
		await getProviderQuotas(profiles, {}, fetchSpy)
		await getProviderQuotas(profiles, {}, fetchSpy)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		await getProviderQuotas(profiles, { force: true }, fetchSpy)
		expect(fetchSpy).toHaveBeenCalledTimes(2)
	})
})

describe("loadProfiles", () => {
	it("loads every saved profile through the manager, with keys", async () => {
		const source = {
			listConfig: vi.fn(async () => [{ id: "a" }, { id: "b" }]),
			getProfile: vi.fn(
				async ({ id }: { id: string }) => ({ apiProvider: "x", openRouterApiKey: `key-${id}` }) as never,
			),
		}
		const profiles = await loadProfiles(source)
		expect(profiles).toEqual([
			{ apiProvider: "x", openRouterApiKey: "key-a" },
			{ apiProvider: "x", openRouterApiKey: "key-b" },
		])
		expect(source.getProfile).toHaveBeenCalledWith({ id: "a" })
	})

	it("skips a profile that fails to load instead of failing the whole refresh", async () => {
		const source = {
			listConfig: vi.fn(async () => [{ id: "ok" }, { id: "broken" }]),
			getProfile: vi.fn(async ({ id }: { id: string }) => {
				if (id === "broken") throw new Error("corrupt secret storage")
				return { apiProvider: "x" } as never
			}),
		}
		expect(await loadProfiles(source)).toEqual([{ apiProvider: "x" }])
	})

	it("returns an empty list when there are no profiles", async () => {
		expect(await loadProfiles({ listConfig: async () => [], getProfile: vi.fn() })).toEqual([])
	})
})

describe("error handling never leaks credentials", () => {
	beforeEach(() => resetProviderQuotaCache())

	it("reports a generic message for network errors that embed the key", async () => {
		const [q] = await getProviderQuotas(
			[{ apiProvider: providerIdentifiers.deepseek, deepSeekApiKey: "sk-secret" } as never],
			{},
			vi.fn(async () => {
				throw new Error("connect ECONNREFUSED https://api.deepseek.com Authorization: Bearer sk-secret")
			}),
		)
		expect(q).toMatchObject({ ok: false, reason: "error", message: "Request failed" })
		expect(JSON.stringify(q)).not.toContain("sk-secret")
	})

	it("reports only the status for non-auth HTTP failures", async () => {
		const [q] = await getProviderQuotas(
			[{ apiProvider: providerIdentifiers.moonshot, moonshotApiKey: "sk" } as never],
			{},
			vi.fn(async () => new Response("<html>secret internal page</html>", { status: 502 })),
		)
		expect(q).toMatchObject({ ok: false, reason: "error", message: "HTTP 502" })
	})

	it("treats an empty payload as an error", async () => {
		const [q] = await getProviderQuotas(
			[{ apiProvider: providerIdentifiers.deepseek, deepSeekApiKey: "sk" } as never],
			{},
			vi.fn(async () => new Response(JSON.stringify({ balance_infos: [] }))),
		)
		expect(q).toMatchObject({ ok: false, reason: "error", message: "No usage data" })
	})

	it("surfaces Copilot failures with their reason", async () => {
		const copilotMod = await import("../copilotQuota")
		vi.mocked(copilotMod.getGitHubCopilotQuota).mockResolvedValueOnce({ ok: false, reason: "signedOut" })
		const [q] = await getProviderQuotas([{ apiProvider: providerIdentifiers.githubCopilot } as never], {
			force: true,
		})
		expect(q).toMatchObject({ ok: false, reason: "signedOut" })
	})

	it("shows Copilot unlimited plans without numbers", async () => {
		const copilotMod = await import("../copilotQuota")
		vi.mocked(copilotMod.getGitHubCopilotQuota).mockResolvedValueOnce({
			ok: true,
			quota: { plan: "enterprise", unlimited: true, fetchedAt: 1, resetAt: 2 },
		})
		const [q] = await getProviderQuotas([{ apiProvider: providerIdentifiers.githubCopilot } as never], {
			force: true,
		})
		expect(q).toMatchObject({ ok: true, windows: [{ id: "premium", valueLabel: "Unlimited", resetAt: 2 }] })
	})

	it("falls back to a percent label when counts are missing", async () => {
		const copilotMod = await import("../copilotQuota")
		vi.mocked(copilotMod.getGitHubCopilotQuota).mockResolvedValueOnce({
			ok: true,
			quota: { unlimited: false, usedPercent: 60, fetchedAt: 1 },
		})
		const [q] = await getProviderQuotas([{ apiProvider: providerIdentifiers.githubCopilot } as never], {
			force: true,
		})
		expect(q).toMatchObject({ ok: true, windows: [{ valueLabel: "60% used", usedPercent: 60 }] })
	})
})
