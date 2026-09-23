// =============================================================================
// TILLGÄNGLIGHETSKARTA — interaktiv maplibre-karta för kapitel 05 (och andra kapitel)
//
// Ritar ett fint rutnät (t.ex. 250 m-rutor) och områdesnivåer (DeSO, RegSO, kommun)
// med samma färgskala, och låter läsaren välja mått, färdsätt, restid, nivå och
// kommun med knappar nere till vänster. Infopanelen uppe till höger räknas i
// webbläsaren ur rutornas befolkning: befolkningsviktad median och andelen av
// invånarna i varje färgklass, för hela Halland eller vald kommun.
//
// Data (hämtas med fetch, eller skickas in som objekt):
//   rutor: { id:[], b:[w,s,e,n, w,s,e,n, …], pop:[], kn:[], namn?:[], v:{ nyckel:[…] } }
//          b = rutans gränser i WGS84 (platt lista, fyra tal per ruta)
//          v = ett värde per ruta för varje måttnyckel (null = ingen uppgift)
//   omraden: { DeSO: FeatureCollection, RegSO: …, Kommun: … }
//          varje feature har properties { namn, kn, pop, <nyckel>: värde … }
//
// Dimensioner och nycklar:
//   dims: [{ id:"matt", label:"Mått", options:[{ v:"bef", t:"Invånare" }, …] }, …]
//   nyckel(state) → sträng, t.ex. "bef_WALK_15"
//   skala(state)  → { bryt:[…], farger:[…], etiketter:[…], rubrik, under, enhet, dec, ingen }
//   popup(props, state, nyckelFn) → HTML (valfri)
//
// Returnerar en .graf-container (numreras som figur av toc.js).
// CSS: js/kartor/tillganglighetskarta.css (laddas av modulen, klassprefix tk-).
// =============================================================================

const MAPLIBRE_JS  = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css";
const STIL_URL     = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Modulens egen stil (fungerar både i kapitlet och fristående i kartgalleriet)
const STIL_TK = new URL("./tillganglighetskarta.css", import.meta.url).href;
if (typeof document !== "undefined" && !document.querySelector(`link[href="${STIL_TK}"]`)) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = STIL_TK; document.head.appendChild(l);
}

let _laddar = null;
function laddaMaplibre() {
  if (typeof window !== "undefined" && window.maplibregl) return Promise.resolve(window.maplibregl);
  // Delas via window: modulen kan finnas i flera instanser (kapitlet + kartor.js),
  // och maplibre får bara köras en gång.
  if (window.__krLaddaMaplibre) return window.__krLaddaMaplibre;
  if (_laddar) return _laddar;
  if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = MAPLIBRE_CSS;
    document.head.appendChild(l);
  }
  // Hämta och kör skriptet med `define`/`module` skuggade. Quartos OJS-laddare
  // (d3-require) sätter tillfälligt en global AMD-`define` medan den laddar sina
  // moduler; körs maplibres UMD-paket just då registrerar det sig där i stället
  // för som window.maplibregl (kapplöpning som gav "reading 'Map'").
  _laddar = window.__krLaddaMaplibre = fetch(MAPLIBRE_JS)
    .then((r) => { if (!r.ok) throw new Error("maplibre: " + r.status); return r.text(); })
    .then((kod) => {
      new Function("define", "module", "exports", kod + "\n//# sourceURL=maplibre-gl.js")(undefined, undefined, undefined);
      if (!window.maplibregl) throw new Error("maplibre saknas efter laddning");
      return window.maplibregl;
    });
  return _laddar;
}

