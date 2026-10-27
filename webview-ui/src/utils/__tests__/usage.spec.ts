import type { HistoryItem } from "@roo-code/types"

import { rangeStart, summarizeUsage, usageToCsv } from "../usage"

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
	const history = [
		item({ totalCost: 1.5, tokensIn: 1000, tokensOut: 200, cacheReads: 3000, apiConfigName: "opus", mode: "code" }),
		item({ totalCost: 0.5, tokensIn: 500, tokensOut: 100, apiConfigName: "gpt", mode: "architect", ts: NOW - DAY }),
		item({ totalCost: 2, tokensIn: 10, tokensOut: 10, apiConfigName: "opus", mode: "code", workspace: "/ws/b" }),
		// Outside 7d window
		item({ totalCost: 99, apiConfigName: "opus", mode: "code", ts: NOW - 10 * DAY }),
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

	it("groups by profile and mode sorted by cost desc", () => {
		const s = summarizeUsage(history, { range: "7d", now: NOW })
		expect(s.byProfile.map((b) => [b.key, b.tasks])).toEqual([
			["opus", 2],
			["gpt", 1],
		])
		expect(s.byProfile[0].cost).toBeCloseTo(3.5)
		expect(s.byMode.map((b) => b.key)).toEqual(["code", "architect"])
	})

	it("buckets missing profile/mode under fallbacks", () => {
		const s = summarizeUsage([item({ totalCost: 1 })], { range: "all", now: NOW })
		expect(s.byProfile[0].key).toBe("default")
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

	it("is safe on empty history", () => {
		const s = summarizeUsage([], { range: "7d", now: NOW })
		expect(s.taskCount).toBe(0)
		expect(s.totalCost).toBe(0)
		expect(s.cacheHitRate).toBe(0)
	})

	it("ignores non-finite costs", () => {
		const s = summarizeUsage([item({ totalCost: NaN })], { range: "all", now: NOW })
		expect(s.totalCost).toBe(0)
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
		expect(lines[0]).toBe("date,task,mode,profile,tokensIn,tokensOut,cacheReads,cacheWrites,cost")
		expect(lines).toHaveLength(2)
		expect(lines[1]).toContain('"say ""hi"" then go"')
		expect(lines[1].endsWith(",0.1235")).toBe(true)
	})
})
