// =============================================================================
// FACET-STAPLAR — sammanhållna små multiplar (en panel per facet, delad x-skala)
// Byggd på den gemensamma ramen (js/lib/grafRam.js).
// =============================================================================
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { skapaRam, TYP, FARG, STORLEK, xTitel, axelFmt, autoFmt, ritbredd, arSmal } from "../lib/grafRam.js";

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
  width = null,
  rowH = 22,
  formatY = null,           // null = autoFmt (samma antal decimaler på alla värden)
  formatLabel = null,
  logo = null,
  altText = null,
  info = null
} = {}) {
  if (!formatY) formatY = autoFmt(data.map(d => d[y]));
  const facets = facetOrder || [...new Set(data.map(d => d[facet]))];
  const cats   = kategoriOrder || [...new Set(data.map(d => d[x]))];
  const fmtL   = formatLabel || (d => (d >= 0 ? "+" : "") + formatY(d));

  // Delad x-domän över alla paneler
  const vals = data.map(d => d[y]);
  const vmin = Math.min(0, d3.min(vals));
  const vmax = Math.max(0, d3.max(vals));

  if (!width) width = ritbredd(860);
  if (arSmal(width, 860)) columns = 1;   // smal skärm: panelerna under varandra
  const rows = Math.ceil(facets.length / columns);
  const labelW = 166;                 // gemensam etikettpelare (vänster i varje rad)
  const gap = 26;
  const panelW = (width - labelW - gap * (columns - 1)) / columns;
  const plotH = cats.length * rowH;
  const panelTop = 24;                // plats för paneltitel
  const panelH = panelTop + plotH;
  const axisH = xLabel ? 44 : 30;
  const rowGap = 26;
  const svgH = rows * (panelH + rowGap) + axisH;

  // Utrymme för negativa staplar + deras etiketter till vänster i panelen
  const negVals = vals.filter(v => v < 0);
  const negPad = negVals.length
    ? Math.min(64, Math.max(...negVals.map(v => String(fmtL(v)).length)) * 6 + 12)
    : 0;

  // ... och på samma sätt plats för etiketten efter den längsta positiva stapeln,
  // så att den inte hamnar utanför panelen (sista kolumnen klipptes annars)
  const posVals = vals.filter(v => v > 0);
  const posPad = posVals.length
    ? Math.min(52, Math.max(...posVals.map(v => String(fmtL(v)).length)) * 6 + 8)
    : 0;

  const xScale = d3.scaleLinear().domain([vmin, vmax])
    .range([negPad, panelW - posPad]);
  const yScale = d3.scaleBand().domain(cats).range([0, plotH]).padding(0.28);
  const color = (cat, i) => colorByKategori ? colors[i % colors.length] : colors[0];

  // ── Ram ──
  const ram = skapaRam({ title, subtitle, caption });
  const container = ram.container.attr("data-base-width", width);
  const svg = ram.svg(width, svgH);

  facets.forEach((f, fi) => {
    const col = fi % columns, row = Math.floor(fi / columns);
    const gx = labelW + col * (panelW + gap);
    const gy = row * (panelH + rowGap);
    const g = svg.append("g").attr("transform", `translate(${gx},${gy})`);

    // paneltitel
    g.append("text").attr("x", 0).attr("y", 15)
      .attr("font-family", TYP.ui).attr("font-size", 13).attr("font-weight", 600)
      .attr("fill", FARG.ink).text(f);

    const plot = g.append("g").attr("transform", `translate(0,${panelTop})`);

    // nollinje
    plot.append("line")
      .attr("x1", xScale(0)).attr("x2", xScale(0)).attr("y1", 0).attr("y2", plotH)
      .attr("stroke", FARG.noll).attr("stroke-width", 1);

    // kategorietiketter — bara i vänsterkolumnen (delade per rad)
    if (col === 0) {
      cats.forEach((c) => {
        g.append("text")
          .attr("x", -10).attr("y", panelTop + yScale(c) + yScale.bandwidth() / 2)
          .attr("dy", "0.35em").attr("text-anchor", "end")
          .attr("font-family", TYP.ui).attr("font-size", 11).attr("fill", FARG.text)
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
      if (v !== 0) {
        plot.append("text")
          .attr("x", v >= 0 ? x1 + 4 : x0 - 4).attr("y", yScale(c) + yScale.bandwidth() / 2)
          .attr("dy", "0.35em").attr("text-anchor", v >= 0 ? "start" : "end")
          .attr("font-family", TYP.ui).attr("font-size", 10.5).attr("fill", FARG.mjuk)
          .style("font-variant-numeric", "tabular-nums")
          .text(fmtL(v));
      }
    });

    // x-axel bara på nedersta raden i varje kolumn
    if (row === rows - 1 || fi + columns >= facets.length) {
      const ax = g.append("g").attr("transform", `translate(0,${panelTop + plotH + 6})`);
      // Glesa ut tickarna om etiketterna inte får plats i en smal panel (nollan behålls)
      let tv = xScale.ticks(3);
      const etikW = Math.max(...tv.map(t => String(formatY(t)).length)) * 6.2 + 8;
      if (tv.length > 1 && Math.abs(xScale(tv[1]) - xScale(tv[0])) < etikW) {
        const yttre = tv.filter(t => t !== 0);
        tv = [...new Set([tv.includes(0) ? 0 : tv[0], yttre[yttre.length - 1]])].sort((p, q) => p - q);
        if (tv.length > 1 && Math.abs(xScale(tv[1]) - xScale(tv[0])) < etikW) tv = [tv.includes(0) ? 0 : tv[0]];
      }
      ax.call(d3.axisBottom(xScale).tickValues(tv).tickFormat(axelFmt(formatY)).tickSize(0))
        .call(s => s.select(".domain").remove())
        .call(s => s.selectAll(".tick text")
          .attr("fill", FARG.text).attr("font-size", 10.5).attr("font-family", TYP.ui)
          .style("font-variant-numeric", "tabular-nums"));
    }
  });

  if (xLabel) xTitel(svg, { x: labelW + (width - labelW) / 2, y: svgH - 6, text: xLabel });

  addExportButton(container, svg.node(), { title, subtitle, caption, width, height: svgH, altText, info, logo });
  return container.node();
}
