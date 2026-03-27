# BendGen

## Quick Reference

- **Run dev server:** `cd BendGen && source .venv/bin/activate && python -m bendgen.app` → http://localhost:5050
- **Build release:** Push a `v*` tag — GitHub Actions builds all platforms
- **Version:** Update both `bendgen/app.py` (VERSION) and `pyproject.toml` before tagging

## Project Structure

```
bendgen/
  app.py              — Flask routes, all API endpoints, VERSION constant
  models.py           — Pydantic models (Bend, Program, Die, Punch, Material) + validation
  generator.py        — ZIP generation, GSON-compatible JSON serialization
  merge.py            — Import/merge existing BendControl backups
  backup_name.py      — BendControl-compatible filename generation (B<yyMMddHHmm><name>.zip)
  stock_tooling.py    — Stock dies, punches, materials with gauge tables
  dxf_analyzer.py     — DXF flat-pattern parsing, bend detection, SVG preview generation
  image_analyzer.py   — OCR-based image analysis (optional, requires pytesseract)
  static/
    app.js            — Entire frontend SPA (~2500 lines vanilla JS)
    style.css         — Dark theme CSS (~1000 lines)
  templates/
    index.html        — Main SPA template
    help.html         — Self-contained help page with inline styles and sidebar nav
bendgen_app.py        — PyInstaller entry point (opens browser, starts server)
bendgen.spec          — PyInstaller build spec
build-dist.sh         — Local build script (macOS)
install-pi.sh         — Raspberry Pi installer
pyproject.toml        — Python project metadata and dependencies
.github/workflows/
  build-release.yml   — CI: builds Win/Mac/Linux on tag push, creates GitHub release
```

## Code Conventions

- **No frontend framework** — vanilla JS, no build step. All UI in app.js.
- **All dimensions in inches internally.** Frontend converts to/from mm for display using `currentUnit` and `MM_PER_INCH`.
- **GSON compatibility is critical.** The ZIP must match BendControl's Java serialization exactly — field order, date format, UUID format all matter. See `generator.py`.
- **State is a global dict** (`_state` in app.py). Persisted to `~/.bendgen/data.json` on every mutation.
- **Stock tooling is immutable** — users can't delete stock items, only add custom ones.

## USB Bridge Integration

The BendGen frontend talks directly to the USB Drive Bridge (separate repo) via cross-origin fetch. No backend proxy. Key JS functions are at the bottom of `app.js`:
- `deployToTitan()` — exports ZIP, POSTs to bridge `/api/deploy`
- `importFromTitan()` — GETs file list from bridge `/api/backups`, downloads selected file, POSTs to BendGen `/api/import`
- Bridge address stored in `localStorage` under key `bendgen_bridge_address`

## Common Tasks

**Add a new API endpoint:** Add route in `app.py`, call it from `app.js` via fetch.

**Add a new bend field:** Update `Bend` model in `models.py`, add to `bend_to_dict()` in `generator.py`, add input in `index.html` template, wire in `app.js` (both form and table views), add to `collectBendsFromActiveView()`.

**Update stock tooling:** Edit `stock_tooling.py`. Stock items have fixed UUIDs — don't change them.

**Bump version:** Update `VERSION` in `app.py` and `version` in `pyproject.toml`, commit, tag `v{X.Y.Z}`, push tag.
