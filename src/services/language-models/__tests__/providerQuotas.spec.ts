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
	parseKimiCodeUsage,
	parseMiniMaxRemains,
	parseMoonshotBalance,
	parseNanoGptUsage,
	parseOpenCodeGoUsage,
	parseOpenRouterKey,
	parseZaiQuota,
	resetProviderQuotaCache,
	windowLabel,
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

describe("windowLabel", () => {
	it("names rolling windows by length", () => {
		expect(windowLabel(5 * 3600, "x")).toBe("5-hour")
		expect(windowLabel(7 * 86400, "x")).toBe("Weekly")
		expect(windowLabel(3 * 86400, "x")).toBe("3-day")
		expect(windowLabel(undefined, "Tokens")).toBe("Tokens")
		expect(windowLabel(90, "Tokens")).toBe("Tokens")
	})
})

describe("parseKimiCodeUsage", () => {
	it("reads the ratio-based usages block in display order", () => {
		expect(
			parseKimiCodeUsage({
				usages: {
					limit_month_total: { used_ratio: 0.1 },
					limit_5h: { used_ratio: 0.25, reset_time: 1_800_000_000 },
					limit_7d: { used_ratio: 0.5 },
				},
			}),
		).toEqual([
			{ id: "limit_5h", valueLabel: "5-hour", usedPercent: 25, resetAt: 1_800_000_000_000 },
			{ id: "limit_7d", valueLabel: "Weekly", usedPercent: 50, resetAt: undefined },
			{ id: "limit_month_total", valueLabel: "Monthly", usedPercent: expect.closeTo(10, 5), resetAt: undefined },
		])
	})

	it("skips entries without a finite ratio", () => {
		expect(parseKimiCodeUsage({ usages: { limit_5h: {}, limit_7d: { used_ratio: "x" } } })).toBeUndefined()
	})

	it("falls back to the legacy weekly usage block, deriving used from remaining", () => {
		expect(parseKimiCodeUsage({ usage: { limit: 200, remaining: 150 } })).toEqual([
			{ id: "weekly", valueLabel: "Weekly", usedPercent: 25, resetAt: undefined },
		])
	})

	it("returns undefined for junk", () => {
		expect(parseKimiCodeUsage(null)).toBeUndefined()
		expect(parseKimiCodeUsage({})).toBeUndefined()
	})
})

describe("parseZaiQuota", () => {
	it("maps 5-hour and weekly limits, including credit counts", () => {
		expect(
			parseZaiQuota({
				code: 200,
				data: {
					limits: [
						{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 40, nextResetTime: 1_800_000_000_000 },
						{ type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 2000, currentValue: 500 },
						{ type: "TIME_LIMIT", percentage: 99 },
					],
				},
			}),
		).toEqual([
			{ id: "limit_0", valueLabel: "5-hour", usedPercent: 40, resetAt: 1_800_000_000_000 },
			{ id: "limit_1", valueLabel: "Weekly: 500 / 2,000 credits", usedPercent: 25, resetAt: undefined },
		])
	})

	it("treats a business failure inside HTTP 200 as no data", () => {
		expect(parseZaiQuota({ success: false, code: 1001, msg: "expired", data: { limits: [] } })).toBeUndefined()
		expect(parseZaiQuota({ code: 1001, data: { limits: [{ type: "TOKENS_LIMIT" }] } })).toBeUndefined()
	})
})

