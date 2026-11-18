# Recipin – Design System (Master)

Source: UI/UX Pro Max (nextlevelbuilder/ui-ux-pro-max-skill), data row **#97 "Recipe & Cooking App"**
(`products.csv`, `colors.csv`, `ui-reasoning.csv`), RTL level: `full`.

## Direction: "Soft Clay Kitchen"
- **Style:** Claymorphism + Vibrant & Block-based, toned down for adults: soft multi-layer shadows, rounded 16–32px, soft press (scale 0.96, spring easing).
- **Avoid (per skill):** muted colors / low energy, emoji as icons, placeholder-only labels, hover-only interactions.
- **Must-have features (per skill):** checkable ingredients and steps, serving adjuster, per-step timer, cooking mode (screen awake + large text), save/bookmark, share.

## Color tokens (light)
| Token | Value | Use |
|---|---|---|
| primary | `#9A3412` terracotta | CTAs, active states (white text 7.3:1) |
| accent | `#2F7D5B` sage | done/checked, auto-tags |
| bg | `#FFF8EE` cream | page |
| surface | `#FFFFFF` | cards |
| ink / ink-2 | `#2A1A12` / `#6B5446` | text (both ≥ 4.5:1 on bg) |
| butter | `#F7D774` | timers |
| meat / dairy / parve | `#B42318` / `#1D5FA8` / `#2F7D5B` | kashrut badges (Israeli convention: red/blue/green) |
Dark mode has its own token set in `public/styles.css` (not derived from light).

## Typography (self-hosted, Hebrew subsets)
- Display: **Fredoka** 500–700 (rounded, friendly, has Hebrew)
- Body: **Assistant** 400–700 (17px base, line-height 1.55)
- Personal notes: **Gveret Levin** (handwriting, "recipe card" feel)

## Icons
Lucide (ISC), one stroke weight (2px), sprite at `public/icons.svg`. Sizes: 16 / 20 / 24.

## Layout
- Mobile ≤760px: floating bottom tab bar (5 items, raised "+" in the middle), bottom-sheet dialogs, 2-column masonry.
- Desktop: top nav + primary CTA, 5-column masonry.
- Touch targets ≥ 44px; `prefers-reduced-motion` disables motion.
