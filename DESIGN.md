# Social Publisher Design

The app's look follows the owner's Aeolyzer design system (`C:\Users\Muham\Aeolyzer\frontend\DESIGN.md`,
version 30 October 2026). This file holds the application rules that apply here. Aeolyzer's marketing,
blog, homepage-motion and logo rules do not apply: Social Publisher is an internal tool with its own name.

When a rule here is silent, read the Aeolyzer file's application sections (3 to 6, 8, 12) before inventing one.

## Direction

Restrained flat surfaces, fine 1px dividers, dense readable type, and one accent: parrot.
Light and dark both work, following the system setting.

## Color

**Parrot: `#b8ff2c`.** Used for focus rings, selection boundaries and washes, the primary button's hover
fill, live dots and badges. Solid parrot always carries dark text (`#151414`). Parrot is never small text
on white, and no olive or lime variants are added.

| Role (Tailwind token) | Light | Dark |
| --- | --- | --- |
| Page / panel (`page`) | `#ffffff` | `#151414` |
| Main text (`foreground`) | `#262626` | `#f0e3de` |
| Secondary surface, sidebar (`surface`, `sidebar`) | `#fdfdfc` | `#191817` |
| Floating surface (`floating`) | `#ffffff` | `#191817` |
| Hover surface (`hover`) | `#f9f7f6` | `#2a2927` |
| Quiet border (`border`) | `#f0f0f0` | `#f0e3de20` |
| Form boundary (`input`) | `#cccccc` | `#504d4b` |
| Muted text (`muted`) | `#707070` | `#b4aaa6` |
| Placeholder (`placeholder`) | `#727272` | `#a99d97` |
| Primary fill / label (`primary`, `primary-foreground`) | `#262626` / `#ffffff` | `#f0e3de` / `#151414` |
| Primary hover fill / label (`parrot`, `parrot-ink`) | `#b8ff2c` / `#151414` | same |
| Selected label (`selected-ink`) | `#262626` | `#b8ff2c` |
| Selected wash (`selected-soft`) | parrot at 10% | parrot at 6% |
| Selected boundary (`selected-border`) | `#b8ff2c` | parrot at 35% |
| Danger fill / label (`danger`, `danger-foreground`) | `#c32935` / `#ffffff` | `#f2a8b5` / `#311f22` |
| Warning (`warning`) | `#bb934b` | `#d8bb8f` |

Tokens live in `src/app/globals.css`. Components use tokens, never new literal colors.

- **Information notes** (a result, work in progress, a hint) use the selected family: parrot boundary,
  selected wash, main-text label, a 6px parrot dot that pulses while work is live.
- **Problems** use the warning and danger families.
- Color is never the only cue for a state: pair it with a label or icon.

## Typography

Inter for the UI, JetBrains Mono for code. Control and navigation labels use weight 500.
Tabular numerals for aligned numbers.

| Role | Size / line height |
| --- | --- |
| Compact labels and data (`text-xs`) | 12px / 16px |
| Sidebar and supporting UI (`text-sm`) | 13px / 15.294px |
| Body and standard controls (`text-base`) | 14px / 21px |
| Larger UI (`text-lg`) | 16px / 24px |

No normal labels or tables below 12px.

## Geometry

| Family | Rule |
| --- | --- |
| Standard button / input / select | 36px high, 6px corners, 14px text; button padding 12px; label lifted 2px |
| Small action | 26px high, 6px corners, 12px text, padding 8px |
| Large control | 40px high, 6px corners, 14px text, padding 16px |
| Data panel | Square corners, quiet 1px boundary, flat surface, quiet internal dividers |
| Choice card | 6px corners; neutral boundary, then parrot boundary and selected wash when chosen |
| Information note | 6px corners, 1px boundary, 12px / 20px text, 6px dot |
| Dialog | 12px corners, 1px boundary; widths 288 / 384 / 512 / 768px; 64px from the top |
| Checkbox / radio | 16px; checkbox 4px corners |
| Status pill, dots | Circular |

Primary button: neutral fill, turning parrot with dark text on hover. Floating menus and dialogs may
carry restrained elevation; panels stay flat. Do not stack duplicate borders.

## Navigation

Sidebar: 280px wide, sidebar surface, quiet right border. Rows are 34px high with 13px / 500 labels,
6px corners, 12px horizontal padding, 10px icon gap and a 14px outer inset. The active row uses the
neutral hover surface. Page tabs, when a screen needs them, are square 38px triggers with a 2px parrot
underline for the selected one, never rounded pills.

## Behavior

- Keyboard focus is always visible: a 2px parrot ring, plus a 1px neutral outline offset 3px in light mode.
- Every control shows hover, focus, pressed, selected and disabled states. Disabled controls do nothing.
- An empty screen says why it is empty and what to do next. Missing values show `—`, never a fake zero.
- Tables and long rows scroll inside their own wrappers; the page never widens. Flex children use `min-w-0`.
- Respect reduced-motion settings.
- Check changes at 375, 768, 1280 and 1536px, in light and dark.
