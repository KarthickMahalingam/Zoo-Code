import { providerIdentifiers, type HistoryItem } from "@roo-code/types"

import {
	UNRECORDED,
	bucketView,
	metricTotal,
	modelIdFromKey,
	pickMetric,
	primaryUsage,
	rangeStart,
	summarizeUsage,
	usageToCsv,
} from "../usage"

// Fixed "now": Wed 2026-10-14 15:00 local time.
const NOW = new Date(2026, 9, 14, 15, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

let counter = 0
const item = (overrides: Partial<HistoryItem>): HistoryItem => ({
	id: `t${++counter}`,
	number: counter,
	ts: NOW,
	task: `task ${counter}`,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	workspace: "/ws/a",
	...overrides,
})

describe("rangeStart", () => {
	it("returns local midnight for today", () => {
		expect(rangeStart("today", NOW)).toBe(new Date(2026, 9, 14).getTime())
	})

	it("includes today in 7d / 30d windows", () => {
		expect(rangeStart("7d", NOW)).toBe(new Date(2026, 9, 8).getTime())
		expect(rangeStart("30d", NOW)).toBe(new Date(2026, 8, 15).getTime())
	})

	it("is unbounded for all", () => {
		expect(rangeStart("all", NOW)).toBeUndefined()
	})
})

describe("summarizeUsage", () => {
	const used = (apiProvider: string, modelId: string, tokensIn: number, tokensOut: number, cost: number) => [
		{ apiProvider, modelId, requests: 1, tokensIn, tokensOut, cost },
	]
	const history = [
		item({
			totalCost: 1.5,
			tokensIn: 1000,
			tokensOut: 200,
			cacheReads: 3000,
			mode: "code",
			usageByModel: used(providerIdentifiers.anthropic, "opus", 1000, 200, 1.5),
		}),
		item({
			totalCost: 0.5,
			tokensIn: 500,
			tokensOut: 100,
			mode: "architect",
			ts: NOW - DAY,
			usageByModel: used(providerIdentifiers.githubCopilot, "gpt-5", 500, 100, 0.5),
		}),
		item({
			totalCost: 2,
			tokensIn: 10,
			tokensOut: 10,
			mode: "code",
			workspace: "/ws/b",
			usageByModel: used(providerIdentifiers.anthropic, "opus", 10, 10, 2),
		}),
		// Outside 7d window
		item({
			totalCost: 99,
			mode: "code",
			ts: NOW - 10 * DAY,
			usageByModel: used(providerIdentifiers.anthropic, "opus", 0, 0, 99),
		}),
	]

	it("totals only items inside the range", () => {
		const s = summarizeUsage(history, { range: "7d", now: NOW })
		expect(s.taskCount).toBe(3)
		expect(s.totalCost).toBeCloseTo(4)
		expect(s.totalTokens).toBe(1000 + 200 + 500 + 100 + 20)
	})

	it("filters by workspace", () => {
		const s = summarizeUsage(history, { range: "7d", now: NOW, workspace: "/ws/a" })
		expect(s.taskCount).toBe(2)
		expect(s.totalCost).toBeCloseTo(2)
	})

	it("groups by recorded provider and by model, sorted by cost desc", () => {
		const s = summarizeUsage(history, { range: "7d", now: NOW })
		expect(s.byProvider.map((b) => [b.key, b.tasks])).toEqual([
			[providerIdentifiers.anthropic, 2],
			[providerIdentifiers.githubCopilot, 1],
		])
		expect(s.byProvider[0].cost).toBeCloseTo(3.5)
		expect(s.byModel.map((b) => [modelIdFromKey(b.key), b.apiProvider])).toEqual([
			["opus", providerIdentifiers.anthropic],
			["gpt-5", providerIdentifiers.githubCopilot],
		])
		expect(s.byMode.map((b) => b.key)).toEqual(["code", "architect"])
	})

	it("REGRESSION: provider/model come from what was recorded, not from any current profile", () => {
		// The bug: usage was attributed via the *currently selected* profile, so
		// switching providers relabelled past Copilot work as the new provider.
		// Aggregation now takes no profile information at all.
		const copilotTask = item({
			tokensIn: 16_700_000,
			tokensOut: 83_400,
			usageByModel: used(providerIdentifiers.githubCopilot, "claude-opus-5.5", 16_700_000, 83_400, 0),
			apiConfigName: "default", // the profile name is irrelevant to attribution
		})
		const before = summarizeUsage([copilotTask], { range: "all", now: NOW })

		// "Switch provider": same history, but the user's profile now points at Gemini.
		const after = summarizeUsage([{ ...copilotTask, apiConfigName: "gemini-profile" }], { range: "all", now: NOW })

		for (const s of [before, after]) {
			expect(s.byProvider.map((b) => b.key)).toEqual([providerIdentifiers.githubCopilot])
			expect(modelIdFromKey(s.byModel[0].key)).toBe("claude-opus-5.5")
		}
	})

	it("attributes a task that switched providers mid-way to each provider by its own tokens", () => {
		const s = summarizeUsage(
			[
				item({
					tokensIn: 400,
					tokensOut: 0,
					usageByModel: [
						{
							apiProvider: providerIdentifiers.githubCopilot,
							modelId: "claude-opus-5.5",
							requests: 1,
							tokensIn: 100,
							tokensOut: 0,
							cost: 0,
						},
						{
							apiProvider: providerIdentifiers.gemini,
							modelId: "gemini-pro",
							requests: 1,
							tokensIn: 300,
							tokensOut: 0,
							cost: 0,
						},
					],
				}),
			],
			{ range: "all", now: NOW },
		)
		expect(s.byProvider.map((b) => [b.key, b.tokens])).toEqual([
			[providerIdentifiers.gemini, 300],
			[providerIdentifiers.githubCopilot, 100],
		])
		expect(s.byProvider.every((b) => b.tasks === 1)).toBe(true)
	})

	it("buckets tasks with no recorded provider/model as unrecorded instead of guessing", () => {
		const s = summarizeUsage([item({ totalCost: 1, tokensIn: 10, tokensOut: 5 })], { range: "all", now: NOW })
		expect(s.byProvider.map((b) => b.key)).toEqual([UNRECORDED])
		expect(s.byModel.map((b) => b.key)).toEqual([UNRECORDED])
		expect(modelIdFromKey(UNRECORDED)).toBeUndefined()
		expect(s.byMode[0].key).toBe("unknown")
	})

	it("computes cache hit rate over input-side tokens", () => {
		const s = summarizeUsage(history, { range: "today", now: NOW })
		// today: tokensIn 1000 + 10, cacheReads 3000
		expect(s.cacheHitRate).toBeCloseTo(3000 / (1010 + 3000))
	})

	it("produces a dense daily series for bounded ranges", () => {
		const s = summarizeUsage(history, { range: "7d", now: NOW })
		expect(s.daily).toHaveLength(7)
		expect(s.daily.at(-1)!.cost).toBeCloseTo(3.5)
		expect(s.daily.at(-2)!.cost).toBeCloseTo(0.5)
		expect(s.daily[0].cost).toBe(0)
	})

	it("returns top tasks by cost, limited", () => {
		const s = summarizeUsage(history, { range: "all", now: NOW, topTaskLimit: 2 })
		expect(s.topTasks.map((t) => t.totalCost)).toEqual([99, 2])
	})

	it("breaks cost ties by tokens so equal-priced tasks still rank meaningfully", () => {
		const s = summarizeUsage(
			[item({ id: "few", totalCost: 1, tokensIn: 10 }), item({ id: "many", totalCost: 1, tokensIn: 9_000 })],
			{ range: "all", now: NOW },
		)
		expect(s.topTasks.map((t) => t.id)).toEqual(["many", "few"])
	})

	it("is safe on empty history", () => {
		const s = summarizeUsage([], { range: "7d", now: NOW })
		expect(s.taskCount).toBe(0)
		expect(s.totalCost).toBe(0)
		expect(s.cacheHitRate).toBe(0)
	})

	it("tracks tokens per day alongside cost", () => {
		const s = summarizeUsage(history, { range: "7d", now: NOW })
		expect(s.daily.at(-1)!.tokens).toBe(1000 + 200 + 20)
	})

	it("ranks zero-cost tasks by tokens (subscription providers)", () => {
		const s = summarizeUsage([item({ id: "small", tokensIn: 10 }), item({ id: "big", tokensIn: 5_000_000 })], {
			range: "all",
			now: NOW,
		})
		expect(s.topTasks.map((t) => t.id)).toEqual(["big", "small"])
	})

	it("ignores non-finite costs", () => {
		const s = summarizeUsage([item({ totalCost: NaN })], { range: "all", now: NOW })
		expect(s.totalCost).toBe(0)
	})
})

describe("mixed priced and unpriced providers", () => {
	const mixed = () => {
		const mk = (provider: string, model: string, tokens: number, cost: number) =>
			item({
				tokensIn: tokens,
				tokensOut: 0,
				totalCost: cost,
				usageByModel: [
					{ apiProvider: provider, modelId: model, requests: 1, tokensIn: tokens, tokensOut: 0, cost },
				],
			})
		return summarizeUsage(
			[
				mk(providerIdentifiers.githubCopilot, "claude-opus-5.5", 16_000_000, 0),
				mk(providerIdentifiers.anthropic, "claude-sonnet-5", 200_000, 1.2),
			],
			{ range: "all", now: NOW },
		)
	}

	it("prioritises cost as soon as any usage in the range is priced", () => {
		expect(pickMetric(mixed())).toBe("cost")
	})

	it("flags each bucket as priced or not so subscription usage isn't shown as $0.00", () => {
		const s = mixed()
		const byKey = Object.fromEntries(s.byProvider.map((b) => [b.key, b]))
		expect(byKey[providerIdentifiers.anthropic].priced).toBe(true)
		expect(byKey[providerIdentifiers.githubCopilot].priced).toBe(false)
		expect(s.byModel.find((b) => modelIdFromKey(b.key) === "claude-opus-5.5")!.priced).toBe(false)
	})

	it("keeps all-unpriced ranges on tokens and all-priced ranges on cost", () => {
		const unpriced = summarizeUsage([item({ tokensIn: 5, usageByModel: [] })], { range: "all", now: NOW })
		expect(pickMetric(unpriced)).toBe("tokens")
	})
})

describe("bucketView", () => {
	const priced = { cost: 3, tokens: 1000, priced: true }
	const unpriced = { cost: 0, tokens: 16_000_000, priced: false }

	it("cost mode: a priced bucket is its cost and its share of total cost", () => {
		expect(bucketView(priced, "cost", 12)).toEqual({ value: 3, unpriced: false, percent: 25 })
	})

	it("cost mode: an unpriced bucket carries tokens, is flagged, and has no share (never 0%)", () => {
		expect(bucketView(unpriced, "cost", 12)).toEqual({ value: 0, unpriced: true, percent: 0 })
	})

	it("tokens mode: everything is tokens and nothing is flagged unpriced", () => {
		expect(bucketView(unpriced, "tokens", 32_000_000)).toEqual({ value: 16_000_000, unpriced: false, percent: 50 })
		expect(bucketView(priced, "tokens", 2000)).toEqual({ value: 1000, unpriced: false, percent: 50 })
	})

	it("guards division by zero", () => {
		expect(bucketView(priced, "cost", 0).percent).toBe(0)
	})

	it("rounds shares to whole numbers", () => {
		expect(bucketView({ cost: 1, tokens: 0, priced: true }, "cost", 3).percent).toBe(33)
	})
})

describe("metricTotal", () => {
	it("selects the headline value for the metric", () => {
		const s = { totalCost: 2.5, totalTokens: 900 }
		expect(metricTotal(s, "cost")).toBe(2.5)
		expect(metricTotal(s, "tokens")).toBe(900)
	})
})

describe("primaryUsage", () => {
	it("returns the provider+model that used the most tokens", () => {
		const task = item({
			usageByModel: [
				{ apiProvider: "a", modelId: "small", requests: 1, tokensIn: 10, tokensOut: 0, cost: 0 },
				{ apiProvider: "b", modelId: "big", requests: 1, tokensIn: 900, tokensOut: 0, cost: 0 },
			],
		})
		expect(primaryUsage(task)).toEqual({ apiProvider: "b", modelId: "big" })
	})

	it("is undefined when nothing was recorded", () => {
		expect(primaryUsage(item({}))).toBeUndefined()
		expect(
			primaryUsage(item({ usageByModel: [{ requests: 1, tokensIn: 1, tokensOut: 1, cost: 0 }] })),
		).toBeUndefined()
	})
})

describe("pickMetric", () => {
	it("uses cost when any cost was recorded", () => {
		expect(pickMetric({ totalCost: 0.01, totalTokens: 10 })).toBe("cost")
	})

	it("falls back to tokens when tokens exist but cost is zero (e.g. GitHub Copilot)", () => {
		expect(pickMetric({ totalCost: 0, totalTokens: 6_200_000 })).toBe("tokens")
	})

	it("stays on cost when there is no usage at all", () => {
		expect(pickMetric({ totalCost: 0, totalTokens: 0 })).toBe("cost")
	})
})

describe("usageToCsv", () => {
	it("escapes quotes and newlines and respects the range", () => {
		const csv = usageToCsv(
			[
				item({ task: 'say "hi"\nthen go', totalCost: 0.12345, mode: "code" }),
				item({ task: "old", ts: NOW - 40 * DAY }),
			],
			{ range: "30d", now: NOW },
		)
		const lines = csv.split("\n")
		expect(lines[0]).toBe("date,task,mode,provider,model,tokensIn,tokensOut,cacheReads,cacheWrites,cost")
		expect(lines).toHaveLength(2)
		expect(lines[1]).toContain('"say ""hi"" then go"')
		expect(lines[1].endsWith(",0.1235")).toBe(true)
	})
})
