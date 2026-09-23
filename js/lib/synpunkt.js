// =============================================================================
// SYNPUNKTER — diskret feedback på rubriker, figurer, markerad text och kapitel
//
// Läsaren klickar på en liten pratbubbla (vid en rubrik eller i en figurs
// verktygsrad), markerar text och väljer "Kommentera", eller använder länken
// sist i kapitlet. Ett formulär öppnas med platsen redan ifylld (kapitel,
// avsnitt, underrubrik, figur). "Skicka med e-post" öppnar ett färdigt mejl vars
// brödtext är en markdown-fil med YAML-huvud, så att synpunkterna kan sparas och
// läsas direkt i projektet (se feedback/README.md).
//
// Anropas från toc.js: initSynpunkter(rapportElement).
// All CSS ligger i style.scss under SYNPUNKTER.
// =============================================================================

const ADRESS = "robin.rikardsson@regionhalland.se";
const MAX_TEXT = 2500;
const TYPER = [
  "Fel eller oklarhet",
  "Förslag på förbättring",
  "Önskar ny karta eller graf",
  "Tips om data eller källa",
  "Övrigt"
];
const LS_AVSANDARE = "kr-synpunkt-avsandare";

const IKON_BUBBLA =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4.5 20l1-4A7.5 7.5 0 1 1 20 12.5z"/><path d="M9 11h6M9 14h4"/></svg>';

function h(tag, attrs = {}, ...barn) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") el.className = v;
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

const text = (el) => {
  if (!el) return "";
  const klon = el.cloneNode(true);
  klon.querySelectorAll("button, .kr-syn-rubrik, a.anchorjs-link").forEach((x) => x.remove());
  return klon.textContent.replace(/\s+/g, " ").trim();
};
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const tva = (n) => String(n).padStart(2, "0");
const lsLas = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const lsSkriv = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* privat läge */ } };

