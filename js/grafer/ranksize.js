// =============================================================================
// RANK-SIZE — kumulativ befolkningsandel för de N största tätorterna per region.
// Byggd på den gemensamma ramen (js/lib/grafRam.js).
// Anrop:  rankSize(data, { highlight, title, subtitle, caption })  → DOM-nod
// Data: [{ region, rank, tatort, befolkning, kum_andel }]
// =============================================================================
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createFilterState, createSelectorPanel } from "../lib/filterUtils.js";
import { addExportButton } from "../lib/exportSvg.js";
import {
  skapaRam, TYP, FARG, STORLEK, SERIEFARGER,
  stilYAxel, stilXAxel, ritaGrid, xTitel, yTitel, yTitelPos,
  skapaTooltip, tooltipHtml
} from "../lib/grafRam.js";

// Icke-överlappande etikettstapling
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
      if (arr[i].labelY > arr[i + 1].labelY - minSpacing) arr[i].labelY = arr[i + 1].labelY - minSpacing;
    }
  }
  for (let i = 0; i < arr.length; i++) arr[i].labelY = Math.max(top, arr[i].labelY);
  return arr;
}

export function rankSize(data, {
  highlight = ["Halland"],
  title = "Ortshierarki: kumulativ befolkningsandel",
  subtitle = "De 10 största tätorterna, andel av regionens totalbefolkning. Tätortsavgränsning 2023, befolkning 2024.",
  caption = "Källa: SCB tätorter 2023, befolkning 2024. Andel av regionens totalbefolkning.",
  yLabel = "Andel av befolkningen",
  xLabel = "Antal tätorter (störst först)",
  logo = null,
  altText = null,
  info = null
} = {}) {
  const regions = [...new Set(data.map(d => d.region))].sort();
  const grouped = d3.group(data, d => d.region);
  const filterState = createFilterState(data, { itemField: "region", highlight });

  const highlightColors = SERIEFARGER;
  const mutedColor = FARG.dampad;
  const otherColor = "#7a8b99";
  const isHighlighted = (r) => filterState.isHighlighted(r);
  function getColor(region) {
    const hl = filterState.getHighlight();
    if (!hl) return highlightColors[regions.indexOf(region) % highlightColors.length];
    const idx = hl.indexOf(region);
    if (idx < 0) return mutedColor;
    if (idx < highlightColors.length) return highlightColors[idx];
    return otherColor;
  }

  const W = 780, H = 460;
  const mt = 36, mr = 130, mb = 46, ml = 18;
  const axisLeft = ml + 34;

  const ram = skapaRam({ title, subtitle, caption });
  const container = ram.container;
  const svg = ram.svg(W, H);
  const tooltip = skapaTooltip(ram.body);

  const xScale = d3.scaleLinear().domain([1, 10]).range([axisLeft, W - mr]);
  const yScale = d3.scaleLinear().domain([0, 100]).range([H - mb, mt]);
  const yTicks = [0, 20, 40, 60, 80, 100];

  ritaGrid(svg.append("g").attr("class", "grid-lines"), { ticks: yTicks, scale: yScale, x1: axisLeft, x2: W - mr, noll: 0 });

  const yAxisG = svg.append("g").attr("class", "y-axis").attr("transform", `translate(${axisLeft},0)`)
    .call(d3.axisLeft(yScale).tickValues(yTicks).tickFormat(d => d + " %"));
  stilYAxel(yAxisG);

  const xAxisG = svg.append("g").attr("class", "x-axis").attr("transform", `translate(0,${H - mb})`)
    .call(d3.axisBottom(xScale).tickValues(d3.range(1, 11)).tickFormat(d3.format("d")).tickSize(5));
  stilXAxel(xAxisG);

  const yp = yTitelPos(ml, mt);
  yTitel(svg, { x: yp.x, y: yp.y, text: yLabel });
  xTitel(svg, { x: (axisLeft + W - mr) / 2, y: H - 8, text: xLabel });

  const line = d3.line().x(d => xScale(d.rank)).y(d => yScale(d.kum_andel));
  const linesGroup = svg.append("g").attr("class", "lines-group");
  const labelsGroup = svg.append("g").attr("class", "line-labels");

  const bgStroke = "#b9bdbb", bgWidth = 1.1, bgOpacity = 0.45;
  const resetLineStyle = () => {
    linesGroup.selectAll("path").each(function () {
      const el = d3.select(this);
      const key = el.attr("data-key");
      if (el.classed("line-highlight")) el.attr("stroke-width", 2.2).attr("stroke-opacity", 1).attr("stroke", getColor(key));
      else el.attr("stroke-width", bgWidth).attr("stroke-opacity", bgOpacity).attr("stroke", bgStroke);
    });
  };

  // Väljare i nedre raden
  const selectorCtrl = createSelectorPanel(ram.controlsLeft, {
    filterState,
    allItems: regions,
    colorScale: (r) => getColor(r),
    triggerText: "Markera",
    onUpdate: () => updateChart(),
    onItemHover: (item) => {
      const hoverColor = isHighlighted(item) ? getColor(item) : "#555";
      linesGroup.selectAll("path").each(function () {
        const el = d3.select(this);
        if (el.attr("data-key") === item) el.attr("stroke-width", 2.8).attr("stroke-opacity", 1).attr("stroke", hoverColor);
        else el.attr("stroke-opacity", 0.12);
      });
      linesGroup.selectAll("circle").each(function () {
        const el = d3.select(this);
        el.attr("fill-opacity", el.attr("data-key") === item ? 1 : 0.12);
      });
      if (!isHighlighted(item)) {
        const pts = grouped.get(item);
        if (pts) {
          const last = pts[pts.length - 1];
          labelsGroup.selectAll(".hover-label").remove();
          labelsGroup.append("circle").attr("class", "hover-label")
            .attr("cx", xScale(last.rank)).attr("cy", yScale(last.kum_andel)).attr("r", 4).attr("fill", hoverColor);
          labelsGroup.append("text").attr("class", "hover-label")
            .attr("x", xScale(last.rank) + 8).attr("y", yScale(last.kum_andel)).attr("dy", "0.35em")
            .attr("font-family", TYP.ui).attr("font-size", 11).attr("font-weight", 600)
            .attr("fill", hoverColor).text(item);
        }
      }
    },
    onItemLeave: () => {
      resetLineStyle();
      linesGroup.selectAll("circle").attr("fill-opacity", 1);
      labelsGroup.selectAll(".hover-label").remove();
    }
  });

  function updateChart() {
    linesGroup.selectAll("*").remove();
    labelsGroup.selectAll("*").remove();

    for (const [region, pts] of grouped) {
      if (isHighlighted(region)) continue;
      linesGroup.append("path").datum(pts).attr("d", line)
        .attr("class", "line-bg").attr("data-key", region)
        .attr("fill", "none").attr("stroke", bgStroke).attr("stroke-width", bgWidth).attr("stroke-opacity", bgOpacity);
    }

    const endpoints = [];
    for (const [region, pts] of grouped) {
      if (!isHighlighted(region)) continue;
      const color = getColor(region);
      linesGroup.append("path").datum(pts).attr("d", line)
        .attr("class", "line-highlight").attr("data-key", region)
        .attr("fill", "none").attr("stroke", color).attr("stroke-width", 2.2)
        .attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
      pts.forEach(d => {
        linesGroup.append("circle").attr("data-key", region)
          .attr("cx", xScale(d.rank)).attr("cy", yScale(d.kum_andel))
          .attr("r", 3).attr("fill", color).attr("stroke", "#fff").attr("stroke-width", 1.5);
      });
      const last = pts[pts.length - 1];
      endpoints.push({ key: region, xPos: xScale(last.rank), yPos: yScale(last.kum_andel), color });
    }

    if (endpoints.length > 0) {
      const placed = placeLabels(endpoints, 16, mt + 6, H - mb - 6);
      const connStart = W - mr + 6, labelX = W - mr + 14;
      for (const p of placed) {
        const fromX = p.xPos + 6;
        const bend = Math.abs(p.labelY - p.yPos) > 2;
        labelsGroup.append("path")
          .attr("d", bend
            ? `M${fromX},${p.yPos} H${connStart} L${connStart + 4},${p.labelY} H${labelX - 3}`
            : `M${fromX},${p.yPos} H${labelX - 3}`)
          .attr("fill", "none").attr("stroke", p.color).attr("stroke-width", 1).attr("stroke-opacity", 0.45);
        labelsGroup.append("text")
          .attr("x", labelX).attr("y", p.labelY).attr("dy", "0.35em")
          .attr("font-size", STORLEK.etikett).attr("font-family", TYP.ui)
          .attr("font-weight", 500).attr("fill", p.color).text(p.key);
      }
    }
    if (selectorCtrl) selectorCtrl.update();
  }

  function toggleHighlight(region) { filterState.toggle(region); updateChart(); }
  updateChart();

  // ── Crosshair och tooltip ──
  const crosshair = svg.append("line")
    .attr("y1", mt).attr("y2", H - mb)
    .attr("stroke", "#9a9f9d").attr("stroke-width", 1).attr("stroke-dasharray", "3,3")
    .style("opacity", 0).style("pointer-events", "none");
  const hoverHighlights = svg.append("g").style("pointer-events", "none");
  let lastFocusedKey = null;

  svg.append("rect")
    .attr("x", axisLeft).attr("y", mt - 16).attr("width", W - axisLeft - mr).attr("height", H - mt - mb + 32)
    .attr("fill", "transparent").style("cursor", "default")
    .on("mouseenter", () => crosshair.style("opacity", 1))
    .on("mouseleave", () => {
      crosshair.style("opacity", 0);
      hoverHighlights.selectAll("*").remove();
      tooltip.dolj();
      lastFocusedKey = null;
      resetLineStyle();
    })
    .on("click", () => { if (lastFocusedKey) toggleHighlight(lastFocusedKey); })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event);
      const closestRank = Math.max(1, Math.min(10, Math.round(xScale.invert(mx))));
      const xPos = xScale(closestRank);
      crosshair.attr("x1", xPos).attr("x2", xPos);

      const allValues = [];
      for (const [region, pts] of grouped) {
        const pt = pts.find(d => d.rank === closestRank);
        if (pt) allValues.push({ key: region, tatort: pt.tatort, value: pt.kum_andel, yPos: yScale(pt.kum_andel), color: getColor(region), highlighted: isHighlighted(region) });
      }

      let focusedKey = null, focusedIsGray = false, minDist = Infinity;
      for (const v of allValues) {
        const dist = Math.abs(v.yPos - my);
        if (dist < minDist && dist < 20) { minDist = dist; focusedKey = v.key; focusedIsGray = !v.highlighted; }
      }
      lastFocusedKey = focusedKey;
      d3.select(this).style("cursor", focusedKey ? "pointer" : "default");

      linesGroup.selectAll("path").each(function () {
        const el = d3.select(this);
        const key = el.attr("data-key");
        if (!focusedKey) {
          if (el.classed("line-highlight")) el.attr("stroke-width", 2.2).attr("stroke-opacity", 1).attr("stroke", getColor(key));
          else el.attr("stroke-width", bgWidth).attr("stroke-opacity", bgOpacity).attr("stroke", bgStroke);
        } else if (key === focusedKey) {
          el.attr("stroke-width", 2.8).attr("stroke-opacity", 1).attr("stroke", focusedIsGray ? "#555" : getColor(key));
        } else if (isHighlighted(key)) {
          el.attr("stroke-width", 1.8).attr("stroke-opacity", 0.5);
        } else {
          el.attr("stroke-width", 1).attr("stroke-opacity", 0.12);
        }
      });

      const values = allValues.filter(v => v.highlighted).sort((a, b) => b.value - a.value);
      const rader = values.map(v => ({
        namn: `${v.key}: ${v.tatort}`, varde: v.value.toFixed(1) + " %", farg: v.color,
        fokus: v.key === focusedKey && !focusedIsGray
      }));
      let extra = null;
      if (focusedIsGray && focusedKey) {
        const gi = allValues.find(v => v.key === focusedKey);
        if (gi) rader.push({ namn: `${gi.key}: ${gi.tatort}`, varde: gi.value.toFixed(1) + " %", farg: "#555", dampad: true });
        extra = "Klicka för att markera";
      }
      const s = svg.node().getBoundingClientRect(), b = ram.body.node().getBoundingClientRect();
      tooltip.visa(tooltipHtml(`Rang ${closestRank}`, rader, { extra }), {
        x: s.left - b.left + xPos * (s.width / W),
        y: s.top - b.top + my * (s.height / H)
      });

      hoverHighlights.selectAll("*").remove();
      if (focusedIsGray && focusedKey) {
        const gi = allValues.find(v => v.key === focusedKey);
        if (gi) {
          hoverHighlights.append("circle").attr("cx", xPos).attr("cy", gi.yPos).attr("r", 4).attr("fill", "#555");
          const pts = grouped.get(focusedKey);
          if (pts) {
            const last = pts[pts.length - 1];
            hoverHighlights.append("circle").attr("cx", xScale(last.rank)).attr("cy", yScale(last.kum_andel)).attr("r", 4).attr("fill", "#555");
            hoverHighlights.append("text")
              .attr("x", xScale(last.rank) + 8).attr("y", yScale(last.kum_andel)).attr("dy", "0.35em")
              .attr("font-family", TYP.ui).attr("font-size", 11).attr("font-weight", 600).attr("fill", "#555").text(focusedKey);
          }
        }
      }
      for (const v of values) {
        const isFocused = v.key === focusedKey && !focusedIsGray;
        hoverHighlights.append("circle").attr("cx", xPos).attr("cy", v.yPos)
          .attr("r", isFocused ? 5 : 3.5).attr("fill", v.color).attr("stroke", "#fff").attr("stroke-width", 1.5);
      }
    });

  addExportButton(container, svg.node(), { title, subtitle, caption, width: W, height: H, altText, info, logo });

  return container.node();
}
