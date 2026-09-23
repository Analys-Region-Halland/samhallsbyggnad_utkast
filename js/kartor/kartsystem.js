// =============================================================================
// KARTSYSTEM: gemensamt beteende för alla maplibre-kartor i rapporten
//
// Laddas på varje sida (rapportsidor via _quarto.yml, kartsidor i kartgalleri/
// via R/kartsystem.R). Samma skript gör två saker beroende på sammanhang:
//
// 1. PÅ VARJE KARTA (mapgl-widget eller tillganglighetskarta.js):
//    - samlar alla legender, val och infopaneler i EN fast panel: sidokolumn
//      till vänster på bred karta, ark nertill på smal. Kartans kamera får
//      motsvarande padding, så inget innehåll hamnar under panelen och
//      ingenting kan krocka.
//    - knappgrupp uppe till höger: zoom, hem (startvyn), helskärm.
//    - kooperativa gester i löptexten (Ctrl+skrolla, två fingrar på mobil),
//      fri interaktion i helskärm och i galleriet.
//    - bakgrundskartans ortnamn läggs över ytlager (fill/heatmap/raster).
//    - svenska etiketter och aria-texter.
// 2. PÅ RAPPORTSIDAN:
//    - kartramar (.kr-karta-ram) laddas lat: iframen får sin src först nära
//      skärmen, och högst MAX_LEVANDE kartor hålls igång samtidigt (WebGL-tak).
//    - helskärm för hela figuren (Fullscreen API, CSS-reserv för iPhone).
//
// Protokoll mellan kartsida (iframe) och förälder via postMessage:
//   { kr: "karta-klar" }            kartsidan → förälder: första idle
//   { kr: "karta-helskarm" }        kartsidan → förälder: växla helskärm
//   { kr: "karta-lage", helskarm }  förälder → kartsidan: nytt läge
// =============================================================================
(function () {
  if (window.KrKarta) return;

  const I_IFRAME = window.parent !== window;
  const PARAM = new URLSearchParams(location.search);
  const GALLERI = PARAM.has("galleri");
  const TUMNAGEL = PARAM.has("tumnagel");   // bygg-tumnaglar.mjs: ren karta utan panel och knappar
  if (TUMNAGEL) document.documentElement.classList.add("kr-tumnagel");
  const KARTSIDA = document.documentElement.classList.contains("kr-kartsida");
  const MAX_LEVANDE = 6;

  const SV = {
    "CooperativeGesturesHandler.WindowsHelpText": "Håll ned Ctrl och skrolla för att zooma kartan",
    "CooperativeGesturesHandler.MacHelpText": "Håll ned ⌘ och skrolla för att zooma kartan",
    "CooperativeGesturesHandler.MobileHelpText": "Använd två fingrar för att flytta kartan",
    "NavigationControl.ZoomIn": "Zooma in",
    "NavigationControl.ZoomOut": "Zooma ut",
    "NavigationControl.ResetBearing": "Återställ norr uppåt",
    "AttributionControl.ToggleAttribution": "Visa källor för bakgrundskartan",
    "Map.Title": "Karta"
  };

  const IKON = {
    hem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7"/><path d="M6.5 9.5V20h11V9.5"/></svg>',
    in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>',
    ut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/></svg>',
    fall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    kryss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  const h = (tag, cls, html) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // 1. FÖRBÄTTRA EN KARTA
  // ───────────────────────────────────────────────────────────────────────────
  const kartor = new Set();

  function startGranser(host, m) {
    // mapgl: startvyn står i widgetens JSON (additional_params.bounds)
    try {
      const js = document.querySelector(`script[data-for="${host.id}"]`);
      const b = js && JSON.parse(js.textContent).x.additional_params.bounds;
      if (b && b.length === 4) return [[b[0], b[1]], [b[2], b[3]]];
    } catch (_) { /* ingen widget-JSON */ }
    if (host._krStartGranser) return host._krStartGranser;
    const g = m.getBounds();
    return [[g.getWest(), g.getSouth()], [g.getEast(), g.getNorth()]];
  }

  function arInbyggd(n) {
    return n.classList.contains("maplibregl-ctrl-attrib") ||
      n.classList.contains("maplibregl-ctrl-scale") ||
      n.classList.contains("kr-kn-grupp") ||
      !!n.querySelector(".maplibregl-ctrl-zoom-in, .maplibregl-ctrl-compass, .maplibregl-ctrl-fullscreen, .maplibregl-ctrl-geolocate, .maplibregl-ctrl-globe, .maplibregl-ctrl-terrain");
  }

  function hittaPaneler(host, m) {
    const c = m.getContainer();
    const hörn = (p) => [...(c.querySelector(".maplibregl-ctrl-" + p)?.children || [])];
    return [
      ...hörn("top-left"),
      ...hörn("top-right").filter((n) => !arInbyggd(n)).map((n) => ((n._krInfo = true), n)),
      ...hörn("bottom-left"),
      ...hörn("bottom-right").filter((n) => !arInbyggd(n)).map((n) => ((n._krInfo = true), n)),
      ...host.querySelectorAll(":scope > .mapboxgl-legend, :scope > .maplibregl-legend, :scope > .tk-leg, :scope > .tk-info, :scope > .tk-ctrl")
    ];
  }

  function etiketterOverst(m) {
    const bas = m._basemapLayerIds;
    if (!bas || !m.getStyle) return;
    const lager = m.getStyle().layers || [];
    // Svenska ortnamn (Positron visar annars t.ex. "Gothenburg")
    lager.forEach((l) => {
      if (!bas.has(l.id) || l.type !== "symbol") return;
      const tf = JSON.stringify(m.getLayoutProperty(l.id, "text-field") || "");
      if (/name/.test(tf)) {
        try { m.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:sv"], ["get", "name"], ["get", "name_en"]]); } catch (_) { /* */ }
      }
    });
    // Kartor som sätter egna ortnamn (stationer, tätorter) döljer bakgrundens
    if (document.querySelector('meta[name="kr-ortnamn"][content="av"]')) {
      lager.forEach((l) => { if (bas.has(l.id) && /^place_/.test(l.id)) m.setLayoutProperty(l.id, "visibility", "none"); });
    }
    if (document.querySelector('meta[name="kr-etiketter"][content="av"]')) return;
    // Första etikettlagret EFTER bakgrundens sista yta/linje (Positron har ett
    // tidigt vattendragsnamn under vägarna; datan ska ligga över vägarna men
    // under ort- och vattennamnen).
    let sista = -1;
    lager.forEach((l, i) => { if (bas.has(l.id) && l.type !== "symbol") sista = i; });
    const forsta = lager.find((l, i) => i > sista && bas.has(l.id) && l.type === "symbol");
    if (!forsta) return;
    const i0 = lager.indexOf(forsta);
    lager.forEach((l, i) => {
      if (i > i0 && !bas.has(l.id) && ["fill", "line", "circle", "heatmap", "raster", "hillshade"].includes(l.type)) {
        try { m.moveLayer(l.id, forsta.id); } catch (_) { /* lagret borta */ }
      }
    });
  }

  function forbattra(host, m) {
    if (!host || !m || host._krKarta) return;
    host._krKarta = true;
    host._krMap = m;
    const c = m.getContainer();
    c.classList.add("kr-kartan");
    host.classList.add("kr-kartan");

    // Svenska texter (används när kontroller/gester skapas härefter)
    try { Object.assign(m._locale || (m._locale = {}), SV); } catch (_) { /* äldre maplibre */ }
    const svenska = () => {
      const t = (sel, txt) => c.querySelectorAll(sel).forEach((b) => { b.title = txt; b.setAttribute("aria-label", txt); });
      t(".maplibregl-ctrl-zoom-in", SV["NavigationControl.ZoomIn"]);
      t(".maplibregl-ctrl-zoom-out", SV["NavigationControl.ZoomOut"]);
      t(".maplibregl-ctrl-compass", SV["NavigationControl.ResetBearing"]);
      t(".maplibregl-ctrl-attrib-button", SV["AttributionControl.ToggleAttribution"]);
    };
    svenska();
    const titel = (host.closest(".graf-container")?.querySelector(".graf-title")?.textContent || document.title || "Karta").trim();
    const canvas = m.getCanvas();
    canvas.setAttribute("aria-label", `Interaktiv karta: ${titel}. Piltangenterna flyttar kartan, plus och minus zoomar.`);
    canvas.setAttribute("role", "application");

    if (typeof m.setPixelRatio === "function") { try { m.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); } catch (_) { /* */ } }

    // Zoomknapparna samlas uppe till höger (tillganglighetskarta.js lade dem nere)
    const br = c.querySelector(".maplibregl-ctrl-bottom-right");
    const tr = c.querySelector(".maplibregl-ctrl-top-right");
    br && [...br.children].forEach((n) => { if (n.querySelector(".maplibregl-ctrl-zoom-in")) tr.appendChild(n); });

    // ── Hem + helskärm ──
    const grupp = h("div", "maplibregl-ctrl maplibregl-ctrl-group kr-kn-grupp");
    const hem = h("button", "kr-kn kr-kn-hem", IKON.hem);
    hem.type = "button"; hem.title = "Tillbaka till startvyn"; hem.setAttribute("aria-label", hem.title);
    const fs = h("button", "kr-kn kr-kn-helskarm", IKON.in);
    fs.type = "button"; fs.title = "Visa kartan i helskärm"; fs.setAttribute("aria-label", fs.title); fs.setAttribute("aria-pressed", "false");
    grupp.append(hem, fs);
    m.addControl({ onAdd: () => grupp, onRemove: () => grupp.remove() }, "top-right");

    const k = { host, m, fs, helskarm: false };
    kartor.add(k);

    const granser = startGranser(host, m);
    const gaHem = (dur) => {
      if (m.getPitch() || m.getBearing()) m.jumpTo({ pitch: 0, bearing: 0 });
      m.fitBounds(granser, { padding: 16, duration: dur ?? 600 });
    };
    hem.addEventListener("click", () => gaHem());
    fs.addEventListener("click", () => begarHelskarm(k));

    const vrid = () => host.classList.toggle("kr-vriden", !!(m.getBearing() || m.getPitch()));
    m.on("rotate", vrid); m.on("pitch", vrid);

    // ── Panelen ──
    const kd = h("div", "kr-kd");
    kd.setAttribute("role", "region");
    const huvud = h("div", "kr-kd-huvud");
    const rubrik = h("span", null, "Teckenförklaring");
    const fall = h("button", "kr-kd-fall", IKON.fall);
    fall.type = "button";
    const inn = h("div", "kr-kd-innehall");
    inn.id = (host.id || "karta" + Math.random().toString(36).slice(2, 7)) + "-panel";
    fall.setAttribute("aria-controls", inn.id);
    huvud.append(rubrik, fall);
    kd.append(huvud, inn);
    host.appendChild(kd);

    let lage = null;      // "sida" | "ark"
    let stangd = false;
    let forstaLayout = true;
    let ordning = 0;

    const samla = () => {
      const nya = hittaPaneler(host, m).filter((p) => p.parentNode !== inn && !kd.contains(p));
      nya.forEach((p) => {
        p._krOrd = ordning++;
        // maplibres knappstil för kontrollgrupper (29 px, avdelare) ska inte gälla kartornas egna listor
        p.classList.remove("maplibregl-ctrl-group");
        inn.appendChild(p);
        // mapgl-legendens inre ruta stylas med #id + !important; nollställ inline
        p.querySelectorAll(".mapboxgl-legend, [id^='legend-']").forEach((el) => {
          [["box-shadow", "none"], ["background", "transparent"], ["padding", "0"], ["margin", "0"],
           ["border", "0"], ["position", "static"], ["max-width", "none"], ["width", "auto"]]
            .forEach(([k, v]) => el.style.setProperty(k, v, "important"));
        });
      });
      const n = inn.children.length;
      kd.hidden = n === 0 || TUMNAGEL;
      const harVal = !!inn.querySelector("button, select, input");
      rubrik.textContent = harVal ? "Teckenförklaring och val" : "Teckenförklaring";
      kd.setAttribute("aria-label", rubrik.textContent);
      return nya.length;
    };

    const sattPadding = (animera) => {
      const W = c.clientWidth;
      let pad = { top: 0, right: 0, bottom: 0, left: 0 };
      const ctrlBL = c.querySelector(".maplibregl-ctrl-bottom-left");
      const ctrlBR = c.querySelector(".maplibregl-ctrl-bottom-right");
      if (!kd.hidden) {
        if (lage === "sida") {
          pad.left = stangd ? 0 : Math.min(kd.offsetWidth, W * 0.5);
          if (ctrlBR) ctrlBR.style.bottom = "";
        } else {
          const hk = kd.offsetHeight;
          pad.bottom = hk;
          if (ctrlBR) ctrlBR.style.bottom = hk + "px";
          if (ctrlBL) ctrlBL.style.bottom = hk + "px";
        }
      }
      const p0 = m.getPadding ? m.getPadding() : null;
      if (p0 && p0.left === pad.left && p0.bottom === pad.bottom && !forstaLayout) return;
      if (forstaLayout) {
        forstaLayout = false;
        m.setPadding(pad);
        m.fitBounds(granser, { padding: 16, duration: 0 });
      } else if (animera) {
        m.easeTo({ padding: pad, duration: 350 });
      } else {
        m.setPadding(pad);
      }
    };

    const layout = (animera) => {
      const W = c.clientWidth, H = c.clientHeight;
      const nytt = W >= 700 && H >= 320 ? "sida" : "ark";
      if (nytt !== lage) {
        lage = nytt;
        stangd = lage === "ark";
        kd.classList.toggle("kr-kd--sida", lage === "sida");
        kd.classList.toggle("kr-kd--ark", lage === "ark");
      }
      // Arket (smal karta) tittar fram med teckenförklaringen, valen kommer
      // efter; i sidopanelen gäller kartans egen ordning (val överst).
      const barn = [...inn.children];
      // Ordning: val → teckenförklaring → infopaneler (sidopanel); på arket
      // kommer teckenförklaringen först så att den syns när arket tittar fram.
      const typ = (p) => p.querySelector("button, select, input") ? "val"
        : (p._krInfo || p.classList.contains("tk-info")) ? "info" : "leg";
      const rang = lage === "ark" ? { leg: 0, val: 1, info: 2 } : { val: 0, leg: 1, info: 2 };
      const sorterad = barn.slice().sort((a, b) => (rang[typ(a)] - rang[typ(b)]) || (a._krOrd - b._krOrd));
      if (sorterad.some((p, i) => p !== barn[i])) sorterad.forEach((p) => inn.appendChild(p));
      kd.style.setProperty("--kr-kd-w", Math.round(Math.max(244, Math.min(300, W * 0.3))) + "px");
      kd.style.setProperty("--kr-ark-max", Math.round(H * 0.66) + "px");
      kd.classList.toggle("kr-kd--stangd", stangd);
      fall.setAttribute("aria-expanded", String(!stangd));
      fall.title = stangd ? "Visa teckenförklaringen" : "Dölj teckenförklaringen";
      fall.setAttribute("aria-label", fall.title);
      sattPadding(animera);
    };

    const vaxla = () => { stangd = !stangd; layout(true); };
    fall.addEventListener("click", (e) => { e.stopPropagation(); vaxla(); });
    huvud.addEventListener("click", () => { if (lage === "ark") vaxla(); });

    samla();
    layout(false);

    // Kontroller/legender som läggs till senare (mapgl lägger legender efter style.load)
    let vantar = false;
    const mo = new MutationObserver(() => {
      if (vantar) return;
      vantar = true;
      requestAnimationFrame(() => {
        vantar = false;
        svenska();
        if (samla()) layout(false);
      });
    });
    mo.observe(c.querySelector(".maplibregl-control-container") || c, { childList: true, subtree: true });
    mo.observe(host, { childList: true });

    // Hover-tooltips (popup utan stängknapp): samma form i alla kartor.
    // Ren text "Område · värde" blir rubrik + värderad; bredden begränsas
    // i CSS (.kr-hovertip) så att tooltipen aldrig spiller över kartan.
    const esc = (t) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    const formaTip = (pop) => {
      if (pop.querySelector(".maplibregl-popup-close-button")) return;
      pop.classList.add("kr-hovertip");
      let n = pop.querySelector(".maplibregl-popup-content");
      while (n && n.children.length === 1 && !n.firstElementChild.matches("b, strong, br") &&
             ![...n.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) n = n.firstElementChild;
      if (!n || n.children.length) return;
      const t = n.textContent.trim(), i = t.indexOf(" · ");
      if (i < 1) return;
      n.innerHTML = `<strong class="kr-tip-rubrik">${esc(t.slice(0, i))}</strong><span class="kr-tip-varde">${esc(t.slice(i + 3))}</span>`;
    };
    let tipVantar = false;
    new MutationObserver(() => {
      if (tipVantar) return;
      tipVantar = true;
      queueMicrotask(() => { tipVantar = false; c.querySelectorAll(".maplibregl-popup").forEach(formaTip); });
    }).observe(c, { childList: true, subtree: true, characterData: true });

    // Storlek (helskärm, CSS-helskärm, rotation av mobil)
    if (window.ResizeObserver) {
      let ko = false;
      new ResizeObserver(() => {
        if (ko) return; ko = true;
        requestAnimationFrame(() => { ko = false; try { m.resize(); } catch (_) { /* */ } layout(false); });
      }).observe(c);
    }

    const narStil = (fn) => (m.isStyleLoaded && m.isStyleLoaded() ? fn() : m.once("idle", fn));
    narStil(() => etiketterOverst(m));

    gester(k);

    m.once("idle", () => {
      if (I_IFRAME && KARTSIDA) window.parent.postMessage({ kr: "karta-klar" }, "*");
    });
  }

  // Kooperativa gester i löptexten, fria gester i helskärm och galleri
  function gester(k) {
    const cg = k.m.cooperativeGestures;
    if (!cg || !cg.enable) return;
    const fri = k.helskarm || GALLERI || (KARTSIDA && !I_IFRAME);
    try { fri ? cg.disable() : cg.enable(); } catch (_) { /* */ }
    if (k.m.scrollZoom && fri) k.m.scrollZoom.enable();
  }

  function sattLage(k, pa) {
    k.helskarm = pa;
    k.fs.innerHTML = pa ? IKON.ut : IKON.in;
    k.fs.title = pa ? "Lämna helskärm" : "Visa kartan i helskärm";
    k.fs.setAttribute("aria-label", k.fs.title);
    k.fs.setAttribute("aria-pressed", String(pa));
    gester(k);
  }

  function begarHelskarm(k) {
    if (KARTSIDA && I_IFRAME) {
      window.parent.postMessage({ kr: "karta-helskarm" }, "*");
    } else if (KARTSIDA) {
      const d = document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (d.requestFullscreen) d.requestFullscreen().catch(() => {});
    } else {
      const fig = k.host.closest(".graf-container") || k.host;
      vaxlaHelskarm(fig);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. HELSKÄRM FÖR EN FIGUR PÅ RAPPORTSIDAN
  // ───────────────────────────────────────────────────────────────────────────
  let cssFig = null;
  let foreFokus = null;

  const arHelskarm = (fig) => document.fullscreenElement === fig || fig.classList.contains("kr-helskarm-css");

  function stangKnapp(fig) {
    let b = fig.querySelector(":scope > .kr-helskarm-stang");
    if (!b) {
      b = h("button", "kr-helskarm-stang", IKON.kryss + "<span>Stäng helskärm</span>");
      b.type = "button";
      b.addEventListener("click", () => vaxlaHelskarm(fig, false));
      fig.appendChild(b);
    }
    return b;
  }

  // Kartytan ligger inbäddad i Quartos cellomslag, så den kan inte bara "flexa":
  // i helskärm får den höjden = skärmen minus figurens rubrik och källrad.
  function anpassaHojd(fig, pa) {
    const yta = fig.querySelector(".kr-karta-ram, .tk-karta, .kr-zonkarta-ram, iframe");
    if (!yta) return;
    if (!pa) {
      if (yta._krHojd !== undefined) { yta.style.height = yta._krHojd; delete yta._krHojd; }
      return;
    }
    if (yta._krHojd === undefined) yta._krHojd = yta.style.height;
    // figuren har fast höjd i helskärm, så mät innehållet ovanför och nedanför kartytan
    let topp = yta;
    while (topp.parentElement && topp.parentElement !== fig) topp = topp.parentElement;
    const satt = () => {
      const ovan = yta.getBoundingClientRect().top - fig.getBoundingClientRect().top + fig.scrollTop;
      let nedan = 0;
      for (let s = topp.nextElementSibling; s; s = s.nextElementSibling) {
        if (getComputedStyle(s).position !== "absolute") nedan += s.offsetHeight;
      }
      yta.style.height = Math.max(240, Math.round(fig.clientHeight - ovan - nedan)) + "px";
    };
    satt();
    requestAnimationFrame(satt);
  }
  window.addEventListener("resize", () => {
    document.querySelectorAll(".kr-helskarm-mal").forEach((fig) => { if (arHelskarm(fig)) anpassaHojd(fig, true); });
  });

  function meddelaLage(fig) {
    const pa = arHelskarm(fig);
    anpassaHojd(fig, pa);
    fig.querySelectorAll("iframe").forEach((f) => {
      try { f.contentWindow.postMessage({ kr: "karta-lage", helskarm: pa }, "*"); } catch (_) { /* */ }
    });
    kartor.forEach((k) => { if (fig.contains(k.host)) sattLage(k, pa); });
  }

  function vaxlaHelskarm(fig, pa) {
    const nu = arHelskarm(fig);
    if (pa === undefined) pa = !nu;
    if (pa === nu) return;
    fig.classList.add("kr-helskarm-mal");
    const stang = stangKnapp(fig);
    if (pa) {
      foreFokus = document.activeElement;
      const api = fig.requestFullscreen && document.fullscreenEnabled;
      const css = () => {
        cssFig = fig;
        fig.classList.add("kr-helskarm-css");
        document.documentElement.classList.add("kr-har-css-helskarm");
        meddelaLage(fig);
        stang.focus({ preventScroll: true });
      };
      if (api) fig.requestFullscreen({ navigationUI: "hide" }).then(() => stang.focus({ preventScroll: true })).catch(css);
      else css();
    } else {
      if (document.fullscreenElement === fig) document.exitFullscreen();
      else {
        fig.classList.remove("kr-helskarm-css");
        document.documentElement.classList.remove("kr-har-css-helskarm");
        cssFig = null;
        meddelaLage(fig);
        if (foreFokus && foreFokus.focus) foreFokus.focus({ preventScroll: true });
      }
    }
  }

  document.addEventListener("fullscreenchange", () => {
    document.querySelectorAll(".kr-helskarm-mal").forEach((fig) => meddelaLage(fig));
    if (!document.fullscreenElement && foreFokus && foreFokus.focus) {
      try { foreFokus.focus({ preventScroll: true }); } catch (_) { /* */ }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && cssFig) vaxlaHelskarm(cssFig, false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. MEDDELANDEN
  // ───────────────────────────────────────────────────────────────────────────
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || !d.kr) return;
    if (d.kr === "karta-lage" && KARTSIDA) {
      kartor.forEach((k) => sattLage(k, !!d.helskarm));
      return;
    }
    // föräldern: hitta iframen som skickade
    const ram = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source);
    if (!ram) return;
    if (d.kr === "karta-klar") {
      ram.closest(".kr-karta-ram")?.classList.add("kr-laddad");
    } else if (d.kr === "karta-helskarm") {
      if (typeof window.KrKarta.helskarmHook === "function" && window.KrKarta.helskarmHook(ram)) return;
      const fig = ram.closest(".graf-container") || ram.closest(".kr-karta-ram") || ram;
      vaxlaHelskarm(fig);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. LAT LADDNING AV KARTRAMAR (rapportsidan)
  // ───────────────────────────────────────────────────────────────────────────
  const levande = [];

  function starta(ram) {
    if (ram._krLever) return;
    const f = ram.querySelector("iframe");
    if (!f) return;
    ram._krLever = true;
    ram.classList.remove("kr-vilande");
    levande.push(ram);
    f.addEventListener("load", () => setTimeout(() => ram.classList.add("kr-laddad"), 1800), { once: true });
    f.src = ram.dataset.src;
    begransa();
  }

  function vila(ram) {
    const f = ram.querySelector("iframe");
    if (!f || !ram._krLever) return;
    ram._krLever = false;
    ram.classList.remove("kr-laddad");
    ram.classList.add("kr-vilande");
    f.removeAttribute("src");
    try { f.src = "about:blank"; } catch (_) { /* */ }
    const i = levande.indexOf(ram);
    if (i >= 0) levande.splice(i, 1);
  }

  function begransa() {
    if (levande.length <= MAX_LEVANDE) return;
    const mitt = window.innerHeight / 2;
    const avst = (r) => { const b = r.getBoundingClientRect(); return Math.abs((b.top + b.bottom) / 2 - mitt); };
    const kandidater = levande.filter((r) => !arHelskarm(r.closest(".graf-container") || r)).sort((a, b) => avst(b) - avst(a));
    while (levande.length > MAX_LEVANDE && kandidater.length) vila(kandidater.shift());
  }

  function lataRamar() {
    const ramar = [...document.querySelectorAll(".kr-karta-ram[data-src]:not([data-kr-obs])")];
    if (!ramar.length) return;
    const io = "IntersectionObserver" in window
      ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) starta(e.target); }), { rootMargin: "900px 0px" })
      : null;
    ramar.forEach((r) => {
      r.setAttribute("data-kr-obs", "");
      r.addEventListener("click", () => starta(r));
      io ? io.observe(r) : starta(r);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. HITTA KARTOR
  // ───────────────────────────────────────────────────────────────────────────
  function skanna() {
    // mapgl-widgets (el.map sätts av bindningen)
    document.querySelectorAll(".html-widget.maplibregl, .maplibregl-map").forEach((el) => {
      const m = el.map;
      if (!m || el._krKarta || typeof m.getContainer !== "function") return;
      if (m.loaded && m.loaded()) forbattra(el, m);
      else if (!el._krVantar) { el._krVantar = true; m.once("load", () => forbattra(el, m)); }
    });
    lataRamar();
  }

  // tillganglighetskarta.js och andra JS-kartor anmäler sig själva
  document.addEventListener("kr-karta", (e) => {
    const { el, map, granser } = e.detail || {};
    if (granser) el._krStartGranser = granser;
    forbattra(el, map);
  });

  window.KrKarta = { forbattra, vaxlaHelskarm, skanna, helskarmHook: null };

  let n = 0;
  const tick = () => { skanna(); if (++n < 80) setTimeout(tick, n < 20 ? 150 : 500); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick);
  else tick();
  let moVantar = false;
  new MutationObserver(() => {
    if (moVantar) return;
    moVantar = true;
    setTimeout(() => { moVantar = false; lataRamar(); }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.dispatchEvent(new CustomEvent("kr-kartsystem-redo"));
})();
