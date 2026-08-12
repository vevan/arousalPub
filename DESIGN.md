---
name: Arousal Pub
description: A warm, restrained workspace for long-form conversational creation.
colors:
  background: "#0e0b08"
  surface: "#15110d"
  surface-light: "#1c1813"
  surface-bright: "#241f18"
  ink: "#f4ecd8"
  primary: "#d9602e"
  primary-dark: "#ae3e1f"
  secondary: "#b89770"
  success: "#7a8f6a"
  error: "#a4332e"
typography:
  display:
    fontFamily: "EB Garamond, Source Serif 4, Noto Serif SC, Georgia, serif"
    fontWeight: 600
    lineHeight: 1.15
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.55
  mono:
    fontFamily: "Geist Mono, ui-monospace, Cascadia Code, Consolas, monospace"
    fontWeight: 500
rounded:
  sm: "0.25rem"
  md: "0.5rem"
  lg: "0.75rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  panel-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  input-surface:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
---

# Design System: Arousal Pub

## Overview

**Creative North Star: "The Fireside Workbench"**

Arousal Pub is a dense creation workspace, not a generic dashboard. The default dark theme combines warm ink-black surfaces, parchment-like text, and a restrained hearth-orange accent. It should feel deliberate and literary at the level of reading, but quick and precise at the level of controls.

Dark mode is the primary working environment; light mode preserves the same warm hue family instead of switching to sterile white and cool gray. Paper texture belongs only to the application background. Interactive surfaces stay calm, opaque, and legible.

**Key Characteristics:**

- Warm, low-chroma tonal layers establish hierarchy before shadows do.
- Serif is reserved for titles and expressive reading landmarks; system-like sans serif carries all operations.
- Orange communicates current selection, primary action, and keyboard focus, never decoration.
- Dense layouts remain predictable across chat, libraries, settings, docks, and floating plugin panels.

## Colors

The palette is a warm material system: dark surfaces deepen like ink, text reads like parchment, and accents resemble ember and brass.

### Primary

- **Hearth Orange:** Used for primary actions, active tabs, selected states, and focus treatment. Use its darker companion only for pressed or darkened states.

### Secondary

- **Aged Brass:** Used for secondary emphasis, metadata accents, and quieter category cues. It must not compete with the primary action color.

### Neutral

- **Warm Ink:** The application canvas and the deepest resting layer.
- **Layered Charcoal:** Surface, light surface, and bright surface create structure for panels, editors, and raised controls.
- **Parchment Ink:** The high-emphasis reading color for text and icons.

### Semantic

- **Moss Success** and **Wine Error** are reserved for outcome states. Preserve their semantic role in both themes.

**The Ember Rule.** Primary orange appears only where an element is actionable, focused, selected, or actively progressing. A screen without an active task should remain predominantly neutral.

## Typography

**Display Font:** EB Garamond, Source Serif 4, Noto Serif SC, Georgia, serif.

**Body Font:** Inter, system sans-serif fallbacks, and CJK system fallbacks.

**Label/Mono Font:** Geist Mono and platform monospace fallbacks.

**Character:** Typography separates reading from operating. Elegant serif headings provide a literary anchor, while compact sans-serif labels keep dense workflows efficient and familiar.

### Hierarchy

- **Display:** 600 weight, 1.15 line height, typically 1.45–1.85rem. Use for library and page titles only; italic is permitted for these editorial landmarks.
- **Title:** 600 weight, 0.8125rem or above. Use for panel headers, dialog headings, and floating-window title bars.
- **Body:** 400 weight, 0.875rem, 1.55 line height. This is the default application text.
- **Label:** Compact sans-serif text around 0.8125rem. Use for controls, tabs, metadata, and menu items.
- **Mono:** 500 weight. Use for code, keyboard hints, identifiers, and terse technical metadata.

**The Serif Boundary Rule.** Never use the display face for buttons, form controls, settings labels, or dense data. Serif signals a reading landmark, not an interaction target.

## Elevation

Depth comes first from the warm background-to-surface-to-bright-surface progression, with hairline borders at low opacity. Shadows are reserved for transient or independently movable layers such as dialogs, menus, and floating plugin windows. The standard floating shadow is `0 1rem 2.5rem rgba(0, 0, 0, 0.3)`.

**The Quiet Surface Rule.** Resting panels use tonal separation and a 1px translucent border. Do not add cards inside cards, heavy drop shadows, glass blur, or colored side stripes.

## Components

### Buttons

- **Shape:** Compact, gently squared corners using the small radius (0.25rem) unless a Vuetify component provides an established variant.
- **Primary:** Hearth Orange background with parchment text. Reserve it for the next meaningful action.
- **Secondary / Ghost:** Transparent or quiet surface treatment with readable ink. Icons use the same component vocabulary as text buttons.
- **Hover / Focus:** Hover may use a subtle neutral or primary tint. Keyboard focus uses a 0.125rem primary outline with a visible offset.

### Inputs / Fields

- **Style:** Surface-light fill, 1px low-opacity border, compact UI type, and small radius.
- **Focus:** Shift the border toward primary and add a restrained primary outline. Do not rely on color alone where a border or outline can carry focus.
- **Scrolling:** The page shell never scrolls. Content regions such as chat, library lists, and floating-window bodies own their own thin scrollbars.

### Cards / Containers

- **Corner Style:** Small radius for dense utilities, medium or large radius only for substantial dialogs or editor containers.
- **Background:** Use surface layers to express nesting. Do not invent a new gray for each component.
- **Border:** Hairline borders use `--hair` or `--hair-strong`; accent borders are reserved for clearly selected or focused state.

### Navigation

- **Style:** Rails, tabs, footer controls, and the plugin launcher are compact and icon-led, with labels or accessible names where space allows.
- **State:** Active navigation receives the primary color or a subtle primary tint. Inactive navigation remains neutral.
- **Responsive behavior:** At 40rem and below, docks and dialogs become overlays or full-width surfaces. Floating plugin windows become a bounded full-screen panel, without drag or resize controls.

### Floating Plugin Windows

- **Frame:** Surface background, 1px translucent border, small radius, and restrained elevated shadow.
- **Title bar:** A 2.5rem grab region with icon, compact title, and overflow menu. It is a utility handle, not a decorative header.
- **Interaction:** Windows can move, resize from the lower-right handle, hide, or dock to either rail. Persist placement and size on interaction completion, not continuously during drag.

## Do's and Don'ts

### Do:

- **Do** build surfaces from the existing warm Vuetify theme roles and CSS variables.
- **Do** use the primary color for focus, selection, and the clear next action.
- **Do** keep long reading areas calm, with serif reserved for titles and readable prose.
- **Do** use 40rem as the structural narrow-screen breakpoint for rails, dialogs, and floating surfaces.
- **Do** preserve keyboard-visible focus states and concise accessible labels for icon-only controls.

### Don't:

- **Don't** introduce cool blue-gray neutrals, pure black, or a second unrelated accent palette. Use the existing warm light-theme roles instead of adding arbitrary white surfaces.
- **Don't** use gradient text, decorative glassmorphism, or colored side-stripe borders wider than 1px.
- **Don't** turn every grouping into a card or stack shadows on nested surfaces.
- **Don't** use display serif for operational UI labels, buttons, menus, or form fields.
- **Don't** let fixed or floating elements create document-level scrolling; the application shell stays bounded and scroll ownership belongs to the content region.
