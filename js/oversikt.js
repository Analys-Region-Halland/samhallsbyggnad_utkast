// Förstasidan: hjälte + kapitelindex + kartgalleri, monterat från data.
// Returnerar en DOM-nod som OJS visar.
//
// Uppbyggnad (research 2026-09-23: OWID, CBS, GOV.UK step-by-step, ONS):
//   HJÄLTE     titel, underrubrik, ingress, två ingångar (Läs rapporten /
//              Kartgalleriet), rapporten i siffror, Hallandskarta med tätorterna
//              på sina verkliga platser.
//   INDEX      en numrerad rad per kapitel: kategori, titel, en beskrivning av
//              vad kapitlet innehåller (kapitel.json: beskrivning), kartminiatyr som öppnar kapitlets kartor i galleriet, och en
//              utfällbar avsnittslista (step-by-step-mönstret). Skalar till
//              godtyckligt många kapitel och avsnitt.
//   GALLERI    js/kartgalleri.js: kartgalleriet (#kartgalleri, #karta/<id>) och
//              grafgalleriet (#grafgalleri, #graf/<id>), samma modal.
//
// Data: data.kapitel[] = { id, nummer, kategori, titel, ingress, farg,
//   beskrivning, avsnitt: [{ id, titel, beskrivning? }] }.
import { hallandskarta } from "./kartor/halland.js";
import { kartgalleri, grafgalleri } from "./kartgalleri.js";

const LOGO = "logo_vit.svg";

function h(tag, attrs = {}, ...barn) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const b of barn.flat()) {
    if (b == null) continue;
    el.appendChild(typeof b === "string" ? document.createTextNode(b) : b);
  }
  return el;
}

const tva = (n) => String(n).padStart(2, "0");

