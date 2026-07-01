// =============================================================================
// BYGGNADSSCROLLY — scrollytelling: Hallands bostäder decennium för decennium
// =============================================================================
// Varje bostad är en prick. Scen 0 radar upp dem i decennie-boxar (waffle).
// När man scrollar tonar kartan in och varje decenniums hus flyger ut på
// geografin, färgade efter läge i tätorten (kärna/mellan/ytter/omland).
// Avslutas med en syntes om centralitet kontra utglesning.
//
//   byggnadsScrolly(punkter, { tatorter, aggregat, ...options }) -> DOM-nod
//
// punkter  : kolumnär { x:[],y:[],dec:[],bt:[],t:[],ri:[] } i SWEREF99 TM (3006)
// tatorter : GeoJSON FeatureCollection (3006), props: name, stor
// aggregat : { meta, centrum:[], regional:[], per_tatort:[] }

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { scrollstegare } from "../lib/scrollstegare.js";

const RING_RGB = {
  "-1": [194, 198, 200],   // landsbygd / liten ort
  "0":  [0, 102, 77],      // kärna
  "1":  [46, 158, 110],    // mellanstad
  "2":  [134, 201, 166],   // ytterkant
  "3":  [207, 230, 218],   // ytteromland
};
const ERA_LABEL = ["Före 1950", "1950-talet", "1960-talet", "1970-talet",
  "1980-talet", "1990-talet", "2000-talet", "2010-talet", "2020-talet"];
const N_ERA = ERA_LABEL.length;             // 9 (era 0..8)
const STEG_WAFFLE = 0, STEG_KARTA = 1, STEG_ERA0 = 2;
const N_STEG = 2 + N_ERA + 1;               // waffle + karta + 9 eror + syntes
const STEG_SYNTES = N_STEG - 1;

function eraOf(dec) {
  if (dec === 0) return -1;                  // okänt byggår
  if (dec < 1950) return 0;                  // Före 1950
  return (dec - 1950) / 10 + 1;              // 1950→1 ... 2020→8
}

