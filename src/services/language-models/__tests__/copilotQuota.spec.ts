import { describe, expect, it } from "vitest"

vi.mock("vscode", () => ({ version: "1.0.0", authentication: { getSession: vi.fn() } }))

import { parseCopilotQuota } from "../copilotQuota"

const NOW = 1_800_000_000_000

// Shape recorded from GET api.github.com/copilot_internal/user (business plan).
const businessPayload = {
	copilot_plan: "business",
	quota_reset_date: "2026-11-01",
	quota_reset_date_utc: "2026-11-01T00:00:00.000Z",
	quota_snapshots: {
		chat: { unlimited: true, entitlement: 0, remaining: 0 },
		completions: { unlimited: true, entitlement: 0, remaining: 0 },
		premium_interactions: {
			entitlement: 140000,
			remaining: 100610,
			quota_remaining: 100610.7,
			unlimited: false,
			percent_remaining: 71.8,
		},
	},
}

describe("parseCopilotQuota", () => {
	it("derives used credits from the precise quota_remaining, like GitHub's panel", () => {
		const q = parseCopilotQuota(businessPayload, NOW)!
		expect(q.plan).toBe("business")
		expect(q.unlimited).toBe(false)
		expect(q.entitlement).toBe(140000)
		expect(q.used).toBe(39389.3)
		expect(q.usedPercent).toBeCloseTo(28.135, 2)
		expect(q.resetAt).toBe(Date.parse("2026-11-01T00:00:00.000Z"))
		expect(q.fetchedAt).toBe(NOW)
	})

	it("falls back to the integer remaining twin", () => {
		const payload = structuredClone(businessPayload)
		delete (payload.quota_snapshots.premium_interactions as Record<string, unknown>).quota_remaining
		expect(parseCopilotQuota(payload, NOW)!.used).toBe(39390)
	})

	it("falls back to percent_remaining when counts are missing", () => {
		const q = parseCopilotQuota(
			{ quota_snapshots: { premium_interactions: { unlimited: false, percent_remaining: 40 } } },
			NOW,
		)!
		expect(q.used).toBeUndefined()
		expect(q.entitlement).toBeUndefined()
		expect(q.usedPercent).toBe(60)
	})

	it("reports unlimited plans without numbers", () => {
		const q = parseCopilotQuota(
			{ copilot_plan: "enterprise", quota_snapshots: { premium_interactions: { unlimited: true } } },
			NOW,
		)!
		expect(q).toMatchObject({ plan: "enterprise", unlimited: true })
		expect(q.usedPercent).toBeUndefined()
	})

	it("clamps over-consumption to 100%", () => {
		const q = parseCopilotQuota(
			{ quota_snapshots: { premium_interactions: { entitlement: 300, quota_remaining: -12 } } },
			NOW,
		)!
		expect(q.used).toBe(300)
		expect(q.usedPercent).toBe(100)
	})

	it("uses the date-only reset field when the UTC variant is absent", () => {
		const payload = { ...businessPayload, quota_reset_date_utc: undefined }
		expect(parseCopilotQuota(payload, NOW)!.resetAt).toBe(Date.parse("2026-11-01"))
	})

	it.each([null, undefined, "nope", [], {}, { quota_snapshots: {} }])("returns undefined for %j", (payload) => {
		expect(parseCopilotQuota(payload, NOW)).toBeUndefined()
	})
})
