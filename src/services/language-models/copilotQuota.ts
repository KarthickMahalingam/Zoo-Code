import * as vscode from "vscode"

import { githubCopilotLanguageModel, type GitHubCopilotQuota, type GitHubCopilotQuotaResult } from "@roo-code/types"

import { asRecord, clampPercent, roundToTenth, safeErrorMessage, toNumber } from "./quotaUtils"

/**
 * GitHub Copilot premium-request allowance for the Usage tab.
 *
 * Source: `GET https://api.github.com/copilot_internal/user`, the endpoint
 * Copilot Chat's own usage panel reads. It returns
 * `quota_snapshots.premium_interactions` plus `quota_reset_date`.
 *
 * Auth reuses the GitHub session VS Code already holds for Copilot (silent:
 * never prompts). The token is only ever sent to api.github.com.
 */

const COPILOT_USER_URL = "https://api.github.com/copilot_internal/user"
const REQUEST_TIMEOUT_MS = 15_000
/** Avoid hammering the endpoint when the Usage tab is reopened repeatedly. */
const CACHE_TTL_MS = 60_000

/**
 * Parses the endpoint payload. Pure, so it is unit-tested against recorded
 * shapes. Returns undefined when the payload has no premium snapshot at all.
 *
 * Semantics mirror Copilot Chat (CopilotUserQuotaInfo):
 * - `quota_remaining` is the precise (fractional) twin of `remaining`; prefer it.
 * - used = entitlement - remaining, so the figure matches GitHub's own panel.
 * - `percent_remaining` is a server-computed fallback when counts are missing.
 */
export function parseCopilotQuota(payload: unknown, now = Date.now()): GitHubCopilotQuota | undefined {
	const root = asRecord(payload)
	const snapshot = asRecord(asRecord(root?.quota_snapshots)?.premium_interactions)
	if (!root || !snapshot) return undefined

	const plan = typeof root.copilot_plan === "string" ? root.copilot_plan : undefined
	const resetRaw = root.quota_reset_date_utc ?? root.quota_reset_date
	const resetAt =
		typeof resetRaw === "string" && !Number.isNaN(Date.parse(resetRaw)) ? Date.parse(resetRaw) : undefined

	if (snapshot.unlimited === true) {
		return { plan, unlimited: true, resetAt, fetchedAt: now }
	}

	const entitlement = toNumber(snapshot.entitlement)
	const remaining = toNumber(snapshot.quota_remaining) ?? toNumber(snapshot.remaining)

	let used: number | undefined
	let usedPercent: number | undefined

	if (entitlement !== undefined && entitlement > 0 && remaining !== undefined) {
		used = roundToTenth(Math.min(entitlement, Math.max(0, entitlement - remaining)))
		usedPercent = clampPercent((used / entitlement) * 100)
	} else {
		const percentRemaining = toNumber(snapshot.percent_remaining)
		if (percentRemaining !== undefined) usedPercent = clampPercent(100 - percentRemaining)
	}

	return {
		plan,
		unlimited: false,
		entitlement: entitlement !== undefined && entitlement > 0 ? entitlement : undefined,
		used,
		usedPercent,
		resetAt,
		fetchedAt: now,
	}
}

async function getGitHubToken(): Promise<string | undefined> {
	const { authProviderId, authScopeSets } = githubCopilotLanguageModel
	for (const scopes of authScopeSets) {
		const session = await vscode.authentication.getSession(authProviderId, scopes, { silent: true })
		if (session) return session.accessToken
	}
	return undefined
}

let cache: { at: number; result: GitHubCopilotQuotaResult } | undefined
let inFlight: Promise<GitHubCopilotQuotaResult> | undefined

/**
 * Fetches the quota. Concurrent callers share one request; successful results
 * are cached briefly unless `force` is set (the Refresh button).
 */
export function getGitHubCopilotQuota(
	{ force = false }: { force?: boolean } = {},
	fetchImpl: typeof fetch = fetch,
): Promise<GitHubCopilotQuotaResult> {
	if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return Promise.resolve(cache.result)
	if (inFlight) return inFlight

	const fetchQuota = async (): Promise<GitHubCopilotQuotaResult> => {
		try {
			const token = await getGitHubToken()
			if (!token) return { ok: false, reason: "signedOut" }

			const response = await fetchImpl(COPILOT_USER_URL, {
				method: "GET",
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/json",
					"Editor-Version": `vscode/${vscode.version}`,
					"X-Github-Api-Version": "2025-04-01",
				},
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			})

			if (response.status === 401) return { ok: false, reason: "signedOut" }
			if (response.status === 403 || response.status === 404) return { ok: false, reason: "noCopilot" }
			if (!response.ok) return { ok: false, reason: "error", message: `GitHub API error ${response.status}` }

			const quota = parseCopilotQuota(await response.json())
			return quota ? { ok: true, quota } : { ok: false, reason: "noCopilot" }
		} catch (error) {
			return { ok: false, reason: "error", message: safeErrorMessage(error) }
		}
	}

	inFlight = fetchQuota()
		.then((result) => {
			// One place for every outcome: a success is cached, and anything else (signed out, no Copilot, an
			// HTTP error, a thrown error) drops an older success so it is not served as if it were current.
			cache = result.ok ? { at: Date.now(), result } : undefined
			return result
		})
		.finally(() => {
			inFlight = undefined
		})

	return inFlight
}

/** @internal test hook */
export function resetGitHubCopilotQuotaCache() {
	cache = undefined
	inFlight = undefined
}
