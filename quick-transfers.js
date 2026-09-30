// quick-transfers.js — Quick Transfers header widget (no build step required)
// Registers <agentx-qt-transfers-widget>. ALL configuration lives in the desktop layout JSON.
//
// Layout "properties":
//   buttons     Array of { label, dest, color?, group? }   (preferred, no escaping needed)
//   maxVisible  Number of real buttons; the rest go into the "More…" dropdown
//
// Layout "attributes" (alternatives / extras):
//   data-buttons      Same array as an escaped JSON string (fallback)
//   data-max-visible  Same as maxVisible
//   data-rows         "1" (default) or "2" = two rows of smaller buttons in the header
//   data-confirm      "true" = ask "Transfer to X?" before transferring
//   compact           Header mode

(function () {
  "use strict";

  const TAG = "agentx-qt-transfers-widget";
  const LOG = "[QuickTransfers]";
  const VERSION = "v4";

  if (customElements.get(TAG)) return;

  // ---------------------------------------------------------------------------
  // Colors
  // ---------------------------------------------------------------------------
  const PALETTE = {
    blue: "#007AA3", navy: "#1A237E", teal: "#00796B", green: "#1D8A3A",
    lime: "#7CB342", yellow: "#F9A825", orange: "#E65100", red: "#C62828",
    pink: "#AD1457", purple: "#6A1B9A", brown: "#5D4037", grey: "#546E7A", gray: "#546E7A",
    black: "#212121"
  };
  const DEFAULT_COLOR = PALETTE.blue;

  function resolveColor(c) {
    if (!c) return DEFAULT_COLOR;
    const k = String(c).trim().toLowerCase();
    return PALETTE[k] || String(c).trim();
  }

  function textColorFor(bg) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg);
    if (!m) return "#fff";
    let h = m[1];
    if (h.length === 3) h = h.split("").map(x => x + x).join("");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? "#000" : "#fff";
  }

  // ---------------------------------------------------------------------------
  // SDK loading (shared by all instances)
  // ---------------------------------------------------------------------------
  const SDK_URLS = [
    "https://cdn.jsdelivr.net/npm/@wxcc-desktop/sdk/+esm",
    "https://esm.sh/@wxcc-desktop/sdk"
  ];
  let sdkPromise = null;
  function loadDesktop() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = (async () => {
      if (window.Desktop && window.Desktop.agentContact) return window.Desktop;
      for (const url of SDK_URLS) {
        try {
          const mod = await import(url);
          const D = mod.Desktop || (mod.default && (mod.default.Desktop || mod.default)) || null;
          if (D && D.agentContact) { console.log(LOG, "SDK loaded from", url); return D; }
        } catch (e) { console.warn(LOG, "SDK load failed from", url, e); }
      }
      return null;
    })();
    return sdkPromise;
  }
  let initPromise = null;
  function initDesktop(D) {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        if (D.config && typeof D.config.init === "function") {
          await D.config.init({ widgetName: "quick-transfers", widgetProvider: "Axis" });
        }
      } catch (e) { console.error(LOG, "Desktop.config.init failed", e); }
    })();
    return initPromise;
  }

  // ---------------------------------------------------------------------------
  // Template
  // ---------------------------------------------------------------------------
  const template = document.createElement("template");
  template.innerHTML = `
    <style>
      :host { display:block; }
      .qt-root { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:10px; }
      .qt-buttons { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
      .qt-button {
        background:var(--qt-bg, #007AA3); color:var(--qt-fg, #fff);
        border:none; border-radius:6px; padding:10px 14px; font-size:14px;
        cursor:pointer; white-space:nowrap; transition:filter .15s ease, opacity .15s ease;
      }
      .qt-button:hover:not(:disabled) { filter:brightness(0.88); }
      .qt-button:disabled { opacity:.4; cursor:not-allowed; }
      .qt-more {
        padding:8px; border-radius:6px; border:1px solid #007AA3; background:#fff;
        color:#005F7A; font-size:14px; cursor:pointer; max-width:220px;
      }
      .qt-more:disabled { opacity:.5; cursor:not-allowed; }
      #status { font-size:12px; color:#666; width:100%; }

      /* ---------- compact / header mode ---------- */
      :host([compact]) { display:flex; align-items:center; height:100%; }
      :host([compact]) .qt-root { flex-wrap:nowrap; padding:0; gap:6px; height:100%; }
      :host([compact]) .qt-buttons { flex-wrap:nowrap; gap:6px; }
      :host([compact]) .qt-button { height:32px; padding:0 12px; font-size:13px; line-height:1; }
      :host([compact]) .qt-more { height:32px; padding:0 8px; font-size:13px; }
      :host([compact]) #status { display:none; }

      /* ---------- two rows inside the header ---------- */
      :host([compact][data-rows="2"]) .qt-buttons {
        display:grid; grid-template-rows:repeat(2, 24px);
        grid-auto-flow:column; gap:3px 6px;
      }
      :host([compact][data-rows="2"]) .qt-button { height:24px; padding:0 10px; font-size:11.5px; border-radius:4px; }
    </style>
    <div class="qt-root">
      <div class="qt-buttons" id="btns"></div>
      <div id="more"></div>
      <div id="status">Starting…</div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // Widget
  // ---------------------------------------------------------------------------
  class QuickTransfersWidget extends HTMLElement {
    static get observedAttributes() { return ["data-buttons", "data-max-visible", "data-rows"]; }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot.appendChild(template.content.cloneNode(true));
      this._btnsDiv = this.shadowRoot.getElementById("btns");
      this._moreDiv = this.shadowRoot.getElementById("more");
      this._statusEl = this.shadowRoot.getElementById("status");
      this._list = [];
      this._active = false;
      this._busy = false;
      this._D = null;
      this._poll = null;
      this._boundUpdate = this.updateButtons.bind(this);
      this._events = ["eAgentContact", "eAgentContactAssigned", "eAgentContactEnded",
                      "eAgentContactWrappedUp", "eAgentOfferContact", "eAgentWrapup"];
    }

    // Layout "properties" may be set before this script loads; re-apply them
    _upgradeProperty(p) {
      if (Object.prototype.hasOwnProperty.call(this, p)) {
        const v = this[p]; delete this[p]; this[p] = v;
      }
    }

    get buttons() { return this._buttonsProp; }
    set buttons(v) {
      if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { v = null; } }
      this._buttonsProp = Array.isArray(v) ? v : null;
      if (this.isConnected) this.renderButtons();
    }
    get maxVisible() { return this._maxVisibleProp; }
    set maxVisible(v) {
      const n = parseInt(v, 10);
      this._maxVisibleProp = isNaN(n) ? undefined : n;
      if (this.isConnected) this.renderButtons();
    }

    attributeChangedCallback() { if (this.isConnected) this.renderButtons(); }

    connectedCallback() {
      this._upgradeProperty("buttons");
      this._upgradeProperty("maxVisible");
      this.renderButtons();
      this.start();
    }

    disconnectedCallback() {
      clearInterval(this._poll);
      const D = this._D;
      if (D && D.agentContact && D.agentContact.removeEventListener) {
        this._events.forEach(evt => { try { D.agentContact.removeEventListener(evt, this._boundUpdate); } catch (e) {} });
      }
    }

    _getList() {
      let list = this._buttonsProp;
      if (!Array.isArray(list) || !list.length) {
        try { list = JSON.parse(this.getAttribute("data-buttons") || "[]"); } catch (e) { list = []; }
      }
      return (Array.isArray(list) ? list : []).filter(b => b && b.label && b.dest);
    }

    _getMaxVisible() {
      if (typeof this._maxVisibleProp === "number") return Math.max(0, this._maxVisibleProp);
      const a = parseInt(this.getAttribute("data-max-visible"), 10);
      if (!isNaN(a)) return Math.max(0, a);
      return this.getAttribute("data-rows") === "2" ? 10 : 5;
    }

    _escape(s = "") {
      return String(s).replace(/[&<>"'`]/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
    }

    _colorStyle(b) {
      const bg = resolveColor(b.color);
      const fg = b.textColor || textColorFor(bg);
      return { bg, fg };
    }

    renderButtons() {
      this._list = this._getList();
      if (!this._list.length) {
        this._btnsDiv.innerHTML = `<div style="color:#666">No destinations configured</div>`;
        this._moreDiv.innerHTML = "";
        return;
      }

      const max = this._getMaxVisible();
      const visible = this._list.slice(0, max);
      const overflow = this._list.slice(max).map((b, j) => ({ b, idx: max + j }));

      // Buttons
      this._btnsDiv.innerHTML = visible.map((b, i) => {
        const { bg, fg } = this._colorStyle(b);
        return `<button class="qt-button qt-ctl" data-idx="${i}"
                  style="--qt-bg:${this._escape(bg)};--qt-fg:${this._escape(fg)}"
                  title="${this._escape(b.label + " – " + b.dest)}">${this._escape(b.label)}</button>`;
      }).join("");

      this._btnsDiv.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", ev => {
          this._transferIdx(parseInt(ev.currentTarget.getAttribute("data-idx"), 10));
        });
      });

      // "More…" dropdown (optionally grouped)
      if (overflow.length) {
        const opt = ({ b, idx }) => {
          const { bg, fg } = this._colorStyle(b);
          return `<option value="${idx}" style="background:${this._escape(bg)};color:${this._escape(fg)}">${this._escape(b.label)}</option>`;
        };
        const groups = new Map();
        const ungrouped = [];
        overflow.forEach(o => {
          if (o.b.group) {
            if (!groups.has(o.b.group)) groups.set(o.b.group, []);
            groups.get(o.b.group).push(o);
          } else ungrouped.push(o);
        });
        let inner = ungrouped.map(opt).join("");
        groups.forEach((items, name) => {
          inner += `<optgroup label="${this._escape(name)}">${items.map(opt).join("")}</optgroup>`;
        });

        this._moreDiv.innerHTML =
          `<select class="qt-more qt-ctl" title="More transfer destinations">
             <option value="" selected>More… (${overflow.length})</option>${inner}
           </select>`;
        const sel = this._moreDiv.querySelector("select");
        sel.addEventListener("change", () => {
          const idx = parseInt(sel.value, 10);
          sel.value = "";
          if (!isNaN(idx)) this._transferIdx(idx);
        });
      } else {
        this._moreDiv.innerHTML = "";
      }

      this._setControlsEnabled(this._active && !this._busy);
    }

    _transferIdx(idx) {
      const b = this._list[idx];
      if (!b) return;
      if (this.getAttribute("data-confirm") === "true" &&
          !confirm(`Transfer call to ${b.label} (${b.dest})?`)) return;
      this.handleTransfer(String(b.dest).trim(), b.label);
    }

    _setStatus(text) {
      this._statusEl.textContent = text;
      this.title = "Quick Transfers: " + text;
    }

    _setControlsEnabled(on) {
      this.shadowRoot.querySelectorAll(".qt-ctl").forEach(el => (el.disabled = !on));
    }

    async start() {
      this._setStatus("Loading SDK…");
      const D = await loadDesktop();
      if (!D) { this._setStatus("SDK could not be loaded (see console)"); return; }
      this._D = D;
      await initDesktop(D);
      if (D.agentContact && D.agentContact.addEventListener) {
        this._events.forEach(evt => { try { D.agentContact.addEventListener(evt, this._boundUpdate); } catch (e) {} });
      }
      clearInterval(this._poll);
      this._poll = setInterval(this._boundUpdate, 2000);
      this.updateButtons();
    }

    async _findActiveCall() {
      const D = this._D;
      if (!D || !D.actions || typeof D.actions.getTaskMap !== "function") return null;
      let map;
      try { map = await D.actions.getTaskMap(); } catch (e) { return null; }
      if (!map) return null;
      const entries = map instanceof Map ? Array.from(map.entries()) : Object.entries(map);
      for (const [key, task] of entries) {
        if (!task) continue;
        const i = task.interaction || {};
        const media = task.mediaType || i.mediaType || task.mediaChannel;
        if (media !== "telephony") continue;
        const state = String(task.state || i.state || "").toLowerCase();
        if (["ended", "wrapup", "wrap_up", "closed", "terminated"].includes(state)) continue;
        if (task.isTerminated || i.isTerminated || task.isWrapUp) continue;
        return task.interactionId || i.interactionId || key;
      }
      return null;
    }

    async updateButtons() {
      if (this._busy) return;
      this._active = !!(await this._findActiveCall());
      this._setControlsEnabled(this._active);
      this._setStatus(this._active ? "Active call" : "No active call");
    }

    async handleTransfer(dest, label) {
      const D = this._D;
      if (!D || !D.agentContact || typeof D.agentContact.blindTransfer !== "function") {
        alert("Transfer API not available."); return;
      }
      const interactionId = await this._findActiveCall();
      if (!interactionId) { alert("No active call to transfer."); return; }

      this._busy = true;
      this._setControlsEnabled(false);
      this._setStatus(`Transferring to ${label || dest}…`);
      try {
        await D.agentContact.blindTransfer({
          interactionId,
          data: { destAgentId: dest, destinationType: "DN", mediaType: "telephony" }
        });
        console.log(LOG, "Transfer succeeded to", dest);
        this._setStatus(`Transferred to ${label || dest}`);
      } catch (err) {
        console.error(LOG, "Transfer failed", err);
        alert("Transfer failed: " + (err?.details?.msg?.errorMessage || err?.message || JSON.stringify(err)));
        this._setStatus("Transfer failed");
      } finally {
        this._busy = false;
        this.updateButtons();
      }
    }
  }

  customElements.define(TAG, QuickTransfersWidget);
  console.log(LOG, TAG, "defined (" + VERSION + ")");
})();
