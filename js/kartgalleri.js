// =============================================================================
// GALLERI: alla rapportens kartor, respektive grafer, på ett ställe (förstasidan)
//
//   const g = kartgalleri({ kartor, kapitel, bas })
//   const gg = grafgalleri({ grafer, kapitel, bas })   // samma galleri för grafer
//   g.oppna()            öppnar rutnätet (valfritt g.oppna("befolkning") = filter)
//   g.visa("jarnvag")    öppnar en karta direkt i visaren
//
// kartor: kartgalleri/kartor.json (mapgl-kartor, skrivs av R/kartsystem.R) +
//         kartgalleri/kartor-extra.json (JS-kartor och zonkartan).
// Rutnätet visar förrenderade miniatyrer (kartgalleri/tumnaglar/, ingen WebGL);
// visaren laddar EN karta i taget i en iframe, med miniatyren som omedelbar
// förhandsbild. Djuplänkar: #kartgalleri, #kartgalleri/<kapitel>, #karta/<id>
// resp. #grafgalleri, #grafgalleri/<kapitel>, #graf/<id>.
// Grafgalleriet: grafgalleri/grafer.json + tumnaglar byggs av
// grafgalleri/bygg-grafgalleri.mjs; visaren laddar kapitelsidan i grafvy
// (<kapitel>/?grafvy=<id>, se js/toc.js) så att grafen är fullt interaktiv.
// Tangentbord: ← → bläddrar, Esc backar (visare → rutnät → stängt).
// =============================================================================

const IKON = {
  kryss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  vanster: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  hoger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  rutnat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/></svg>',
  in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>',
  ut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/></svg>',
  pil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
};

const tva = (n) => String(n).padStart(2, "0");

function h(tag, attrs = {}, ...barn) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const b of barn.flat()) if (b != null) el.appendChild(typeof b === "string" ? document.createTextNode(b) : b);
  return el;
}

const TEXT = {
  karta: { en: "karta", fler: "kartor", best: "kartan", Fler: "Kartor", galleri: "kartgalleri", hash: "kartgalleri", post: "karta",
           rubrik: "Rapportens kartor", alla: "Alla kartor", iframe: "Karta" },
  graf:  { en: "graf", fler: "grafer", best: "grafen", Fler: "Grafer", galleri: "grafgalleri", hash: "grafgalleri", post: "graf",
           rubrik: "Rapportens grafer", alla: "Alla grafer", iframe: "Graf" }
};

export function kartgalleri({ kartor = [], kapitel = [], bas = "" } = {}) {
  return galleri({ poster: kartor, kapitel, bas, typ: "karta" });
}

export function grafgalleri({ grafer = [], kapitel = [], bas = "" } = {}) {
  return galleri({ poster: grafer, kapitel, bas, typ: "graf" });
}

