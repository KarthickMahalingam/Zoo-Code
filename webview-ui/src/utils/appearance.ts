/**
 * Helpers for user-configurable appearance settings (fonts, density).
 *
 * Font family values are free text typed by the user and are written into a
 * CSS custom property. `style.setProperty` can't break out of the declaration,
 * but we still reject characters that have no business in a font-family list
 * (braces, semicolons, url(), etc.) so a bad value degrades to "inherit"
 * instead of producing a confusing half-applied style.
 */

const FONT_FAMILY_ALLOWED = /^[\p{L}\p{N}\s,'"\-_.]+$/u
const FONT_FAMILY_MAX_LENGTH = 256

/** Returns a trimmed, safe font-family list, or `undefined` if empty/invalid. */
export function sanitizeFontFamily(value: string | null | undefined): string | undefined {
	if (typeof value !== "string") {
		return undefined
	}

	const trimmed = value.trim()

	if (!trimmed || trimmed.length > FONT_FAMILY_MAX_LENGTH || !FONT_FAMILY_ALLOWED.test(trimmed)) {
		return undefined
	}

	return trimmed
}

/**
 * Sets (or clears) a font-family CSS variable on the document root. Clearing
 * lets the stylesheet fallback (VS Code's own font variable) apply.
 */
export function applyFontVariable(
	name: string,
	value: string | null | undefined,
	root: HTMLElement = document.documentElement,
): void {
	const safe = sanitizeFontFamily(value)

	if (safe) {
		root.style.setProperty(name, safe)
	} else {
		root.style.removeProperty(name)
	}
}

export const SPACING_DENSITIES = ["compact", "comfortable", "spacious"] as const
export type SpacingDensity = (typeof SPACING_DENSITIES)[number]
export const DEFAULT_SPACING_DENSITY: SpacingDensity = "comfortable"
