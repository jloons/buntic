class VersionViewer extends HTMLElement {
  connectedCallback() {
    const card = this.shadowRoot?.querySelector("#card");
    const buttons = this.shadowRoot?.querySelectorAll(".mode-btn");

    buttons?.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-mode");
        if (mode && card) {
          card.setAttribute("data-mode", mode);
          buttons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        }
      });
    });
  }
}

customElements.define("version-viewer", VersionViewer);