export function initSynpunkter(rapport) {
  if (!rapport || rapport.dataset.synpunkter) return;
  rapport.dataset.synpunkter = "1";

  // ── Kapitlets identitet ──
  const kicker = text(rapport.querySelector(".kr-rapport-kicker"));   // "07 · Infrastruktur"
  const kapNr = (kicker.match(/^\d+/) || [""])[0];
  const kapTitel = text(rapport.querySelector(".kr-rapport-hero h1, h1"));
  const kapId = (() => {
    const delar = location.pathname.split("/").filter(Boolean).filter((d) => !/\.html?$/i.test(d));
    return delar[delar.length - 1] || "";
  })();
  const kapitelEtikett = [kapNr, kapTitel].filter(Boolean).join(" ");

  // Avsnittsnummer som i toc.js (onumrerade avsnitt räknas inte)
  const sektioner = [...rapport.querySelectorAll(".kr-rapport-sektion")];
  const sekNr = new Map();
  let lopnr = 0;
  sektioner.forEach((s) => { if (!s.classList.contains("kr-rapport-onumrerad")) sekNr.set(s, tva(++lopnr)); });

  // ── Platsen för ett element: avsnitt, närmaste underrubrik ovanför, figur ──
  function plats(el, extra = {}) {
    const sek = el.closest(".kr-rapport-sektion");
    const p = { kapitel: kapitelEtikett, kapitel_id: kapId };
    if (sek) {
      const h2 = sek.querySelector("h2");
      p.avsnitt = [sekNr.get(sek), text(h2)].filter(Boolean).join(" ");
      p.avsnitt_id = sek.id || h2?.id || "";
      const h3or = [...sek.querySelectorAll("h3")]
        .filter((x) => x === el || (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      const h3 = h3or[h3or.length - 1];
      if (h3) { p.underrubrik = text(h3); p.underrubrik_id = h3.id || ""; }
    }
    return { ...p, ...extra };
  }

  function figurPlats(container) {
    const enhet = container.closest(".graf-stepper") || container;
    const titel = text(container.querySelector(".graf-title"));
    const cap = enhet.nextElementSibling;
    const nr = cap && cap.classList.contains("kr-figurtext")
      ? (text(cap.querySelector(".kr-figurtext-num")).match(/\d+/) || [""])[0] : "";
    return plats(enhet, {
      element: "figur",
      figur: titel,
      figur_nr: nr,
      figur_id: `${kapId}-${slug(titel || "figur")}`
    });
  }

  // ── Formuläret (ett för hela sidan) ──
  const modal = byggModal();
  document.body.appendChild(modal.el);
  const accent = getComputedStyle(rapport).getPropertyValue("--accent").trim();
  if (accent) modal.el.style.setProperty("--accent", accent);

  // ── 1. Rubriker (h2 och h3) ──
  sektioner.forEach((sek) => {
    sek.querySelectorAll("h2, h3").forEach((rub) => {
      if (rub.querySelector(".kr-syn-rubrik")) return;
      const nivå = rub.tagName === "H2" ? "avsnitt" : "underrubrik";
      const knapp = h("button", {
        type: "button", class: "kr-syn-rubrik", "aria-label": `Lämna synpunkt på ${nivå === "avsnitt" ? "avsnittet" : "underrubriken"}`,
        title: "Lämna synpunkt", html: IKON_BUBBLA,
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); modal.oppna(plats(rub, { element: nivå })); }
      });
      rub.appendChild(knapp);
    });
  });

  // ── 2. Figurer och kartor (monteras asynkront → observer) ──
  const figurKnappar = () => {
    rapport.querySelectorAll(".graf-container").forEach((c) => {
      if (c.dataset.syn) return;
      const header = c.querySelector(".graf-header");
      if (!header) return;
      c.dataset.syn = "1";
      const knapp = h("button", {
        type: "button", class: "graf-ikonknapp kr-syn-figur", "aria-label": "Lämna synpunkt på figuren",
        "data-tip": "Lämna synpunkt", html: IKON_BUBBLA,
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); modal.oppna(figurPlats(c)); }
      });
      const knappar = header.querySelector(".graf-tools-knappar");
      if (knappar) knappar.prepend(knapp);
      else header.appendChild(h("div", { class: "kr-syn-figurhorn" }, knapp));   // mapgl-kartor m.fl.
    });
  };
  figurKnappar();
  let vantar = false;
  new MutationObserver(() => {
    if (vantar) return;
    vantar = true;
    requestAnimationFrame(() => { vantar = false; figurKnappar(); });
  }).observe(rapport, { childList: true, subtree: true });

  // ── 3. Markerad text → "Kommentera" ──
  const pill = h("button", { type: "button", class: "kr-syn-markering", html: `${IKON_BUBBLA}<span>Kommentera</span>` });
  document.body.appendChild(pill);
  let markering = null;
  const gomPill = () => { pill.classList.remove("ar-synlig"); markering = null; };
  document.addEventListener("mouseup", (e) => {
    if (e.target.closest(".kr-syn-markering, .kr-syn-modal")) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const txt = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
      if (!sel || sel.rangeCount === 0 || txt.length < 8) return gomPill();
      const nod = sel.getRangeAt(0).commonAncestorContainer;
      const el = nod.nodeType === 1 ? nod : nod.parentElement;
      if (!el || !el.closest(".kr-rapport-sektion") || el.closest(".graf-container, .kr-sidnav")) return gomPill();
      const r = sel.getRangeAt(0).getBoundingClientRect();
      markering = { el, txt: txt.slice(0, 600) };
      pill.style.top = `${window.scrollY + r.top - 40}px`;
      pill.style.left = `${Math.max(12, window.scrollX + r.left + r.width / 2 - 55)}px`;
      pill.classList.add("ar-synlig");
    }, 10);
  });
  pill.addEventListener("mousedown", (e) => e.preventDefault());
  pill.addEventListener("click", () => {
    if (!markering) return;
    modal.oppna(plats(markering.el, { element: "markerad text", markering: markering.txt }));
    gomPill();
  });
  window.addEventListener("scroll", () => { if (!window.getSelection()?.toString()) gomPill(); }, { passive: true });

  // ── 4. Kapitlet som helhet: rad sist i kapitlet och i sidomenyns fot ──
  const kapitelKnapp = (klass) => h("button", {
    type: "button", class: klass, html: `${IKON_BUBBLA}<span>Lämna synpunkt på kapitlet</span>`,
    onclick: () => modal.oppna({ kapitel: kapitelEtikett, kapitel_id: kapId, element: "kapitel" })
  });
  const sista = sektioner[sektioner.length - 1];
  sista.insertAdjacentElement("afterend", h("div", { class: "kr-syn-kapitel" },
    h("p", {}, "Har du synpunkter på kapitlet, hittat ett fel eller önskar en karta eller graf som saknas? Du kan också peka på pratbubblan vid en rubrik eller figur, eller markera text och välja Kommentera."),
    kapitelKnapp("kr-syn-kapitel-knapp")));
  const tillSidnav = () => {
    const fot = document.querySelector(".kr-sidnav");
    if (!fot || fot.querySelector(".kr-syn-sidnav")) return !!fot;
    fot.appendChild(kapitelKnapp("kr-syn-sidnav"));
    return true;
  };
  if (!tillSidnav()) {
    const o = new MutationObserver(() => { if (tillSidnav()) o.disconnect(); });
    o.observe(document.body, { childList: true });
    setTimeout(() => o.disconnect(), 10000);
  }
}

