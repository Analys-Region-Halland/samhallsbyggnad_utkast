// =============================================================================
// FACET-STAPLAR — sammanhållna små multiplar (en panel per facet, delad x-skala)
// =============================================================================
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";

export function facetStaplar(data, {
  facet = "facet",
  x = "kategori",
  y = "värde",
  facetOrder = null,
  kategoriOrder = null,
  colors = ["#00664D"],
  colorByKategori = true,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  columns = 3,
  width = 860,
  rowH = 22,
  formatY = d => d.toLocaleString("sv-SE"),
  formatLabel = null,
  logo = null,
  altText = null,
  info = null
} = {}) {
  const facets = facetOrder || [...new Set(data.map(d => d[facet]))];
  const cats   = kategoriOrder || [...new Set(data.map(d => d[x]))];
  const fmtL   = formatLabel || (d => (d >= 0 ? "+" : "") + formatY(d));

  // Delad x-domän över alla paneler
  const vals = data.map(d => d[y]);
  const vmin = Math.min(0, d3.min(vals));
  const vmax = Math.max(0, d3.max(vals));

  const rows = Math.ceil(facets.length / columns);
  const labelW = 166;                 // gemensam etikettpelare (vänster i varje rad)
  const gap = 26;
  const panelW = (width - labelW - gap * (columns - 1)) / columns;
  const plotH = cats.length * rowH;
  const panelTop = 24;                // plats för paneltitel
  const panelH = panelTop + plotH;
  const axisH = 34;
  const rowGap = 26;
  const svgH = rows * (panelH + rowGap) + axisH;

  // Reservera utrymme inne i panelen (vänster) för negativa staplar + deras
  // värde-etiketter, så de inte krockar med kategorietiketterna till vänster.
  const negVals = vals.filter(v => v < 0);
  const negPad = negVals.length
    ? Math.min(64, Math.max(...negVals.map(v => String(fmtL(v)).length)) * 6 + 12)
    : 0;

  const xScale = d3.scaleLinear().domain([vmin, vmax]).nice()
    .range([negPad, panelW]);
  const yScale = d3.scaleBand().domain(cats).range([0, plotH]).padding(0.28);
  const color = (cat, i) => colorByKategori ? colors[i % colors.length] : colors[0];

  // ── Container + header ──
  const container = d3.create("div").attr("class", "graf-container").attr("data-base-width", width);
  const header = container.append("div").attr("class", "graf-header");
  if (title)    header.append("div").attr("class", "graf-title").text(title);
  if (subtitle) header.append("div").attr("class", "graf-subtitle").text(subtitle);

  const svgWrap = container.append("div").attr("class", "graf-svg-container");
  const svg = svgWrap.append("svg")
    .attr("viewBox", `0 0 ${width} ${svgH}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  const SANS = "'IBM Plex Sans', sans-serif";

  facets.forEach((f, fi) => {
    const col = fi % columns, row = Math.floor(fi / columns);
    const gx = labelW + col * (panelW + gap);
    const gy = row * (panelH + rowGap);
    const g = svg.append("g").attr("transform", `translate(${gx},${gy})`);

    // paneltitel
    g.append("text").attr("x", 0).attr("y", 15)
      .attr("font-family", SANS).attr("font-size", "13px").attr("font-weight", 700)
      .attr("fill", "#1a1a1a").text(f);

    const plot = g.append("g").attr("transform", `translate(0,${panelTop})`);

    // nollinje
    plot.append("line")
      .attr("x1", xScale(0)).attr("x2", xScale(0)).attr("y1", 0).attr("y2", plotH)
      .attr("stroke", "#ccc").attr("stroke-width", 1).attr("stroke-dasharray", "3,2");

    // kategorietiketter — bara i vänsterkolumnen (delade per rad)
    if (col === 0) {
      cats.forEach((c, ci) => {
        g.append("text")
          .attr("x", -10).attr("y", panelTop + yScale(c) + yScale.bandwidth() / 2)
          .attr("dy", "0.35em").attr("text-anchor", "end")
          .attr("font-family", SANS).attr("font-size", "10px").attr("fill", "#555")
          .text(typeof c === "string" ? c.replace(/^\d+ /, "") : c);
      });
    }

    cats.forEach((c, ci) => {
      const rec = data.find(d => d[facet] === f && d[x] === c);
      const v = rec ? rec[y] : 0;
      const x0 = xScale(Math.min(0, v)), x1 = xScale(Math.max(0, v));
      plot.append("rect")
        .attr("x", x0).attr("y", yScale(c))
        .attr("width", Math.max(0, x1 - x0)).attr("height", yScale.bandwidth())
        .attr("fill", color(c, ci)).attr("rx", 1.5);
      // värde-etikett vid stapelns ände
      if (v !== 0) {
        plot.append("text")
          .attr("x", v >= 0 ? x1 + 4 : x0 - 4).attr("y", yScale(c) + yScale.bandwidth() / 2)
          .attr("dy", "0.35em").attr("text-anchor", v >= 0 ? "start" : "end")
          .attr("font-family", SANS).attr("font-size", "10px").attr("fill", "#888")
          .text(fmtL(v));
      }
    });

    // x-axel bara på nedersta raden i varje kolumn
    if (row === rows - 1 || fi + columns >= facets.length) {
      const ax = g.append("g").attr("transform", `translate(0,${panelTop + plotH + 6})`);
      ax.call(d3.axisBottom(xScale).ticks(3).tickFormat(formatY).tickSize(0))
        .call(s => s.select(".domain").remove())
        .call(s => s.selectAll(".tick text").attr("fill", "#888").attr("font-size", "10px").attr("font-family", SANS));
    }
  });

  if (xLabel) {
    svg.append("text").attr("x", labelW + (width - labelW) / 2).attr("y", svgH - 4)
      .attr("text-anchor", "middle").attr("class", "graf-axis-label").text(xLabel);
  }

  if (caption) container.append("div").attr("class", "graf-caption").text(caption);

  addExportButton(container, svg.node(), { title, subtitle, caption, width, height: svgH, altText, info, logo });
  return container.node();
}
