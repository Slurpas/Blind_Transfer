// widget-entry.js
// Entry point for Quick Transfers widget — bundle this with @wxcc-desktop/sdk
import { Desktop } from "@wxcc-desktop/sdk";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display:block; font-family: Arial, Helvetica, sans-serif; }
    .wrap { padding: 12px; box-sizing: border-box; }
    .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
    button.qt { padding: 10px; border-radius: 6px; background:#007AA3; color:#fff; border: none; cursor:pointer; min-height:48px; }
    button.qt:disabled { background: #cfcfcf; cursor: not-allowed; color: #666; }
    .info { margin-top:8px; font-size:12px; color:#666; }
  </style>
  <div class="wrap">
    <div class="grid" id="grid"></div>
    <div class="info" id="info">Initializing...</div>
  </div>
`;

class QuickTransfersSDKWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this.grid = this.shadowRoot.getElementById("grid");
    this.info = this.shadowRoot.getElementById("info");
    this.buttons = [];
    this.initialized = false;
  }

  async connectedCallback() {
    // Read config
    try {
      const cfg = this.getAttribute("data-buttons");
      if (cfg) this.buttons = JSON.parse(cfg);
    } catch (err) {
      console.error("[QuickTransfers] Invalid data-buttons JSON", err);
      this.info.textContent = "Invalid configuration";
      return;
    }

    // Render button placeholders
    this.renderButtons();

    // Initialize Desktop SDK — this is the critical step (matches sample)
    try {
      // Desktop.config.init() must be called from the widget context
      // to initialize the SDK bridge & get agentContact APIs.
      Desktop.config.init();
      this.info.textContent = "Desktop SDK initialising...";
      // We wait for Desktop to have the actions API available
      await this.waitForDesktopReady(5000);
      this.initialized = true;
      this.info.textContent = "Ready — accept a telephony call to enable transfers.";
      console.info("[QuickTransfers] Desktop SDK ready");
    } catch (err) {
      console.error("[QuickTransfers] Desktop SDK init failed", err);
      this.info.textContent = "Desktop SDK not available in this context.";
      // keep buttons disabled
      this.enableButtons(false);
      return;
    }

    // Start a small poll to enable/disable buttons based on active telephony task
    this.poller = setInterval(() => this.updateButtonState(), 1500);
    // update immediately
    await this.updateButtonState();
  }

  disconnectedCallback() {
    if (this.poller) clearInterval(this.poller);
  }

  renderButtons() {
    this.grid.innerHTML = "";
    if (!Array.isArray(this.buttons) || this.buttons.length === 0) {
      this.grid.innerHTML = "<div style='grid-column:1/-1;color:#666'>No buttons configured</div>";
      return;
    }

    this.buttons.forEach((b, i) => {
      const btn = document.createElement("button");
      btn.className = "qt";
      btn.dataset.idx = String(i);
      btn.innerHTML = `<div style="font-weight:600">${b.label || b.dest}</div><div style="font-size:12px;color:#eee">${b.dest}</div>`;
      btn.disabled = true; // enabled once a telephony interaction is detected
      btn.addEventListener("click", () => this.doBlindTransfer(i));
      this.grid.appendChild(btn);
    });
  }

  enableButtons(enable) {
    Array.from(this.grid.querySelectorAll("button.qt")).forEach(btn => {
      btn.disabled = !enable;
    });
  }

  async waitForDesktopReady(timeout = 5000) {
    // Wait until Desktop.actions exists (like sample uses)
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (Desktop && Desktop.actions && typeof Desktop.actions.getTaskMap === "function") return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error("Desktop SDK not available");
  }

  async updateButtonState() {
    if (!this.initialized) return;
    try {
      const taskMap = await Desktop.actions.getTaskMap();
      let hasTelephony = false;
      for (const [key, task] of taskMap.entries()) {
        const media = task.mediaType || task.media || task.mediaChannel;
        const terminated = task.isTerminated || task.state === "ended" || task.state === "wrapup";
        if ((media === "telephony" || media === "voice") && !terminated) {
          hasTelephony = true;
          break;
        }
      }
      this.enableButtons(hasTelephony);
      this.info.textContent = hasTelephony ? "Active call — buttons enabled" : "No active telephony call — buttons disabled";
    } catch (err) {
      console.warn("[QuickTransfers] getTaskMap failed", err);
      this.info.textContent = "Cannot read task map";
      this.enableButtons(false);
    }
  }

  async getCurrentInteractionId() {
    const taskMap = await Desktop.actions.getTaskMap();
    for (const [key, task] of taskMap.entries()) {
      const media = task.mediaType || task.media || task.mediaChannel;
      const terminated = task.isTerminated || task.state === "ended" || task.state === "wrapup";
      if ((media === "telephony" || media === "voice") && !terminated) {
        return task.interactionId || key;
      }
    }
    // fallback: first key
    for (const [key, task] of taskMap.entries()) {
      return task.interactionId || key;
    }
    return null;
  }

  async doBlindTransfer(idx) {
    const cfg = this.buttons[idx];
    if (!cfg || !cfg.dest) {
      alert("No destination configured for this button");
      return;
    }
    const dest = String(cfg.dest);

    if (!Desktop || !Desktop.agentContact || !Desktop.agentContact.blindTransfer) {
      alert("Transfer failed: desktop SDK not available.");
      console.error("[QuickTransfers] Missing Desktop.agentContact.blindTransfer");
      return;
    }

    let interactionId = null;
    try {
      interactionId = await this.getCurrentInteractionId();
      if (!interactionId) throw new Error("No active interaction");
    } catch (err) {
      console.error("[QuickTransfers] Could not determine interaction id", err);
      alert("Transfer failed: no active call.");
      return;
    }

    // Temporarily update UI
    const btns = Array.from(this.grid.querySelectorAll("button.qt"));
    const btn = btns[idx];
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "Transferring...";

    try {
      // Use same semantics as sample: Desktop.agentContact.blindTransfer
      const resp = await Desktop.agentContact.blindTransfer({
        interactionId,
        data: {
          destAgentId: dest,
          mediaType: "telephony",
          destinationType: "DN"
        }
      });
      console.info("[QuickTransfers] blindTransfer response", resp);
      btn.innerHTML = "Transferred";
      setTimeout(() => btn.innerHTML = origText, 1200);
    } catch (err) {
      console.error("[QuickTransfers] blindTransfer failed", err);
      alert("Transfer failed: " + (err.message || JSON.stringify(err)));
      btn.innerHTML = origText;
    } finally {
      // re-check current call state soon
      setTimeout(() => this.updateButtonState(), 700);
    }
  }
}

if (!customElements.get("quick-transfers-widget")) {
  customElements.define("quick-transfers-widget", QuickTransfersSDKWidget);
  console.log("[QuickTransfers] quick-transfers-widget registered");
}
