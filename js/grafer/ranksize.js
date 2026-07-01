// =============================================================================
// RANK-SIZE — kumulativ befolkningsandel för de N största tätorterna per region.
// Egen D3-modul (porterad från samhallsbyggnads inbäddade createRankSizeChart).
// Anrop:  rankSize(data, { highlight, title, subtitle, caption })  → DOM-nod
// Data: [{ region, rank, tatort, befolkning, kum_andel }]
// =============================================================================
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createFilterState, createSelectorPanel } from "../lib/filterUtils.js";

// Garanterat icke-överlappande etikett-stapling (sortera, tryck nedåt för
// minSpacing, tryck upp igen om botten spills över).
function placeLabels(endpoints, minSpacing, top, bottom) {
  const arr = endpoints
    .map(ep => ({ ...ep, idealY: ep.yPos, labelY: ep.yPos }))
    .sort((a, b) => a.idealY - b.idealY);
  for (let i = 0; i < arr.length; i++) {
    let y = arr[i].idealY;
    if (i > 0) y = Math.max(y, arr[i - 1].labelY + minSpacing);
    arr[i].labelY = y;
  }
  if (arr.length && arr[arr.length - 1].labelY > bottom) {
    arr[arr.length - 1].labelY = bottom;
    for (let i = arr.length - 2; i >= 0; i--) {
      if (arr[i].labelY > arr[i + 1].labelY - minSpacing) {
        arr[i].labelY = arr[i + 1].labelY - minSpacing;
      }
    }
  }
  for (let i = 0; i < arr.length; i++) arr[i].labelY = Math.max(top, arr[i].labelY);
  return arr;
}

