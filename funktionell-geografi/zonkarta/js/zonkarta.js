import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

/**
 * Zon-fokuserad karta över Hallands arbetsmarknadsregioner.
 *
 * Berättelsen: zonerna är primära, vägnätet visar mekanismen.
 * Default-vy: zoner med hull + färgade orter + muted vägnät.
 * Klick på zon: isolera dess flöden, visa interna stråk.
 */
export function zonkarta(flode, lan, orter, ortEdges, options = {}) {
  const {
    width      = 960,
    height     = 720,
    background = "#eef0e7",
    fua        = {},
    karnor     = {},
    invanare   = {},
    dagbefMap  = {},
    kommuner   = {},
    panelCollapsed = false,
    stage      = "full"   // "orter" | "lankar" | "zoner" | "flode" | "full" — stegvis pedagogisk uppbyggnad
  } = options;

  // Statiskt läge (alla steg utom det sista): inga klick/hover/zoom/panel.
  const STATIC = stage !== "full";

  // ---------- Färgpalett — dämpad, harmonisk, publikationsredo
  // Nivå 2-färger tonade nedåt: mättade nog att urskilja, aldrig skrikiga
  const ZONE_COLORS = {
    "1380TC107_13": "#1a9a6a",  // Halmstad — dämpad grön
    "1480TC108_14": "#4a9ac7",  // Göteborg — stålblå
    "1383TC119_13": "#7068b8",  // Varberg — dämpad lila
    "1480TC108_13": "#c9a832",  // Kungsbacka — varm senapsgul
    "1382TC102_13": "#c75a4a",  // Falkenberg — dämpad terracotta
    "1381TC105_13": "#8c6b52",  // Laholm — varm brun
    "1315TC101_13": "#a8856a",  // Hyltebruk — ljusbrun
    "1382TB115_13": "#d48c3c",  // Ullared — dämpad orange
    "1383TB155_13": "#8a8f91",  // Ringhals — neutral grå
    "0662TB108_06": "#a0a4a6",  // Smålandsstenar — mellangrå
  };

  const INK       = "#2a3f36";
  const MUTED     = "#7a8e84";
  const ACCENT    = "#e8c840";
  const MIN_FLOW  = 50;

  // ---------- Container
  const container = document.createElement("div");
  container.style.cssText = `
    position:relative;width:${width}px;height:${height}px;
    background:${background};
    font-family:'Inter',system-ui,sans-serif;
    color:${INK};border-radius:4px;overflow:hidden;user-select:none;
  `;

  const dpr = window.devicePixelRatio || 1;

  // roundRect polyfill
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      this.moveTo(x + r, y);
      this.lineTo(x + w - r, y); this.arcTo(x + w, y, x + w, y + r, r);
      this.lineTo(x + w, y + h - r); this.arcTo(x + w, y + h, x + w - r, y + h, r);
      this.lineTo(x + r, y + h); this.arcTo(x, y + h, x, y + h - r, r);
      this.lineTo(x, y + r); this.arcTo(x, y, x + r, y, r);
    };
  }

  const mkCanvas = (pointer) => {
    const c = document.createElement("canvas");
    c.width = width * dpr; c.height = height * dpr;
    c.style.cssText = `
      position:absolute;inset:0;
      width:${width}px;height:${height}px;display:block;
      pointer-events:${pointer ? "auto" : "none"};
      cursor:${pointer ? "grab" : "default"};
    `;
    container.appendChild(c);
    const ctx = c.getContext("2d");
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    return { ctx, canvas: c };
  };

  const basLayer       = mkCanvas(false);
  const flodeLayer     = mkCanvas(false);
  const hullLayer      = mkCanvas(false);
  const orterLayer     = mkCanvas(false);
  const labelLayer     = mkCanvas(false);
  const hoverLayer     = mkCanvas(true);

  // ---------- Projektion — stegspecifik geografisk inramning
  // De Halland-nära stegen (orter/lankar/zoner) zoomar in tätt på länet plus
  // Göteborg i norr, så länet fyller rutan. Flödes- och fullvyn behöver en
  // vidare ram för E6-korridoren (Göteborg i norr, södra utflöden mot Skåne).
  const PANEL_PAD   = (width >= 700 && !panelCollapsed) ? 364 : 20;
  const LEGEND_PAD  = width >= 700 ? 60 : 20;

  // Geografiska ramar per steg: [W, S, E, N] i grader.
  const STAGE_BOUNDS = {
    orter:  [11.80, 56.34, 13.46, 57.78],
    lankar: [11.80, 56.34, 13.46, 57.78],
    zoner:  [11.80, 56.34, 13.46, 57.78],
    flode:  [11.68, 55.95, 14.25, 58.00],
    full:   [11.68, 55.95, 14.25, 58.00],
  };
  const _b = STAGE_BOUNDS[stage] || STAGE_BOUNDS.full;
  // MultiPoint av hörnen (SW + NE) — entydig bbox, ingen vändnings-tvetydighet
  // som en Polygon-ring kan ge (d3 kan annars tolka ringen som sfärens komplement).
  const boundsObj = {
    type: "MultiPoint",
    coordinates: [[_b[0], _b[1]], [_b[2], _b[3]]]
  };
  const projection = d3.geoMercator().fitExtent(
    [[PANEL_PAD, 48], [width - LEGEND_PAD, height - 48]],
    boundsObj
  );

  // ---------- Datan
  const feats = (flode.features || [])
    .filter(f => f.properties && (+f.properties.flow_total || +f.properties.flow || 0) > 0);

  const valOf = (p) => +p.flow_total || +p.flow || 0;
  const vals = feats.map(f => valOf(f.properties));
  const maxVal = d3.max(vals) || 1;

  const edgeIdxToDrawIdx = new Map();
  feats.forEach((f, i) => {
    if (f.properties.edge_idx != null) edgeIdxToDrawIdx.set(f.properties.edge_idx, i);
  });

  // Skalor
  const tLog    = d3.scaleLog().domain([1, maxVal]).range([0, 1]).clamp(true);
  const widthSc = d3.scalePow().exponent(0.45)
    .domain([1, maxVal]).range([0.22, 10]).clamp(true);

  // Path2D-cache
  const featPaths = feats.map(f => {
    const p2 = new Path2D();
    const coords = f.geometry.coordinates;
    const first = projection(coords[0]);
    p2.moveTo(first[0], first[1]);
    for (let i = 1; i < coords.length; i++) {
      const px = projection(coords[i]);
      p2.lineTo(px[0], px[1]);
    }
    return p2;
  });

  // Sorterad ritordning (svaga segment först)
  const drawOrder = [];
  for (let i = 0; i < vals.length; i++) if (vals[i] > 0) drawOrder.push(i);
  drawOrder.sort((a, b) => vals[a] - vals[b]);

  // Länsgräns Path2D
  const lanPath2D = (() => {
    const p2 = new Path2D();
    const polys = lan.type === "FeatureCollection"
      ? lan.features.flatMap(f => geomToPolys(f.geometry))
      : geomToPolys(lan.geometry || lan);
    for (const poly of polys) {
      for (const ring of poly) {
        const first = projection(ring[0]);
        p2.moveTo(first[0], first[1]);
        for (let i = 1; i < ring.length; i++) {
          const px = projection(ring[i]);
          p2.lineTo(px[0], px[1]);
        }
        p2.closePath();
      }
    }
    return p2;
  })();

  function geomToPolys(geom) {
    if (!geom) return [];
    if (geom.type === "Polygon") return [geom.coordinates];
    if (geom.type === "MultiPolygon") return geom.coordinates;
    return [];
  }

  // ---------- Orter i pixelrymd
  // Kungsbacka delar SCB:s tätortsobjekt (TC108) med Göteborg, så dess
  // kommun-fält ärver felaktigt "Göteborg" — rätta vid källan.
  const KOMMUN_FIX = { "1480TC108_13": "Kungsbacka" };
  const ortPoints = (orter.features || []).map(f => {
    const [x, y] = projection(f.geometry.coordinates);
    return {
      x, y,
      community: f.properties.community,
      namn: f.properties.namn,
      kommun: KOMMUN_FIX[f.properties.community] || f.properties.kommun,
      iHalland: !!f.properties.i_halland,
      nattbef: f.properties.nattbef || 0
    };
  });
  const ortByComm = new Map(ortPoints.map(o => [o.community, o]));

  // ---------- Zon-strukturer
  // Varje ort → primär kärna (från ort-fua)
  const ortZone = new Map();  // community → kärna_id
  for (const [ort_id, info] of Object.entries(fua)) {
    if (info.primar_karna) ortZone.set(ort_id, info.primar_karna);
  }

  // Kärna-data
  const zones = [];
  for (const [kid, kinfo] of Object.entries(karnor)) {
    const color = ZONE_COLORS[kid] || "#aaa";
    const members = (kinfo.orter || [])
      .map(m => ortByComm.get(m))
      .filter(Boolean);
    const coreOrt = ortByComm.get(kid);

    // Convex hull i pixelrymd
    const pts = members.map(m => [m.x, m.y]);
    let hull = null;
    if (pts.length >= 3) {
      hull = d3.polygonHull(pts);
    } else if (pts.length === 2) {
      hull = [pts[0], pts[1]]; // linje
    }

    // Centroid
    let cx = 0, cy = 0;
    if (coreOrt) { cx = coreOrt.x; cy = coreOrt.y; }
    else if (members.length) {
      cx = d3.mean(members, m => m.x);
      cy = d3.mean(members, m => m.y);
    }

    // Klassificera zonens flöden per segment:
    //   intern = båda ändar i zonen (satellitstruktur)
    //   extern = en ände i zonen, en utanför (utåtgående stråk)
    // Källa: partner-chains i ort-edges — varje (ort, partner)-par
    // har en lista `c` av kedje-id:n som rutten traverserar.
    const memberIds = new Set((kinfo.orter || []));
    const internalByFeat = new Map(); // featIdx → internt flöde
    const externalByFeat = new Map(); // featIdx → externt flöde

    for (const mid of memberIds) {
      const oe = ortEdges[mid];
      if (!oe || Array.isArray(oe)) continue;
      for (const pr of (oe.partners || [])) {
        const flow = (+pr.s || 0) + (+pr.d || 0);
        if (flow <= 0 || !pr.c || !pr.c.length) continue;
        const isInternal = memberIds.has(pr.p);
        const target = isInternal ? internalByFeat : externalByFeat;
        for (const chainId of pr.c) {
          const fi = edgeIdxToDrawIdx.get(+chainId);
          if (fi != null) target.set(fi, (target.get(fi) || 0) + flow);
        }
      }
    }

    // Kombinerat per segment (för total-skala)
    const zoneFlowByFeat = new Map();
    for (const [fi, v] of internalByFeat) zoneFlowByFeat.set(fi, v);
    for (const [fi, v] of externalByFeat) {
      zoneFlowByFeat.set(fi, (zoneFlowByFeat.get(fi) || 0) + v);
    }

    // Max och ritordning
    let zoneMaxFlow = 0;
    let internalMax = 0;
    let externalMax = 0;
    for (const [, v] of zoneFlowByFeat) if (v > zoneMaxFlow) zoneMaxFlow = v;
    for (const [, v] of internalByFeat) if (v > internalMax) internalMax = v;
    for (const [, v] of externalByFeat) if (v > externalMax) externalMax = v;

    const internalOrder = [...internalByFeat.keys()]
      .filter(fi => (internalByFeat.get(fi) || 0) > 0)
      .sort((a, b) => (internalByFeat.get(a) || 0) - (internalByFeat.get(b) || 0));
    const externalOrder = [...externalByFeat.keys()]
      .filter(fi => (externalByFeat.get(fi) || 0) > 0)
      .sort((a, b) => (externalByFeat.get(a) || 0) - (externalByFeat.get(b) || 0));

    zones.push({
      id: kid,
      namn: kinfo.namn,
      color,
      members,
      memberIds,
      hull,
      cx, cy,
      nOrter: kinfo.n_orter,
      totalPend: kinfo.total,
      zoneFlowByFeat,
      internalByFeat,
      externalByFeat,
      internalOrder,
      externalOrder,
      zoneMaxFlow,
      internalMax,
      externalMax
    });
  }

  // Sortera: störst zon (mest pendling) sist → ritas överst
  zones.sort((a, b) => a.totalPend - b.totalPend);

  // Ort → zon-färg
  const ortColor = new Map();
  for (const z of zones) {
    for (const mid of z.memberIds) {
      ortColor.set(mid, z.color);
    }
  }

  // ---------- Halland-totaler (beräknas en gång, används i panelen)
  let hallandNattbef = 0, hallandDagbef = 0, hallandBorArbetar = 0, hallandInvanare = 0;
  for (const [ort_id, f] of Object.entries(fua)) {
    if (!ort_id.endsWith("_13")) continue;
    hallandNattbef   += f.nattbef_syss || 0;
    hallandDagbef    += f.dagbef_syss  || 0;
    hallandBorArbetar += f.bor_arbetar || 0;
  }
  for (const [ort_id, inv] of Object.entries(invanare)) {
    if (ort_id.endsWith("_13")) hallandInvanare += inv || 0;
  }

  // ---------- Inter-zon-flöden — riktningsspecifika
  // Per (zoneA, zoneB): ut (A→B) och in (B→A) separat.
  // `s` = orten skickar pendlare till partnern, `d` = orten tar emot.
  const interZone = new Map();     // "A|B" → { from, to, flow }
  const interZoneDir = new Map();  // "fromZone→toZone" → flow
  for (const [ort_id, oe] of Object.entries(ortEdges)) {
    if (Array.isArray(oe)) continue;
    const zoneA = ortZone.get(ort_id);
    if (!zoneA) continue;
    for (const pr of (oe.partners || [])) {
      const zoneB = ortZone.get(pr.p);
      if (!zoneB || zoneB === zoneA) continue;
      const flow = (+pr.s || 0) + (+pr.d || 0);
      if (flow <= 0) continue;
      // Odirigerad (för kartritning)
      const key = [zoneA, zoneB].sort().join("|");
      const existing = interZone.get(key);
      if (existing) existing.flow += flow;
      else interZone.set(key, { from: [zoneA, zoneB].sort()[0], to: [zoneA, zoneB].sort()[1], flow });
      // Riktad: ort_id i zoneA skickar s till partner i zoneB
      const outKey = `${zoneA}→${zoneB}`;
      interZoneDir.set(outKey, (interZoneDir.get(outKey) || 0) + (+pr.s || 0));
      const inKey = `${zoneB}→${zoneA}`;
      interZoneDir.set(inKey, (interZoneDir.get(inKey) || 0) + (+pr.d || 0));
    }
  }
  const interZoneLinks = [...interZone.values()]
    .filter(l => l.flow > 100)
    .sort((a, b) => a.flow - b.flow);

  const maxInterFlow = d3.max(interZoneLinks, l => l.flow) || 1;
  const interWidthSc = d3.scalePow().exponent(0.5)
    .domain([0, maxInterFlow]).range([1, 12]).clamp(true);

  // Zone lookup
  const zoneById = new Map(zones.map(z => [z.id, z]));

  // ---------- Quadtrees
  const ortQuadtree = d3.quadtree()
    .x(d => d.x).y(d => d.y).addAll(ortPoints);

  // Segment-quadtree: sampla punkter längs varje kedja för hover-detektering
  const SAMPLE_STEP = 6;
  const segSamples = [];
  feats.forEach((f, i) => {
    const coords = f.geometry.coordinates;
    let prev = projection(coords[0]);
    segSamples.push({ fi: i, x: prev[0], y: prev[1] });
    for (let k = 1; k < coords.length; k++) {
      const cur = projection(coords[k]);
      const dx = cur[0] - prev[0], dy = cur[1] - prev[1];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > SAMPLE_STEP) {
        const steps = Math.ceil(d / SAMPLE_STEP);
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          segSamples.push({ fi: i, x: prev[0] + dx * t, y: prev[1] + dy * t });
        }
      }
      segSamples.push({ fi: i, x: cur[0], y: cur[1] });
      prev = cur;
    }
  });
  const segQuadtree = d3.quadtree()
    .x(d => d.x).y(d => d.y).addAll(segSamples);

  // ---------- Tooltip
  const tooltip = document.createElement("div");
  tooltip.style.cssText = `
    position:absolute;pointer-events:none;z-index:20;
    background:rgba(255,255,255,0.94);backdrop-filter:blur(6px);
    border:1px solid rgba(0,0,0,0.08);border-radius:3px;
    padding:6px 10px;font-size:12px;line-height:1.5;
    color:${INK};max-width:240px;display:none;
    box-shadow:0 1px 6px rgba(0,0,0,0.06);
  `;
  container.appendChild(tooltip);

  function showTooltip(x, y, html) {
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    // Positionera inom container
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let tx = x + 14, ty = y - 10;
    if (tx + tw > width - 10) tx = x - tw - 10;
    if (ty + th > height - 10) ty = height - th - 10;
    if (ty < 10) ty = 10;
    tooltip.style.left = tx + "px";
    tooltip.style.top = ty + "px";
  }
  function hideTooltip() { tooltip.style.display = "none"; }

  // Hull hit-test: för klick på en zon
  function zoneAtPoint(px, py) {
    const ort = ortQuadtree.find(px, py, 15);
    if (ort) {
      const z = ortZone.get(ort.community);
      if (z) return zoneById.get(z);
    }
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      if (!z.hull || z.hull.length < 3) continue;
      if (d3.polygonContains(z.hull, [px, py])) return z;
    }
    return null;
  }

  // ---------- State
  let currentTransform = d3.zoomIdentity;
  let selectedZone = null;
  let zoneExtDests = new Set(); // externa destinationer för vald zon (≥100 OD-par)

  function buildZoneExtDests(z) {
    zoneExtDests = new Set();
    if (!z) return;
    const extByDest = new Map();
    for (const mid of z.memberIds) {
      const oe = ortEdges[mid];
      if (!oe || Array.isArray(oe)) continue;
      for (const pr of (oe.partners || [])) {
        if (z.memberIds.has(pr.p)) continue;
        const flow = (+pr.s || 0) + (+pr.d || 0);
        extByDest.set(pr.p, (extByDest.get(pr.p) || 0) + flow);
      }
    }
    for (const [pid, tot] of extByDest) {
      if (tot >= 100) zoneExtDests.add(pid);
    }
  }
  let hoveredZone  = null;
  let hoveredOrt   = null;
  let highlightOrt = null;  // community-id vid panel-hover → lyser bara upp pricken
  let focusOrt     = null;  // community-id vid ortspecifik klick → döljer zon, visar ortens rutter
  let focusOrtLocked = false;  // true = klick-låst, false = bara hover
  let focusRoutes  = null;  // [{flow, chains, namn, ut, inn, pid}]
  let segToPartner = null;  // Map<featIdx, {namn, ut, inn, flow}>
  let highlightPartner = null;  // partner community-id vid tabell-hover

  // Bygg ruttdata + segment-lookup för en fokusort
  function buildFocusRoutes(cid) {
    const oe = ortEdges[cid];
    if (!oe || Array.isArray(oe)) { focusRoutes = []; segToPartner = new Map(); return; }
    const routes = [];
    const s2p = new Map();
    for (const pr of (oe.partners || [])) {
      const ut = +pr.s || 0, inn = +pr.d || 0;
      const flow = ut + inn;
      if (flow < 25 || !pr.c) continue;
      const po = ortByComm.get(pr.p);
      const namn = po?.namn || pr.p;
      const chains = [];
      for (const chainId of pr.c) {
        const fi = edgeIdxToDrawIdx.get(+chainId);
        if (fi != null) {
          chains.push(fi);
          // Segment → partner (starkaste vinner vid överlapp)
          const existing = s2p.get(fi);
          if (!existing || flow > existing.flow) {
            s2p.set(fi, { namn, ut, inn, flow });
          }
        }
      }
      if (chains.length) routes.push({ flow, chains, namn, ut, inn, pid: pr.p });
    }
    routes.sort((a, b) => a.flow - b.flow);
    focusRoutes = routes;
    segToPartner = s2p;
  }

  // ---------- Transform helpers
  function applyTransform(ctx, t) {
    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
  }
  const resetTransform = (ctx) => ctx.setTransform(1, 0, 0, 1, 0, 0);
  function clearLayer(layer) {
    resetTransform(layer.ctx);
    layer.ctx.clearRect(0, 0, width * dpr, height * dpr);
  }

  // ---------- Expandera hull med padding
  function expandHull(hull, pad) {
    if (!hull || hull.length < 3) return hull;
    const cx = d3.mean(hull, p => p[0]);
    const cy = d3.mean(hull, p => p[1]);
    return hull.map(([px, py]) => {
      const dx = px - cx, dy = py - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d === 0) return [px, py];
      return [px + dx / d * pad, py + dy / d * pad];
    });
  }

  // ---------- Rita hulls
  // ---------- Geografisk bas: land + kommun- och länsgränser (ritas i alla steg)
  let _kommunPath = null;
  function drawBas() {
    clearLayer(basLayer);
    const t = currentTransform;
    const kInv = 1 / t.k;
    const ctx = basLayer.ctx;
    applyTransform(ctx, t);
    // Land — fyll länspolygonen nästan vitt så Halland läses som en lugn
    // landmassa men aldrig konkurrerar med data ovanpå (zoner/flöden).
    ctx.save();
    ctx.fillStyle = "#f9faf5";
    ctx.fill(lanPath2D);
    ctx.restore();
    // Kommungränser (byggs en gång, cachas)
    if (_kommunPath === null) {
      _kommunPath = new Path2D();
      const polys = (kommuner.features || []).flatMap(f => geomToPolys(f.geometry));
      for (const poly of polys) for (const ring of poly) {
        const f0 = projection(ring[0]);
        _kommunPath.moveTo(f0[0], f0[1]);
        for (let i = 1; i < ring.length; i++) { const px = projection(ring[i]); _kommunPath.lineTo(px[0], px[1]); }
        _kommunPath.closePath();
      }
    }
    ctx.save();
    ctx.strokeStyle = "#d3d8cd"; ctx.lineWidth = 0.6 * kInv; ctx.globalAlpha = 0.85;
    ctx.stroke(_kommunPath);
    ctx.restore();
    // Länsgräns — hårfin men närvarande, definierar formen utan att dominera
    ctx.save();
    ctx.strokeStyle = "#a7b1a4"; ctx.lineWidth = 1.0 * kInv; ctx.globalAlpha = 0.9;
    ctx.stroke(lanPath2D);
    ctx.restore();
  }

  function drawHulls() {
    clearLayer(hullLayer);
    const t = currentTransform;
    const kInv = 1 / t.k;
    const ctx = hullLayer.ctx;
    applyTransform(ctx, t);

    // Basnivåer per steg. Fullvyn har flödeslagret under sig som mutar färgen,
    // så den behöver högre fyllning/kontur för att läsa lika starkt som zoner-steget.
    const fullStage   = stage === "full";
    const zoneStage   = stage === "zoner" || fullStage;
    const baseFill    = fullStage ? 0.19 : (zoneStage ? 0.11 : 0.045);
    const baseStrokeA = fullStage ? 0.64 : (zoneStage ? 0.55 : 0.22);
    const baseStrokeW = fullStage ? 1.3  : (zoneStage ? 1.1  : 0.7);
    // Hover i översikten (ingen zon vald) → den hovrade zonens yttre gräns poppar
    // medan övriga tonas ned.
    const someHover = hoveredZone && !selectedZone;

    function paintHull(z) {
      if (!z.hull || z.hull.length < 3) return;
      const isSelected = selectedZone && selectedZone.id === z.id;
      const isHovered  = someHover && hoveredZone.id === z.id;
      const otherSel   = selectedZone && !isSelected;
      const otherHover = someHover && !isHovered;

      const expanded = expandHull(z.hull, (isHovered ? 21 : 18) * kInv);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(expanded[0][0], expanded[0][1]);
      for (let i = 1; i < expanded.length; i++) ctx.lineTo(expanded[i][0], expanded[i][1]);
      ctx.closePath();

      // Fyllning
      ctx.fillStyle = z.color;
      ctx.globalAlpha =
          isSelected  ? 0.16
        : isHovered   ? Math.min(0.24, baseFill + 0.05)
        : otherSel    ? 0.02
        : otherHover  ? baseFill * 0.4
        : baseFill;
      ctx.fill();

      // Hovrad zon: mjuk yttre glöd bakom den krispa konturen
      if (isHovered) {
        ctx.strokeStyle = z.color;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 7 * kInv;
        ctx.stroke();
      }

      // Kontur — den hovrade poppar (tjock, mörkad för skärpa, nästan helt opak)
      ctx.strokeStyle = isHovered ? (d3.color(z.color).darker(0.5) + "") : z.color;
      ctx.lineWidth = (
          isSelected  ? 1.9
        : isHovered   ? 2.9
        : otherHover  ? baseStrokeW * 0.7
        : baseStrokeW
      ) * kInv;
      ctx.globalAlpha =
          isSelected  ? 0.62
        : isHovered   ? 0.96
        : otherSel    ? 0.06
        : otherHover  ? baseStrokeA * 0.4
        : baseStrokeA;
      ctx.stroke();
      ctx.restore();
    }

    // Rita övriga först, den hovrade sist så dess gräns hamnar överst.
    for (const z of zones) if (!(someHover && hoveredZone.id === z.id)) paintHull(z);
    if (someHover) { const hz = zones.find(z => z.id === hoveredZone.id); if (hz) paintHull(hz); }
  }

  // ---------- Rita pendlingslänkar (ort → primär kärna) — endast stegkartan "lankar"
  // Visar mekanismen bakom zonindelningen: varje ort dras mot den kärna som
  // störst andel av dess nattbefolkning pendlar till.
  function drawLinks() {
    clearLayer(hullLayer);
    const t = currentTransform;
    const kInv = 1 / t.k;
    const ctx = hullLayer.ctx;
    applyTransform(ctx, t);
    ctx.save();
    ctx.lineCap = "round";
    for (const o of ortPoints) {
      const coreId = ortZone.get(o.community);
      if (!coreId || coreId === o.community) continue;
      const core = ortByComm.get(coreId);
      if (!core) continue;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(core.x, core.y);
      ctx.strokeStyle = ZONE_COLORS[coreId] || "#9aaa9e";
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 0.9 * kInv;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Rita vägsegment
  function drawFlode() {
    clearLayer(flodeLayer);
    const t = currentTransform;
    const kInv = 1 / t.k;
    const ctx = flodeLayer.ctx;
    applyTransform(ctx, t);

    // Länsgräns — knappt synlig
    ctx.save();
    ctx.strokeStyle = "#9aaa9e";
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 0.6 * kInv;
    ctx.stroke(lanPath2D);
    ctx.restore();

    const cInterp = d3.interpolateRgbBasis(["#d4ddd6", "#8dbfa0", "#4a9a72", "#2a5f45"]);

    if (selectedZone) {
      const sz = selectedZone;

      // Gemensam skala baserad på totalen (intern + extern) så att
      // proportionerna mellan stråken är ärliga.
      const zMax = Math.max(2, sz.zoneMaxFlow);
      const zLog = d3.scaleLog().domain([1, zMax]).range([0, 1]).clamp(true);
      const zWidth = d3.scalePow().exponent(0.45)
        .domain([1, zMax]).range([0.3, 11]).clamp(true);

      // Intern färgramp: ljus → mörk variant av zonens färg
      const zBase = d3.color(sz.color);
      const zLight = d3.rgb(
        Math.min(255, zBase.r + (255 - zBase.r) * 0.55),
        Math.min(255, zBase.g + (255 - zBase.g) * 0.55),
        Math.min(255, zBase.b + (255 - zBase.b) * 0.55)
      );
      const zDark = zBase.darker(0.8);
      const zInterp = d3.interpolateRgb(zLight + "", zDark + "");

      // ---- Lager 1: Allt som inte relaterar till zonen — knappt synligt
      ctx.save();
      for (const i of drawOrder) {
        if (vals[i] < MIN_FLOW) continue;
        if (sz.zoneFlowByFeat.has(i)) continue;
        ctx.strokeStyle = "#dfe2de";
        ctx.lineWidth = Math.max(widthSc(vals[i]) * 0.3 * kInv, 0.12 * kInv);
        ctx.globalAlpha = 0.06;
        ctx.stroke(featPaths[i]);
      }
      ctx.restore();

      if (focusOrt && focusRoutes && focusRoutes.length > 0) {
        // ---- FOKUS-ORT-LÄGE: zonlagren döljs, ortens rutter ritas
        // per partner med OD-par-flöde som bredd. Egen skala.
        const allChains = new Set();
        for (const r of focusRoutes) for (const fi of r.chains) allChains.add(fi);

        const ortMax = Math.max(2, d3.max(focusRoutes, r => r.flow) || 1);
        const ortLog = d3.scaleLog().domain([1, ortMax]).range([0, 1]).clamp(true);
        const ortWidth = d3.scalePow().exponent(0.45)
          .domain([1, ortMax]).range([0.5, 10]).clamp(true);

        // Svagt vägnät som kontext
        ctx.save();
        for (const i of drawOrder) {
          if (allChains.has(i)) continue;
          ctx.strokeStyle = "#e0e3de";
          ctx.lineWidth = Math.max(widthSc(vals[i]) * 0.2 * kInv, 0.1 * kInv);
          ctx.globalAlpha = 0.04;
          ctx.stroke(featPaths[i]);
        }
        ctx.restore();

        // Highlightad partner → bara den rutten fullt synlig
        const hp = highlightPartner;
        for (const route of focusRoutes) {
          const t_val = ortLog(route.flow);
          const isHL = hp && route.pid === hp;
          const isDimmed = hp && !isHL;
          ctx.strokeStyle = isHL ? ACCENT : (isDimmed ? "#d4d8d2" : ACCENT);
          ctx.lineWidth = (isHL ? ortWidth(route.flow) * 1.2 : ortWidth(route.flow)) * kInv;
          ctx.globalAlpha = isHL ? 0.88 : (isDimmed ? 0.07 : (0.3 + 0.50 * t_val));
          for (const fi of route.chains) {
            ctx.stroke(featPaths[fi]);
          }
        }
      } else {
        // ---- ZON-BASLÄGE: alla ackumulerade flöden som zonens orter
        // driver, i en enhetlig ramp med zon-specifik skala.
        const zoneOrder = [...sz.zoneFlowByFeat.entries()]
          .filter(([, v]) => v >= MIN_FLOW)
          .sort((a, b) => a[1] - b[1]);

        for (const [fi, zv] of zoneOrder) {
          const t_val = zLog(zv);
          ctx.strokeStyle = zInterp(t_val);
          ctx.lineWidth = zWidth(zv) * kInv;
          ctx.globalAlpha = 0.25 + 0.55 * t_val;
          ctx.stroke(featPaths[fi]);
        }
      }
    } else {
      // Global vy — dämpad ramp
      for (const i of drawOrder) {
        const v = vals[i];
        if (v < MIN_FLOW) continue;
        const t_val = tLog(v);
        ctx.strokeStyle = cInterp(t_val);
        ctx.lineWidth = widthSc(v) * kInv;
        ctx.globalAlpha = 0.18 + 0.42 * t_val;
        ctx.stroke(featPaths[i]);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Rita orter
  function drawOrter() {
    clearLayer(orterLayer);
    const t = currentTransform;
    const kInv = 1 / t.k;
    const ctx = orterLayer.ctx;
    applyTransform(ctx, t);

    // Storlek: nattbef-driven
    const rSc = d3.scaleSqrt()
      .domain([0, d3.max(ortPoints, o => o.nattbef) || 1])
      .range([1.8, 10]);

    // I fokus-ort-läge: bygg set av partner-ids
    const focusPartnerIds = new Set();
    if (focusOrt && focusRoutes) {
      for (const r of focusRoutes) focusPartnerIds.add(r.pid);
    }
    const hp = highlightPartner;

    for (const o of ortPoints) {
      const isInZone = selectedZone ? selectedZone.memberIds.has(o.community) : true;
      const isCore = (stage !== "orter") && Object.keys(karnor).includes(o.community);
      // Kontextprickar (tätorter utanför Halland som varken är kärna eller
      // zonmedlem) tonas ned hårt i stegkartorna så de inte skräpar.
      const isMember  = ortColor.has(o.community);
      const isContext = STATIC && !o.iHalland &&
        (stage === "orter" ? true : (!isMember && !isCore));
      // Stegkartan: "orter" = neutralt råmaterial, "lankar" = bara kärnorna färgas
      let color;
      if (stage === "orter") color = "#728779";
      else if (stage === "lankar") color = isCore ? (ZONE_COLORS[o.community] || "#728779") : "#7e9388";
      else color = ortColor.get(o.community) || "#aaa";
      const isFocused = focusOrt === o.community;
      const isHL = highlightOrt === o.community || isFocused;
      const isPartner = focusPartnerIds.has(o.community);
      const isHLPartner = hp === o.community;

      let r;
      if (isFocused) r = rSc(o.nattbef) * 1.5 * kInv;
      else if (isHLPartner) r = Math.max(rSc(o.nattbef) * 1.2, 5) * kInv;
      else if (isPartner) r = Math.max(rSc(o.nattbef), 3.5) * kInv;
      else if (isHL) r = Math.max(rSc(o.nattbef) * 1.6, 6) * kInv;
      else if (isCore) r = Math.max(rSc(o.nattbef) * 1.15, 4) * kInv;
      else if (isContext) r = Math.min(rSc(o.nattbef), 2.6) * kInv;
      else r = rSc(o.nattbef) * kInv;

      ctx.save();

      // Glow
      if (isFocused || isHLPartner || isHL) {
        ctx.beginPath();
        ctx.arc(o.x, o.y, r + 6 * kInv, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT;
        ctx.globalAlpha = isFocused ? 0.35 : 0.25;
        ctx.fill();
        // Yttre ring
        ctx.beginPath();
        ctx.arc(o.x, o.y, r + 8 * kInv, 0, Math.PI * 2);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1.2 * kInv;
        ctx.globalAlpha = 0.4;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, Math.PI * 2);

      if (isFocused) {
        ctx.fillStyle = ACCENT;
        ctx.globalAlpha = 1;
      } else if (isHLPartner) {
        ctx.fillStyle = ACCENT;
        ctx.globalAlpha = 0.9;
      } else if (isPartner && focusOrt) {
        // Partner-orter syns tydligt
        ctx.fillStyle = hp ? "#c8cfc9" : INK;
        ctx.globalAlpha = hp ? 0.2 : 0.55;
      } else if (focusOrt) {
        ctx.fillStyle = "#c8cfc9";
        ctx.globalAlpha = 0.15;
      } else if (isHL) {
        ctx.fillStyle = ACCENT;
        ctx.globalAlpha = 1;
      } else if (selectedZone && !isInZone && zoneExtDests.has(o.community)) {
        // Extern destination — synlig men dämpad
        ctx.fillStyle = INK;
        ctx.globalAlpha = 0.4;
      } else if (selectedZone && !isInZone) {
        ctx.fillStyle = "#d0d3cf";
        ctx.globalAlpha = 0.1;
      } else if (selectedZone && isInZone) {
        // Zonmedlemmar — tydligt synliga i zonfärg
        ctx.fillStyle = color;
        ctx.globalAlpha = isCore ? 0.9 : 0.6;
      } else {
        // Global vy
        ctx.fillStyle = color;
        ctx.globalAlpha = isCore ? 0.85 : (isContext ? 0.09 : (STATIC ? 0.66 : 0.52));
      }
      ctx.fill();

      // Kontur
      if (isFocused || isHLPartner || isHL) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = (isFocused || isHLPartner ? 1.8 : 1.2) * kInv;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
      } else if (isCore && (!selectedZone || isInZone) && !focusOrt) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.2 * kInv;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
      } else if (selectedZone && isInZone && !isCore) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.8 * kInv;
        ctx.globalAlpha = 0.4;
        ctx.stroke();
      } else if (selectedZone && !isInZone && zoneExtDests.has(o.community)) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.8 * kInv;
        ctx.globalAlpha = 0.35;
        ctx.stroke();
      } else if (isPartner && focusOrt && !hp) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.7 * kInv;
        ctx.globalAlpha = 0.3;
        ctx.stroke();
      } else if (STATIC && !isCore && !isContext) {
        // Tunn mörk outline → djup mot den ljusa landytan (beeswarm-känsla)
        ctx.strokeStyle = "#3b4742";
        ctx.lineWidth = 0.6 * kInv;
        ctx.globalAlpha = 0.34;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ---------- Rita labels
  // Text-halo + tunna connectors. Offset uppåt-höger som default,
  // med manuella justeringar per kärna för kustläge etc.
  const LABEL_OFFSETS = {
    // Manuella dx/dy per kärna-id (pixelrymd, skalas med kInv)
    // Positiv dx = höger, positiv dy = nedåt
    "1380TC107_13":  { dx:  16, dy: -12 },  // Halmstad — höger uppåt
    "1480TC108_14":  { dx:  18, dy: -10 },  // Göteborg
    "1383TC119_13":  { dx: -18, dy: -12 },  // Varberg — vänster (kust)
    "1480TC108_13":  { dx: -16, dy:   8 },  // Kungsbacka — vänster nedåt (nära Gbg)
    "1382TC102_13":  { dx: -18, dy:  -8 },  // Falkenberg — vänster (kust)
    "1381TC105_13":  { dx:  14, dy: -12 },  // Laholm
    "1315TC101_13":  { dx:  14, dy:  -8 },  // Hyltebruk
    "1382TB115_13":  { dx:  14, dy:   8 },  // Ullared
    "1383TB155_13":  { dx: -16, dy:   8 },  // Ringhals — vänster (kust)
    "0662TB108_06":  { dx:  14, dy:  -8 },  // Smålandsstenar
  };

  function haloText(ctx, text, x, y, {
    font, color = INK, haloColor = background, haloWidth = 3,
    align = "left", baseline = "middle", alpha = 1
  }) {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    // Halo
    ctx.strokeStyle = haloColor;
    ctx.lineWidth = haloWidth;
    ctx.lineJoin = "round";
    ctx.globalAlpha = alpha * 0.92;
    ctx.strokeText(text, x, y);
    // Text
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function leaderLine(ctx, x1, y1, x2, y2, { color = INK, alpha = 0.3, width = 0.7 } = {}) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // Prick vid orten
    ctx.beginPath();
    ctx.arc(x2, y2, width * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 1.3;
    ctx.fill();
    ctx.restore();
  }

  function drawLabels() {
    clearLayer(labelLayer);
    const t = currentTransform;
    const kInv = 1 / t.k;
    const ctx = labelLayer.ctx;
    applyTransform(ctx, t);

    const hw = 3 * kInv;
    const font = (w, sz) => `${w} ${Math.max(sz * kInv, sz * 0.55)}px 'Inter',system-ui,sans-serif`;

    // ---- FOKUS-ORT-LÄGE: bara fokusorten + dess partners
    if (focusOrt && focusRoutes && focusRoutes.length > 0) {
      const foOrt = ortByComm.get(focusOrt);
      const hp = highlightPartner;

      // Fokusorten — framträdande men inte överdrivet
      if (foOrt) {
        haloText(ctx, foOrt.namn, foOrt.x, foOrt.y - 8 * kInv, {
          font: font("600", 12), color: INK, haloWidth: hw * 1.2,
          align: "center", baseline: "bottom"
        });
      }

      // Partners — topp 5 starkaste visas, highlightad alltid
      const sorted = [...focusRoutes].sort((a, b) => b.flow - a.flow);
      for (let i = 0; i < sorted.length; i++) {
        const route = sorted[i];
        const po = ortByComm.get(route.pid);
        if (!po) continue;

        const isHL = hp === route.pid;
        const isDimmed = hp && !isHL;

        // Visa: highlightad alltid, annars topp 5 (utan hover)
        if (isDimmed) continue;
        if (!isHL && !hp && i >= 5) continue;

        const dx = po.x - (foOrt?.x || 0);
        const dy = po.y - (foOrt?.y || 0);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const off = (isHL ? 16 : 12) * kInv;
        const lx = po.x + (dx / dist) * off;
        const ly = po.y + (dy / dist) * off;
        const align = dx >= 0 ? "left" : "right";

        leaderLine(ctx, lx, ly, po.x, po.y, {
          color: isHL ? ACCENT : INK,
          alpha: isHL ? 0.5 : 0.18,
          width: (isHL ? 0.8 : 0.5) * kInv
        });

        if (isHL) {
          haloText(ctx, route.namn, lx, ly - 1 * kInv, {
            font: font("600", 11), color: INK,
            haloColor: ACCENT, haloWidth: hw * 1.3,
            align, baseline: "bottom"
          });
          haloText(ctx, `${fmt(route.ut)} ut \u00b7 ${fmt(route.inn)} in`, lx, ly + 3 * kInv, {
            font: font("400", 8.5), color: MUTED,
            haloWidth: hw, align, baseline: "top", alpha: 0.9
          });
        } else {
          const alpha = i === 0 ? 0.8 : i < 3 ? 0.65 : 0.5;
          haloText(ctx, route.namn, lx, ly, {
            font: font("400", i < 3 ? 10 : 9), color: INK,
            haloWidth: hw, align, baseline: "middle", alpha
          });
        }
      }
      return;
    }

    // ---- ZON-VYN
    if (selectedZone) {
      // Vald zon: kärna + medlemsorter rangordnade efter invånare
      const z = selectedZone;
      const off = LABEL_OFFSETS[z.id] || { dx: 14, dy: -10 };
      const lx = z.cx + off.dx * kInv;
      const ly = z.cy + off.dy * kInv;
      const align = off.dx >= 0 ? "left" : "right";

      // Kärnan — framträdande
      leaderLine(ctx, lx, ly, z.cx, z.cy, {
        alpha: 0.25, width: 0.6 * kInv
      });
      haloText(ctx, z.namn, lx, ly, {
        font: font("600", 11.5), color: INK, haloWidth: hw * 1.1,
        align, baseline: "middle"
      });

      // Medlemsorter — rangordnade, topp-N efter invånare
      const memberOrts = [];
      for (const mid of z.memberIds) {
        if (mid === z.id) continue; // kärnan redan ritad
        const o = ortByComm.get(mid);
        if (!o) continue;
        const inv = invanare[mid] || 0;
        memberOrts.push({ ...o, inv, mid });
      }
      memberOrts.sort((a, b) => b.inv - a.inv);

      // Visa max 12 etiketter, avtagande storlek/opacitet
      const maxLabels = Math.min(12, memberOrts.length);
      for (let i = 0; i < maxLabels; i++) {
        const m = memberOrts[i];
        // Offset: bort från kärnan
        const dx = m.x - z.cx;
        const dy = m.y - z.cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offD = 8 * kInv;
        const mlx = m.x + (dx / dist) * offD;
        const mly = m.y + (dy / dist) * offD;
        const mAlign = dx >= 0 ? "left" : "right";

        const tier = i < 3 ? 0 : i < 7 ? 1 : 2;
        const sz = [10, 9, 8][tier];
        const w = ["500", "400", "400"][tier];
        const a = [0.75, 0.55, 0.4][tier];

        // Connector bara för de största
        if (tier < 2) {
          leaderLine(ctx, mlx, mly, m.x, m.y, {
            alpha: a * 0.3, width: 0.4 * kInv
          });
        }

        haloText(ctx, m.namn, mlx, mly, {
          font: font(w, sz), color: INK, haloWidth: hw * 0.9,
          align: mAlign, baseline: "middle", alpha: a
        });
      }

      // Externa destinationer — dämpad, mindre
      for (const extId of zoneExtDests) {
        const eo = ortByComm.get(extId);
        if (!eo) continue;
        const dx = eo.x - z.cx;
        const dy = eo.y - z.cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offD = 8 * kInv;
        const elx = eo.x + (dx / dist) * offD;
        const ely = eo.y + (dy / dist) * offD;
        const eAlign = dx >= 0 ? "left" : "right";

        haloText(ctx, eo.namn, elx, ely, {
          font: font("400", 9), color: MUTED, haloWidth: hw * 0.8,
          align: eAlign, baseline: "middle", alpha: 0.5
        });
      }
    } else {
      // Global vy: alla kärnor
      // Panel öppen i fullvyn → tvinga västkant-etiketter åt höger så de inte
      // hamnar under panelen.
      const panelShift = _panelOpen && !STATIC && width >= 700;
      ctx.font = font("500", 10.5);
      const panelEdge = PANEL_W + 12;   // panelens högerkant + marginal (skärm-px)
      for (const z of zones) {
        const off = LABEL_OFFSETS[z.id] || { dx: 14, dy: -10 };
        let odx = off.dx;
        if (panelShift) {
          // Mät etiketten och flippa/putta bara de som faktiskt skulle hamna
          // under panelen (oavsett namnlängd, t.ex. "Ringhals, Skällåkra…").
          const labelW = ctx.measureText(z.namn).width;
          let anchorX = z.cx + odx * kInv;
          const leftEdge = odx >= 0 ? anchorX : anchorX - labelW;
          if (leftEdge < panelEdge) {
            odx = Math.abs(odx) + 4;
            anchorX = z.cx + odx * kInv;
            if (anchorX < panelEdge) odx += (panelEdge - anchorX) / kInv;
          }
        }
        const lx = z.cx + odx * kInv;
        const ly = z.cy + off.dy * kInv;
        const align = odx >= 0 ? "left" : "right";

        leaderLine(ctx, lx, ly, z.cx, z.cy, {
          alpha: 0.2, width: 0.5 * kInv
        });

        haloText(ctx, z.namn, lx, ly, {
          font: font("500", 10.5), color: INK, haloWidth: hw,
          align, baseline: "middle"
        });
      }
    }
  }

  // ---------- Panel (HTML overlay)
  const PANEL_W = Math.min(380, Math.round(width * 0.38));
  let _panelOpen = !panelCollapsed;

  const panel = document.createElement("div");
  panel.style.cssText = `
    position:absolute;top:0;left:0;bottom:0;
    width:${PANEL_W}px;
    background:rgba(243,245,237,0.97);backdrop-filter:blur(10px);
    padding:28px 24px;overflow-y:auto;
    border-right:1px solid rgba(0,0,0,0.06);
    font-size:13px;line-height:1.65;
    z-index:10;
    transition:transform 0.3s ease;
  `;
  if (!_panelOpen) panel.style.transform = `translateX(-100%)`;
  container.appendChild(panel);

  // Toggle-knapp
  const toggleBtn = document.createElement("button");
  toggleBtn.style.cssText = `
    position:absolute;top:12px;z-index:11;
    background:rgba(243,245,237,0.95);backdrop-filter:blur(8px);
    border:1px solid rgba(0,0,0,0.08);border-radius:0 5px 5px 0;
    padding:8px 6px;cursor:pointer;
    font-size:14px;line-height:1;color:${INK};
    transition:left 0.3s ease;
    box-shadow:1px 1px 4px rgba(0,0,0,0.08);
  `;
  toggleBtn.title = "Visa/dölj panel";
  function updateToggle() {
    toggleBtn.style.left = _panelOpen ? `${PANEL_W}px` : "0px";
    toggleBtn.textContent = _panelOpen ? "◂" : "▸";
  }
  updateToggle();
  toggleBtn.addEventListener("click", () => {
    _panelOpen = !_panelOpen;
    panel.style.transform = _panelOpen ? "translateX(0)" : "translateX(-100%)";
    updateToggle();
  });
  container.appendChild(toggleBtn);

  // ---------- Helskärmsknapp — tydlig, märkt affordans (bara interaktiva läget).
  // Kör iframens egen requestFullscreen så panel-/projektionslogiken ser läget.
  if (!STATIC) {
    const fsExpand = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
    const fsCompress = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
    const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const fsBtn = document.createElement("button");
    fsBtn.style.cssText = `
      position:absolute;top:14px;right:14px;z-index:12;
      display:flex;align-items:center;gap:7px;
      background:rgba(255,255,255,0.94);backdrop-filter:blur(8px);
      border:1px solid rgba(0,73,144,0.30);border-radius:8px;
      padding:8px 13px;cursor:pointer;
      font-family:'Inter',system-ui,sans-serif;font-size:12.5px;font-weight:600;
      letter-spacing:0.01em;color:#1A7BB0;line-height:1;
      box-shadow:0 1px 5px rgba(0,0,0,0.10);transition:background 0.15s,box-shadow 0.15s;
    `;
    const _fs = isFs();
    fsBtn.innerHTML = (_fs ? fsCompress : fsExpand) + `<span>${_fs ? "Stäng helskärm" : "Helskärm"}</span>`;
    fsBtn.title = _fs ? "Stäng helskärm" : "Öppna kartan i helskärm";
    fsBtn.onmouseenter = () => { fsBtn.style.background = "#fff"; fsBtn.style.boxShadow = "0 2px 9px rgba(0,0,0,0.15)"; };
    fsBtn.onmouseleave = () => { fsBtn.style.background = "rgba(255,255,255,0.94)"; fsBtn.style.boxShadow = "0 1px 5px rgba(0,0,0,0.10)"; };
    fsBtn.addEventListener("click", () => {
      try {
        if (isFs()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
        else { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen).call(el); }
      } catch (e) { /* tyst */ }
    });
    container.appendChild(fsBtn);
  }

  // ---------- Stegspecifik legend — redaktionell nyckel som möblerar sidoytan
  // och gör varje steg påtagligt. Visas bara i de statiska stegkartorna.
  function buildStageLegend(st) {
    const box = document.createElement("div");
    box.style.cssText = `
      position:absolute;top:28px;left:28px;z-index:9;width:214px;
      pointer-events:none;font-family:'Inter',system-ui,sans-serif;
      color:${INK};line-height:1.5;
    `;
    const kicker = (t) => `<div style="font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:0.16em;text-transform:uppercase;color:${MUTED};margin-bottom:11px;font-weight:500">${t}</div>`;
    const note = (t) => `<div style="font-size:11px;color:${MUTED};margin-top:10px">${t}</div>`;
    const bigZones = zones.slice().sort((a, b) => b.totalPend - a.totalPend);
    let html = "";

    if (st === "orter") {
      const n = ortPoints.filter(o => o.iHalland).length;
      const circ = (d) => `<span style="display:inline-block;width:${d}px;height:${d}px;border-radius:50%;background:#728779;opacity:0.72;border:0.6px solid #3b4742"></span>`;
      html = kicker("Tätorten som byggsten") +
        `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">${circ(7)}${circ(13)}${circ(22)}</div>` +
        `<div style="font-size:12px;font-weight:500">Sysselsatt nattbefolkning</div>` +
        note(`<b style="color:${INK};font-weight:600">${n}</b> tätorter i Halland, 2024`);
    } else if (st === "lankar") {
      const chips = bigZones.slice(0, 5).map(z =>
        `<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;margin:3px 0">` +
        `<span style="display:inline-block;width:17px;height:3px;border-radius:2px;background:${z.color};flex-shrink:0"></span>${z.namn}</div>`).join("");
      html = kicker("Pendlingslänkar") +
        `<div style="font-size:12px;margin-bottom:9px">Varje ort dras mot den kärna dit störst andel av arbetskraften pendlar.</div>` +
        chips +
        note(`Tröskel: <b style="color:${INK};font-weight:600">10 %</b> av arbetskraften`);
    } else if (st === "zoner") {
      const rows = bigZones.map(z =>
        `<div style="display:flex;align-items:center;gap:8px;font-size:11px;margin:2.5px 0">` +
        `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${z.color};opacity:0.88;flex-shrink:0"></span>` +
        `<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${z.namn}</span></div>`).join("");
      html = kicker("Tio tätortsregioner") + rows + note("Delvis överlappande arbetsmarknader");
    } else if (st === "flode") {
      const ramp = ["#cdd8cf", "#7fb295", "#2a5f45"];
      const lvls = [[100, ramp[0]], [2000, ramp[1]], [21000, ramp[2]]];
      const lines = lvls.map(([v, c]) => {
        const w = Math.max(1.2, widthSc(v));
        return `<div style="display:flex;align-items:center;gap:11px;margin:5px 0">` +
          `<span style="display:inline-block;width:36px;height:${w.toFixed(1)}px;border-radius:2px;background:${c};flex-shrink:0"></span>` +
          `<span style="font-size:11.5px">${fmt(v)}</span></div>`;
      }).join("");
      html = kicker("Pendlingsflöde på vägnätet") + lines +
        note("Pendlare per dygn, ackumulerat");
    }

    if (!html) return null;
    box.innerHTML = html;
    return box;
  }

  // Stegkarta (statiskt läge): dölj panel och knapp, visa stegets legend
  if (STATIC) {
    panel.style.display = "none";
    toggleBtn.style.display = "none";
    const lg = buildStageLegend(stage);
    if (lg) container.appendChild(lg);
  }

  // Exponera för extern styrning (fullscreen-toggle)
  container._setPanel = (open) => {
    _panelOpen = open;
    panel.style.transform = _panelOpen ? "translateX(0)" : "translateX(-100%)";
    updateToggle();
  };

  function fmt(n) {
    if (n == null || isNaN(n)) return "–";
    return Math.round(n).toLocaleString("sv-SE");
  }
  function pct(v, tot) {
    if (!tot) return "–";
    return (v / tot * 100).toFixed(1).replace(".", ",");
  }
  // Inline-siffra med vikt
  const num = (n) => `<strong style="font-weight:600">${fmt(n)}</strong>`;
  const pctInline = (v, tot) => `<strong style="font-weight:600">${pct(v, tot)}\u00a0%</strong>`;

  function renderPanel() {
    if (selectedZone) {
      renderZonePanel(selectedZone);
    } else {
      renderOverviewPanel();
    }
  }

  function renderOverviewPanel() {
    // Aggregera per zon
    let totalNattbef = 0;
    const zoneSummaries = zones.map(z => {
      let nattbef = 0, dagbef = 0;
      for (const mid of z.memberIds) {
        const f = fua[mid];
        if (f) {
          nattbef += f.nattbef_syss || 0;
          dagbef  += f.dagbef_syss  || 0;
        }
      }
      totalNattbef += nattbef;
      return { ...z, nattbef, dagbef };
    }).sort((a, b) => b.nattbef - a.nattbef);

    panel.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="font-family:'Newsreader',Georgia,serif;font-weight:700;font-size:16px;color:${INK}">
          Arbetsmarknadsregioner
        </div>
        <div style="font-size:12px;color:${MUTED};margin-top:2px">
          Halland — 10 % pendlingströskel
        </div>
      </div>
      <div style="font-size:12px;color:${MUTED};margin-bottom:14px">
        En ort tillhör en kärnas arbetsmarknadszon om minst 10 % av dess
        sysselsatta nattbefolkning pendlar till kärnan. Flödena på vägnätet
        visar var pendlingen fysiskt ackumuleras.
      </div>
      <div style="background:rgba(0,73,144,0.045);border:1px solid rgba(0,73,144,0.11);border-radius:9px;padding:12px 13px;margin-bottom:18px">
        <div style="font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:0.15em;text-transform:uppercase;color:${MUTED};margin-bottom:10px;font-weight:500">Så utforskar du kartan</div>
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;font-size:12px;line-height:1.45">
          <span style="display:inline-block;width:13px;height:13px;border-radius:3px;background:#1a9a6a;flex-shrink:0;margin-top:2px"></span>
          <span><b style="font-weight:600">Klicka på en region</b> för nyckeltal och dess interna pendlingsstråk.</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;font-size:12px;line-height:1.45">
          <span style="display:inline-block;width:13px;height:13px;border-radius:50%;background:${INK};flex-shrink:0;margin-top:2px"></span>
          <span><b style="font-weight:600">Klicka på en ort</b> för att följa just dess pendlingsrutter.</span>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;font-size:12px;line-height:1.45">
          <span style="display:inline-block;width:14px;height:3px;border-radius:2px;background:#2a5f45;flex-shrink:0;margin-top:7px"></span>
          <span><b style="font-weight:600">Peka på en väg</b> för flödet och de största pendlarparen.</span>
        </div>
      </div>
      <div style="margin-bottom:16px">
        ${zoneSummaries.map(z => `
          <div class="zone-row" data-zone="${z.id}" style="
            display:flex;align-items:center;gap:10px;
            padding:8px 10px;margin:2px 0;border-radius:4px;
            cursor:pointer;transition:background 0.15s;
          " onmouseover="this.style.background='rgba(0,102,77,0.07)'"
            onmouseout="this.style.background='transparent'">
            <div style="
              width:14px;height:14px;border-radius:3px;flex-shrink:0;
              background:${z.color};
            "></div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:13px">${z.namn}</div>
              <div style="font-size:11px;color:${MUTED}">
                ${z.nOrter} orter · ${fmt(z.nattbef)} sysselsatta
              </div>
            </div>
            <div style="font-size:11px;color:${MUTED};text-align:right;white-space:nowrap">
              ${fmt(z.dagbef)} jobb
            </div>
          </div>
        `).join("")}
      </div>
      <div style="font-size:11px;color:${MUTED};border-top:1px solid rgba(0,73,144,0.1);padding-top:10px">
        Tonade fält är tätortsregionernas utbredning, de gröna linjerna pendlingsflödet på vägnätet. Öppna i helskärm för hela bilden.
      </div>
    `;

    // Klick-handlers
    panel.querySelectorAll(".zone-row").forEach(el => {
      el.addEventListener("click", () => {
        const zid = el.dataset.zone;
        selectedZone = zoneById.get(zid) || null;
        buildZoneExtDests(selectedZone);
        renderPanel();
        drawAll();
      });
      el.addEventListener("mouseenter", () => {
        hoveredZone = zoneById.get(el.dataset.zone) || null;
        drawHulls();
      });
      el.addEventListener("mouseleave", () => {
        hoveredZone = null;
        drawHulls();
      });
    });
  }

  function renderZonePanel(z) {
    // ---- Aggregera data per zonmedlem
    const members = [];
    let totNattbef = 0, totDagbef = 0, totBorArbetar = 0, totInvanare = 0;
    let totInpendlare = 0, totUtpendlare = 0;
    for (const mid of z.memberIds) {
      const f = fua[mid];
      const o = ortByComm.get(mid);
      const namn = o ? o.namn : mid;
      const nattbef = f?.nattbef_syss || 0;
      const dagbef = f?.dagbef_syss || 0;
      const inv = invanare[mid] || 0;
      totNattbef     += nattbef;
      totDagbef      += dagbef;
      totBorArbetar  += f?.bor_arbetar || 0;
      totInvanare    += inv;
      totInpendlare  += f?.inpendlare || 0;
      totUtpendlare  += f?.utpendlare || 0;
      members.push({
        mid, namn, nattbef, dagbef, inv, kommun: o?.kommun || "",
        borArbetar: f?.bor_arbetar || 0,
        inpendlare: f?.inpendlare || 0,
        utpendlare: f?.utpendlare || 0
      });
    }
    members.sort((a, b) => b.inv - a.inv);

    // Kärnan (den ort som är centrum)
    const coreFua = fua[z.id];
    const coreOrt = ortByComm.get(z.id);
    const coreNamn = coreOrt?.namn || z.namn;
    const coreDagbef = coreFua?.dagbef_syss || dagbefMap[z.id] || 0;
    const coreInv = invanare[z.id] || 0;

    // Länsövergripande? Kärnan utanför Halland
    const coreIsExtern = !z.id.endsWith("_13");
    // Halland-medlemmar (för länsövergripande zoner)
    let hallandNattbefZon = 0, hallandInvanareZon = 0;
    let hallandMembers = 0;
    for (const mid of z.memberIds) {
      if (mid.endsWith("_13")) {
        hallandMembers++;
        hallandNattbefZon += fua[mid]?.nattbef_syss || 0;
        hallandInvanareZon += invanare[mid] || 0;
      }
    }
    // Pendling från Halland-medlemmar till kärnan
    let hallandTillKarna = 0;
    if (coreIsExtern) {
      for (const mid of z.memberIds) {
        if (!mid.endsWith("_13")) continue;
        const oe = ortEdges[mid];
        if (!oe || Array.isArray(oe)) continue;
        for (const pr of (oe.partners || [])) {
          if (pr.p === z.id) hallandTillKarna += (+pr.s || 0);
        }
      }
    }

    // ---- Intern pendling (ort→ort inom zonen)
    let internPendling = 0;
    // Alla inomregionala resor som involverar kärnan (in + ut)
    let resorMedKarna = 0;
    for (const mid of z.memberIds) {
      const oe = ortEdges[mid];
      if (!oe || Array.isArray(oe)) continue;
      for (const pr of (oe.partners || [])) {
        if (!z.memberIds.has(pr.p)) continue;
        internPendling += (+pr.s || 0);
        // Resor där kärnan är ena änden (oavsett riktning)
        if (mid === z.id || pr.p === z.id) resorMedKarna += (+pr.s || 0);
      }
    }
    const jobbarINomZonen = totBorArbetar + internPendling;
    const egenPct = totNattbef > 0
      ? Math.round(jobbarINomZonen / totNattbef * 100) : 0;
    const netto = totDagbef - totNattbef;

    // ---- Inomregionala kopplingar (ort→ort inom zonen)
    const intByOrt = new Map();  // partner community → { ut, inn }
    for (const mid of z.memberIds) {
      const oe = ortEdges[mid];
      if (!oe || Array.isArray(oe)) continue;
      for (const pr of (oe.partners || [])) {
        if (!z.memberIds.has(pr.p)) continue;
        if (mid === pr.p) continue;
        const ut = +pr.s || 0;
        const inn = +pr.d || 0;
        if (ut + inn <= 0) continue;
        // Deduplicera: spara bara en riktning (min-id som nyckel)
        const key = [mid, pr.p].sort().join("|");
        const entry = intByOrt.get(key) || { a: [mid, pr.p].sort()[0], b: [mid, pr.p].sort()[1], ut: 0, inn: 0 };
        if (mid < pr.p) { entry.ut += ut; entry.inn += inn; }
        else { entry.ut += inn; entry.inn += ut; }
        intByOrt.set(key, entry);
      }
    }
    // Bygg riktade kopplingar: varje ort → varje annan ort i zonen
    // Primärt mått: andel av nattbef (grunden för LMA-indelningen)
    const internalDir = [];
    for (const mid of z.memberIds) {
      const oe = ortEdges[mid];
      if (!oe || Array.isArray(oe)) continue;
      const nattMid = fua[mid]?.nattbef_syss || 0;
      for (const pr of (oe.partners || [])) {
        if (!z.memberIds.has(pr.p) || mid === pr.p) continue;
        const ut = +pr.s || 0;
        const inn = +pr.d || 0;
        if (ut <= 0 || nattMid <= 0) continue;
        const andel = ut / nattMid * 100;
        if (andel < 10) continue;
        const po = ortByComm.get(pr.p);
        const oMid = ortByComm.get(mid);
        internalDir.push({
          fromId: mid, toId: pr.p,
          fromNamn: oMid?.namn || mid,
          toNamn: po?.namn || pr.p,
          ut, inn,
          total: ut + inn,
          pendlare: ut,
          andel: Math.round(andel * 10) / 10
        });
      }
    }
    internalDir.sort((a, b) => b.andel - a.andel);
    const totIntPairs = internalDir.length;

    // ---- Externa kopplingar — aggregerat per extern destination
    // Alla zonmedlemmars flöden till en extern ort summeras.
    // Tröskeln gäller aggregatet, inte enskilda OD-par.
    const extByDest = new Map();  // extern ort → { ut, inn, pairs:[] }
    for (const mid of z.memberIds) {
      const oe = ortEdges[mid];
      if (!oe || Array.isArray(oe)) continue;
      const oMid = ortByComm.get(mid);
      for (const pr of (oe.partners || [])) {
        if (z.memberIds.has(pr.p)) continue;
        const ut = +pr.s || 0;
        const inn = +pr.d || 0;
        if (ut + inn <= 0) continue;
        const entry = extByDest.get(pr.p) || { ut: 0, inn: 0, pairs: [] };
        entry.ut += ut;
        entry.inn += inn;
        entry.pairs.push({ fromId: mid, fromNamn: oMid?.namn || mid, ut, inn });
        extByDest.set(pr.p, entry);
      }
    }

    // Totalt zon-flöde (intern + extern) — basen för andelberäkning
    const totalZoneFlow = internPendling + [...extByDest.values()].reduce((s, e) => s + e.ut + e.inn, 0);

    const externalDir = [];
    for (const [pid, e] of extByDest) {
      if (e.ut + e.inn < 100) continue;  // ≥100 OD-par-pendlare = reell koppling
      const po = ortByComm.get(pid);
      const pZone = ortZone.get(pid);
      const pzObj = pZone ? zoneById.get(pZone) : null;
      const total = e.ut + e.inn;
      externalDir.push({
        destId: pid,
        destNamn: po?.namn || pid,
        color: pzObj?.color || "#8a8f91",
        ut: e.ut, inn: e.inn, total,
        andelAvTotal: totalZoneFlow > 0 ? Math.round(total / totalZoneFlow * 1000) / 10 : 0,
        pairs: e.pairs.sort((a, b) => (b.ut + b.inn) - (a.ut + a.inn))
      });
    }
    externalDir.sort((a, b) => b.total - a.total);
    const totExtUt  = externalDir.reduce((s, l) => s + l.ut, 0);
    const totExtIn  = externalDir.reduce((s, l) => s + l.inn, 0);
    const totExtAll = totExtUt + totExtIn;

    // ---- Helpers
    const p = (text) => `<p style="margin:0 0 12px 0">${text}</p>`;
    const heading = (text) => `<div style="
      font-family:'Newsreader',Georgia,serif;font-weight:700;font-size:13px;
      color:${INK};margin:20px 0 8px 0;padding-bottom:4px;
      border-bottom:2px solid ${z.color};
    ">${text}</div>`;

    // ---- Ortsnamn-lista
    const ortNamn = members.map(m => m.namn);
    const ortListText = ortNamn.length <= 5
      ? ortNamn.join(", ")
      : ortNamn.slice(0, 4).join(", ") + ` och ${ortNamn.length - 4} till`;

    // ---- Extern kopplingar formaterade
    const topExt = externalDir.slice(0, 8);
    const extLines = topExt.map(l => {
      const parts = [];
      if (l.ut > 0) parts.push(`${fmt(l.ut)} ut`);
      if (l.inn > 0) parts.push(`${fmt(l.inn)} in`);
      return `<span style="display:inline-flex;align-items:center;gap:4px">` +
        `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${l.color};flex-shrink:0"></span>` +
        `${l.namn} <span style="color:${MUTED}">(${parts.join(", ")})</span></span>`;
    });

    // ============ NARRATIV TEXT ============
    panel.innerHTML = `
      <div style="margin-bottom:4px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
          <button id="back-btn" style="
            background:none;border:none;cursor:pointer;padding:2px 4px;
            font-size:16px;color:${MUTED};line-height:1;
          ">←</button>
          <div style="width:14px;height:14px;border-radius:3px;background:${z.color};flex-shrink:0"></div>
          <div style="font-family:'Newsreader',Georgia,serif;font-weight:700;font-size:17px;color:${INK}">
            ${z.namn}s tätortsregion
          </div>
        </div>
      </div>

      <!-- Kartlegend -->
      <div style="
        display:flex;gap:14px;margin-bottom:14px;font-size:11px;color:${MUTED};
      ">
        <span style="display:flex;align-items:center;gap:4px">
          <span style="display:inline-block;width:18px;height:3px;border-radius:2px;background:${z.color}"></span>
          Intern pendling
        </span>
        <span style="display:flex;align-items:center;gap:4px">
          <span style="display:inline-block;width:18px;height:3px;border-radius:2px;background:${INK};opacity:0.3"></span>
          Utåtgående
        </span>
      </div>

      ${heading("Befolkning och ekonomi")}

      ${coreIsExtern ? (() => {
        // Länsövergripande: kärnan utanför Halland
        return p(`${coreNamn}s tätortsregion sträcker sig över länsgränsen. Av regionens ${num(z.nOrter)} tätorter ligger ${num(hallandMembers)} i Halland: ${ortListText}. I dessa bor ${num(hallandInvanareZon)} invånare, motsvarande ${pctInline(hallandInvanareZon, hallandInvanare)} av Hallands tätortsbefolkning.`)
          + p(`${coreNamn} tätort rymmer ${num(coreDagbef)} jobb. Från de halländska orterna i regionen pendlar ${num(hallandTillKarna)} personer till ${coreNamn}. Totalt har regionen ${num(hallandNattbefZon)} sysselsatta hallänningar, vilket motsvarar ${pctInline(hallandNattbefZon, hallandNattbef)} av Hallands sysselsatta.`);
      })()
      : (() => {
        // Inomhalländsk zon
        return p(`${z.namn}s tätortsregion omfattar ${num(z.nOrter)} tätorter: ${ortListText}. I dessa tätorter bor ${num(totInvanare)} invånare, vilket motsvarar ${pctInline(totInvanare, hallandInvanare)} av Hallands tätortsbefolkning.`)
          + p(`Regionen rymmer ${num(totDagbef)} jobb (sysselsatt dagbefolkning) och ${num(totNattbef)} förvärvsarbetande invånare (sysselsatt nattbefolkning). Det motsvarar ${pctInline(totDagbef, hallandDagbef)} av Hallands jobb och ${pctInline(totNattbef, hallandNattbef)} av regionens sysselsatta.`)
          + p(`Av de sysselsatta bor och arbetar ${num(totBorArbetar)} i sin hemort. ${num(totUtpendlare)} pendlar ut ur sina hemorter och ${num(totInpendlare)} pendlar in, vilket ger ett pendlingsnetto på ${netto > 0 ? "+" : ""}${num(netto)}.${
          netto > 0
            ? ` Regionen har fler jobb än sysselsatta invånare.`
            : netto < 0
              ? ` Regionen har fler sysselsatta invånare än jobb.`
              : ""
        }`);
      })()}

      ${(() => {
        const isK = (mid) => mid === z.id;
        const sortedByInv = [...members].sort((a, b) => b.inv - a.inv);
        const row = (label, val) => `<span style="color:${MUTED}">${label}</span><span style="text-align:right;font-weight:500">${fmt(val)}</span>`;
        return `
          <details style="margin-bottom:6px">
            <summary style="font-size:12px;color:${MUTED};cursor:pointer;padding:2px 0">Visa alla orter</summary>
            <div style="margin-top:6px">
              ${sortedByInv.map(m => {
                const nettoM = m.dagbef - m.nattbef;
                return `
                <div class="ort-card" data-community="${m.mid}" style="
                  display:grid;grid-template-columns:1fr auto;gap:1px 10px;
                  padding:6px 8px;margin-bottom:3px;border-radius:3px;
                  border-left:3px solid ${isK(m.mid) ? z.color : "transparent"};
                  font-size:11px;cursor:pointer;transition:background 0.1s;
                ">
                  <span style="font-weight:${isK(m.mid)?600:500};grid-column:1/-1;margin-bottom:2px">${m.namn}${isK(m.mid) ? ` <span style="font-size:10px;color:${z.color};font-weight:600">KÄRNA</span>` : ""}</span>
                  ${row("Invånare", m.inv)}
                  ${row("Jobb (dag)", m.dagbef)}
                  ${row("Sysselsatta (natt)", m.nattbef)}
                  ${row("Bor & arbetar", m.borArbetar)}
                  ${row("Utpendlare", m.utpendlare)}
                  ${row("Inpendlare", m.inpendlare)}
                  <span style="color:${MUTED}">Netto</span><span style="text-align:right;font-weight:500;color:${nettoM > 0 ? z.color : nettoM < 0 ? "#c75a4a" : INK}">${nettoM > 0 ? "+" : ""}${fmt(nettoM)}</span>
                </div>`;
              }).join("")}
            </div>
          </details>
        `;
      })()}

      ${heading(coreIsExtern ? "Pendling och kopplingar" : "Inomregional arbetsmarknad")}

      ${coreIsExtern ? (() => {
        return p(`Av de ${num(hallandNattbefZon)} sysselsatta hallänningarna i regionen pendlar ${num(hallandTillKarna)} till ${coreNamn}. ${internPendling > 0 ? `Inom de halländska orterna pendlar ${num(internPendling)} personer sinsemellan.` : ""} ${totBorArbetar > 0 ? `${num(totBorArbetar)} arbetar i sin hemort.` : ""}`);
      })()
      : (() => {
        return p(`Av regionens ${num(totNattbef)} sysselsatta invånare arbetar ${num(jobbarINomZonen)} inom tätortsregionen — en egenförsörjningsgrad på ${num(egenPct)}\u00a0procent. ${totBorArbetar > 0 ? `${num(totBorArbetar)} arbetar i sin hemort och ${num(internPendling)} pendlar till en annan ort inom regionen.` : ""}`)
          + p(`Regionens kärna är ${coreNamn} tätort med ${num(coreInv)} invånare och ${num(coreDagbef)} jobb. Kärnan koncentrerar ${pctInline(coreDagbef, totDagbef)} av regionens jobb. ${resorMedKarna > 0 ? `Av de inomregionala resorna involverar ${num(resorMedKarna)} kärnan — antingen som mål eller källa — vilket motsvarar ${pctInline(resorMedKarna, internPendling)} av all intern pendling.` : ""}`);
      })()}

      ${heading("Inomregionala kopplingar")}

      ${p(`${num(totIntPairs)} pendlingsrelationer inom regionen når 10\u00a0%-tröskeln — den nivå där minst 10\u00a0procent av en orts sysselsatta pendlar till en annan ort i regionen.`)}

      ${internalDir.length > 0 ? (() => {
        const maxInt = d3.max(internalDir, l => l.total) || 1;
        const bar = (v, mx, col) => `<div style="height:4px;flex:1;background:rgba(0,0,0,0.05);border-radius:2px;overflow:hidden"><div style="height:100%;width:${Math.max(2, Math.round(v/mx*100))}%;background:${col};border-radius:2px"></div></div>`;
        return `
          <details style="margin-bottom:6px">
            <summary style="font-size:12px;color:${MUTED};cursor:pointer;padding:2px 0">Visa alla kopplingar</summary>
            <div style="margin-top:6px">
              ${internalDir.map(l => `
                <div class="int-card" data-id-a="${l.fromId}" data-id-b="${l.toId}" style="
                  display:grid;grid-template-columns:1fr 50px 50px;gap:2px 6px;
                  padding:5px 8px;margin-bottom:2px;border-radius:3px;
                  border-left:3px solid ${z.color};
                  font-size:11px;cursor:pointer;transition:background 0.1s;
                ">
                  <span style="grid-column:1/-1;font-weight:500;margin-bottom:1px">${l.fromNamn} \u2192 ${l.toNamn} <span style="font-weight:600;color:${z.color}">${l.andel}\u00a0%</span> <span style="color:${MUTED};font-weight:400">av arbetskraften</span></span>
                  <span style="color:${MUTED}">Ut</span>
                  ${bar(l.pendlare, maxInt, z.color)}
                  <span style="text-align:right;font-weight:500">${fmt(l.pendlare)}</span>
                  <span style="color:${MUTED}">In</span>
                  ${bar(l.inn, maxInt, z.color)}
                  <span style="text-align:right;font-weight:500">${fmt(l.inn)}</span>
                </div>
              `).join("")}
            </div>
          </details>
        `;
      })() : ""}

      ${heading("Utomregionala kopplingar")}

      ${p(`Tätortsregionen har ${num(externalDir.length)} reella kopplingar till orter utanför regionen (minst 100 pendlare totalt). Totalt pendlar ${num(totExtUt)} ut och ${num(totExtIn)} in.`)}

      ${externalDir.length > 0 ? (() => {
        const maxExt = d3.max(externalDir, l => l.total) || 1;
        const bar = (v, mx, col) => `<div style="height:4px;flex:1;background:rgba(0,0,0,0.05);border-radius:2px;overflow:hidden"><div style="height:100%;width:${Math.max(2, Math.round(v/mx*100))}%;background:${col};border-radius:2px"></div></div>`;
        return `
          <details style="margin-bottom:6px">
            <summary style="font-size:12px;color:${MUTED};cursor:pointer;padding:2px 0">Visa alla kopplingar</summary>
            <div style="margin-top:6px">
              ${externalDir.map(l => `
                <div class="ext-card" data-dest="${l.destId}" style="
                  padding:5px 8px;margin-bottom:3px;border-radius:3px;
                  border-left:3px solid ${l.color};
                  font-size:11px;cursor:pointer;transition:background 0.1s;
                ">
                  <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:3px">
                    <span style="font-weight:500">${l.destNamn}</span>
                    <span style="font-weight:600;color:${l.color}">${l.andelAvTotal}\u00a0%</span>
                    <span style="color:${MUTED};font-weight:400">av totalt flöde</span>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 50px 50px;gap:2px 6px">
                    <span style="color:${MUTED}">Ut</span>
                    ${bar(l.ut, maxExt, INK)}
                    <span style="text-align:right;font-weight:500">${fmt(l.ut)}</span>
                    <span style="color:${MUTED}">In</span>
                    ${bar(l.inn, maxExt, z.color)}
                    <span style="text-align:right;font-weight:500">${fmt(l.inn)}</span>
                  </div>
                  ${l.pairs.length > 1 ? `
                    <details style="margin-top:3px">
                      <summary style="font-size:10px;color:${MUTED};cursor:pointer">Visa per ort</summary>
                      <div style="margin-top:2px;padding-left:4px;border-left:1px solid rgba(0,0,0,0.06)">
                        ${l.pairs.map(pp => `
                          <div style="display:flex;gap:6px;font-size:10px;padding:1px 0;color:${MUTED}">
                            <span style="flex:1">${pp.fromNamn}</span>
                            <span>${fmt(pp.ut)} ut</span>
                            <span>${fmt(pp.inn)} in</span>
                          </div>
                        `).join("")}
                      </div>
                    </details>
                  ` : ""}
                </div>
              `).join("")}
            </div>
          </details>
        `;
      })() : ""}

      ${heading("Ortspecifik pendling")}

      ${p(`Klicka på en ort för att se dess pendlingsrutter på kartan.`)}

      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">
        ${members.map(m => `
          <button class="focus-ort-btn" data-community="${m.mid}" style="
            padding:4px 10px;border-radius:3px;font-size:12px;
            border:1px solid rgba(0,0,0,0.1);background:transparent;
            cursor:pointer;color:${INK};transition:all 0.1s;
            font-family:inherit;
          ">${m.namn}</button>
        `).join("")}
      </div>

      <div id="focus-ort-detail" style="min-height:20px"></div>

      <button id="back-btn-bottom" style="
        display:flex;align-items:center;justify-content:center;gap:8px;
        margin:22px 0 6px;padding:11px 14px;width:100%;box-sizing:border-box;
        background:rgba(0,73,144,0.05);border:1px solid rgba(0,73,144,0.16);
        border-radius:8px;cursor:pointer;
        font-family:'Inter',system-ui,sans-serif;font-size:13px;font-weight:600;
        color:#1A7BB0;letter-spacing:0.01em;transition:background 0.15s;
      " onmouseover="this.style.background='rgba(0,73,144,0.10)'"
        onmouseout="this.style.background='rgba(0,73,144,0.05)'">&larr; Tillbaka till alla regioner</button>
    `;

    // ---- Event-handlers
    const goBack = () => {
      selectedZone = null;
      highlightOrt = null;
      focusOrt = null;
      focusOrtLocked = false;
      focusRoutes = null;
      segToPartner = null;
      highlightPartner = null;
      renderPanel();
      drawAll();
    };
    panel.querySelectorAll("#back-btn, #back-btn-bottom").forEach(b => b.addEventListener("click", goBack));

    // Befolknings-dragspel: bara prick-highlight (ingen routing)
    panel.querySelectorAll(".ort-card").forEach(el => {
      el.addEventListener("mouseenter", () => {
        highlightOrt = el.dataset.community;
        el.style.background = "rgba(0,0,0,0.04)";
        drawOrter();
      });
      el.addEventListener("mouseleave", () => {
        highlightOrt = null;
        el.style.background = "";
        drawOrter();
      });
    });

    // Inomregionala + utomregionala kopplingar: ort + segment
    // Aktiverar fokus-ort temporärt (utan lås) → rutter syns
    panel.querySelectorAll(".int-card").forEach(el => {
      el.addEventListener("mouseenter", () => {
        if (focusOrtLocked) return;
        focusOrt = el.dataset.idA;
        highlightPartner = el.dataset.idB;
        buildFocusRoutes(focusOrt);
        el.style.background = "rgba(0,0,0,0.04)";
        drawAll();
      });
      el.addEventListener("mouseleave", () => {
        if (focusOrtLocked) return;
        focusOrt = null;
        highlightPartner = null;
        focusRoutes = null;
        segToPartner = null;
        el.style.background = "";
        drawAll();
      });
    });

    panel.querySelectorAll(".ext-card").forEach(el => {
      el.addEventListener("mouseenter", () => {
        if (focusOrtLocked) return;
        // Samla ALLA zonmedlemmars rutter till denna destination
        const destId = el.dataset.dest;
        const allRoutes = [];
        const s2p = new Map();
        for (const mid of z.memberIds) {
          const oe = ortEdges[mid];
          if (!oe || Array.isArray(oe)) continue;
          for (const pr of (oe.partners || [])) {
            if (pr.p !== destId) continue;
            const flow = (+pr.s || 0) + (+pr.d || 0);
            if (flow <= 0 || !pr.c) continue;
            const oMid = ortByComm.get(mid);
            const chains = [];
            for (const cid of pr.c) {
              const fi = edgeIdxToDrawIdx.get(+cid);
              if (fi != null) {
                chains.push(fi);
                const ex = s2p.get(fi);
                if (!ex || flow > ex.flow) {
                  s2p.set(fi, { namn: oMid?.namn || mid, ut: +pr.s||0, inn: +pr.d||0, flow });
                }
              }
            }
            if (chains.length) allRoutes.push({ flow, chains, namn: oMid?.namn || mid, ut: +pr.s||0, inn: +pr.d||0, pid: mid });
          }
        }
        allRoutes.sort((a, b) => a.flow - b.flow);
        focusOrt = "__ext_hover__";
        focusRoutes = allRoutes;
        segToPartner = s2p;
        highlightPartner = null;
        el.style.background = "rgba(0,0,0,0.04)";
        drawAll();
      });
      el.addEventListener("mouseleave", () => {
        if (focusOrtLocked) return;
        focusOrt = null;
        highlightPartner = null;
        focusRoutes = null;
        segToPartner = null;
        el.style.background = "";
        drawAll();
      });
    });

    // Ortspecifik-knappar: full ort-fokus med rutter
    panel.querySelectorAll(".focus-ort-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const cid = btn.dataset.community;
        if (focusOrt === cid && focusOrtLocked) {
          // Klick igen → avlås
          focusOrt = null;
          focusOrtLocked = false;
          focusRoutes = null;
          segToPartner = null;
          panel.querySelectorAll(".focus-ort-btn").forEach(b => {
            b.style.background = "transparent";
            b.style.fontWeight = "400";
            b.style.borderColor = "rgba(0,73,144,0.15)";
          });
          const detail = panel.querySelector("#focus-ort-detail");
          if (detail) detail.innerHTML = "";
          hideTooltip();
        } else {
          // Lås ny ort
          focusOrt = cid;
          focusOrtLocked = true;
          buildFocusRoutes(cid);
          panel.querySelectorAll(".focus-ort-btn").forEach(b => {
            b.style.background = b === btn ? ACCENT : "transparent";
            b.style.fontWeight = b === btn ? "600" : "400";
            b.style.borderColor = b === btn ? ACCENT : "rgba(0,73,144,0.15)";
          });
          renderFocusOrtDetail(z, cid);
        }
        drawFlode();
        drawOrter();
      });
      // Hover-preview (utan lås) — bara om inget redan låst
      btn.addEventListener("mouseenter", () => {
        if (focusOrtLocked) return;
        focusOrt = btn.dataset.community;
        buildFocusRoutes(focusOrt);
        btn.style.background = "rgba(255,217,57,0.3)";
        drawFlode();
        drawOrter();
      });
      btn.addEventListener("mouseleave", () => {
        if (focusOrtLocked) return;
        focusOrt = null;
        focusRoutes = null;
        segToPartner = null;
        btn.style.background = "transparent";
        drawFlode();
        drawOrter();
      });
    });
  }

  // Rendera ortspecifik detalj — partners med ut/in
  function renderFocusOrtDetail(z, cid) {
    const detail = panel.querySelector("#focus-ort-detail");
    if (!detail) return;
    const o = ortByComm.get(cid);
    const namn = o?.namn || cid;

    const oe = ortEdges[cid];
    if (!oe || Array.isArray(oe)) {
      detail.innerHTML = `<div style="font-size:12px;color:${MUTED}">Ingen pendlingsdata.</div>`;
      return;
    }
    const partners = [];
    for (const pr of (oe.partners || [])) {
      const ut = +pr.s || 0, inn = +pr.d || 0;
      if (ut + inn < 25) continue;
      const po = ortByComm.get(pr.p);
      partners.push({
        pid: pr.p,
        namn: po?.namn || pr.p,
        ut, inn,
        total: ut + inn,
        isInZone: z.memberIds.has(pr.p)
      });
    }
    partners.sort((a, b) => b.total - a.total);

    if (partners.length === 0) {
      detail.innerHTML = `<div style="font-size:12px;color:${MUTED}">Ingen pendlingsdata.</div>`;
      return;
    }

    const maxP = partners[0].total;
    const bar = (v, col) => `<div style="height:4px;flex:1;background:rgba(0,73,144,0.06);border-radius:2px;overflow:hidden"><div style="height:100%;width:${Math.max(2,Math.round(v/maxP*100))}%;background:${col};border-radius:2px"></div></div>`;

    detail.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">${namn}</div>
      ${partners.map(p => `
        <div class="partner-row" data-partner="${p.pid}" style="
          display:grid;grid-template-columns:1fr 44px 44px;gap:2px 6px;
          padding:5px 8px;margin-bottom:2px;font-size:11px;
          border-left:3px solid ${p.isInZone ? z.color : MUTED};
          border-radius:3px;cursor:pointer;transition:background 0.1s;
        ">
          <span style="grid-column:1/-1;font-weight:500">${p.namn}${p.isInZone ? "" : ` <span style="color:${MUTED};font-size:10px">extern</span>`}</span>
          <span style="color:${MUTED}">Ut</span>
          ${bar(p.ut, INK)}
          <span style="text-align:right;font-weight:500">${fmt(p.ut)}</span>
          <span style="color:${MUTED}">In</span>
          ${bar(p.inn, z.color)}
          <span style="text-align:right;font-weight:500">${fmt(p.inn)}</span>
        </div>
      `).join("")}
    `;

    // Hover på partner-rad → highlight rutt + etikett på kartan
    detail.querySelectorAll(".partner-row").forEach(row => {
      row.addEventListener("mouseenter", () => {
        highlightPartner = row.dataset.partner;
        row.style.background = "rgba(255,217,57,0.15)";
        drawFlode();
        drawOrter();
        drawLabels();
      });
      row.addEventListener("mouseleave", () => {
        highlightPartner = null;
        row.style.background = "";
        drawFlode();
        drawOrter();
        drawLabels();
      });
    });
  }

  // ---------- Zoom
  const zoom = d3.zoom()
    .scaleExtent([0.8, 30])
    .on("zoom", (e) => {
      currentTransform = e.transform;
      drawAll();
    });

  d3.select(hoverLayer.canvas).call(zoom);

  // ---------- Stegspecifika tooltips (statiska stegkartor)
  // Varje steg får en hover som speglar just det lagrets poäng.
  const ttHead = (namn, sub) =>
    `<div style="font-weight:600;font-size:12.5px;margin-bottom:${sub ? 1 : 0}px">${namn}</div>` +
    (sub ? `<div style="font-size:10.5px;color:${MUTED};letter-spacing:0.02em;text-transform:uppercase;margin-bottom:3px">${sub}</div>` : "");
  const ttRow = (label, val) =>
    `<div style="display:flex;justify-content:space-between;gap:14px;font-size:11.5px;line-height:1.5">` +
    `<span style="color:${MUTED}">${label}</span><span style="font-weight:600;color:${INK}">${val}</span></div>`;
  const ttDot = (col) =>
    `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${col};flex-shrink:0"></span>`;

  function staticOrtTooltip(o) {
    const isCore = Object.keys(karnor).includes(o.community);
    const f      = fua[o.community];
    const inv    = invanare[o.community] || 0;
    const dag    = (f && f.dagbef_syss) || dagbefMap[o.community] || 0;

    if (stage === "orter") {
      // Råmaterialet: ortens storlek, ingen indelning ännu
      const sub = o.iHalland ? (o.kommun || "") : "utanför Halland";
      return ttHead(o.namn, sub) +
        ttRow("Sysselsatta (natt)", fmt(o.nattbef)) +
        (inv ? ttRow("Invånare", fmt(inv)) : "");
    }

    if (stage === "lankar") {
      // Mekanismen: vart ortens arbetskraft pendlar (alla länkar ≥10 %)
      if (isCore) {
        const ki = karnor[o.community];
        return ttHead(o.namn, "Kärna i egen tätortsregion") +
          ttRow("Länkade orter", fmt((ki && ki.n_orter) || 0)) +
          ttRow("Sysselsatta (natt)", fmt(o.nattbef));
      }
      const links = (f && f.zoner) || [];
      if (!links.length) {
        return ttHead(o.namn, o.kommun) +
          `<div style="font-size:11px;color:${MUTED}">Ingen pendlingslänk över 10 %</div>`;
      }
      const rows = links.map(z => {
        const cNamn = (ortByComm.get(z.k) || {}).namn || z.n;
        const col   = ZONE_COLORS[z.k] || MUTED;
        const andel = (z.andel != null ? z.andel.toString().replace(".", ",") : "?");
        return `<div style="display:flex;align-items:center;gap:6px;font-size:11.5px;line-height:1.6">` +
          ttDot(col) +
          `<span style="flex:1">${cNamn}</span>` +
          `<span style="font-weight:600;color:${INK}">${andel} %</span>` +
          `<span style="color:${MUTED};min-width:38px;text-align:right">${fmt(z.pend)}</span></div>`;
      }).join("");
      return ttHead(o.namn, "Arbetskraften pendlar till") + rows;
    }

    if (stage === "zoner") {
      // Indelningen: vilken/vilka zoner orten tillhör
      const links = (f && f.zoner) || [];
      const zoneNamn = isCore
        ? `${o.namn} (kärna)`
        : (links.map(z => (ortByComm.get(z.k) || {}).namn || z.n).join(", ") || "–");
      const sub = links.length > 1 ? "Delad mellan zoner" : "Tätortsregion";
      return ttHead(o.namn, o.kommun) +
        ttRow(sub, zoneNamn) +
        (inv ? ttRow("Invånare", fmt(inv)) : "") +
        (dag ? ttRow("Jobb (dag)", fmt(dag)) : "");
    }

    // flode-steget: enkel ort-etikett (segmenten är huvudsaken, se nedan)
    return ttHead(o.namn, o.kommun || (o.iHalland ? "" : "utanför Halland")) +
      ttRow("Sysselsatta (natt)", fmt(o.nattbef));
  }

  function staticSegmentTooltip(fi) {
    const v     = vals[fi];
    const ref   = (feats[fi] && feats[fi].properties && feats[fi].properties.ref) || "";
    const carry = feats[fi] && feats[fi].properties && feats[fi].properties.carry_json;
    let carryHtml = "";
    if (carry && carry.top) {
      const totN = carry.tot_n || v;
      carryHtml = `<div style="margin-top:4px;border-top:1px solid rgba(0,0,0,0.07);padding-top:4px">` +
        carry.top.slice(0, 5).map(tp => {
          const pctV = totN > 0 ? Math.round(tp.n / totN * 100) : 0;
          return `<div style="display:flex;gap:8px;font-size:10.5px;color:${MUTED};line-height:1.5">` +
            `<span style="flex:1">${tp.src} → ${tp.dst}</span>` +
            `<span style="font-weight:600;color:${INK}">${fmt(tp.n)}</span>` +
            `<span style="min-width:30px;text-align:right">${pctV} %</span></div>`;
        }).join("") +
        (carry.tot_par > 5 ? `<div style="font-size:10px;color:${MUTED};margin-top:2px">…och ${carry.tot_par - 5} fler par</div>` : "") +
        `</div>`;
    }
    return ttHead(ref || "Vägsegment", "Ackumulerat pendlingsflöde") +
      ttRow("Pendlare per dygn", fmt(v)) + carryHtml;
  }

  if (STATIC) d3.select(hoverLayer.canvas)
    .on("mousemove", function(event) {
      const [sx, sy] = d3.pointer(event);
      const [mx, my] = currentTransform.invert([sx, sy]);

      // I flöde-steget är vägsegmenten huvudsaken — pröva dem först
      if (stage === "flode") {
        const ort = ortQuadtree.find(mx, my, 11 / currentTransform.k);
        if (ort) { showTooltip(sx, sy, staticOrtTooltip(ort)); return; }
        const hit = segQuadtree.find(mx, my, 8 / currentTransform.k);
        if (hit && vals[hit.fi] >= MIN_FLOW) { showTooltip(sx, sy, staticSegmentTooltip(hit.fi)); return; }
        hideTooltip();
        return;
      }

      const o = ortQuadtree.find(mx, my, 14 / currentTransform.k);
      if (o) showTooltip(sx, sy, staticOrtTooltip(o));
      else hideTooltip();
    })
    .on("mouseleave", function() { hideTooltip(); });

  // ---------- Klick och hover på kartan
  if (!STATIC) d3.select(hoverLayer.canvas)
    .on("click", function(event) {
      const [mx, my] = currentTransform.invert(d3.pointer(event));

      // Kolla om vi klickade på en ort
      const clickedOrt = ortQuadtree.find(mx, my, 12 / currentTransform.k);

      // I fokus-ort-läge: klick på annan ort → byt fokus, klick utanför → avsluta
      if (focusOrtLocked) {
        if (clickedOrt && clickedOrt.community !== focusOrt) {
          // Byt till ny ort
          focusOrt = clickedOrt.community;
          buildFocusRoutes(focusOrt);
          hideTooltip();
          renderPanel();
          // Highlighta rätt knapp i panelen
          panel.querySelectorAll(".focus-ort-btn").forEach(b => {
            const match = b.dataset.community === focusOrt;
            b.style.background = match ? ACCENT : "transparent";
            b.style.fontWeight = match ? "600" : "400";
            b.style.borderColor = match ? ACCENT : "rgba(0,73,144,0.15)";
          });
          renderFocusOrtDetail(selectedZone, focusOrt);
          drawAll();
        } else {
          // Klick utanför → avsluta fokus-ort
          focusOrt = null;
          focusOrtLocked = false;
          focusRoutes = null;
          segToPartner = null;
          highlightPartner = null;
          hideTooltip();
          renderPanel();
          drawAll();
        }
        return;
      }

      // Klick på ort → fokus-ort (fungerar i alla lägen)
      if (clickedOrt) {
        // Hitta vilken zon orten tillhör
        const ortZoneId = ortZone.get(clickedOrt.community);
        const ortZoneObj = ortZoneId ? zoneById.get(ortZoneId) : null;
        if (ortZoneObj) {
          selectedZone = ortZoneObj;
          buildZoneExtDests(selectedZone);
          focusOrt = clickedOrt.community;
          focusOrtLocked = true;
          buildFocusRoutes(focusOrt);
          hideTooltip();
          renderPanel();
          panel.querySelectorAll(".focus-ort-btn").forEach(b => {
            const match = b.dataset.community === focusOrt;
            b.style.background = match ? ACCENT : "transparent";
            b.style.fontWeight = match ? "600" : "400";
            b.style.borderColor = match ? ACCENT : "rgba(0,73,144,0.15)";
          });
          renderFocusOrtDetail(selectedZone, focusOrt);
          drawAll();
          return;
        }
      }

      // Zon-klick (hull)
      const z = zoneAtPoint(mx, my);
      if (z) {
        selectedZone = z;
        buildZoneExtDests(z);
        focusOrt = null;
        focusOrtLocked = false;
      } else {
        selectedZone = null;
        zoneExtDests = new Set();
      }
      hideTooltip();
      renderPanel();
      drawAll();
    })
    .on("mousemove", function(event) {
      const [sx, sy] = d3.pointer(event);
      const [mx, my] = currentTransform.invert([sx, sy]);

      // ---- Fokus-ort-låst: visa tooltip vid segment-hover
      if (focusOrtLocked && segToPartner) {
        const hit = segQuadtree.find(mx, my, 12 / currentTransform.k);
        if (hit) {
          const info = segToPartner.get(hit.fi);
          if (info) {
            const o = ortByComm.get(focusOrt);
            showTooltip(sx, sy, `
              <div style="font-weight:600;margin-bottom:2px">${o?.namn || ""} ↔ ${info.namn}</div>
              <div style="font-size:11px;color:${MUTED}">
                Ut: ${fmt(info.ut)} · In: ${fmt(info.inn)} · Totalt: ${fmt(info.flow)}
              </div>
            `);
            hoverLayer.canvas.style.cursor = "crosshair";
            return;
          }
        }
        // Ort-hover i fokus-läge
        const ort = ortQuadtree.find(mx, my, 12 / currentTransform.k);
        if (ort) {
          const f = fua[ort.community];
          showTooltip(sx, sy, `
            <div style="font-weight:600">${ort.namn}</div>
            <div style="font-size:11px;color:${MUTED}">
              ${ort.nattbef > 0 ? `${fmt(ort.nattbef)} sysselsatta` : ""}
            </div>
          `);
          hoverLayer.canvas.style.cursor = "crosshair";
          return;
        }
        hideTooltip();
        hoverLayer.canvas.style.cursor = "crosshair";
        return;
      }

      // ---- Zon-vald: segment + ort-hover med tooltip
      if (selectedZone && !focusOrt) {
        // Ort-hover
        const ort = ortQuadtree.find(mx, my, 10 / currentTransform.k);
        if (ort && selectedZone.memberIds.has(ort.community)) {
          const f = fua[ort.community];
          const inv = invanare[ort.community] || 0;
          showTooltip(sx, sy, `
            <div style="font-weight:600">${ort.namn}</div>
            <div style="font-size:11px;color:${MUTED}">
              ${inv > 0 ? `${fmt(inv)} invånare · ` : ""}${fmt(f?.dagbef_syss || 0)} jobb
            </div>
          `);
          hoverLayer.canvas.style.cursor = "pointer";
          return;
        }
        // Segment-hover — zonens bidrag + topp OD-par från carry_json
        const hit = segQuadtree.find(mx, my, 8 / currentTransform.k);
        if (hit) {
          const zv = selectedZone.zoneFlowByFeat.get(hit.fi) || 0;
          if (zv >= MIN_FLOW) {
            const globalV = vals[hit.fi];
            const ref = feats[hit.fi]?.properties?.ref || "";
            const carry = feats[hit.fi]?.properties?.carry_json;

            let carryHtml = "";
            if (carry && carry.top) {
              const top5 = carry.top.slice(0, 5);
              const totN = carry.tot_n || zv;
              carryHtml = `<div style="margin-top:4px;border-top:1px solid rgba(0,0,0,0.06);padding-top:4px">` +
                top5.map(t => {
                  const pctV = totN > 0 ? Math.round(t.n / totN * 100) : 0;
                  return `<div style="display:flex;gap:6px;font-size:10px;color:${MUTED}">
                    <span style="flex:1">${t.src} \u2192 ${t.dst}</span>
                    <span style="font-weight:500;color:${INK}">${fmt(t.n)}</span>
                    <span>${pctV}\u00a0%</span>
                  </div>`;
                }).join("") +
                (carry.tot_par > 5 ? `<div style="font-size:10px;color:${MUTED};margin-top:2px">...och ${carry.tot_par - 5} fler par</div>` : "") +
                `</div>`;
            }

            showTooltip(sx, sy, `
              <div style="font-weight:600">${ref || "Vägsegment"}</div>
              <div style="font-size:11px;color:${MUTED}">
                Zonens bidrag: ${fmt(zv)} pendlare
              </div>
              ${globalV > zv ? `<div style="font-size:10px;color:${MUTED}">Totalt ackumulerat: ${fmt(globalV)}</div>` : ""}
              ${carryHtml}
            `);
            hoverLayer.canvas.style.cursor = "pointer";
            return;
          }
        }
        hideTooltip();
      }

      // ---- Global vy: zon-hover + segment-hover
      if (!selectedZone) {
        const ort = ortQuadtree.find(mx, my, 10 / currentTransform.k);
        if (ort) {
          const inv = invanare[ort.community] || 0;
          const z = ortZone.get(ort.community);
          const zObj = z ? zoneById.get(z) : null;
          showTooltip(sx, sy, `
            <div style="font-weight:600">${ort.namn}</div>
            <div style="font-size:11px;color:${MUTED}">
              ${inv > 0 ? `${fmt(inv)} invånare` : ""}
              ${zObj ? ` · ${zObj.namn}s region` : ""}
            </div>
          `);
          hoverLayer.canvas.style.cursor = "pointer";
          return;
        }
        const hit = segQuadtree.find(mx, my, 8 / currentTransform.k);
        if (hit && vals[hit.fi] >= MIN_FLOW) {
          const ref = feats[hit.fi]?.properties?.ref || "";
          const carry = feats[hit.fi]?.properties?.carry_json;

          let carryHtml = "";
          if (carry && carry.top) {
            const top5 = carry.top.slice(0, 5);
            const totN = carry.tot_n || vals[hit.fi];
            carryHtml = `<div style="margin-top:4px;border-top:1px solid rgba(0,0,0,0.06);padding-top:4px">` +
              top5.map(t => {
                const pctV = totN > 0 ? Math.round(t.n / totN * 100) : 0;
                return `<div style="display:flex;gap:6px;font-size:10px;color:${MUTED}">
                  <span style="flex:1">${t.src} \u2192 ${t.dst}</span>
                  <span style="font-weight:500;color:${INK}">${fmt(t.n)}</span>
                  <span>${pctV}\u00a0%</span>
                </div>`;
              }).join("") +
              (carry.tot_par > 5 ? `<div style="font-size:10px;color:${MUTED};margin-top:2px">...och ${carry.tot_par - 5} fler par</div>` : "") +
              `</div>`;
          }

          showTooltip(sx, sy, `
            <div style="font-weight:600">${ref || "Vägsegment"}</div>
            <div style="font-size:11px;color:${MUTED}">
              Ackumulerat: ${fmt(vals[hit.fi])} pendlare
            </div>
            ${carryHtml}
          `);
          hoverLayer.canvas.style.cursor = "pointer";
          return;
        }
        hideTooltip();
      }

      // Zon-hull hover (för default-vy)
      const prevHz = hoveredZone;
      hoveredZone = !selectedZone ? zoneAtPoint(mx, my) : null;
      if (hoveredZone !== prevHz) {
        drawHulls();
      }
      hoverLayer.canvas.style.cursor = hoveredZone ? "pointer" : "grab";
      if (!hoveredZone) hideTooltip();
    })
    .on("mouseleave", function() { hideTooltip(); });

  // ---------- Rita allt
  function drawAll() {
    drawBas();
    if (stage === "orter") {
      drawOrter();
    } else if (stage === "lankar") {
      drawLinks();
      drawOrter();
      drawLabels();
    } else if (stage === "zoner") {
      drawHulls();
      drawOrter();
      drawLabels();
    } else if (stage === "flode") {
      drawFlode();
      drawOrter();
      drawLabels();
    } else {
      drawFlode();
      drawHulls();
      drawOrter();
      drawLabels();
    }
  }

  // Initial render
  if (!STATIC) renderPanel();
  drawAll();

  return container;
}
