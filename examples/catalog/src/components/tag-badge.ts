class TagBadge extends HTMLElement {
  connectedCallback() {
    const badge = this.shadowRoot?.querySelector("#badge");
    const hint = this.shadowRoot?.querySelector("#hint");

    badge?.addEventListener("click", async () => {
      const text = this.textContent?.trim() || "";
      if (text && navigator?.clipboard) {
        try {
          await navigator.clipboard.writeText(text);
          if (hint) {
            hint.textContent = "✓";
            setTimeout(() => {
              hint.textContent = "📋";
            }, 1500);
          }
        } catch {
          // Ignore clipboard permission errors
        }
      }
    });
  }
}

customElements.define("tag-badge", TagBadge);
