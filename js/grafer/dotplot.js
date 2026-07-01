// =============================================================================
// DOTPLOT — Punkter rakt på en horisontell linje, en rad per kategori
// =============================================================================
// Varje rad är en kategori (facet) med sin egen linje. Varje punkt är en
// observation (t.ex. ett län eller en kommun) placerad direkt på linjen
// utifrån sitt värde. Highlights lyfts fram med full opacitet och etikett.
//
// Skillnad mot beeswarm: ingen force-simulation — punkterna ligger rakt på
// linjen även om de överlappar. Icke-highlightade punkter görs halvtransparenta.

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";

export function dotplot(data, {
  value = "värde",
  label = "namn",
  facet = "kategori",
  width = null,
  rowHeight = 64,
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
  formatValue = d => d.toLocaleString("sv-SE"),
  domain = null,
  ticks = 5,
  altText = null,
  info = null,
  logo = null
} = {}) {

  const autoWidth = width || 780;
  const marginLeft = 130;
  const marginRight = 40;
  const marginTop = 10;
  const xAxisHeight = 30;
  const bottomPadding = 14;

  // ==========================================================================
  // FACET-LAYOUT
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

  let currentY = marginTop + xAxisHeight;
  const facetLayout = [];
  for (const name of facetNames) {
    facetLayout.push({
      name,
      y: currentY,
      centerY: currentY + rowHeight / 2,
      rows: facetGroups.get(name)
    });
    currentY += rowHeight;
  }
  const totalHeight = currentY + bottomPadding + (xLabel ? 18 : 0);

  // ==========================================================================
  // X-SKALA
  // ==========================================================================
  const rawExtent = domain || d3.extent(data, d => d[value]);
  const spread = rawExtent[1] - rawExtent[0];
  const pad = Math.max(spread * 0.05, 0.5);
  const xScale = d3.scaleLinear()
    .domain([rawExtent[0] - pad, rawExtent[1] + pad])
    .range([marginLeft, autoWidth - marginRight]);

  const tickValues = xScale.ticks(ticks);

  // ==========================================================================
  // CONTAINER + HEADER
  // ==========================================================================
  const container = d3.create("div")
    .attr("class", "graf-container")
    .style("position", "relative");

  const header = container.append("div").attr("class", "graf-header");
  if (title) header.append("div").attr("class", "graf-title").text(title);
  if (subtitle) header.append("div").attr("class", "graf-subtitle").text(subtitle);

  // Tooltip (delad CSS-klass med linjediagram)
  if (!document.getElementById("graf-tooltip-styles")) {
    const styles = document.createElement("style");
    styles.id = "graf-tooltip-styles";
    styles.textContent = `
      .graf-tooltip {
        position: absolute; background: #fff;
        font-family: 'IBM Plex Sans', sans-serif; font-size: 11px;
        pointer-events: none; z-index: 1000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08);
        border: 1px solid #1a1a1a; min-width: 140px; overflow: hidden;
      }
      .graf-tooltip-year {
        font-size: 12px; font-weight: 700; color: #fff;
        background: #1a1a1a; padding: 6px 10px; letter-spacing: 0.02em;
      }
      .graf-tooltip-list { display: flex; flex-direction: column; }
      .graf-tooltip-row {
        display: flex; align-items: center; gap: 8px;
        padding: 5px 10px; line-height: 1.3;
      }
      .graf-tooltip-row:nth-child(odd) { background: #f8f8f8; }
      .graf-tooltip-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .graf-tooltip-name { color: #444; flex: 1; }
      .graf-tooltip-val {
        font-weight: 600; font-variant-numeric: tabular-nums; color: #1a1a1a;
      }
    `;
    document.head.appendChild(styles);
  }

  const tooltip = container.append("div")
    .attr("class", "graf-tooltip")
    .style("display", "none");

  const svgContainer = container.append("div").attr("class", "graf-svg-container");
  const svg = svgContainer.append("svg")
    .attr("viewBox", `0 0 ${autoWidth} ${totalHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  // ==========================================================================
  // X-AXEL (högst upp) + GRIDLINJER
  // ==========================================================================
  const xAxisY = marginTop + xAxisHeight - 4;
  const bottomRowY = facetLayout[facetLayout.length - 1].centerY;

  tickValues.forEach(tv => {
    const tx = xScale(tv);
    svg.append("line")
      .attr("x1", tx).attr("x2", tx)
      .attr("y1", xAxisY).attr("y2", bottomRowY)
      .attr("stroke", "#eee").attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,4");

    svg.append("text")
      .attr("x", tx).attr("y", marginTop + 12)
      .attr("text-anchor", "middle")
      .attr("font-family", "'IBM Plex Sans', sans-serif")
      .attr("font-size", "12px")
      .attr("fill", "#666")
      .text(formatValue(tv));
  });

  // ==========================================================================
  // RADER
  // ==========================================================================
  const hlSet = new Set(highlight || []);
  const sec = secondaryHighlight || [];
  const secSet = new Set(sec);

  for (const fl of facetLayout) {
    // Facet-etikett vänster
    svg.append("text")
      .attr("x", marginLeft - 14)
      .attr("y", fl.centerY)
      .attr("dy", "0.35em")
      .attr("text-anchor", "end")
      .attr("font-family", "'IBM Plex Sans', sans-serif")
      .attr("font-size", "13px")
      .attr("font-weight", "600")
      .attr("fill", "#1a1a1a")
      .text(fl.name);

    // Horisontell axel-linje för raden
    svg.append("line")
      .attr("x1", marginLeft)
      .attr("x2", autoWidth - marginRight)
      .attr("y1", fl.centerY)
      .attr("y2", fl.centerY)
      .attr("stroke", "#1a1a1a")
      .attr("stroke-width", 1);

    // Tick-markeringar (små streck på radens linje)
    tickValues.forEach(tv => {
      const tx = xScale(tv);
      svg.append("line")
        .attr("x1", tx).attr("x2", tx)
        .attr("y1", fl.centerY - 3).attr("y2", fl.centerY + 3)
        .attr("stroke", "#1a1a1a").attr("stroke-width", 1);
    });

    // 1) Ordinära punkter (muted, ritas först) - med hover-interaktion
    for (const d of fl.rows) {
      const lbl = d[label];
      if (hlSet.has(lbl) || secSet.has(lbl)) continue;
      const cx = xScale(d[value]);
      svg.append("circle")
        .datum(d)
        .attr("cx", cx)
        .attr("cy", fl.centerY)
        .attr("r", radius)
        .attr("fill", mutedColor)
        .attr("fill-opacity", 0.55)
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.8)
        .style("cursor", "pointer")
        .on("mouseenter", function(event) {
          d3.select(this)
            .attr("r", radius + 2)
            .attr("fill", "#555")
            .attr("fill-opacity", 1);
          tooltip.style("display", "block")
            .html(`
              <div class="graf-tooltip-year">${fl.name}</div>
              <div class="graf-tooltip-row">
                <span class="graf-tooltip-dot" style="background:#555"></span>
                <span class="graf-tooltip-name">${lbl}</span>
                <span class="graf-tooltip-val">${formatValue(d[value])}</span>
              </div>
            `);
        })
        .on("mousemove", function(event) {
          const rect = container.node().getBoundingClientRect();
          const tipRect = tooltip.node().getBoundingClientRect();
          let tx = event.clientX - rect.left + 14;
          let ty = event.clientY - rect.top - tipRect.height - 10;
          if (tx + tipRect.width > rect.width - 10) {
            tx = event.clientX - rect.left - tipRect.width - 14;
          }
          if (ty < 10) ty = event.clientY - rect.top + 14;
          tooltip.style("left", tx + "px").style("top", ty + "px");
        })
        .on("mouseleave", function() {
          d3.select(this)
            .attr("r", radius)
            .attr("fill", mutedColor)
            .attr("fill-opacity", 0.55);
          tooltip.style("display", "none");
        });
    }

    // 2) Sekundära highlights (Riket, grå/blå, etikett under linjen)
    for (const d of fl.rows) {
      const lbl = d[label];
      if (!secSet.has(lbl)) continue;
      const cx = xScale(d[value]);
      svg.append("circle")
        .attr("cx", cx).attr("cy", fl.centerY)
        .attr("r", highlightRadius)
        .attr("fill", secondaryColor)
        .attr("stroke", "#fff").attr("stroke-width", 1.5);
      svg.append("text")
        .attr("x", cx).attr("y", fl.centerY + highlightRadius + 13)
        .attr("text-anchor", "middle")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "11px").attr("font-weight", "600")
        .attr("fill", secondaryColor)
        .text(`${lbl} ${formatValue(d[value])}`);
    }

    // 3) Primär highlight (Halland) - överst, etikett ovanför linjen
    for (const d of fl.rows) {
      const lbl = d[label];
      if (!hlSet.has(lbl)) continue;
      const cx = xScale(d[value]);
      svg.append("circle")
        .attr("cx", cx).attr("cy", fl.centerY)
        .attr("r", highlightRadius)
        .attr("fill", highlightColor)
        .attr("stroke", "#fff").attr("stroke-width", 1.5);
      svg.append("text")
        .attr("x", cx).attr("y", fl.centerY - highlightRadius - 5)
        .attr("text-anchor", "middle")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "11px").attr("font-weight", "600")
        .attr("fill", highlightColor)
        .text(`${lbl} ${formatValue(d[value])}`);
    }
  }

  // Valfri xLabel längst ned
  if (xLabel) {
    svg.append("text")
      .attr("x", marginLeft + (autoWidth - marginLeft - marginRight) / 2)
      .attr("y", totalHeight - 4)
      .attr("text-anchor", "middle")
      .attr("font-family", "'IBM Plex Sans', sans-serif")
      .attr("font-size", "11px")
      .attr("fill", "#666")
      .text(xLabel);
  }

  // Caption
  if (caption) container.append("div").attr("class", "graf-caption").text(caption);

  // Export-knapp
  addExportButton(container, svg.node(), {
    title, subtitle, caption,
    width: autoWidth,
    height: totalHeight,
    altText, info, logo
  });

  return container.node();
}
