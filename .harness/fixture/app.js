// Fixture behaviors that trap naive cloners. Each block exists to force a specific
// fidelity feature in the clone engine (see .agentdocs/specs/09-fixture-contract.md).

// 1. CSSOM injection: a rule added via insertRule is INVISIBLE in outerHTML — the engine must
//    serialize document.styleSheets to capture ".js-injected".
const styleEl = document.createElement("style");
document.head.appendChild(styleEl);
styleEl.sheet.insertRule(".js-injected { color: rgb(1, 2, 3); }", 0);
const marker = document.createElement("div");
marker.className = "js-injected";
marker.textContent = "CSSOM-injected style applies to me.";
document.querySelector("main").appendChild(marker);

// 2. Open shadow DOM + adoptedStyleSheets (constructed stylesheet trap).
const cardSheet = new CSSStyleSheet();
cardSheet.replaceSync(
  ".card { border: 2px solid #0a2540; border-radius: 8px; padding: 12px; } " +
  ".card h3 { color: #ff5c35; margin: 0 0 8px; }"
);
customElements.define(
  "dl-card",
  class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: "open" });
      root.adoptedStyleSheets = [cardSheet];
      root.innerHTML =
        '<div class="card"><h3><slot name="title"></slot></h3><slot></slot></div>';
    }
  }
);

// 3. IntersectionObserver lazy image (scroll sweep required to trigger).
const lazy = document.getElementById("lazy-io");
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      lazy.src = lazy.dataset.src;
      io.disconnect();
    }
  }
});
io.observe(lazy);

// 4. Painted canvas (serializes empty unless converted to a data-URI image).
const ctx = document.getElementById("chart").getContext("2d");
ctx.fillStyle = "#0a2540";
ctx.fillRect(0, 0, 300, 120);
ctx.fillStyle = "#ff5c35";
for (let i = 0; i < 6; i++) ctx.fillRect(15 + i * 48, 100 - i * 14, 30, 20 + i * 14);

// 5. JS-set input value (lives in the value PROPERTY, not the attribute).
document.getElementById("email").value = "captured@fixture.test";

// 6. Consent banner dismiss (consent blocking should remove the banner before this runs).
document.getElementById("consent-accept")?.addEventListener("click", () => {
  document.getElementById("consent").remove();
});
