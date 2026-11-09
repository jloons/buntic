class CounterButton extends HTMLElement {
  private count: number = 0;

  connectedCallback() {
    const shadow = this.shadowRoot!;
    const btn = shadow.getElementById("btn")!;
    btn.addEventListener("click", () => {
      this.count++;
      btn.textContent = `Clicks: ${this.count}`;
    });
  }
}

if (!customElements.get("counter-button")) {
  customElements.define("counter-button", CounterButton);
}
