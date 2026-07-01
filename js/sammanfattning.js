// Sammanfattning & nyckelinsikter — en bläddrbar lightbox som vägleder läsaren
// genom ett kapitels slutsatser. En slide per insikt: redaktionell text till
// vänster, en monteringsyta för D3-grafer till höger.
//
// API:  oppnaSammanfattning(kapitel)  → öppnar overlayn (sköter sin egen livscykel)

// liten hyperscript-hjälpare (fristående kopia så modulen står på egna ben)
function h(tag, attrs = {}, ...barn) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const b of barn.flat()) {
    if (b == null) continue;
    el.appendChild(typeof b === "string" ? document.createTextNode(b) : b);
  }
  return el;
}

const tva = (n) => String(n).padStart(2, "0");

export function oppnaSammanfattning(kapitel) {
  const slides = (kapitel.insikter && kapitel.insikter.slides) || [];
  if (!slides.length) return;

  const n = slides.length;
  let index = 0;

  // ── Slides ──
  const slideEls = slides.map((s, i) =>
    h(
      "article",
      { class: "kr-sf-slide", "aria-hidden": i === 0 ? "false" : "true" },
      h(
        "div",
        { class: "kr-sf-text" },
        h("h3", { class: "kr-sf-rubrik" }, s.rubrik),
        h("p", { class: "kr-sf-brod" }, s.text)
      ),
      // Monteringsyta för D3 — modulerna kan måla in sig via id eller data-graf
      h(
        "figure",
        {
          class: "kr-sf-graf",
          id: `graf-${kapitel.id}-${s.id}`,
          "data-graf": s.graf || ""
        },
        h(
          "div",
          { class: "kr-sf-graf-platta" },
          h("span", { class: "kr-sf-graf-ikon", html: grafIkon() }),
          h("span", { class: "kr-sf-graf-text" }, s.graf ? `Graf: ${s.graf}` : "Grafyta"),
          h("span", { class: "kr-sf-graf-hint" }, "D3-modul monteras här")
        )
      )
    )
  );

  const spar = h("div", { class: "kr-sf-spar" }, ...slideEls);

  // ── Navigering ──
  const prickar = slides.map((_, i) =>
    h("button", {
      class: "kr-sf-prick" + (i === 0 ? " ar-aktiv" : ""),
      type: "button",
      "aria-label": `Gå till insikt ${i + 1}`,
      onclick: () => ga(i)
    })
  );

  const raknare = h("span", { class: "kr-sf-raknare" }, `${tva(1)} / ${tva(n)}`);

  const pilVanster = h(
    "button",
    { class: "kr-sf-pil kr-sf-pil--vanster", type: "button", "aria-label": "Föregående", onclick: () => ga(index - 1) },
    h("span", { html: "&#8249;" })
  );
  const pilHoger = h(
    "button",
    { class: "kr-sf-pil kr-sf-pil--hoger", type: "button", "aria-label": "Nästa", onclick: () => ga(index + 1) },
    h("span", { html: "&#8250;" })
  );

  const stangKnapp = h(
    "button",
    { class: "kr-sf-stang", type: "button", "aria-label": "Stäng", onclick: stang },
    h("span", { html: "&times;" })
  );

  // ── Dialog ──
  const dialog = h(
    "div",
    {
      class: "kr-sf-dialog",
      style: `--accent:${kapitel.farg}`,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": `Sammanfattning och nyckelinsikter — ${kapitel.titel}`,
      tabindex: "-1"
    },
    h(
      "header",
      { class: "kr-sf-topp" },
      h(
        "div",
        { class: "kr-sf-topp-text" },
        h("span", { class: "kr-sf-kicker" }, "Sammanfattning & nyckelinsikter"),
        h("span", { class: "kr-sf-titel" }, kapitel.titel)
      ),
      stangKnapp
    ),
    h("div", { class: "kr-sf-scen" }, spar),
    h(
      "footer",
      { class: "kr-sf-nav" },
      raknare,
      h("div", { class: "kr-sf-prickar" }, ...prickar),
      h("div", { class: "kr-sf-styr" }, pilVanster, pilHoger)
    )
  );

  const backdrop = h("div", { class: "kr-sf-backdrop", onclick: stang });
  const overlay = h("div", { class: "kr-sf-overlay" }, backdrop, dialog);

  // ── Logik ──
  function ga(i) {
    index = Math.max(0, Math.min(n - 1, i));
    spar.style.transform = `translateX(${-index * 100}%)`;
    slideEls.forEach((el, k) => el.setAttribute("aria-hidden", k === index ? "false" : "true"));
    prickar.forEach((p, k) => p.classList.toggle("ar-aktiv", k === index));
    raknare.textContent = `${tva(index + 1)} / ${tva(n)}`;
    pilVanster.toggleAttribute("disabled", index === 0);
    pilHoger.toggleAttribute("disabled", index === n - 1);
  }

  function tangent(e) {
    if (e.key === "Escape") stang();
    else if (e.key === "ArrowRight") ga(index + 1);
    else if (e.key === "ArrowLeft") ga(index - 1);
  }

  // Svep på touch/pekare
  let startX = null;
  const scen = dialog.querySelector(".kr-sf-scen");
  scen.addEventListener("pointerdown", (e) => { startX = e.clientX; });
  scen.addEventListener("pointerup", (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 45) ga(index + (dx < 0 ? 1 : -1));
    startX = null;
  });

  function stang() {
    overlay.classList.remove("ar-open");
    document.removeEventListener("keydown", tangent);
    document.body.style.overflow = forraOverflow;
    overlay.addEventListener("transitionend", function rensa(ev) {
      if (ev.target !== overlay) return;
      overlay.removeEventListener("transitionend", rensa);
      overlay.remove();
    });
    // säkerhetsnät om ingen transition triggas
    setTimeout(() => overlay.isConnected && overlay.remove(), 500);
  }

  // ── Montera & öppna ──
  const forraOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.body.appendChild(overlay);
  document.addEventListener("keydown", tangent);
  ga(0);

  // nästa frame → animera in
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("ar-open")));
  dialog.focus();
}

function grafIkon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/></svg>';
}
