import { HTMLAttributes, useEffect, useMemo, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { telemetryClient } from "@/utils/TelemetryClient"
import {
	DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES,
	DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES_AFTER_USER_EDITED,
	DEFAULT_AUTO_CLOSE_ZOO_OPENED_NEW_FILES,
} from "@roo-code/types"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { Slider, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui"
import { ExtensionStateContextType } from "@/context/ExtensionStateContext"
import { DEFAULT_SPACING_DENSITY, SPACING_DENSITIES, type SpacingDensity, sanitizeFontFamily } from "@/utils/appearance"

export const CHAT_FONT_SIZE_MIN = 8
export const CHAT_FONT_SIZE_MAX = 32
export const CHAT_FONT_SIZE_DEFAULT = 13

interface UISettingsProps extends HTMLAttributes<HTMLDivElement> {
	reasoningBlockCollapsed: boolean
	enterBehavior: "send" | "newline"
	chatFontSize?: number
	interfaceFontFamily?: string
	codeFontFamily?: string
	spacingDensity?: SpacingDensity
	autoCloseZooOpenedFiles?: boolean
	autoCloseZooOpenedFilesAfterUserEdited?: boolean
	autoCloseZooOpenedNewFiles?: boolean
	setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType>
}

export const UISettings = ({
	reasoningBlockCollapsed,
	enterBehavior,
	chatFontSize,
	interfaceFontFamily,
	codeFontFamily,
	spacingDensity,
	autoCloseZooOpenedFiles,
	autoCloseZooOpenedFilesAfterUserEdited,
	autoCloseZooOpenedNewFiles,
	setCachedStateField,
	...props
}: UISettingsProps) => {
	const { t } = useAppTranslation()

	// Detect platform for dynamic modifier key display
	const primaryMod = useMemo(() => {
		const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
		return isMac ? "⌘" : "Ctrl"
	}, [])

	const handleReasoningBlockCollapsedChange = (value: boolean) => {
		setCachedStateField("reasoningBlockCollapsed", value)

		// Track telemetry event
		telemetryClient.capture("ui_settings_collapse_thinking_changed", {
			enabled: value,
		})
	}

	const handleEnterBehaviorChange = (requireCtrlEnter: boolean) => {
		const newBehavior = requireCtrlEnter ? "newline" : "send"
		setCachedStateField("enterBehavior", newBehavior)

		// Track telemetry event
		telemetryClient.capture("ui_settings_enter_behavior_changed", {
			behavior: newBehavior,
		})
	}

	const handleChatFontSizeChange = (value: number) => {
		setCachedStateField("chatFontSize", value)

		// Track telemetry event
		telemetryClient.capture("ui_settings_chat_font_size_changed", {
			value,
		})
	}

	const handleChatFontSizeReset = () => {
		setCachedStateField("chatFontSize", undefined)

		// Track telemetry event
		telemetryClient.capture("ui_settings_chat_font_size_reset")
	}

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.ui")}</SectionHeader>

			<Section>
				<div className="space-y-6">
					{/* Collapse Thinking Messages Setting */}
					<SearchableSetting
						settingId="ui-collapse-thinking"
						section="ui"
						label={t("settings:ui.collapseThinking.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={reasoningBlockCollapsed}
								onChange={(e: any) => handleReasoningBlockCollapsedChange(e.target.checked)}
								data-testid="collapse-thinking-checkbox">
								<span className="font-medium">{t("settings:ui.collapseThinking.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.collapseThinking.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Enter Key Behavior Setting */}
					<SearchableSetting
						settingId="ui-enter-behavior"
						section="ui"
						label={t("settings:ui.requireCtrlEnterToSend.label", { primaryMod })}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={enterBehavior === "newline"}
								onChange={(e: any) => handleEnterBehaviorChange(e.target.checked)}
								data-testid="enter-behavior-checkbox">
								<span className="font-medium">
									{t("settings:ui.requireCtrlEnterToSend.label", { primaryMod })}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.requireCtrlEnterToSend.description", { primaryMod })}
							</div>
						</div>
					</SearchableSetting>

					{/* Chat Font Size Setting */}
					<SearchableSetting
						settingId="ui-chat-font-size"
						section="ui"
						label={t("settings:ui.chatFontSize.label")}>
						<div className="flex flex-col gap-1">
							<label className="block font-medium mb-1">{t("settings:ui.chatFontSize.label")}</label>
							<div className="flex flex-wrap items-center gap-2">
								<Slider
									className="min-w-0 flex-1"
									min={CHAT_FONT_SIZE_MIN}
									max={CHAT_FONT_SIZE_MAX}
									step={1}
									value={[chatFontSize ?? CHAT_FONT_SIZE_DEFAULT]}
									onValueChange={([value]) => handleChatFontSizeChange(value)}
									data-testid="chat-font-size-slider"
								/>
								<span className="w-12 text-right">{chatFontSize ?? CHAT_FONT_SIZE_DEFAULT}px</span>
								<Button
									className="h-auto max-w-full whitespace-normal text-center"
									variant="secondary"
									size="sm"
									disabled={chatFontSize === undefined}
									onClick={handleChatFontSizeReset}
									data-testid="chat-font-size-reset">
									{t("settings:ui.chatFontSize.reset")}
								</Button>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:ui.chatFontSize.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Interface (chat prose) font */}
					<SearchableSetting
						settingId="ui-interface-font"
						section="ui"
						label={t("settings:ui.interfaceFont.label")}>
						<FontFamilyField
							label={t("settings:ui.interfaceFont.label")}
							description={t("settings:ui.interfaceFont.description")}
							placeholder={t("settings:ui.interfaceFont.placeholder")}
							invalidMessage={t("settings:ui.fontInvalid")}
							resetLabel={t("settings:ui.fontReset")}
							value={interfaceFontFamily}
							onChange={(value) => setCachedStateField("interfaceFontFamily", value)}
							testId="interface-font"
						/>
					</SearchableSetting>

					{/* Code font */}
					<SearchableSetting settingId="ui-code-font" section="ui" label={t("settings:ui.codeFont.label")}>
						<FontFamilyField
							label={t("settings:ui.codeFont.label")}
							description={t("settings:ui.codeFont.description")}
							placeholder={t("settings:ui.codeFont.placeholder")}
							invalidMessage={t("settings:ui.fontInvalid")}
							resetLabel={t("settings:ui.fontReset")}
							value={codeFontFamily}
							onChange={(value) => setCachedStateField("codeFontFamily", value)}
							testId="code-font"
						/>
					</SearchableSetting>

					{/* Spacing density */}
					<SearchableSetting
						settingId="ui-spacing-density"
						section="ui"
						label={t("settings:ui.spacingDensity.label")}>
						<div className="flex flex-col gap-1">
							<label className="block font-medium mb-1">{t("settings:ui.spacingDensity.label")}</label>
							<Select
								value={spacingDensity ?? DEFAULT_SPACING_DENSITY}
								onValueChange={(value) => {
									setCachedStateField("spacingDensity", value as SpacingDensity)
									telemetryClient.capture("ui_settings_spacing_density_changed", { value })
								}}>
								<SelectTrigger className="w-full" data-testid="spacing-density-select">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SPACING_DENSITIES.map((density) => (
										<SelectItem key={density} value={density}>
											{t(`settings:ui.spacingDensity.options.${density}`)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:ui.spacingDensity.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Auto-close Zoo opened files */}
					<SearchableSetting
						settingId="ui-auto-close-zoo-opened-files"
						section="ui"
						label={t("settings:ui.autoCloseZooOpenedFiles.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={autoCloseZooOpenedFiles ?? DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES}
								onChange={(e: any) => setCachedStateField("autoCloseZooOpenedFiles", e.target.checked)}
								data-testid="auto-close-zoo-opened-files-checkbox">
								<span className="font-medium">{t("settings:ui.autoCloseZooOpenedFiles.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.autoCloseZooOpenedFiles.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Auto-close Zoo opened files after user interaction */}
					<SearchableSetting
						settingId="ui-auto-close-zoo-opened-files-after-user-edited"
						section="ui"
						label={t("settings:ui.autoCloseZooOpenedFilesAfterUserEdited.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={
									autoCloseZooOpenedFilesAfterUserEdited ??
									DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES_AFTER_USER_EDITED
								}
								onChange={(e: any) =>
									setCachedStateField("autoCloseZooOpenedFilesAfterUserEdited", e.target.checked)
								}
								data-testid="auto-close-zoo-opened-files-after-user-edited-checkbox">
								<span className="font-medium">
									{t("settings:ui.autoCloseZooOpenedFilesAfterUserEdited.label")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.autoCloseZooOpenedFilesAfterUserEdited.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Auto-close Zoo opened new files */}
					<SearchableSetting
						settingId="ui-auto-close-zoo-opened-new-files"
						section="ui"
						label={t("settings:ui.autoCloseZooOpenedNewFiles.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={autoCloseZooOpenedNewFiles ?? DEFAULT_AUTO_CLOSE_ZOO_OPENED_NEW_FILES}
								onChange={(e: any) =>
									setCachedStateField("autoCloseZooOpenedNewFiles", e.target.checked)
								}
								data-testid="auto-close-zoo-opened-new-files-checkbox">
								<span className="font-medium">{t("settings:ui.autoCloseZooOpenedNewFiles.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.autoCloseZooOpenedNewFiles.description")}
							</div>
						</div>
					</SearchableSetting>
				</div>
			</Section>
		</div>
	)
}

interface FontFamilyFieldProps {
	label: string
	description: string
	placeholder: string
	invalidMessage: string
	resetLabel: string
	value?: string
	onChange: (value: string | undefined) => void
	testId: string
}

/**
 * Free-text font-family input. Keeps a local draft so the user can type
 * freely, and only commits a sanitized value (or `undefined` = inherit) to
 * cached settings. Invalid input is flagged but never persisted.
 */
const FontFamilyField = ({
	label,
	description,
	placeholder,
	invalidMessage,
	resetLabel,
	value,
	onChange,
	testId,
}: FontFamilyFieldProps) => {
	const [draft, setDraft] = useState(value ?? "")

	// Re-sync when the persisted value changes underneath us (reset, import).
	useEffect(() => setDraft(value ?? ""), [value])

	const trimmed = draft.trim()
	const isInvalid = trimmed.length > 0 && sanitizeFontFamily(trimmed) === undefined

	const handleChange = (next: string) => {
		setDraft(next)
		const nextTrimmed = next.trim()

		if (!nextTrimmed) {
			onChange(undefined)
		} else {
			const safe = sanitizeFontFamily(nextTrimmed)
			if (safe) onChange(safe)
		}
	}

	return (
		<div className="flex flex-col gap-1">
			<label className="block font-medium mb-1">{label}</label>
			<div className="flex flex-wrap items-center gap-2">
				<Input
					className="min-w-0 flex-1"
					style={trimmed && !isInvalid ? { fontFamily: trimmed } : undefined}
					value={draft}
					placeholder={placeholder}
					spellCheck={false}
					aria-invalid={isInvalid}
					onChange={(e) => handleChange(e.target.value)}
					data-testid={`${testId}-input`}
				/>
				<Button
					className="h-auto max-w-full whitespace-normal text-center"
					variant="secondary"
					size="sm"
					disabled={value === undefined && !draft}
					onClick={() => handleChange("")}
					data-testid={`${testId}-reset`}>
					{resetLabel}
				</Button>
			</div>
			{isInvalid ? (
				<div className="text-vscode-errorForeground text-sm mt-1" data-testid={`${testId}-error`}>
					{invalidMessage}
				</div>
			) : (
				<div className="text-vscode-descriptionForeground text-sm mt-1">{description}</div>
			)}
		</div>
	)
}
