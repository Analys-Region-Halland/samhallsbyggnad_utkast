// =============================================================================
// BEESWARM FACET — en svärmrad per region/facet, med filter och highlight.
// Byggd på den gemensamma ramen (js/lib/grafRam.js).
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { createFilterState, createSelectorPanel } from "../lib/filterUtils.js";
import { skapaRam, TYP, FARG, STORLEK, matText } from "../lib/grafRam.js";

export function beeswarmFacet(data, {
  value = "värde",
  label = "namn",
  facet = "region",
  size = null,
  width = null,
  rowHeight = 38,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  highlight = null,
  filter = null,
  highlightColor = "#00664D",
  mutedColor = "#a09d98",
  lineColor = "#d5d0c8",
  minRadius = 2.5,
  maxRadius = 7,
  highlightBoost = 1,
  padding = 1.2,
  logScale = true,
  showGrid = true,
  vline = null,
  sort = "median",
  formatValue = d => d.toLocaleString("sv-SE"),
  interactive = false,
  altText = null,
  info = null,
  logo = null
} = {}) {

  const autoWidth = width || 780;
  const marginRight = 45;
  const xAxisHeight = xLabel ? 46 : 30;   // plats för måttnamn ovanför axeln
  const bottomPadding = 10;

  // ── Ram ──
  const ram = skapaRam({ title, subtitle, caption });
  const container = ram.container;

  // ── Medianer, antal, sortering ──
  const facetGroups = d3.group(data, d => d[facet]);
  const facetMedians = new Map(), facetCounts = new Map(), facetMaxes = new Map();
  for (const [name, rows] of facetGroups) {
    facetMedians.set(name, d3.median(rows, d => d[value]));
    facetCounts.set(name, rows.length);
    facetMaxes.set(name, d3.max(rows, d => d[value]));
  }
  const sortedFacetNames = [...facetGroups.keys()];
  if (sort === "max") sortedFacetNames.sort((a, b) => d3.descending(facetMaxes.get(a), facetMaxes.get(b)));
  else if (sort === "median") sortedFacetNames.sort((a, b) => d3.descending(facetMedians.get(a), facetMedians.get(b)));
  else sortedFacetNames.sort((a, b) => a.localeCompare(b, "sv"));
  const allFacetNames = [...facetGroups.keys()].sort((a, b) => a.localeCompare(b, "sv"));

  // Vänstermarginal efter längsta facetnamn
  const maxNameW = Math.max(...allFacetNames.map(n => matText(String(n), { size: 12, weight: 700 })));
  const marginLeft = Math.max(90, Math.min(160, Math.round(maxNameW) + 24));

  // ── Filterstate ──
  const filterState = createFilterState(allFacetNames.map(name => ({ [facet]: name })), {
    itemField: facet, groupField: null, filter, highlight
  });
  const isHlFacet = name => filterState.isHighlighted(name);

  // ── Väljare i nedre raden ──
  let selectorCtrl = null;
  if (interactive) {
    selectorCtrl = createSelectorPanel(ram.controlsLeft, {
      filterState,
      allItems: allFacetNames,
      colorScale: () => highlightColor,
      triggerText: "Markera",
      columns: 3,
      onUpdate: () => updateChart(),
      onItemHover: (facetName) => highlightRow(facetName, true),
      onItemLeave: (facetName) => highlightRow(facetName, false)
    });
  }

  const avlasning = ram.avlasning("Peka för värden");

  // ── Facet-layout ──
  let currentY = xAxisHeight;
  const facetLayout = [];
  for (const name of sortedFacetNames) {
    facetLayout.push({ name, y: currentY, height: rowHeight, centerY: currentY + rowHeight / 2, median: facetMedians.get(name), count: facetCounts.get(name) });
    currentY += rowHeight;
  }
  const totalHeight = currentY + bottomPadding;

  const svg = ram.svg(autoWidth, totalHeight);

  // ── Skalor ──
  const valueExtent = d3.extent(data, d => d[value]);
  const hasNeg = valueExtent[0] < 0;
  const skewRatio = hasNeg ? valueExtent[1] / Math.abs(valueExtent[0]) : 0;
  const useSymlog = !logScale && hasNeg && skewRatio > 20;

  const xScale = logScale
    ? d3.scaleLog().domain([Math.max(1, valueExtent[0] * 0.75), valueExtent[1] * 1.15]).range([marginLeft, autoWidth - marginRight])
    : useSymlog
      ? d3.scaleSymlog().domain([valueExtent[0] * 1.15, valueExtent[1] * 1.05]).range([marginLeft, autoWidth - marginRight]).constant(Math.abs(valueExtent[0]) * 2)
      : d3.scaleLinear().domain([hasNeg ? valueExtent[0] * 1.15 : 0, valueExtent[1] * 1.05]).range([marginLeft, autoWidth - marginRight]);

  const sizeField = size || value;
  const radiusScale = d3.scaleSqrt().domain(d3.extent(data, d => d[sizeField])).range([minRadius, maxRadius]);

  // ── Simulering per facet ──
  for (const fl of facetLayout) {
    const rowData = data.filter(d => d[facet] === fl.name);
    const nodes = rowData.map(d => ({ ...d, x: xScale(d[value]), y: fl.centerY, r: radiusScale(d[sizeField]) }));
    const sim = d3.forceSimulation(nodes)
      .force("x", d3.forceX(d => xScale(d[value])).strength(0.95))
      .force("y", d3.forceY(fl.centerY).strength(0.7))
      .force("collide", d3.forceCollide(d => d.r + highlightBoost + padding).iterations(4))
      .stop();
    for (let i = 0; i < 200; i++) sim.tick();
    nodes.forEach(n => {
      const clampR = n.r + highlightBoost;
      n.y = Math.max(fl.y + clampR + 1, Math.min(fl.y + fl.height - clampR - 1, n.y));
    });
    fl.nodes = nodes;
    fl.rangeMinX = d3.min(nodes, n => n.x);
    fl.rangeMaxX = d3.max(nodes, n => n.x);
  }
  const allNodes = facetLayout.flatMap(fl => fl.nodes);

  // ── Statiska element ──
  const axisTickValues = logScale
    ? [5000, 10000, 50000, 100000, 500000].filter(v => v >= valueExtent[0] * 0.5 && v <= valueExtent[1] * 1.5)
    : xScale.ticks(5);

  if (showGrid) {
    const gridGroup = svg.append("g").attr("class", "grid-lines");
    axisTickValues.forEach(v => {
      const x = xScale(v);
      if (x >= marginLeft && x <= autoWidth - marginRight) {
        gridGroup.append("line")
          .attr("x1", x).attr("x2", x).attr("y1", xAxisHeight).attr("y2", totalHeight - bottomPadding)
          .attr("stroke", FARG.grid).attr("stroke-width", 0.7).attr("stroke-dasharray", "4,4");
      }
    });
  }

  if (vline !== null) {
    const vc = typeof vline === "number" ? { value: vline } : vline;
    const vlineX = xScale(vc.value);
    const vlineColor = vc.color || FARG.text;
    if (vlineX >= marginLeft && vlineX <= autoWidth - marginRight) {
      svg.append("line")
        .attr("x1", vlineX).attr("x2", vlineX).attr("y1", xAxisHeight).attr("y2", totalHeight - bottomPadding)
        .attr("stroke", vlineColor).attr("stroke-width", 1)
        .attr("stroke-dasharray", vc.dashed !== false ? "4,3" : "none").attr("stroke-opacity", 0.7);
      if (vc.label) {
        svg.append("text")
          .attr("x", vlineX).attr("y", xAxisHeight - 22).attr("text-anchor", "middle")
          .attr("font-family", TYP.ui).attr("font-size", 10.5).attr("font-weight", 500)
          .attr("fill", vlineColor).text(vc.label);
      }
    }
  }

  facetLayout.forEach((fl, i) => {
    if (i === 0) return;
    svg.append("line")
      .attr("x1", marginLeft - 8).attr("x2", autoWidth - marginRight + 8).attr("y1", fl.y).attr("y2", fl.y)
      .attr("stroke", "#e6e8e7").attr("stroke-width", 0.6);
  });

  // X-axel överst
  const tickFormat = d => d >= 1000000 ? (d / 1e6) + " mn" : d >= 1000 ? (d / 1000) + " k" : d;
  const xAxis = logScale
    ? d3.axisTop(xScale).tickValues(axisTickValues).tickFormat(tickFormat).tickSize(4)
    : d3.axisTop(xScale).ticks(5).tickFormat(tickFormat).tickSize(4);
  const xAxisG = svg.append("g").attr("class", "x-axis").attr("transform", `translate(0,${xAxisHeight})`).call(xAxis);
  xAxisG.select(".domain").attr("stroke", FARG.axel).attr("stroke-width", 1);
  xAxisG.selectAll(".tick line").attr("stroke", FARG.axel);
  xAxisG.selectAll(".tick text")
    .attr("fill", FARG.text).attr("font-size", STORLEK.tick).attr("font-family", TYP.ui)
    .style("font-variant-numeric", "tabular-nums");

  // Måttnamn horisontellt uppe till vänster (ovanför axeln)
  if (xLabel) {
    svg.append("text")
      .attr("class", "graf-ytitel")
      .attr("x", marginLeft).attr("y", 12)
      .attr("font-family", TYP.ui).attr("font-size", STORLEK.yTitel).attr("font-weight", 500)
      .attr("fill", FARG.text).text(xLabel);
  }

  // ── Dynamiska grupper ──
  const rowBgGroup = svg.append("g").attr("class", "row-bg");
  const rangeGroup = svg.append("g").attr("class", "range-lines");
  const medianGroup = svg.append("g").attr("class", "median-markers");
  const decorGroup = svg.append("g").attr("class", "row-decor");
  const labelGroup = svg.append("g").attr("class", "facet-labels");
  const countGroup = svg.append("g").attr("class", "facet-counts");
  const dotsGroup = svg.append("g").attr("class", "dots");

  let hoveredFacet = null;
  const hlTint = d3.color(highlightColor).copy({ opacity: 0.05 }).formatRgb();

  function highlightRow(facetName, show) {
    if (show) hoveredFacet = facetName;
    else if (hoveredFacet === facetName) hoveredFacet = null;
    rowBgGroup.selectAll("rect").attr("fill", d => {
      if (d.name === hoveredFacet) return "#f3f5f4";
      if (isHlFacet(d.name)) return hlTint;
      return d.zebra ? "rgba(0,0,0,0.02)" : "transparent";
    });
    labelGroup.selectAll("text")
      .attr("font-weight", function () {
        const name = d3.select(this).attr("data-facet");
        return name === hoveredFacet || isHlFacet(name) ? 700 : 400;
      })
      .attr("fill", function () {
        const name = d3.select(this).attr("data-facet");
        return name === hoveredFacet || isHlFacet(name) ? FARG.ink : FARG.mjuk;
      });
  }

  function updateChart() {
    [rowBgGroup, rangeGroup, medianGroup, decorGroup, labelGroup, countGroup, dotsGroup].forEach(g => g.selectAll("*").remove());

    rowBgGroup.selectAll("rect")
      .data(facetLayout.map((fl, i) => ({ ...fl, zebra: i % 2 === 1 })))
      .join("rect")
      .attr("x", 0).attr("y", d => d.y).attr("width", autoWidth).attr("height", d => d.height)
      .attr("fill", d => isHlFacet(d.name) ? hlTint : (d.zebra ? "rgba(0,0,0,0.02)" : "transparent"));

    for (const fl of facetLayout) {
      const isHl = isHlFacet(fl.name);
      rangeGroup.append("line")
        .attr("x1", fl.rangeMinX).attr("x2", fl.rangeMaxX).attr("y1", fl.centerY).attr("y2", fl.centerY)
        .attr("stroke", isHl ? highlightColor : lineColor).attr("stroke-width", isHl ? 1.5 : 1).attr("stroke-opacity", isHl ? 0.3 : 0.5);
    }
    for (const fl of facetLayout) {
      const isHl = isHlFacet(fl.name);
      const medianX = xScale(fl.median);
      const markerH = isHl ? 18 : 14;
      medianGroup.append("line")
        .attr("x1", medianX).attr("x2", medianX).attr("y1", fl.centerY - markerH / 2).attr("y2", fl.centerY + markerH / 2)
        .attr("stroke", isHl ? highlightColor : "#888").attr("stroke-width", isHl ? 2 : 1.5)
        .attr("stroke-opacity", isHl ? 0.8 : 0.4).attr("stroke-linecap", "round");
    }
    for (const fl of facetLayout) {
      if (!isHlFacet(fl.name)) continue;
      decorGroup.append("line")
        .attr("x1", marginLeft - 6).attr("x2", marginLeft - 6).attr("y1", fl.y + 4).attr("y2", fl.y + fl.height - 4)
        .attr("stroke", highlightColor).attr("stroke-width", 2.5).attr("stroke-linecap", "round");
    }
    for (const fl of facetLayout) {
      const isHl = isHlFacet(fl.name);
      labelGroup.append("text")
        .attr("data-facet", fl.name)
        .attr("x", marginLeft - 12).attr("y", fl.centerY)
        .attr("text-anchor", "end").attr("dominant-baseline", "central")
        .attr("font-family", TYP.ui).attr("font-size", isHl ? 12 : 11.5)
        .attr("font-weight", isHl ? 700 : 400).attr("fill", isHl ? FARG.ink : FARG.mjuk)
        .text(fl.name);
    }
    for (const fl of facetLayout) {
      countGroup.append("text")
        .attr("x", autoWidth - 6).attr("y", fl.centerY)
        .attr("text-anchor", "end").attr("dominant-baseline", "central")
        .attr("font-family", TYP.ui).attr("font-size", 9.5).attr("fill", "#b3b8b6")
        .style("font-variant-numeric", "tabular-nums")
        .text(`n=${fl.count}`);
    }
    for (const fl of facetLayout) {
      if (isHlFacet(fl.name)) continue;
      dotsGroup.selectAll(null).data(fl.nodes).join("circle")
        .attr("cx", d => d.x).attr("cy", d => d.y).attr("r", d => d.r)
        .attr("fill", mutedColor).attr("fill-opacity", 0.55)
        .attr("stroke", "#8a8680").attr("stroke-width", 0.5).attr("stroke-opacity", 0.3);
    }
    for (const fl of facetLayout) {
      if (!isHlFacet(fl.name)) continue;
      dotsGroup.selectAll(null).data(fl.nodes).join("circle")
        .attr("cx", d => d.x).attr("cy", d => d.y).attr("r", d => d.r + highlightBoost)
        .attr("fill", highlightColor).attr("stroke", "#fff").attr("stroke-width", 1.5);
    }
    if (selectorCtrl) selectorCtrl.update();
  }

  updateChart();

  // ── Hover ──
  const highlightRing = svg.append("circle")
    .attr("fill", "none").attr("stroke", FARG.ink).attr("stroke-width", 1.5)
    .style("opacity", 0).style("pointer-events", "none");

  svg.append("rect")
    .attr("x", 0).attr("y", xAxisHeight).attr("width", autoWidth).attr("height", totalHeight - xAxisHeight - bottomPadding)
    .attr("fill", "transparent").style("cursor", "default")
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event);
      const hoveredRow = facetLayout.find(fl => my >= fl.y && my < fl.y + fl.height);
      const newHoveredFacet = hoveredRow ? hoveredRow.name : null;
      if (newHoveredFacet !== hoveredFacet) {
        if (hoveredFacet) highlightRow(hoveredFacet, false);
        if (newHoveredFacet) highlightRow(newHoveredFacet, true);
      }
      let closest = null, minDist = Infinity;
      for (const node of allNodes) {
        const dist = Math.hypot(mx - node.x, my - node.y);
        if (dist < minDist) { minDist = dist; closest = node; }
      }
      if (closest && minDist < 25) {
        const isHl = isHlFacet(closest[facet]);
        const dotColor = isHl ? highlightColor : "#666";
        const r = closest.r + (isHl ? highlightBoost : 0);
        highlightRing.attr("cx", closest.x).attr("cy", closest.y).attr("r", r + 3).attr("stroke", dotColor).style("opacity", 1);
        avlasning.visa(
          `<span style="display:inline-flex;align-items:center;gap:6px">` +
          `<span style="width:8px;height:8px;border-radius:50%;background:${dotColor}"></span>` +
          `<b>${closest[label]}</b><span style="color:#d5d8d7">│</span>` +
          `<span style="color:${FARG.mjuk}">${closest[facet]}</span><span style="color:#d5d8d7">│</span>` +
          `<b>${formatValue(closest[value], closest)}</b></span>`
        );
      } else {
        highlightRing.style("opacity", 0);
        avlasning.rensa();
      }
    })
    .on("mouseleave", () => {
      if (hoveredFacet) highlightRow(hoveredFacet, false);
      highlightRing.style("opacity", 0);
      avlasning.rensa();
    });

  addExportButton(container, svg.node(), { title, subtitle, caption, width: autoWidth, height: totalHeight, altText, info, logo });

  return container.node();
}
