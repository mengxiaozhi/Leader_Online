# Design QA — 後台左側側邊欄

## Comparison target

- Source visual truth: `Web/design/admin-sidebar-reference-2026-08-31.png`
- Implementation screenshot: `Web/design/admin-sidebar-implementation-1440x1024.png`
- Full-view comparison: `Web/design/admin-sidebar-comparison.png`
- Focused sidebar comparison: `Web/design/admin-sidebar-comparison-focused.png`
- Mobile evidence: `Web/design/admin-sidebar-mobile-390x844.png`
- Mobile task-sheet evidence: `Web/design/admin-sidebar-mobile-task-sheet-390x844.png`
- Route and state: authenticated mock admin, `/admin?tab=courses`, 課程營運總覽, expanded desktop sidebar, light theme
- Viewport: desktop CSS viewport `1440 x 1024`; mobile CSS viewport `390 x 844`
- Density normalization: source pixels `1487 x 1058` normalized to `1440 x 1024`; implementation pixels `1440 x 1024`; desktop browser capture used device scale factor `1`

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- Accepted product constraint: the reference simplifies the work queue to three rows, while the implementation retains five real operational queues. This preserves current business-task visibility without changing the navigation or visual system.
- Accepted density choice: the implementation keeps the requested 248px navigation track and slightly tighter row height than the generated reference so all course tasks fit within a 1024px-high desktop viewport.

## Required fidelity surfaces

- Fonts and typography: system sans-serif stack, heading weight, compact navigation scale, line height, and truncation match the existing Leader design system and the reference hierarchy. No text clipping was observed.
- Spacing and layout rhythm: persistent left rail, flexible main column, title/action row, four-column metrics, queue dividers, and active navigation alignment match the reference. Sidebar content remains fully visible at the target desktop viewport.
- Colors and visual tokens: brand red, pale-red active fill, charcoal text, white structural surfaces, neutral page background, and thin gray rules align with the reference. No gradients or decorative shadows were introduced.
- Image quality and asset fidelity: the existing Leader logo is preserved. Navigation and action icons use the product's existing `AppIcon` library; no emoji, placeholder graphics, or handcrafted replacement assets were introduced.
- Copy and content: the reference labels are implemented for the sidebar and page command bar. Real task labels, counts, and queue descriptions are preserved where the generated mock was intentionally simplified.

## Interaction and responsive evidence

- Desktop sidebar collapse and expand were exercised successfully; the state persists locally and layout changes without slow or decorative motion.
- Sidebar task navigation opened `/admin/courses/operations` from 課務中心.
- Top-level 商品與檔期 navigation opened `/admin?tab=products`.
- Mobile keeps the compact top-level navigation and an accessible bottom task sheet; the task sheet opened and displayed all four course task groups.
- The final desktop preview is restored to `/admin?tab=courses`.

## Comparison history

### Iteration 1

- Earlier finding: P2 — the implementation split the queue with a duplicate 常用工作 column, changing the reference's main-region proportion and repeating routes already exposed in the new sidebar.
- Fix: removed the duplicate 常用工作 block and expanded 營運待辦 to the full content width.
- Earlier finding: P2 — the last 系統 tasks required sidebar scrolling at the target viewport.
- Fix: tightened high-frequency navigation rows and section spacing while preserving 38–40px row targets, clear grouping, and keyboard focus treatment.
- Post-fix evidence: `Web/design/admin-sidebar-comparison.png` and `Web/design/admin-sidebar-comparison-focused.png` show the full-width queue and complete expanded sidebar.

## Follow-up polish

- P3: the generated reference uses a double-chevron collapse glyph, while the implementation uses the closest existing product icon (`arrow-left`) to avoid adding a parallel icon style.

## Final result

final result: passed
