// transfer-widget.js
(() => {
  const template = document.createElement('template');
  template.innerHTML = `
    <style>
      :host { display:block; font-family: Arial, Helvetica, sans-serif; }
      .wrap {
        padding: 8px;
        box-sizing: border-box;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px;
      }
      button.transfer-btn {
        padding: 10px;
        font-size: 14px;
        border-radius: 8px;
        border: 1px solid #ccc;
        background: linear-gradient(#fff,#f6f6f6);
        cursor: pointer;
        height: 56px;
        display:flex;
        align-items:center;
        justify-content:center;
      }
      button.transfer-btn.disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .footer { margin-top:8px; font-size:12px; color:#666 }
      .status { margin-left:8px; font-weight:600; }
    </style>
    <div class="wrap">
      <div class="grid" id="grid"></div>
      <div class="footer">
        <span id="info">Waiting for active call...</span>
      </div>
    </div>
  `;

  class CustomTransferWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({mode:'open'});
      this.shadowRoot.appendChild(template.content.cloneNode(true));
      this.grid = this.shadowRoot.getElementById('grid');
      this.info = this.shadowRoot.getElementById('info');
      this._buttons = [];
      this._desktop = window.Desktop || null; // Desktop SDK object in agent desktop
      this._pollInterval = null;
    }

    connectedCallback() {
      // read config from attribute data-buttons (JSON string)
      const attr = this.getAttribute('data-buttons');
      if (attr) {
        try {
          this._buttons = JSON.parse(attr);
        } catch (e) {
          console.error('transfer-widget: invalid data-buttons JSON', e);
          this.info.textContent = 'Invalid widget configuration (data-buttons).';
          return;
        }
      } else {
        // fallback sample buttons if not provided via layout.json
        this._buttons = [
          { label: "Sales", dest: "+468000111" },
          { label: "Tech", dest: "+468000222" },
          { label: "Billing", dest: "+468000333" }
        ];
      }

      this.renderButtons();
      // Enable periodic check for active call (UI enable/disable); run immediately.
      this.checkActiveCallAndUpdate();
      this._pollInterval = setInterval(() => this.checkActiveCallAndUpdate(), 2000);
    }

    disconnectedCallback() {
      if (this._pollInterval) clearInterval(this._pollInterval);
    }

    renderButtons() {
      this.grid.innerHTML = '';
      this._buttons.forEach((b, idx) => {
        const btn = document.createElement('button');
        btn.className = 'transfer-btn disabled';
        btn.dataset.dest = b.dest || '';
        btn.dataset.idx = String(idx);
        btn.title = b.dest || '';
        btn.innerHTML = `<div><div>${b.label || b.dest}</div><div style="font-size:11px;color:#666">${b.dest}</div></div>`;
        btn.addEventListener('click', (ev) => this.onClickTransfer(ev, b));
        this.grid.appendChild(btn);
      });
    }

    async checkActiveCallAndUpdate() {
      const hasCall = await this._hasActiveTelephonyInteraction();
      const buttons = Array.from(this.grid.querySelectorAll('button.transfer-btn'));
      buttons.forEach(btn => {
        if (hasCall) {
          btn.classList.remove('disabled');
          btn.disabled = false;
        } else {
          btn.classList.add('disabled');
          btn.disabled = true;
        }
      });
      this.info.textContent = hasCall ? 'Active call detected — buttons enabled.' : 'No active telephony call — buttons disabled.';
    }

    async _hasActiveTelephonyInteraction() {
      // Returns true if Desktop.actions.getTaskMap shows a telephony task that isn't terminated
      try {
        const Desktop = window.Desktop || this._desktop;
        if (!Desktop || !Desktop.actions || !Desktop.actions.getTaskMap) {
          // not running inside agent desktop; can't detect call
          return false;
        }
        const taskMap = await Desktop.actions.getTaskMap();
        if (!taskMap) return false;
        for (const [key, task] of taskMap.entries()) {
          // Some desktop versions put interactionId inside value; use either key or value.interactionId
          const media = task && (task.mediaType || task.media);
          const isTerminated = task && (task.isTerminated || task.state === 'ended' || task.state === 'wrapup');
          if ((media === 'telephony' || media === 'telephony' || (task && task.mediaChannel === 'telephony')) && !isTerminated) {
            return true;
          }
        }
        return false;
      } catch (err) {
        console.warn('transfer-widget: checkActiveTelephony error', err);
        return false;
      }
    }

    async getCurrentInteractionId() {
      // Returns the best guess interactionId for the current telephony task
      try {
        const Desktop = window.Desktop || this._desktop;
        if (!Desktop || !Desktop.actions || !Desktop.actions.getTaskMap) return null;
        const taskMap = await Desktop.actions.getTaskMap(); // Map
        for (const [key, task] of taskMap.entries()) {
          const interactionId = (task && task.interactionId) || key;
          const media = task && (task.mediaType || task.media || task.mediaChannel);
          const isTerminated = task && (task.isTerminated || task.state === 'ended' || task.state === 'wrapup');
          if ((media === 'telephony' || media === 'telephony') && !isTerminated) {
            return interactionId;
          }
        }
        // fallback: return first interaction id present
        for (const [key, task] of taskMap.entries()) {
          const interactionId = (task && task.interactionId) || key;
          if (interactionId) return interactionId;
        }
        return null;
      } catch (err) {
        console.warn('transfer-widget: getCurrentInteractionId error', err);
        return null;
      }
    }

    async onClickTransfer(event, buttonCfg) {
      event.preventDefault();
      const dest = buttonCfg.dest;
      if (!dest) return;
      // disable button to avoid double clicks
      const btn = event.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      btn.classList.add('disabled');
      const origLabel = btn.innerHTML;
      btn.innerHTML = 'Transferring...';

      try {
        const Desktop = window.Desktop || this._desktop;
        if (!Desktop || !Desktop.agentContact || !Desktop.agentContact.blindTransfer) {
          throw new Error('Desktop SDK agentContact.blindTransfer is not available. This widget must run inside the Webex Contact Center Agent Desktop.');
        }

        const interactionId = await this.getCurrentInteractionId();
        if (!interactionId) throw new Error('No active interaction found. Accept or start a telephony call before transferring.');

        // call blindTransfer. For a DN transfer we send destAgentDN and mediaType telephony
        const payload = {
          interactionId,
          data: {
            destAgentDN: String(dest),
            mediaType: 'telephony'
          }
        };

        // If your environment requires agentId/orig metadata you can add here:
        // payload.data.agentId = (Desktop && Desktop.store && Desktop.store.latestData && Desktop.store.latestData.agent && Desktop.store.latestData.agent.agentId) || undefined;

        const resp = await Desktop.agentContact.blindTransfer(payload);
        // You can log resp for debugging
        console.debug('blindTransfer response', resp);

        // quick success UX: short success text
        btn.innerHTML = 'Transferred';
        setTimeout(() => { btn.innerHTML = origLabel; }, 1200);
      } catch (err) {
        console.error('Transfer failed', err);
        btn.innerHTML = 'Error';
        setTimeout(() => { btn.innerHTML = origLabel; }, 1500);
        // Show a visible error in footer
        this.info.textContent = 'Transfer failed: ' + (err.message || 'unknown');
      } finally {
        // re-enable after short delay
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove('disabled');
        }, 600);
      }
    }
  }

  if (!customElements.get('custom-transfer-widget')) {
    customElements.define('custom-transfer-widget', CustomTransferWidget);
  }
})();
