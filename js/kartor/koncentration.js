// =============================================================================
// KONCENTRATION — Pseudo-3D spike map med reglage
// =============================================================================
// Befolkningsförändring per 1 km-ruta som lodräta "spikar" med oblikt
// perspektiv. Reglaget i nedre raden filtrerar från störst minskning till
// störst tillväxt. Byggd på den gemensamma ramen (js/lib/grafRam.js).

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { skapaRam, TYP, FARG } from "../lib/grafRam.js";

export function koncentration(data, geodata, {
  width = null,
  title = null,
  subtitle = null,
  caption = null,
  logo = null,
  altText = null,
  info = null
} = {}) {

  const W = width || 820;
  const yTilt   = 0.48;
  const topRoom = 200;
  const padL = 20, padR = 20, padB = 8;
  const mapW = W - padL - padR;

  // ── 1. Avkoda och sortera ──
  const { origin, cellSize, n, coords, values } = data;
  const cells = new Array(n);
  for (let i = 0; i < n; i++) {
    cells[i] = { x: coords[i * 2] + origin[0], y: coords[i * 2 + 1] + origin[1], v: values[i] };
  }
  cells.sort((a, b) => a.v - b.v);
  cells.forEach((c, i) => { c.rank = i; });

  const totalGrowth  = d3.sum(cells, c => c.v > 0 ? c.v : 0);
  const pfxPos  = new Float64Array(n + 1);
  const pfxNeg  = new Float64Array(n + 1);
  const pfxPosN = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) {
    pfxPos[i + 1]  = pfxPos[i]  + (cells[i].v > 0 ? cells[i].v : 0);
    pfxNeg[i + 1]  = pfxNeg[i]  + (cells[i].v < 0 ? cells[i].v : 0);
    pfxPosN[i + 1] = pfxPosN[i] + (cells[i].v > 0 ? 1 : 0);
  }

  // ── 2. Projektion (SWEREF99 TM → skärm, y-komprimerad) ──
  const kommunFC = topojson.feature(geodata, geodata.objects.kommuner);
  const baseProj = d3.geoIdentity().reflectY(true).fitSize([mapW, mapW * 5], kommunFC);
  const pBounds = d3.geoPath(baseProj).bounds(kommunFC);
  const compH   = (pBounds[1][1] - pBounds[0][1]) * yTilt;
  const svgH    = topRoom + compH + padB;

  function project(e, northing) {
    const [px, py] = baseProj([e, northing]);
    return [px + padL, topRoom + (py - pBounds[0][1]) * yTilt];
  }
  const geoT = d3.geoTransform({
    point(x, y) { const [sx, sy] = project(x, y); this.stream.point(sx, sy); }
  });
  const pathGen = d3.geoPath(geoT);

  // ── 3. Spikhöjd och färg ──
  const absArr = cells.map(c => Math.abs(c.v)).sort(d3.ascending);
  const p97    = d3.quantile(absArr, 0.97) || 1;
  const maxH   = topRoom - 15;
  const spikeH = (v) => Math.min(Math.abs(v) / p97 * maxH, maxH * 2.5);
  const cPos = FARG.gron;
  const cNeg = "#A51300";

  // ── 4. Ram ──
  const ram = skapaRam({ title, subtitle, caption });
  const container = ram.container.style("max-width", W + "px");
  const svg = ram.svg(W, svgH);

  const gId = "spk-" + Math.random().toString(36).slice(2, 6);
  const grad = svg.append("defs").append("linearGradient")
    .attr("id", gId).attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
  grad.append("stop").attr("offset", "0%").attr("stop-color", "#fbf9f6");
  grad.append("stop").attr("offset", "100%").attr("stop-color", "#f0ece6");
  svg.append("rect").attr("width", W).attr("height", svgH).attr("fill", `url(#${gId})`).attr("rx", 6);

  svg.append("g").selectAll("path")
    .data(kommunFC.features)
    .enter().append("path")
    .attr("d", pathGen).attr("fill", "#e8e3db").attr("stroke", "#d2cdc5").attr("stroke-width", 0.8);

  if (geodata.objects.lan) {
    svg.append("path")
      .datum(topojson.feature(geodata, geodata.objects.lan))
      .attr("d", pathGen).attr("fill", "none").attr("stroke", "#b5afa5").attr("stroke-width", 1.4);
  }

  svg.append("g").selectAll("text")
    .data(kommunFC.features)
    .enter().append("text")
    .each(function (d) {
      const c = pathGen.centroid(d);
      if (isNaN(c[0])) return;
      d3.select(this)
        .attr("x", c[0]).attr("y", c[1])
        .attr("text-anchor", "middle").attr("dominant-baseline", "central")
        .attr("font-family", TYP.ui).attr("font-size", 10).attr("font-weight", 500)
        .attr("fill", "#b5afa5")
        .style("paint-order", "stroke").style("stroke", "rgba(240,236,230,0.85)").style("stroke-width", "3px")
        .style("pointer-events", "none")
        .text(d.properties.KnNamn);
    });

  // ── 5. Spikar (nordligast först) ──
  const drawData = [...cells]
    .sort((a, b) => b.y - a.y)
    .map(cell => {
      const [bx, by] = project(cell.x, cell.y);
      const h  = spikeH(cell.v);
      const hw = Math.max(0.6, Math.min(2.2, Math.abs(cell.v) / p97 * 2));
      return {
        rank: cell.rank,
        d: `M${(bx - hw).toFixed(1)},${by.toFixed(1)}L${bx.toFixed(1)},${(by - h).toFixed(1)}L${(bx + hw).toFixed(1)},${by.toFixed(1)}Z`,
        color: cell.v > 0 ? cPos : cNeg
      };
    });
  const spikes = svg.append("g").selectAll("path")
    .data(drawData).enter().append("path")
    .attr("d", d => d.d).attr("fill", d => d.color).attr("fill-opacity", 0.72);
  const spikeNodes = spikes.nodes();
  const byRank = new Array(n);
  drawData.forEach((d, i) => { byRank[d.rank] = spikeNodes[i]; });

  // ── 6. Reglage i nedre raden (samma formspråk som tidslinjen) ──
  const fmt = v => v.toLocaleString("sv-SE");
  const rad = ram.controlsRight.append("div").attr("class", "graf-reglage");
  rad.append("span").attr("class", "graf-reglage-etikett").style("color", cNeg).text("Alla");
  const slider = rad.append("input")
    .attr("type", "range").attr("min", 0).attr("max", n).attr("value", 0)
    .attr("aria-label", "Filtrera rutor efter förändring")
    .style("flex", "1").style("accent-color", "var(--graf-accent)").style("cursor", "pointer");
  rad.append("span").attr("class", "graf-reglage-etikett").style("color", cPos).text("Störst tillväxt");

  // ── 7. Avläsning (hero-siffra) i vänstra delen av nedre raden ──
  const infoEl = ram.controlsLeft.append("div").attr("class", "spike-info")
    .style("display", "flex").style("align-items", "baseline").style("gap", "10px").style("flex-wrap", "wrap");
  const heroEl = infoEl.append("span")
    .style("font-family", TYP.ui).style("font-size", "26px").style("font-weight", 700)
    .style("line-height", 1).style("letter-spacing", "-0.02em").style("font-variant-numeric", "tabular-nums");
  const labelEl = infoEl.append("span").style("font-size", "12px").style("color", FARG.text);
  const detailEl = infoEl.append("span").style("font-size", "11px").style("color", FARG.mjuk).style("flex-basis", "100%");

  const totalPosN = pfxPosN[n];
  let prevCutoff = 0;

  function update() {
    const cutoff = +slider.node().value;
    if (cutoff > prevCutoff) {
      for (let i = prevCutoff; i < cutoff; i++) byRank[i].style.display = "none";
    } else {
      for (let i = cutoff; i < prevCutoff; i++) byRank[i].style.display = "";
    }
    prevCutoff = cutoff;

    const vis    = n - cutoff;
    const posSum = pfxPos[n] - pfxPos[cutoff];
    const negSum = pfxNeg[n] - pfxNeg[cutoff];
    const posN   = pfxPosN[n] - pfxPosN[cutoff];
    const pct    = totalGrowth > 0 ? Math.round(posSum / totalGrowth * 100) : 0;

    heroEl.text(pct + " %").style("color", pct >= 80 ? cPos : FARG.ink);
    labelEl.text(negSum >= 0
      ? `av all tillväxt, i ${fmt(posN)} av ${fmt(totalPosN)} tillväxtrutor`
      : `av all tillväxt synlig, ${fmt(vis)} rutor`);
    const parts = [];
    if (posSum > 0) parts.push(`+${fmt(Math.round(posSum))} inv. tillväxt`);
    if (negSum < 0) parts.push(`${fmt(Math.round(negSum))} inv. minskning`);
    parts.push(`totalt +${fmt(totalGrowth)} inv.`);
    detailEl.text(parts.join("  ·  "));
  }

  slider.on("input", update);
  update();

  addExportButton(container, svg.node(), { title, subtitle, caption, width: W, height: svgH, altText, info, logo });

  return container.node();
}