export function rankSize(data, {
  highlight = ["Halland"],
  title = "Ortshierarki: kumulativ befolkningsandel",
  subtitle = "De 10 största tätorterna, andel av regionens totalbefolkning. Tätortsavgränsning 2023, befolkning 2024.",
  caption = "Källa: SCB tätorter 2023, befolkning 2024. Andel av regionens totalbefolkning."
} = {}) {
  const regions = [...new Set(data.map(d => d.region))].sort();
  const grouped = d3.group(data, d => d.region);

  const filterState = createFilterState(data, { itemField: "region", highlight });

  const highlightColors = ["#00664D", "#004990", "#FF7E00", "#433C9D", "#2DB8F6", "#A51300"];
  const mutedColor = "#d0d0d0";
  const otherColor = "#7a8b99";

  const isHighlighted = (r) => filterState.isHighlighted(r);

  function getColor(region) {
    const hl = filterState.getHighlight();
    if (!hl) return highlightColors[regions.indexOf(region) % highlightColors.length];
    const idx = hl.indexOf(region);
    if (idx < 0) return mutedColor;                            // ej markerad → dämpad
    if (idx < highlightColors.length) return highlightColors[idx];  // distinkt färg per markerad
    return otherColor;                                         // bortom paletten → fallback
  }

  const W = 780, H = 460;
  const mt = 16, mr = 130, mb = 48, ml = 50;

  const container = d3.create("div")
    .attr("class", "graf-container")
    .style("position", "relative")
    .attr("data-base-width", W);

  const header = container.append("div").attr("class", "graf-header");
  header.append("div").attr("class", "graf-title").text(title);
  header.append("div").attr("class", "graf-subtitle").text(subtitle);

  const selectorCtrl = createSelectorPanel(header, {
    filterState,
    allItems: regions,
    colorScale: (r) => getColor(r),
    triggerText: "Markera ›",
    onUpdate: () => updateChart(),
    onItemHover: (item) => {
      const hoverColor = isHighlighted(item) ? getColor(item) : "#555";
      linesGroup.selectAll("path").each(function() {
        const el = d3.select(this);
        const key = el.attr("data-key");
        if (key === item) {
          el.attr("stroke-width", 2.8).attr("stroke-opacity", 1).attr("stroke", hoverColor);
        } else {
          el.attr("stroke-opacity", 0.12);
        }
      });
      linesGroup.selectAll("circle").each(function() {
        const el = d3.select(this);
        el.attr("fill-opacity", el.attr("data-key") === item ? 1 : 0.12);
      });
      if (!isHighlighted(item)) {
        const pts = grouped.get(item);
        if (pts) {
          const last = pts[pts.length - 1];
          labelsGroup.selectAll(".hover-label").remove();
          labelsGroup.append("circle")
            .attr("class", "hover-label")
            .attr("cx", xScale(last.rank)).attr("cy", yScale(last.kum_andel))
            .attr("r", 5).attr("fill", hoverColor);
          labelsGroup.append("text")
            .attr("class", "hover-label")
            .attr("x", xScale(last.rank) + 8).attr("y", yScale(last.kum_andel))
            .attr("dy", "0.35em")
            .attr("font-family", "'IBM Plex Sans', sans-serif")
            .attr("font-size", "11px").attr("font-weight", "600")
            .attr("fill", hoverColor).text(item);
        }
      }
    },
    onItemLeave: () => {
      linesGroup.selectAll("path").each(function() {
        const el = d3.select(this);
        const key = el.attr("data-key");
        if (el.classed("line-highlight")) {
          el.attr("stroke-width", 2).attr("stroke-opacity", 1).attr("stroke", getColor(key));
        } else {
          el.attr("stroke-width", 1.2).attr("stroke-opacity", 0.25).attr("stroke", "#aaa");
        }
      });
      linesGroup.selectAll("circle").attr("fill-opacity", 1);
      labelsGroup.selectAll(".hover-label").remove();
    }
  });

  if (!document.getElementById("graf-tooltip-styles")) {
    const styles = document.createElement("style");
    styles.id = "graf-tooltip-styles";
    styles.textContent = `
      .graf-tooltip { position:absolute; background:#fff; font-family:'IBM Plex Sans',sans-serif; font-size:11px; pointer-events:none; z-index:1000; box-shadow:0 2px 8px rgba(0,0,0,0.12),0 8px 24px rgba(0,0,0,0.08); border:1px solid #1a1a1a; min-width:140px; overflow:hidden; }
      .graf-tooltip-year { font-size:12px; font-weight:700; color:#fff; background:#1a1a1a; padding:6px 10px; letter-spacing:0.02em; }
      .graf-tooltip-list { display:flex; flex-direction:column; }
      .graf-tooltip-row { display:flex; align-items:center; gap:8px; padding:5px 10px; line-height:1.3; }
      .graf-tooltip-row:nth-child(odd) { background:#f8f8f8; }
      .graf-tooltip-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
      .graf-tooltip-name { color:#444; flex:1; }
      .graf-tooltip-val { font-weight:600; font-variant-numeric:tabular-nums; color:#1a1a1a; }
      .graf-tooltip-row.focused { background:#e8f4ec !important; }
      .graf-tooltip-row.focused .graf-tooltip-name { font-weight:600; color:#1a1a1a; }
      .graf-tooltip-preview { display:flex; align-items:center; gap:8px; padding:6px 10px; margin-top:1px; border-top:1px dashed #ddd; background:#f5f5f5; font-style:italic; line-height:1.3; }
      .graf-tooltip-add { font-size:9px; color:#888; margin-left:auto; }
    `;
    document.head.appendChild(styles);
  }

  const tooltip = container.append("div").attr("class", "graf-tooltip").style("display", "none");

  const svgContainer = container.append("div").attr("class", "graf-svg-container");
  const svg = svgContainer.append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  const xScale = d3.scaleLinear().domain([1, 10]).range([ml, W - mr]);
  const yScale = d3.scaleLinear().domain([0, 100]).range([H - mb, mt]);

  const yTicks = [0, 20, 40, 60, 80, 100];
  svg.append("g")
    .attr("transform", `translate(${ml},0)`)
    .call(d3.axisLeft(yScale).tickValues(yTicks).tickFormat(d => d + "%"))
    .call(g => g.select(".domain").remove())
    .call(g => g.selectAll(".tick line").remove())
    .call(g => g.selectAll(".tick text")
      .attr("x", -8).attr("text-anchor", "end")
      .attr("fill", "#666").style("font-size", "12px")
      .style("font-family", "'IBM Plex Sans', sans-serif"));

  yTicks.forEach(v => {
    if (v === 0) return;
    svg.append("line")
      .attr("x1", ml).attr("x2", W - mr)
      .attr("y1", yScale(v)).attr("y2", yScale(v))
      .attr("stroke", "#e0e0e0").attr("stroke-dasharray", "12,6");
  });

  svg.append("g")
    .attr("transform", `translate(0,${H - mb})`)
    .call(d3.axisBottom(xScale).tickValues(d3.range(1, 11)).tickFormat(d3.format("d")))
    .call(g => g.select(".domain").attr("stroke", "#1a1a1a"))
    .call(g => g.selectAll(".tick line").attr("stroke", "#1a1a1a"))
    .call(g => g.selectAll(".tick text").attr("fill", "#1a1a1a").style("font-size", "13px")
      .style("font-family", "'IBM Plex Sans', sans-serif"));

  svg.append("text")
    .attr("x", (ml + W - mr) / 2).attr("y", H - 8)
    .attr("text-anchor", "middle").attr("fill", "#555")
    .style("font-family", "'IBM Plex Sans', sans-serif").style("font-size", "12px")
    .text("Antal tätorter (störst först)");

  const line = d3.line().x(d => xScale(d.rank)).y(d => yScale(d.kum_andel));

  const linesGroup = svg.append("g").attr("class", "lines-group");
  const labelsGroup = svg.append("g").attr("class", "line-labels");

  function updateChart() {
    linesGroup.selectAll("*").remove();
    labelsGroup.selectAll("*").remove();

    for (const [region, pts] of grouped) {
      if (isHighlighted(region)) continue;
      linesGroup.append("path")
        .datum(pts).attr("d", line)
        .attr("class", "line-bg").attr("data-key", region)
        .attr("fill", "none").attr("stroke", "#aaa")
        .attr("stroke-width", 1.2).attr("stroke-opacity", 0.25);
    }

    const highlightedEndpoints = [];

    for (const [region, pts] of grouped) {
      if (!isHighlighted(region)) continue;
      const color = getColor(region);

      linesGroup.append("path")
        .datum(pts).attr("d", line)
        .attr("class", "line-highlight").attr("data-key", region)
        .attr("fill", "none").attr("stroke", color).attr("stroke-width", 2);

      pts.forEach(d => {
        linesGroup.append("circle")
          .attr("data-key", region)
          .attr("cx", xScale(d.rank)).attr("cy", yScale(d.kum_andel))
          .attr("r", 3).attr("fill", color)
          .attr("stroke", "#fff").attr("stroke-width", 1.5);
      });

      const last = pts[pts.length - 1];
      highlightedEndpoints.push({ key: region, xPos: xScale(last.rank), yPos: yScale(last.kum_andel), color });
    }

    if (highlightedEndpoints.length > 0) {
      const minSpacing = 18;
      const chartTop = mt + 8, chartBottom = H - mb - 8;

      const lp = placeLabels(highlightedEndpoints, minSpacing, chartTop, chartBottom);

      const connX = W - mr + 8, labelX = W - mr + 14;

      for (const p of lp) {
        const endX = p.xPos + 7;
        const diagonal = Math.abs(p.labelY - p.yPos) > 3;

        if (diagonal) {
          labelsGroup.append("path")
            .attr("d", `M ${endX} ${p.yPos} L ${connX - 6} ${p.yPos} L ${connX} ${p.labelY} L ${labelX - 4} ${p.labelY}`)
            .attr("fill", "none").attr("stroke", p.color)
            .attr("stroke-width", 1).attr("stroke-opacity", 0.35);
        } else {
          labelsGroup.append("line")
            .attr("x1", endX).attr("y1", p.yPos)
            .attr("x2", labelX - 4).attr("y2", p.labelY)
            .attr("stroke", p.color).attr("stroke-width", 1).attr("stroke-opacity", 0.35);
        }

        labelsGroup.append("text")
          .attr("x", labelX).attr("y", p.labelY).attr("dy", "0.35em")
          .attr("font-size", "12px")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-weight", 500).attr("fill", p.color)
          .text(p.key);
      }
    }

    if (selectorCtrl) selectorCtrl.update();
  }

  function toggleHighlight(region) { filterState.toggle(region); updateChart(); }

  updateChart();

  const crosshair = svg.append("line")
    .attr("y1", mt).attr("y2", H - mb)
    .attr("stroke", "#bbb").attr("stroke-width", 1).attr("stroke-dasharray", "4,3")
    .style("opacity", 0).style("pointer-events", "none");

  const hoverHighlights = svg.append("g").style("pointer-events", "none");
  let lastFocusedKey = null;

  const overlay = svg.append("rect")
    .attr("x", ml).attr("y", mt - 20)
    .attr("width", W - ml - mr).attr("height", H - mt - mb + 40)
    .attr("fill", "transparent").style("cursor", "default");

  overlay
    .on("mouseenter", () => { crosshair.style("opacity", 1); tooltip.style("display", "block"); })
    .on("mouseleave", () => {
      crosshair.style("opacity", 0);
      hoverHighlights.selectAll("*").remove();
      tooltip.style("display", "none");
      lastFocusedKey = null;
      linesGroup.selectAll("path").each(function() {
        const el = d3.select(this);
        const key = el.attr("data-key");
        if (el.classed("line-highlight")) {
          el.attr("stroke-width", 2).attr("stroke-opacity", 1).attr("stroke", getColor(key));
        } else {
          el.attr("stroke-width", 1.2).attr("stroke-opacity", 0.25).attr("stroke", "#aaa");
        }
      });
    })
    .on("click", () => { if (lastFocusedKey) toggleHighlight(lastFocusedKey); })
    .on("mousemove", function(event) {
      const [mx, my] = d3.pointer(event);
      const closestRank = Math.max(1, Math.min(10, Math.round(xScale.invert(mx))));
      const xPos = xScale(closestRank);
      crosshair.attr("x1", xPos).attr("x2", xPos);

      const allValues = [];
      for (const [region, pts] of grouped) {
        const pt = pts.find(d => d.rank === closestRank);
        if (pt) {
          allValues.push({
            key: region, tatort: pt.tatort, value: pt.kum_andel, befolkning: pt.befolkning,
            yPos: yScale(pt.kum_andel), color: getColor(region), highlighted: isHighlighted(region)
          });
        }
      }

      const maxFocusDist = 20;
      let focusedKey = null, focusedIsGray = false, minDist = Infinity;
      for (const v of allValues) {
        const dist = Math.abs(v.yPos - my);
        if (dist < minDist && dist < maxFocusDist) { minDist = dist; focusedKey = v.key; focusedIsGray = !v.highlighted; }
      }
      lastFocusedKey = focusedKey;
      d3.select(this).style("cursor", focusedKey ? "pointer" : "default");

      linesGroup.selectAll("path").each(function() {
        const el = d3.select(this);
        const key = el.attr("data-key");
        if (!focusedKey) {
          if (el.classed("line-highlight")) {
            el.attr("stroke-width", 2).attr("stroke-opacity", 1).attr("stroke", getColor(key));
          } else {
            el.attr("stroke-width", 1.2).attr("stroke-opacity", 0.25).attr("stroke", "#aaa");
          }
        } else if (key === focusedKey) {
          el.attr("stroke-width", 2.8).attr("stroke-opacity", 1).attr("stroke", focusedIsGray ? "#555" : getColor(key));
        } else if (isHighlighted(key)) {
          el.attr("stroke-width", 1.8).attr("stroke-opacity", 0.5);
        } else {
          el.attr("stroke-width", 1).attr("stroke-opacity", 0.12);
        }
      });

      const values = allValues.filter(v => v.highlighted);
      values.sort((a, b) => b.value - a.value);

      let rows = values.map(v =>
        `<div class="graf-tooltip-row${v.key === focusedKey && !focusedIsGray ? " focused" : ""}">
          <span class="graf-tooltip-dot" style="background:${v.color}"></span>
          <span class="graf-tooltip-name">${v.tatort}</span>
          <span class="graf-tooltip-val">${v.value.toFixed(1)}%</span>
        </div>`
      ).join("");

      let previewRow = "";
      if (focusedIsGray && focusedKey) {
        const gi = allValues.find(v => v.key === focusedKey);
        if (gi) {
          previewRow = `<div class="graf-tooltip-preview">
            <span class="graf-tooltip-dot" style="background:#555"></span>
            <span class="graf-tooltip-name">${gi.key}: ${gi.tatort}</span>
            <span class="graf-tooltip-val">${gi.value.toFixed(1)}%</span>
            <span class="graf-tooltip-add">+ klicka</span>
          </div>`;
        }
      }

      tooltip.html(`
        <div class="graf-tooltip-year">Rang ${closestRank}</div>
        <div class="graf-tooltip-list">${rows}</div>
        ${previewRow}
      `);

      const svgRect = svgContainer.node().getBoundingClientRect();
      const containerRect = container.node().getBoundingClientRect();
      const tooltipRect = tooltip.node().getBoundingClientRect();

      let tooltipX = xPos * (svgRect.width / W) + svgRect.left - containerRect.left - tooltipRect.width - 15;
      let tooltipY = my * (svgRect.height / H) + svgRect.top - containerRect.top - 10;
      if (tooltipX < 10) tooltipX = xPos * (svgRect.width / W) + svgRect.left - containerRect.left + 15;
      const maxY = containerRect.height - tooltipRect.height - 10;
      tooltipY = Math.max(10, Math.min(tooltipY, maxY));
      tooltip.style("left", tooltipX + "px").style("top", tooltipY + "px");

      hoverHighlights.selectAll("*").remove();

      if (focusedIsGray && focusedKey) {
        const gi = allValues.find(v => v.key === focusedKey);
        if (gi) {
          hoverHighlights.append("circle").attr("cx", xPos).attr("cy", gi.yPos)
            .attr("r", 8).attr("fill", "none").attr("stroke", "#555").attr("stroke-width", 2).attr("stroke-opacity", 0.5);
          hoverHighlights.append("circle").attr("cx", xPos).attr("cy", gi.yPos).attr("r", 4).attr("fill", "#555");
          const pts = grouped.get(focusedKey);
          if (pts) {
            const last = pts[pts.length - 1];
            hoverHighlights.append("circle").attr("cx", xScale(last.rank)).attr("cy", yScale(last.kum_andel)).attr("r", 5).attr("fill", "#555");
            hoverHighlights.append("text")
              .attr("x", xScale(last.rank) + 8).attr("y", yScale(last.kum_andel)).attr("dy", "0.35em")
              .attr("font-family", "'IBM Plex Sans', sans-serif")
              .attr("font-size", "11px").attr("font-weight", "600").attr("fill", "#555").text(focusedKey);
          }
        }
      }

      for (const v of values) {
        const isFocused = v.key === focusedKey && !focusedIsGray;
        hoverHighlights.append("circle").attr("cx", xPos).attr("cy", v.yPos)
          .attr("r", isFocused ? 9 : 5).attr("fill", "none").attr("stroke", v.color)
          .attr("stroke-width", isFocused ? 2 : 1.5).attr("stroke-opacity", isFocused ? 0.5 : 0.3);
        hoverHighlights.append("circle").attr("cx", xPos).attr("cy", v.yPos)
          .attr("r", isFocused ? 4 : 2.5).attr("fill", v.color).attr("fill-opacity", isFocused ? 1 : 0.6);
      }
    });

  container.append("div").attr("class", "graf-caption").text(caption);

  return container.node();
}
