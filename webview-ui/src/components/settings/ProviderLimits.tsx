import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"

import { VsCodeLmModelsMessageType, type ProviderQuota } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { vscode } from "@src/utils/vscode"
import { providerLabel } from "@src/utils/providerLabel"

const formatReset = (ts: number) =>
	new Date(ts).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" })

const barColor = (pct: number) =>
	pct >= 90 ? "bg-vscode-charts-red" : pct >= 75 ? "bg-vscode-charts-yellow" : "bg-vscode-charts-green"

/**
 * "Provider limits": live credits/balances for every connected provider that
 * exposes a usage API (GitHub Copilot, OpenRouter, DeepSeek, Moonshot), one
 * compact row each. Fetched by the extension host; keys never reach the webview.
 */
export const ProviderLimits = () => {
	const { t } = useAppTranslation()
	const [quotas, setQuotas] = useState<ProviderQuota[] | undefined>()
	const [loading, setLoading] = useState(true)

	const request = useCallback((force: boolean) => {
		setLoading(true)
		vscode.postMessage({ type: VsCodeLmModelsMessageType.requestProviderQuotas, bool: force })
	}, [])

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.data?.type === VsCodeLmModelsMessageType.providerQuotas) {
				setQuotas(event.data.providerQuotas ?? [])
				setLoading(false)
			}
		}
		window.addEventListener("message", onMessage)
		request(false)
		return () => window.removeEventListener("message", onMessage)
	}, [request])

	// Nothing connected that has a usage API: hide the section entirely.
	if (quotas && quotas.length === 0) return null

	const fetchedAt = quotas?.reduce((max, q) => Math.max(max, q.fetchedAt), 0)

	return (
		<section data-testid="provider-limits">
			<div className="flex items-center justify-between mb-2">
				<h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-vscode-descriptionForeground">
					{t("settings:usage.limits.title")}
				</h4>
				<button
					type="button"
					className="flex items-center gap-1.5 text-xs text-vscode-descriptionForeground hover:text-vscode-foreground bg-transparent cursor-pointer disabled:cursor-default"
					onClick={() => request(true)}
					disabled={loading}
					aria-label={t("settings:usage.limits.refresh")}
					data-testid="provider-limits-refresh">
					{fetchedAt ? (
						<span>
							{t("settings:usage.limits.updated", {
								time: new Date(fetchedAt).toLocaleTimeString(undefined, {
									hour: "numeric",
									minute: "2-digit",
								}),
							})}
						</span>
					) : null}
					<RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
				</button>
			</div>

			<div className="rounded-md border border-vscode-panel-border divide-y divide-vscode-panel-border">
				{!quotas && (
					<div className="px-3 py-2.5 text-sm text-vscode-descriptionForeground">
						{t("settings:usage.limits.loading")}
					</div>
				)}
				{quotas?.map((q) => (
					<QuotaRow key={q.providerId} quota={q} name={providerLabel(q.providerId)} />
				))}
			</div>
		</section>
	)
}

const QuotaRow = ({ quota, name }: { quota: ProviderQuota; name: string }) => {
	const { t } = useAppTranslation()

	return (
		<div className="px-3 py-2.5" data-testid={`provider-limit-${quota.providerId}`}>
			<div className="flex items-center gap-2">
				<span
					className={cn(
						"size-1.5 rounded-full shrink-0",
						quota.ok ? "bg-vscode-charts-green" : "bg-vscode-descriptionForeground",
					)}
				/>
				<span className="text-sm font-medium truncate">{name}</span>
				{quota.ok && quota.plan && (
					<span className="text-xs text-vscode-descriptionForeground capitalize">{quota.plan}</span>
				)}
				{!quota.ok && (
					<span className="ml-auto text-xs text-vscode-descriptionForeground truncate">
						{t(`settings:usage.limits.${quota.reason}`)}
					</span>
				)}
			</div>

			{quota.ok &&
				quota.windows.map((w) => (
					<div key={w.id} className="mt-1.5 pl-3.5">
						<div className="flex items-baseline justify-between gap-2 text-xs">
							<span className="tabular-nums text-vscode-foreground">{w.valueLabel}</span>
							{w.usedPercent !== undefined && (
								<span className="tabular-nums text-vscode-descriptionForeground">
									{Math.round(w.usedPercent)}%
								</span>
							)}
						</div>
						{w.usedPercent !== undefined && (
							<div
								className="h-1 mt-1 rounded-full bg-vscode-input-background overflow-hidden"
								role="progressbar"
								aria-valuenow={Math.round(w.usedPercent)}
								aria-valuemin={0}
								aria-valuemax={100}>
								<div
									className={cn("h-full rounded-full", barColor(w.usedPercent))}
									style={{ width: `${w.usedPercent}%` }}
								/>
							</div>
						)}
						{w.resetAt && (
							<div className="mt-1 text-[11px] text-vscode-descriptionForeground">
								{t("settings:usage.limits.resets", { date: formatReset(w.resetAt) })}
							</div>
						)}
					</div>
				))}
		</div>
	)
}
