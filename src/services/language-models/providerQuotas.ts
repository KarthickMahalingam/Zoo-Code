import {
	providerIdentifiers,
	type ProviderQuota,
	type ProviderQuotaWindow,
	type ProviderSettings,
} from "@roo-code/types"

import { getGitHubCopilotQuota } from "./copilotQuota"

/**
 * Live limits/balances for every connected provider that exposes a usage API,
 * for the Usage tab's "Provider limits" section.
 *
 * Endpoints are each provider own usage API. Credentials come from the
 * user's saved Zoo profiles and are sent only to that provider's own host.
 * Providers without a usage API are simply not listed.
 */

const REQUEST_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 60_000

const toNumber = (value: unknown): number | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) return value
	if (typeof value === "string" && value.trim() !== "") {
		const n = Number(value)
		return Number.isFinite(n) ? n : undefined
	}
	return undefined
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const money = (value: number, symbol = "$") => `${value < 0 ? "-" : ""}${symbol}${Math.abs(value).toFixed(2)}`

const credits = (value: number) =>
	value.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 })

const clampPct = (value: number) => Math.min(100, Math.max(0, value))

// Parsers (pure; unit-tested) ----------------------------------------------------------------------

/** OpenRouter `GET /api/v1/key` → key limit, or monthly spend when unlimited. */
export function parseOpenRouterKey(payload: unknown): ProviderQuotaWindow[] | undefined {
	const data = asRecord(asRecord(payload)?.data)
	if (!data) return undefined

	const limit = toNumber(data.limit)
	const remaining = toNumber(data.limit_remaining)

	if (limit !== undefined && limit > 0 && remaining !== undefined) {
		const used = Math.max(0, limit - remaining)
		return [
			{
				id: "key_limit",
				valueLabel: `${money(used)} / ${money(limit)} used`,
				usedPercent: clampPct((used / limit) * 100),
			},
		]
	}

	const usage = toNumber(data.usage_monthly) ?? toNumber(data.usage)
	return usage === undefined ? undefined : [{ id: "spend", valueLabel: `${money(usage)} spent this month` }]
}

/** DeepSeek `GET /user/balance` → prepaid balance (prefers a positive USD balance). */
export function parseDeepSeekBalance(payload: unknown): ProviderQuotaWindow[] | undefined {
	const infos = asRecord(payload)?.balance_infos
	if (!Array.isArray(infos) || infos.length === 0) return undefined

	const rows = infos.map(asRecord).filter((r): r is Record<string, unknown> => !!r)
	const pick =
		rows.find((r) => r.currency === "USD" && (toNumber(r.total_balance) ?? 0) > 0) ??
		rows.find((r) => r.currency === "CNY" && (toNumber(r.total_balance) ?? 0) > 0) ??
		rows.find((r) => r.currency === "USD") ??
		rows[0]

	const balance = toNumber(pick?.total_balance)
	if (balance === undefined) return undefined
	return [{ id: "balance", valueLabel: `${money(balance, pick?.currency === "CNY" ? "¥" : "$")} left` }]
}

/** Moonshot `GET /v1/users/me/balance` → available balance. */
export function parseMoonshotBalance(payload: unknown): ProviderQuotaWindow[] | undefined {
	const balance = toNumber(asRecord(asRecord(payload)?.data)?.available_balance)
	return balance === undefined ? undefined : [{ id: "balance", valueLabel: `${money(balance)} left` }]
}

// Fetchers ----------------------------------------------------------------------------------------

type Fetch = typeof fetch

async function getJson(fetchImpl: Fetch, url: string, apiKey: string): Promise<unknown> {
	const response = await fetchImpl(url, {
		method: "GET",
		headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})
	if (response.status === 401 || response.status === 403) throw new AuthError()
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	return response.json()
}

class AuthError extends Error {
	constructor() {
		super("Invalid or expired API key")
	}
}

interface KeyedProvider {
	providerId: string
	/** Returns the API key and optional base URL for this provider from a saved profile. */
	credentials: (s: ProviderSettings) => { apiKey?: string; baseUrl?: string }
	/** Only the provider's own default host is queried; custom gateways are skipped. */
	defaultBase: string
	path: string
	parse: (payload: unknown) => ProviderQuotaWindow[] | undefined
}

