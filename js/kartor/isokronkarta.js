// =============================================================================
// ISOKRONKARTA — hur långt hinner man inom 15, 30, 45 och 60 minuter?
//
// Interaktiv maplibre-karta (kapitel 05). Visar restidsytor (isokroner) från en
// startort, antingen alla färdsätt samtidigt (60 minuter, en kontur per färdsätt)
// eller ett färdsätt i taget med nästade band (15/30/45/60 min, mörkast närmast).
//
// Data (förberäknade av service-och-tillganglighet/bearbetning_data/tg_07–08):
//   orter:    { orter:[{ id, namn, kommun, grupp, lage, hallplats, lon, lat,
//                        nas:{ FS:{15,30,45,60} }, nasUt:{…} }], halland:{ FS:{15,…} } }
//   bas:      GeoJSON med länsgränser (typ halland/lan), nätets yttergräns (natverk)
//             och städer utanför länet (typ stad, namn)
//   katalog:  mapp med en GeoJSON per ort (<id>.geojson), features { fs, t }.
//             Ortens fil hämtas när orten väljs; övriga förhämtas i bakgrunden.
//
// Val, legend och siffror läggs i .tk-ctrl och .tk-leg, som kartsystemet
// (js/kartor/kartsystem.js) flyttar till kartans fasta panel. CSS: klassprefix iso-
// i js/kartor/tillganglighetskarta.css.
// Returnerar en .graf-container (numreras som figur av toc.js).
// =============================================================================

const MAPLIBRE_JS  = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css";
const STIL_URL     = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const STIL_TK = new URL("./tillganglighetskarta.css", import.meta.url).href;
if (typeof document !== "undefined" && !document.querySelector(`link[href="${STIL_TK}"]`)) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = STIL_TK; document.head.appendChild(l);
}

// Samma laddare som tillganglighetskarta.js (delas via window, maplibre körs en gång)
function laddaMaplibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (window.__krLaddaMaplibre) return window.__krLaddaMaplibre;
  if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = MAPLIBRE_CSS;
    document.head.appendChild(l);
  }
  window.__krLaddaMaplibre = fetch(MAPLIBRE_JS)
    .then((r) => { if (!r.ok) throw new Error("maplibre: " + r.status); return r.text(); })
    .then((kod) => {
      new Function("define", "module", "exports", kod + "\n//# sourceURL=maplibre-gl.js")(undefined, undefined, undefined);
      if (!window.maplibregl) throw new Error("maplibre saknas efter laddning");
      return window.maplibregl;
    });
  return window.__krLaddaMaplibre;
}

// ── Färdsätten ──────────────────────────────────────────────────────────────
// Kulör per färdsätt (samma som kapitlets grafer). Inom ett färdsätt har banden
// en sekventiell skala i samma kulör, mörkast närmast starten (15, 30, 45, 60 min).
export const FS = {
  WALK:    { namn: "Gång",            kort: "till fots",           farg: "#00AB60", linje: "#00664D",
             band: ["#00664D", "#00AB60", "#7FCFA0", "#D3EFD9"] },
  BICYCLE: { namn: "Cykel",           kort: "med cykel",           farg: "#8CD211", linje: "#4E7A08",
             band: ["#4E7A08", "#7CB518", "#B5DE6A", "#E4F3C8"] },
  TRANSIT: { namn: "Kollektivtrafik", kort: "med kollektivtrafik", farg: "#2DB8F6", linje: "#1E63A8",
             band: ["#004990", "#1C8FD0", "#62C3F5", "#C8E9FB"] },
  CAR:     { namn: "Bil",             kort: "med bil",             farg: "#6A2E5E", linje: "#4A1F42",
             band: ["#5B2752", "#8C4F81", "#BC8EB2", "#E8D3E3"] }
};
const ORDNING = ["CAR", "TRANSIT", "BICYCLE", "WALK"];           // ritordning i jämförelsen (störst underst)
const AVG = [
  { v: "snabb",  t: "Snabbaste avgång",       fs: "TRANSIT",   not: "snabbaste avgång 07–09, gång till hållplatsen" },
  { v: "typisk", t: "Typisk avgång",          fs: "TRANSIT50", not: "typisk avgång 07–09, gång till hållplatsen" },
  { v: "cykel",  t: "Cykel till hållplatsen", fs: "TRANSITB",  not: "snabbaste avgång 07–09, cykel eller gång till hållplatsen" }
];
const GRANSER = [15, 30, 45, 60];
const ALFA = 0.62;                                                // per band (ytorna ligger på varandra)
const ALFA_ALLA = ["match", ["get", "fs"], "CAR", 0.07, "BICYCLE", 0.2, "WALK", 0.26, 0.2];