const hamta = x => (typeof x === "string" ? fetch(x).then(r => r.json()) : Promise.resolve(x));
const tom = v => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));
export const fmtSv = (v, dec = 0) => tom(v) ? "–" :
  (+v).toLocaleString("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec });

// Befolkningsviktad median
function viktadMedian(varden, vikter) {
  const p = [];
  for (let i = 0; i < varden.length; i++) if (!tom(varden[i]) && vikter[i] > 0) p.push([varden[i], vikter[i]]);
  if (!p.length) return null;
  p.sort((a, b) => a[0] - b[0]);
  const tot = p.reduce((s, d) => s + d[1], 0);
  let acc = 0;
  for (const [v, w] of p) { acc += w; if (acc >= tot / 2) return v; }
  return p[p.length - 1][0];
}

function klass(v, bryt) {
  if (tom(v)) return -1;
  let k = 0;
  while (k < bryt.length && v >= bryt[k]) k++;
  return k;
}

export function tillganglighetskarta({
  rutor,                       // url eller objekt
  omraden = {},                // { DeSO: url|fc, RegSO: …, Kommun: … }
  dims = [],
  nyckel,
  skala,
  start = {},
  nivaer = ["Ruta", "DeSO", "RegSO", "Kommun"],
  startNiva = "Ruta",
  kommuner = [],               // [{ namn, kn, bbox:[w,s,e,n] }]
  helaBbox = [11.6, 56.3, 13.9, 57.75],
  helaNamn = "Hela Halland",
  rutNamn = "250 m-ruta",
  popup = null,
  title = null, subtitle = null, caption = null,
  hojd = 640,
  infoRubrik = "Andel av invånarna",
  visaInfo = true
} = {}) {
  // ── Ram ──
  const cont = document.createElement("div");
  cont.className = "graf-container tk-container";
  cont.innerHTML = `
    <div class="graf-header">
      ${title ? `<div class="graf-title">${title}</div>` : ""}
      ${subtitle ? `<div class="graf-subtitle">${subtitle}</div>` : ""}
    </div>
    <div class="tk-karta" style="height:${hojd}px">
      <div class="tk-laddar">Laddar kartan …</div>
      <div class="tk-leg"></div>
      ${visaInfo ? `<div class="tk-info"></div>` : ""}
      <div class="tk-ctrl"></div>
    </div>
    ${caption ? `<div class="graf-footer"><div class="graf-caption">${caption}</div></div>` : ""}`;
  const kartEl = cont.querySelector(".tk-karta");
  const legEl = cont.querySelector(".tk-leg");
  const infoEl = cont.querySelector(".tk-info");
  const ctrlEl = cont.querySelector(".tk-ctrl");

  const state = { niva: startNiva, omr: "Halland" };
  dims.forEach(d => { state[d.id] = start[d.id] ?? d.options[0].v; });

  // ── Knappar ──
  function byggKnappar() {
    let h = "";
    dims.forEach(d => {
      const synlig = d.visa ? d.visa(state) : true;
      if (!synlig) return;
      const opts = d.options.filter(o => !o.visa || o.visa(state));
      h += `<div class="tk-lbl">${d.label}</div><div class="tk-grp ${d.rad ? "tk-rad" : ""}" data-dim="${d.id}">` +
        opts.map(o => `<button type="button" data-v="${o.v}" class="${state[d.id] === o.v ? "active" : ""}">${o.t}</button>`).join("") +
        `</div>`;
    });
    if (nivaer.length > 1) {
      h += `<div class="tk-lbl">Nivå</div><div class="tk-grp tk-rad" data-dim="niva">` +
        nivaer.map(n => `<button type="button" data-v="${n}" class="${state.niva === n ? "active" : ""}">${n === "Ruta" ? "Ruta" : n}</button>`).join("") + `</div>`;
    }
    if (kommuner.length) {
      h += `<div class="tk-lbl">Område</div><select class="tk-sel" aria-label="Välj kommun">` +
        `<option value="Halland">${helaNamn}</option>` +
        kommuner.map(k => `<option value="${k.namn}" ${state.omr === k.namn ? "selected" : ""}>${k.namn}</option>`).join("") +
        `</select>`;
    }
    ctrlEl.innerHTML = h;
  }

  // ── Legend ──
  function ritaLegend() {
    const S = skala(state);
    let h = `<div class="tk-leg-t">${S.rubrik}</div>${S.under ? `<div class="tk-leg-u">${S.under}</div>` : ""}`;
    const rad = (c, t) => `<div class="tk-leg-r"><i style="background:${c}"></i>${t}</div>`;
    for (let i = S.farger.length - 1; i >= 0; i--) h += rad(S.farger[i], S.etiketter[i]);
    if (S.ingen) h += rad(S.ingenFarg || "#D6D6D6", S.ingen);
    if (S.not) h += `<div class="tk-leg-n">${S.not}</div>`;
    legEl.innerHTML = h;
  }

  let R = null, O = {}, map = null, ml = null;
  const kn2namn = new Map(kommuner.map(k => [k.kn, k.namn]));

  // ── Infopanel (räknas på rutorna) ──
  function ritaInfo() {
    if (!infoEl || !R) return;
    const S = skala(state), k = nyckel(state), v = R.v[k];
    const knVald = state.omr === "Halland" ? null : kommuner.find(x => x.namn === state.omr)?.kn;
    const vv = [], ww = [];
    for (let i = 0; i < R.id.length; i++) {
      if (knVald && R.kn[i] !== knVald) continue;
      vv.push(v ? v[i] : null); ww.push(R.pop[i]);
    }
    const tot = ww.reduce((s, x) => s + x, 0);
    const per = new Array(S.farger.length).fill(0); let ingen = 0;
    vv.forEach((x, i) => { const c = klass(x, S.bryt); if (c < 0) ingen += ww[i]; else per[c] += ww[i]; });
    const med = viktadMedian(vv, ww);
    let h = `<div class="tk-info-h">${state.omr === "Halland" ? helaNamn : state.omr}</div>`;
    h += `<div class="tk-info-s">${fmtSv(tot)} invånare · ${S.kort || S.rubrik}</div>`;
    h += `<div class="tk-info-r"><span>Median för invånarna</span><b>${tom(med) ? "–" : fmtSv(med, S.dec || 0) + (S.enhet || "")}</b></div>`;
    h += `<div class="tk-info-k">${infoRubrik}</div>`;
    for (let i = S.farger.length - 1; i >= 0; i--) {
      const a = tot ? 100 * per[i] / tot : 0;
      h += `<div class="tk-info-bar"><span class="tk-info-bt">${S.etiketter[i]}</span>` +
        `<span class="tk-info-bb"><i style="width:${Math.max(a, 0.6)}%;background:${S.farger[i]}"></i></span>` +
        `<b>${fmtSv(a, a < 10 && a > 0 ? 1 : 0)} %</b></div>`;
    }
    if (S.ingen && ingen > 0) {
      const a = 100 * ingen / tot;
      h += `<div class="tk-info-bar"><span class="tk-info-bt">${S.ingen}</span><span class="tk-info-bb"><i style="width:${Math.max(a, 0.6)}%;background:${S.ingenFarg || "#D6D6D6"}"></i></span><b>${fmtSv(a, a < 10 ? 1 : 0)} %</b></div>`;
    }
    if (S.infoNot) h += `<div class="tk-info-f">${S.infoNot}</div>`;
    infoEl.innerHTML = h;
  }

  // ── Färguttryck ──
  function fargExpr() {
    const S = skala(state), k = nyckel(state);
    const st = ["step", ["get", k], S.farger[0]];
    S.bryt.forEach((b, i) => st.push(b, S.farger[i + 1]));
    return ["case", ["==", ["typeof", ["get", k]], "number"], st, S.ingenFarg || "#D6D6D6"];
  }

  function rutGeojson() {
    const f = [];
    for (let i = 0; i < R.id.length; i++) {
      const w = R.b[4 * i], s = R.b[4 * i + 1], e = R.b[4 * i + 2], n = R.b[4 * i + 3];
      const p = { i, kn: R.kn[i], pop: R.pop[i] };
      for (const key in R.v) p[key] = R.v[key][i];
      f.push({ type: "Feature", id: i, properties: p,
        geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
    }
    return { type: "FeatureCollection", features: f };
  }

  const lagerFor = n => n === "Ruta" ? "tk-ruta" : "tk-" + n;

  function tillampa(zooma) {
    if (!map) return;
    byggKnappar(); ritaLegend(); ritaInfo();
    const knVald = state.omr === "Halland" ? null : kommuner.find(x => x.namn === state.omr)?.kn;
    ["Ruta", ...Object.keys(O)].forEach(n => {
      const id = lagerFor(n);
      if (!map.getLayer(id)) return;
      const synlig = n === state.niva;
      map.setLayoutProperty(id, "visibility", synlig ? "visible" : "none");
      if (map.getLayer(id + "-kant")) map.setLayoutProperty(id + "-kant", "visibility", synlig && n !== "Ruta" ? "visible" : "none");
      if (synlig) {
        map.setPaintProperty(id, "fill-color", fargExpr());
        const bas = n === "Ruta" ? 0.86 : 0.8;
        map.setPaintProperty(id, "fill-opacity", knVald ? ["case", ["==", ["get", "kn"], knVald], bas, 0.12] : bas);
      }
    });
    if (map.getLayer("tk-kommun-vald")) map.setFilter("tk-kommun-vald", ["==", ["get", "kn"], knVald || "ingen"]);
    if (zooma) {
      const b = knVald ? kommuner.find(x => x.kn === knVald).bbox : helaBbox;
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 30, bottom: 30, left: 250, right: visaInfo ? 270 : 30 }, duration: 800 });
    }
  }

  ctrlEl.addEventListener("click", ev => {
    const b = ev.target.closest("button[data-v]"); if (!b) return;
    const dim = b.parentElement.getAttribute("data-dim");
    state[dim] = b.getAttribute("data-v");
    dims.forEach(d => {                                   // håll valen giltiga
      const ok = d.options.filter(o => !o.visa || o.visa(state)).map(o => o.v);
      if (ok.length && !ok.includes(state[d.id])) state[d.id] = ok[0];
    });
    tillampa(false);
  });
  ctrlEl.addEventListener("change", ev => {
    if (!ev.target.classList.contains("tk-sel")) return;
    state.omr = ev.target.value; tillampa(true);
  });

  // ── Montera när elementet syns (OJS monterar asynkront) ──
  const init = async () => {
    try {
      const [maplibregl, rr, ...oo] = await Promise.all([laddaMaplibre(), hamta(rutor), ...Object.values(omraden).map(hamta)]);
      ml = maplibregl; R = rr;
      Object.keys(omraden).forEach((k, i) => { O[k] = oo[i]; });
      map = new ml.Map({ container: kartEl, style: STIL_URL, bounds: [[helaBbox[0], helaBbox[1]], [helaBbox[2], helaBbox[3]]],
        fitBoundsOptions: { padding: 20 }, fadeDuration: 0,
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-right");
      // Kartsystemet (js/kartor/kartsystem.js) lägger legend, info och val i en fast
      // panel, sköter helskärm och kooperativa gester.
      kartEl._krStartGranser = [[helaBbox[0], helaBbox[1]], [helaBbox[2], helaBbox[3]]];
      const anmal = () => window.KrKarta && window.KrKarta.forbattra(kartEl, map);
      map.once("load", () => (window.KrKarta ? anmal() : document.addEventListener("kr-kartsystem-redo", anmal, { once: true })));
      map.on("load", () => {
        const layers = map.getStyle().layers;
        const forsta = (layers.find(l => l.type === "symbol") || {}).id;
        map.addSource("tk-ruta", { type: "geojson", data: rutGeojson() });
        map.addLayer({ id: "tk-ruta", type: "fill", source: "tk-ruta", paint: { "fill-color": "#ccc", "fill-opacity": 0.86 } }, forsta);
        Object.entries(O).forEach(([n, fc]) => {
          map.addSource("tk-" + n, { type: "geojson", data: fc });
          map.addLayer({ id: "tk-" + n, type: "fill", source: "tk-" + n, layout: { visibility: "none" },
            paint: { "fill-color": "#ccc", "fill-opacity": 0.8 } }, forsta);
          map.addLayer({ id: "tk-" + n + "-kant", type: "line", source: "tk-" + n, layout: { visibility: "none" },
            paint: { "line-color": "#ffffff", "line-width": n === "Kommun" ? 1.4 : 0.6, "line-opacity": 0.8 } }, forsta);
        });
        if (O.Kommun) {
          map.addLayer({ id: "tk-kommungrans", type: "line", source: "tk-Kommun",
            paint: { "line-color": "#39495a", "line-width": 1, "line-opacity": 0.55 } }, forsta);
          map.addLayer({ id: "tk-kommun-vald", type: "line", source: "tk-Kommun", filter: ["==", ["get", "kn"], "ingen"],
            paint: { "line-color": "#004990", "line-width": 2.6, "line-opacity": 0.95 } }, forsta);
        }
        cont.querySelector(".tk-laddar")?.remove();
        tillampa(false);

        // Hover och klick
        const tip = new ml.Popup({ closeButton: false, closeOnClick: false, className: "tk-tip-pop", offset: 12, maxWidth: "420px" });
        const pop = new ml.Popup({ closeButton: true, maxWidth: "360px", className: "tk-pop-wrap" });
        const namnFor = (p, n) => n === "Ruta" ? `${rutNamn}${kn2namn.get(p.kn) ? " · " + kn2namn.get(p.kn) : ""}` : (p.namn || "");
        ["Ruta", ...Object.keys(O)].forEach(n => {
          const id = lagerFor(n);
          map.on("mousemove", id, e => {
            map.getCanvas().style.cursor = "pointer";
            if (pop.isOpen()) { tip.remove(); return; }
            const p = e.features[0].properties, S = skala(state), v = p[nyckel(state)];
            tip.setLngLat(e.lngLat).setHTML(`<div class="tk-tip">${namnFor(p, n)} · ${tom(v) ? (S.ingen || "–") : fmtSv(v, S.dec || 0) + (S.enhet || "")}</div>`).addTo(map);
          });
          map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; tip.remove(); });
          map.on("click", id, e => {
            tip.remove();
            const p = e.features[0].properties;
            const html = popup ? popup(p, state, n, namnFor(p, n)) :
              `<div class="tk-pop"><div class="tk-pop-h">${namnFor(p, n)}</div></div>`;
            pop.setLngLat(e.lngLat).setHTML(html).addTo(map);
          });
        });
      });
    } catch (err) {
      const l = cont.querySelector(".tk-laddar");
      if (l) l.textContent = "Kartan kunde inte laddas (" + err.message + ")";
    }
  };
  // Starta när noden är monterad i dokumentet
  const vanta = () => (cont.isConnected ? init() : requestAnimationFrame(vanta));
  requestAnimationFrame(vanta);

  cont._tk = { state, tillampa: () => tillampa(false) };
  return cont;
}
