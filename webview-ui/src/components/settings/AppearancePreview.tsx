import type { CSSProperties } from "react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { APPEARANCE_SETTINGS, clampAppearance, type AppearanceKey } from "@/utils/appearance"

interface AppearancePreviewProps {
	values: Partial<Record<AppearanceKey, number | undefined>>
	chatFontSize?: number
}

/**
 * Live preview of the appearance settings using the *unsaved* values.
 *
 * It sets the same CSS custom properties the real UI reads, but only on this
 * element, so the sample updates on every stepper click without touching the
 * rest of the webview until the user presses Save.
 */
export const AppearancePreview = ({ values, chatFontSize }: AppearancePreviewProps) => {
	const { t } = useAppTranslation()

	const vars: Record<string, string> = {}
	for (const key of Object.keys(APPEARANCE_SETTINGS) as AppearanceKey[]) {
		const setting = APPEARANCE_SETTINGS[key]
		const v = clampAppearance(key, values[key]) ?? setting.fallback
		vars[setting.cssVar] = setting.toCss(v)
	}
	if (chatFontSize) vars["--zoo-chat-font-size"] = `${chatFontSize}px`

	const uiText: CSSProperties = {
		fontSize: "calc(var(--zoo-chat-font-size, var(--vscode-font-size)) * var(--zoo-ui-scale))",
	}
	const row: CSSProperties = {
		padding: "calc(10px * var(--zoo-spacing-scale)) calc(15px * var(--zoo-spacing-scale))",
	}
	const mono: CSSProperties = {
		fontFamily: "var(--vscode-editor-font-family, monospace)",
		margin: 0,
		padding: "6px 10px",
		borderRadius: 4,
		overflowX: "auto",
		whiteSpace: "pre",
	}

	return (
		<div
			className="rounded-md border border-vscode-panel-border bg-vscode-editor-background overflow-hidden"
			style={vars as CSSProperties}
			aria-label={t("settings:ui.appearance.preview")}
			data-testid="appearance-preview">
			<div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-vscode-descriptionForeground border-b border-vscode-panel-border">
				{t("settings:ui.appearance.preview")}
			</div>

			<div style={{ ...row, ...uiText }} className="border-b border-vscode-panel-border">
				<div className="text-vscode-descriptionForeground mb-1" style={{ fontSize: "0.85em" }}>
					{t("settings:ui.appearance.sample.you")}
				</div>
				<div>{t("settings:ui.appearance.sample.user")}</div>
			</div>

			<div style={{ ...row, ...uiText }}>
				<div className="text-vscode-descriptionForeground mb-1" style={{ fontSize: "0.85em" }}>
					{t("settings:ui.appearance.sample.zoo")}
				</div>
				<div className="mb-2">{t("settings:ui.appearance.sample.assistant")}</div>

				<div className="text-[11px] text-vscode-descriptionForeground mb-1">
					{t("settings:ui.appearance.editorFontSize.label")}
				</div>
				<pre
					className="bg-vscode-textCodeBlock-background mb-2"
					style={{ ...mono, fontSize: "var(--zoo-editor-font-size)" }}>
					{'const isLoading = status === "saving"'}
				</pre>

				<div className="text-[11px] text-vscode-descriptionForeground mb-1">
					{t("settings:ui.appearance.terminalFontSize.label")}
				</div>
				<pre
					style={{
						...mono,
						fontSize: "var(--zoo-terminal-font-size)",
						background: "var(--vscode-terminal-background, var(--vscode-textCodeBlock-background))",
						color: "var(--vscode-terminal-foreground, inherit)",
					}}>
					{"$ pnpm test\n✓ 42 passed"}
				</pre>
			</div>
		</div>
	)
}
