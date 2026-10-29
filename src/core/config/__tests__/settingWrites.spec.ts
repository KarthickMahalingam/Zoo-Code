import {
	TRACKED_SETTING_KEYS,
	beginSettingWrite,
	finishSettingWrites,
	isTrackedSetting,
	undoSettingWrite,
} from "../settingWrites"
import type { ContextProxy } from "../ContextProxy"

describe("settingWrites", () => {
	let stored: Map<string, unknown>
	// Only the two methods the module uses. The cast says so: the real ContextProxy has far more.
	let contextProxy: ContextProxy

	beforeEach(() => {
		stored = new Map<string, unknown>([["timeFormat", "auto"]])
		contextProxy = {
			getValue: (key: string) => stored.get(key),
			setValue: async (key: string, value: unknown) => {
				stored.set(key, value)
			},
		} as unknown as ContextProxy
	})

	/** Stores the value, as the write that was just recorded would have. */
	const store = (key: string, value: unknown) => stored.set(key, value)

	describe("which settings are tracked", () => {
		it.each(TRACKED_SETTING_KEYS)("tracks %s", (key) => {
			expect(isTrackedSetting(key)).toBe(true)
		})

		it.each(["soundEnabled", "language", "", "TimeFormat"])("does not track %j", (key) => {
			expect(isTrackedSetting(key)).toBe(false)
		})
	})

	describe("a save and an import writing the same setting", () => {
		it("a failed save does not undo an import that wrote the same value afterwards", async () => {
			const save = beginSettingWrite("timeFormat", "auto", "24h")
			store("timeFormat", "24h")
			const importWrite = beginSettingWrite("timeFormat", "24h", "24h")
			store("timeFormat", "24h")
			finishSettingWrites([importWrite])

			await undoSettingWrite(contextProxy, save)

			expect(stored.get("timeFormat")).toBe("24h")
		})

		it("a failed import does not undo a save that wrote the same value afterwards", async () => {
			const importWrite = beginSettingWrite("timeFormat", "auto", "12h")
			store("timeFormat", "12h")
			const save = beginSettingWrite("timeFormat", "12h", "12h")
			store("timeFormat", "12h")
			finishSettingWrites([save])

			await undoSettingWrite(contextProxy, importWrite)

			expect(stored.get("timeFormat")).toBe("12h")
		})

		it("when both fail, each restores what was stored before either of them", async () => {
			const save = beginSettingWrite("timeFormat", "auto", "24h")
			store("timeFormat", "24h")
			const importWrite = beginSettingWrite("timeFormat", "24h", "12h")
			store("timeFormat", "12h")

			await undoSettingWrite(contextProxy, save) // superseded by the import: nothing changes yet
			expect(stored.get("timeFormat")).toBe("12h")

			await undoSettingWrite(contextProxy, importWrite)
			expect(stored.get("timeFormat")).toBe("auto")
		})
	})

	it("puts a failed write back to what was stored before it", async () => {
		const write = beginSettingWrite("timeFormat", "auto", "24h")
		store("timeFormat", "24h")

		await undoSettingWrite(contextProxy, write)

		expect(stored.get("timeFormat")).toBe("auto")
	})

	it("leaves a value alone that was changed by something else after the write", async () => {
		const write = beginSettingWrite("timeFormat", "auto", "24h")
		store("timeFormat", "12h")

		await undoSettingWrite(contextProxy, write)

		expect(stored.get("timeFormat")).toBe("12h")
	})

	it("does not link a new write to one that has finished", async () => {
		const first = beginSettingWrite("timeFormat", "auto", "24h")
		store("timeFormat", "24h")
		finishSettingWrites([first])
		const second = beginSettingWrite("timeFormat", "24h", "12h")
		store("timeFormat", "12h")

		await undoSettingWrite(contextProxy, second)

		// Back to the finished write's value, not past it.
		expect(stored.get("timeFormat")).toBe("24h")
		expect(second.prev).toBeUndefined()
	})
})
