// =============================================================================
// RELATIONSKARTA — pendlingsrelationerna till och från Halland på karta + lista
//
// Interaktiv maplibre-karta (kapitel 03) med en sorterbar lista under kartan.
// En relation är ett kommunpar (båda riktningarna sammanlagda) där minst en
// kommun ligger i Halland. Linjens bredd = pendlare 2024, färgen = förändring i
// procent sedan 2000. Läsaren väljer Hela Halland eller en kommun i kartans
// panel; listan visar samma relationer med flöde, förändring, minigraf
// 2000–2024 och relationens rang bland alla relationer i länet.
// Hovring i listan markerar relationen på kartan och tvärtom; klick på en rad
// låser markeringen.
//
// Data (funktionell-geografi/bearbetning_data/pendling-relationer.R):
//   { ar, n, min_rel, orter:[{kod,namn,lon,lat,hl}],
//     rel:[{id,a,b,typ,t0,t1,chg,pct,ab,ba,km,rS,rF,s:[…]}], bas: GeoJSON }
//
// Panelens val och legend ligger i .tk-ctrl och .tk-leg, som kartsystemet
// (js/kartor/kartsystem.js) flyttar till kartans fasta panel. CSS: prefix pr-
// i js/kartor/relationskarta.css (plus tk- i tillganglighetskarta.css).
// Returnerar en .graf-container (numreras som figur av toc.js).
// =============================================================================

const MAPLIBRE_JS  = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css";
const STIL_URL     = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

for (const fil of ["./tillganglighetskarta.css", "./relationskarta.css"]) {
  const href = new URL(fil, import.meta.url).href;
  if (typeof document !== "undefined" && !document.querySelector(`link[href="${href}"]`)) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
  }
}

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

// ── Konstanter ──────────────────────────────────────────────────────────────
export const KOMMUNFARG = { "1384": "#0C8C7E", "1383": "#004990", "1382": "#FF7E00",
  "1380": "#A51300", "1381": "#8cd211", "1315": "#7b2d8e" };
const HALLAND = ["1384", "1383", "1382", "1380", "1381", "1315"];
const LAN = { "01": "Stockholm", "03": "Uppsala", "04": "Södermanland", "05": "Östergötland", "06": "Jönköping",
  "07": "Kronoberg", "08": "Kalmar", "09": "Gotland", "10": "Blekinge", "12": "Skåne", "13": "Halland",
  "14": "Västra Götaland", "17": "Värmland", "18": "Örebro", "19": "Västmanland", "20": "Dalarna",
  "21": "Gävleborg", "22": "Västernorrland", "23": "Jämtland", "24": "Västerbotten", "25": "Norrbotten" };
// Förändring i procent 2000–2024: minskning orange, ökning i blå steg
const KLASSER = [
  { t: "Minskat",           farg: "#FF7E00", test: (r) => r.chg < 0 },
  { t: "Ökat under 50 %",   farg: "#8FD0F4", test: (r) => r.pct != null && r.pct < 50 },
  { t: "Ökat 50–99 %",      farg: "#2DB8F6", test: (r) => r.pct != null && r.pct < 100 },
  { t: "Ökat 100–199 %",    farg: "#1C7FC0", test: (r) => r.pct != null && r.pct < 200 },
  { t: "Ökat 200 % eller mer, eller nytt", farg: "#0B3A6E", test: () => true }
];
const klass = (r) => KLASSER.find((k) => k.test(r));
const MAX_KM = 220;                  // längre relationer listas men ritas inte
const MIN_KARTA_HALLAND = 100;       // i vyn Hela Halland ritas relationer med minst så många pendlare 2024
const RADER = 12;                    // rader innan "Visa alla"
const HELA_BOUNDS = [[11.45, 55.95], [14.15, 57.9]];

const fmt = (v) => Math.round(+v).toLocaleString("sv-SE");
const fmtT = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v));
const ord = (n) => { const a = n % 10, b = n % 100; return `${n}:${(a === 1 || a === 2) && b !== 11 && b !== 12 ? "a" : "e"}`; };