// Tematiska linjeikoner per kapitel (24×24, stroke = currentColor).
const IKONER = {
  oversikt: '<path d="M9 4 3.5 6.3v13.4L9 17.4l6 2.3 5.5-2.3V3.6L15 5.9 9 4z"/><path d="M9 4v13.4"/><path d="M15 5.9v13.8"/>',
  "funktionell-geografi": '<circle cx="6" cy="7" r="2.1"/><circle cx="18" cy="7" r="2.1"/><circle cx="12" cy="18" r="2.1"/><path d="M8 7.4h8"/><path d="M7.1 8.9 11 16"/><path d="M16.9 8.9 13 16"/>',
  befolkning: '<circle cx="9" cy="8" r="3.2"/><path d="M3.6 19c0-3 2.4-5 5.4-5s5.4 2 5.4 5"/><path d="M16 5.6a3 3 0 0 1 0 5.4"/><path d="M16.6 14c2.5.3 4.4 2.3 4.4 5"/>',
  bostader: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10.5V20h12v-9.5"/><path d="M10 20v-5h4v5"/>',
  "service-och-tillganglighet": '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  orter: '<path d="M4 20V9l5-3v14"/><path d="M9 20V11l6-3v12"/><path d="M15 20V8l5 2v10"/><path d="M3 20h18"/>',
  arbete: '<rect x="3.5" y="7.5" width="17" height="11" rx="2"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M3.5 12.2h17"/>',
  pendling: '<path d="M5 18h6a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h4.5"/><path d="M13.5 3.4 16.5 6l-3 2.6"/>',
  landskap: '<circle cx="17.6" cy="6.2" r="1.9"/><path d="M2.6 18.2 8 11l3 4 3.4-5L21 18.2"/><path d="M2 18.2h20"/>',
  "markanvandning-och-miljo": '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19 13 11"/>',
  socioekonomi: '<path d="M4 20h16"/><path d="M7 20v-5"/><path d="M12 20V9"/><path d="M17 20V5"/><circle cx="7" cy="11.5" r="1.6"/><circle cx="12" cy="5.6" r="1.6"/>',
  transporter: '<path d="M8.5 3 5 21"/><path d="M15.5 3 19 21"/><path d="M12 5v2.4"/><path d="M12 10.8v2.4"/><path d="M12 16.6V19"/>',
  energi: '<path d="M13.2 2.5 5 13.6h6.3l-1 7.9 8.2-11.1h-6.3l1-7.9z"/>'
};
const ikon = (id) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IKONER[id] || IKONER.orter}</svg>`;

const SVG = {
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  pil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
  ned: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>',
  staplar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 20h16"/><path d="M7 16v-5"/><path d="M12 16V6"/><path d="M17 16v-8"/></svg>',
  rutnat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/></svg>'
};

export function oversikt({ data, geo, orter = [], kartor = [], grafer = [] }) {
  const r = data.rapport;
  const kapitel = data.kapitel || [];
  const stoppare = [];

  const galleri = kartgalleri({ kartor, kapitel, bas: "" });
  const kartorPer = new Map();
  galleri.lista.forEach((k) => { if (!kartorPer.has(k.kapitel)) kartorPer.set(k.kapitel, []); kartorPer.get(k.kapitel).push(k); });
  const ggalleri = grafgalleri({ grafer, kapitel, bas: "" });
  const antalAvsnitt = kapitel.reduce((s, k) => s + (k.avsnitt || []).length, 0);

  // ── HJÄLTE ──
  const kartEl = h("div", { class: "kr-hero-karta" });
  const siffra = (tal, text) => h("div", { class: "kr-siffra" }, h("dt", {}, text), h("dd", {}, tal));

  const hero = h("header", { class: "kr-hero" },
    h("div", { class: "kr-hero-bg" }),
    h("nav", { class: "kr-hero-nav", "aria-label": "Rapporten" },
      h("a", { class: "kr-hero-avsandare", href: "./" }, h("img", { class: "kr-logo", src: LOGO, alt: r.utgivare })),
      h("div", { class: "kr-hero-lankar" },
        h("a", { class: "kr-hero-lank", href: "#kapitel" }, "Kapitel"),
        h("a", { class: "kr-hero-lank kr-hero-lank--galleri", href: "#kartgalleri",
            onclick: (e) => { e.preventDefault(); galleri.oppna(); } },
          h("span", { html: SVG.rutnat }), "Kartgalleri"),
        h("a", { class: "kr-hero-lank kr-hero-lank--galleri", href: "#grafgalleri",
            onclick: (e) => { e.preventDefault(); ggalleri.oppna(); } },
          h("span", { html: SVG.staplar }), "Grafgalleri"))),
    h("div", { class: "kr-hero-inner" },
      h("div", { class: "kr-hero-text" },
        h("p", { class: "kr-hero-kicker" }, `${r.avsandare} ${r.utgivare}`),
        h("h1", { class: "kr-hero-titel" }, r.titel, h("em", { class: "kr-hero-titel-accent" }, r.titel_accent)),
        r.underrubrik ? h("p", { class: "kr-hero-underrubrik" }, r.underrubrik) : null,
        h("p", { class: "kr-hero-ingress" }, r.ingress),
        h("div", { class: "kr-hero-cta" },
          h("a", { class: "kr-knapp kr-knapp--prim", href: "#kapitel" }, h("span", {}, "Läs rapporten"), h("span", { class: "kr-knapp-ikon", html: SVG.ned })),
          h("a", { class: "kr-knapp kr-knapp--sek", href: "#kartgalleri", onclick: (e) => { e.preventDefault(); galleri.oppna(); } },
            h("span", { class: "kr-knapp-ikon", html: SVG.rutnat }), h("span", {}, "Kartgalleriet")),
          h("a", { class: "kr-knapp kr-knapp--sek", href: "#grafgalleri", onclick: (e) => { e.preventDefault(); ggalleri.oppna(); } },
            h("span", { class: "kr-knapp-ikon", html: SVG.staplar }), h("span", {}, "Grafgalleriet"))),
        h("dl", { class: "kr-hero-siffror" },
          siffra(String(kapitel.length), "Kapitel"),
          siffra(String(antalAvsnitt), "Avsnitt"),
          siffra(String(galleri.antal), "Interaktiva kartor"),
          siffra(String(ggalleri.antal), "Grafer"),
          siffra(r.uppdaterad_kort || r.uppdaterad, "Uppdaterad"))),
      h("figure", { class: "kr-hero-figur" },
        kartEl,
        h("figcaption", { class: "kr-hero-figurtext" },
          `Hallands ${orter.length} tätorter, ytan efter folkmängd 2024. Källa: SCB.`)))
  );

  stoppare.push(hallandskarta(kartEl, geo, { orter }));

  // ── KAPITELINDEX ──
  const index = h("ol", { class: "kr-index", "aria-label": "Rapportens kapitel" });

  kapitel.forEach((k) => {
    const avsnitt = k.avsnitt || [];
    const lista = h("ol", { class: "kr-rad-avsnittlista" },
      ...avsnitt.map((a, j) => h("li", {},
        h("a", { href: `${k.id}/#${k.id}-${a.id}` },
          h("span", { class: "kr-rad-avsnitt-num" }, tva(j + 1)),
          h("span", { class: "kr-rad-avsnitt-titel" }, a.titel)))));
    const panelId = `kr-avsnitt-${k.id}`;
    const panel = h("div", { class: "kr-rad-avsnitt", id: panelId, role: "region", "aria-label": `Avsnitt i ${k.titel}` },
      h("div", { class: "kr-rad-avsnitt-inner" }, lista));

    const vaxla = h("button", { type: "button", class: "kr-rad-vaxla", "aria-expanded": "false", "aria-controls": panelId },
      h("span", {}, `${avsnitt.length} avsnitt`), h("span", { class: "kr-rad-vaxla-glyf", html: SVG.chevron }));

    // Vad kapitlet innehåller (kapitel.json: beskrivning; ingressen som reserv)
    const beskrivning = h("p", { class: "kr-rad-beskrivning" }, k.beskrivning || k.ingress);

    const kk = kartorPer.get(k.id) || [];
    const gg = ggalleri.antalPer.get(k.id) || 0;
    const kartknapp = kk.length
      ? h("button", { type: "button", class: "kr-rad-kartor", onclick: () => galleri.oppna(k.id),
          "aria-label": `Visa kapitlets ${kk.length} ${kk.length === 1 ? "karta" : "kartor"} i kartgalleriet` },
          h("img", { src: kk[0].tumnagel, alt: "", loading: "lazy", decoding: "async", width: "480", height: "320" }),
          h("span", { class: "kr-rad-kartor-etikett" }, h("span", { html: SVG.rutnat }), `${kk.length} ${kk.length === 1 ? "karta" : "kartor"}`))
      : null;

    const rad = h("li", { class: "kr-rad", style: `--accent:${k.farg}`, id: `kapitel-${k.id}` },
      h("div", { class: "kr-rad-num", "aria-hidden": "true" }, tva(k.nummer)),
      h("div", { class: "kr-rad-huvud" },
        h("div", { class: "kr-rad-kat" }, h("span", { class: "kr-rad-ikon", html: ikon(k.id) }), `Kapitel ${tva(k.nummer)} · ${k.kategori}`),
        h("h2", { class: "kr-rad-titel" }, h("a", { href: `${k.id}/` }, k.titel)),
        beskrivning,
        h("div", { class: "kr-rad-meta" },
          avsnitt.length ? vaxla : null,
          h("a", { class: "kr-rad-las", href: `${k.id}/` }, h("span", {}, "Läs kapitlet"), h("span", { class: "kr-rad-las-pil", html: SVG.pil })),
          gg ? h("button", { type: "button", class: "kr-rad-grafer", onclick: () => ggalleri.oppna(k.id),
              "aria-label": `Visa kapitlets ${gg} grafer i grafgalleriet` },
            h("span", { html: SVG.staplar }), `${gg} ${gg === 1 ? "graf" : "grafer"}`) : null)),
      kartknapp,
      panel);

    vaxla.addEventListener("click", () => {
      const oppen = vaxla.getAttribute("aria-expanded") !== "true";
      vaxla.setAttribute("aria-expanded", String(oppen));
      rad.classList.toggle("ar-oppen", oppen);
    });
    index.appendChild(rad);
  });

  const innehall = h("main", { class: "kr-content", id: "kapitel", tabindex: "-1" }, index);

  // ── FOOTER ──
  const footer = h("footer", { class: "kr-footer" },
    h("img", { class: "kr-footer-logo", src: LOGO, alt: r.utgivare }),
    h("div", { class: "kr-footer-meta" }, `Senast uppdaterad ${r.uppdaterad}`));

  const rot = h("div", { class: "kr-app" }, hero, innehall, footer);
  rot._cleanup = () => stoppare.forEach((s) => s && s());
  return rot;
}