// ── Modal ──
function byggModal() {
  let aktuell = null;

  const platsEl = h("div", { class: "kr-syn-plats" });
  const citatEl = h("blockquote", { class: "kr-syn-citat" });
  const typer = h("div", { class: "kr-syn-typer", role: "radiogroup", "aria-label": "Vad gäller synpunkten?" },
    TYPER.map((t, i) => h("label", { class: "kr-syn-typ" },
      h("input", { type: "radio", name: "kr-syn-typ", value: t, ...(i === 1 ? { checked: "" } : {}) }),
      h("span", {}, t))));
  const falt = h("textarea", { class: "kr-syn-text", rows: "6", maxlength: String(MAX_TEXT),
    placeholder: "Vad fungerar inte, vad saknas eller vad skulle göra figuren eller texten bättre?" });
  const raknare = h("div", { class: "kr-syn-raknare" }, `0 / ${MAX_TEXT}`);
  falt.addEventListener("input", () => { raknare.textContent = `${falt.value.length} / ${MAX_TEXT}`; });
  const avsandare = h("input", { type: "text", class: "kr-syn-avsandare", placeholder: "Namn och organisation (valfritt)" });
  const status = h("div", { class: "kr-syn-status", "aria-live": "polite" });

  const skicka = h("button", { type: "button", class: "kr-syn-skicka" }, "Skicka med e-post");
  const kopiera = h("button", { type: "button", class: "kr-syn-kopiera" }, "Kopiera text");
  const stang = h("button", { type: "button", class: "kr-syn-stang", "aria-label": "Stäng",
    html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' });

  const ruta = h("div", { class: "kr-syn-ruta", role: "dialog", "aria-modal": "true", "aria-labelledby": "kr-syn-rubrik" },
    h("div", { class: "kr-syn-huvud" }, h("div", { class: "kr-syn-titel", id: "kr-syn-rubrik" }, "Lämna synpunkt"), stang),
    h("div", { class: "kr-syn-etikett" }, "Gäller"), platsEl, citatEl,
    h("div", { class: "kr-syn-etikett" }, "Vad gäller det?"), typer,
    h("div", { class: "kr-syn-etikett" }, "Din synpunkt"), falt, raknare,
    avsandare,
    h("div", { class: "kr-syn-knappar" }, skicka, kopiera), status,
    h("p", { class: "kr-syn-not" },
      "Knappen öppnar ditt e-postprogram med ett färdigt meddelande till ", h("strong", {}, ADRESS),
      ". Om inget öppnas kan du kopiera texten och skicka den själv."));
  const el = h("div", { class: "kr-syn-modal", onclick: (e) => { if (e.target === el) stangModal(); } }, ruta);

  const valdTyp = () => ruta.querySelector("input[name='kr-syn-typ']:checked")?.value || "Övrigt";

  const platsRad = (p) => [p.kapitel, p.avsnitt, p.underrubrik,
    p.figur ? `Figur ${p.figur_nr ? p.figur_nr + ". " : ""}${p.figur}` : null].filter(Boolean);

  function markdown() {
    const p = aktuell || {};
    const nu = new Date();
    const datum = `${nu.getFullYear()}-${tva(nu.getMonth() + 1)}-${tva(nu.getDate())} ${tva(nu.getHours())}:${tva(nu.getMinutes())}`;
    const ankare = p.underrubrik_id || p.avsnitt_id || "";
    const sida = location.href.split("#")[0] + (ankare ? "#" + ankare : "");
    const q = (v) => `"${String(v ?? "").replace(/"/g, "'")}"`;
    const rader = ["---", "typ: synpunkt-kapitelrapport",
      `kategori: ${q(valdTyp())}`, `element: ${q(p.element || "")}`,
      `kapitel: ${q(p.kapitel)}`, `kapitel_id: ${q(p.kapitel_id)}`];
    if (p.avsnitt) rader.push(`avsnitt: ${q(p.avsnitt)}`, `avsnitt_id: ${q(p.avsnitt_id)}`);
    if (p.underrubrik) rader.push(`underrubrik: ${q(p.underrubrik)}`, `underrubrik_id: ${q(p.underrubrik_id)}`);
    if (p.figur) rader.push(`figur: ${q(p.figur)}`, `figur_nr: ${q(p.figur_nr)}`, `figur_id: ${q(p.figur_id)}`);
    rader.push(`sida: ${q(sida)}`, `datum: ${q(datum)}`, `avsandare: ${q(avsandare.value.trim())}`, "---", "",
      "## Synpunkt", "", falt.value.trim() || "(ingen text)");
    if (p.markering) rader.push("", "## Markerad text", "", "> " + p.markering);
    return rader.join("\n");
  }

  function amne() {
    const p = aktuell || {};
    const kap = (p.kapitel || "").split(" ")[0];
    const vad = p.figur || p.underrubrik || p.avsnitt?.replace(/^\d+\s/, "") || "Kapitlet";
    return `[Kapitelrapport] ${kap} · ${vad} · ${valdTyp()}`;
  }

  skicka.addEventListener("click", () => {
    if (!falt.value.trim()) { status.textContent = "Skriv din synpunkt först."; falt.focus(); return; }
    lsSkriv(LS_AVSANDARE, avsandare.value.trim());
    const url = `mailto:${ADRESS}?subject=${encodeURIComponent(amne())}&body=${encodeURIComponent(markdown().replace(/\n/g, "\r\n"))}`;
    window.location.href = url;
    status.textContent = "Tack! Ett mejl ska nu ha öppnats i ditt e-postprogram. Tryck på skicka där.";
  });
  kopiera.addEventListener("click", async () => {
    const innehall = `Till: ${ADRESS}\nÄmne: ${amne()}\n\n${markdown()}`;
    try { await navigator.clipboard.writeText(innehall); status.textContent = "Texten är kopierad. Klistra in den i ett mejl till " + ADRESS + "."; }
    catch (e) { falt.select(); status.textContent = "Kopieringen gick inte. Markera texten och kopiera den själv."; }
  });

  function stangModal() {
    el.classList.remove("ar-oppen");
    document.removeEventListener("keydown", tangent);
  }
  const tangent = (e) => { if (e.key === "Escape") stangModal(); };
  stang.addEventListener("click", stangModal);

  return {
    el,
    oppna(p) {
      aktuell = p;
      platsEl.replaceChildren(...platsRad(p).map((t, i) => h("span", { class: "kr-syn-plats-led" + (i === 0 ? " kr-syn-plats-kap" : "") }, t)));
      citatEl.textContent = p.markering ? `”${p.markering}”` : "";
      citatEl.style.display = p.markering ? "" : "none";
      falt.value = ""; raknare.textContent = `0 / ${MAX_TEXT}`; status.textContent = "";
      if (!avsandare.value) avsandare.value = lsLas(LS_AVSANDARE);
      el.classList.add("ar-oppen");
      document.addEventListener("keydown", tangent);
      setTimeout(() => falt.focus(), 50);
    }
  };
}
