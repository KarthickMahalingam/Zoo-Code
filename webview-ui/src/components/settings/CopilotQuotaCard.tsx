import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"

import { VsCodeLmModelsMessageType, type GitHubCopilotQuotaResult } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { vscode } from "@src/utils/vscode"

const formatCredits = (value: number) =>
	value.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 })

const formatReset = (ts: number) =>
	new Date(ts).toLocaleString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})

/**
 * GitHub Copilot premium-request credits (used / total, % bar, reset date),
 * fetched by the extension host from the same endpoint Copilot's own usage
 * panel reads. Only rendered when the user has a Copilot profile.
 */
export const CopilotQuotaCard = () => {
	const { t } = useAppTranslation()
	const [result, setResult] = useState<GitHubCopilotQuotaResult | undefined>()
	const [loading, setLoading] = useState(true)

	const request = useCallback((force: boolean) => {
		setLoading(true)
		vscode.postMessage({ type: VsCodeLmModelsMessageType.requestGithubCopilotQuota, bool: force })
	}, [])

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const message = event.data
			if (message?.type === VsCodeLmModelsMessageType.githubCopilotQuota) {
				setResult(message.githubCopilotQuota)
				setLoading(false)
			}
		}
		window.addEventListener("message", onMessage)
		request(false)
		return () => window.removeEventListener("message", onMessage)
	}, [request])

	const quota = result?.ok ? result.quota : undefined
	const pct = quota?.usedPercent ?? 0
	const barColor =
		pct >= 90 ? "bg-vscode-charts-red" : pct >= 75 ? "bg-vscode-charts-yellow" : "bg-vscode-charts-green"

	return (
		<div
			className="rounded-md border border-vscode-panel-border bg-vscode-input-background p-3 mb-4"
			data-testid="copilot-quota-card">
			<div className="flex items-center justify-between gap-2 mb-2">
				<div className="flex items-center gap-2 min-w-0">
					<span
						className={cn(
							"size-2 rounded-full shrink-0",
							quota ? "bg-vscode-charts-green" : "bg-vscode-descriptionForeground",
						)}
					/>
					<span className="font-medium truncate">{t("settings:usage.copilot.title")}</span>
					{quota?.plan && (
						<span className="text-xs text-vscode-descriptionForeground capitalize">· {quota.plan}</span>
					)}
				</div>
				<button
					type="button"
					className="flex items-center gap-1 text-xs text-vscode-descriptionForeground hover:text-vscode-foreground cursor-pointer bg-transparent"
					onClick={() => request(true)}
					disabled={loading}
					aria-label={t("settings:usage.copilot.refresh")}
					data-testid="copilot-quota-refresh">
					<RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
					{quota &&
						t("settings:usage.copilot.updated", {
							time: new Date(quota.fetchedAt).toLocaleTimeString(undefined, {
								hour: "numeric",
								minute: "2-digit",
							}),
						})}
				</button>
			</div>

			{loading && !result && (
				<div className="text-sm text-vscode-descriptionForeground">{t("settings:usage.copilot.loading")}</div>
			)}

			{result && !result.ok && (
				<div className="text-sm text-vscode-descriptionForeground" data-testid="copilot-quota-unavailable">
					{t(`settings:usage.copilot.${result.reason}`)}
					{result.reason === "error" && result.message ? ` (${result.message})` : ""}
				</div>
			)}

			{quota && quota.unlimited && <div className="text-sm">{t("settings:usage.copilot.unlimited")}</div>}

			{quota && !quota.unlimited && (
				<>
					<div className="flex items-baseline justify-between gap-2 text-sm">
						<span>{t("settings:usage.copilot.credits")}</span>
						<span className="tabular-nums" data-testid="copilot-quota-used">
							{quota.used !== undefined && quota.entitlement !== undefined
								? t("settings:usage.copilot.usedOf", {
										used: formatCredits(quota.used),
										total: formatCredits(quota.entitlement),
									})
								: `${Math.round(pct)}%`}
						</span>
					</div>
					<div
						className="h-1.5 rounded bg-vscode-editor-background overflow-hidden mt-1.5"
						role="progressbar"
						aria-valuenow={Math.round(pct)}
						aria-valuemin={0}
						aria-valuemax={100}>
						<div className={cn("h-full", barColor)} style={{ width: `${pct}%` }} />
					</div>
					<div className="flex justify-between gap-2 mt-1.5 text-xs text-vscode-descriptionForeground">
						<span>
							{quota.resetAt
								? t("settings:usage.copilot.resets", { date: formatReset(quota.resetAt) })
								: ""}
						</span>
						<span className="tabular-nums">
							{t("settings:usage.copilot.percentUsed", { percent: Math.round(pct) })}
						</span>
					</div>
				</>
			)}
		</div>
	)
}
