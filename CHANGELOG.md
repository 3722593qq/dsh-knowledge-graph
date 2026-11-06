# Changelog

All notable changes to `dsh-knowledge-graph` are recorded here. The format follows Keep a Changelog and the project uses semantic versioning.

## [0.1.2] - 2026-11-06

### Changed

- Replaced every documentation screenshot with the sanitized set supplied by the maintainer.
- Re-encoded screenshots as PNG and removed embedded EXIF metadata.

## [0.1.1] - 2026-11-06

### Added

- Delete the currently opened wiki page from the note header, with an inline second confirmation.
- Deleting a page removes references to it from other pages, rewrites `index.md`, appends to `log.md`, and refreshes the graph.
- A running organizer queue blocks deletion so a queued model job cannot recreate the page.

### Fixed

- Duplicate `资料补充` entries are deduplicated by link target.
- Obvious plugin/tool pages are no longer misclassified as people or events.

## [0.1.0] - 2026-11-06

### Added

- Obsidian-compatible vault under the DSH data directory: `资料/`, `wiki/{概念,人物,事物,事件}/`, `index.md`, `log.md`.
- Selection floating button, context menu, assistant-message save icon, and user-message context menu.
- Serial background organizer using the current model, with retryable failures, full index rewrites, append-only log, and reciprocal `[[ ]]` links.
- Sidebar knowledge graph with a frame-by-frame force simulation, local graph depth 1–5, search highlighting, zoom, pan, node dragging, and fit-to-window.
- Read-only Agent tools: `knowledge_index`, `knowledge_read`, `knowledge_search`, `knowledge_graph`.
- Global Agent rule requiring index-first reading and `知识来源：[[wiki/...]]` citation.