export function byggnadsScrolly(punkter, opts = {}) {
  const {
    tatorter, aggregat,
    title = "Var i Halland byggdes bostäderna?",
    subtitle = "Varje prick är en bostad, ordnad efter byggdecennium och sedan utlagd på kartan. Färgen visar läget i tätorten: mörk i kärnan, ljus i ytterkanten.",
    caption = "Källa: Region Hallands byggnadspunkter. Läge mätt som radiell position mot tätortens karaktärsradie (dagens tätortsgränser).",
    accent = "#1E63A8",
    height = 720,
    logo = "../logo_farg.svg",
  } = opts;

  const N = punkter.x.length;

  // ── Typade arrayer ─────────────────────────────────────────────────────────
  const X = Float64Array.from(punkter.x);
  const Y = Float64Array.from(punkter.y);
  const ERA = Int8Array.from(punkter.dec, eraOf);
  const RI = Int8Array.from(punkter.ri);
  const BT = Int8Array.from(punkter.bt);

  // Nuvarande och mål-positioner + opacitet, samt tween-tidtagning per prick.
  const cx = new Float32Array(N), cy = new Float32Array(N), co = new Float32Array(N);
  const fX = new Float32Array(N), fY = new Float32Array(N), fO = new Float32Array(N);
  const tX = new Float32Array(N), tY = new Float32Array(N), tO = new Float32Array(N);
  const delay = new Float32Array(N);
  // Layouter
  const wX = new Float32Array(N), wY = new Float32Array(N);   // waffle
  const mX = new Float32Array(N), mY = new Float32Array(N);   // mini-tidslinje
  const gX = new Float32Array(N), gY = new Float32Array(N);   // geografi

  // ── DOM-skelett ────────────────────────────────────────────────────────────
  const root = d3.create("div").attr("class", "graf-container kr-scrolly-root");
  injicieraCss();

  const header = root.append("div").attr("class", "graf-header");
  header.append("img").attr("class", "graf-logo").attr("src", logo).attr("alt", "");
  header.append("div").attr("class", "graf-title").text(title);
  header.append("div").attr("class", "graf-subtitle").text(subtitle);

  const scrolly = root.append("div").attr("class", "kr-scrolly");
  const grafik = scrolly.append("div").attr("class", "kr-scrolly-grafik")
    .style("--sticky-top", "70px").style("height", height + "px");
  const svgBas = grafik.append("svg").attr("class", "kr-sc-svg kr-sc-bas");
  const canvas = grafik.append("canvas").attr("class", "kr-sc-canvas");
  const svgLab = grafik.append("svg").attr("class", "kr-sc-svg kr-sc-lab");
  const readout = grafik.append("div").attr("class", "kr-sc-readout");
  const labLager = grafik.append("div").attr("class", "kr-sc-boxlabels");

  const stegWrap = scrolly.append("div").attr("class", "kr-scrolly-steg");

  // ── Aggregat-uppslag ───────────────────────────────────────────────────────
  const regByDec = new Map(aggregat.regional.map(r => [r.dec, r]));
  let eraStatsOkant = { n: 0 };
  const eraStats = byggEraStats();

  // ── Steg-text ──────────────────────────────────────────────────────────────
  const stegDef = byggStegDef();
  const stegEls = stegDef.map((s, i) =>
    stegWrap.append("div").attr("class", "kr-sc-step").attr("data-step", i)
      .html(`<div class="kr-sc-card">${s.html}</div>`).node());

  // ── Rendering-state ────────────────────────────────────────────────────────
  let W = 0, H = height, dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let ctx = canvas.node().getContext("2d");
  let proj = null, path = null;
  let aktivtSteg = 0;
  let timer = null, tweenStart = 0, TWEEN_MS = 1150;

  const fargTab = byggFargTab();

  function ritaKarta() {
    const fc = tatorter;
    proj = d3.geoIdentity().reflectY(true).fitSize([W, H], fc);
    path = d3.geoPath(proj);

    svgBas.selectAll("*").remove();
    svgBas.attr("viewBox", `0 0 ${W} ${H}`);
    svgBas.append("g").selectAll("path")
      .data(fc.features).join("path")
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", d => d.properties.stor ? "#9aa6ad" : "#cdd3d6")
      .attr("stroke-width", d => d.properties.stor ? 1.1 : 0.6);

    // Centroider + etiketter för de 13 stora
    svgLab.selectAll("*").remove();
    svgLab.attr("viewBox", `0 0 ${W} ${H}`);
    const cs = aggregat.centrum.map(c => ({ ...c, p: proj([c.cx, c.cy]) }));
    svgLab.append("g").selectAll("circle").data(cs).join("circle")
      .attr("cx", d => d.p[0]).attr("cy", d => d.p[1]).attr("r", 2.6)
      .attr("fill", "none").attr("stroke", "#33404a").attr("stroke-width", 1);
    svgLab.append("g").selectAll("text").data(cs).join("text")
      .attr("x", d => d.p[0]).attr("y", d => d.p[1] - 6)
      .attr("text-anchor", "middle").attr("class", "kr-sc-townlab")
      .text(d => d.namn);
  }

  function beraknaLayouter() {
    for (let i = 0; i < N; i++) { const p = proj([X[i], Y[i]]); gX[i] = p[0]; gY[i] = p[1]; }
    waffleLayout();
    miniLayout();
  }

  // Waffle: en kvadratisk box per era (+ okänt), shelf-packad, area ~ antal.
  function waffleLayout() {
    const grupper = [];
    for (let e = 0; e < N_ERA; e++) grupper.push({ key: e, idx: [] });
    grupper.push({ key: -1, idx: [] });
    for (let i = 0; i < N; i++) {
      const g = grupper.find(g => g.key === ERA[i]); g.idx.push(i);
    }
    // Stratifiera varje box efter läge: kärna överst (mörk), landsbygd nederst (grå).
    for (const g of grupper) g.idx.sort((a, b) =>
      (RI[a] < 0 ? 99 : RI[a]) - (RI[b] < 0 ? 99 : RI[b]));
    // välj cellstorlek så allt får plats
    const padBox = 26, marg = 8;
    let s = 2.2;
    for (; s >= 0.8; s -= 0.1) {
      if (packa(grupper, s, padBox, marg, true) <= H) break;
    }
    packa(grupper, s, padBox, marg, false);
  }
  function packa(grupper, s, padBox, marg, matOnly) {
    let rx = 0, ry = padBox, radH = 0, maxH = 0;
    for (const g of grupper) {
      const m = g.idx.length; if (!m) continue;
      const side = Math.ceil(Math.sqrt(m));
      const bw = side * s, bh = Math.ceil(m / side) * s;
      if (rx + bw > W && rx > 0) { rx = 0; ry += radH + padBox; radH = 0; }
      if (!matOnly) {
        for (let j = 0; j < m; j++) {
          const i = g.idx[j];
          wX[i] = rx + (j % side) * s;
          wY[i] = ry + Math.floor(j / side) * s;
        }
        g.box = { x: rx, y: ry, w: bw, h: bh };
      }
      rx += bw + marg; radH = Math.max(radH, bh);
      maxH = Math.max(maxH, ry + bh);
    }
    return maxH + padBox;
  }

  // Mini-tidslinje: små kvadrater staplade till vänster, prickar utspridda i dem.
  function miniLayout() {
    const sq = Math.min(48, (H - 20) / N_ERA - 6), gap = 6, x0 = 8;
    miniBoxes = [];
    for (let e = 0; e < N_ERA; e++) {
      const by = 10 + e * (sq + gap);
      miniBoxes.push({ e, x: x0, y: by, s: sq });
    }
    for (let i = 0; i < N; i++) {
      const e = ERA[i];
      if (e < 0) { mX[i] = -50; mY[i] = -50; continue; }   // okänt parkeras utanför
      const b = miniBoxes[e];
      const h = hash(i);
      mX[i] = b.x + (h % 997) / 997 * b.s;
      mY[i] = b.y + ((h >> 4) % 997) / 997 * b.s;
    }
  }
  let miniBoxes = [];

  // ── Mål per steg ───────────────────────────────────────────────────────────
  // Returnerar [målX, målY, målOpacitet] för prick i vid givet steg.
  function malFor(i, steg) {
    const e = ERA[i], aktivEra = steg - STEG_ERA0;
    if (steg === STEG_WAFFLE) return [wX[i], wY[i], e < 0 ? 0.5 : 0.92];
    if (steg === STEG_KARTA)  return e < 0 ? [-50, -50, 0] : [mX[i], mY[i], 0.6];
    if (steg === STEG_SYNTES) return e < 0 ? [-50, -50, 0] : [gX[i], gY[i], 0.85];
    if (e < 0) return [-50, -50, 0];
    if (e <= aktivEra) return [gX[i], gY[i], e === aktivEra ? 0.95 : 0.32];
    return [mX[i], mY[i], 0.5];
  }

  function sattMal(steg) {
    const aktivEra = steg - STEG_ERA0;
    for (let i = 0; i < N; i++) {
      const [tx, ty, to] = malFor(i, steg);
      fX[i] = cx[i]; fY[i] = cy[i]; fO[i] = co[i];
      tX[i] = tx; tY[i] = ty; tO[i] = to;
      const flygerUt = steg >= STEG_ERA0 && steg !== STEG_SYNTES && ERA[i] === aktivEra;
      delay[i] = flygerUt ? (hash(i) % 360) : 0;
    }
    startaTimer();
  }

  // Snäpp direkt till ett stegs slutläge (vid init och resize, ingen animation).
  function snap(steg) {
    for (let i = 0; i < N; i++) {
      const [tx, ty, to] = malFor(i, steg);
      cx[i] = tx; cy[i] = ty; co[i] = to;
    }
    rita();
  }

  function startaTimer() {
    if (timer) timer.stop();
    timer = d3.timer((el) => {
      let klar = true;
      for (let i = 0; i < N; i++) {
        const t = clamp((el - delay[i]) / TWEEN_MS, 0, 1);
        const e = t < 1 ? (klar = false, easeCubic(t)) : 1;
        cx[i] = fX[i] + (tX[i] - fX[i]) * e;
        cy[i] = fY[i] + (tY[i] - fY[i]) * e;
        co[i] = fO[i] + (tO[i] - fO[i]) * e;
      }
      rita();
      if (klar) { timer.stop(); timer = null; }
    });
  }

  function rita() {
    ctx.clearRect(0, 0, W, H);
    const sz = 1.7, hs = sz / 2;
    let lastKey = -1;
    for (let i = 0; i < N; i++) {
      const o = co[i]; if (o <= 0.01) continue;
      const x = cx[i]; if (x < -20) continue;
      const ab = (o * 7) | 0;
      const key = (RI[i] + 1) * 8 + ab;
      if (key !== lastKey) { ctx.fillStyle = fargTab[key]; lastKey = key; }
      ctx.fillRect(x - hs, cy[i] - hs, sz, sz);
    }
  }

  // ── Steg-byte ──────────────────────────────────────────────────────────────
  function gaTill(steg) {
    aktivtSteg = steg;
    const kartLage = steg >= STEG_KARTA;
    svgBas.style("opacity", kartLage ? 1 : 0);
    svgLab.style("opacity", steg >= STEG_KARTA && steg !== STEG_WAFFLE ? 1 : 0);
    readout.style("opacity", steg === STEG_WAFFLE ? 0 : 1);
    labLager.classed("kr-show", steg === STEG_WAFFLE);
    uppdateraReadout(steg);
    sattMal(steg);
  }

  function uppdateraReadout(steg) {
    let h = "";
    if (steg === STEG_WAFFLE) {
      h = `<div class="kr-ro-big">${fmt(N)}</div><div class="kr-ro-sub">bostäder i Halland, en prick var</div>`;
    } else if (steg === STEG_KARTA) {
      h = `<div class="kr-ro-big">Var byggdes de?</div><div class="kr-ro-sub">Decennium för decennium ut på kartan</div>`;
    } else if (steg === STEG_SYNTES) {
      h = `<div class="kr-ro-big">Centralt → utglest</div><div class="kr-ro-sub">Medianhuset vandrade utåt över tid</div>`;
    } else {
      const e = steg - STEG_ERA0, st = eraStats[e];
      h = `<div class="kr-ro-era">${ERA_LABEL[e]}</div>
        <div class="kr-ro-row"><b>${fmt(st.n)}</b> bostäder · ${pct(st.andelAvAllt)} av allt</div>
        <div class="kr-ro-row">${pct(st.andelKarna)} i kärnan · ${pct(st.andelTatort)} inom tätort</div>
        <div class="kr-ro-row">medianläge ${st.rnorm.toFixed(2)} ortradier ut</div>`;
    }
    readout.html(h);
  }

  // ── Init / resize ──────────────────────────────────────────────────────────
  function setup() {
    W = grafik.node().clientWidth || 900;
    canvas.attr("width", W * dpr).attr("height", H * dpr)
      .style("width", W + "px").style("height", H + "px");
    ctx = canvas.node().getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ritaKarta();
    beraknaLayouter();
    ritaBoxLabels();
    snap(aktivtSteg);
  }

  function ritaBoxLabels() {
    labLager.selectAll("*").remove();
    const grupper = [];
    for (let e = 0; e < N_ERA; e++) grupper.push(e);
    grupper.push(-1);
    // box-position togs fram i waffleLayout via g.box; räkna om snabbt här
    const boxes = {};
    for (let i = 0; i < N; i++) {
      const e = ERA[i], b = boxes[e] || (boxes[e] = { x1: 1e9, y1: 1e9, x2: -1e9 });
      if (wX[i] < b.x1) b.x1 = wX[i];
      if (wY[i] < b.y1) b.y1 = wY[i];
      if (wX[i] > b.x2) b.x2 = wX[i];
    }
    for (const e of grupper) {
      const b = boxes[e]; if (!b) continue;
      const lab = e < 0 ? "Okänt år" : ERA_LABEL[e];
      const n = e < 0 ? eraStatsOkant.n : eraStats[e].n;
      labLager.append("div").attr("class", "kr-boxlab")
        .style("left", b.x1 + "px").style("top", (b.y1 - 16) + "px")
        .html(`<b>${lab}</b> ${fmt(n)}`);
    }
  }

  // ── Färg-tabell (ring × opacitetsnivå) ─────────────────────────────────────
  function byggFargTab() {
    const tab = {};
    for (const r of [-1, 0, 1, 2, 3]) {
      const [R, G, B] = RING_RGB[r];
      for (let a = 0; a <= 7; a++) {
        tab[(r + 1) * 8 + a] = `rgba(${R},${G},${B},${(a / 7).toFixed(2)})`;
      }
    }
    return tab;
  }

  // ── Era-statistik ──────────────────────────────────────────────────────────
  function byggEraStats() {
    const out = [];
    for (let e = 0; e < N_ERA; e++) out.push({ e, n: 0, smahus: 0, fler: 0,
      decs: [], nTat: 0, nKarna: 0, sumRnormW: 0 });
    let okantN = 0;
    for (let i = 0; i < N; i++) {
      const e = ERA[i];
      if (e < 0) { okantN++; continue; }
      const s = out[e]; s.n++;
      if (BT[i] >= 1 && BT[i] <= 4) s.smahus++; else if (BT[i] === 5) s.fler++;
    }
    eraStatsOkant = { n: okantN };
    // spatiala mått från regional-aggregatet, viktat
    const decToEra = d => eraOf(d);
    const acc = out.map(() => ({ nw: 0, tat: 0, n13: 0, karna13: 0, rnw: 0 }));
    for (const r of aggregat.regional) {
      const e = decToEra(r.dec); if (e < 0) continue;
      const a = acc[e];
      a.nw += r.n;
      a.tat += r.andel_tatort * r.n;
      const n13 = r.n * r.andel_13;
      a.n13 += n13;
      a.karna13 += r.andel_karna * n13;
      a.rnw += r.rnorm_median * n13;
    }
    const totN = out.reduce((s, o) => s + o.n, 0);
    return out.map((o, e) => {
      const a = acc[e];
      return {
        n: o.n,
        andelAvAllt: o.n / totN,
        andelSmahus: o.smahus / Math.max(1, o.smahus + o.fler),
        andelTatort: a.nw ? a.tat / a.nw : 0,
        andelKarna: a.n13 ? a.karna13 / a.n13 : 0,
        rnorm: a.n13 ? a.rnw / a.n13 : 0,
      };
    });
  }

  function byggStegDef() {
    const s = [];
    s.push({ html: `<h4>Varje hus en prick</h4><p>Hallands ${fmt(N)} bostäder, ordnade efter när de byggdes. Boxarnas storlek visar hur mycket varje decennium byggde. 1970- och 80-talen reser sig tydligt, miljonprogrammets och dess efterdyningars decennier.</p>` });
    s.push({ html: `<h4>Ut på kartan</h4><p>Nu lägger vi ut samma hus där de faktiskt står. Färgen visar läget i tätorten: mörkgrön i kärnan, ljus i ytterkanten, grå på landsbygden. Frågan är om byggandet höll sig centralt eller kröp utåt.</p>` });
    for (let e = 0; e < N_ERA; e++) {
      const st = eraStats[e];
      s.push({ html: `<h4>${ERA_LABEL[e]}</h4><p>${fmt(st.n)} bostäder, ${pct(st.andelAvAllt)} av allt byggande. ${pct(st.andelKarna)} hamnade i stadskärnorna och ${pct(st.andelTatort)} inom någon tätort. Medianhuset låg ${st.rnorm.toFixed(2)} ortradier från centrum.</p>` });
    }
    s.push({ html: `<h4>Centralt blev utglest</h4><p>Genom seklets mitt fylldes kärnorna. Från 1970-talet sköts byggandet allt längre ut, och medianhuset vandrade från under en halv ortradie till över en hel. Utglesningen syns ort för ort i de större tätorterna.</p>` });
    return s;
  }

  // ── Montering ──────────────────────────────────────────────────────────────
  requestAnimationFrame(() => {
    // Quartos OJS-omslag (.cell-output-display) har overflow:auto och blir annars
    // sticky-elementets scroll-container, vilket bryter fästningen. Nollställ.
    let anc = root.node().parentElement;
    while (anc && anc !== document.body) {
      if (anc.matches && anc.matches(".cell-output, .cell-output-display, .cell, .kr-scrolly-root"))
        anc.style.overflow = "visible";
      anc = anc.parentElement;
    }
    setup();
    scrollstegare(stegEls, { onStep: gaTill });
    let rt;
    new ResizeObserver(() => {
      clearTimeout(rt);
      rt = setTimeout(() => { setup(); gaTill(aktivtSteg); }, 200);
    }).observe(grafik.node());
  });

  root.append("div").attr("class", "graf-caption").html(caption);
  return root.node();
}

