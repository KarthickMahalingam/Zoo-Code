import { HTMLAttributes, useMemo } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

import type { Language } from "@roo-code/types"

import { LANGUAGES } from "@roo/language"

import { cn } from "@src/lib/utils"
import { formatDateTime, type TimeFormat } from "@src/utils/format"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

const TIME_FORMATS: TimeFormat[] = ["auto", "12h", "24h"]

// Fixed sample (14:41 local) so the preview clearly shows 12h vs 24h.
const PREVIEW_TS = (() => {
	const d = new Date()
	d.setHours(14, 41, 0, 0)
	return d.getTime()
})()

type LanguageSettingsProps = HTMLAttributes<HTMLDivElement> & {
	language: string
	timeFormat?: TimeFormat
	setCachedStateField: SetCachedStateField<"language" | "timeFormat">
}

export const LanguageSettings = ({
	language,
	timeFormat = "auto",
	setCachedStateField,
	className,
	...props
}: LanguageSettingsProps) => {
	const { t } = useAppTranslation()

	// Recompute when language changes too, since "auto" is locale-driven.
	const preview = useMemo(() => formatDateTime(PREVIEW_TS, timeFormat), [timeFormat, language]) // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.language")}</SectionHeader>

			<Section>
				<SearchableSetting
					settingId="language-select"
					section="language"
					label={t("settings:sections.language")}>
					<Select
						value={language}
						onValueChange={(value) => setCachedStateField("language", value as Language)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={t("settings:common.select")} />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{Object.entries(LANGUAGES).map(([code, name]) => (
									<SelectItem key={code} value={code}>
										{name}
										<span className="text-muted-foreground">({code})</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</SearchableSetting>

				<SearchableSetting
					settingId="language-time-format"
					section="language"
					label={t("settings:language.timeFormat.label")}>
					<div className="flex flex-col gap-1">
						<label className="block font-medium mb-1">{t("settings:language.timeFormat.label")}</label>
						<Select
							value={timeFormat}
							onValueChange={(value) => setCachedStateField("timeFormat", value as TimeFormat)}>
							<SelectTrigger className="w-full" data-testid="time-format-select">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{TIME_FORMATS.map((format) => (
									<SelectItem key={format} value={format}>
										{t(`settings:language.timeFormat.options.${format}`)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:language.timeFormat.description")}
						</div>
						<div className="text-sm mt-1" data-testid="time-format-preview">
							{t("settings:language.timeFormat.preview", { example: preview })}
						</div>
					</div>
				</SearchableSetting>
			</Section>
		</div>
	)
}
