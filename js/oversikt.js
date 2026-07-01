// Översiktssidan — monterar hero + kortgalleri från data.
// Returnerar en DOM-nod som OJS visar. Korten är "rena kapitel": färgmotiv +
// tematisk ikon + rubrik + ingress. Inga grafer eller siffror i korten.
import { hallandskarta } from "./kartor/halland.js";
import { oppnaSammanfattning } from "./sammanfattning.js";

const LOGO = "logo_vit.svg"; // organisationens vita logga (kopieras via _quarto.yml resources)

// liten hyperscript-hjälpare
function h(tag, attrs = {}, ...barn) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v);
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
  landskap: '<circle cx="17.6" cy="6.2" r="1.9"/><path d="M2.6 18.2 8 11l3 4 3.4-5L21 18.2"/><path d="M2 18.2h20"/>'
};

function ikon(id) {
  const inre = IKONER[id] || IKONER.orter;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inre}</svg>`;
}

// Liten gnista/insiktsikon för sammanfattningsknappen
function gnistIkon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3"/><path d="M12 18v3"/><path d="M5 12H3"/><path d="M21 12h-2"/><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/></svg>';
}

export function oversikt({ data, geo }) {
  const r = data.rapport;
  const stoppare = [];

  // ── HERO ──
  const kartEl = h("div", { class: "kr-hero-karta" });

  const hero = h(
    "section",
    { class: "kr-hero" },
    h("div", { class: "kr-hero-bg" }),
    h(
      "div",
      { class: "kr-topbar" },
      h("span", { class: "kr-topbar-kicker" }, r.avsandare),
      h("img", { class: "kr-logo", src: LOGO, alt: r.utgivare })
    ),
    h(
      "div",
      { class: "kr-hero-inner" },
      h(
        "div",
        { class: "kr-hero-text" },
        h(
          "h1",
          { class: "kr-hero-titel" },
          r.titel,
          h("em", { class: "kr-hero-titel-accent" }, r.titel_accent)
        ),
        r.underrubrik ? h("p", { class: "kr-hero-underrubrik" }, r.underrubrik) : null,
        h("p", { class: "kr-hero-ingress" }, r.ingress)
      ),
      kartEl
    ),
    h(
      "div",
      { class: "kr-scroll" },
      h("span", { class: "kr-scroll-text" }, "Kapitel"),
      h("span", { class: "kr-scroll-pil" }, "↓")
    )
  );

  stoppare.push(hallandskarta(kartEl, geo, { kommuner: data.kommuner || [] }));

  // ── KORTGALLERI (flip: ren kapitel-framsida, innehållssida på baksidan) ──
  const kort = data.kapitel.map((k) => {
    const antal = (k.avsnitt || []).length;

    // Framsida — magasinlayout: folio-rail (kapitel + nummer + ikon) | text-body.
    // En dämpad, överstor ikon vattenmärker kortet och ger djup.
    const fram = h(
      "a",
      { class: "kr-kort-fram", href: k.id + "/" },
      h("span", { class: "kr-fram-vattenmarke", html: ikon(k.id) }),
      h(
        "div",
        { class: "kr-fram-rail" },
        h("span", { class: "kr-kort-kapitel" }, "Kapitel"),
        h("span", { class: "kr-kort-num" }, tva(k.nummer)),
        h("span", { class: "kr-kort-ikon", html: ikon(k.id) })
      ),
      h(
        "div",
        { class: "kr-fram-body" },
        h("span", { class: "kr-kort-kat" }, k.kategori),
        h("h3", { class: "kr-kort-titel" }, k.titel),
        h("p", { class: "kr-kort-ingress" }, k.ingress),
        h(
          "span",
          { class: "kr-kort-meta" },
          h("span", { class: "kr-kort-antal" }, `${antal} avsnitt`),
          h(
            "span",
            { class: "kr-kort-vand" },
            h("span", { class: "kr-kort-vand-text" }, "Innehåll"),
            h("span", { class: "kr-kort-vand-glyf" }, "↻")
          )
        )
      )
    );

    // Baksida — kapitlets innehållssida: vinjett + titel, TOC som hjälte, läs-länk i foten
    const avsnitt = (k.avsnitt || []).map((a, i) =>
      h(
        "a",
        { class: "kr-avsnitt", href: `${k.id}/#${k.id}-${a.id}` },
        h("span", { class: "kr-avsnitt-num" }, tva(i + 1)),
        h("span", { class: "kr-avsnitt-titel" }, a.titel),
        h("span", { class: "kr-avsnitt-pil" }, "→")
      )
    );

    // Listan flödar till två spalter när underrubrikerna blir många
    const flerKol = antal > 4;

    // Sekundär åtgärd: öppna sammanfattnings-pop-upen (om kapitlet har insikter)
    const harInsikter = !!(k.insikter && k.insikter.slides && k.insikter.slides.length);
    const sfKnapp = harInsikter
      ? h(
          "button",
          { class: "kr-bak-sf", type: "button", title: "Sammanfattning & nyckelinsikter" },
          h("span", { class: "kr-bak-sf-ikon", html: gnistIkon() }),
          h("span", { class: "kr-bak-sf-text" }, "Sammanfattning")
        )
      : null;
    if (sfKnapp) {
      sfKnapp.addEventListener("click", (e) => {
        e.preventDefault();
        oppnaSammanfattning(k);
      });
    }

    const bak = h(
      "div",
      { class: "kr-kort-bak" },
      // Vinjett + titel = orientering (man tappar ju framsidan vid flippen)
      h(
        "div",
        { class: "kr-bak-topp" },
        h("span", { class: "kr-bak-vinjett" }, `Kapitel ${tva(k.nummer)} · ${k.kategori}`),
        h("a", { class: "kr-bak-titel", href: k.id + "/" }, k.titel)
      ),
      // Innehållsförteckningen är baksidans hjälte
      h("span", { class: "kr-bak-etikett" }, "Innehåll"),
      h(
        "div",
        { class: "kr-avsnitt-lista" + (flerKol ? " kr-avsnitt-lista--tva" : "") },
        ...avsnitt
      ),
      // Fot: diskret läs-länk + kompakt sammanfattnings-chip
      h(
        "div",
        { class: "kr-bak-foter" },
        h(
          "a",
          { class: "kr-bak-las", href: k.id + "/" },
          h("span", {}, "Läs hela delrapporten"),
          h("span", { class: "kr-bak-las-pil" }, "→")
        ),
        sfKnapp
      )
    );

    return h(
      "div",
      { class: "kr-kort", style: `--accent:${k.farg}`, "data-kapitel": k.id },
      h("div", { class: "kr-kort-inner" }, fram, bak)
    );
  });

  const innehall = h(
    "main",
    { class: "kr-content" },
    h("div", { class: "kr-grid" }, ...kort)
  );

  // ── FOOTER ──
  const footer = h(
    "footer",
    { class: "kr-footer" },
    h("img", { class: "kr-footer-logo", src: LOGO, alt: r.utgivare }),
    h("div", { class: "kr-footer-meta" }, `Senast uppdaterad ${r.uppdaterad}`)
  );

  const rot = h("div", { class: "kr-app" }, hero, innehall, footer);
  rot._cleanup = () => stoppare.forEach((s) => s && s());
  return rot;
}
