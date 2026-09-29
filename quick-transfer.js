// quick-transfers.js — no build step required
(function () {
  if (customElements.get("agentx-qt-transfers-widget")) {
    console.log("[QuickTransfers] already defined, skipping");
    return;
  }

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
      .qt-button:hover { background:#005F7A; }
      .qt-button:disabled { background:#ccc; cursor:not-allowed; }
      #status { font-size:12px; color:#666; margin-top:8px; }

      /* compact / header mode */
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

  class QuickTransfersWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot.appendChild(template.content.cloneNode(true));
      this._buttons = [];
      this._boundUpdate = this.updateButtons.bind(this);
    }

    connectedCallback() {
      this._statusEl = this.shadowRoot.getElementById("status");
      this._btnsDiv = this.shadowRoot.getElementById("btns");

      const cfg = this.getAttribute("data-buttons");
      try {
        if (cfg) this._buttons = JSON.parse(cfg);
      } catch (e) {
        console.warn("[QuickTransfers] invalid data-buttons JSON", e);
        this._buttons = [];
      }

      this.renderButtons();
      this.initWidget();
    }

    disconnectedCallback() {
      try {
        const d = this._getDesktop();
        if (d && d.agentContact && d.agentContact.removeEventListener) {
          d.agentContact.removeEventListener("eAgentContactUpdated", this._boundUpdate);
          d.agentContact.removeEventListener("eAgentContactStarted", this._boundUpdate);
          d.agentContact.removeEventListener("eAgentContactEnded", this._boundUpdate);
        }
      } catch (e) {}
    }

    _escape(s = "") {
      return String(s).replace(/[&<>"'`]/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])
      );
    }

    _getDesktop() {
      return (typeof window !== "undefined" && (window.Desktop || (window.top && window.top.Desktop))) || null;
    }

    renderButtons() {
      if (!this._buttons.length) {
        this._btnsDiv.innerHTML = `<div style="color:#666">No buttons configured</div>`;
        return;
      }
      this._btnsDiv.innerHTML = this._buttons
        .map((b, i) => `<button class="qt-button transfer-btn" data-idx="${i}" disabled>${this._escape(b.label)}</button>`)
        .join("");
      this._btnsDiv.querySelectorAll(".transfer-btn").forEach(btn => {
        btn.addEventListener("click", ev => {
          const idx = parseInt(ev.currentTarget.getAttribute("data-idx"), 10);
          const dest = this._buttons[idx] && this._buttons[idx].dest;
          if (!dest) { alert("Transfer destination not configured"); return; }
          this.handleTransfer(dest);
        });
      });
    }

    async initWidget() {
      const d = this._getDesktop();
      if (!d) {
        this._statusEl.textContent = "SDK not available (window.Desktop undefined)";
        return;
      }
      try {
        if (d.config && typeof d.config.init === "function") await d.config.init();
        this._statusEl.textContent = "SDK initialized";
      } catch (err) {
        console.error("[QuickTransfers] SDK init failed", err);
        this._statusEl.textContent = "SDK init failed";
        return;
      }
      try {
        if (d.agentContact && d.agentContact.addEventListener) {
          d.agentContact.addEventListener("eAgentContactUpdated", this._boundUpdate);
          d.agentContact.addEventListener("eAgentContactStarted", this._boundUpdate);
          d.agentContact.addEventListener("eAgentContactEnded", this._boundUpdate);
        }
      } catch (e) {}
      this.updateButtons();
    }

    async updateButtons() {
      const d = this._getDesktop();
      const btns = this.shadowRoot.querySelectorAll(".transfer-btn");
      if (!d) {
        btns.forEach(b => (b.disabled = true));
        this._statusEl.textContent = "No active call (SDK not available)";
        return;
      }
      try {
        if (d.agentContact && typeof d.agentContact.getSelectedContact === "function") {
          const contact = d.agentContact.getSelectedContact();
          const active = !!(contact && contact.mediaType === "telephony");
          btns.forEach(b => (b.disabled = !active));
          this._statusEl.textContent = active ? "Active call detected" : "No active call";
          return;
        }
        if (d.actions && typeof d.actions.getTaskMap === "function") {
          const map = await d.actions.getTaskMap();
          let found = false;
          if (map) for (const [, t] of map) if (t && t.mediaType === "telephony") { found = true; break; }
          btns.forEach(b => (b.disabled = !found));
          this._statusEl.textContent = found ? "Active call detected" : "No active call";
          return;
        }
      } catch (e) {
        console.warn("[QuickTransfers] updateButtons error", e);
      }
      btns.forEach(b => (b.disabled = true));
      this._statusEl.textContent = "No active call";
    }

    async getInteractionIdFallback() {
      const d = this._getDesktop();
      if (!d || !d.actions || typeof d.actions.getTaskMap !== "function") return null;
      try {
        const map = await d.actions.getTaskMap();
        if (!map) return null;
        for (const [, t] of map) if (t && t.interactionId) return t.interactionId;
      } catch (e) {}
      return null;
    }

    async handleTransfer(dest) {
      const d = this._getDesktop();
      if (!d) { alert("Desktop SDK not available — cannot transfer."); return; }
      try {
        let contact = null;
        if (d.agentContact && typeof d.agentContact.getSelectedContact === "function") {
          contact = d.agentContact.getSelectedContact();
        }
        let interactionId = (contact && contact.interactionId) || (await this.getInteractionIdFallback());
        if (!interactionId) throw new Error("No active call available to transfer");

        if (d.agentContact && typeof d.agentContact.blindTransfer === "function") {
          await d.agentContact.blindTransfer({
            interactionId,
            data: { to: String(dest), destinationType: "DN", mediaType: "telephony" }
          });
          this._statusEl.textContent = `Transfer attempted to ${dest}`;
          return;
        }
        throw new Error("blindTransfer API not available");
      } catch (err) {
        console.error("[QuickTransfers] Transfer failed", err);
        alert("Transfer failed: " + (err.message || String(err)));
        this._statusEl.textContent = "Transfer failed";
      }
    }
  }

  customElements.define("agentx-qt-transfers-widget", QuickTransfersWidget);
  console.log("[QuickTransfers] agentx-qt-transfers-widget defined");
})();
