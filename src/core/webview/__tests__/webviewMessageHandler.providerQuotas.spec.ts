// npx vitest core/webview/__tests__/webviewMessageHandler.providerQuotas.spec.ts

import { beforeEach, describe, expect, it, vi } from "vitest"

import { providerIdentifiers } from "@roo-code/types"

const quotas = vi.hoisted(() => ({
	getProviderQuotas: vi.fn(),
}))

// Keep the real `loadProfiles` (it is the code under test alongside the handler) and stub only the network part.
vi.mock("../../../services/language-models/providerQuotas", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../services/language-models/providerQuotas")>()),
	getProviderQuotas: quotas.getProviderQuotas,
}))

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

const SECRET = "sk-super-secret"

const makeProvider = (overrides: Record<string, unknown> = {}) =>
	({
		postMessageToWebview: vi.fn(),
		providerSettingsManager: {
			listConfig: vi.fn(async () => [{ id: "a" }, { id: "b" }]),
			getProfile: vi.fn(async ({ id }: { id: string }) => ({
				apiProvider: providerIdentifiers.openrouter,
				openRouterApiKey: SECRET,
				id,
			})),
		},
		...overrides,
	}) as unknown as ClineProvider & { postMessageToWebview: ReturnType<typeof vi.fn> }

describe("webviewMessageHandler – requestProviderQuotas", () => {
	beforeEach(() => {
		quotas.getProviderQuotas.mockReset()
		quotas.getProviderQuotas.mockResolvedValue([
			{
				providerId: providerIdentifiers.openrouter,
				ok: true,
				fetchedAt: 1,
				windows: [{ id: "key_limit", valueLabel: "$5.00 / $10.00 used", usedPercent: 50 }],
			},
		])
	})

	it("loads every saved profile and posts the formatted quotas back", async () => {
		const provider = makeProvider()
		await webviewMessageHandler(provider, { type: "requestProviderQuotas" })

		expect(provider.providerSettingsManager.getProfile).toHaveBeenCalledTimes(2)
		expect(quotas.getProviderQuotas.mock.calls[0][0]).toHaveLength(2)
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "providerQuotas",
			providerQuotas: expect.arrayContaining([
				expect.objectContaining({ providerId: providerIdentifiers.openrouter }),
			]),
			requestId: undefined,
		})
	})

	it("does not force a refresh by default, and forces when the user presses refresh", async () => {
		const provider = makeProvider()
		await webviewMessageHandler(provider, { type: "requestProviderQuotas" })
		expect(quotas.getProviderQuotas).toHaveBeenLastCalledWith(expect.any(Array), {
			force: false,
			signal: expect.any(AbortSignal),
		})

		await webviewMessageHandler(provider, { type: "requestProviderQuotas", bool: true })
		expect(quotas.getProviderQuotas).toHaveBeenLastCalledWith(expect.any(Array), {
			force: true,
			signal: expect.any(AbortSignal),
		})
	})

	it("passes API keys to the host service but never posts them to the webview", async () => {
		const provider = makeProvider()
		await webviewMessageHandler(provider, { type: "requestProviderQuotas" })

		// The service needs the key...
		expect(JSON.stringify(quotas.getProviderQuotas.mock.calls[0][0])).toContain(SECRET)
		// ...but nothing posted to the webview may contain it.
		expect(JSON.stringify(provider.postMessageToWebview.mock.calls)).not.toContain(SECRET)
	})

	it("still answers when one profile cannot be loaded", async () => {
		const provider = makeProvider()
		provider.providerSettingsManager.getProfile = vi.fn(async ({ id }: { id: string }) => {
			if (id === "a") throw new Error("corrupt secret storage")
			return { apiProvider: providerIdentifiers.openrouter, openRouterApiKey: SECRET } as never
		}) as never

		await webviewMessageHandler(provider, { type: "requestProviderQuotas" })
		expect(quotas.getProviderQuotas.mock.calls[0][0]).toHaveLength(1)
		expect(provider.postMessageToWebview).toHaveBeenCalled()
	})

	it("still answers, and logs, when the profile list cannot be read", async () => {
		const log = vi.fn()
		const provider = makeProvider({ log })
		provider.providerSettingsManager.listConfig = vi.fn(async () => {
			throw new Error("secret storage unavailable")
		}) as never

		await webviewMessageHandler(provider, { type: "requestProviderQuotas" })

		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "providerQuotas",
			providerQuotas: [],
			requestId: undefined,
		})
		expect(log).toHaveBeenCalledWith(expect.stringContaining("secret storage unavailable"))
	})

	it("still answers when the quota service throws something that is not an Error", async () => {
		const log = vi.fn()
		const provider = makeProvider({ log })
		quotas.getProviderQuotas.mockRejectedValue("nope")

		await webviewMessageHandler(provider, { type: "requestProviderQuotas" })

		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "providerQuotas",
			providerQuotas: [],
			requestId: undefined,
		})
		expect(log).toHaveBeenCalledWith(expect.stringContaining("Failed to load provider limits"))
	})

	it("answers with an empty list when there are no profiles", async () => {
		quotas.getProviderQuotas.mockResolvedValue([])
		const provider = makeProvider()
		provider.providerSettingsManager.listConfig = vi.fn(async () => []) as never

		await webviewMessageHandler(provider, { type: "requestProviderQuotas" })
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "providerQuotas",
			providerQuotas: [],
			requestId: undefined,
		})
	})

	describe("request lifecycle", () => {
		it("echoes the request id on the answer", async () => {
			const provider = makeProvider()
			await webviewMessageHandler(provider, { type: "requestProviderQuotas", requestId: "req-1" })
			expect(provider.postMessageToWebview).toHaveBeenCalledWith(
				expect.objectContaining({ type: "providerQuotas", requestId: "req-1" }),
			)
		})

		it("passes an abort signal to the quota service", async () => {
			const provider = makeProvider()
			await webviewMessageHandler(provider, { type: "requestProviderQuotas", requestId: "req-2" })
			expect(quotas.getProviderQuotas).toHaveBeenLastCalledWith(expect.any(Array), {
				force: false,
				signal: expect.any(AbortSignal),
			})
		})

		it("aborts the work and posts nothing when the request is cancelled while it is running", async () => {
			let signal: AbortSignal | undefined
			let finish: (value: never[]) => void = () => {}
			quotas.getProviderQuotas.mockImplementation((_profiles, options: { signal: AbortSignal }) => {
				signal = options.signal
				return new Promise((resolve) => (finish = resolve))
			})
			const provider = makeProvider()

			const running = webviewMessageHandler(provider, { type: "requestProviderQuotas", requestId: "req-3" })
			await vi.waitFor(() => expect(signal).toBeDefined())
			await webviewMessageHandler(provider, { type: "cancelProviderQuotas", requestId: "req-3" })

			expect(signal!.aborted).toBe(true)
			finish([])
			await running
			expect(provider.postMessageToWebview).not.toHaveBeenCalled()
		})

		it("does not post when the request was cancelled before the profiles finished loading", async () => {
			const provider = makeProvider()
			let release: (entries: { id: string }[]) => void = () => {}
			provider.providerSettingsManager.listConfig = vi.fn(
				() => new Promise((resolve) => (release = resolve)),
			) as never

			const running = webviewMessageHandler(provider, { type: "requestProviderQuotas", requestId: "req-4" })
			await vi.waitFor(() => expect(provider.providerSettingsManager.listConfig).toHaveBeenCalled())
			await webviewMessageHandler(provider, { type: "cancelProviderQuotas", requestId: "req-4" })
			release([{ id: "a" }])
			await running

			expect(quotas.getProviderQuotas).not.toHaveBeenCalled()
			expect(provider.postMessageToWebview).not.toHaveBeenCalled()
		})

		it("ignores a cancel for an unknown or missing id, and for a request that already finished", async () => {
			const provider = makeProvider()
			await webviewMessageHandler(provider, { type: "requestProviderQuotas", requestId: "req-5" })
			provider.postMessageToWebview.mockClear()

			await expect(
				webviewMessageHandler(provider, { type: "cancelProviderQuotas", requestId: "req-5" }),
			).resolves.not.toThrow()
			await expect(
				webviewMessageHandler(provider, { type: "cancelProviderQuotas", requestId: "nope" }),
			).resolves.not.toThrow()
			await expect(webviewMessageHandler(provider, { type: "cancelProviderQuotas" })).resolves.not.toThrow()
			expect(provider.postMessageToWebview).not.toHaveBeenCalled()
		})
	})
})
