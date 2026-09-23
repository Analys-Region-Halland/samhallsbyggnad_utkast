// Reser läsnavigeringen för en delrapport.
// Anropas en gång per kapitelsida (via en OJS-cell i index.qmd).
// - en slank topbar som visar var läsaren befinner sig: AVSNITT › UNDERRUBRIK
// - en fast SIDOMENY till vänster (breda skärmar): hela rapportens kapitel,
//   aktuellt kapitel utfällt med avsnitt → underrubriker, aktiv rad markerad,
//   läsprogress i det aktiva avsnittet, samt länk till nästa/föregående kapitel
// - på smala skärmar: den utfällbara menyn i topbaren och en segmenterad
//   positions-bar (en ruta per avsnitt) som förut

import { initSynpunkter } from "./lib/synpunkt.js";

function h(tag, attrs = {}, ...barn) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const b of barn.flat()) {
    if (b == null) continue;
    el.appendChild(typeof b === "string" ? document.createTextNode(b) : b);
  }
  return el;
}

const tva = (n) => String(n).padStart(2, "0");
const klamp = (v) => Math.max(0, Math.min(1, v));

// Ren textetikett ur en rubrik (klona, kapa ev. Quarto-ankarlänkar)
function rubrikText(el, fallback) {
  if (!el) return fallback;
  const klon = el.cloneNode(true);
  klon.querySelectorAll("a").forEach((a) => a.remove());
  return klon.textContent.trim() || fallback;
}

// Kapitlets id = mappnamnet i sökvägen (…/befolkning/index.html → "befolkning")
function kapitelId() {
  const delar = location.pathname.split("/").filter(Boolean).filter((d) => !/\.html?$/i.test(d));
  return delar[delar.length - 1] || "";
}

// Figurens stabila id (grafgalleriet och djuplänkar): "graf-" + titelns slug.
const slugga = (t) => t.toLowerCase()
  .replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/é/g, "e")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
const arKarta = (el) => !!el.querySelector("iframe, .kr-karta-ram, .maplibregl-map, .mapboxgl-map, .kr-zonkarta, .tk-karta");

// Flyttar ut figurtitel/undertitel/källa till en rapport-bildtext UNDER rutan
// ("Figur N. …") och numrerar löpande per kapitel (steppern = en figur). Körs
// om via en observer eftersom OJS monterar figurerna asynkront. Varje figur
// får ett id (graf-<slug>) och data-figur/data-figtyp för grafgalleriet.
function numreraFigurer(root, { vidFlush = null } = {}) {
  const sattText = (el, txt) => { if (el && el.textContent !== txt) el.textContent = txt; };
  let obs = null;

  const flush = () => {
    if (obs) obs.disconnect();
    const enheter = [...root.querySelectorAll(".graf-stepper, .graf-container")]
      .filter((el) => el.classList.contains("graf-stepper") || !el.closest(".graf-stepper"));

    enheter.forEach((enhet, i) => {
      const titel = (enhet.querySelector(".graf-title")?.textContent || "").trim();

      let cap = enhet.nextElementSibling;
      if (!cap || !cap.classList.contains("kr-figurtext")) {
        cap = document.createElement("figcaption");
        cap.className = "kr-figurtext";
        ["num", "titel"].forEach((k) =>
          cap.appendChild(Object.assign(document.createElement("span"), { className: "kr-figurtext-" + k }))
        );
        enhet.insertAdjacentElement("afterend", cap);
      }
      const titelP = titel && !/[.!?:]$/.test(titel) ? titel + "." : titel;
      sattText(cap.querySelector(".kr-figurtext-num"), `Figur ${i + 1}.`);
      sattText(cap.querySelector(".kr-figurtext-titel"), titelP);
      if (enhet.dataset.figur !== String(i + 1)) enhet.dataset.figur = String(i + 1);
      if (!enhet.id && titel) {
        let id = "graf-" + slugga(titel), n = 2;
        while (document.getElementById(id)) id = "graf-" + slugga(titel) + "-" + n++;
        enhet.id = id;
        enhet.style.scrollMarginTop = "90px";
      }
      const typ = arKarta(enhet) ? "karta" : "graf";
      if (enhet.dataset.figtyp !== typ) enhet.dataset.figtyp = typ;
    });
    if (vidFlush) vidFlush(enheter);
    if (obs) obs.observe(root, { childList: true, subtree: true });
  };

  flush();
  let vantar = false;
  obs = new MutationObserver(() => {
    if (vantar) return;
    vantar = true;
    requestAnimationFrame(() => { vantar = false; flush(); });
  });
  obs.observe(root, { childList: true, subtree: true });
}