// Kvadratisk båge mellan två punkter (lon/lat), böjd åt höger sett från a
function bage(p, q, bojd = null, n = 24) {
  const k = Math.cos(((p[1] + q[1]) / 2) * Math.PI / 180);
  const dx = (q[0] - p[0]) * k, dy = q[1] - p[1];
  if (bojd == null) { const km = 111 * Math.hypot(dx, dy); bojd = km < 60 ? 0.14 : Math.max(0.04, 0.14 * 60 / km); }
  const mx = (p[0] + q[0]) / 2 + (dy * bojd) / k, my = (p[1] + q[1]) / 2 - dx * bojd;
  const ut = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    ut.push([u * u * p[0] + 2 * u * t * mx + t * t * q[0], u * u * p[1] + 2 * u * t * my + t * t * q[1]]);
  }
  return ut;
}

function spark(serie, farg) {
  const w = 84, h = 24, p = 2.5, n = serie.length;
  const lo = Math.min(...serie), hi = Math.max(...serie);
  const x = (i) => p + (i * (w - 2 * p)) / (n - 1);
  const y = (v) => h - p - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (h - 2 * p);
  const pts = serie.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const brott = x(19.5);   // metodbytet 2019/2020
  return `<svg class="pr-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">` +
    `<line x1="${brott}" x2="${brott}" y1="1" y2="${h - 1}" stroke="#c9cccb" stroke-width="0.8" stroke-dasharray="1.5,1.5"/>` +
    `<polygon points="${p},${h - p} ${pts} ${w - p},${h - p}" fill="${farg}" opacity="0.14"/>` +
    `<polyline points="${pts}" fill="none" stroke="${farg}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${x(n - 1)}" cy="${y(serie[n - 1])}" r="2.2" fill="${farg}"/></svg>`;
}

