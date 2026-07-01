// =============================================================================
// LINJEDIAGRAM FACET — Small multiples med gemensam skala och synkad crosshair
// =============================================================================
// En rutnätsmatris av mini-linjediagram där varje ruta är en facet (t.ex. en
// kommun). Skalan delas mellan alla faceter så att nivåerna kan jämföras.
//
// Vid hover bestäms närmaste kategori i y-led. Då:
//   - en synkad crosshair ritas i alla paneler vid det året,
//   - en tooltip visar närmaste kategoris värde i samtliga geografier,
//     i fallande ordning, med den hovrade panelen markerad.
//
// Sista årets värde markeras med en punkt och en värdeetikett bredvid linjen.

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";

export function linjediagramFacet(data, {
  x = "ar",
  y = "värde",
  facet = "region",
  color = null,
  width = null,
  ncol = 3,
  facetHeight = 170,
  title = null,
  subtitle = null,
  caption = null,
  yLabel = null,
  xLabel = null,
  colors = ["#FF5F4A", "#00AB60", "#2DB8F6", "#6473D9", "#FFD939", "#895B42"],
  formatY = d => d.toLocaleString("sv-SE"),
  formatX = d => d3.format("d")(d),
  sort = null,
  yMin = 0,
  curve = d3.curveMonotoneX,
  showGrid = true,
  interactive = true,
  endLabels = true,
  endLabelText = null,  // null = formatY(value); funktion (cv, value) => string för custom etiketter
  lineStyle = null,     // null = default; funktion (cv) => {strokeWidth, opacity} för per-kategori-stil
  showLegend = true,    // false = dölj legendrutan, förlita sig på färgade namn i undertiteln
  altText = null,
  info = null,
  logo = null
} = {}) {

  const autoWidth = width || 820;

  // ==========================================================================
  // FACET-ORDNING
  // ==========================================================================
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

  const nFacets = facetNames.length;
  const nrow = Math.ceil(nFacets / ncol);

  // ==========================================================================
  // LAYOUT
  // ==========================================================================
  const legendHeight = (color && showLegend) ? 30 : 0;
  const marginTop = 10;
  const marginBottom = 4;
  const outerLeft = 8;
  const outerRight = 8;
  const gapX = 28;
  const gapY = 8;

  const yAxisWidth = 46;
  // Höger padding rymmer värdeetikett (ca "42 %" eller "100" → ~32px) med luft.
  // Bottenraden får större botten-pad (30) för att rymma x-axelns ticks/text;
  // övriga rader klarar sig på en smal baslinje (8) — så stora vita ytor
  // undviks samtidigt som plotH (och därmed y-skalan) hålls konstant.
  const facetPad = { top: 24, right: endLabels ? 48 : 14, bottom: 8, left: 12 };
  const lastRowPadBottom = 30;
  const plotH = facetHeight - facetPad.top - facetPad.bottom;

  const gridLeft = outerLeft + yAxisWidth;
  const gridWidth = autoWidth - gridLeft - outerRight;
  const cellWidth = (gridWidth - (ncol - 1) * gapX) / ncol;

  const gridTop = marginTop + legendHeight;
  // Cumulativa rad-y. Sista raden får extra utrymme för x-axel.
  const rowCellYs = [];
  let curY = gridTop;
  for (let r = 0; r < nrow; r++) {
    rowCellYs.push(curY);
    const isLast = r === nrow - 1;
    const cellH = facetPad.top + plotH + (isLast ? lastRowPadBottom : facetPad.bottom);
    curY += cellH + (isLast ? 0 : gapY);
  }
  const totalHeight = curY + marginBottom;

  // ==========================================================================
  // SKALOR (gemensamma)
  // ==========================================================================
  const xExtent = d3.extent(data, d => d[x]);
  const yExtent = d3.extent(data, d => d[y]);

  let yDomain;
  if (yMin === "auto") {
    const span = yExtent[1] - yExtent[0];
    const pad = span * 0.08 || 1;
    yDomain = [yExtent[0] - pad, yExtent[1] + pad];
  } else if (typeof yMin === "number") {
    yDomain = [yMin, yExtent[1] * 1.05];
  } else {
    yDomain = [0, yExtent[1] * 1.05];
  }

  // ==========================================================================
  // CONTAINER
  // ==========================================================================
  const colorValues = color ? [...new Set(data.map(d => d[color]))] : ["_all"];
  const colorScale = d3.scaleOrdinal().domain(colorValues).range(colors);

  // Färgkoda kategorinamn i undertiteln (inbäddad legend när showLegend=false)
  const colorizeSubtitle = (text) => {
    if (!color || !text) return null;
    let html = text, any = false;
    for (const cv of [...colorValues].sort((a, b) => String(b).length - String(a).length)) {
      const esc = String(cv).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const c = colorScale(cv);
      html = html.replace(new RegExp(esc, 'gi'), (m) => { any = true;
        return `<span style="background:${c};color:#fff;padding:2px 7px;border-radius:3px;font-weight:600;white-space:nowrap">${m}</span>`; });
    }
    return any ? html : null;
  };

  const container = d3.create("div")
    .attr("class", "graf-container")
    .style("position", "relative");

  const header = container.append("div").attr("class", "graf-header");
  if (title) header.append("div").attr("class", "graf-title").text(title);
  if (subtitle) {
    const el = header.append("div").attr("class", "graf-subtitle");
    const colored = (!showLegend) ? colorizeSubtitle(subtitle) : null;
    colored ? el.html(colored) : el.text(subtitle);
  }

  const svgContainer = container.append("div").attr("class", "graf-svg-container");
  const svg = svgContainer.append("svg")
    .attr("viewBox", `0 0 ${autoWidth} ${totalHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  const tooltip = container.append("div")
    .attr("class", "graf-tooltip")
    .style("display", "none");

  // ==========================================================================
  // FÄRGSKALA + LEGEND
  // ==========================================================================
  if (color && showLegend) {
    const legendG = svg.append("g")
      .attr("transform", `translate(${gridLeft}, ${marginTop + 8})`);

    const estimateWidth = s => s.length * 7.2;
    const lineWidth = 22;
    const labelGap = 6;
    const itemGap = 22;

    let lx = 0;
    for (const cv of colorValues) {
      const item = legendG.append("g").attr("transform", `translate(${lx}, 0)`);
      item.append("line")
        .attr("x1", 0).attr("x2", lineWidth)
        .attr("y1", 6).attr("y2", 6)
        .attr("stroke", colorScale(cv))
        .attr("stroke-width", 2.6);
      item.append("text")
        .attr("x", lineWidth + labelGap).attr("y", 6).attr("dy", "0.35em")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "12px")
        .attr("fill", "#1a1a1a")
        .text(cv);
      lx += lineWidth + labelGap + estimateWidth(cv) + itemGap;
    }
  }

  // ==========================================================================
  // FÖRBEREDA FACET-DATA
  // ==========================================================================
  const allXValues = [...new Set(data.map(d => d[x]))].sort((a, b) => a - b);
  const lastX = allXValues[allXValues.length - 1];

  const facetCells = [];

  // ==========================================================================
  // RITNINGSORDNING
  // ==========================================================================
  // Ordningen styr lager (z-order) i SVG:
  //   1) bg (gridlinjer, axlar)
  //   2) lines (faceternas linjer)
  //   3) endLabels (punkter + värdetexter vid sista året)
  //   4) titles (facet-rubriker)
  //   5) crosshair (synkad markör vid hover)
  //   6) overlay (transparenta hover-rects)
  const bgGroup = svg.append("g").attr("class", "facet-bg");
  const linesGroup = svg.append("g").attr("class", "facet-lines");
  const endLabelsGroup = svg.append("g").attr("class", "facet-end-labels");
  const titlesGroup = svg.append("g").attr("class", "facet-titles");

  // ==========================================================================
  // FACET-CELLER
  // ==========================================================================
  for (let idx = 0; idx < nFacets; idx++) {
    const name = facetNames[idx];
    const rIdx = Math.floor(idx / ncol);
    const cIdx = idx % ncol;
    const isLeftCol = cIdx === 0;
    const isLastInColumn = idx + ncol >= nFacets;

    const cellX = gridLeft + cIdx * (cellWidth + gapX);
    const cellY = rowCellYs[rIdx];

    const plotX0 = cellX + facetPad.left;
    const plotX1 = cellX + cellWidth - facetPad.right;
    const plotY0 = cellY + facetPad.top;
    const plotY1 = plotY0 + plotH;
    const plotW = plotX1 - plotX0;

    const xs = d3.scaleLinear().domain(xExtent).range([plotX0, plotX1]);
    const ys = d3.scaleLinear().domain(yDomain).range([plotY1, plotY0]);

    // Ticks: ~60 px per label
    const desiredTicks = Math.max(2, Math.min(7, Math.floor(plotW / 60)));
    const xTickVals = xs.ticks(desiredTicks);

    // --- Panel-ram (subtil men distinkt avgränsning)
    bgGroup.append("rect")
      .attr("x", plotX0).attr("y", plotY0)
      .attr("width", plotX1 - plotX0).attr("height", plotY1 - plotY0)
      .attr("fill", "#fcfcfc")
      .attr("stroke", "#d8d8d8")
      .attr("stroke-width", 1)
      .style("pointer-events", "none");

    // --- Gridlinjer (innanför ramen)
    if (showGrid) {
      ys.ticks(4).forEach(tv => {
        // Hoppa över linjer som ligger på/nära panelens överkant eller underkant
        const yPx = ys(tv);
        if (yPx <= plotY0 + 0.5 || yPx >= plotY1 - 0.5) return;
        bgGroup.append("line")
          .attr("x1", plotX0 + 1).attr("x2", plotX1 - 1)
          .attr("y1", yPx).attr("y2", yPx)
          .attr("stroke", "#ececec").attr("stroke-width", 1)
          .attr("stroke-dasharray", "3,4");
      });
    }

    // --- Y-axel (vänsterkolumn)
    if (isLeftCol) {
      const yAxisG = bgGroup.append("g").attr("transform", `translate(${plotX0}, 0)`);
      yAxisG.call(d3.axisLeft(ys).ticks(4).tickFormat(formatY))
        .call(g => g.select(".domain").remove())
        .call(g => g.selectAll(".tick line").remove())
        .call(g => g.selectAll(".tick text")
          .attr("x", -6).attr("text-anchor", "end")
          .attr("fill", "#666").attr("font-size", "11px")
          .attr("font-family", "'IBM Plex Sans', sans-serif"));
    }

    // --- X-axel (nedersta raden)
    if (isLastInColumn) {
      const xAxisG = bgGroup.append("g").attr("transform", `translate(0, ${plotY1})`);
      xAxisG.call(d3.axisBottom(xs).tickValues(xTickVals).tickFormat(formatX))
        .call(g => g.select(".domain").attr("stroke", "#1a1a1a"))
        .call(g => g.selectAll(".tick line").attr("stroke", "#1a1a1a"))
        .call(g => g.selectAll(".tick text")
          .attr("fill", "#1a1a1a").attr("font-size", "11px")
          .attr("font-family", "'IBM Plex Sans', sans-serif"));
    } else {
      bgGroup.append("line")
        .attr("x1", plotX0).attr("x2", plotX1)
        .attr("y1", plotY1).attr("y2", plotY1)
        .attr("stroke", "#d5d0c8").attr("stroke-width", 0.5);
    }

    // --- Linjer
    const rowData = facetGroups.get(name);
    const byColor = color
      ? d3.group(rowData, d => d[color])
      : new Map([["_all", rowData]]);

    const sortedByColor = new Map();
    for (const [cv, rows] of byColor) {
      const sorted = [...rows].sort((a, b) => a[x] - b[x]);
      sortedByColor.set(cv, sorted);

      const localLine = d3.line()
        .defined(d => d[y] !== null && d[y] !== undefined && !isNaN(d[y]))
        .x(d => xs(d[x]))
        .y(d => ys(d[y]))
        .curve(curve);

      const style = lineStyle ? lineStyle(cv) : {};
      linesGroup.append("path")
        .datum(sorted)
        .attr("fill", "none")
        .attr("stroke", colorScale(cv))
        .attr("stroke-width", style.strokeWidth ?? 1.9)
        .attr("stroke-opacity", style.opacity ?? 1)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("d", localLine);
    }

    // --- Värdeetiketter + punkter vid sista året
    if (endLabels) {
      // Anti-overlap: sortera kategorierna efter y-koordinat och puffa isär dem
      const endItems = [];
      for (const [cv, rows] of sortedByColor) {
        const last = rows[rows.length - 1];
        if (!last) continue;
        endItems.push({ cv, value: last[y], yPos: ys(last[y]) });
      }
      endItems.sort((a, b) => a.yPos - b.yPos);
      const minGap = 13;
      for (let i = 1; i < endItems.length; i++) {
        if (endItems[i].yPos - endItems[i - 1].yPos < minGap) {
          endItems[i].yPos = endItems[i - 1].yPos + minGap;
        }
      }

      for (const it of endItems) {
        const cx = xs(lastX);
        const cyOriginal = ys(it.value);

        endLabelsGroup.append("circle")
          .attr("cx", cx).attr("cy", cyOriginal)
          .attr("r", 3)
          .attr("fill", colorScale(it.cv))
          .attr("stroke", "#fff")
          .attr("stroke-width", 1);

        const labelText = endLabelText
          ? endLabelText(it.cv, it.value)
          : formatY(it.value);

        endLabelsGroup.append("text")
          .attr("x", cx + 6)
          .attr("y", it.yPos)
          .attr("dy", "0.32em")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "11px")
          .attr("font-weight", "600")
          .attr("fill", colorScale(it.cv))
          .text(labelText);
      }
    }

    // --- Facet-titel
    titlesGroup.append("text")
      .attr("x", plotX0).attr("y", cellY + 14)
      .attr("font-family", "'IBM Plex Sans', sans-serif")
      .attr("font-size", "13px")
      .attr("font-weight", "600")
      .attr("fill", "#1a1a1a")
      .text(name);

    facetCells.push({
      name, xs, ys, plotX0, plotX1, plotY0, plotY1,
      sortedByColor
    });
  }

  // ==========================================================================
  // SYNKAD CROSSHAIR + TOOLTIP
  // ==========================================================================
  const crosshairsG = svg.append("g")
    .attr("class", "facet-crosshairs")
    .style("pointer-events", "none");

  const bisectX = d3.bisector(d => d).left;
  function snapToX(rawX) {
    const i = bisectX(allXValues, rawX);
    if (i <= 0) return allXValues[0];
    if (i >= allXValues.length) return allXValues[allXValues.length - 1];
    const a = allXValues[i - 1];
    const b = allXValues[i];
    return (rawX - a) < (b - rawX) ? a : b;
  }

  function clearOverlay() {
    crosshairsG.selectAll("*").remove();
    tooltip.style("display", "none");
  }

  function drawCrosshair(xVal, hoverCv) {
    crosshairsG.selectAll("*").remove();
    for (const f of facetCells) {
      const cx = f.xs(xVal);

      crosshairsG.append("line")
        .attr("x1", cx).attr("x2", cx)
        .attr("y1", f.plotY0).attr("y2", f.plotY1)
        .attr("stroke", "#999").attr("stroke-width", 1)
        .attr("stroke-dasharray", "3,3");

      // Cirklar på alla kategorier — hovrad tjockare/större
      for (const [cv, rows] of f.sortedByColor) {
        const row = rows.find(r => r[x] === xVal);
        if (!row) continue;
        const isHover = cv === hoverCv;
        crosshairsG.append("circle")
          .attr("cx", cx).attr("cy", f.ys(row[y]))
          .attr("r", isHover ? 5 : 3)
          .attr("fill", colorScale(cv))
          .attr("stroke", "#fff")
          .attr("stroke-width", isHover ? 2 : 1.2)
          .attr("opacity", isHover ? 1 : 0.55);
      }
    }
  }

  function showCategoryTooltip(hoverFacet, xVal, hoverCv, event) {
    // Samla alla regioners värden för hoverCv det året
    const items = [];
    for (const f of facetCells) {
      const rows = f.sortedByColor.get(hoverCv);
      if (!rows) continue;
      const row = rows.find(r => r[x] === xVal);
      if (row) {
        items.push({
          region: f.name,
          value: row[y],
          isHovered: f.name === hoverFacet.name
        });
      }
    }
    items.sort((a, b) => b.value - a.value);

    const headerColor = colorScale(hoverCv);
    let html = `<div class="graf-tooltip-year">`
             + `<span style="color:${headerColor};font-weight:700">${hoverCv}</span>`
             + `<span style="color:#666;margin-left:8px">${formatX(xVal)}</span>`
             + `</div>`;
    html += '<div class="graf-tooltip-list">';
    for (const it of items) {
      const bgStyle = it.isHovered ? "background:#f4f4f4" : "";
      const weight = it.isHovered ? "600" : "400";
      const dotStyle = it.isHovered
        ? `background:${headerColor}`
        : `background:${headerColor};opacity:0.45`;
      html += `
        <div class="graf-tooltip-row" style="${bgStyle}">
          <span class="graf-tooltip-dot" style="${dotStyle}"></span>
          <span class="graf-tooltip-name" style="font-weight:${weight}">${it.region}</span>
          <span class="graf-tooltip-val" style="font-weight:${it.isHovered ? '700' : '500'}">${formatY(it.value)}</span>
        </div>`;
    }
    html += '</div>';
    tooltip.html(html).style("display", "block");

    const containerRect = container.node().getBoundingClientRect();
    const tipRect = tooltip.node().getBoundingClientRect();
    let tx = event.clientX - containerRect.left + 14;
    let ty = event.clientY - containerRect.top - tipRect.height / 2;
    if (tx + tipRect.width > containerRect.width - 10) {
      tx = event.clientX - containerRect.left - tipRect.width - 14;
    }
    ty = Math.max(10, Math.min(ty, containerRect.height - tipRect.height - 10));
    tooltip.style("left", tx + "px").style("top", ty + "px");
  }

  if (interactive) {
    const overlayG = svg.append("g").attr("class", "facet-overlays");
    for (const f of facetCells) {
      overlayG.append("rect")
        .attr("x", f.plotX0).attr("y", f.plotY0)
        .attr("width", f.plotX1 - f.plotX0).attr("height", f.plotY1 - f.plotY0)
        .attr("fill", "transparent")
        .style("cursor", "crosshair")
        .on("mousemove", function(event) {
          const [mx, my] = d3.pointer(event, svg.node());
          const rawX = f.xs.invert(mx);
          const xVal = snapToX(rawX);

          // Bestäm närmaste kategori i y-led vid xVal
          let nearestCv = null;
          let nearestDist = Infinity;
          for (const [cv, rows] of f.sortedByColor) {
            const row = rows.find(r => r[x] === xVal);
            if (!row) continue;
            const dist = Math.abs(f.ys(row[y]) - my);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestCv = cv;
            }
          }
          if (nearestCv == null) return;

          drawCrosshair(xVal, nearestCv);
          showCategoryTooltip(f, xVal, nearestCv, event);
        })
        .on("mouseleave", clearOverlay);
    }
  }

  // Y-label (vänster, vertikal)
  if (yLabel) {
    svg.append("text")
      .attr("transform", `translate(${outerLeft + 10}, ${gridTop + (nrow * facetHeight + (nrow - 1) * gapY) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("font-family", "'IBM Plex Sans', sans-serif")
      .attr("font-size", "11px")
      .attr("fill", "#666")
      .text(yLabel);
  }

  if (caption) container.append("div").attr("class", "graf-caption").text(caption);

  addExportButton(container, svg.node(), {
    title, subtitle, caption,
    width: autoWidth,
    height: totalHeight,
    altText, info, logo
  });

  return container.node();
}
