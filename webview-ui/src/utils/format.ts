import i18next from "i18next"

export type TimeFormat = "auto" | "12h" | "24h"

export function formatLargeNumber(num: number): string {
	if (num >= 1e9) {
		return (num / 1e9).toFixed(1) + i18next.t("common:number_format.billion_suffix")
	}
	if (num >= 1e6) {
		return (num / 1e6).toFixed(1) + i18next.t("common:number_format.million_suffix")
	}
	if (num >= 1e3) {
		return (num / 1e3).toFixed(1) + i18next.t("common:number_format.thousand_suffix")
	}
	return num.toString()
}

/**
 * Maps the user's time format preference to `Intl` hour-cycle options.
 * "auto" returns `{}` so the locale decides (e.g. 24h for de, 12h for en-US).
 */
export function hourCycleOptions(timeFormat: TimeFormat = "auto"): Intl.DateTimeFormatOptions {
	switch (timeFormat) {
		case "12h":
			return { hour12: true }
		case "24h":
			return { hourCycle: "h23" }
		default:
			return {}
	}
}

/**
 * @internal
 */
export const formatDate = (timestamp: number, timeFormat: TimeFormat = "auto") => {
	const date = new Date(timestamp)
	const locale = i18next.language || "en"

	return date.toLocaleString(locale, {
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		...hourCycleOptions(timeFormat),
	})
}

/** Full date + time, used for tooltips on relative timestamps. */
export const formatDateTime = (timestamp: number, timeFormat: TimeFormat = "auto") => {
	const locale = i18next.language || "en"

	return new Date(timestamp).toLocaleString(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		...hourCycleOptions(timeFormat),
	})
}

export const formatTimeAgo = (timestamp: number) => {
	const now = Date.now()
	const diff = now - timestamp
	const seconds = Math.floor(diff / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)
	const weeks = Math.floor(days / 7)
	const months = Math.floor(days / 30)
	const years = Math.floor(days / 365)

	if (years > 0) {
		return years === 1
			? i18next.t("common:time_ago.year_ago")
			: i18next.t("common:time_ago.years_ago", { count: years })
	}
	if (months > 0) {
		return months === 1
			? i18next.t("common:time_ago.month_ago")
			: i18next.t("common:time_ago.months_ago", { count: months })
	}
	if (weeks > 0) {
		return weeks === 1
			? i18next.t("common:time_ago.week_ago")
			: i18next.t("common:time_ago.weeks_ago", { count: weeks })
	}
	if (days > 0) {
		return days === 1
			? i18next.t("common:time_ago.day_ago")
			: i18next.t("common:time_ago.days_ago", { count: days })
	}
	if (hours > 0) {
		return hours === 1
			? i18next.t("common:time_ago.hour_ago")
			: i18next.t("common:time_ago.hours_ago", { count: hours })
	}
	if (minutes > 0) {
		return minutes === 1
			? i18next.t("common:time_ago.minute_ago")
			: i18next.t("common:time_ago.minutes_ago", { count: minutes })
	}
	if (seconds > 30) {
		return i18next.t("common:time_ago.seconds_ago", { count: seconds })
	}

	return i18next.t("common:time_ago.just_now")
}