// ── Hjälpare ─────────────────────────────────────────────────────────────────
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function easeCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function hash(i) { let h = (i * 2654435761) >>> 0; h ^= h >> 13; return h >>> 0; }
function fmt(n) { return Math.round(n).toLocaleString("sv-SE"); }
function pct(v) { return Math.round(v * 100) + " %"; }

function injicieraCss() {
  if (document.getElementById("kr-scrolly-css")) return;
  const st = document.createElement("style");
  st.id = "kr-scrolly-css";
  st.textContent = `
  .kr-scrolly-root { position: relative; }
  .kr-scrolly { position: relative; display: grid;
    grid-template-columns: minmax(0,1fr) 360px; gap: 24px; align-items: start; }
  .kr-scrolly-grafik { position: sticky; top: var(--sticky-top,70px);
    width: 100%; background: #fbfbf9; border-radius: 8px; overflow: hidden; }
  .kr-sc-svg, .kr-sc-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .kr-sc-bas { transition: opacity .6s ease; }
  .kr-sc-lab { transition: opacity .5s ease; pointer-events: none; }
  .kr-sc-townlab { font: 600 11px 'IBM Plex Sans', sans-serif; fill: #33404a;
    paint-order: stroke; stroke: #fbfbf9; stroke-width: 3px; }
  .kr-sc-readout { position: absolute; right: 16px; top: 12px; max-width: 260px;
    text-align: right; transition: opacity .4s ease;
    font: 13px/1.35 'IBM Plex Sans', sans-serif; color: #222; pointer-events: none; }
  .kr-ro-big { font-size: 21px; font-weight: 700; color: #00664D; }
  .kr-ro-era { font-size: 19px; font-weight: 700; color: #00664D; margin-bottom: 3px; }
  .kr-ro-sub { color: #555; }
  .kr-ro-row { margin-top: 1px; }
  .kr-sc-boxlabels { position: absolute; inset: 0; opacity: 0; transition: opacity .4s;
    pointer-events: none; }
  .kr-sc-boxlabels.kr-show { opacity: 1; }
  .kr-boxlab { position: absolute; font: 10.5px 'IBM Plex Sans', sans-serif; color: #444;
    white-space: nowrap; }
  .kr-boxlab b { color: #222; }
  .kr-scrolly-steg { position: relative; z-index: 2; pointer-events: none; }
  .kr-sc-step { min-height: 86vh; display: flex; align-items: center; }
  .kr-sc-card { background: rgba(255,255,255,.93); border-radius: 10px; padding: 16px 18px;
    box-shadow: 0 2px 14px rgba(0,0,0,.10); border-left: 3px solid #1E63A8; }
  .kr-sc-card h4 { margin: 0 0 6px; font: 700 16px 'IBM Plex Sans', sans-serif; color: #1a1a1a; }
  .kr-sc-card p { margin: 0; font: 14px/1.5 'IBM Plex Sans', sans-serif; color: #333; }
  @media (max-width: 700px) { .kr-scrolly-steg { width: auto; margin: 0 12px; } }`;
  document.head.appendChild(st);
}
