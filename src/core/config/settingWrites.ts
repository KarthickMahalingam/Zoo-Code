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
	/** `previous` was handed over by a write that was rolled back, so it is not read again when this write starts. */
	inherited?: boolean
	/** How many times the key had been stored when this write was made. A different count later means something else wrote it. */
	generation?: number
	/** For a handed-over `previous`: how many stores by others there had been when the write that held it stored its own value. */
	handedOverAt?: number
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

/**
 * How many times each tracked key has been stored, by anyone. `ContextProxy` reports every store here (`noteSettingStored`),
 * including the ones that do not go through a save or an import (the public API, other callers of `setValues`). A
 * write is put back only if the count is still what it was just after its own store, so a write made by anyone else in
 * between is kept, even when it stored the same value.
 */
const storedCount = new Map<TrackedSettingKey, number>()

/** How many of those stores were made by the saves and imports here, restores included. */
const ownStoredCount = new Map<TrackedSettingKey, number>()

/** How many times the key was stored by anyone but the saves and imports here. */
const storedByOthers = (key: TrackedSettingKey) => (storedCount.get(key) ?? 0) - (ownStoredCount.get(key) ?? 0)

/** Call right after a store made here, so it is not counted as a store by someone else. */
const noteOwnStore = (key: TrackedSettingKey) => ownStoredCount.set(key, (ownStoredCount.get(key) ?? 0) + 1)

/** `ContextProxy` calls this, synchronously, each time a setting is stored. */
export const noteSettingStored = (key: string) => {
	if (isTrackedSetting(key)) storedCount.set(key, (storedCount.get(key) ?? 0) + 1)
}

/** Records a write that is about to be made, as the latest one of its key. */
export const beginSettingWrite = (key: TrackedSettingKey, previous: unknown, wrote: unknown): SettingWrite => {
	const before = lastWriteOfSetting.get(key)
	const write: SettingWrite = { key, previous, wrote, prev: before && !before.done ? before : undefined, done: false }
	if (write.prev) write.prev.next = write
	lastWriteOfSetting.set(key, write)
	return write
}

/**
 * The writes to one key, one at a time, from every save, import and rollback, across providers. A write is only
 * started once the one before it has reached durable storage, so a slower write cannot complete after a newer one
 * and overwrite it, and a rollback cannot land after a newer write has started. A write that fails does not hold up
 * the ones behind it.
 */
const settingWriteQueues = new Map<TrackedSettingKey, Promise<void>>()

const queuedSettingWrite = (key: TrackedSettingKey, write: () => Promise<unknown>): Promise<void> => {
	const run = (settingWriteQueues.get(key) ?? Promise.resolve()).then(async () => {
		await write()
	})
	const tail = run.catch(() => undefined)
	settingWriteQueues.set(key, tail)
	void tail.then(() => {
		if (settingWriteQueues.get(key) === tail) settingWriteQueues.delete(key)
	})
	return run
}

/** @internal test hook: how much is kept about writes. It is nothing once the saves and imports are over. */
export const settingWriteBookkeepingSize = () => ({
	latestWrites: lastWriteOfSetting.size,
	queuedKeys: settingWriteQueues.size,
})

/**
 * Stores a recorded write, in line behind the writes of its key. What it replaces is read when it starts, after the
 * writes before it have reached storage, unless a rolled-back write handed its own value over.
 */
export const performSettingWrite = (contextProxy: ContextProxy, write: SettingWrite): Promise<void> =>
	queuedSettingWrite(write.key, () => {
		// A handed-over value is kept only while nobody else has stored the key since it was handed over.
		if (!write.inherited || storedByOthers(write.key) !== write.handedOverAt) {
			write.previous = contextProxy.getValue(write.key as keyof RooCodeSettings)
		}
		const stored = contextProxy.setValue(write.key as keyof RooCodeSettings, write.wrote as never)
		noteOwnStore(write.key)
		write.generation = storedByOthers(write.key)
		return stored
	})

/** Takes a write out of its chain, joining the writes on either side of it. */
const unlinkSettingWrite = (write: SettingWrite) => {
	if (write.prev) write.prev.next = write.next
	if (write.next) write.next.prev = write.prev
	write.prev = undefined
	write.next = undefined
}

/**
 * The save or import that made these writes succeeded. Nothing is kept about them once they are over. The value is
 * committed, so it is what a later write that has not started yet replaces, and the writes on either side of it no
 * longer hand values to each other: an earlier write that fails now has nothing left to put back behind it.
 */
export const finishSettingWrites = (writes: SettingWrite[]) => {
	for (const write of writes) {
		write.done = true
		if (lastWriteOfSetting.get(write.key) === write) lastWriteOfSetting.delete(write.key)

		const { next } = write
		if (next && !next.done) {
			if (next.generation === undefined) {
				next.previous = write.wrote
				next.inherited = true
				next.handedOverAt = write.generation ?? storedByOthers(write.key)
			}
			next.prev = undefined
		}
		if (write.prev) write.prev.next = undefined
		write.prev = undefined
		write.next = undefined
	}
}

/** Puts a failed write back, unless another write has superseded it (see `lastWriteOfSetting`). */
export const undoSettingWrite = async (contextProxy: ContextProxy, write: SettingWrite) => {
	const { key } = write
	write.done = true

	if (lastWriteOfSetting.get(key) !== write) {
		// A newer write exists. Make it restore the value from before this one if it fails as well.
		if (write.next && !write.next.done) {
			write.next.previous = write.previous
			write.next.inherited = true
			write.next.handedOverAt = write.generation ?? storedByOthers(key)
		}
		unlinkSettingWrite(write)
		return
	}

	// The write before this one is pending again: it is the latest, and the value now stored is its value.
	const { prev } = write
	if (prev && !prev.done) lastWriteOfSetting.set(key, prev)
	else lastWriteOfSetting.delete(key)
	unlinkSettingWrite(write)

	await queuedSettingWrite(key, async () => {
		const untouched = write.generation === undefined || storedByOthers(key) === write.generation
		if (untouched && contextProxy.getValue(key as keyof RooCodeSettings) === write.wrote) {
			const restored = contextProxy.setValue(key as keyof RooCodeSettings, write.previous as never)
			// The write before this one is the owner of the value again.
			noteOwnStore(key)
			if (prev && !prev.done) prev.generation = storedByOthers(key)
			await restored
		}
	})
}
