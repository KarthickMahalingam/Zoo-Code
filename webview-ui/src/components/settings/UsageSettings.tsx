import { HTMLAttributes, useMemo, useState } from "react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"
import { vscode } from "@src/utils/vscode"
import { formatLargeNumber, formatTimeAgo } from "@src/utils/format"
import {
	USAGE_RANGES,
	type UsageMetric,
	type UsageRange,
	pickMetric,
	summarizeUsage,
	usageToCsv,
} from "@src/utils/usage"
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

const formatCost = (cost: number) => `$${cost.toFixed(2)}`

const PALETTE = [
	"var(--vscode-charts-blue)",
	"var(--vscode-charts-purple)",
	"var(--vscode-charts-green)",
	"var(--vscode-charts-orange)",
	"var(--vscode-charts-yellow)",
	"var(--vscode-charts-red)",
]

const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "narrow" })
const DAY_FMT = new Intl.DateTimeFormat(undefined, { day: "numeric" })

/**
 * Usage tab: read-only rollup of locally persisted task history. No network
 * calls and no new persisted state.
 *
 * Subscription providers (GitHub Copilot / VS Code LM) report $0 per task, so
 * when the selected range has tokens but no cost the tab switches its charts
 * and breakdowns to tokens and explains why.
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

	const metric: UsageMetric = pickMetric(summary)
	const value = (cost: number, tokens: number) => (metric === "cost" ? cost : tokens)
	const fmt = (cost: number, tokens: number) => (metric === "cost" ? formatCost(cost) : formatLargeNumber(tokens))
	const total = value(summary.totalCost, summary.totalTokens)

	const maxDaily = Math.max(0, ...summary.daily.map((d) => value(d.cost, d.tokens)))
	const showDayLabels = summary.daily.length <= 14
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
					{/* Segmented range control */}
					<div
						className="inline-flex rounded-md border border-vscode-input-border overflow-hidden"
						role="radiogroup"
						aria-label={t("settings:usage.range.label")}>
						{USAGE_RANGES.map((r) => (
							<button
								key={r}
								type="button"
								role="radio"
								aria-checked={r === range}
								onClick={() => setRange(r)}
								data-testid={`usage-range-${r}`}
								className={cn(
									"px-3 py-1 text-sm border-r border-vscode-input-border last:border-r-0 cursor-pointer",
									r === range
										? "bg-vscode-button-background text-vscode-button-foreground"
										: "bg-vscode-input-background text-vscode-foreground hover:bg-vscode-list-hoverBackground",
								)}>
								{t(`settings:usage.range.${r}`)}
							</button>
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
							<StatCard
								value={formatCost(summary.totalCost)}
								label={t("settings:usage.stats.cost")}
								hint={metric === "tokens" ? t("settings:usage.stats.noPricing") : undefined}
							/>
							<StatCard
								value={formatLargeNumber(summary.totalTokens)}
								label={t("settings:usage.stats.tokens")}
								hint={
									summary.cacheReads > 0
										? t("settings:usage.stats.cacheHit", {
												percent: Math.round(summary.cacheHitRate * 100),
											})
										: t("settings:usage.stats.inOut", {
												input: formatLargeNumber(summary.tokensIn),
												output: formatLargeNumber(summary.tokensOut),
											})
								}
							/>
							<StatCard value={String(summary.taskCount)} label={t("settings:usage.stats.tasks")} />
						</div>

						{metric === "tokens" && (
							<div
								className="mt-3 text-xs text-vscode-descriptionForeground border-l-2 border-vscode-focusBorder pl-2"
								data-testid="usage-no-pricing-note">
								{t("settings:usage.noPricingNote")}
							</div>
						)}

						{/* Daily chart */}
						{summary.daily.length > 1 && (
							<div className="mt-5">
								<SubHeading>
									{metric === "cost"
										? t("settings:usage.dailyCost")
										: t("settings:usage.dailyTokens")}
								</SubHeading>
								<div className="flex items-end gap-1 h-20" data-testid="usage-daily-chart">
									{summary.daily.map((d) => {
										const v = value(d.cost, d.tokens)
										return (
											<div
												key={d.day}
												className={cn(
													"flex-1 rounded-t-sm",
													v > 0 ? "bg-vscode-charts-blue" : "bg-vscode-input-background",
												)}
												style={{
													height:
														maxDaily > 0 && v > 0
															? `${Math.max(4, (v / maxDaily) * 100)}%`
															: "3px",
												}}
												title={`${new Date(d.day).toLocaleDateString()} · ${fmt(d.cost, d.tokens)}`}
											/>
										)
									})}
								</div>
								{showDayLabels && (
									<div className="flex gap-1 mt-1 text-[10px] text-vscode-descriptionForeground">
										{summary.daily.map((d) => (
											<span key={d.day} className="flex-1 text-center">
												{summary.daily.length <= 7
													? WEEKDAY_FMT.format(d.day)
													: DAY_FMT.format(d.day)}
											</span>
										))}
									</div>
								)}
							</div>
						)}

						<Breakdown
							title={t("settings:usage.byProfile")}
							rows={summary.byProfile.map((b) => ({
								key: b.key,
								value: value(b.cost, b.tokens),
								label: fmt(b.cost, b.tokens),
							}))}
							total={total}
							testId="usage-by-profile"
						/>
						<Breakdown
							title={t("settings:usage.byMode")}
							rows={summary.byMode.map((b) => ({
								key: b.key,
								value: value(b.cost, b.tokens),
								label: fmt(b.cost, b.tokens),
							}))}
							total={total}
							testId="usage-by-mode"
						/>

						{/* Top tasks */}
						<div className="mt-5" data-testid="usage-top-tasks">
							<SubHeading>
								{metric === "cost" ? t("settings:usage.topTasks") : t("settings:usage.topTasksTokens")}
							</SubHeading>
							{summary.topTasks.map((task) => (
								<button
									key={task.id}
									type="button"
									className="w-full flex items-center justify-between gap-3 py-1.5 border-b border-vscode-panel-border text-left bg-transparent hover:bg-vscode-list-hoverBackground cursor-pointer"
									onClick={() => vscode.postMessage({ type: "showTaskWithId", text: task.id })}>
									<span className="min-w-0 truncate">{task.task}</span>
									<span className="shrink-0 whitespace-nowrap text-vscode-descriptionForeground text-xs">
										<span className="text-vscode-foreground font-medium text-sm">
											{fmt(task.totalCost || 0, (task.tokensIn || 0) + (task.tokensOut || 0))}
										</span>
										{" · "}
										{formatTimeAgo(task.ts)}
										{" ›"}
									</span>
								</button>
							))}
						</div>

						<div className="mt-5 flex flex-col gap-2">
							<Button
								className="self-start"
								variant="secondary"
								size="sm"
								onClick={handleExport}
								data-testid="usage-export-csv">
								{t("settings:usage.exportCsv")}
							</Button>
							<span className="text-vscode-descriptionForeground text-xs">
								{t("settings:usage.disclaimer")}
							</span>
						</div>
					</>
				)}
			</Section>
		</div>
	)
}

