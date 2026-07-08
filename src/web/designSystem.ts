/**
 * Shared visual language for every page this service renders (CRM deal tab + admin panel),
 * lifted from the Claude Design handoff ("Промо блок - Redesign.dc.html", option 1d "Гибрид").
 * Palette/typography mirror Bitrix24's own look so the pages feel native inside the portal.
 */
export const DESIGN_SYSTEM_CSS = `
  :root {
    --bg: #f5f7f8;
    --surface: #ffffff;
    --text: #333d47;
    --text-secondary: #828b95;
    --text-muted: #a8b1ba;
    --text-faint: #c3cad1;
    --border: #e1e5e8;
    --border-input: #d5dbe0;
    --accent: #2067b0;
    --accent-hover: #1a568f;
    --accent-bg: #eef4fa;
    --accent-bg-hover: #f2f7fc;
    --success: #1f9d5b;
    --success-bg: #e8f6ee;
    --warning: #d9861b;
    --warning-text: #b06a10;
    --warning-bg: #fdf3e3;
    --warning-bg-soft: #fff8ec;
    --warning-border: #f0d9ae;
    --danger: #d64b4b;
    --danger-text: #c04543;
    --danger-bg: #fbeaea;
    --neutral-chip-bg: #eef1f3;
    --row-hover: #fafbfc;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Open Sans", Arial, sans-serif;
    font-size: 13px;
  }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: var(--text-faint); border-radius: 999px; }

  .ds-h1 { font-size: 16px; font-weight: 700; color: var(--text); margin: 0; }
  .ds-label { font-size: 10.5px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
  .ds-muted { color: var(--text-secondary); font-size: 12px; }

  .ds-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }

  /* Tab bar: underline style, matches Bitrix24 */
  .ds-tabbar { display: flex; gap: 2px; padding: 0 16px; background: var(--surface); border-bottom: 1px solid var(--border); }
  .ds-tab { padding: 11px 14px; font-size: 13px; font-weight: 600; color: var(--text-secondary); cursor: pointer; border-bottom: 2px solid transparent; }
  .ds-tab:hover { color: var(--text); }
  .ds-tab.active { color: var(--text); border-bottom-color: var(--accent); }
  .ds-tab .count { color: var(--text-secondary); font-weight: 500; }

  /* Inputs */
  .ds-input, .ds-select, .ds-textarea {
    width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--border-input);
    border-radius: 4px; font: inherit; font-size: 13px; color: var(--text); background: var(--surface);
  }
  .ds-textarea { resize: vertical; font-family: inherit; }
  .ds-input:focus, .ds-select:focus, .ds-textarea:focus { outline: 2px solid rgba(32,103,176,.15); border-color: var(--accent); }
  .ds-input::placeholder { color: var(--text-muted); }

  /* "Quiet" input: looks like plain text until hover/focus (table cells) */
  .ds-input-quiet {
    width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid transparent; border-radius: 4px;
    font: inherit; font-size: 12.5px; color: var(--text); background: transparent;
  }
  .ds-input-quiet:hover { border-color: var(--border-input); background: var(--surface); }
  .ds-input-quiet:focus { border-color: var(--accent); background: var(--surface); outline: 2px solid rgba(32,103,176,.15); }

  /* Buttons */
  .ds-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 4px; font-size: 12.5px; font-weight: 600; cursor: pointer; border: 1px solid transparent; white-space: nowrap; }
  .ds-btn:disabled { opacity: .45; cursor: not-allowed; }
  .ds-btn-primary { background: var(--accent); color: #fff; }
  .ds-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .ds-btn-outline { background: var(--surface); color: var(--accent); border-color: var(--accent); }
  .ds-btn-outline:hover:not(:disabled) { background: var(--accent-bg-hover); }
  .ds-btn-plain { background: var(--surface); color: var(--text-secondary); border-color: var(--border-input); }
  .ds-btn-plain:hover:not(:disabled) { border-color: var(--text-muted); color: var(--text); }
  .ds-btn-text { background: none; border: none; color: var(--text-secondary); text-decoration: underline; padding: 6px 4px; }
  .ds-btn-danger-text { background: none; border: none; color: var(--danger-text); padding: 6px 4px; cursor: pointer; }
  .ds-btn-badge { padding: 1px 6px; border-radius: 8px; background: var(--warning); font-size: 11px; color: #fff; }

  /* Chips */
  .ds-chip { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 9px; font-size: 11.5px; }
  .ds-chip-neutral { background: var(--neutral-chip-bg); color: #525c69; }
  .ds-chip-accent { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
  .ds-chip-muted { background: var(--neutral-chip-bg); color: var(--text-secondary); font-weight: 600; }
  .ds-chip-remove { cursor: pointer; opacity: .6; }
  .ds-chip-remove:hover { opacity: 1; }

  /* Toggle chips (multi-select pills, e.g. placements) */
  .ds-toggle-chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 11px; font-size: 12px; cursor: pointer; border: 1px solid var(--border-input); color: var(--text-secondary); }
  .ds-toggle-chip:hover { border-color: var(--accent); color: var(--accent); }
  .ds-toggle-chip.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }

  /* Status pills */
  .ds-status { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .ds-status-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .ds-status.active { color: var(--success); } .ds-status.active .ds-status-dot { background: var(--success); }
  .ds-status.expiring { color: var(--warning-text); } .ds-status.expiring .ds-status-dot { background: var(--warning); }
  .ds-status.expired { color: var(--danger-text); } .ds-status.expired .ds-status-dot { background: var(--danger); }
  .ds-status.off { color: var(--text-secondary); } .ds-status.off .ds-status-dot { background: var(--text-muted); }
  .ds-status.draft { color: var(--text-secondary); border: 1px dashed var(--text-faint); border-radius: 10px; padding: 2px 8px; }
  .ds-badge-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 10px; font-size: 11.5px; font-weight: 600; }
  .ds-badge-unsaved { background: var(--warning-bg-soft); border: 1px solid var(--warning-border); color: var(--warning-text); }

  /* Toggle switch (on/off) */
  .ds-switch { display: inline-block; width: 32px; height: 18px; border-radius: 9px; position: relative; cursor: pointer; flex: none; background: var(--text-faint); }
  .ds-switch.on { background: var(--success); }
  .ds-switch .knob { position: absolute; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); left: 2px; transition: left .1s; }
  .ds-switch.on .knob { left: auto; right: 2px; }

  /* Table */
  .ds-table { width: 100%; border-collapse: collapse; background: var(--surface); }
  .ds-table th { padding: 7px 8px; font-size: 10.5px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .05em; text-align: left; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--surface); z-index: 2; }
  .ds-table td { padding: 6px 8px; border-bottom: 1px solid #eef1f3; vertical-align: middle; font-size: 13px; }
  .ds-table tbody tr:hover { background: var(--row-hover); }
  .ds-table tr.dirty { background: #fffdf7; }
  .ds-table tr.dirty > td:first-child { box-shadow: inset 3px 0 0 var(--warning); }
  .ds-table tr.selected { background: var(--accent-bg-hover); }
  .ds-table tr.selected > td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
  .ds-mono { font-family: ui-monospace, Menlo, monospace; color: var(--text-muted); font-size: 10.5px; }

  /* Sticky unsaved-changes bar */
  .ds-unsaved-bar { display: flex; align-items: center; gap: 10px; padding: 9px 16px; background: var(--warning-bg-soft); border-top: 1px solid var(--warning-border); }

  /* Slide-in drawer */
  .ds-drawer { width: 360px; flex: none; background: var(--surface); border-left: 1px solid var(--border); box-shadow: -8px 0 24px rgba(51,61,71,.12); display: flex; flex-direction: column; }
  .ds-drawer-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #eef1f3; }
  .ds-drawer-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
  .ds-drawer-footer { margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid #eef1f3; background: var(--row-hover); }
  .ds-close { color: var(--text-muted); cursor: pointer; font-size: 15px; }
  .ds-close:hover { color: var(--text); }

  /* Details/summary city picker */
  .ds-city-picker summary { cursor: pointer; list-style: none; }
  .ds-city-picker summary::-webkit-details-marker { display: none; }
  .ds-city-picker[open] summary { border-color: var(--accent); }
`;
