// =============================================================================
// SCATTERPLOT — samband, med tidsanimation (trace) och zoom (brush)
// =============================================================================
// Byggd på grafRam:
//   • året väljs i en rullgardin i nedre raden
//   • markeringsväljaren är en knapp nere till vänster
//   • y-titeln ligger horisontellt ovanför axeln, x-titeln under
//   • avläsningsrad under rubriken, enhetlig tooltip-stil i grafen

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { createFilterState, createSelectorPanel } from "../lib/filterUtils.js";
import {
  skapaRam, TYP, FARG, STORLEK,
  stilYAxel, stilXAxel, ritaGrid, xTitel, yTitel, yTitelPos, valPill
} from "../lib/grafRam.js";

// Snyggt intervall och max för axlar
function niceScale(dataMin, dataMax, targetTicks = 5) {
  if (dataMax <= dataMin) return { min: 0, max: 10, interval: 2, ticks: [0, 2, 4, 6, 8, 10] };
  const range = dataMax - dataMin;
  const roughInterval = range / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
  const normalized = roughInterval / magnitude;
  const niceInterval = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const interval = niceInterval * magnitude;
  const min = Math.floor(dataMin / interval) * interval;
  const max = Math.ceil(dataMax / interval) * interval;
  const ticks = [];
  for (let v = min; v <= max + interval * 0.001; v += interval) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min, max, interval, ticks };
}

