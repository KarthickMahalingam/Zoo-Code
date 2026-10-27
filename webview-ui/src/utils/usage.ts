import type { HistoryItem } from "@roo-code/types"

/**
 * Pure aggregation over locally persisted task history for the Usage tab.
 *
 * Notes on correctness:
 * - `HistoryItem.totalCost` is a task's *own* spend; subtasks are separate
 *   history items. Summing every item therefore counts each dollar once.
 * - History stores the provider profile (`apiConfigName`), not the model id,
 *   so the breakdown is by profile.
 */

export const USAGE_RANGES = ["today", "7d", "30d", "all"] as const
export type UsageRange = (typeof USAGE_RANGES)[number]

const DAY_MS = 24 * 60 * 60 * 1000

export interface UsageBucket {
	key: string
	cost: number
	tokens: number
	tasks: number
}

export interface DailyUsage {
	/** Local-midnight timestamp of the day. */
	day: number
	cost: number
}

export interface UsageSummary {
	totalCost: number
	tokensIn: number
	tokensOut: number
	cacheReads: number
	cacheWrites: number
	totalTokens: number
	/** Share of input-side tokens served from cache, 0–1. */
	cacheHitRate: number
	taskCount: number
	byProfile: UsageBucket[]
	byMode: UsageBucket[]
	daily: DailyUsage[]
	topTasks: HistoryItem[]
}

export interface UsageOptions {
	range: UsageRange
	/** When set, only tasks from this workspace are included. */
	workspace?: string
	now?: number
	topTaskLimit?: number
}

function startOfLocalDay(ts: number): number {
	const d = new Date(ts)
	d.setHours(0, 0, 0, 0)
	return d.getTime()
}

/** Inclusive lower bound for a range, or `undefined` for "all". */
export function rangeStart(range: UsageRange, now: number): number | undefined {
	const today = startOfLocalDay(now)

	switch (range) {
		case "today":
			return today
		case "7d":
			return today - 6 * DAY_MS
		case "30d":
			return today - 29 * DAY_MS
		default:
			return undefined
	}
}

function addTo(map: Map<string, UsageBucket>, key: string, cost: number, tokens: number) {
	const bucket = map.get(key) ?? { key, cost: 0, tokens: 0, tasks: 0 }
	bucket.cost += cost
	bucket.tokens += tokens
	bucket.tasks += 1
	map.set(key, bucket)
}

const byCostDesc = (a: UsageBucket, b: UsageBucket) => b.cost - a.cost || b.tokens - a.tokens

export function summarizeUsage(history: HistoryItem[], options: UsageOptions): UsageSummary {
	const now = options.now ?? Date.now()
	const start = rangeStart(options.range, now)
	const topTaskLimit = options.topTaskLimit ?? 5

	const items = history.filter(
		(item) =>
			typeof item.ts === "number" &&
			(start === undefined || item.ts >= start) &&
			(!options.workspace || item.workspace === options.workspace),
	)

	const profiles = new Map<string, UsageBucket>()
	const modes = new Map<string, UsageBucket>()
	const daily = new Map<number, number>()

	let totalCost = 0
	let tokensIn = 0
	let tokensOut = 0
	let cacheReads = 0
	let cacheWrites = 0

	for (const item of items) {
		const cost = Number.isFinite(item.totalCost) ? item.totalCost : 0
		const tIn = item.tokensIn || 0
		const tOut = item.tokensOut || 0
		const tokens = tIn + tOut

		totalCost += cost
		tokensIn += tIn
		tokensOut += tOut
		cacheReads += item.cacheReads || 0
		cacheWrites += item.cacheWrites || 0

		addTo(profiles, item.apiConfigName || "default", cost, tokens)
		addTo(modes, item.mode || "unknown", cost, tokens)

		const day = startOfLocalDay(item.ts)
		daily.set(day, (daily.get(day) ?? 0) + cost)
	}

	// Densify the daily series for bounded ranges so the chart has a bar per day
	// (including zero-spend days). "all" stays sparse to avoid huge arrays.
	const dailySeries: DailyUsage[] = []
	if (start !== undefined) {
		for (let day = start; day <= startOfLocalDay(now); day += DAY_MS) {
			// Re-normalise each step to survive DST transitions.
			const normalised = startOfLocalDay(day + DAY_MS / 2)
			dailySeries.push({ day: normalised, cost: daily.get(normalised) ?? 0 })
		}
	} else {
		for (const [day, cost] of [...daily.entries()].sort(([a], [b]) => a - b)) {
			dailySeries.push({ day, cost })
		}
	}

	const inputSide = tokensIn + cacheReads

	return {
		totalCost,
		tokensIn,
		tokensOut,
		cacheReads,
		cacheWrites,
		totalTokens: tokensIn + tokensOut,
		cacheHitRate: inputSide > 0 ? cacheReads / inputSide : 0,
		taskCount: items.length,
		byProfile: [...profiles.values()].sort(byCostDesc),
		byMode: [...modes.values()].sort(byCostDesc),
		daily: dailySeries,
		topTasks: [...items].sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0)).slice(0, topTaskLimit),
	}
}

/** Serialises the filtered usage rows as CSV (one row per task). */
export function usageToCsv(history: HistoryItem[], options: UsageOptions): string {
	const start = rangeStart(options.range, options.now ?? Date.now())
	const header = ["date", "task", "mode", "profile", "tokensIn", "tokensOut", "cacheReads", "cacheWrites", "cost"]

	const escape = (value: string) => `"${value.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`

	const rows = history
		.filter(
			(item) =>
				(start === undefined || item.ts >= start) &&
				(!options.workspace || item.workspace === options.workspace),
		)
		.sort((a, b) => a.ts - b.ts)
		.map((item) =>
			[
				new Date(item.ts).toISOString(),
				escape(item.title || item.task || ""),
				escape(item.mode || ""),
				escape(item.apiConfigName || ""),
				item.tokensIn || 0,
				item.tokensOut || 0,
				item.cacheReads || 0,
				item.cacheWrites || 0,
				(item.totalCost || 0).toFixed(4),
			].join(","),
		)

	return [header.join(","), ...rows].join("\n")
}
