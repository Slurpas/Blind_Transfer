// src/widget-entry.js
// Quick Transfers widget - robust, Cisco-style usage of the Desktop SDK
// - registers element: <agentx-qt-transfers-widget>
// - reads JSON from attribute data-buttons (same as layout attributes)
// - uses SDK when available; falls back gracefully and reports status

import * as WXSDK from "@wxcc-desktop/sdk"; // keep the import so builds that externalize work

// Resolve Desktop object from multiple bundling patterns:
//  - WXSDK.default  (if bundler put Desktop as default export)
//  - WXSDK.Desktop  (if bundler exposed named export)
//  - WXSDK (if externals mapping returned the Desktop object directly)
//  - window.Desktop (last-resort runtime global)
const Desktop = (WXSDK && (WXSDK.default || WXSDK.Desktop || WXSDK)) || (typeof window !== "undefined" ? window.Desktop : undefined);

const template = document.createElement("template");
template.innerHTML = `
  <style>
    .qt-container { display:flex; flex-wrap:wrap; gap:8px; padding:10px; }
    .qt-button {
      flex: 1 0 30%;
      min-width:120px;
      padding:10px;
      background:#007AA3;
      color:#fff;
      border:none;
      border-radius:6px;
      font-size:14px;
      cursor:pointer;
      transition:background 0.2s ease;
    }
    .qt-button:hover { background:#005F7A; }
    .qt-button:disabled { background:#ccc; cursor:not-allowed; }
    #status { font-size:12px; color:#666; margin-top:8px; }
  </style>
  <div>
    <div class="qt-container" id="btns"></div>
    <div id="status">Starting…</div>
  </div>
`;

class QuickTransfersWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this._buttons = [];
    this._boundUpdate = this.updateButtons.bind(this);
    this._logger = console;
  }

  connectedCallback() {
    this._statusEl = this.shadowRoot.getElementById("status");
    this._btnsDiv = this.shadowRoot.getElementById("btns");

    // Read configuration (attributes). Layout uses "attributes.data-buttons".
    let cfg = this.getAttribute("data-buttons") || this.dataset.buttons;
    try {
      if (cfg) this._buttons = JSON.parse(cfg);
    } catch (e) {
      console.warn("[QuickTransfers] invalid data-buttons JSON", e);
      this._buttons = [];
    }

    this.renderButtons();
    // Initialize SDK (if available) or fallbacks
    this.initWidget();
  }

  disconnectedCallback() {
    // unregister listeners (defensive)
    try {
      const d = this._getDesktop();
      if (d && d.agentContact && d.agentContact.removeEventListener) {
        d.agentContact.removeEventListener("eAgentContactUpdated", this._boundUpdate);
        d.agentContact.removeEventListener("eAgentContactStarted", this._boundUpdate);
        d.agentContact.removeEventListener("eAgentContactEnded", this._boundUpdate);
      }
    } catch (e) { /* ignore */ }
  }

  renderButtons() {
    if (!this._buttons || this._buttons.length === 0) {
      this._btnsDiv.innerHTML = `<div style="color:#666">No buttons configured</div>`;
      return;
    }
    this._btnsDiv.innerHTML = this._buttons.map((b, i) => `<button class="qt-button transfer-btn" data-idx="${i}" disabled>${this._escape(b.label)}</button>`).join("");
    this._btnsDiv.querySelectorAll(".transfer-btn").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        const idx = parseInt(ev.currentTarget.getAttribute("data-idx"), 10);
        const dest = this._buttons[idx] && this._buttons[idx].dest;
        if (!dest) {
          alert("Transfer destination not configured");
          return;
        }
        this.handleTransfer(dest);
      });
    });
  }

  _escape(s='') {
    return String(s).replace(/[&<>"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;', '`':'&#96;'}[c]));
  }

  _getDesktop() {
    // prefer resolved Desktop variable, then runtime global
    return (typeof Desktop !== "undefined" && Desktop) || (typeof window !== "undefined" && window.Desktop) || null;
  }

  async initWidget() {
    const d = this._getDesktop();
    if (!d) {
      // No Desktop object available in this context — likely wrong layout placement
      this._statusEl.textContent = "SDK not available in this context (window.Desktop undefined)";
      this._logger.warn && this._logger.warn("[QuickTransfers] window.Desktop not found in this context.");
      // leave buttons disabled; still allow UI shown so admin can detect
      return;
    }

    // Try to init the SDK (many Cisco examples call Desktop.config.init())
    try {
      if (d.config && typeof d.config.init === "function") {
        // call init but don't fail catastrophically if it throws
        await d.config.init();
      }
      // create logger if available
      if (d.logger && d.logger.createLogger) {
        try { this._logger = d.logger.createLogger("quick-transfers-widget"); } catch(e) { this._logger = console; }
      }
      this._statusEl.textContent = "SDK initialized";
    } catch (err) {
      console.error("[QuickTransfers] SDK init failed", err);
      this._statusEl.textContent = "SDK init failed";
      return;
    }

    // Register contact events if available
    try {
      if (d.agentContact && d.agentContact.addEventListener) {
        d.agentContact.addEventListener("eAgentContactUpdated", this._boundUpdate);
        d.agentContact.addEventListener("eAgentContactStarted", this._boundUpdate);
        d.agentContact.addEventListener("eAgentContactEnded", this._boundUpdate);
      }
    } catch (e) { /* ignore */ }

    // initial enable/disable of buttons
    this.updateButtons();
  }

  async updateButtons() {
    const d = this._getDesktop();
    const btns = this.shadowRoot.querySelectorAll(".transfer-btn");
    if (!d) {
      btns.forEach(b => b.disabled = true);
      this._statusEl.textContent = "No active call (SDK not available)";
      return;
    }

    try {
      // Preferred API: getSelectedContact()
      if (d.agentContact && typeof d.agentContact.getSelectedContact === "function") {
        const contact = d.agentContact.getSelectedContact();
        const active = !!(contact && contact.mediaType === "telephony");
        btns.forEach(b => b.disabled = !active);
        this._statusEl.textContent = active ? "Active call detected" : "No active call";
        return;
      }

      // Fallback: scan taskMap
      if (d.actions && typeof d.actions.getTaskMap === "function") {
        const map = await d.actions.getTaskMap();
        let found = false;
        if (map) {
          for (const [, task] of map) {
            if (task && task.mediaType === "telephony") { found = true; break; }
          }
        }
        btns.forEach(b => b.disabled = !found);
        this._statusEl.textContent = found ? "Active call detected" : "No active call";
        return;
      }
    } catch (e) {
      console.warn("[QuickTransfers] updateButtons fallback error", e);
    }

    // Default: disable
    btns.forEach(b => b.disabled = true);
    this._statusEl.textContent = "No active call";
  }

  async getInteractionIdFallback() {
    const d = this._getDesktop();
    if (!d || !d.actions || typeof d.actions.getTaskMap !== "function") return null;
    try {
      const map = await d.actions.getTaskMap();
      if (!map) return null;
      for (const [, task] of map) {
        if (task && task.interactionId) return task.interactionId;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async handleTransfer(dest) {
    const d = this._getDesktop();
    if (!d) {
      alert("Desktop SDK not available — cannot transfer.");
      return;
    }

    try {
      // Try preferred flow: getSelectedContact
      let contact = null;
      if (d.agentContact && typeof d.agentContact.getSelectedContact === "function") {
        contact = d.agentContact.getSelectedContact();
      }

      let interactionId = contact && contact.interactionId;
      if (!interactionId) interactionId = await this.getInteractionIdFallback();

      if (!interactionId) throw new Error("No active call available to transfer");

      if (d.agentContact && typeof d.agentContact.blindTransfer === "function") {
        await d.agentContact.blindTransfer({
          interactionId,
          data: {
            destAgentId: dest,
            mediaType: "telephony",
            destinationType: "DN"
          }
        });
        this._statusEl.textContent = `Transfer attempted to ${dest}`;
        return;
      }

      throw new Error("blindTransfer API not available on Desktop.agentContact");
    } catch (err) {
      console.error("[QuickTransfers] Transfer failed", err);
      alert("Transfer failed: " + (err.message || String(err)));
      this._statusEl.textContent = "Transfer failed: " + (err.message || "unknown");
    }
  }
}

customElements.define("agentx-qt-transfers-widget", QuickTransfersWidget);