function galleri({ poster = [], kapitel = [], bas = "", typ = "karta" } = {}) {
  const T = TEXT[typ];
  const kartor = poster;
  const kap = new Map(kapitel.map((k) => [k.id, k]));
  const lista = kartor
    .filter((k) => kap.has(k.kapitel))
    .sort((a, b) => (kap.get(a.kapitel).nummer - kap.get(b.kapitel).nummer) || ((a.ordning || 0) - (b.ordning || 0)));
  const antalPer = new Map();
  lista.forEach((k) => antalPer.set(k.kapitel, (antalPer.get(k.kapitel) || 0) + 1));

  let filter = null;       // kapitel-id eller null
  let aktuell = -1;        // index i lista (visaren)
  let sistaFokus = null;

  // ── Rutnät ──
  const chips = h("div", { class: "kr-gal-chips", role: "toolbar", "aria-label": "Filtrera på kapitel" });
  const alla = h("button", { type: "button", class: "kr-gal-chip", "aria-pressed": "true", onclick: () => sattFilter(null) },
    "Alla", h("span", { class: "kr-gal-chip-n" }, String(lista.length)));
  chips.appendChild(alla);
  const chipEl = new Map();
  kapitel.filter((k) => antalPer.get(k.id)).forEach((k) => {
    const c = h("button", { type: "button", class: "kr-gal-chip", "aria-pressed": "false", style: `--accent:${k.farg}`, title: `${tva(k.nummer)} ${k.titel}`,
      onclick: () => sattFilter(k.id) },
      h("span", { class: "kr-gal-chip-num" }, tva(k.nummer)), k.kategori,
      h("span", { class: "kr-gal-chip-n" }, String(antalPer.get(k.id))));
    chipEl.set(k.id, c);
    chips.appendChild(c);
  });

  const forhamtad = new Set();
  const forhamta = (k) => {
    if (forhamtad.has(k.id)) return;
    forhamtad.add(k.id);
    document.head.appendChild(h("link", { rel: "prefetch", href: bas + k.src.split("?")[0] }));
  };

  const rutnat = h("ul", { class: "kr-gal-rutnat", role: "list" });
  const kortEl = lista.map((k, i) => {
    const K = kap.get(k.kapitel);
    const li = h("li", { class: "kr-gal-post", style: `--accent:${K.farg}`, "data-kapitel": k.kapitel },
      h("button", { type: "button", class: "kr-gal-kort", onclick: () => visa(i),
          onpointerenter: () => forhamta(k), onfocus: () => forhamta(k),
          "aria-label": `${k.titel}. Kapitel ${tva(K.nummer)}, ${K.titel}. Öppna ${T.best}.` },
        h("span", { class: "kr-gal-bild" },
          h("img", { src: bas + k.tumnagel, alt: "", loading: "lazy", decoding: "async", width: "480", height: "320" }),
          h("span", { class: "kr-gal-oppna", html: IKON.in })),
        h("span", { class: "kr-gal-text" },
          h("span", { class: "kr-gal-kicker" }, `${tva(K.nummer)} · ${K.kategori}${k.figur ? ` · Figur ${k.figur}` : ""}`),
          h("span", { class: "kr-gal-titel" }, k.titel),
          k.beskrivning ? h("span", { class: "kr-gal-besk" }, k.beskrivning) : null)));
    rutnat.appendChild(li);
    return li;
  });

  const antalText = h("span", { class: "kr-gal-antal" });
  const stang = h("button", { type: "button", class: "kr-gal-stang", "aria-label": `Stäng ${T.galleri}et`, html: IKON.kryss, onclick: () => stangAllt() });
  const vyRutnat = h("section", { class: "kr-gal-vy kr-gal-vy--rutnat", "aria-label": T.alla },
    h("header", { class: "kr-gal-huvud" },
      h("div", { class: "kr-gal-huvud-text" },
        h("span", { class: "kr-gal-overrubrik" }, `Halland · ${T.galleri}`),
        h("h2", { class: "kr-gal-rubrik", id: `kr-gal-rubrik-${typ}` }, T.rubrik),
        antalText),
      stang),
    chips,
    rutnat);

  // ── Visare ──
  const ram = h("div", { class: "kr-vis-ram" });
  const forhand = h("img", { class: "kr-vis-forhand", alt: "" });
  const iframe = h("iframe", { class: "kr-vis-iframe", title: T.iframe, allow: "fullscreen", allowfullscreen: true });
  ram.append(forhand, iframe);
  const visKicker = h("span", { class: "kr-vis-kicker" });
  const visTitel = h("h2", { class: "kr-vis-titel", id: `kr-vis-titel-${typ}` });
  const visBesk = h("p", { class: "kr-vis-besk" });
  const raknare = h("span", { class: "kr-vis-raknare", "aria-live": "polite" });
  const lasLank = h("a", { class: "kr-vis-las" }, h("span", {}, "Läs i kapitlet"), h("span", { class: "kr-vis-las-pil", html: IKON.pil }));
  const knapp = (cls, ikon, etikett, fn) => h("button", { type: "button", class: "kr-vis-knapp " + cls, title: etikett, "aria-label": etikett, html: ikon, onclick: fn });
  const fore = knapp("kr-vis-fore", IKON.vanster, `Föregående ${T.en}`, () => steg(-1));
  const nasta = knapp("kr-vis-nasta", IKON.hoger, `Nästa ${T.en}`, () => steg(1));
  const tillRutnat = h("button", { type: "button", class: "kr-vis-tillbaka", onclick: () => tillbaka() },
    h("span", { html: IKON.rutnat }), h("span", { class: "kr-vis-tillbaka-text" }, T.alla));
  const fsKnapp = knapp("kr-vis-fs", IKON.in, "Helskärm", () => vaxlaFs());
  const vyVisare = h("section", { class: "kr-gal-vy kr-gal-vy--visare", "aria-labelledby": `kr-vis-titel-${typ}`, hidden: true },
    h("header", { class: "kr-vis-huvud" },
      tillRutnat,
      h("div", { class: "kr-vis-mitt" }, visKicker, visTitel),
      h("div", { class: "kr-vis-verktyg" }, raknare, fore, nasta,
        document.fullscreenEnabled ? fsKnapp : null,
        knapp("kr-vis-stang", IKON.kryss, `Stäng ${T.galleri}et`, () => stangAllt()))),
    ram,
    h("footer", { class: "kr-vis-fot" }, visBesk, lasLank));

  const dialog = h("dialog", { class: `kr-galleri kr-galleri--${typ}`, "aria-labelledby": `kr-gal-rubrik-${typ}` }, vyRutnat, vyVisare);
  document.body.appendChild(dialog);

  // ── Tillstånd ──
  function sattFilter(id) {
    filter = id;
    alla.setAttribute("aria-pressed", String(!id));
    chipEl.forEach((c, k) => c.setAttribute("aria-pressed", String(k === id)));
    let n = 0;
    kortEl.forEach((li) => { const syns = !id || li.dataset.kapitel === id; li.hidden = !syns; if (syns) n++; });
    const K = id && kap.get(id);
    antalText.textContent = K ? `${n} ${n === 1 ? T.en : T.fler} i kapitel ${tva(K.nummer)}, ${K.titel}` : `${n} ${T.fler} ur ${antalPer.size} kapitel`;
    rutnat.scrollTop = 0;
  }

  const synliga = () => lista.map((k, i) => i).filter((i) => !kortEl[i].hidden);

  let laddTimer = null;
  function laddaKarta(i) {
    const k = lista[i];
    const K = kap.get(k.kapitel);
    aktuell = i;
    dialog.style.setProperty("--accent", K.farg);
    visKicker.textContent = `Kapitel ${tva(K.nummer)} · ${K.kategori}${k.figur ? ` · Figur ${k.figur}` : ""}`;
    visTitel.textContent = k.titel;
    visBesk.textContent = k.beskrivning || "";
    lasLank.href = bas + k.ankare;
    const s = synliga();
    const pos = s.indexOf(i);
    raknare.textContent = `${pos + 1} av ${s.length}`;
    fore.disabled = pos <= 0;
    nasta.disabled = pos >= s.length - 1;
    iframe.title = `${T.iframe}: ${k.titel}`;
    // Förhandsbilden syns direkt; kartan tonar in när den är klar
    ram.classList.remove("kr-klar");
    forhand.src = bas + k.tumnagel;
    const url = bas + k.src + (typ === "karta" ? (k.src.includes("?") ? "&" : "?") + "galleri" : "");
    iframe.src = url;
    clearTimeout(laddTimer);
    iframe.onload = () => { laddTimer = setTimeout(() => ram.classList.add("kr-klar"), 1400); };
    // grannarna förhämtas så att bläddring känns omedelbar
    [s[pos - 1], s[pos + 1]].filter((x) => x != null).forEach((j) => forhamta(lista[j]));
  }

  function visa(i, { historik = true } = {}) {
    if (!dialog.open) oppnaDialog();
    sistaFokus = kortEl[i].querySelector("button");
    vyRutnat.hidden = true;
    vyVisare.hidden = false;
    laddaKarta(i);
    if (historik) sattHash(`#${T.post}/${lista[i].id}`);
    tillRutnat.focus({ preventScroll: true });
  }

  function steg(d) {
    const s = synliga();
    const pos = s.indexOf(aktuell) + d;
    if (pos < 0 || pos >= s.length) return;
    sistaFokus = kortEl[s[pos]].querySelector("button");
    laddaKarta(s[pos]);
    sattHash(`#${T.post}/${lista[s[pos]].id}`, true);
  }

  function tillbaka({ historik = true } = {}) {
    if (document.fullscreenElement) document.exitFullscreen();
    vyVisare.hidden = true;
    vyRutnat.hidden = false;
    iframe.removeAttribute("src");
    try { iframe.src = "about:blank"; } catch (_) { /* */ }
    if (historik) sattHash(filter ? `#${T.hash}/${filter}` : `#${T.hash}`, true);
    (sistaFokus || alla).focus({ preventScroll: true });
    sistaFokus?.scrollIntoView({ block: "nearest" });
  }

  let foreFokusSida = null;
  function oppnaDialog() {
    foreFokusSida = document.activeElement;
    dialog.showModal();
    document.documentElement.classList.add("kr-gal-oppen");
  }

  function oppna(kapitelId = null, { historik = true } = {}) {
    sattFilter(kapitelId && antalPer.get(kapitelId) ? kapitelId : null);
    if (!dialog.open) oppnaDialog();
    vyVisare.hidden = true;
    vyRutnat.hidden = false;
    if (historik) sattHash(filter ? `#${T.hash}/${filter}` : `#${T.hash}`);
    (filter ? chipEl.get(filter) : alla).focus({ preventScroll: true });
  }

  function stangAllt({ historik = true } = {}) {
    if (document.fullscreenElement) document.exitFullscreen();
    iframe.removeAttribute("src");
    if (dialog.open) dialog.close();
    document.documentElement.classList.remove("kr-gal-oppen");
    if (historik && hashRe.test(location.hash)) {
      history.pushState(null, "", location.pathname + location.search);
    }
    if (foreFokusSida && foreFokusSida.focus) foreFokusSida.focus({ preventScroll: true });
  }

  function sattHash(hash, ersatt = false) {
    if (location.hash === hash) return;
    (ersatt ? history.replaceState : history.pushState).call(history, null, "", hash);
  }

  function vaxlaFs() {
    if (document.fullscreenElement) document.exitFullscreen();
    else vyVisare.requestFullscreen?.().catch(() => {});
  }
  document.addEventListener("fullscreenchange", () => {
    const pa = document.fullscreenElement === vyVisare;
    fsKnapp.innerHTML = pa ? IKON.ut : IKON.in;
    fsKnapp.title = pa ? "Lämna helskärm" : "Helskärm";
    fsKnapp.setAttribute("aria-label", fsKnapp.title);
    try { iframe.contentWindow?.postMessage({ kr: "karta-lage", helskarm: pa }, "*"); } catch (_) { /* */ }
  });

  // Kartans egen helskärmsknapp (kartsystem.js) → helskärm för visaren
  const koppla = () => {
    if (!window.KrKarta) return false;
    window.KrKarta.helskarmHook = (f) => { if (f === iframe) { vaxlaFs(); return true; } return false; };
    return true;
  };
  if (typ === "karta" && !koppla()) document.addEventListener("kr-kartsystem-redo", koppla, { once: true });
  window.addEventListener("message", (e) => {
    if (e.source === iframe.contentWindow && e.data && (e.data.kr === "karta-klar" || e.data.kr === "graf-klar")) {
      clearTimeout(laddTimer);
      ram.classList.add("kr-klar");
    }
  });

  // Esc: visare → rutnät → stängt
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (!vyVisare.hidden) tillbaka();
    else stangAllt();
  });
  dialog.addEventListener("keydown", (e) => {
    if (vyVisare.hidden || e.target.closest("input, select, textarea")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); steg(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); steg(1); }
  });
  // Klick på bakgrunden utanför innehållet stänger inte (dialogen fyller skärmen)

  // ── Djuplänkar och bakåtknappen ──
  function franHash() {
    const m = location.hash.match(new RegExp(`^#${T.post}/([A-Za-z0-9_-]+)`));
    const g = location.hash.match(new RegExp(`^#${T.hash}(?:/([A-Za-z0-9_-]+))?`));
    if (m) {
      const i = lista.findIndex((k) => k.id === m[1]);
      if (i >= 0) { if (!dialog.open) sattFilter(null); visa(i, { historik: false }); return; }
    }
    if (g) { oppna(g[1] || null, { historik: false }); return; }
    if (dialog.open) stangAllt({ historik: false });
  }
  const hashRe = new RegExp(`^#(${T.hash}|${T.post}/)`);
  window.addEventListener("popstate", franHash);
  window.addEventListener("hashchange", franHash);
  sattFilter(null);
  if (hashRe.test(location.hash)) setTimeout(franHash, 0);

  return { oppna, visa: (id) => { const i = lista.findIndex((k) => k.id === id); if (i >= 0) visa(i); }, antal: lista.length, antalPer, lista };
}