const tom = (v) => v === null || v === undefined || Number.isNaN(v);
export const fmtSv = (v) => tom(v) ? "–" : Math.round(+v).toLocaleString("sv-SE");
// Stora tal kort: 1,2 milj., 556 000
const fmtKort = (v) => tom(v) ? "–" : v >= 1e6
  ? (v / 1e6).toLocaleString("sv-SE", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + " milj."
  : (v >= 10000 ? Math.round(v / 1000) * 1000 : v >= 1000 ? Math.round(v / 100) * 100 : Math.round(v)).toLocaleString("sv-SE");

const andel = (a, b) => (100 * a / b < 1 ? "under 1 procent" : `${fmtSv(100 * a / b)} procent`);

// Färg för k staplade lager av en kulör över vitt (legendens rutor)
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
function staplad(hex, a, k) {
  const al = 1 - Math.pow(1 - a, k), c = rgb(hex);
  return `rgb(${c.map((x) => Math.round(255 + (x - 255) * al)).join(",")})`;
}
// Bandets färg som den syns på kartan: ytorna 60, 45, … ligger på varandra
function bandFarg(band, i, a = ALFA) {
  let c = [255, 255, 255];
  for (let k = band.length - 1; k >= i; k--) { const b = rgb(band[k]); c = c.map((x, j) => a * b[j] + (1 - a) * x); }
  return `rgb(${c.map(Math.round).join(",")})`;
}

// Utbredning med marginal (andel av bredd och höjd på varje sida)
const marginal = (b, m = 0.05) => b && [[b[0][0] - m * (b[1][0] - b[0][0]), b[0][1] - m * (b[1][1] - b[0][1])],
  [b[1][0] + m * (b[1][0] - b[0][0]), b[1][1] + m * (b[1][1] - b[0][1])]];

function bboxAv(features) {
  let v = Infinity, s = Infinity, o = -Infinity, n = -Infinity;
  const ga = (c) => (typeof c[0] === "number"
    ? (v = Math.min(v, c[0]), o = Math.max(o, c[0]), s = Math.min(s, c[1]), n = Math.max(n, c[1]))
    : c.forEach(ga));
  features.forEach((f) => ga(f.geometry.coordinates));
  return v === Infinity ? null : [[v, s], [o, n]];
}

export function isokronkarta({
  orter,                        // url eller objekt (05-isokron-orter.json)
  bas,                          // url eller objekt (05-isokron-bas.geojson)
  katalog,                      // url till mappen med <ort>.geojson (med avslutande /)
  start = {},
  title = null, subtitle = null, caption = null,
  hojd = 700
} = {}) {
  const cont = document.createElement("div");
  cont.className = "graf-container tk-container iso-container";
  cont.innerHTML = `
    <div class="graf-header">
      ${title ? `<div class="graf-title">${title}</div>` : ""}
      <div class="graf-subtitle iso-under">${subtitle || ""}</div>
    </div>
    <div class="tk-karta iso-karta" style="height:${hojd}px">
      <div class="tk-laddar">Laddar kartan …</div>
      <div class="tk-ctrl iso-ctrl"></div>
      <div class="tk-leg iso-leg"></div>
    </div>
    ${caption ? `<div class="graf-footer"><div class="graf-caption">${caption}</div></div>` : ""}`;
  const kartEl = cont.querySelector(".tk-karta");
  const ctrlEl = cont.querySelector(".tk-ctrl");
  const legEl = cont.querySelector(".tk-leg");
  const underEl = cont.querySelector(".iso-under");

  const state = { ort: start.ort || "varberg", fs: start.fs || "ALLA", avg: start.avg || "snabb" };
  let O = null, ORT = new Map(), HAL = {}, map = null, ml = null;
  const cache = new Map();
  const hamtaOrt = (id) => {
    if (!cache.has(id)) cache.set(id, fetch(`${katalog}${id}.geojson`).then((r) => r.json()));
    return cache.get(id);
  };
  const hamta = (x) => (typeof x === "string" ? fetch(x).then((r) => r.json()) : Promise.resolve(x));

  const transitVariant = () => AVG.find((a) => a.v === state.avg).fs;
  const variant = (fs) => (fs === "TRANSIT" ? transitVariant() : fs);
  const visade = () => (state.fs === "ALLA" ? ORDNING.map(variant) : [variant(state.fs)]);

  // ── Panelens val ──
  function byggVal() {
    const grupper = [...new Set(O.orter.map((d) => d.grupp))];
    let h = `<div class="tk-lbl">Startort</div><select class="tk-sel iso-sel" aria-label="Välj startort">` +
      grupper.map((g) => `<optgroup label="${g}">` + O.orter.filter((d) => d.grupp === g)
        .map((d) => `<option value="${d.id}" ${d.id === state.ort ? "selected" : ""}>${d.namn}</option>`).join("") + `</optgroup>`).join("") +
      `</select>`;
    const knapp = (dim, v, t) => `<button type="button" data-dim="${dim}" data-v="${v}" class="${state[dim] === v ? "active" : ""}" aria-pressed="${state[dim] === v}">${t}</button>`;
    h += `<div class="tk-lbl">Färdsätt</div><div class="tk-grp tk-rad iso-fs">` +
      knapp("fs", "ALLA", "Jämför alla") +
      ["WALK", "BICYCLE", "TRANSIT", "CAR"].map((f) => knapp("fs", f, f === "TRANSIT" ? "Kollektivt" : FS[f].namn)).join("") + `</div>`;
    if (state.fs === "TRANSIT") {
      h += `<div class="tk-lbl">Kollektivtrafiken</div><div class="tk-grp iso-avg">` +
        AVG.map((a) => knapp("avg", a.v, a.t)).join("") + `</div>`;
    }
    ctrlEl.innerHTML = h;
  }

  // ── Legend med nådda invånare ──
  function ritaLegend() {
    const o = ORT.get(state.ort);
    let h = `<div class="iso-leg-h">${o.namn}</div><div class="iso-leg-s">${o.hallplats} · ${o.lage.charAt(0).toLowerCase() + o.lage.slice(1)}</div>`;
    const rad = (sw, text, varde, ref, max, farg) => {
      const b = Math.max(1.5, 100 * Math.min(varde, max) / max);
      const r = ref != null ? `<i class="iso-ref" style="left:${Math.min(100, 100 * ref / max)}%"></i>` : "";
      return `<div class="iso-r"><span class="iso-sw">${sw}</span><span class="iso-rt">${text}</span><b>${fmtKort(varde)}</b>` +
        `<span class="iso-bar"><i style="width:${b}%;background:${farg}"></i>${r}</span></div>`;
    };
    if (state.fs === "ALLA") {
      h += `<div class="iso-leg-k">Invånare inom 60 minuter</div>`;
      const v = ORDNING.slice().reverse();   // gång överst
      const max = Math.max(...v.map((f) => o.nas[variant(f)]?.["60"] || 0), 1);
      v.forEach((f) => {
        const fv = variant(f), F = FS[f];
        const sw = `<i class="iso-sw-yta" style="background:${staplad(F.farg, 0.35, 1)};border-color:${F.linje}"></i>`;
        h += rad(sw, F.namn, o.nas[fv]?.["60"], HAL[fv]?.["60"], max, F.farg);
      });
      const ut = o.nasUt.CAR?.["60"], tot = o.nas.CAR?.["60"];
      if (tot && ut > 0) h += `<div class="iso-leg-n">Med bil bor ${andel(ut, tot)} av dem man når utanför Halland.</div>`;
    } else {
      const f = state.fs, fv = variant(f), F = FS[f];
      h += `<div class="iso-leg-k">${F.namn}${f === "TRANSIT" ? ", " + AVG.find((a) => a.v === state.avg).t.toLowerCase() : ""}: invånare som nås</div>`;
      const max = Math.max(o.nas[fv]?.["60"] || 0, HAL[fv]?.["60"] || 0, 1);
      GRANSER.forEach((t, i) => {
        const sw = `<i class="iso-sw-yta" style="background:${bandFarg(F.band, i)};border-color:${i === 3 ? F.linje : "#fff"}"></i>`;
        h += rad(sw, `Inom ${t} min`, o.nas[fv]?.[String(t)], HAL[fv]?.[String(t)], max, F.band[Math.min(i, 2)]);
      });
      const ut = o.nasUt[fv]?.["60"], tot = o.nas[fv]?.["60"];
      if (tot && ut > 0) h += `<div class="iso-leg-n">Inom 60 minuter bor ${andel(ut, tot)} av dem man når utanför Halland.</div>`;
    }
    h += `<div class="iso-leg-f"><span><i class="iso-ref-ikon"></i>Medianhallänningen</span>` +
      `<span><i class="iso-linje-ikon"></i>Länsgräns</span>` +
      `<span><i class="iso-natverk-ikon"></i>Restidsnätets gräns</span></div>`;
    legEl.innerHTML = h;
  }

  function ritaUnder() {
    const o = ORT.get(state.ort);
    const tid = new Date(2026, 9, 13).toLocaleDateString("sv-SE", { weekday: "long" });
    underEl.textContent = state.fs === "ALLA"
      ? `Områden som nås inom 60 minuter från ${o.hallplats} med gång, cykel, kollektivtrafik och bil. Kollektivtrafik: ${AVG.find((a) => a.v === state.avg).not}, en ${tid} i oktober.`
      : `Områden som nås inom 15, 30, 45 och 60 minuter från ${o.hallplats} ${FS[state.fs].kort}` +
        (state.fs === "TRANSIT" ? ` (${AVG.find((a) => a.v === state.avg).not}, en ${tid} i oktober).` : ".");
  }

  // ── Kartlagren ──
  function tillampa(zooma) {
    if (!map) return;
    byggVal(); ritaLegend(); ritaUnder();
    const v = visade();
    const filt = state.fs === "ALLA"
      ? ["all", ["==", ["get", "t"], 60], ["in", ["get", "fs"], ["literal", v]]]
      : ["==", ["get", "fs"], v[0]];
    const fargPer = (nyckel) => ["match", ["get", "fs"],
      variant("CAR"), FS.CAR[nyckel], variant("TRANSIT"), FS.TRANSIT[nyckel],
      "BICYCLE", FS.BICYCLE[nyckel], "WALK", FS.WALK[nyckel], "#888"];
    map.setFilter("iso-yta", filt);
    map.setFilter("iso-kant", filt);
    map.setFilter("iso-kant-glod", state.fs === "ALLA" ? filt : ["all", filt, ["==", ["get", "t"], 60]]);
    if (state.fs === "ALLA") {
      map.setPaintProperty("iso-yta", "fill-color", fargPer("farg"));
      map.setPaintProperty("iso-yta", "fill-opacity", ALFA_ALLA);
      map.setPaintProperty("iso-kant", "line-color", fargPer("linje"));
      map.setPaintProperty("iso-kant", "line-width", 2.1);
      map.setPaintProperty("iso-kant", "line-opacity", 0.95);
    } else {
      const F = FS[state.fs];
      map.setPaintProperty("iso-yta", "fill-color", ["match", ["get", "t"], 15, F.band[0], 30, F.band[1], 45, F.band[2], F.band[3]]);
      map.setPaintProperty("iso-yta", "fill-opacity", ALFA);
      map.setPaintProperty("iso-kant", "line-color", ["match", ["get", "t"], 60, F.linje, "#ffffff"]);
      map.setPaintProperty("iso-kant", "line-width", ["match", ["get", "t"], 60, 1.8, 0.9]);
      map.setPaintProperty("iso-kant", "line-opacity", ["match", ["get", "t"], 60, 0.95, 0.85]);
    }
    map.setFilter("iso-ort-vald", ["==", ["get", "id"], state.ort]);
    map.setFilter("iso-ort-namn-vald", ["==", ["get", "id"], state.ort]);
    map.setFilter("iso-ort-namn", ["!=", ["get", "id"], state.ort]);
    if (zooma) zoomaTill();
  }

  let aktuell = null;   // ortens FeatureCollection
  function zoomaTill(dur = 700) {
    if (!aktuell) return;
    const v = visade();
    const f = aktuell.features.filter((d) => v.includes(d.properties.fs) && d.properties.t === 60);
    const b = bboxAv(f);
    if (b) map.fitBounds(b, { padding: 28, duration: dur, maxZoom: 13 });
  }

  let begaran = 0;
  async function valjOrt(id, zooma = true) {
    state.ort = id;
    const nr = ++begaran;
    const fc = await hamtaOrt(id);
    if (nr !== begaran) return;          // ett senare val hann före
    aktuell = fc;
    map.getSource("iso").setData(fc);
    tillampa(zooma);
  }

  // ── Händelser i panelen ──
  ctrlEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-dim]"); if (!b) return;
    state[b.dataset.dim] = b.dataset.v;
    tillampa(true);
  });
  ctrlEl.addEventListener("change", (ev) => {
    if (ev.target.classList.contains("iso-sel")) valjOrt(ev.target.value);
  });

  const init = async () => {
    try {
      const [maplibregl, oo, bb] = await Promise.all([laddaMaplibre(), hamta(orter), hamta(bas)]);
      ml = maplibregl; O = oo; HAL = oo.halland || {};
      O.orter.forEach((d) => ORT.set(d.id, d));
      if (!ORT.has(state.ort)) state.ort = O.orter[0].id;
      const forsta = await hamtaOrt(state.ort);
      aktuell = forsta;
      const v0 = visade();
      const startB = marginal(bboxAv(forsta.features.filter((d) => v0.includes(d.properties.fs) && d.properties.t === 60))) ||
        [[11.75, 56.33], [13.75, 57.62]];

      map = new ml.Map({ container: kartEl, style: STIL_URL, bounds: startB, fitBoundsOptions: { padding: 28 },
        fadeDuration: 0, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-right");
      kartEl._krStartGranser = startB;
      const anmal = () => window.KrKarta && window.KrKarta.forbattra(kartEl, map);
      map.once("load", () => (window.KrKarta ? anmal() : document.addEventListener("kr-kartsystem-redo", anmal, { once: true })));

      map.on("load", () => {
        const lager = map.getStyle().layers;
        // Bakgrundens stads- och ortnamn ersätts av kartans egna (svenska, utvalda)
        lager.forEach((l) => { if (/^place_(city|town|capital)/.test(l.id)) map.setLayoutProperty(l.id, "visibility", "none"); });
        const forstaSymbol = (lager.find((l) => l.type === "symbol") || {}).id;
        const typsnitt = (() => {
          const l = lager.find((x) => /^place_(city|town)/.test(x.id) && x.layout && x.layout["text-font"]) ||
            lager.find((x) => x.type === "symbol" && x.layout && x.layout["text-font"]);
          return l ? l.layout["text-font"] : ["Open Sans Regular"];
        })();
        const fet = typsnitt.map((f) => f.replace(/Regular|Medium|Book/, "Bold"));

        map.addSource("iso", { type: "geojson", data: forsta });
        map.addSource("iso-bas", { type: "geojson", data: bb });
        map.addSource("iso-orter", { type: "geojson", data: { type: "FeatureCollection",
          features: O.orter.map((d) => ({ type: "Feature", properties: { id: d.id, namn: d.namn },
            geometry: { type: "Point", coordinates: [d.lon, d.lat] } })) } });

        map.addLayer({ id: "iso-yta", type: "fill", source: "iso",
          layout: { "fill-sort-key": ["match", ["get", "fs"], "CAR", 1, "TRANSIT", 2, "TRANSIT50", 2, "TRANSITB", 2, "BICYCLE", 3, 4] },
          paint: { "fill-color": "#888", "fill-opacity": ALFA, "fill-antialias": true } }, forstaSymbol);
        map.addLayer({ id: "iso-kant-glod", type: "line", source: "iso",
          layout: { "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 4, "line-opacity": 0.75, "line-blur": 0.5 } }, forstaSymbol);
        map.addLayer({ id: "iso-kant", type: "line", source: "iso",
          layout: { "line-join": "round", "line-sort-key": ["match", ["get", "fs"], "CAR", 1, "TRANSIT", 2, "TRANSIT50", 2, "TRANSITB", 2, "BICYCLE", 3, 4] },
          paint: { "line-color": "#555", "line-width": 1.2 } }, forstaSymbol);
        map.addLayer({ id: "iso-lan", type: "line", source: "iso-bas", filter: ["==", ["get", "typ"], "lan"],
          paint: { "line-color": "#8d969b", "line-width": 0.8, "line-opacity": 0.8 } }, forstaSymbol);
        map.addLayer({ id: "iso-natverk", type: "line", source: "iso-bas", filter: ["==", ["get", "typ"], "natverk"],
          paint: { "line-color": "#A51300", "line-width": 1.1, "line-opacity": 0.55, "line-dasharray": [2, 2] } }, forstaSymbol);
        map.addLayer({ id: "iso-halland-glod", type: "line", source: "iso-bas", filter: ["==", ["get", "typ"], "halland"],
          paint: { "line-color": "#ffffff", "line-width": 4.5, "line-opacity": 0.8 } }, forstaSymbol);
        map.addLayer({ id: "iso-halland", type: "line", source: "iso-bas", filter: ["==", ["get", "typ"], "halland"],
          paint: { "line-color": "#26323a", "line-width": 1.5, "line-opacity": 0.85, "line-dasharray": [3, 1.6] } }, forstaSymbol);

        // Egna ortnamn överst
        const halo = { "text-halo-color": "rgba(255,255,255,0.92)", "text-halo-width": 1.6, "text-halo-blur": 0.3 };
        map.addLayer({ id: "iso-stad", type: "symbol", source: "iso-bas", filter: ["==", ["get", "typ"], "stad"],
          layout: { "text-field": ["get", "namn"], "text-font": typsnitt,
            "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10.5, 10, 13.5],
            "symbol-sort-key": ["-", 0, ["coalesce", ["get", "bef"], 0]] },
          paint: { "text-color": "#4a555c", ...halo } });
        map.addLayer({ id: "iso-ort", type: "circle", source: "iso-orter",
          paint: { "circle-radius": 3.6, "circle-color": "#ffffff", "circle-stroke-color": "#1B2A5C", "circle-stroke-width": 1.4 } });
        map.addLayer({ id: "iso-ort-namn", type: "symbol", source: "iso-orter",
          layout: { "text-field": ["get", "namn"], "text-font": typsnitt, "text-size": 11.5,
            "text-anchor": "left", "text-offset": [0.7, 0], "text-optional": true },
          paint: { "text-color": "#1B2A5C", ...halo } });
        map.addLayer({ id: "iso-ort-vald", type: "circle", source: "iso-orter", filter: ["==", ["get", "id"], state.ort],
          paint: { "circle-radius": 7, "circle-color": "#1B2A5C", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
        map.addLayer({ id: "iso-ort-namn-vald", type: "symbol", source: "iso-orter", filter: ["==", ["get", "id"], state.ort],
          layout: { "text-field": ["get", "namn"], "text-font": fet, "text-size": 14.5,
            "text-anchor": "left", "text-offset": [0.85, 0], "text-allow-overlap": true, "text-ignore-placement": true },
          paint: { "text-color": "#1B2A5C", "text-halo-color": "#ffffff", "text-halo-width": 2.2 } });

        cont.querySelector(".tk-laddar")?.remove();
        tillampa(false);

        // Klick på en ort byter startpunkt
        ["iso-ort", "iso-ort-namn"].forEach((id) => {
          map.on("click", id, (e) => { const p = e.features[0].properties; if (p.id !== state.ort) valjOrt(p.id); });
          map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
        });

        // Hover: kortaste restidsbandet under pekaren
        const tip = new ml.Popup({ closeButton: false, closeOnClick: false, className: "tk-tip-pop", offset: 12, maxWidth: "300px" });
        map.on("mousemove", (e) => {
          const ortTraff = map.queryRenderedFeatures(e.point, { layers: ["iso-ort"] });
          if (ortTraff.length) {
            const o = ORT.get(ortTraff[0].properties.id);
            tip.setLngLat(e.lngLat).setHTML(`<div class="tk-tip">${o.namn} · ${o.id === state.ort ? "vald startort" : "klicka för att räkna härifrån"}</div>`).addTo(map);
            return;
          }
          const f = map.queryRenderedFeatures(e.point, { layers: ["iso-yta"] });
          if (!f.length) { tip.remove(); return; }
          const namn = ORT.get(state.ort).namn;
          let txt;
          if (state.fs === "ALLA") {
            const fs = [...new Set(f.map((d) => d.properties.fs))]
              .sort((a, b) => ORDNING.map(variant).indexOf(b) - ORDNING.map(variant).indexOf(a))
              .map((x) => FS[x.startsWith("TRANSIT") ? "TRANSIT" : x].namn.toLowerCase());
            const lista = fs.length > 1 ? fs.slice(0, -1).join(", ") + " och " + fs[fs.length - 1] : fs[0];
            txt = `Inom 60 min från ${namn} · ${lista.charAt(0).toUpperCase() + lista.slice(1)}`;
          } else {
            const t = Math.min(...f.map((d) => d.properties.t));
            txt = `Inom ${t} min från ${namn} · ${FS[state.fs].namn}${state.fs === "TRANSIT" ? ", " + AVG.find((a) => a.v === state.avg).t.toLowerCase() : ""}`;
          }
          tip.setLngLat(e.lngLat).setHTML(`<div class="tk-tip">${txt}</div>`).addTo(map);
        });
        map.getCanvas().addEventListener("mouseleave", () => tip.remove());

        // Förhämta övriga orter när kartan vilar, så att bytet blir omedelbart
        map.once("idle", () => {
          const resten = O.orter.map((d) => d.id).filter((id) => id !== state.ort);
          const nasta = () => { const id = resten.shift(); if (id) hamtaOrt(id).finally(() => setTimeout(nasta, 60)); };
          (window.requestIdleCallback || ((f) => setTimeout(f, 400)))(nasta);
        });
      });
    } catch (err) {
      const l = cont.querySelector(".tk-laddar");
      if (l) l.textContent = "Kartan kunde inte laddas (" + err.message + ")";
    }
  };
  const vanta = () => (cont.isConnected ? init() : requestAnimationFrame(vanta));
  requestAnimationFrame(vanta);

  cont._iso = { state, valjOrt: (id) => valjOrt(id), tillampa: () => tillampa(true) };
  return cont;
}
