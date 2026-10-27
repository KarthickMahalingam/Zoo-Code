import { Clock } from "lucide-react"

import { cn } from "@src/lib/utils"
import { formatDateTime, formatMessageTime, type DateFormat, type TimeFormat } from "@/utils/format"

import { StandardTooltip } from "../ui/standard-tooltip"

interface MessageTimestampProps {
	/** Epoch ms the message was sent. */
	ts: number
	/** From the user's Language settings; both default to "auto". */
	timeFormat?: TimeFormat
	dateFormat?: DateFormat
	className?: string
}

/**
 * "🕒 Yesterday 11:43 AM" under a sent message.
 *
 * Purely presentational: the caller supplies the user's time/date formats, so
 * the component has no dependency on extension state and renders anywhere. The
 * tooltip always carries the full date and time. A semantic <time> element
 * gives assistive tech and copy/paste the exact value.
 */
export const MessageTimestamp = ({ ts, timeFormat, dateFormat, className }: MessageTimestampProps) => {
	if (!Number.isFinite(ts) || ts <= 0) return null

	return (
		<StandardTooltip content={formatDateTime(ts, timeFormat, dateFormat)}>
			<time
				dateTime={new Date(ts).toISOString()}
				className={cn(
					"inline-flex items-center gap-1.5 text-xs text-vscode-descriptionForeground select-none",
					className,
				)}
				data-testid="message-timestamp">
				<Clock className="size-3.5 shrink-0" aria-hidden="true" />
				{formatMessageTime(ts, { timeFormat, dateFormat })}
			</time>
		</StandardTooltip>
	)
}
