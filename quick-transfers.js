// quick-transfers.js — Quick Transfers header widget (no build step required)
// Registers <agentx-qt-transfers-widget>
// Loads @wxcc-desktop/sdk from a CDN at runtime (window.Desktop is not exposed by the Desktop)

(function () {
  "use strict";

  const TAG = "agentx-qt-transfers-widget";
  const LOG = "[QuickTransfers]";

  if (customElements.get(TAG)) {
    console.log(LOG, "already defined, skipping");
    return;
  }

  // ---------------------------------------------------------------------------
  // SDK loading (shared by all widget instances)
  // ---------------------------------------------------------------------------
  const SDK_URLS = [
    "https://cdn.jsdelivr.net/npm/@wxcc-desktop/sdk/+esm",
    "https://esm.sh/@wxcc-desktop/sdk"
  ];

  let sdkPromise = null;
  function loadDesktop() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = (async () => {
      if (window.Desktop && window.Desktop.agentContact) {
        console.log(LOG, "Using window.Desktop");
        return window.Desktop;
      }
      for (const url of SDK_URLS) {
        try {
          const mod = await import(url);
          const D = mod.Desktop || (mod.default && (mod.default.Desktop || mod.default)) || null;
          if (D && D.agentContact) {
            console.log(LOG, "SDK loaded from", url);
            return D;
          }
          console.warn(LOG, "Module loaded but no Desktop export found:", url);
        } catch (e) {
          console.warn(LOG, "SDK load failed from", url, e);
        }
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
        console.log(LOG, "SDK initialized");
        return true;
      } catch (e) {
        console.error(LOG, "Desktop.config.init failed", e);
        return false;
      }
    })();
    return initPromise;
  }

  // ---------------------------------------------------------------------------
  // Template
  // ---------------------------------------------------------------------------
  const template = document.createElement("template");
  template.innerHTML = `
    <style>
      :host { display: block; }
      .qt-root { display: block; }
      .qt-container { display:flex; flex-wrap:wrap; gap:8px; padding:10px; }
      .qt-button {
        flex: 1 0 30%; min-width:120px; padding:10px;
        background:#007AA3; color:#fff; border:none; border-radius:6px;
        font-size:14px; cursor:pointer; transition:background 0.2s ease;
      }
      .qt-button:hover:not(:disabled) { background:#005F7A; }
      .qt-button:disabled { background:#ccc; cursor:not-allowed; }
      #status { font-size:12px; color:#666; margin-top:8px; }

      /* ---------- compact / header mode ---------- */
      :host([compact]) { display:flex; align-items:center; height:100%; }
      :host([compact]) .qt-root {
        display:flex; flex-direction:row; align-items:center; gap:8px; height:100%;
      }
      :host([compact]) .qt-container {
        flex-wrap:nowrap; padding:0; gap:6px; align-items:center;
      }
      :host([compact]) .qt-button {
        flex:0 0 auto; min-width:0; padding:6px 12px;
        font-size:13px; height:32px; line-height:1; white-space:nowrap;
      }
      :host([compact]) #status { display:none; }
    </style>
    <div class="qt-root">
      <div class="qt-container" id="btns"></div>
      <div id="status">Starting…</div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // Widget
  // ---------------------------------------------------------------------------
  class QuickTransfersWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot.appendChild(template.content.cloneNode(true));
      this._buttons = [];
      this._D = null;
      this._busy = false;
      this._poll = null;
      this._boundUpdate = this.updateButtons.bind(this);
      this._events = [
        "eAgentContact",
        "eAgentContactAssigned",
        "eAgentContactEnded",
        "eAgentContactWrappedUp",
        "eAgentOfferContact",
        "eAgentWrapup"
      ];
    }

    connectedCallback() {
      this._statusEl = this.shadowRoot.getElementById("status");
      this._btnsDiv = this.shadowRoot.getElementById("btns");

      const cfg = this.getAttribute("data-buttons");
      try {
        this._buttons = cfg ? JSON.parse(cfg) : [];
      } catch (e) {
        console.warn(LOG, "invalid data-buttons JSON", e);
        this._buttons = [];
      }

      this.renderButtons();
      this.start();
    }

    disconnectedCallback() {
      clearInterval(this._poll);
      const D = this._D;
      if (D && D.agentContact && D.agentContact.removeEventListener) {
        this._events.forEach(evt => {
          try { D.agentContact.removeEventListener(evt, this._boundUpdate); } catch (e) {}
        });
      }
    }

    _setStatus(text) {
      if (this._statusEl) this._statusEl.textContent = text;
      this.title = "Quick Transfers: " + text;
    }

    _escape(s = "") {
      return String(s).replace(/[&<>"'`]/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])
      );
    }

    renderButtons() {
      if (!this._buttons.length) {
        this._btnsDiv.innerHTML = `<div style="color:#666">No buttons configured</div>`;
        return;
      }
      this._btnsDiv.innerHTML = this._buttons
        .map((b, i) =>
          `<button class="qt-button transfer-btn" data-idx="${i}" disabled>${this._escape(b.label)}</button>`)
        .join("");
      this._btnsDiv.querySelectorAll(".transfer-btn").forEach(btn => {
        btn.addEventListener("click", ev => {
          const idx = parseInt(ev.currentTarget.getAttribute("data-idx"), 10);
          const b = this._buttons[idx];
          if (!b || !b.dest) {
            alert("Transfer destination not configured");
            return;
          }
          this.handleTransfer(String(b.dest).trim(), b.label);
        });
      });
    }

    async start() {
      this._setStatus("Loading SDK…");
      const D = await loadDesktop();
      if (!D) {
        this._setStatus("SDK could not be loaded (see console)");
        return;
      }
      this._D = D;

      await initDesktop(D);

      if (D.agentContact && D.agentContact.addEventListener) {
        this._events.forEach(evt => {
          try { D.agentContact.addEventListener(evt, this._boundUpdate); } catch (e) {}
        });
      }

      clearInterval(this._poll);
      this._poll = setInterval(this._boundUpdate, 2000);

      this.updateButtons();
    }

    // Returns interactionId of the first active telephony task, or null
    async _findActiveCall() {
      const D = this._D;
      if (!D || !D.actions || typeof D.actions.getTaskMap !== "function") return null;

      let map;
      try {
        map = await D.actions.getTaskMap();
      } catch (e) {
        console.warn(LOG, "getTaskMap failed", e);
        return null;
      }
      if (!map) return null;

      const entries = map instanceof Map ? Array.from(map.entries()) : Object.entries(map);
      for (const [key, task] of entries) {
        if (!task) continue;
        const i = task.interaction || {};
        const media = task.mediaType || i.mediaType || task.mediaChannel;
        if (media !== "telephony") continue;

        const state = String(task.state || i.state || "").toLowerCase();
        const ended = ["ended", "wrapup", "wrap_up", "closed", "terminated"].includes(state);
        if (ended || task.isTerminated || i.isTerminated || task.isWrapUp) continue;

        return task.interactionId || i.interactionId || key;
      }
      return null;
    }

    async updateButtons() {
      if (this._busy) return;
      const btns = this.shadowRoot.querySelectorAll(".transfer-btn");
      const interactionId = await this._findActiveCall();
      const active = !!interactionId;
      btns.forEach(b => (b.disabled = !active));
      this._setStatus(active ? "Active call" : "No active call");
    }

    async handleTransfer(dest, label) {
      const D = this._D;
      if (!D || !D.agentContact || typeof D.agentContact.blindTransfer !== "function") {
        alert("Transfer API not available.");
        return;
      }

      const interactionId = await this._findActiveCall();
      if (!interactionId) {
        alert("No active call to transfer.");
        return;
      }

      const btns = this.shadowRoot.querySelectorAll(".transfer-btn");
      this._busy = true;
      btns.forEach(b => (b.disabled = true));
      this._setStatus(`Transferring to ${label || dest}…`);
      console.log(LOG, "Blind transfer", { interactionId, dest });

      try {
        // Verified working format for dial-number (DN) blind transfer
        await D.agentContact.blindTransfer({
          interactionId,
          data: {
            destAgentId: dest,
            destinationType: "DN",
            mediaType: "telephony"
          }
        });
        console.log(LOG, "Transfer succeeded to", dest);
        this._setStatus(`Transferred to ${label || dest}`);
      } catch (err) {
        console.error(LOG, "Transfer failed", err);
        const msg =
          (err && err.details && err.details.msg && err.details.msg.errorMessage) ||
          (err && err.message) ||
          JSON.stringify(err);
        alert("Transfer failed: " + msg);
        this._setStatus("Transfer failed");
      } finally {
        this._busy = false;
        this.updateButtons();
      }
    }
  }

  customElements.define(TAG, QuickTransfersWidget);
  console.log(LOG, TAG, "defined (v3)");
})();
