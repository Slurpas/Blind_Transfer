// transfer-widget.js

class QuickTransferWidget extends HTMLElement {
  connectedCallback() {
    // Parse button configuration from data-buttons attribute
    let buttons = [];
    try {
      const config = this.getAttribute("data-buttons");
      if (config) {
        buttons = JSON.parse(config);
      }
    } catch (err) {
      console.error("[QuickTransfers] Invalid data-buttons JSON:", err);
    }

    // Basic styling
    const style = `
      <style>
        .qt-container {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 10px;
        }
        .qt-button {
          flex: 1 0 30%;
          min-width: 120px;
          padding: 10px;
          background: #007AA3;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.2s ease;
        }
        .qt-button:hover {
          background: #005F7A;
        }
        .qt-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
      </style>
    `;

    // Render buttons
    this.innerHTML = `
      ${style}
      <div class="qt-container">
        ${buttons
          .map(
            (b, i) =>
              `<button class="qt-button" data-index="${i}">${b.label}</button>`
          )
          .join("")}
      </div>
    `;

    // Attach click listeners
    this.querySelectorAll(".qt-button").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const idx = e.target.getAttribute("data-index");
        const dest = buttons[idx]?.dest;

        if (!dest) {
          console.error("[QuickTransfers] No destination found for button", idx);
          return;
        }

        console.log(`[QuickTransfers] Attempting blind transfer to ${dest}`);

        try {
          if (
            window?.AgentX?.invoke &&
            typeof window.AgentX.invoke === "function"
          ) {
            await window.AgentX.invoke(
              "TelephonyService:blindTransfer",
              { address: dest }
            );
            console.log(`[QuickTransfers] Blind transfer triggered to ${dest}`);
          } else {
            console.error(
              "[QuickTransfers] AgentX API not available. Transfer not possible."
            );
            alert(
              "Transfer failed: AgentX API not available. Are you running inside Webex CC?"
            );
          }
        } catch (err) {
          console.error("[QuickTransfers] Blind transfer failed:", err);
          alert("Transfer failed: " + err.message);
        }
      });
    });
  }
}

// Register widget so Webex Desktop knows how to render it
if (!customElements.get("custom-widget")) {
  customElements.define("custom-widget", QuickTransferWidget);
  console.log("[QuickTransfers] custom-widget registered successfully");
}
