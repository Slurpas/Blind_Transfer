// transfer-widget.js

class QuickTransferWidget extends HTMLElement {
  connectedCallback() {
    let buttons = [];
    try {
      const cfg = this.getAttribute("data-buttons");
      if (cfg) {
        buttons = JSON.parse(cfg);
      }
    } catch (e) {
      console.error("[QuickTransfers] Invalid JSON in data-buttons:", e);
    }

    // Insert styles and buttons
    const style = `
      <style>
        .qt-container { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px; }
        .qt-button {
          flex: 1 0 30%; min-width: 120px;
          padding: 10px; background: #007AA3; color: white; border: none;
          border-radius: 6px; font-size: 14px; cursor: pointer;
          transition: background 0.2s ease;
        }
        .qt-button:hover { background: #005F7A; }
        .qt-button:disabled { background: #ccc; cursor: not-allowed; }
      </style>
    `;

    this.innerHTML = `
      ${style}
      <div class="qt-container">
        ${buttons.map((b, i) => `<button class="qt-button" data-idx="${i}">${b.label}</button>`).join("")}
      </div>
    `;

    this.querySelectorAll(".qt-button").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        const idx = ev.currentTarget.getAttribute("data-idx");
        const dest = buttons[idx]?.dest;
        if (!dest) {
          console.error("[QuickTransfers] No destination for button idx", idx);
          return;
        }
        console.log(`[QuickTransfers] Requesting blind transfer to ${dest}`);

        // Try to find the Desktop SDK object
        const Desktop = window.Desktop || (window.top && window.top.Desktop);
        if (!Desktop || !Desktop.agentContact || !Desktop.agentContact.vteamTransfer) {
          console.error("[QuickTransfers] Desktop SDK or transfer API not available");
          alert("Transfer failed: desktop SDK not available.");
          return;
        }

        // Get current interaction ID from task map
        let interactionId = null;
        try {
          const taskMap = await Desktop.actions.getTaskMap();
          for (const [key, t] of taskMap.entries()) {
            const media = t.mediaType || t.media || t.mediaChannel;
            const terminated = t.isTerminated || t.state === "ended" || t.state === "wrapup";
            if ((media === "telephony") && !terminated) {
              interactionId = t.interactionId || key;
              break;
            }
          }
          if (!interactionId) {
            throw new Error("No active telephony interaction found");
          }
        } catch (e) {
          console.error("[QuickTransfers] Could not find active interaction:", e);
          alert("Transfer failed: no active call.");
          return;
        }

        // Perform blind transfer (they may call it vteamTransfer)
        try {
          await Desktop.agentContact.vteamTransfer({
            interactionId,
            data: {
              destAgentDN: String(dest),
              mediaType: "telephony"
            }
          });
          console.log(`[QuickTransfers] Transfer invoked to ${dest}`);
        } catch (err) {
          console.error("[QuickTransfers] vteamTransfer error:", err);
          alert("Transfer failed: " + (err.message || JSON.stringify(err)));
        }
      });
    });
  }
}

if (!customElements.get("custom-widget")) {
  customElements.define("custom-widget", QuickTransferWidget);
  console.log("[QuickTransfers] custom-widget defined");
}