export function relationskarta({
  data,                                   // url eller objekt (pendling-relationer.json)
  start = "",                             // "" = Hela Halland, annars kommunkod
  title = null, caption = null,
  hojd = 640,
  lista = true
} = {}) {
  const cont = document.createElement("div");
  cont.className = "graf-container tk-container pr-container";
  cont.innerHTML = `
    <div class="graf-header">
      ${title ? `<div class="graf-title">${title}</div>` : ""}
      <div class="graf-subtitle pr-under"></div>
    </div>
    <div class="tk-karta pr-karta" style="height:${hojd}px">
      <div class="tk-laddar">Laddar kartan …</div>
      <div class="tk-ctrl pr-ctrl"></div>
      <div class="tk-leg pr-leg"></div>
    </div>
    ${lista ? `<div class="pr-lista"></div>` : ""}
    ${caption ? `<div class="graf-footer"><div class="graf-caption">${caption}</div></div>` : ""}`;
  const kartEl = cont.querySelector(".tk-karta");
  const ctrlEl = cont.querySelector(".tk-ctrl");
  const legEl = cont.querySelector(".tk-leg");
  const underEl = cont.querySelector(".pr-under");
  const listEl = cont.querySelector(".pr-lista");

  const state = { kom: start, sort: "chg", dir: -1, alla: false, last: null };
  let D = null, ORT = new Map(), REL = [], map = null, ml = null, pop = null;

  const namn = (kod) => (ORT.get(kod) || {}).namn || kod;
  const valda = () => REL.filter((r) => !state.kom || r.a === state.kom || r.b === state.kom);
  // I kommunvyn är motparten "den andra" kommunen
  const motpart = (r) => (state.kom && r.b === state.kom ? r.a : r.b);
  const relNamn = (r) => (state.kom ? namn(motpart(r)) : `${namn(r.a)} ↔ ${namn(r.b)}`);

  function ritaUnder() {
    const n = valda().length;
    underEl.textContent = state.kom
      ? `Pendlingsrelationer för ${namn(state.kom)}: pendlare i båda riktningarna 2024 (linjens bredd) och förändring sedan 2000 (färg). ${n} relationer med minst ${D.min_rel} pendlare 2000 eller 2024.`
      : `Alla pendlingsrelationer som rör Halland: pendlare i båda riktningarna 2024 (linjens bredd) och förändring sedan 2000 (färg). ${D.n} relationer med minst ${D.min_rel} pendlare 2000 eller 2024.`;
  }

  // ── Panelens val ──
  function byggVal() {
    const knapp = (kod, t) => `<button type="button" data-kom="${kod}" class="${state.kom === kod ? "active" : ""}" aria-pressed="${state.kom === kod}">` +
      (kod ? `<i class="pr-kdot" style="background:${KOMMUNFARG[kod]}"></i>` : `<i class="pr-kdot pr-kdot-alla"></i>`) + `${t}</button>`;
    ctrlEl.innerHTML = `<div class="tk-lbl">Visa relationer för</div><div class="tk-grp pr-komval">` +
      knapp("", "Hela Halland") + HALLAND.map((k) => knapp(k, namn(k))).join("") + `</div>`;
  }

  function ritaLegend() {
    const bredd = (v) => wFor(v);
    legEl.innerHTML =
      `<div class="tk-leg-t">Förändring 2000–2024</div>` +
      KLASSER.slice().reverse().map((k) => `<div class="tk-leg-r"><i class="pr-leg-linje" style="background:${k.farg}"></i>${k.t}</div>`).join("") +
      `<div class="tk-leg-t pr-leg-t2">Pendlare 2024, båda riktningarna</div>` +
      [18000, 5000, 1000, 100].map((v) => `<div class="tk-leg-r"><i class="pr-leg-bredd" style="height:${bredd(v).toFixed(1)}px"></i>${fmt(v)}</div>`).join("") +
      `<div class="tk-leg-n pr-leg-not"></div>`;
  }

  const paKartan = (r) => r.km <= MAX_KM && (state.kom || r.t1 >= MIN_KARTA_HALLAND);
  let wMax = 1;
  const wFor = (v) => 1.1 + 13 * Math.sqrt(Math.max(0, v) / wMax);

  // ── Kartlager ──
  function geo() {
    const feats = [];
    for (const r of valda()) {
      if (!paKartan(r)) continue;
      const a = ORT.get(r.a), b = ORT.get(r.b);
      feats.push({ type: "Feature", id: r.id,
        properties: { id: r.id, w: wFor(r.t1), farg: klass(r).farg, t1: r.t1 },
        geometry: { type: "LineString", coordinates: bage([a.lon, a.lat], [b.lon, b.lat]) } });
    }
    return { type: "FeatureCollection", features: feats };
  }
  function noder() {
    const syns = new Set(), vikt = new Map();
    for (const r of valda()) {
      if (!paKartan(r)) continue;
      [r.a, r.b].forEach((k) => { syns.add(k); vikt.set(k, Math.max(vikt.get(k) || 0, r.t1)); });
    }
    HALLAND.forEach((k) => syns.add(k));
    return { type: "FeatureCollection", features: [...syns].map((k) => {
      const o = ORT.get(k);
      const hl = HALLAND.includes(k);
      return { type: "Feature", properties: { kod: k, namn: o.namn, hl, farg: hl ? KOMMUNFARG[k] : "#8a8f8d",
        vald: k === state.kom, v: hl ? 1e9 : (vikt.get(k) || 0), etikett: hl || (vikt.get(k) || 0) >= (state.kom ? 60 : 250) },
        geometry: { type: "Point", coordinates: [o.lon, o.lat] } };
    }) };
  }

  function zoomaTill(dur = 700) {
    if (!map) return;
    if (!state.kom) { map.fitBounds(HELA_BOUNDS, { padding: 20, duration: dur }); return; }
    const pts = [];
    valda().filter((r) => r.km <= MAX_KM).sort((x, y) => y.t1 - x.t1).slice(0, 8).forEach((r) => [r.a, r.b].forEach((k) => pts.push(ORT.get(k))));
    pts.push(ORT.get(state.kom));
    const lo = pts.map((p) => p.lon), la = pts.map((p) => p.lat);
    map.fitBounds([[Math.min(...lo) - 0.15, Math.min(...la) - 0.1], [Math.max(...lo) + 0.15, Math.max(...la) + 0.1]],
      { padding: 30, duration: dur, maxZoom: 9 });
  }

  // ── Markering (delas av karta och lista) ──
  function markera(id, fran) {
    if (!map) return;
    const aktiv = id != null ? id : state.last;
    map.setPaintProperty("pr-rel", "line-opacity", aktiv != null ? ["case", ["==", ["get", "id"], aktiv], 1, 0.16] : 0.88);
    map.setFilter("pr-rel-hl", ["==", ["get", "id"], aktiv != null ? aktiv : -1]);
    listEl && listEl.querySelectorAll("tr[data-id]").forEach((tr) => tr.classList.toggle("pr-aktiv", +tr.dataset.id === aktiv));
    if (fran === "lista" && aktiv != null) {
      const r = REL.find((x) => x.id === aktiv);
      if (r && paKartan(r)) {
        const a = ORT.get(r.a), b = ORT.get(r.b);
        const mitt = bage([a.lon, a.lat], [b.lon, b.lat])[12];
        pop.setLngLat(mitt).setHTML(popHtml(r)).addTo(map);
      } else pop.remove();
    }
    if (aktiv == null) pop.remove();
  }

  function popHtml(r) {
    const k = klass(r);
    return `<div class="tk-pop pr-pop"><div class="tk-pop-h">${namn(r.a)} ↔ ${namn(r.b)}</div>` +
      `<div class="tk-pop-s">${r.typ === "intra" ? "Inom Halland" : "Över länsgränsen, " + (LAN[r.b.slice(0, 2)] || "")}</div>` +
      `<table><tr><td>Pendlare 2024</td><td>${fmt(r.t1)}</td></tr>` +
      `<tr><td>${namn(r.a)} → ${namn(r.b)}</td><td>${fmt(r.ab)}</td></tr>` +
      `<tr><td>${namn(r.b)} → ${namn(r.a)}</td><td>${fmt(r.ba)}</td></tr>` +
      `<tr><td>Pendlare 2000</td><td>${fmt(r.t0)}</td></tr>` +
      `<tr class="akt"><td>Förändring</td><td><span style="color:${k.farg === "#8FD0F4" ? "#1C7FC0" : k.farg}">${fmtT(r.chg)}${r.pct != null ? ` (${fmtT(r.pct)} %)` : " (ny)"}</span></td></tr></table>` +
      `<div class="pr-pop-rang"><b>${ord(r.rF)}</b> största ökningen och <b>${ord(r.rS)}</b> största relationen av ${D.n} i länet</div></div>`;
  }

  // ── Listan ──
  const KOL = [
    { k: "namn", t: "Relation", sort: false },
    { k: "t1", t: "Pendlare 2024", sort: true, cls: "pr-tal" },
    { k: "chg", t: "Förändring", sort: true, cls: "pr-tal" },
    { k: "pct", t: "Procent", sort: true, cls: "pr-tal pr-kol-pct" },
    { k: "spark", t: "2000–2024", sort: false, cls: "pr-kol-spark" },
    { k: "rF", t: "Rang, ökning", sort: true, cls: "pr-kol-rang", asc: true },
    { k: "rS", t: "Rang, storlek", sort: true, cls: "pr-kol-rang pr-kol-rs", asc: true }
  ];
  function ritaLista() {
    if (!listEl) return;
    const rs = valda().slice();
    const s = state.sort, dir = state.dir;
    const v = (r) => (s === "pct" ? (r.pct == null ? 1e6 : r.pct) : r[s]);
    rs.sort((x, y) => dir * (v(x) - v(y)) || y.t1 - x.t1);
    const vis = state.alla ? rs : rs.slice(0, RADER);
    const rubrik = state.kom ? `${rs.length} relationer för ${namn(state.kom)}` : `Alla ${rs.length} relationer som rör Halland`;
    const pil = (c) => (c.k === s ? (dir < 0 ? " ↓" : " ↑") : "");
    const posBar = (rank) => `<span class="pr-pos"><i style="left:${(100 * (rank - 1)) / Math.max(1, D.n - 1)}%"></i></span>`;
    listEl.innerHTML =
      `<div class="pr-lista-h"><span class="pr-lista-t">${rubrik}</span><span class="pr-lista-n">Rang bland alla ${D.n} relationer i länet, 1 = störst. Klicka på en kolumnrubrik för att sortera.</span></div>` +
      `<div class="pr-tab-wrap"><table class="pr-tab"><thead><tr>` +
      KOL.map((c) => c.sort
        ? `<th class="${c.cls || ""}" aria-sort="${c.k === s ? (dir < 0 ? "descending" : "ascending") : "none"}"><button type="button" data-sort="${c.k}">${c.t}${pil(c)}</button></th>`
        : `<th class="${c.cls || ""}">${c.t}</th>`).join("") +
      `</tr></thead><tbody>` +
      vis.map((r) => {
        const k = klass(r), m = motpart(r);
        const sub = r.typ === "intra" ? "inom Halland" : (LAN[m.slice(0, 2)] || "") + (r.km > MAX_KM ? `, ${fmt(r.km)} km, bara i listan` : "");
        const dot = state.kom ? "" : `<i class="pr-kdot" style="background:${KOMMUNFARG[r.a]}"></i>`;
        return `<tr data-id="${r.id}" tabindex="0">` +
          `<td class="pr-namn"><div><i class="pr-ldot" style="background:${k.farg}"></i><span>${dot}${relNamn(r)}<small>${sub}</small></span></div></td>` +
          `<td class="pr-tal"><b>${fmt(r.t1)}</b><small>${fmt(r.t0)} år 2000</small></td>` +
          `<td class="pr-tal pr-chg ${r.chg < 0 ? "pr-neg" : ""}">${fmtT(r.chg)}</td>` +
          `<td class="pr-tal pr-kol-pct">${r.pct != null ? fmtT(r.pct) + " %" : "ny"}</td>` +
          `<td class="pr-kol-spark">${spark(r.s, k.farg === "#8FD0F4" ? "#1C7FC0" : k.farg)}</td>` +
          `<td class="pr-kol-rang"><b>${ord(r.rF)}</b>${posBar(r.rF)}</td>` +
          `<td class="pr-kol-rang pr-kol-rs"><b>${ord(r.rS)}</b>${posBar(r.rS)}</td></tr>`;
      }).join("") +
      `</tbody></table></div>` +
      (rs.length > RADER ? `<button type="button" class="pr-fler">${state.alla ? "Visa färre" : `Visa alla ${rs.length} relationer`}</button>` : "");
    if (state.last != null) listEl.querySelectorAll("tr[data-id]").forEach((tr) => tr.classList.toggle("pr-aktiv", +tr.dataset.id === state.last));
  }

  function ritaLegendNot() {
    const el = legEl.querySelector(".pr-leg-not"); if (!el) return;
    el.textContent = (state.kom ? "" : `I vyn Hela Halland ritas relationer med minst ${fmt(MIN_KARTA_HALLAND)} pendlare 2024; välj en kommun för att se alla. `) +
      `Relationer längre än ${MAX_KM} km (t.ex. mot Stockholm) finns bara i listan.`;
  }
  function tillampa(zooma) {
    ritaUnder(); byggVal(); ritaLista(); ritaLegendNot();
    if (!map) return;
    map.getSource("pr-rel").setData(geo());
    map.getSource("pr-nod").setData(noder());
    state.last = null; markera(null);
    if (zooma) zoomaTill();
  }

  // ── Händelser ──
  ctrlEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-kom]"); if (!b) return;
    state.kom = b.dataset.kom; state.alla = false; tillampa(true);
  });
  if (listEl) {
    listEl.addEventListener("click", (ev) => {
      const s = ev.target.closest("button[data-sort]");
      if (s) {
        const c = KOL.find((x) => x.k === s.dataset.sort);
        state.dir = state.sort === c.k ? -state.dir : (c.asc ? 1 : -1);
        state.sort = c.k; ritaLista(); return;
      }
      if (ev.target.closest(".pr-fler")) { state.alla = !state.alla; ritaLista(); return; }
      const tr = ev.target.closest("tr[data-id]");
      if (tr) { const id = +tr.dataset.id; state.last = state.last === id ? null : id; markera(state.last, "lista"); }
    });
    listEl.addEventListener("pointerover", (ev) => {
      const tr = ev.target.closest("tr[data-id]"); if (!tr || ev.pointerType === "touch") return;
      markera(+tr.dataset.id, "lista");
    });
    listEl.addEventListener("pointerleave", () => markera(null));
    listEl.addEventListener("focusin", (ev) => { const tr = ev.target.closest("tr[data-id]"); if (tr) markera(+tr.dataset.id, "lista"); });
  }

  const init = async () => {
    try {
      const [maplibregl, dd] = await Promise.all([laddaMaplibre(),
        typeof data === "string" ? fetch(data).then((r) => r.json()) : Promise.resolve(data)]);
      ml = maplibregl; D = dd;
      D.orter.forEach((o) => ORT.set(o.kod, o));
      REL = D.rel;
      wMax = Math.max(...REL.map((r) => r.t1));
      ritaUnder(); byggVal(); ritaLegend(); ritaLegendNot(); ritaLista();

      map = new ml.Map({ container: kartEl, style: STIL_URL, bounds: HELA_BOUNDS, fitBoundsOptions: { padding: 20 },
        fadeDuration: 0, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-right");
      kartEl._krStartGranser = HELA_BOUNDS;
      const anmal = () => window.KrKarta && window.KrKarta.forbattra(kartEl, map);
      map.once("load", () => (window.KrKarta ? anmal() : document.addEventListener("kr-kartsystem-redo", anmal, { once: true })));
      pop = new ml.Popup({ closeButton: false, closeOnClick: false, className: "tk-tip-pop pr-popup", offset: 10, maxWidth: "320px" });

      map.on("load", () => {
        const lager = map.getStyle().layers;
        lager.forEach((l) => { if (/^place_(city|town|capital|village)/.test(l.id)) map.setLayoutProperty(l.id, "visibility", "none"); });
        const forstaSymbol = (lager.find((l) => l.type === "symbol") || {}).id;
        const typsnitt = (() => {
          const l = lager.find((x) => /^place_(city|town)/.test(x.id) && x.layout && x.layout["text-font"]) ||
            lager.find((x) => x.type === "symbol" && x.layout && x.layout["text-font"]);
          return l ? l.layout["text-font"] : ["Open Sans Regular"];
        })();
        const fet = typsnitt.map((f) => f.replace(/Regular|Medium|Book/, "Bold"));

        map.addSource("pr-bas", { type: "geojson", data: D.bas });
        map.addSource("pr-rel", { type: "geojson", data: geo() });
        map.addSource("pr-nod", { type: "geojson", data: noder() });

        map.addLayer({ id: "pr-kommun", type: "line", source: "pr-bas", filter: ["==", ["get", "typ"], "kommun"],
          paint: { "line-color": "#9aa4a9", "line-width": 0.7, "line-opacity": 0.7 } }, forstaSymbol);
        map.addLayer({ id: "pr-lan", type: "line", source: "pr-bas", filter: ["==", ["get", "typ"], "lan"],
          paint: { "line-color": "#26323a", "line-width": 1.4, "line-opacity": 0.7, "line-dasharray": [3, 1.6] } }, forstaSymbol);
        map.addLayer({ id: "pr-rel-kant", type: "line", source: "pr-rel",
          layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["-", 0, ["get", "t1"]] },
          paint: { "line-color": "#ffffff", "line-width": ["+", ["get", "w"], 1.6], "line-opacity": 0.7 } });
        map.addLayer({ id: "pr-rel", type: "line", source: "pr-rel",
          layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["-", 0, ["get", "t1"]] },
          paint: { "line-color": ["get", "farg"], "line-width": ["get", "w"], "line-opacity": 0.88 } });
        map.addLayer({ id: "pr-rel-hl", type: "line", source: "pr-rel", filter: ["==", ["get", "id"], -1],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#15202b", "line-width": ["+", ["get", "w"], 3], "line-gap-width": 0, "line-opacity": 0.9 } });
        map.moveLayer("pr-rel");   // färgen ovanpå den mörka konturen
        map.addLayer({ id: "pr-nod", type: "circle", source: "pr-nod",
          paint: { "circle-radius": ["case", ["get", "vald"], 8, ["get", "hl"], 5.5, 3.2],
            "circle-color": ["get", "farg"], "circle-stroke-color": "#ffffff", "circle-stroke-width": ["case", ["get", "hl"], 2, 1.2] } });
        const halo = { "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.7, "text-halo-blur": 0.3 };
        map.addLayer({ id: "pr-nod-namn", type: "symbol", source: "pr-nod", filter: ["get", "etikett"],
          layout: { "text-field": ["get", "namn"], "text-font": ["case", ["get", "hl"], ["literal", fet], ["literal", typsnitt]],
            "text-size": ["case", ["get", "vald"], 14.5, ["get", "hl"], 12.5, 11],
            "text-anchor": "left", "text-offset": [0.8, 0], "text-optional": true,
            "symbol-sort-key": ["-", 0, ["get", "v"]] },
          paint: { "text-color": ["case", ["get", "hl"], "#15202b", "#4a555c"], ...halo } });

        cont.querySelector(".tk-laddar")?.remove();
        if (state.kom) zoomaTill(0);

        // Hovring och klick på linjerna
        map.on("mousemove", "pr-rel", (e) => {
          const id = e.features[0].properties.id;
          const r = REL.find((x) => x.id === id);
          map.getCanvas().style.cursor = "pointer";
          pop.setLngLat(e.lngLat).setHTML(popHtml(r)).addTo(map);
          if (state.last == null) markera(id, "karta");
        });
        map.on("mouseleave", "pr-rel", () => { map.getCanvas().style.cursor = ""; if (state.last == null) markera(null); else pop.remove(); });
        map.on("click", "pr-rel", (e) => {
          const id = e.features[0].properties.id;
          state.last = state.last === id ? null : id; markera(state.last, "karta");
          const tr = listEl && listEl.querySelector(`tr[data-id="${id}"]`);
          if (tr && state.last != null) tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
        // Klick på en hallandskommun väljer den
        map.on("click", "pr-nod", (e) => {
          const p = e.features[0].properties;
          if (p.hl && p.kod !== state.kom) { state.kom = p.kod; state.alla = false; tillampa(true); }
        });
        map.on("mouseenter", "pr-nod", (e) => { if (e.features[0].properties.hl) map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "pr-nod", () => { map.getCanvas().style.cursor = ""; });
      });
    } catch (err) {
      const l = cont.querySelector(".tk-laddar");
      if (l) l.textContent = "Kartan kunde inte laddas (" + err.message + ")";
    }
  };
  const vanta = () => (cont.isConnected ? init() : requestAnimationFrame(vanta));
  requestAnimationFrame(vanta);

  cont._pr = { state, valj: (k) => { state.kom = k; tillampa(true); } };
  return cont;
}
