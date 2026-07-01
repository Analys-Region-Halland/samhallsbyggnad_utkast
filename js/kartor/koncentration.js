// =============================================================================
// KONCENTRATION — Pseudo-3D spike map med slider
// =============================================================================
// Befolkningsförändring per 1 km-ruta som lodräta "spikar" med oblikt
// perspektiv. Slider filtrerar från störst minskning till störst tillväxt.

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";

export function koncentration(data, geodata, {
  width = null,
  title = null,
  subtitle = null,
  caption = null,
  logo = null
} = {}) {

  const W = width || 820;
  const yTilt   = 0.48;
  const topRoom = 200;
  const padL = 20, padR = 20, padB = 8;
  const mapW = W - padL - padR;

  // ===========================================================================
  // 1. DECODE + SORT
  // ===========================================================================
  const { origin, cellSize, n, coords, values } = data;
  const cells = new Array(n);
  for (let i = 0; i < n; i++) {
    cells[i] = {
      x: coords[i * 2] + origin[0],
      y: coords[i * 2 + 1] + origin[1],
      v: values[i]
    };
  }

  cells.sort((a, b) => a.v - b.v);
  cells.forEach((c, i) => { c.rank = i; });

  // Prefix sums (O(1) stats vid slider-drag)
  const totalGrowth  = d3.sum(cells, c => c.v > 0 ? c.v : 0);
  const totalDecline = d3.sum(cells, c => c.v < 0 ? c.v : 0);
  const pfxPos  = new Float64Array(n + 1);
  const pfxNeg  = new Float64Array(n + 1);
  const pfxPosN = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) {
    pfxPos[i + 1]  = pfxPos[i]  + (cells[i].v > 0 ? cells[i].v : 0);
    pfxNeg[i + 1]  = pfxNeg[i]  + (cells[i].v < 0 ? cells[i].v : 0);
    pfxPosN[i + 1] = pfxPosN[i] + (cells[i].v > 0 ? 1 : 0);
  }

  // ===========================================================================
  // 2. PROJECTION (SWEREF99 TM → screen, y-compressed)
  // ===========================================================================
  const kommunFC = topojson.feature(geodata, geodata.objects.kommuner);

  const baseProj = d3.geoIdentity()
    .reflectY(true)
    .fitSize([mapW, mapW * 5], kommunFC);

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

  // ===========================================================================
  // 3. SPIKE HEIGHT + COLOR
  // ===========================================================================
  const absArr = cells.map(c => Math.abs(c.v)).sort(d3.ascending);
  const p97    = d3.quantile(absArr, 0.97) || 1;
  const maxH   = topRoom - 15;

  function spikeH(v) {
    return Math.min(Math.abs(v) / p97 * maxH, maxH * 2.5);
  }

  const cPos = "#00664D";
  const cNeg = "#A51300";

  // ===========================================================================
  // 4. CONTAINER
  // ===========================================================================
  const container = d3.create("div")
    .attr("class", "graf-container")
    .style("max-width", W + "px");

  container.append("style").text(`
    .spike-info { text-align: center; padding: 6px 0 14px; }
    .spike-hero {
      font-size: 38px; font-weight: 800; line-height: 1;
      letter-spacing: -0.02em; transition: color 0.15s;
    }
    .spike-label { font-size: 13px; color: #777; margin-top: 3px; }
    .spike-detail { font-size: 12px; color: #aaa; margin-top: 3px; }
    .spike-slider-row {
      display: flex; align-items: center; gap: 10px; padding: 10px 6px 0;
    }
    .spike-slider-row input[type=range] { flex: 1; cursor: pointer; accent-color: #999; }
    .spike-end { font-size: 11px; font-weight: 600; white-space: nowrap; }
  `);

  const hdr = container.append("div").attr("class", "graf-header");
  if (title) hdr.append("div").attr("class", "graf-title").text(title);
  if (subtitle) hdr.append("div").attr("class", "graf-subtitle").text(subtitle);

  // ===========================================================================
  // 5. SVG
  // ===========================================================================
  const svg = container.append("svg")
    .attr("width", W)
    .attr("height", svgH)
    .attr("viewBox", `0 0 ${W} ${svgH}`)
    .style("display", "block");

  // Gradient background
  const gId = "spk-" + Math.random().toString(36).slice(2, 6);
  const grad = svg.append("defs").append("linearGradient")
    .attr("id", gId).attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
  grad.append("stop").attr("offset", "0%").attr("stop-color", "#fbf9f6");
  grad.append("stop").attr("offset", "100%").attr("stop-color", "#f0ece6");
  svg.append("rect").attr("width", W).attr("height", svgH)
    .attr("fill", `url(#${gId})`).attr("rx", 6);

  // Kommun fills + boundaries
  svg.append("g").selectAll("path")
    .data(kommunFC.features)
    .enter().append("path")
    .attr("d", pathGen)
    .attr("fill", "#e8e3db")
    .attr("stroke", "#d2cdc5")
    .attr("stroke-width", 0.8);

  if (geodata.objects.lan) {
    svg.append("path")
      .datum(topojson.feature(geodata, geodata.objects.lan))
      .attr("d", pathGen)
      .attr("fill", "none")
      .attr("stroke", "#b5afa5")
      .attr("stroke-width", 1.4);
  }

  // Kommun labels (drawn before spikes so spikes layer on top)
  svg.append("g").selectAll("text")
    .data(kommunFC.features)
    .enter().append("text")
    .each(function(d) {
      const c = pathGen.centroid(d);
      if (isNaN(c[0])) return;
      d3.select(this)
        .attr("x", c[0]).attr("y", c[1])
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .style("font-size", "10px")
        .style("fill", "#b5afa5")
        .style("font-weight", "500")
        .style("paint-order", "stroke")
        .style("stroke", "rgba(240,236,230,0.85)")
        .style("stroke-width", "3px")
        .style("pointer-events", "none")
        .text(d.properties.KnNamn);
    });

  // ===========================================================================
  // 6. SPIKES (painter's algorithm: northernmost first)
  // ===========================================================================
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
    .data(drawData)
    .enter().append("path")
    .attr("d", d => d.d)
    .attr("fill", d => d.color)
    .attr("fill-opacity", 0.72);

  const spikeNodes = spikes.nodes();
  const byRank = new Array(n);
  drawData.forEach((d, i) => { byRank[d.rank] = spikeNodes[i]; });

  // ===========================================================================
  // 7. SLIDER
  // ===========================================================================
  const sliderRow = container.append("div").attr("class", "spike-slider-row");

  sliderRow.append("span")
    .attr("class", "spike-end")
    .style("color", cNeg)
    .text("Alla ←");

  const slider = sliderRow.append("input")
    .attr("type", "range")
    .attr("min", 0).attr("max", n).attr("value", 0);

  sliderRow.append("span")
    .attr("class", "spike-end")
    .style("color", cPos)
    .text("→ Störst tillväxt");

  // ===========================================================================
  // 8. INFO PANEL
  // ===========================================================================
  const info = container.append("div").attr("class", "spike-info");
  const heroEl   = info.append("div").attr("class", "spike-hero");
  const labelEl  = info.append("div").attr("class", "spike-label");
  const detailEl = info.append("div").attr("class", "spike-detail");

  // ===========================================================================
  // 9. UPDATE
  // ===========================================================================
  const fmt = v => v.toLocaleString("sv-SE");
  const totalPosN = pfxPosN[n];
  let prevCutoff = 0;

  function update() {
    const cutoff = +slider.node().value;

    // Delta-toggle (snabbt: bara ändrade element)
    if (cutoff > prevCutoff) {
      for (let i = prevCutoff; i < cutoff; i++) byRank[i].style.display = "none";
    } else {
      for (let i = cutoff; i < prevCutoff; i++) byRank[i].style.display = "";
    }
    prevCutoff = cutoff;

    // O(1) stats
    const vis    = n - cutoff;
    const posSum = pfxPos[n] - pfxPos[cutoff];
    const negSum = pfxNeg[n] - pfxNeg[cutoff];
    const posN   = pfxPosN[n] - pfxPosN[cutoff];
    const pct    = totalGrowth > 0 ? Math.round(posSum / totalGrowth * 100) : 0;

    // Hero
    heroEl.textContent = pct + " %";
    heroEl.style.color = pct >= 80 ? cPos : "#333";

    // Label
    if (negSum >= 0) {
      // Bara positiva rutor synliga
      labelEl.textContent = `av all tillväxt, i ${fmt(posN)} av ${fmt(totalPosN)} tillväxtrutor`;
    } else {
      labelEl.textContent = `av all tillväxt synlig \u2014 ${fmt(vis)} rutor`;
    }

    // Detail
    const parts = [];
    if (posSum > 0) parts.push(`+${fmt(Math.round(posSum))} inv. tillväxt`);
    if (negSum < 0) parts.push(`${fmt(Math.round(negSum))} inv. minskning`);
    parts.push(`totalt +${fmt(totalGrowth)} inv.`);
    detailEl.textContent = parts.join("  \u00b7  ");
  }

  slider.on("input", update);
  update();

  // ===========================================================================
  // 10. CAPTION + LOGO
  // ===========================================================================
  if (caption) container.append("div").attr("class", "graf-caption").text(caption);
  if (logo) container.append("img").attr("class", "graf-logo").attr("src", logo).attr("alt", "");

  return container.node();
}
