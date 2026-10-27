import { HTMLAttributes, useMemo, useState } from "react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"
import { vscode } from "@src/utils/vscode"
import { formatLargeNumber, formatTimeAgo } from "@src/utils/format"
import { USAGE_RANGES, type UsageRange, summarizeUsage, usageToCsv } from "@src/utils/usage"
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

const formatCost = (cost: number) => `$${cost.toFixed(2)}`

/**
 * Usage tab: read-only rollup of locally persisted task history. No network
 * calls and no new persisted state, so it is safe to ship independently of
 * any provider-quota integration.
 */
export const UsageSettings = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => {
	const { t } = useAppTranslation()
	const { taskHistory, cwd } = useExtensionState()

	const [range, setRange] = useState<UsageRange>("7d")
	const [scope, setScope] = useState<"workspace" | "all">("workspace")

	const workspace = scope === "workspace" ? cwd : undefined
	const summary = useMemo(
		() => summarizeUsage(taskHistory ?? [], { range, workspace }),
		[taskHistory, range, workspace],
	)

	const maxDaily = Math.max(0, ...summary.daily.map((d) => d.cost))
	const isEmpty = summary.taskCount === 0

	const handleExport = () => {
		const csv = usageToCsv(taskHistory ?? [], { range, workspace })
		const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
		const a = document.createElement("a")
		a.href = url
		a.download = `zoo-usage-${range}.csv`
		a.click()
		URL.revokeObjectURL(url)
	}

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader description={t("settings:usage.description")}>{t("settings:sections.usage")}</SectionHeader>

			<Section>
				<SearchableSetting settingId="usage-filters" section="usage" label={t("settings:usage.range.label")}>
					<div
						className="flex flex-wrap gap-2"
						role="radiogroup"
						aria-label={t("settings:usage.range.label")}>
						{USAGE_RANGES.map((r) => (
							<Button
								key={r}
								size="sm"
								variant={r === range ? "primary" : "secondary"}
								role="radio"
								aria-checked={r === range}
								onClick={() => setRange(r)}
								data-testid={`usage-range-${r}`}>
								{t(`settings:usage.range.${r}`)}
							</Button>
						))}
					</div>
					<div className="flex items-center gap-2 mt-3">
						<span className="text-vscode-descriptionForeground text-sm">
							{t("settings:usage.scope.label")}
						</span>
						<Select value={scope} onValueChange={(v) => setScope(v as "workspace" | "all")}>
							<SelectTrigger className="w-48" data-testid="usage-scope-select">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="workspace">{t("settings:usage.scope.workspace")}</SelectItem>
								<SelectItem value="all">{t("settings:usage.scope.all")}</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</SearchableSetting>

				{isEmpty ? (
					<div className="text-vscode-descriptionForeground py-6" data-testid="usage-empty">
						{t("settings:usage.empty")}
					</div>
				) : (
					<>
						{/* Stat cards */}
						<div className="grid grid-cols-3 gap-2" data-testid="usage-stats">
							<StatCard value={formatCost(summary.totalCost)} label={t("settings:usage.stats.cost")} />
							<StatCard
								value={formatLargeNumber(summary.totalTokens)}
								label={t("settings:usage.stats.tokens")}
								hint={t("settings:usage.stats.cacheHit", {
									percent: Math.round(summary.cacheHitRate * 100),
								})}
							/>
							<StatCard value={String(summary.taskCount)} label={t("settings:usage.stats.tasks")} />
						</div>

						{/* Daily cost chart */}
						{summary.daily.length > 1 && (
							<div className="mt-4">
								<h4 className="text-xs font-semibold uppercase tracking-wide text-vscode-descriptionForeground mb-2">
									{t("settings:usage.dailyCost")}
								</h4>
								<div className="flex items-end gap-[2px] h-16" data-testid="usage-daily-chart">
									{summary.daily.map((d) => (
										<div
											key={d.day}
											className="flex-1 bg-vscode-button-background rounded-t-sm min-h-[2px]"
											style={{ height: maxDaily > 0 ? `${(d.cost / maxDaily) * 100}%` : "2px" }}
											title={`${new Date(d.day).toLocaleDateString()} · ${formatCost(d.cost)}`}
										/>
									))}
								</div>
							</div>
						)}

						<Breakdown
							title={t("settings:usage.byProfile")}
							buckets={summary.byProfile}
							total={summary.totalCost}
							testId="usage-by-profile"
						/>
						<Breakdown
							title={t("settings:usage.byMode")}
							buckets={summary.byMode}
							total={summary.totalCost}
							testId="usage-by-mode"
						/>

						{/* Top tasks */}
						<div className="mt-4" data-testid="usage-top-tasks">
							<h4 className="text-xs font-semibold uppercase tracking-wide text-vscode-descriptionForeground mb-2">
								{t("settings:usage.topTasks")}
							</h4>
							{summary.topTasks.map((task) => (
								<button
									key={task.id}
									type="button"
									className="w-full flex justify-between gap-2 py-1.5 border-b border-vscode-panel-border text-left bg-transparent hover:bg-vscode-list-hoverBackground cursor-pointer"
									onClick={() => vscode.postMessage({ type: "showTaskWithId", text: task.id })}>
									<span className="truncate">{task.title || task.task}</span>
									<span className="shrink-0 text-vscode-descriptionForeground">
										<span className="text-vscode-foreground font-medium">
											{formatCost(task.totalCost || 0)}
										</span>
										{" · "}
										{formatTimeAgo(task.ts)}
									</span>
								</button>
							))}
						</div>

						<div className="mt-4 flex items-center justify-between gap-2">
							<span className="text-vscode-descriptionForeground text-xs">
								{t("settings:usage.disclaimer")}
							</span>
							<Button variant="secondary" size="sm" onClick={handleExport} data-testid="usage-export-csv">
								{t("settings:usage.exportCsv")}
							</Button>
						</div>
					</>
				)}
			</Section>
		</div>
	)
}

const StatCard = ({ value, label, hint }: { value: string; label: string; hint?: string }) => (
	<div className="rounded-md border border-vscode-panel-border bg-vscode-editor-background p-2">
		<div className="text-lg font-semibold text-vscode-foreground">{value}</div>
		<div className="text-xs text-vscode-descriptionForeground">{label}</div>
		{hint && <div className="text-xs text-vscode-descriptionForeground mt-1">{hint}</div>}
	</div>
)

const Breakdown = ({
	title,
	buckets,
	total,
	testId,
}: {
	title: string
	buckets: { key: string; cost: number }[]
	total: number
	testId: string
}) => (
	<div className="mt-4" data-testid={testId}>
		<h4 className="text-xs font-semibold uppercase tracking-wide text-vscode-descriptionForeground mb-2">
			{title}
		</h4>
		{buckets.slice(0, 6).map((b) => {
			const pct = total > 0 ? Math.round((b.cost / total) * 100) : 0
			return (
				<div key={b.key} className="grid grid-cols-[minmax(0,1fr)_56px_80px_36px] items-center gap-2 mb-1.5">
					<span className="truncate">{b.key}</span>
					<span className="text-right">{formatCost(b.cost)}</span>
					<span className="h-1.5 rounded bg-vscode-input-background overflow-hidden">
						<span className="block h-full bg-vscode-button-background" style={{ width: `${pct}%` }} />
					</span>
					<span className="text-right text-xs text-vscode-descriptionForeground">{pct}%</span>
				</div>
			)
		})}
	</div>
)
