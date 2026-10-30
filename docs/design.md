# Oyee design language

Oyee uses **Gluon's design language** (`~/Desktop/github-repos/gluon`, `packages/kit/styles/tokens.css`): a warm
paper palette, white panels on a soft ground, near-black ink, pill buttons, light-blue selection, and **blue reserved for
the brand mark, unread times and counts, and send buttons**. The three clients implement the same tokens and
components. (The accent is Oyee's own "Ocean blue" since 2026-10-29; Gluon's is orange. The peach avatar tint became slate at the same time, so nothing stays orange.)

| | Web | macOS | Android |
|---|---|---|---|
| Tokens | `apps/web/src/index.css` (CSS variables + Tailwind theme; zinc is remapped to the warm neutrals) | `OyeeKit/Views/Theme.swift` (`Theme.*`, dynamic light/dark) | `ui/theme/Theme.kt` (`Oyee.colors`) |
| Components | `components/ui.tsx`, `NotificationCard.tsx` | `Theme.swift`, `NotificationCardView.swift` | `ui/components/OyeeComponents.kt` |
| Font | `@fontsource-variable/figtree` | `Resources/Fonts/Figtree.ttf` (registered at launch) | `res/font/figtree.ttf` |

## Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| ground | `#f3f2ef` | `#131211` | app background behind panels |
| background | `#ffffff` | `#1e1c1a` | panels, rows |
| foreground | `#1c1b19` | `#f1ede6` | ink: text, primary buttons, progress |
| card | `#f7f6f3` | `#262421` | soft cards inside a panel |
| brand / brand-fg | `#1f6feb` / `#ffffff` | `#58a6ff` / `#0d1b2e` | the Oyee mark, unread time/dot/count, send, create buttons |
| chip / chip-fg | `#dde9fb` / `#1e4e9a` | `#16294a` / `#a9c9f7` | selected filter, tab pill, your reply bubbles |
| thread | `#f7f4ef` | `#181614` | conversation background |
| bubble | `#ffffff` | `#2b2825` | the notification card in a conversation, composer |
| secondary | `#f3f2ef` | `#2b2825` | soft buttons, chips, search field |
| muted / faint | `#6b675f` / `#a8a39a` | `#a39d92` / `#6e685f` | secondary text / placeholders |
| border / row-selected | `#ece9e3` | `#302d29` / `#35312d` | hairlines / selected row |
| secondary-label | `#44403c` | `#d6d0c6` | unread previews, labels |

Severity: critical `#dc2626`, warning `#d97706`, info `#3b82f6`, success `#16a34a`. Severity appears only
as a soft pill on the card and, for critical and warning only, a small dot on the source avatar; never as a stripe or
background. Info gets no avatar dot because blue in a list row means unread and nothing else.

Avatars use six pastel tints with matching ink (`#E4E8EF/#334155`, `#D5F0EC/#0F5F57`, `#E2ECFB/#1E4E9A`,
`#E3F2E1/#2F6B2A`, `#F9D3DE/#9D174D`, `#EDE4F7/#5B21B6`), picked by `hash = hash * 31 + codepoint` over the source name,
so a source has the same color everywhere.

## Type and shape

- **Figtree** for everything; **JetBrains Mono** for tokens and IDs (web). Titles are large and bold with tight tracking
  (page title 24–30, card title 18 bold, row title 15 semibold, body 14–15).
- Panels have 22px corners on the ground; rows 16px; bubbles 22px with one 6px corner toward the speaker.
- Buttons are pills: **primary** ink, **brand** blue (create / send), **secondary** soft fill, **ghost** quiet. They
  scale to 0.96 when pressed.
- Progress bars are ink on a light track (critical is red).

## Layout

- **Web:** 76px rail (brand mark, sections with icon + label, the active one on a white tile with a blue count),
  content in a rounded white panel. Phones get a bottom tab bar with a light-blue pill behind the active icon.
- **Inbox:** large title with round search / mark-all-read buttons (no filter chips; filters set elsewhere show as
  dismissible pills), quiet sentence-case section labels (Needs you, In progress, Updates), rows with avatar (+ red or
  amber dot), title, a grey count for stacked repeats, time (blue while unread), preview and a blue unread dot. A ✓
  button replaces the time on hover; rows swipe right to resolve on touch.
- **Conversation detail:** header (source avatar, recipients, delete), the card as a white bubble with Resolve in its
  footer under a hairline (kept apart from the agent's buttons), updates and
  resolution as quiet centered lines, responses as light-blue bubbles on the right with the device name, and a composer with
  a blue round send button when the card has a reply box.
- **macOS:** the inbox window is the ground with two 22pt panels (list, conversation); the menu-bar popover has the
  brand header, compact rows and a pill footer.
- **Android:** Gluon's mobile header (large title, live state, round Settings button), pills, rows and the same
  conversation view. The system notification shade is drawn by Android; Oyee sets the blue accent.
- **Settings (macOS, Android):** Gluon's settings layout. Large bold title with a muted description, an account card
  (avatar, email, server, this device, connection, reconnect / unpair), bold section headings, and rows with a semibold
  title, a muted description and the control on the right, separated by hairlines. Switches use Gluon's style: grey
  track, green when on, white thumb. On macOS, `oyee://settings` opens the window.
