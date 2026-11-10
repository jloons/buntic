class InteractiveCard extends HTMLElement {
  connectedCallback() {
    this.dataset.initialized = "true";
  }
}

if (!customElements.get("interactive-card")) {
  customElements.define("interactive-card", InteractiveCard);
}