describe("parseMiniMaxRemains", () => {
	const row = {
		model_name: "MiniMax-M2",
		current_interval_total_count: 100,
		current_interval_remaining_percent: 80,
		end_time: 1_800_000_000_000,
		current_weekly_total_count: 1000,
		current_weekly_usage_count: 900,
		weekly_end_time: 1_900_000_000_000,
	}

	it("reports the 5-hour window and a weekly window when the plan has one", () => {
		expect(parseMiniMaxRemains({ model_remains: [{ model_name: "other" }, row] })).toEqual([
			{ id: "5h", valueLabel: "5-hour", usedPercent: 20, resetAt: 1_800_000_000_000 },
			{ id: "weekly", valueLabel: "Weekly", usedPercent: 10, resetAt: 1_900_000_000_000 },
		])
	})

	it("reads counters as used (not left) for the legacy coding plan", () => {
		const windows = parseMiniMaxRemains(
			{
				model_remains: [
					{
						model_name: "MiniMax-M2",
						current_interval_total_count: 100,
						current_interval_usage_count: 30,
						current_weekly_total_count: 1000,
						current_weekly_usage_count: 900,
					},
				],
			},
			false,
		)!
		expect(windows[0].usedPercent).toBe(30)
		expect(windows[1].usedPercent).toBe(90)
	})

	it("omits the weekly window when the plan tier does not apply it (status 3)", () => {
		const result = parseMiniMaxRemains({ model_remains: [{ ...row, current_weekly_status: 3 }] })
		expect(result?.map((w) => w.id)).toEqual(["5h"])
	})

	it("rejects an error envelope or an empty list", () => {
		expect(parseMiniMaxRemains({ base_resp: { status_code: 1004 }, model_remains: [row] })).toBeUndefined()
		expect(parseMiniMaxRemains({ model_remains: [] })).toBeUndefined()
	})
})

describe("parseNanoGptUsage", () => {
	it("derives percent from percentUsed or used/limit and keeps state in the label", () => {
		expect(
			parseNanoGptUsage({
				state: "grace",
				limits: { dailyInputTokens: 1000 },
				dailyInputTokens: { used: 250 },
				monthly: { percentUsed: 0.4, resetAt: 1_800_000_000 },
			}),
		).toEqual([
			{ id: "daily", valueLabel: "Daily (grace)", usedPercent: 25, resetAt: undefined },
			{ id: "monthly", valueLabel: "Monthly (grace)", usedPercent: 40, resetAt: 1_800_000_000_000 },
		])
	})

	it("shows no percent for a degraded window", () => {
		const daily = parseNanoGptUsage({ dailyInputTokens: { percentUsed: 0.9, degraded: true } })![0]
		expect(daily.usedPercent).toBeUndefined()
	})
})

describe("parseOpenCodeGoUsage", () => {
	it("maps rolling, weekly and monthly windows that carry a percent and a reset", () => {
		expect(
			parseOpenCodeGoUsage({
				usage: {
					rolling: { percent: 12, resetsAt: 1_800_000_000 },
					weekly: { percent: 140, resetsAt: 1_800_000_001 },
					monthly: { percent: 5 },
				},
			}),
		).toEqual([
			{ id: "5h", valueLabel: "5-hour", usedPercent: 12, resetAt: 1_800_000_000_000 },
			{ id: "weekly", valueLabel: "Weekly", usedPercent: 100, resetAt: 1_800_000_001_000 },
		])
	})
})

