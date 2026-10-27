import { useEffect, useState } from "react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { sanitizeFontFamily, type SpacingDensity } from "@/utils/appearance"

import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui"

/**
 * Curated presets. Each stack ends in a generic family so an uninstalled font
 * degrades gracefully. `DEFAULT` = no override (inherit from VS Code).
 */
const DEFAULT = "__default__"
const CUSTOM = "__custom__"

export const INTERFACE_FONT_PRESETS = [
	{ id: "system", label: "System UI", stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
	{ id: "inter", label: "Inter", stack: "Inter, system-ui, sans-serif" },
	{ id: "sf", label: "SF Pro", stack: "'SF Pro Text', -apple-system, sans-serif" },
	{ id: "segoe", label: "Segoe UI", stack: "'Segoe UI', system-ui, sans-serif" },
	{ id: "roboto", label: "Roboto", stack: "Roboto, system-ui, sans-serif" },
	{ id: "helvetica", label: "Helvetica Neue", stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
	{ id: "georgia", label: "Georgia (serif)", stack: "Georgia, 'Times New Roman', serif" },
] as const

export const CODE_FONT_PRESETS = [
	{ id: "sfmono", label: "SF Mono", stack: "'SF Mono', SFMono-Regular, Menlo, monospace" },
	{ id: "menlo", label: "Menlo", stack: "Menlo, Monaco, monospace" },
	{ id: "jetbrains", label: "JetBrains Mono", stack: "'JetBrains Mono', Menlo, monospace" },
	{ id: "fira", label: "Fira Code", stack: "'Fira Code', Menlo, monospace" },
	{ id: "cascadia", label: "Cascadia Code", stack: "'Cascadia Code', Consolas, monospace" },
	{ id: "consolas", label: "Consolas", stack: "Consolas, 'Courier New', monospace" },
] as const

type Preset = { id: string; label: string; stack: string }

/** Maps a stored stack back to its preset id, "custom", or the default. */
export function presetIdFor(value: string | undefined, presets: readonly Preset[]): string {
	if (!value) return DEFAULT
	return presets.find((p) => p.stack === value)?.id ?? CUSTOM
}

interface FontPresetSelectProps {
	label: string
	description: string
	/** Label for the "inherit" option, e.g. "Match VS Code". */
	defaultLabel: string
	customLabel: string
	customPlaceholder: string
	invalidMessage: string
	presets: readonly Preset[]
	value?: string
	onChange: (value: string | undefined) => void
	testId: string
}

/**
 * Font picker: inherit / curated presets / custom. Each option renders in its
 * own face so users see the font before choosing. The free-text input only
 * appears for "Custom…", and only sanitized values are committed.
 */
export const FontPresetSelect = ({
	label,
	description,
	defaultLabel,
	customLabel,
	customPlaceholder,
	invalidMessage,
	presets,
	value,
	onChange,
	testId,
}: FontPresetSelectProps) => {
	const [selected, setSelected] = useState(() => presetIdFor(value, presets))
	const [draft, setDraft] = useState(selected === CUSTOM ? (value ?? "") : "")

	// Re-sync when the persisted value changes underneath us (reset/import),
	// but don't kick the user out of "Custom…" while they're typing.
	useEffect(() => {
		const next = presetIdFor(value, presets)
		if (next !== CUSTOM || selected !== CUSTOM) setSelected(next)
		if (next === CUSTOM) setDraft(value ?? "")
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value, presets])

	const handleSelect = (id: string) => {
		setSelected(id)
		if (id === DEFAULT) onChange(undefined)
		else if (id !== CUSTOM) onChange(presets.find((p) => p.id === id)?.stack)
		// Custom: wait for valid input before committing.
	}

	const trimmed = draft.trim()
	const isInvalid = selected === CUSTOM && trimmed.length > 0 && sanitizeFontFamily(trimmed) === undefined

	const handleDraft = (next: string) => {
		setDraft(next)
		const safe = sanitizeFontFamily(next)
		if (!next.trim()) onChange(undefined)
		else if (safe) onChange(safe)
	}

	return (
		<div className="flex flex-col gap-1">
			<label className="block font-medium mb-1">{label}</label>
			<Select value={selected} onValueChange={handleSelect}>
				<SelectTrigger className="w-full" data-testid={`${testId}-select`}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={DEFAULT}>{defaultLabel}</SelectItem>
					<div role="separator" className="my-1 h-px bg-vscode-dropdown-border" />
					{presets.map((p) => (
						<SelectItem key={p.id} value={p.id}>
							<span style={{ fontFamily: p.stack }}>{p.label}</span>
						</SelectItem>
					))}
					<div role="separator" className="my-1 h-px bg-vscode-dropdown-border" />
					<SelectItem value={CUSTOM}>{customLabel}</SelectItem>
				</SelectContent>
			</Select>

			{selected === CUSTOM && (
				<Input
					className="mt-2"
					value={draft}
					placeholder={customPlaceholder}
					spellCheck={false}
					autoFocus
					aria-invalid={isInvalid}
					onChange={(e) => handleDraft(e.target.value)}
					data-testid={`${testId}-custom-input`}
				/>
			)}

			<div
				className={cn(
					"text-sm mt-1",
					isInvalid ? "text-vscode-errorForeground" : "text-vscode-descriptionForeground",
				)}
				data-testid={isInvalid ? `${testId}-error` : undefined}>
				{isInvalid ? invalidMessage : description}
			</div>
		</div>
	)
}

const DENSITY_PADDING: Record<SpacingDensity, { py: number; px: number }> = {
	compact: { py: 5, px: 10 },
	comfortable: { py: 10, px: 15 },
	spacious: { py: 16, px: 18 },
}

interface AppearancePreviewProps {
	interfaceFontFamily?: string
	codeFontFamily?: string
	chatFontSize?: number
	spacingDensity: SpacingDensity
}

/**
 * Live preview of chat appearance using the *unsaved* settings, applied
 * inline so it updates instantly without touching the real chat.
 */
export const AppearancePreview = ({
	interfaceFontFamily,
	codeFontFamily,
	chatFontSize,
	spacingDensity,
}: AppearancePreviewProps) => {
	const { t } = useAppTranslation()
	const { py, px } = DENSITY_PADDING[spacingDensity]

	const rowStyle = { padding: `${py}px ${px}px` }
	const textStyle = {
		fontFamily: sanitizeFontFamily(interfaceFontFamily) ?? "var(--vscode-font-family)",
		fontSize: chatFontSize ? `${chatFontSize}px` : "var(--vscode-font-size)",
	}
	const codeStyle = {
		fontFamily: sanitizeFontFamily(codeFontFamily) ?? "var(--vscode-editor-font-family, monospace)",
		fontSize: "0.85em",
	}

	return (
		<div
			className="rounded-md border border-vscode-panel-border bg-vscode-editor-background overflow-hidden"
			aria-label={t("settings:ui.preview.label")}
			data-testid="appearance-preview">
			<div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-vscode-descriptionForeground border-b border-vscode-panel-border">
				{t("settings:ui.preview.label")}
			</div>
			<div style={{ ...rowStyle, ...textStyle }} className="border-b border-vscode-panel-border">
				<div className="text-[0.85em] text-vscode-descriptionForeground mb-1">
					{t("settings:ui.preview.you")}
				</div>
				<div>{t("settings:ui.preview.userMessage")}</div>
			</div>
			<div style={{ ...rowStyle, ...textStyle }}>
				<div className="text-[0.85em] text-vscode-descriptionForeground mb-1">
					{t("settings:ui.preview.zoo")}
				</div>
				<div>
					{t("settings:ui.preview.assistantBefore")}{" "}
					<code
						style={codeStyle}
						className="px-1 rounded bg-vscode-textCodeBlock-background text-vscode-textPreformat-foreground">
						Edge.tsx
					</code>{" "}
					{t("settings:ui.preview.assistantAfter")}
				</div>
				<pre
					style={{ ...codeStyle, margin: `${Math.max(4, py / 2)}px 0 0` }}
					className="p-2 rounded bg-vscode-textCodeBlock-background overflow-x-auto">
					{"const stroke = selected ? 2 : 1"}
				</pre>
			</div>
		</div>
	)
}