const KEYED_PROVIDERS: KeyedProvider[] = [
	{
		providerId: providerIdentifiers.openrouter,
		credentials: (s) => ({ apiKey: s.openRouterApiKey, baseUrl: s.openRouterBaseUrl }),
		defaultBase: "https://openrouter.ai/api/v1",
		path: "/key",
		parse: parseOpenRouterKey,
	},
	{
		providerId: providerIdentifiers.deepseek,
		credentials: (s) => ({ apiKey: s.deepSeekApiKey, baseUrl: s.deepSeekBaseUrl }),
		defaultBase: "https://api.deepseek.com",
		path: "/user/balance",
		parse: parseDeepSeekBalance,
	},
	{
		providerId: providerIdentifiers.moonshot,
		credentials: (s) => ({ apiKey: s.moonshotApiKey, baseUrl: s.moonshotBaseUrl }),
		defaultBase: "https://api.moonshot.ai/v1",
		path: "/users/me/balance",
		parse: parseMoonshotBalance,
	},
]

/** Providers this service can report on (used by the webview to decide what to show). */
export const QUOTA_PROVIDER_IDS = [
	providerIdentifiers.githubCopilot,
	...KEYED_PROVIDERS.map((p) => p.providerId),
] as string[]

const sameOrigin = (a: string, b: string) => {
	try {
		return new URL(a).origin === new URL(b).origin
	} catch {
		return false
	}
}

async function fetchKeyed(
	provider: KeyedProvider,
	profiles: ProviderSettings[],
	fetchImpl: Fetch,
): Promise<ProviderQuota> {
	const now = Date.now()
	const creds = profiles
		.filter((p) => p.apiProvider === provider.providerId)
		.map(provider.credentials)
		.find((c) => !!c.apiKey)

	if (!creds?.apiKey) return { providerId: provider.providerId, ok: false, reason: "noKey", fetchedAt: now }

	// SAFETY: never send a key to a host other than the provider's own API. A
	// profile pointed at a custom gateway is reported as unsupported instead.
	if (creds.baseUrl && !sameOrigin(creds.baseUrl, provider.defaultBase)) {
		return { providerId: provider.providerId, ok: false, reason: "unsupported", fetchedAt: now }
	}

	try {
		const windows = provider.parse(await getJson(fetchImpl, provider.defaultBase + provider.path, creds.apiKey))
		return windows?.length
			? { providerId: provider.providerId, ok: true, windows, fetchedAt: now }
			: { providerId: provider.providerId, ok: false, reason: "error", message: "No usage data", fetchedAt: now }
	} catch (error) {
		return {
			providerId: provider.providerId,
			ok: false,
			reason: error instanceof AuthError ? "noKey" : "error",
			message: error instanceof Error ? error.message : String(error),
			fetchedAt: now,
		}
	}
}

async function fetchCopilot(force: boolean): Promise<ProviderQuota> {
	const result = await getGitHubCopilotQuota({ force })
	const providerId = providerIdentifiers.githubCopilot
	if (!result.ok)
		return { providerId, ok: false, reason: result.reason, message: result.message, fetchedAt: Date.now() }

	const q = result.quota
	const window: ProviderQuotaWindow = q.unlimited
		? { id: "premium", valueLabel: "Unlimited", resetAt: q.resetAt }
		: {
				id: "premium",
				valueLabel:
					q.used !== undefined && q.entitlement !== undefined
						? `${credits(q.used)} / ${credits(q.entitlement)} used`
						: `${Math.round(q.usedPercent ?? 0)}% used`,
				usedPercent: q.usedPercent,
				resetAt: q.resetAt,
			}
	return { providerId, ok: true, plan: q.plan, windows: [window], fetchedAt: q.fetchedAt }
}

// Entry point -------------------------------------------------------------------------------------

let cache: { at: number; key: string; result: ProviderQuota[] } | undefined

/**
 * Quotas for every *connected* provider with a usage API. `profiles` are the
 * user's saved provider settings; only providers present there are queried.
 */
export async function getProviderQuotas(
	profiles: ProviderSettings[],
	{ force = false }: { force?: boolean } = {},
	fetchImpl: Fetch = fetch,
): Promise<ProviderQuota[]> {
	const connected = new Set(profiles.map((p) => p.apiProvider).filter(Boolean) as string[])
	const key = [...connected].sort().join(",")

	if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) return cache.result

	const tasks: Promise<ProviderQuota>[] = []
	if (connected.has(providerIdentifiers.githubCopilot)) tasks.push(fetchCopilot(force))
	for (const provider of KEYED_PROVIDERS) {
		if (connected.has(provider.providerId)) tasks.push(fetchKeyed(provider, profiles, fetchImpl))
	}

	const result = await Promise.all(tasks)
	cache = { at: Date.now(), key, result }
	return result
}

/** @internal test hook */
export function resetProviderQuotaCache() {
	cache = undefined
}