// ── Figurlänkar och grafvy ──
// Figurernas id sätts först när OJS har ritat dem, så webbläsarens egen
// ankarhoppning (#graf-…) missar. Hoppa dit när figuren dyker upp och
// markera den kort. ?grafvy=<id> (grafgalleriets visare) visar BARA den
// figuren: allt annat döljs med CSS (html.kr-grafvy) och föräldrakedjan
// nollställs, så att figuren behåller kapitlets accent och stil.
function figurLankar() {
  const grafvyId = new URLSearchParams(location.search).get("grafvy");
  if (grafvyId) document.documentElement.classList.add("kr-grafvy");
  let hoppat = false, klar = false;
  return (enheter) => {
    if (grafvyId && !klar) {
      const mal = enheter.find((e) => e.id === grafvyId);
      if (!mal) return;
      klar = true;
      mal.classList.add("kr-grafvy-mal");
      const cap = mal.nextElementSibling;
      if (cap && cap.classList.contains("kr-figurtext")) cap.classList.add("kr-grafvy-cap");
      for (let el = mal.parentElement; el && el !== document.documentElement; el = el.parentElement) el.classList.add("kr-grafvy-kedja");
      window.scrollTo(0, 0);
      // vänta en bildruta så att grafen hunnit rita klart innan visaren tonar in
      requestAnimationFrame(() => setTimeout(() => {
        try { parent.postMessage({ kr: "graf-klar", id: grafvyId }, "*"); } catch (_) { /* */ }
      }, 250));
      return;
    }
    if (hoppat || grafvyId || !/^#graf-/.test(location.hash)) return;
    const mal = enheter.find((e) => "#" + e.id === decodeURIComponent(location.hash));
    if (!mal) return;
    hoppat = true;
    setTimeout(() => {
      mal.scrollIntoView({ block: "center", behavior: "smooth" });
      mal.classList.add("kr-figur-markerad");
      setTimeout(() => mal.classList.remove("kr-figur-markerad"), 2400);
    }, 300);
  };
}

// ── Sidomeny (vänster) ──
// Bygger rapportens kapitellista (ur data/kapitel.json) med aktuellt kapitel
// utfällt: avsnitt → underrubriker. Returnerar krokar som scrollspyn anropar.
function byggSidnav(data, kapitel, aktuelltId) {
  const nav = h("nav", { class: "kr-sidnav", "aria-label": "Innehåll" });

  // Avsnittsträd för aktuellt kapitel
  const grupper = [];
  const subLankar = [];
  const avsnitt = h("div", { class: "kr-sidnav-avsnitt" });
  data.forEach((d) => {
    const grupp = h("div", { class: "kr-sidnav-grupp" });
    const fyll = h("span", { class: "kr-sidnav-fyll" });
    const lank = h(
      "a",
      { class: "kr-sidnav-lank", href: "#" + d.id },
      h("span", { class: "kr-sidnav-num" }, d.nr),
      h("span", { class: "kr-sidnav-text" }, d.titel),
      fyll
    );
    grupp.appendChild(lank);
    const subs = [];
    if (d.subs.length) {
      const sub = h("div", { class: "kr-sidnav-sub" }, h("div", { class: "kr-sidnav-sub-inner" }));
      d.subs.forEach((s) => {
        const sl = h("a", { class: "kr-sidnav-sublank", href: "#" + s.id }, h("span", {}, s.titel));
        subs.push(sl);
        sub.firstChild.appendChild(sl);
      });
      grupp.appendChild(sub);
    }
    subLankar.push(subs);
    grupper.push({ el: grupp, lank, fyll });
    avsnitt.appendChild(grupp);
  });

  nav.appendChild(h("a", { class: "kr-sidnav-rapport", href: "../" }, "Kapitelrapport Halland"));
  nav.appendChild(h("a", { class: "kr-sidnav-galleri", href: `../#grafgalleri/${aktuelltId}` },
    h("span", { class: "kr-sidnav-galleri-ikon kr-sidnav-galleri-ikon--graf", "aria-hidden": "true" }), "Kapitlets grafer i grafgalleriet"));
  nav.appendChild(h("a", { class: "kr-sidnav-galleri", href: "../#kartgalleri" },
    h("span", { class: "kr-sidnav-galleri-ikon", "aria-hidden": "true" }), "Alla kartor i kartgalleriet"));

  const lista = h("div", { class: "kr-sidnav-kapitel" });
  let fore = null, nasta = null;
  if (kapitel && kapitel.length) {
    const idx = kapitel.findIndex((k) => k.id === aktuelltId);
    kapitel.forEach((k, i) => {
      const ar = k.id === aktuelltId;
      const rad = h(
        "a",
        { class: "kr-sidnav-kap" + (ar ? " ar-aktiv" : ""), href: ar ? "#" : `../${k.id}/`, "aria-current": ar ? "page" : null },
        h("span", { class: "kr-sidnav-num" }, tva(k.nummer ?? i + 1)),
        h("span", { class: "kr-sidnav-text" }, k.titel)
      );
      if (ar) rad.addEventListener("click", (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
      lista.appendChild(rad);
      if (ar) lista.appendChild(avsnitt);
    });
    if (idx > 0) fore = kapitel[idx - 1];
    if (idx >= 0 && idx < kapitel.length - 1) nasta = kapitel[idx + 1];
    if (idx < 0) lista.appendChild(avsnitt);   // okänt kapitel: visa bara avsnitten
  } else {
    lista.appendChild(avsnitt);
  }
  nav.appendChild(lista);

  if (fore || nasta) {
    const fot = h("div", { class: "kr-sidnav-fot" });
    if (nasta) fot.appendChild(h(
      "a", { class: "kr-sidnav-steg", href: `../${nasta.id}/` },
      h("span", { class: "kr-sidnav-steg-etikett" }, "Nästa kapitel"),
      h("span", { class: "kr-sidnav-steg-titel" }, `${tva(nasta.nummer)} ${nasta.titel}`)
    ));
    if (fore) fot.appendChild(h(
      "a", { class: "kr-sidnav-steg kr-sidnav-steg--fore", href: `../${fore.id}/` },
      h("span", { class: "kr-sidnav-steg-etikett" }, "Föregående"),
      h("span", { class: "kr-sidnav-steg-titel" }, `${tva(fore.nummer)} ${fore.titel}`)
    ));
    nav.appendChild(fot);
  }

  // Håll den aktiva raden synlig i menyns egen rullyta (aldrig dokumentet)
  const visaRad = (el) => {
    if (!el) return;
    const topp = el.offsetTop, botten = topp + el.offsetHeight;
    const synTopp = nav.scrollTop + 60, synBotten = nav.scrollTop + nav.clientHeight - 60;
    if (topp < synTopp || botten > synBotten) nav.scrollTo({ top: Math.max(0, topp - nav.clientHeight * 0.4), behavior: "smooth" });
  };

  return {
    el: nav,
    settAktiv(si, sub) {
      grupper.forEach((g, i) => {
        g.el.classList.toggle("ar-aktiv", i === si);
        g.lank.classList.toggle("ar-aktiv", i === si && sub < 0);
      });
      subLankar.forEach((arr, i) => arr.forEach((l, j) => l.classList.toggle("ar-aktiv", i === si && j === sub)));
      visaRad(sub >= 0 ? subLankar[si][sub] : grupper[si]?.lank);
    },
    settFyll(i, f) { grupper[i].fyll.style.transform = `scaleX(${f})`; }
  };
}

export function byggToc() {
  const rapport = document.querySelector(".kr-rapport");
  if (!rapport || rapport.dataset.toc) return;
  const sektioner = [...rapport.querySelectorAll(".kr-rapport-sektion")];
  if (!sektioner.length) return;
  rapport.dataset.toc = "1";

  const accent = getComputedStyle(rapport).getPropertyValue("--accent").trim();

  // ── Avsnittsdata (id + titel + underrubriker) ──
  // Ett avsnitt med klassen .kr-rapport-onumrerad (t.ex. källförteckningen)
  // räknas inte in i numreringen, varken i CSS-räknaren eller här.
  let lopnr = 0;
  const data = sektioner.map((sek, i) => {
    let id = sek.id;
    if (!id) { id = `sektion-${i + 1}`; sek.id = id; }
    const onumrerad = sek.classList.contains("kr-rapport-onumrerad");
    const titel = rubrikText(sek.querySelector("h2"), `Avsnitt ${i + 1}`);
    const subs = [...sek.querySelectorAll("h3")].map((h3, j) => {
      let sid = h3.id;
      if (!sid) { sid = `${id}-h3-${j + 1}`; h3.id = sid; }
      return { el: h3, id: sid, titel: rubrikText(h3, `Del ${j + 1}`) };
    });
    if (!onumrerad) lopnr += 1;
    return { sek, id, titel, nr: onumrerad ? "" : tva(lopnr), onumrerad, subs };
  });

  // Platt rubriklista i dokumentordning för scrollspy: h2, dess h3:or, nästa h2 …
  const flat = [];
  data.forEach((d, si) => {
    flat.push({ el: d.sek.querySelector("h2") || d.sek, si, sub: -1 });
    d.subs.forEach((s, sj) => flat.push({ el: s.el, si, sub: sj }));
  });

  // ── Meny (utfällbar innehållsförteckning i topbaren, smala skärmar) ──
  const sekLankar = [];
  const subLankar = [];
  const meny = h("div", { class: "kr-rapport-meny" });
  data.forEach((d) => {
    const grupp = h("div", { class: "kr-rapport-meny-grupp" });
    const sekLank = h(
      "a",
      { class: "kr-rapport-meny-lank kr-rapport-meny-lank--sek", href: "#" + d.id },
      h("span", { class: "kr-rapport-meny-num" }, d.nr),
      h("span", {}, d.titel)
    );
    sekLankar.push(sekLank);
    grupp.appendChild(sekLank);

    const subArr = [];
    if (d.subs.length) {
      const sublista = h("div", { class: "kr-rapport-meny-sub" });
      d.subs.forEach((s) => {
        const sl = h("a", { class: "kr-rapport-meny-sublank", href: "#" + s.id }, s.titel);
        subArr.push(sl);
        sublista.appendChild(sl);
      });
      grupp.appendChild(sublista);
    }
    subLankar.push(subArr);
    meny.appendChild(grupp);
  });

  // ── Toppbar (övre raden) ──
  const nuNum = h("span", { class: "kr-rapport-topbar-num" }, data[0].nr);
  const nuTitel = h("span", { class: "kr-rapport-topbar-titel" }, data[0].titel);
  const nuSub = h("span", { class: "kr-rapport-topbar-sub" });
  const toggle = h(
    "button",
    { class: "kr-rapport-topbar-toggle", type: "button", "aria-expanded": "false", "aria-label": "Visa innehåll" },
    nuNum, nuTitel, nuSub,
    h("span", { class: "kr-rapport-topbar-chevron" }, "▾")
  );
  const hoger = h("div", { class: "kr-rapport-topbar-hoger" }, toggle, meny);
  const tillbaka = h("a", { class: "kr-rapport-topbar-tillbaka", href: "../" }, "← Alla kapitel");

  // ── Segmenterad positions-bar (en ruta per avsnitt, smala skärmar) ──
  const segFyll = [];
  const segEl = [];
  const segbar = h("div", { class: "kr-rapport-segbar" });
  data.forEach((d) => {
    const fyll = h("span", { class: "kr-rapport-seg-fyll" });
    const tip = h(
      "span", { class: "kr-rapport-seg-tip" },
      h("span", { class: "kr-rapport-seg-tip-num" }, d.nr),
      d.titel
    );
    const seg = h("button", { class: "kr-rapport-seg", type: "button", "aria-label": `Gå till ${d.titel}` }, fyll, tip);
    seg.addEventListener("click", () => {
      const y = d.sek.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top: y, behavior: "smooth" });
    });
    segbar.appendChild(seg);
    segEl.push(seg);
    segFyll.push(fyll);
  });

  const bar = h(
    "div",
    { class: "kr-rapport-topbar" },
    h("div", { class: "kr-rapport-topbar-inner" }, tillbaka, hoger),
    segbar
  );
  if (accent) bar.style.setProperty("--accent", accent);
  document.body.appendChild(bar);
  document.body.classList.add("har-topbar"); // ger innehållet plats under baren

  // Öppna/stäng menyn
  let oppen = false;
  const settOppen = (v) => {
    oppen = v;
    bar.classList.toggle("ar-meny", v);
    toggle.setAttribute("aria-expanded", String(v));
  };
  toggle.addEventListener("click", (e) => { e.stopPropagation(); settOppen(!oppen); });
  document.addEventListener("click", () => oppen && settOppen(false));
  meny.addEventListener("click", () => settOppen(false));

  // ── Scrollspy (sista rubriken ovanför tröskeln är aktiv) ──
  const TROSKEL = 120;
  let aktivSi = -1;
  let aktivSub = -2;
  let sidnav = null;
  const spy = () => {
    let idx = 0;
    for (let i = 0; i < flat.length; i++) {
      if (flat[i].el.getBoundingClientRect().top - TROSKEL <= 0) idx = i;
    }
    const f = flat[idx];
    if (f.si === aktivSi && f.sub === aktivSub) return;
    aktivSi = f.si;
    aktivSub = f.sub;
    const d = data[aktivSi];
    nuNum.textContent = d.nr;
    nuTitel.textContent = d.titel;
    nuSub.textContent = f.sub >= 0 ? d.subs[f.sub].titel : "";
    sekLankar.forEach((l, si) => l.classList.toggle("ar-aktiv", si === aktivSi));
    subLankar.forEach((arr, si) =>
      arr.forEach((l, sj) => l.classList.toggle("ar-aktiv", si === aktivSi && sj === f.sub))
    );
    segEl.forEach((s, si) => s.classList.toggle("ar-aktiv", si === aktivSi));
    if (sidnav) sidnav.settAktiv(aktivSi, aktivSub);
  };

  // ── Läsprogress per avsnitt (segbar + sidomeny) ──
  // Fyll = hur långt läsraden (TROSKEL) passerat genom avsnittet. Sista avsnittet
  // hinner aldrig scrollas så att läsraden når dess botten, så där skalar vi om
  // intervallet [0, max-möjlig] → [0, 1] så det fylls jämnt 0→100% till sidans slut.
  const fyllSeg = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const y = window.scrollY;
    data.forEach((d, i) => {
      const rect = d.sek.getBoundingClientRect();
      const topDoc = rect.top + y;
      let f;
      if (i === data.length - 1) {
        const intraMax = (max + TROSKEL - topDoc) / rect.height;
        const intraNu = (y + TROSKEL - topDoc) / rect.height;
        f = intraMax > 0 ? klamp(intraNu / intraMax) : klamp(intraNu);
      } else {
        f = klamp((TROSKEL - rect.top) / rect.height);
      }
      segFyll[i].style.width = (f * 100) + "%";
      if (sidnav) sidnav.settFyll(i, f);
    });
  };

  // ── Sidomeny (vänster) ──
  // Kapitellistan hämtas ur data/kapitel.json; går det inte visas bara
  // kapitlets egna avsnitt.
  const resSidnav = (kapitel) => {
    sidnav = byggSidnav(data, kapitel, kapitelId());
    if (accent) sidnav.el.style.setProperty("--accent", accent);
    document.body.appendChild(sidnav.el);
    document.body.classList.add("har-sidnav");
    sidnav.settAktiv(Math.max(0, aktivSi), aktivSub);
    fyllSeg();
  };
  fetch("../data/kapitel.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => resSidnav(j && j.kapitel ? j.kapitel : null))
    .catch(() => resSidnav(null));

  let ko = false;
  const vidScroll = () => {
    if (ko) return;
    ko = true;
    requestAnimationFrame(() => { ko = false; spy(); fyllSeg(); });
  };
  window.addEventListener("scroll", vidScroll, { passive: true });
  window.addEventListener("resize", vidScroll, { passive: true });
  spy();
  fyllSeg();

  numreraFigurer(rapport, { vidFlush: figurLankar() });
  initSynpunkter(rapport);
}