describe("balance parser edge cases", () => {
	it("DeepSeek: rejects non-object and empty payloads, and a row without a balance", () => {
		expect(parseDeepSeekBalance(null)).toBeUndefined()
		expect(parseDeepSeekBalance({ balance_infos: [] })).toBeUndefined()
		expect(parseDeepSeekBalance({ balance_infos: [{ currency: "USD" }] })).toBeUndefined()
		expect(parseDeepSeekBalance({ balance_infos: ["x", null] })).toBeUndefined()
	})

	it("DeepSeek: prefers a positive CNY balance over a zero USD one, then any USD row, then the first row", () => {
		expect(
			parseDeepSeekBalance({
				balance_infos: [
					{ currency: "USD", total_balance: "0" },
					{ currency: "CNY", total_balance: "12" },
				],
			}),
		).toEqual([{ id: "balance", valueLabel: "¥12.00 left" }])
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

	it("Moonshot: returns undefined without an available_balance", () => {
		expect(parseMoonshotBalance({ data: {} })).toBeUndefined()
		expect(parseMoonshotBalance(null)).toBeUndefined()
	})
})

describe("parser edge cases", () => {
	it("Kimi Code: skips a legacy usage block with no limit, and derives used from `used`", () => {
		expect(parseKimiCodeUsage({ usage: { used: 5 } })).toBeUndefined()
		expect(parseKimiCodeUsage({ usage: { limit: 100, used: 40, resetTime: 1_800_000_000 } })).toEqual([
			{ id: "weekly", valueLabel: "Weekly", usedPercent: 40, resetAt: 1_800_000_000_000 },
		])
		expect(parseKimiCodeUsage({ usage: { limit: 100 } })).toBeUndefined()
	})

	it("z.ai: ignores non-object, wrong-type and unit-less limits; falls back to counts for percent", () => {
		expect(parseZaiQuota("nope")).toBeUndefined()
		expect(parseZaiQuota({ data: {} })).toBeUndefined()
		expect(parseZaiQuota({ data: { limits: [null, { type: "TIME_LIMIT" }] } })).toBeUndefined()
		expect(
			parseZaiQuota({
				data: { limits: [{ type: "TOKENS_LIMIT", unit: 9, number: 5, usage: 200, currentValue: 50 }] },
			}),
		).toEqual([{ id: "limit_0", valueLabel: "Tokens", usedPercent: 25, resetAt: undefined }])
		expect(parseZaiQuota({ data: { limits: [{ type: "CREDIT_LIMIT", usage: 0, currentValue: 0 }] } })).toEqual([
			{ id: "limit_0", valueLabel: "Credits: 0 / 0 credits", usedPercent: undefined, resetAt: undefined },
		])
	})

	it("MiniMax: picks a chat-named or percent-bearing model when no minimax-m model exists", () => {
		expect(parseMiniMaxRemains(null)).toBeUndefined()
		expect(parseMiniMaxRemains({ model_remains: ["x", null] })).toBeUndefined()

		const byName = parseMiniMaxRemains({
			model_remains: [
				{ model_name: "other", current_interval_remaining_percent: 10 },
				{ model_name: "Chat", current_interval_remaining_percent: 60 },
			],
		})
		expect(byName?.[0].usedPercent).toBe(40)

		const byPercent = parseMiniMaxRemains({
			model_remains: [{ model_name: "a" }, { model_name: "b", current_interval_remaining_percent: 75 }],
		})
		expect(byPercent?.[0].usedPercent).toBe(25)

		const first = parseMiniMaxRemains({ model_remains: [{ model_name: "only" }] })
		expect(first).toEqual([{ id: "5h", valueLabel: "5-hour", usedPercent: undefined, resetAt: undefined }])
		expect(
			parseMiniMaxRemains({ model_remains: [{ current_interval_remaining_percent: 5 }] })?.[0].usedPercent,
		).toBe(95)
	})

	it("MiniMax: skips a weekly window with no data and clamps an out-of-range percent", () => {
		const [interval, weekly] = parseMiniMaxRemains({
			model_remains: [{ model_name: "MiniMax-M2", current_interval_remaining_percent: 150 }],
		})!
		expect(interval.usedPercent).toBe(0)
		expect(weekly).toBeUndefined()
	})

	it("NanoGPT: handles non-object input, legacy `daily`, nested limits and unusable windows", () => {
		expect(parseNanoGptUsage(null)).toBeUndefined()
		expect(parseNanoGptUsage({})).toBeUndefined()
		expect(
			parseNanoGptUsage({
				daily: { used: 30, limit: 120, resetAt: "2026-05-01T00:00:00Z" },
				monthly: { used: 10, limits: { monthly: 100 } },
				period: { currentPeriodEnd: 1_800_000_000 },
			}),
		).toEqual([
			{ id: "daily", valueLabel: "Daily", usedPercent: 25, resetAt: Date.parse("2026-05-01T00:00:00Z") },
			{ id: "monthly", valueLabel: "Monthly", usedPercent: 10, resetAt: 1_800_000_000_000 },
		])
		expect(parseNanoGptUsage({ daily: { used: 30, limits: { daily: 60 } } })?.[0].usedPercent).toBe(50)
		expect(parseNanoGptUsage({ monthly: { used: 5, limit: 0 } })?.[0].usedPercent).toBeUndefined()
		expect(parseNanoGptUsage({ monthly: {} })?.[0].usedPercent).toBeUndefined()
	})

	it("OpenCode Go: returns undefined without a usage block or with no usable window", () => {
		expect(parseOpenCodeGoUsage(null)).toBeUndefined()
		expect(parseOpenCodeGoUsage({})).toBeUndefined()
		expect(parseOpenCodeGoUsage({ usage: { rolling: { percent: 10 } } })).toBeUndefined()
	})
})

describe("getProviderQuotas – Copilot window and misc", () => {
	beforeEach(() => resetProviderQuotaCache())

	it("shows a percent-only Copilot window, and 'Unlimited' for unlimited plans", async () => {
		const { getGitHubCopilotQuota } = await import("../copilotQuota")
		const mocked = vi.mocked(getGitHubCopilotQuota)

		mocked.mockResolvedValueOnce({ ok: true, quota: { unlimited: false, usedPercent: 41.6, fetchedAt: 1 } })
		const [pct] = await getProviderQuotas([{ apiProvider: providerIdentifiers.githubCopilot } as never])
		expect(pct).toMatchObject({ ok: true, windows: [{ valueLabel: "42% used", usedPercent: 41.6 }] })

		resetProviderQuotaCache()
		mocked.mockResolvedValueOnce({ ok: true, quota: { unlimited: false, fetchedAt: 1 } })
		const [none] = await getProviderQuotas([{ apiProvider: providerIdentifiers.githubCopilot } as never])
		expect(none).toMatchObject({ ok: true, windows: [{ valueLabel: "0% used" }] })

		resetProviderQuotaCache()
		mocked.mockResolvedValueOnce({ ok: true, quota: { unlimited: true, resetAt: 7, fetchedAt: 1 } })
		const [unl] = await getProviderQuotas([{ apiProvider: providerIdentifiers.githubCopilot } as never])
		expect(unl).toMatchObject({ ok: true, windows: [{ valueLabel: "Unlimited", resetAt: 7 }] })
	})

	it("passes Copilot failures through with their reason and message", async () => {
		const { getGitHubCopilotQuota } = await import("../copilotQuota")
		vi.mocked(getGitHubCopilotQuota).mockResolvedValueOnce({ ok: false, reason: "error", message: "boom" })
		const [q] = await getProviderQuotas([{ apiProvider: providerIdentifiers.githubCopilot } as never])
		expect(q).toMatchObject({ ok: false, reason: "error", message: "boom" })
	})

	it("uses the default z.ai line when the profile sets none", async () => {
		const fetchSpy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("{}"))
		await getProviderQuotas([{ apiProvider: providerIdentifiers.zai, zaiApiKey: "k" } as never], {}, fetchSpy)
		expect(fetchSpy.mock.calls[0][0]).toBe("https://api.z.ai/api/monitor/usage/quota/limit")
	})

	it("reports an error when a keyed provider answers with no usable data, and surfaces the last failure", async () => {
		const [empty] = await getProviderQuotas(
			[{ apiProvider: providerIdentifiers.nanogpt, nanoGptApiKey: "k" } as never],
			{},
			vi.fn(async () => new Response("{}")),
		)
		expect(empty).toMatchObject({ ok: false, reason: "error", message: "No usage data" })

		resetProviderQuotaCache()
		const [failed] = await getProviderQuotas(
			[{ apiProvider: providerIdentifiers.minimax, minimaxApiKey: "k" } as never],
			{},
			vi.fn(async () => new Response("", { status: 500 })),
		)
		expect(failed).toMatchObject({ ok: false, reason: "error", message: "HTTP 500" })
	})

	it("treats an auth failure on the first MiniMax URL as a missing/invalid key without trying the fallback", async () => {
		const fetchSpy = vi.fn(
			async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("", { status: 401 }),
		)
		const [q] = await getProviderQuotas(
			[{ apiProvider: providerIdentifiers.minimax, minimaxApiKey: "k" } as never],
			{},
			fetchSpy,
		)
		expect(q).toMatchObject({ ok: false, reason: "noKey" })
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})
})

describe("getProviderQuotas – coding-plan providers", () => {
	beforeEach(() => resetProviderQuotaCache())

	it("queries z.ai on the host matching the profile's API line", async () => {
		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { limits: [] } })))
		await getProviderQuotas(
			[{ apiProvider: providerIdentifiers.zai, zaiApiKey: "k", zaiApiLine: "china_coding" } as never],
			{},
			fetchSpy,
		)
		expect(fetchSpy).toHaveBeenCalledWith(
			"https://open.bigmodel.cn/api/monitor/usage/quota/limit",
			expect.anything(),
		)
	})

	it("falls back to the coding-plan endpoint for MiniMax and reads its counters as used", async () => {
		const body = {
			model_remains: [
				{
					model_name: "MiniMax-M2",
					current_interval_total_count: 100,
					current_interval_usage_count: 30,
				},
			],
		}
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(new Response("", { status: 404 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(body)))
		const [q] = await getProviderQuotas(
			[{ apiProvider: providerIdentifiers.minimax, minimaxApiKey: "k" } as never],
			{},
			fetchSpy,
		)
		expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual([
			"https://api.minimax.io/v1/token_plan/remains",
			"https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
		])
		expect(q).toMatchObject({ ok: true, windows: [{ id: "5h", usedPercent: 30 }] })
	})

	it("uses the China MiniMax hosts for a minimaxi.com base URL", async () => {
		const fetchSpy = vi.fn(
			async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("", { status: 404 }),
		)
		await getProviderQuotas(
			[
				{
					apiProvider: providerIdentifiers.minimax,
					minimaxApiKey: "k",
					minimaxBaseUrl: "https://api.minimaxi.com/anthropic",
				} as never,
			],
			{},
			fetchSpy,
		)
		expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual([
			"https://api.minimaxi.com/v1/token_plan/remains",
			"https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
		])
	})

	it("never sends a MiniMax key to an unknown base URL", async () => {
		const fetchSpy = vi.fn()
		const [q] = await getProviderQuotas(
			[
				{
					apiProvider: providerIdentifiers.minimax,
					minimaxApiKey: "k",
					minimaxBaseUrl: "https://gateway.example/anthropic",
				} as never,
			],
			{},
			fetchSpy,
		)
		expect(q).toMatchObject({ ok: false, reason: "unsupported" })
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("reports noKey for a Kimi Code profile signed in with OAuth (no API key)", async () => {
		const fetchSpy = vi.fn()
		const [q] = await getProviderQuotas([{ apiProvider: providerIdentifiers.kimiCode } as never], {}, fetchSpy)
		expect(q).toMatchObject({ ok: false, reason: "noKey" })
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("calls NanoGPT, Kimi Code and OpenCode Go on their own hosts only", async () => {
		const fetchSpy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({})))
		await getProviderQuotas(
			[
				{ apiProvider: providerIdentifiers.nanogpt, nanoGptApiKey: "k" } as never,
				{ apiProvider: providerIdentifiers.kimiCode, kimiCodeApiKey: "k" } as never,
				{ apiProvider: providerIdentifiers.opencodeGo, opencodeGoApiKey: "k" } as never,
			],
			{},
			fetchSpy,
		)
		expect(fetchSpy.mock.calls.map((c) => c[0]).sort()).toEqual([
			"https://api.kimi.com/coding/v1/usages",
			"https://nano-gpt.com/api/subscription/v1/usage",
			"https://opencode.ai/zen/go/v1/usage",
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
