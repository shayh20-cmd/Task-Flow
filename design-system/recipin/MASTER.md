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

## Palettes (switchable, `<html data-theme>`)
| id | name | primary | accent | bg | source row |
|---|---|---|---|---|---|
| terracotta (default) | טרקוטה | `#9A3412` | `#2F7D5B` | `#FFF8EE` | #97 Recipe & Cooking App |
| cafe | קפה ומאפה | `#92400E` | `#4F7A3A` | `#FFF9EC` | #63 Bakery/Cafe |
| wine | יין וענבים | `#7A1F3D` | `#A16207` | `#FCF6F4` | #64 Brewery/Winery |
| market | שוק ירוק | `#3F6B2A` | `#0F766E` | `#F7F8EF` | #50 Agriculture/Farm (olive-shifted) |
| sea | ים תיכון | `#1D4E89` | `#2F7D5B` | `#F6F8FB` | custom, Mediterranean |
Each has a separate dark-mode set. Kashrut colors (meat/dairy/parve) stay fixed across palettes so their meaning never changes.

## Style variant: Minimal (`data-theme="minimal"`, `public/theme-minimal.css`)
Inspired by minimal fintech mobile UI: canvas `#F5F4F0`, white cards with 1px hairline `#E7E4DE` and no clay shadow,
near-black pill CTA `#1D1C1A`, pastel tiles (sage `#DFE9DD`, peach `#F6E3D6`, lavender `#E5E2F3`, sky `#DDE9F2`, butter `#F1E7C2`),
single family (Assistant) for headings and body, flat hero without illustration, outlined chips and step numbers.
