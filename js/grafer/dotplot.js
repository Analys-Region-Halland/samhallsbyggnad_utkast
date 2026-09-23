// =============================================================================
// DOTPLOT — Punkter rakt på en horisontell linje, en rad per kategori
// =============================================================================
// Varje rad är en kategori (facet) med sin egen linje. Varje punkt är en
// observation (t.ex. ett län eller en kommun) placerad direkt på linjen
// utifrån sitt värde. Highlights lyfts fram med full opacitet och etikett.
//
// Skillnad mot beeswarm: ingen force-simulation — punkterna ligger rakt på
// linjen även om de överlappar. Icke-highlightade punkter görs halvtransparenta.
// Byggd på grafRam (ram, typsnitt, tooltip).

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { skapaRam, TYP, FARG, STORLEK, xTitel, skapaTooltip, tooltipHtml, autoFmt, ritbredd, arSmal } from "../lib/grafRam.js";

export function dotplot(data, {
  value = "värde",
  label = "namn",
  facet = "kategori",
  width = null,
  rowHeight = 64,
  marginLeft = 130,     // plats för facet-etiketterna till vänster
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  highlight = null,
  highlightColor = "#00AB60",
  secondaryHighlight = null,
  secondaryColor = "#004990",
  mutedColor = "#a09d98",
  radius = 3.5,
  highlightRadius = 6,
  sort = null,
  formatValue = null,           // null = autoFmt (samma antal decimaler på alla värden)
  domain = null,
  ticks = 5,
  altText = null,
  info = null,
  logo = null
} = {}) {
  if (!formatValue) formatValue = autoFmt(data.map(d => d[value]));

  const autoWidth = width || ritbredd(780);
  const marginRight = 40;
  const marginTop = 10;
  const xAxisHeight = 30;
  const bottomPadding = 14;

  // ── Facet-layout ──
  const facetGroups = d3.group(data, d => d[facet]);
  const facetNames = [...facetGroups.keys()];
  if (Array.isArray(sort)) {
    const order = new Map(sort.map((n, i) => [n, i]));
    facetNames.sort((a, b) => {
      const ia = order.has(a) ? order.get(a) : Infinity;
      const ib = order.has(b) ? order.get(b) : Infinity;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b, "sv");
    });
  } else if (sort === "alpha") {
    facetNames.sort((a, b) => a.localeCompare(b, "sv"));
  }

  let currentY = marginTop + xAxisHeight;
  const facetLayout = [];
  for (const name of facetNames) {
    facetLayout.push({ name, y: currentY, centerY: currentY + rowHeight / 2, rows: facetGroups.get(name) });
    currentY += rowHeight;
  }
  const totalHeight = currentY + bottomPadding + (xLabel ? 18 : 0);

  // ── X-skala ──
  const rawExtent = domain || d3.extent(data, d => d[value]);
  const spread = rawExtent[1] - rawExtent[0];
  const pad = Math.max(spread * 0.05, 0.5);
  const xScale = d3.scaleLinear()
    .domain([rawExtent[0] - pad, rawExtent[1] + pad])
    .range([marginLeft, autoWidth - marginRight]);
  // Smal skärm: glesare ticks, minst ~56 px mellan etiketterna
  let tickValues = xScale.ticks(arSmal(autoWidth) ? Math.min(ticks, 3) : ticks);
  while (tickValues.length > 2 && Math.abs(xScale(tickValues[1]) - xScale(tickValues[0])) < 56)
    tickValues = tickValues.filter((_, i) => i % 2 === 0);

  // ── Ram ──
  const ram = skapaRam({ title, subtitle, caption });
  const container = ram.container;
  const svg = ram.svg(autoWidth, totalHeight);
  const tooltip = skapaTooltip(ram.body);

  // ── X-axel (högst upp) + gridlinjer ──
  const xAxisY = marginTop + xAxisHeight - 4;
  const bottomRowY = facetLayout[facetLayout.length - 1].centerY;
  tickValues.forEach(tv => {
    const tx = xScale(tv);
    svg.append("line")
      .attr("x1", tx).attr("x2", tx).attr("y1", xAxisY).attr("y2", bottomRowY)
      .attr("stroke", FARG.grid).attr("stroke-width", 0.8).attr("stroke-dasharray", "4,4");
    svg.append("text")
      .attr("x", tx).attr("y", marginTop + 12).attr("text-anchor", "middle")
      .attr("font-family", TYP.ui).attr("font-size", STORLEK.tick).attr("fill", FARG.text)
      .style("font-variant-numeric", "tabular-nums")
      .text(formatValue(tv));
  });

  // ── Rader ──
  const hlSet = new Set(highlight || []);
  const secSet = new Set(secondaryHighlight || []);
  const visaTip = (event, rubrik, namn, varde, farg) => {
    const b = ram.body.node().getBoundingClientRect();
    tooltip.visa(tooltipHtml(rubrik, [{ namn, varde, farg }]), { x: event.clientX - b.left, y: event.clientY - b.top });
  };

  for (const fl of facetLayout) {
    svg.append("text")
      .attr("x", marginLeft - 14).attr("y", fl.centerY).attr("dy", "0.35em").attr("text-anchor", "end")
      .attr("font-family", TYP.ui).attr("font-size", 13).attr("font-weight", 600).attr("fill", FARG.ink)
      .text(fl.name);

    svg.append("line")
      .attr("x1", marginLeft).attr("x2", autoWidth - marginRight).attr("y1", fl.centerY).attr("y2", fl.centerY)
      .attr("stroke", FARG.noll).attr("stroke-width", 1);

    tickValues.forEach(tv => {
      const tx = xScale(tv);
      svg.append("line")
        .attr("x1", tx).attr("x2", tx).attr("y1", fl.centerY - 3).attr("y2", fl.centerY + 3)
        .attr("stroke", FARG.noll).attr("stroke-width", 1);
    });

    // 1) ordinära punkter
    for (const d of fl.rows) {
      const lbl = d[label];
      if (hlSet.has(lbl) || secSet.has(lbl)) continue;
      const cx = xScale(d[value]);
      svg.append("circle")
        .datum(d)
        .attr("cx", cx).attr("cy", fl.centerY).attr("r", radius)
        .attr("fill", mutedColor).attr("fill-opacity", 0.55)
        .attr("stroke", "#fff").attr("stroke-width", 0.8)
        .style("cursor", "pointer")
        .on("mouseenter", function (event) {
          d3.select(this).attr("r", radius + 2).attr("fill", "#555").attr("fill-opacity", 1);
          visaTip(event, fl.name, lbl, formatValue(d[value]), "#555");
        })
        .on("mousemove", function (event) { visaTip(event, fl.name, lbl, formatValue(d[value]), "#555"); })
        .on("mouseleave", function () {
          d3.select(this).attr("r", radius).attr("fill", mutedColor).attr("fill-opacity", 0.55);
          tooltip.dolj();
        });
    }

    // 2) sekundära highlights (etikett under linjen)
    for (const d of fl.rows) {
      const lbl = d[label];
      if (!secSet.has(lbl)) continue;
      const cx = xScale(d[value]);
      svg.append("circle")
        .attr("cx", cx).attr("cy", fl.centerY).attr("r", highlightRadius)
        .attr("fill", secondaryColor).attr("stroke", "#fff").attr("stroke-width", 1.5);
      svg.append("text")
        .attr("x", cx).attr("y", fl.centerY + highlightRadius + 13).attr("text-anchor", "middle")
        .attr("font-family", TYP.ui).attr("font-size", 11).attr("font-weight", 600).attr("fill", secondaryColor)
        .text(`${lbl} ${formatValue(d[value])}`);
    }

    // 3) primär highlight (etikett ovanför linjen)
    for (const d of fl.rows) {
      const lbl = d[label];
      if (!hlSet.has(lbl)) continue;
      const cx = xScale(d[value]);
      svg.append("circle")
        .attr("cx", cx).attr("cy", fl.centerY).attr("r", highlightRadius)
        .attr("fill", highlightColor).attr("stroke", "#fff").attr("stroke-width", 1.5);
      svg.append("text")
        .attr("x", cx).attr("y", fl.centerY - highlightRadius - 5).attr("text-anchor", "middle")
        .attr("font-family", TYP.ui).attr("font-size", 11).attr("font-weight", 600).attr("fill", highlightColor)
        .text(`${lbl} ${formatValue(d[value])}`);
    }
  }

  if (xLabel) xTitel(svg, { x: marginLeft + (autoWidth - marginLeft - marginRight) / 2, y: totalHeight - 4, text: xLabel });

  addExportButton(container, svg.node(), { title, subtitle, caption, width: autoWidth, height: totalHeight, altText, info, logo });

  return container.node();
}
