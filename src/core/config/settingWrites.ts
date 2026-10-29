import type { RooCodeSettings } from "@roo-code/types"

import type { ContextProxy } from "./ContextProxy"

/** The settings whose writes are tracked, so a failed save or import can be put back without undoing another one. */
export const TRACKED_SETTING_KEYS = ["timeFormat", "dateFormat", "showRelativeTimes"] as const

export type TrackedSettingKey = (typeof TRACKED_SETTING_KEYS)[number]

export const isTrackedSetting = (key: string): key is TrackedSettingKey =>
	(TRACKED_SETTING_KEYS as readonly string[]).includes(key)

/** One write of a tracked setting by a save or an import, linked to the writes of others that overlap it. */
export interface SettingWrite {
	key: TrackedSettingKey
	/** What was stored when this write was made. With overlapping writes, this can be another write's pending value. */
	previous: unknown
	wrote: unknown
	/** The write before this one that has not finished yet, and the one after it. */
	prev?: SettingWrite
	next?: SettingWrite
	/** The save or import has finished: it succeeded, or it has been rolled back. */
	done: boolean
}

/**
 * The latest write of each tracked setting. The store is shared by every provider (sidebar, editor tab) and by the
 * settings import, so writes can overlap, and the writes to one key form a chain. Rolling a write back puts the key
 * back only while it is the latest one and the stored value is still what it wrote, so another write's value is kept
 * even when it is the same value. A write that is rolled back while a newer one is pending is taken out of the chain,
 * so that if the newer one fails too, it restores what was stored before either of them.
 */
const lastWriteOfSetting = new Map<TrackedSettingKey, SettingWrite>()

/** Records a write that is about to be made, as the latest one of its key. */
export const beginSettingWrite = (key: TrackedSettingKey, previous: unknown, wrote: unknown): SettingWrite => {
	const before = lastWriteOfSetting.get(key)
	const write: SettingWrite = { key, previous, wrote, prev: before && !before.done ? before : undefined, done: false }
	if (write.prev) write.prev.next = write
	lastWriteOfSetting.set(key, write)
	return write
}

/** The save or import that made these writes succeeded. */
export const finishSettingWrites = (writes: SettingWrite[]) => {
	for (const write of writes) write.done = true
}

/** Puts a failed write back, unless another write has superseded it (see `lastWriteOfSetting`). */
export const undoSettingWrite = async (contextProxy: ContextProxy, write: SettingWrite) => {
	const { key } = write
	write.done = true

	if (lastWriteOfSetting.get(key) !== write) {
		// A newer write exists. Make it restore the value from before this one if it fails as well.
		const { next } = write
		if (next && !next.done) {
			next.previous = write.previous
			next.prev = write.prev
			if (write.prev) write.prev.next = next
		}

		return
	}

	// The write before this one is pending again: it is the latest, and the value now stored is its value.
	if (write.prev && !write.prev.done) lastWriteOfSetting.set(key, write.prev)
	else lastWriteOfSetting.delete(key)

	if (contextProxy.getValue(key as keyof RooCodeSettings) === write.wrote) {
		await contextProxy.setValue(key as keyof RooCodeSettings, write.previous as never)
	}
}