export function scatterplot(data, {
  x = "x",
  y = "y",
  label = null,           // Fält för punkt-etiketter (t.ex. "kommun")
  time = null,            // Fält för tid (t.ex. "år") - aktiverar trace/årsval
  color = null,           // Fält för färggruppering (t.ex. "län")
  size = null,
  width = null,
  height = 500,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  yLabel = null,
  colors = ["#00664D", "#004990", "#FF7E00", "#433C9D", "#2DB8F6", "#A51300", "#8B4513", "#2F4F4F"],
  formatX = d => d.toLocaleString("sv-SE"),
  formatY = d => d.toLocaleString("sv-SE"),
  yMin = 0,               // y-axelns nedre gräns; "auto" anpassar efter data (annars 0-baslinje)
  pointRadius = 7,
  pointOpacity = 0.85,
  showGrid = true,
  altText = null,
  info = null,
  logo = null,
  interactive = false,
  filter = null,          // Begränsa valbara items (gruppnamn eller individuella)
  highlight = null,       // Förvalda highlightade labels
  xMin = "auto",          // x-axelns nedre gräns; "auto" (data*0.95), tal, eller 0 för origo
  refDiagonal = null,     // 1:1-referenslinje (y=x): true eller {label, color}
  xMax = null,            // fast övre gräns för x-axeln (annars data*1,05)
  yMax = null             // fast övre gräns för y-axeln (annars data*1,1), t.ex. 100 för andelar
} = {}) {

  // ── Layout ──
  const autoWidth = width || 780;
  const marginTop = 36;                       // plats för y-titel / zoomhint
  const marginRight = (interactive || highlight || color) ? 140 : 50;
  const marginBottom = xLabel ? 50 : 36;
  const marginLeft = 18;

  // ── Tid ──
  const allTimes = time ? [...new Set(data.map(d => d[time]))].sort((a, b) => a - b) : [];
  let currentTime = allTimes.length > 0 ? allTimes[allTimes.length - 1] : null;
  const hasTimeAnimation = time && allTimes.length > 1;
  const getDataForTime = (t) => (!time ? data : data.filter(d => d[time] === t));

  // ── Ram ──
  const ram = skapaRam({ title, subtitle, caption });
  const container = ram.container;
  const avlasning = ram.avlasning("Peka för värden");
  const svg = ram.svg(autoWidth, height);

  // ── Filter/highlight ──
  const filterState = label
    ? createFilterState(data, { itemField: label, groupField: color, filter, highlight })
    : null;
  const allLabels = label ? [...new Set(data.map(d => d[label]))] : [];
  const mutedColor = FARG.dampad;
  const isHighlighted = (lbl) => !filterState || filterState.isHighlighted(lbl);
  const colorGroups = color ? [...new Set(data.map(d => d[color]))] : ["_all"];
  const colorScale = d3.scaleOrdinal().domain(colorGroups).range(colors);
  const getPointColor = (d) => {
    const lbl = label ? d[label] : null;
    if (lbl && !isHighlighted(lbl)) return mutedColor;
    return color ? colorScale(d[color]) : colors[0];
  };

  let updateChart = null;
  let selectorPanel = null;
  if (interactive && label && filterState) {
    selectorPanel = createSelectorPanel(ram.controlsLeft, {
      filterState, allItems: allLabels, colorScale,
      triggerText: "Markera",
      onUpdate: () => updateChart(),
      onItemHover: null, onItemLeave: null
    });
  }

  // ── Skalor (globala över alla tider) ──
  const xExtent = d3.extent(data, d => d[x]);
  const yExtent = d3.extent(data, d => d[y]);
  const xLo = (xMin === "auto") ? xExtent[0] * 0.95 : (typeof xMin === "number" ? xMin : xExtent[0] * 0.95);
  const xNice = niceScale(xLo, typeof xMax === "number" ? xMax : xExtent[1] * 1.05, 5);
  const yLo = (yMin === "auto") ? yExtent[0] * 0.95 : yMin;
  const yNice = niceScale(yLo, typeof yMax === "number" ? yMax : yExtent[1] * 1.1, 5);

  const maxTickWidth = Math.max(...yNice.ticks.map(t => String(formatY(t)).length)) * 6.6 + 8;
  const axisLeft = marginLeft + maxTickWidth;
  const plotRight = autoWidth - marginRight;

  const xScale = d3.scaleLinear().domain([xNice.min, xNice.max]).range([axisLeft, plotRight]);
  const yScale = d3.scaleLinear().domain([yNice.min, yNice.max]).range([height - marginBottom, marginTop]);

  const clipId = "clip-" + Math.random().toString(36).substr(2, 9);
  svg.append("defs").append("clipPath").attr("id", clipId).append("rect")
    .attr("x", axisLeft).attr("y", marginTop)
    .attr("width", plotRight - axisLeft).attr("height", height - marginTop - marginBottom);

  // Grid
  const thin = (ticks) => ticks.length > 6 ? ticks.filter((_, i) => i % 2 === 0) : ticks;
  const xGridGroup = svg.append("g").attr("class", "grid-lines-x").attr("clip-path", `url(#${clipId})`);
  const yGridGroup = svg.append("g").attr("class", "grid-lines-y").attr("clip-path", `url(#${clipId})`);
  function renderGrid(xTicks, yTicks) {
    if (!showGrid) return;
    ritaGrid(xGridGroup, { ticks: xTicks, scale: xScale, x1: marginTop, x2: height - marginBottom, noll: null, horisontell: false });
    ritaGrid(yGridGroup, { ticks: yTicks, scale: yScale, x1: axisLeft, x2: plotRight, noll: null });
  }

  // Axlar
  const xAxisGroup = svg.append("g").attr("class", "x-axis").attr("transform", `translate(0,${height - marginBottom})`);
  const yAxisGroup = svg.append("g").attr("class", "y-axis").attr("transform", `translate(${axisLeft},0)`);
  function renderAxes(xTicks, yTicks) {
    xAxisGroup.call(d3.axisBottom(xScale).tickFormat(formatX).tickValues(xTicks).tickSize(5));
    stilXAxel(xAxisGroup);
    yAxisGroup.call(d3.axisLeft(yScale).tickFormat(formatY).tickValues(yTicks));
    stilYAxel(yAxisGroup);
  }
  renderGrid(thin(xNice.ticks), thin(yNice.ticks));
  renderAxes(xNice.ticks, yNice.ticks);

  if (xLabel) xTitel(svg, { x: axisLeft + (plotRight - axisLeft) / 2, y: height - 8, text: xLabel });
  if (yLabel) {
    const pos = yTitelPos(marginLeft, marginTop);
    yTitel(svg, { x: pos.x, y: pos.y, text: yLabel });
  }

  // ── Referensdiagonal ──
  const refGroup = svg.append("g").attr("class", "ref-group").attr("clip-path", `url(#${clipId})`);
  function renderRefDiagonal() {
    refGroup.selectAll("*").remove();
    if (!refDiagonal) return;
    const cfg = (typeof refDiagonal === "object") ? refDiagonal : {};
    const col = cfg.color || FARG.noll;
    const xd = xScale.domain(), yd = yScale.domain();
    const lo = Math.max(xd[0], yd[0]);
    const hi = Math.min(xd[1], yd[1]);
    if (hi <= lo) return;
    refGroup.append("line")
      .attr("x1", xScale(lo)).attr("y1", yScale(lo)).attr("x2", xScale(hi)).attr("y2", yScale(hi))
      .attr("stroke", col).attr("stroke-width", 1.2).attr("stroke-dasharray", "6,4").attr("stroke-opacity", 0.9);
    if (cfg.label) {
      refGroup.append("text")
        .attr("x", xScale(hi) - 6).attr("y", yScale(hi) - 7).attr("text-anchor", "end")
        .attr("font-family", TYP.ui).attr("font-size", 10.5).attr("font-weight", 500)
        .attr("fill", col).text(cfg.label);
    }
  }

  const pinnedTraceGroup = svg.append("g").attr("class", "pinned-trace-group").attr("clip-path", `url(#${clipId})`);
  const traceGroup = svg.append("g").attr("class", "trace-group").attr("clip-path", `url(#${clipId})`);
  const pointsGroup = svg.append("g").attr("class", "points-group").attr("clip-path", `url(#${clipId})`);
  const labelsGroup = svg.append("g").attr("class", "labels-group").attr("clip-path", `url(#${clipId})`);
  const pinnedLabelsGroup = svg.append("g").attr("class", "pinned-labels-group").attr("clip-path", `url(#${clipId})`);
  const hoverGroup = svg.append("g").attr("class", "hover-group").attr("clip-path", `url(#${clipId})`);

  // ── Trace ──
  const pinnedTraces = new Set();
  const traceLine = d3.line().x(d => xScale(d[x])).y(d => yScale(d[y])).curve(d3.curveMonotoneX);

  function drawTrace(group, lbl, pointColor, opts = {}) {
    if (!time || !lbl) return;
    const opacity = opts.opacity || 0.5;
    const w = opts.width || 1.5;
    const entityData = data.filter(d => d[label] === lbl).sort((a, b) => a[time] - b[time]);
    if (entityData.length < 2) return;
    const traceData = entityData.filter(d => d[time] <= currentTime);
    if (traceData.length < 2) return;
    group.append("path")
      .datum(traceData)
      .attr("class", "trace-line").attr("data-trace", lbl)
      .attr("d", traceLine).attr("fill", "none")
      .attr("stroke", pointColor).attr("stroke-width", w).attr("stroke-opacity", opacity);
    const s = traceData[0];
    group.append("circle")
      .attr("class", "trace-start").attr("data-trace", lbl)
      .attr("cx", xScale(s[x])).attr("cy", yScale(s[y])).attr("r", 2)
      .attr("fill", pointColor).attr("fill-opacity", opacity);
  }
  function showHoverTrace(lbl, pointColor) {
    traceGroup.selectAll("*").remove();
    if (pinnedTraces.has(lbl)) return;
    drawTrace(traceGroup, lbl, pointColor, { opacity: 0.4, width: 1.5 });
  }
  function hideHoverTrace() { traceGroup.selectAll("*").remove(); }

  function togglePinnedTrace(lbl) {
    if (pinnedTraces.has(lbl)) pinnedTraces.delete(lbl); else pinnedTraces.add(lbl);
    redrawPinnedTraces();
    updatePinnedPointStyles();
  }

  function redrawPinnedTraces() {
    pinnedTraceGroup.selectAll("*").remove();
    pinnedLabelsGroup.selectAll("*").remove();
    for (const lbl of pinnedTraces) {
      const d = getDataForTime(currentTime).find(d => d[label] === lbl);
      if (!d) continue;
      const isHl = isHighlighted(lbl);
      const ptColor = isHl ? getPointColor(d) : "#666";
      drawTrace(pinnedTraceGroup, lbl, ptColor, { opacity: 0.6, width: 1.8 });
      if (!isHl) {
        pinnedLabelsGroup.append("text")
          .attr("class", "pinned-label").attr("data-label", lbl)
          .attr("x", xScale(d[x])).attr("y", yScale(d[y]) - pointRadius - 8)
          .attr("text-anchor", "middle")
          .attr("font-family", TYP.ui).attr("font-size", 11).attr("font-weight", 700)
          .attr("fill", ptColor).text(lbl);
      } else {
        labelsGroup.select(`.label-text[data-label="${lbl}"]`).attr("font-weight", 700).attr("font-size", 13);
        labelsGroup.select(`.label-connector[data-label="${lbl}"]`).attr("stroke-width", 2).attr("stroke-opacity", 0.7);
      }
    }
  }

  function updatePinnedPointStyles() {
    pointsGroup.selectAll("circle").each(function () {
      const el = d3.select(this);
      const elLabel = el.attr("data-label");
      const isPinned = pinnedTraces.has(elLabel);
      const elIsHl = isHighlighted(elLabel);
      if (isPinned) el.attr("stroke", FARG.ink).attr("stroke-width", 2.5).attr("r", elIsHl ? pointRadius + 2 : pointRadius);
      else el.attr("stroke", "#fff").attr("stroke-width", elIsHl ? 2 : 1).attr("r", elIsHl ? pointRadius : pointRadius - 2);
    });
  }

  // ── Uppdatera diagrammet ──
  updateChart = function () {
    renderRefDiagonal();
    pointsGroup.selectAll("*").remove();
    labelsGroup.selectAll("*").remove();
    hoverGroup.selectAll("*").remove();
    hideHoverTrace();
    redrawPinnedTraces();

    const currentData = getDataForTime(currentTime);
    const highlightedData = currentData.filter(d => label ? isHighlighted(d[label]) : true);
    const mutedData = currentData.filter(d => label ? !isHighlighted(d[label]) : false);

    mutedData.forEach(d => {
      pointsGroup.append("circle")
        .attr("class", "point-muted").attr("data-label", d[label])
        .attr("cx", xScale(d[x])).attr("cy", yScale(d[y])).attr("r", pointRadius - 2)
        .attr("fill", mutedColor).attr("fill-opacity", 0.6)
        .attr("stroke", "#fff").attr("stroke-width", 1)
        .style("cursor", "pointer");
    });
    highlightedData.forEach(d => {
      pointsGroup.append("circle")
        .attr("class", "point-highlight").attr("data-label", d[label])
        .attr("cx", xScale(d[x])).attr("cy", yScale(d[y])).attr("r", pointRadius)
        .attr("fill", getPointColor(d)).attr("fill-opacity", pointOpacity)
        .attr("stroke", "#fff").attr("stroke-width", 2)
        .style("cursor", "pointer");
    });

    if (label && highlightedData.length > 0 && highlightedData.length <= 15) drawLabels(highlightedData);
    if (pinnedTraces.size > 0) updatePinnedPointStyles();
    if (selectorPanel) selectorPanel.update();
  };

  // ── Etikettplacering med kollisionshantering ──
  function drawLabels(pointData) {
    const labelFontSize = 11;
    const labelPadding = 4;
    const pointPadding = 4;
    const currentData = getDataForTime(currentTime);
    const allPointPositions = currentData.map(d => ({
      x: xScale(d[x]), y: yScale(d[y]),
      r: isHighlighted(d[label]) ? pointRadius : pointRadius - 2
    }));

    const labels = pointData.map(d => {
      const px = xScale(d[x]), py = yScale(d[y]);
      return {
        data: d, name: d[label], px, py,
        labelWidth: d[label].length * 6.5 + 10, labelHeight: 14,
        labelX: px, labelY: py - pointRadius - 14,
        color: getPointColor(d)
      };
    });

    function rectOverlapsPoint(rx, ry, rw, rh, pt) {
      const closestX = Math.max(rx - rw / 2, Math.min(pt.x, rx + rw / 2));
      const closestY = Math.max(ry - rh / 2, Math.min(pt.y, ry + rh / 2));
      return (closestX - pt.x) ** 2 + (closestY - pt.y) ** 2 < (pt.r + pointPadding) ** 2;
    }
    function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
      return Math.abs(ax - bx) < (aw + bw) / 2 + labelPadding && Math.abs(ay - by) < (ah + bh) / 2 + 2;
    }
    function getPositionPenalty(lp, testX, testY, otherLabels) {
      let penalty = Math.sqrt((testX - lp.px) ** 2 + (testY - lp.py) ** 2) * 0.5;
      for (const pt of allPointPositions) {
        if (Math.abs(pt.x - lp.px) < 1 && Math.abs(pt.y - lp.py) < 1) continue;
        if (rectOverlapsPoint(testX, testY, lp.labelWidth, lp.labelHeight, pt)) penalty += 1000;
      }
      for (const other of otherLabels) {
        if (other === lp) continue;
        if (rectsOverlap(testX, testY, lp.labelWidth, lp.labelHeight, other.labelX, other.labelY, other.labelWidth, other.labelHeight)) penalty += 500;
      }
      if (testX - lp.labelWidth / 2 < axisLeft) penalty += 200;
      if (testX + lp.labelWidth / 2 > plotRight) penalty += 200;
      if (testY - lp.labelHeight / 2 < marginTop) penalty += 200;
      if (testY + lp.labelHeight / 2 > height - marginBottom) penalty += 200;
      return penalty;
    }

    const offsets = [
      { dx: 0, dy: -pointRadius - 14 }, { dx: 0, dy: pointRadius + 14 },
      { dx: pointRadius + 20, dy: 0 }, { dx: -pointRadius - 20, dy: 0 },
      { dx: pointRadius + 15, dy: -12 }, { dx: -pointRadius - 15, dy: -12 },
      { dx: pointRadius + 15, dy: 12 }, { dx: -pointRadius - 15, dy: 12 }
    ];
    const sortedLabels = [...labels].sort((a, b) => {
      const ae = Math.min(a.px - axisLeft, plotRight - a.px, a.py - marginTop, height - marginBottom - a.py);
      const be = Math.min(b.px - axisLeft, plotRight - b.px, b.py - marginTop, height - marginBottom - b.py);
      return ae - be;
    });
    const placedLabels = [];
    for (const lp of sortedLabels) {
      let bestX = lp.px, bestY = lp.py - pointRadius - 14, bestPenalty = Infinity;
      for (const o of offsets) {
        const p = getPositionPenalty(lp, lp.px + o.dx, lp.py + o.dy, placedLabels);
        if (p < bestPenalty) { bestPenalty = p; bestX = lp.px + o.dx; bestY = lp.py + o.dy; }
      }
      lp.labelX = bestX; lp.labelY = bestY;
      placedLabels.push(lp);
    }

    for (let iter = 0; iter < 30; iter++) {
      let totalMovement = 0;
      for (const lp of labels) {
        let fx = 0, fy = 0;
        for (const other of labels) {
          if (other === lp) continue;
          const dx = lp.labelX - other.labelX, dy = lp.labelY - other.labelY;
          const minDistX = (lp.labelWidth + other.labelWidth) / 2 + labelPadding;
          const minDistY = (lp.labelHeight + other.labelHeight) / 2 + 2;
          if (Math.abs(dx) < minDistX && Math.abs(dy) < minDistY) {
            fx += (dx === 0 ? 0.1 : Math.sign(dx)) * (minDistX - Math.abs(dx)) * 0.3;
            fy += (dy === 0 ? 0.1 : Math.sign(dy)) * (minDistY - Math.abs(dy)) * 0.3;
          }
        }
        for (const pt of allPointPositions) {
          if (Math.abs(pt.x - lp.px) < 1 && Math.abs(pt.y - lp.py) < 1) continue;
          const dx = lp.labelX - pt.x, dy = lp.labelY - pt.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = pt.r + Math.max(lp.labelWidth, lp.labelHeight) / 2 + pointPadding;
          if (dist < minDist && dist > 0) {
            const force = (minDist - dist) * 0.5;
            fx += (dx / dist) * force; fy += (dy / dist) * force;
          }
        }
        fx += (lp.px - lp.labelX) * 0.02;
        fy += (lp.py - pointRadius - 14 - lp.labelY) * 0.01;
        lp.labelX += fx; lp.labelY += fy;
        totalMovement += Math.abs(fx) + Math.abs(fy);
        lp.labelX = Math.max(axisLeft + lp.labelWidth / 2 + 2, Math.min(plotRight - lp.labelWidth / 2 - 2, lp.labelX));
        lp.labelY = Math.max(marginTop + 8, Math.min(height - marginBottom - 10, lp.labelY));
      }
      if (totalMovement < 0.5) break;
    }

    labels.forEach(lp => {
      const dx = lp.labelX - lp.px, dy = lp.labelY - lp.py;
      if (Math.abs(dx) > 15 || Math.abs(dy) > 20) {
        const angle = Math.atan2(dy, dx);
        labelsGroup.append("line")
          .attr("class", "label-connector").attr("data-label", lp.name)
          .attr("x1", lp.px + Math.cos(angle) * (pointRadius + 2))
          .attr("y1", lp.py + Math.sin(angle) * (pointRadius + 2))
          .attr("x2", lp.labelX - Math.cos(angle) * (lp.labelWidth / 2 - 2))
          .attr("y2", lp.labelY - Math.sign(dy) * 2)
          .attr("stroke", lp.color).attr("stroke-width", 1).attr("stroke-opacity", 0.4);
      }
      labelsGroup.append("text")
        .attr("class", "label-text").attr("data-label", lp.name)
        .attr("x", lp.labelX).attr("y", lp.labelY)
        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
        .attr("font-size", labelFontSize).attr("font-family", TYP.ui).attr("font-weight", 600)
        .attr("fill", lp.color).text(lp.name);
    });
  }

  // ── Hover ──
  function handlePointHover(d, show) {
    const lbl = d[label];
    const isHl = isHighlighted(lbl);
    const ptColor = isHl ? getPointColor(d) : "#666";
    const isPinned = pinnedTraces.has(lbl);
    hoverGroup.selectAll("*").remove();

    if (show) {
      if (time && lbl) showHoverTrace(lbl, ptColor);
      if (!isPinned) {
        pointsGroup.selectAll("circle").each(function () {
          const el = d3.select(this);
          if (el.attr("data-label") === lbl) el.attr("r", pointRadius + 3).attr("stroke", FARG.ink).attr("stroke-width", 2.5);
        });
      }
      if (!isHl) {
        hoverGroup.append("text")
          .attr("x", xScale(d[x])).attr("y", yScale(d[y]) - pointRadius - 8).attr("text-anchor", "middle")
          .attr("font-family", TYP.ui).attr("font-size", 11).attr("font-weight", 600)
          .attr("fill", ptColor).text(lbl);
      } else {
        labelsGroup.select(`.label-text[data-label="${lbl}"]`).attr("font-weight", 700).attr("font-size", 13);
        labelsGroup.select(`.label-connector[data-label="${lbl}"]`).attr("stroke-width", 2).attr("stroke-opacity", 0.7);
      }

      const sep = `<span style="opacity:0.25;margin:0 8px">│</span>`;
      const colorDot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ptColor};margin-right:6px;vertical-align:middle"></span>`;
      const labelText = lbl ? `<b style="margin-right:6px">${lbl}</b>` : "";
      const groupText = color && d[color] ? `<span style="color:${FARG.mjuk};margin-right:6px">(${d[color]})</span>` : "";
      const xChip = `<span style="color:${FARG.mjuk};margin-right:4px">${xLabel || "X"}:</span><b>${formatX(d[x])}</b>`;
      const yChip = `<span style="color:${FARG.mjuk};margin-right:4px">${yLabel || "Y"}:</span><b>${formatY(d[y])}</b>`;
      const timeChip = time ? `${sep}<span style="color:${FARG.mjuk}">${d[time]}</span>` : "";
      const pinHint = isPinned ? `<span style="opacity:0.45;margin-left:8px;font-size:10px">klicka för att ta bort spåret</span>`
        : (time ? `<span style="opacity:0.45;margin-left:8px;font-size:10px">klicka för att låsa spåret</span>` : "");
      avlasning.visa(`${colorDot}${labelText}${groupText}${sep}${xChip}${sep}${yChip}${timeChip}${pinHint}`);
    } else {
      hideHoverTrace();
      pointsGroup.selectAll("circle").each(function () {
        const el = d3.select(this);
        const elLabel = el.attr("data-label");
        const elIsHl = isHighlighted(elLabel);
        if (pinnedTraces.has(elLabel)) el.attr("r", elIsHl ? pointRadius + 2 : pointRadius).attr("stroke", FARG.ink).attr("stroke-width", 2.5);
        else el.attr("r", elIsHl ? pointRadius : pointRadius - 2).attr("stroke", "#fff").attr("stroke-width", elIsHl ? 2 : 1);
      });
      labelsGroup.selectAll(".label-text").each(function () {
        const el = d3.select(this);
        if (pinnedTraces.has(el.attr("data-label"))) el.attr("font-weight", 700).attr("font-size", 13);
        else el.attr("font-weight", 600).attr("font-size", 11);
      });
      labelsGroup.selectAll(".label-connector").each(function () {
        const el = d3.select(this);
        if (pinnedTraces.has(el.attr("data-label"))) el.attr("stroke-width", 2).attr("stroke-opacity", 0.7);
        else el.attr("stroke-width", 1).attr("stroke-opacity", 0.4);
      });
      avlasning.rensa();
    }
  }

  // ── Zoom (brush) ──
  const originalXDomain = [xNice.min, xNice.max];
  const originalYDomain = [yNice.min, yNice.max];
  let isZoomed = false;

  const chartCenterX = axisLeft + (plotRight - axisLeft) / 2;
  const zoomControlsGroup = svg.append("g")
    .attr("class", "zoom-controls")
    .attr("transform", `translate(${chartCenterX}, ${marginTop - 12})`);

  // Diskret hint: "Dra för att zooma" (försvinner efter några sekunder)
  const brushHintText = zoomControlsGroup.append("text")
    .attr("x", 0).attr("y", 0).attr("text-anchor", "middle")
    .attr("font-family", TYP.ui).attr("font-size", 10.5).attr("fill", FARG.mjuk)
    .attr("opacity", 1).text("Dra i grafen för att zooma");
  setTimeout(() => { if (!isZoomed) hideBrushHint(); }, 4000);
  function showBrushHint() { brushHintText.transition().duration(200).attr("opacity", 1); }
  function hideBrushHint() { brushHintText.transition().duration(300).attr("opacity", 0); }

  // Återställ-knapp (pill, synlig vid zoom)
  const resetWidth = 84;
  const resetBtnGroup = zoomControlsGroup.append("g")
    .attr("class", "reset-btn")
    .style("cursor", "pointer").style("opacity", 0).style("pointer-events", "none")
    .on("click", resetZoom)
    .on("mouseenter", function () { d3.select(this).select("rect").attr("fill", "#f3f5f4"); })
    .on("mouseleave", function () { d3.select(this).select("rect").attr("fill", "#fff"); });
  resetBtnGroup.append("rect")
    .attr("x", -resetWidth / 2).attr("y", -13).attr("width", resetWidth).attr("height", 20).attr("rx", 10)
    .attr("fill", "#fff").attr("stroke", "#dfe2e0");
  resetBtnGroup.append("text")
    .attr("x", 0).attr("y", 0.5).attr("text-anchor", "middle")
    .attr("font-family", TYP.ui).attr("font-size", 10.5).attr("font-weight", 500)
    .attr("fill", FARG.ink).text("↺ Återställ zoom");
  function showResetBtn() { resetBtnGroup.transition().duration(200).style("opacity", 1).style("pointer-events", "auto"); }
  function hideResetBtn() { resetBtnGroup.transition().duration(200).style("opacity", 0).style("pointer-events", "none"); }

  const brush = d3.brush()
    .extent([[axisLeft, marginTop], [plotRight, height - marginBottom]])
    .on("start", (event) => { if (event.selection) hideBrushHint(); })
    .on("end", brushEnded);
  const brushGroup = svg.append("g").attr("class", "graf-brush").call(brush);

  function brushEnded(event) {
    if (!event.selection) {
      // klick: lås/lossa spår
      if (time && event.sourceEvent && hoveredPoint) {
        const lbl = hoveredPoint[label];
        if (lbl) { togglePinnedTrace(lbl); handlePointHover(hoveredPoint, true); }
      }
      return;
    }
    const [[x0, y0], [x1, y1]] = event.selection;
    const newX = [xScale.invert(x0), xScale.invert(x1)];
    const newY = [yScale.invert(y1), yScale.invert(y0)];
    brushGroup.call(brush.move, null);
    xScale.domain(newX).nice(10);
    yScale.domain(newY).nice(10);
    const xT = xScale.ticks(5), yT = yScale.ticks(5);
    renderAxes(xT, yT);
    renderGrid(xT, yT);
    isZoomed = true;
    hideBrushHint();
    showResetBtn();
    updateChart();
  }

  function resetZoom() {
    xScale.domain(originalXDomain);
    yScale.domain(originalYDomain);
    renderAxes(xNice.ticks, yNice.ticks);
    renderGrid(thin(xNice.ticks), thin(yNice.ticks));
    isZoomed = false;
    hideResetBtn();
    showBrushHint();
    setTimeout(() => { if (!isZoomed) hideBrushHint(); }, 3000);
    updateChart();
  }

  // ── Hover via brush-overlay ──
  let hoveredPoint = null;
  brushGroup
    .on("mousemove.hover", function (event) {
      const [mx, my] = d3.pointer(event);
      let closest = null, minDist = Infinity;
      getDataForTime(currentTime).forEach(d => {
        const dist = Math.hypot(mx - xScale(d[x]), my - yScale(d[y]));
        if (dist < minDist && dist < 40) { minDist = dist; closest = d; }
      });
      if (closest !== hoveredPoint) {
        if (hoveredPoint) handlePointHover(hoveredPoint, false);
        hoveredPoint = closest;
        if (hoveredPoint) handlePointHover(hoveredPoint, true);
      }
    })
    .on("mouseleave.hover", function () {
      if (hoveredPoint) { handlePointHover(hoveredPoint, false); hoveredPoint = null; }
    });

  // ── År (nedre raden, rullgardin) ──
  if (hasTimeAnimation) {
    valPill(ram.controlsLeft, {
      label: "År", options: allTimes.map(String), activeIndex: allTimes.indexOf(currentTime), body: ram.body,
      onSelect: (i) => { currentTime = allTimes[i]; updateChart(); }
    });
  }

  updateChart();

  addExportButton(container, svg.node(), { title, subtitle, caption, width: autoWidth, height, altText, info, logo });

  return container.node();
}
