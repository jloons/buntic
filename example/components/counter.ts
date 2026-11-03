class CounterButton extends HTMLElement {
  private count: number = 0;
  private btn: HTMLButtonElement;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    
    const wrapper = document.createElement("div");
    wrapper.style.display = "inline-flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "1rem";

    this.btn = document.createElement("button");
    this.btn.textContent = `Clicks: ${this.count}`;
    this.btn.style.cssText = `
      background-color: #f59e0b;
      color: #0f172a;
      border: none;
      padding: 0.6rem 1.2rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 1rem;
      cursor: pointer;
      transition: background-color 0.2s, transform 0.1s;
    `;

    this.btn.addEventListener("mouseover", () => {
      this.btn.style.backgroundColor = "#d97706";
    });
    this.btn.addEventListener("mouseout", () => {
      this.btn.style.backgroundColor = "#f59e0b";
    });
    this.btn.addEventListener("mousedown", () => {
      this.btn.style.transform = "scale(0.96)";
    });
    this.btn.addEventListener("mouseup", () => {
      this.btn.style.transform = "scale(1)";
    });

    this.btn.addEventListener("click", () => {
      this.count++;
      this.btn.textContent = `Clicks: ${this.count}`;
    });

    wrapper.appendChild(this.btn);
    shadow.appendChild(wrapper);
  }
}

if (!customElements.get("counter-button")) {
  customElements.define("counter-button", CounterButton);
}