const SubHeading = ({ children }: { children: React.ReactNode }) => (
	<h4 className="text-xs font-semibold uppercase tracking-wide text-vscode-descriptionForeground mt-0 mb-2 pt-4 border-t border-vscode-panel-border">
		{children}
	</h4>
)

const StatCard = ({ value, label, hint }: { value: string; label: string; hint?: string }) => (
	<div className="min-w-0 rounded-md border border-vscode-panel-border bg-vscode-input-background p-2">
		<div className="text-lg font-semibold text-vscode-foreground truncate">{value}</div>
		<div className="text-xs text-vscode-descriptionForeground">{label}</div>
		{hint && <div className="text-[11px] text-vscode-descriptionForeground mt-1 truncate">{hint}</div>}
	</div>
)

const Breakdown = ({
	title,
	rows,
	total,
	testId,
}: {
	title: string
	rows: { key: string; value: number; label: string }[]
	total: number
	testId: string
}) => (
	<div className="mt-5" data-testid={testId}>
		<SubHeading>{title}</SubHeading>
		{rows.slice(0, 6).map((row, i) => {
			const pct = total > 0 ? Math.round((row.value / total) * 100) : 0
			const color = PALETTE[i % PALETTE.length]
			return (
				<div
					key={row.key}
					className="grid grid-cols-[10px_minmax(0,1fr)_auto_minmax(48px,72px)_32px] items-center gap-2 mb-1.5 text-sm">
					<span className="size-2 rounded-full" style={{ background: color }} />
					<span className="truncate">{row.key}</span>
					<span className="text-right tabular-nums">{row.label}</span>
					<span className="h-1.5 rounded bg-vscode-input-background overflow-hidden">
						<span className="block h-full" style={{ width: `${pct}%`, background: color }} />
					</span>
					<span className="text-right text-xs text-vscode-descriptionForeground tabular-nums">{pct}%</span>
				</div>
			)
		})}
	</div>
)
