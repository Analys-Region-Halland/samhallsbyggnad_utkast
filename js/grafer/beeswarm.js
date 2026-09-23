// =============================================================================
// BEESWARM — svärmdiagram för fördelning över många enheter, med highlight.
// Byggd på den gemensamma ramen (js/lib/grafRam.js). Estetiken: halvtransparenta
// prickar med tunn mörk kontur, lätt överlapp för djup, följsam höjd som hugger
// rutan efter svärmens band, korta vinklade leaders för etiketter.
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { createFilterState, createSelectorPanel } from "../lib/filterUtils.js";
import { skapaRam, TYP, FARG, STORLEK, SERIEFARGER, stilXAxel, xTitel, tooltipHtml, fmtAxelTal, autoFmt, ritbredd, arSmal } from "../lib/grafRam.js";

export function beeswarm(data, {
  value = "värde",
  label = "namn",
  group = null,
  width = null,
  height = null,  // null ⇒ följsam höjd: containern huggs efter svärmens faktiska band
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  colors = SERIEFARGER,
  formatValue = null,           // null = autoFmt (samma antal decimaler på alla värden)
  filter = null,
  highlight = null,
  highlightLabels = true,
  radius = 6,        // bakgrundsprickarnas radie (highlight ritas större för hierarki)
  padding = 0,
  overlap = 0.8,     // andel av radien som krockradien utgör (<1 ⇒ lätt överlapp → djup)
  logScale = true,
  showGrid = false,  // gridlines av default — referenslinjen räcker
  vline = null,
  domain = null,        // [min, max] för x-axeln; null ⇒ 0 (linjär) eller data (log)
  tickFormat = null,    // egen formatterare för x-axelns etiketter (linjär skala)
  altText = null,
  info = null,
  logo = null,
  interactive = false
} = {}) {
  if (!formatValue) formatValue = autoFmt(data.map(d => d[value]));

  const autoWidth = width || ritbredd(780);
  // Etikettzon: smalt band ovan/under svärmen för utplacerade highlight-etiketter,
  // skalad efter antal highlightade noder.
  const nHighlight = (highlight && group)
    ? data.filter(d => [].concat(highlight).includes(d[group])).length
    : 0;
  const labelZoneHeight = nHighlight <= 8 ? 32 : nHighlight <= 16 ? 48 : 62;
  const marginTop = 16 + labelZoneHeight;
  const marginRight = 32;
  const marginBottom = (xLabel ? 44 : 20) + labelZoneHeight;
  const marginLeft = 32;

  // ── Ram ──
  const ram = skapaRam({ title, subtitle, caption });
  const container = ram.container;

  // ── Filterstate ──
  const allItems = [...new Set(data.map(d => d[label]))];
  const allGroups = group ? [...new Set(data.map(d => d[group]))] : [];
  const filterState = group
    ? createFilterState(data, { itemField: label, groupField: group, filter, highlight })
    : null;
  const isHighlighted = (d) => !filterState || filterState.isHighlighted(d[label]);

  const mutedColor = "#d0d0d0";
  const mutedStroke = d3.color(mutedColor).darker(1.7).formatHex();
  const groupColorScale = d3.scaleOrdinal().domain(allGroups).range(colors);
  const getColor = (g) => groupColorScale(g);
  const strokeFor = (g) => d3.color(group ? getColor(g) : colors[0]).darker(0.9).formatHex();

  // ── Väljare i nedre raden ──
  let selectorCtrl = null;
  if (interactive && group && filterState) {
    selectorCtrl = createSelectorPanel(ram.controlsLeft, {
      filterState,
      allItems,
      colorScale: groupColorScale,
      triggerText: "Markera",
      onUpdate: () => updateChart(),
      onItemHover: (item) => { const n = nodes.find(n => n[label] === item); if (n) highlightPoint(n, true); },
      onItemLeave: (item) => { const n = nodes.find(n => n[label] === item); if (n) highlightPoint(n, false); }
    });
  }

  const avlasning = ram.avlasning("Peka för värden");

  // SVG — viewBox sätts efter att svärmens band mätts (följsam höjd)
  const svg = ram.svgWrap.append("svg")
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  // ── X-skala ──
  const valueExtent = d3.extent(data, d => d[value]);
  const xScale = logScale
    ? d3.scaleLog().domain(domain || [Math.max(1, valueExtent[0] * 0.8), valueExtent[1] * 1.1]).range([marginLeft, autoWidth - marginRight])
    : d3.scaleLinear().domain(domain || [0, valueExtent[1] * 1.05]).range([marginLeft, autoWidth - marginRight]);

  const highlightedR = radius + 2.5;
  const backgroundR = radius;

  // ── Layout: simulera kring y=0, mät bandet, låt höjden hugga innehållet ──
  const swarmTop = marginTop + 10;
  const nodes = data.map(d => ({ ...d, x: xScale(d[value]), y: 0, baseRadius: radius }));

  const simulation = d3.forceSimulation(nodes)
    .force("x", d3.forceX(d => xScale(d[value])).strength(1))
    .force("y", d3.forceY(0).strength(0.2))
    .force("collide", d3.forceCollide(radius * overlap + padding).strength(1).iterations(3))
    .stop();
  for (let i = 0; i < 220; i++) simulation.tick();

  const yExtent = d3.extent(nodes, d => d.y);
  const bandMid = (yExtent[0] + yExtent[1]) / 2;
  const bandHeight = Math.max((yExtent[1] - yExtent[0]) + 2 * highlightedR, 80);

  let swarmBottom, centerY;
  if (height == null) {
    swarmBottom = swarmTop + bandHeight;
    centerY = swarmTop + bandHeight / 2;
    height = Math.round(swarmBottom + 10 + marginBottom);
    nodes.forEach(d => { d.y = centerY + (d.y - bandMid); });
  } else {
    swarmBottom = height - marginBottom - 10;
    centerY = (swarmTop + swarmBottom) / 2;
    nodes.forEach(d => {
      d.y = centerY + (d.y - bandMid);
      d.y = Math.max(swarmTop + radius, Math.min(swarmBottom - radius, d.y));
    });
  }
  svg.attr("viewBox", `0 0 ${autoWidth} ${height}`);

  // ── X-axel ──
  const fmtTick = fmtAxelTal;
  let xAxis;
  if (logScale) {
    const tickValues = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000]
      .filter(v => v >= valueExtent[0] * 0.5 && v <= valueExtent[1] * 1.5)
      .filter(v => !arSmal(autoWidth) || /^1/.test(String(v)));   // smal skärm: bara tiopotenser
    xAxis = d3.axisBottom(xScale).tickValues(tickValues).tickFormat(fmtTick).tickSize(0);
  } else {
    xAxis = d3.axisBottom(xScale).ticks(arSmal(autoWidth) ? 4 : 8).tickFormat(tickFormat || fmtAxelTal).tickSize(0);
  }
  const xAxisY = height - (xLabel ? 38 : 16);

  if (showGrid) {
    const gridTickValues = logScale
      ? [1000, 5000, 10000, 50000, 100000, 500000, 1000000].filter(v => v >= valueExtent[0] * 0.5 && v <= valueExtent[1] * 1.5)
      : xScale.ticks(5);
    const gridGroup = svg.append("g").attr("class", "grid-lines");
    gridTickValues.forEach(tickVal => {
      const tickX = xScale(tickVal);
      if (tickX >= marginLeft && tickX <= autoWidth - marginRight) {
        gridGroup.append("line")
          .attr("x1", tickX).attr("x2", tickX).attr("y1", swarmTop - 8).attr("y2", xAxisY)
          .attr("stroke", FARG.grid).attr("stroke-width", 0.8).attr("stroke-dasharray", "4,4");
      }
    });
  }

  // ── Vertikala referenslinjer (ett tal, ett objekt eller en lista av objekt) ──
  const vlines = vline == null ? [] : (Array.isArray(vline) ? vline : [vline]).map(v => typeof v === "number" ? { value: v } : v);
  const vlineBoxar = [];
  for (const vc of vlines) {
    const vlineX = xScale(vc.value);
    // Förskjut etiketten en rad uppåt om den skulle krocka med en tidigare referenslinjes etikett
    const bredd = Math.max(36, (vc.label || "").length * 5.8);
    let lyft = 0;
    while (vlineBoxar.some(b => b.lyft === lyft && Math.abs(b.x - vlineX) < (b.bredd + bredd) / 2 + 6)) lyft += 13;
    vc._lyft = lyft;
    vlineBoxar.push({ x: vlineX, bredd, lyft });
    const vlineColor = vc.color || FARG.text;
    if (vlineX >= marginLeft && vlineX <= autoWidth - marginRight) {
      svg.append("line")
        .attr("x1", vlineX).attr("x2", vlineX).attr("y1", swarmTop - 8).attr("y2", xAxisY)
        .attr("stroke", vlineColor).attr("stroke-width", 1)
        .attr("stroke-dasharray", vc.dashed !== false ? "4,3" : "none").attr("stroke-opacity", 0.6);
      if (vc.label) {
        const hasVal = vc.value != null && vc.showValue !== false;
        const t = svg.append("text")
          .attr("x", vlineX).attr("y", (hasVal ? swarmTop - 25 : swarmTop - 14) - (vc._lyft || 0))
          .attr("text-anchor", "middle").attr("font-family", TYP.ui)
          .attr("font-size", 10.5).attr("font-weight", 500).attr("fill", vlineColor);
        t.append("tspan").attr("x", vlineX).text(vc.label);
        if (hasVal) t.append("tspan").attr("x", vlineX).attr("dy", "1.15em").attr("font-weight", 400).attr("fill-opacity", 0.7).text(formatValue(vc.value));
      }
    }
  }

  const xAxisG = svg.append("g").attr("class", "x-axis").attr("transform", `translate(0,${xAxisY})`).call(xAxis);
  stilXAxel(xAxisG);
  xAxisG.select(".domain").remove();
  xAxisG.selectAll(".tick text").attr("fill", FARG.text).attr("font-size", STORLEK.tick);

  if (xLabel) xTitel(svg, { x: autoWidth / 2, y: height - 8, text: xLabel });

  // ── Grupper ──
  const dotsGroup = svg.append("g").attr("class", "dots-group");
  const labelsGroup = svg.append("g").attr("class", "beeswarm-labels");
  let currentLabelData = { top: [], bottom: [] };

  const visaVarde = (nodeData, dotColor) => {
    avlasning.visa(tooltipHtml(nodeData[label], [{
      namn: (group && nodeData[group] != null ? String(nodeData[group]) : (xLabel || "")),
      varde: formatValue(nodeData[value]), farg: dotColor
    }]));
  };

  // ── Highlight-punkt vid hover ──
  function highlightPoint(nodeData, show) {
    if (!nodeData) return;
    const dotEl = dotsGroup.select(`circle[data-label="${nodeData[label]}"]`);
    if (dotEl.empty()) return;

    if (show) {
      const isHl = isHighlighted(nodeData);
      const dotColor = isHl ? (group ? getColor(nodeData[group]) : colors[0]) : "#555";
      dotEl.attr("r", highlightedR + 3).attr("fill-opacity", 0.95)
        .attr("stroke", FARG.ink).attr("stroke-width", 2.5).attr("stroke-opacity", 1);

      const existingLabel = labelsGroup.select(`.label-text[data-label="${nodeData[label]}"]`);
      if (!existingLabel.empty()) {
        existingLabel.attr("font-weight", 700).attr("font-size", 13);
        labelsGroup.selectAll(`.label-connector[data-label="${nodeData[label]}"]`).attr("stroke-width", 2).attr("stroke-opacity", 0.7);
      } else {
        labelsGroup.selectAll(".hover-label-single").remove();
        const labelY = nodeData.y <= centerY ? nodeData.y - highlightedR - 10 : nodeData.y + highlightedR + 14;
        labelsGroup.append("text")
          .attr("class", "hover-label-single")
          .attr("x", nodeData.x).attr("y", labelY).attr("text-anchor", "middle")
          .attr("font-size", 10.5).attr("font-family", TYP.ui).attr("font-weight", 600)
          .attr("fill", dotColor).text(nodeData[label]);
      }
      visaVarde(nodeData, dotColor);
    } else {
      const isHl = isHighlighted(nodeData);
      dotEl.attr("r", isHl ? highlightedR : backgroundR)
        .attr("fill-opacity", isHl ? 0.9 : 0.42)
        .attr("stroke", isHl ? strokeFor(nodeData[group]) : mutedStroke)
        .attr("stroke-width", isHl ? 1.25 : 0.6)
        .attr("stroke-opacity", isHl ? 1 : 0.4);
      labelsGroup.selectAll(`.label-text[data-label="${nodeData[label]}"]`).attr("font-weight", 600).attr("font-size", 11);
      labelsGroup.selectAll(`.label-connector[data-label="${nodeData[label]}"]`).attr("stroke-width", 0.75).attr("stroke-opacity", 0.55);
      labelsGroup.selectAll(".hover-label-single").remove();
      avlasning.rensa();
    }
  }

  // ── Uppdatering: punkter och etiketter ──
  function updateChart() {
    dotsGroup.selectAll("*").remove();
    labelsGroup.selectAll("*").remove();

    const highlightedNodes = nodes.filter(d => isHighlighted(d));
    const backgroundNodes = nodes.filter(d => !isHighlighted(d));

    dotsGroup.selectAll(".dot-bg")
      .data(backgroundNodes)
      .join("circle")
      .attr("class", "dot-bg")
      .attr("data-label", d => d[label])
      .attr("cx", d => d.x).attr("cy", d => d.y).attr("r", backgroundR)
      .attr("fill", mutedColor).attr("fill-opacity", 0.42)
      .attr("stroke", mutedStroke).attr("stroke-width", 0.6).attr("stroke-opacity", 0.4)
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => highlightPoint(d, true))
      .on("mouseleave", (event, d) => highlightPoint(d, false));

    dotsGroup.selectAll(".dot-highlight")
      .data(highlightedNodes)
      .join("circle")
      .attr("class", "dot-highlight")
      .attr("data-label", d => d[label])
      .attr("cx", d => d.x).attr("cy", d => d.y).attr("r", highlightedR)
      .attr("fill", d => group ? getColor(d[group]) : colors[0]).attr("fill-opacity", 0.9)
      .attr("stroke", d => strokeFor(d[group])).attr("stroke-width", 1.25)
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => highlightPoint(d, true))
      .on("mouseleave", (event, d) => highlightPoint(d, false));

    // ── Etiketter: noll överlapp garanterat, global placering ──
    if (highlightLabels && highlightedNodes.length > 0 && highlightedNodes.length <= 25) {
      const labelFontSize = 11;
      const labelPadding = 6;
      const connectorPadding = 4;
      const placedLabels = [];

      // Seed: referenslinjernas etiketter är hinder
      for (const vc of vlines) {
        const vx = xScale(vc.value);
        if (vc.label && vx >= marginLeft && vx <= autoWidth - marginRight) {
          const hasVal = vc.value != null && vc.showValue !== false;
          const valStr = hasVal ? formatValue(vc.value) : "";
          const wTxt = Math.max(vc.label.length, valStr.length);
          placedLabels.push({
            labelX: vx, labelY: (hasVal ? swarmTop - 19 : swarmTop - 14) - (vc._lyft || 0),
            labelWidth: Math.max(36, wTxt * 5.8), labelHeight: hasVal ? 26 : 14, isObstacle: true
          });
        }
      }

      const topZoneY = { min: 8, max: swarmTop - 12 };
      const bottomZoneY = { min: swarmBottom + 13, max: xAxisY - 14 };

      function labelsOverlap(x, y, w, h, exclude = null) {
        for (const lbl of placedLabels) {
          if (lbl === exclude) continue;
          const overlapX = Math.abs(x - lbl.labelX) < (w + lbl.labelWidth) / 2 + labelPadding;
          const overlapY = Math.abs(y - lbl.labelY) < (h + lbl.labelHeight) / 2 + labelPadding;
          if (overlapX && overlapY) return true;
        }
        return false;
      }

      // Liang–Barsky: klipp segmentet mot rektangeln
      function lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh, pad = 0) {
        const left = rx - rw / 2 - pad, right = rx + rw / 2 + pad;
        const top = ry - rh / 2 - pad, bottom = ry + rh / 2 + pad;
        let t0 = 0, t1 = 1;
        const dx = x2 - x1, dy = y2 - y1;
        const clip = (p, q) => {
          if (p === 0) return q >= 0;
          const r = q / p;
          if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
          else { if (r < t0) return false; if (r < t1) t1 = r; }
          return true;
        };
        if (clip(-dx, x1 - left) && clip(dx, right - x1) && clip(-dy, y1 - top) && clip(dy, bottom - y1)) return t0 <= t1;
        return false;
      }

      function connectorHitsLabel(segments, excludeLabel) {
        for (const seg of segments) {
          for (const lbl of placedLabels) {
            if (lbl === excludeLabel) continue;
            if (lineIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, lbl.labelX, lbl.labelY, lbl.labelWidth, lbl.labelHeight, connectorPadding)) return lbl;
          }
        }
        return null;
      }

      const labelCandidates = highlightedNodes.map(d => ({
        ...d,
        name: d[label],
        labelWidth: Math.max(36, String(d[label]).length * 6.2),
        labelHeight: 14,
        color: group ? getColor(d[group]) : colors[0],
        nodeRadius: highlightedR,
        preferTop: d.y <= centerY
      }));
      labelCandidates.sort((a, b) => a.x - b.x);

      for (const lp of labelCandidates) {
        let bestPos = null, bestScore = Infinity;
        const candidates = [];
        const topLabelsNearby = placedLabels.filter(l => l.labelY < centerY && Math.abs(l.labelX - lp.x) < 100).length;
        const bottomLabelsNearby = placedLabels.filter(l => l.labelY > centerY && Math.abs(l.labelX - lp.x) < 100).length;
        const topFirst = lp.preferTop ? topLabelsNearby <= bottomLabelsNearby : topLabelsNearby < bottomLabelsNearby;
        const topYLevels = [swarmTop - 13, swarmTop - 27, swarmTop - 41];
        const bottomYLevels = [swarmBottom + 15, swarmBottom + 29, swarmBottom + 43];
        const xOffsets = [0, -30, 30, -60, 60, -90, 90];

        const addCandidates = (yLevels, isTop) => {
          for (const baseY of yLevels) {
            for (const xOff of xOffsets) {
              const x = Math.max(marginLeft + lp.labelWidth / 2 + 5, Math.min(autoWidth - marginRight - lp.labelWidth / 2 - 5, lp.x + xOff));
              const y = isTop
                ? Math.max(topZoneY.min, Math.min(topZoneY.max, baseY))
                : Math.max(bottomZoneY.min, Math.min(bottomZoneY.max, baseY));
              candidates.push({ x, y, isTop });
            }
          }
        };
        if (topFirst) { addCandidates(topYLevels, true); addCandidates(bottomYLevels, false); }
        else { addCandidates(bottomYLevels, false); addCandidates(topYLevels, true); }

        for (const cand of candidates) {
          if (labelsOverlap(cand.x, cand.y, lp.labelWidth, lp.labelHeight)) continue;
          const startX = lp.x;
          const startY = cand.isTop ? lp.y - lp.nodeRadius - 2 : lp.y + lp.nodeRadius + 2;
          const endX = cand.x;
          const endY = cand.isTop ? cand.y + 7 : cand.y - 9;
          const segments = [{ x1: startX, y1: startY, x2: endX, y2: endY }];
          if (connectorHitsLabel(segments, null)) continue;
          const distX = Math.abs(cand.x - lp.x);
          const distY = Math.abs(cand.y - (cand.isTop ? swarmTop : swarmBottom));
          const wrongSideBonus = (cand.isTop === lp.preferTop) ? 0 : 20;
          const score = distX * 0.5 + distY * 0.3 + wrongSideBonus;
          if (score < bestScore) { bestScore = score; bestPos = { ...cand, segments }; }
        }

        // Rutta runt hinder
        if (!bestPos) {
          for (const cand of candidates) {
            if (labelsOverlap(cand.x, cand.y, lp.labelWidth, lp.labelHeight)) continue;
            const startX = lp.x;
            const startY = cand.isTop ? lp.y - lp.nodeRadius - 2 : lp.y + lp.nodeRadius + 2;
            const endX = cand.x;
            const endY = cand.isTop ? cand.y + 7 : cand.y - 9;
            const simpleSegments = [{ x1: startX, y1: startY, x2: endX, y2: endY }];
            const blocker = connectorHitsLabel(simpleSegments, null);
            if (!blocker) {
              const score = Math.abs(cand.x - lp.x) * 0.5 + Math.abs(cand.y - (cand.isTop ? swarmTop : swarmBottom)) * 0.3;
              if (score < bestScore) { bestScore = score; bestPos = { ...cand, segments: simpleSegments }; }
              continue;
            }
            const bLeft = blocker.labelX - blocker.labelWidth / 2 - 8;
            const bRight = blocker.labelX + blocker.labelWidth / 2 + 8;
            const jogX = endX >= startX ? bRight : bLeft;
            const jogY = cand.isTop
              ? Math.max(blocker.labelY + blocker.labelHeight / 2 + 6, startY - 10)
              : Math.min(blocker.labelY - blocker.labelHeight / 2 - 6, startY + 10);
            const routedSegments = [
              { x1: startX, y1: startY, x2: startX, y2: jogY },
              { x1: startX, y1: jogY, x2: jogX, y2: jogY },
              { x1: jogX, y1: jogY, x2: jogX, y2: endY },
              { x1: jogX, y1: endY, x2: endX, y2: endY }
            ];
            if (!connectorHitsLabel(routedSegments, null)) {
              const score = Math.abs(cand.x - lp.x) * 0.5 + Math.abs(cand.y - (cand.isTop ? swarmTop : swarmBottom)) * 0.3 + 15;
              if (score < bestScore) { bestScore = score; bestPos = { ...cand, segments: routedSegments }; }
            }
          }
        }

        if (!bestPos) {
          const fallbackY = lp.preferTop ? topYLevels[0] : bottomYLevels[0];
          bestPos = {
            x: lp.x, y: fallbackY, isTop: lp.preferTop,
            segments: [{ x1: lp.x, y1: lp.preferTop ? lp.y - lp.nodeRadius - 2 : lp.y + lp.nodeRadius + 2, x2: lp.x, y2: lp.preferTop ? fallbackY + 7 : fallbackY - 9 }]
          };
        }

        lp.labelX = bestPos.x; lp.labelY = bestPos.y; lp.isTop = bestPos.isTop;
        lp.connectorSegments = bestPos.segments;
        placedLabels.push(lp);
      }

      const realLabels = placedLabels.filter(l => !l.isObstacle);
      currentLabelData = { top: realLabels.filter(l => l.isTop), bottom: realLabels.filter(l => !l.isTop) };

      for (const lp of placedLabels) {
        if (lp.connectorSegments && lp.connectorSegments.length > 0) {
          let pathD = `M ${lp.connectorSegments[0].x1} ${lp.connectorSegments[0].y1}`;
          for (const seg of lp.connectorSegments) pathD += ` L ${seg.x2} ${seg.y2}`;
          labelsGroup.append("path")
            .attr("class", "label-connector").attr("data-label", lp.name)
            .attr("d", pathD).attr("fill", "none")
            .attr("stroke", "#9aa0a6").attr("stroke-width", 0.75).attr("stroke-opacity", 0.55);
        }
      }
      for (const lp of placedLabels) {
        if (lp.isObstacle) continue;
        labelsGroup.append("text")
          .attr("class", "label-text").attr("data-label", lp.name)
          .attr("x", lp.labelX).attr("y", lp.labelY).attr("text-anchor", "middle")
          .attr("font-size", labelFontSize).attr("font-family", TYP.ui).attr("font-weight", 600)
          .attr("fill", lp.color).text(lp.name);
      }
    }

    if (selectorCtrl) selectorCtrl.update();
  }

  updateChart();

  // ── Crosshair ──
  const crosshair = svg.append("line")
    .attr("class", "crosshair")
    .attr("y1", swarmTop - 8).attr("y2", xAxisY)
    .attr("stroke", "#9a9f9d").attr("stroke-width", 1).attr("stroke-dasharray", "3,3")
    .style("opacity", 0).style("pointer-events", "none");

  const highlightRing = svg.append("circle")
    .attr("class", "highlight-ring")
    .attr("fill", "none").attr("stroke", FARG.ink).attr("stroke-width", 2)
    .style("opacity", 0).style("pointer-events", "none");

  let hoveredNode = null;

  svg.append("rect")
    .attr("class", "overlay")
    .attr("x", marginLeft).attr("y", marginTop)
    .attr("width", autoWidth - marginLeft - marginRight).attr("height", height - marginTop - marginBottom)
    .attr("fill", "transparent").style("cursor", "default")
    .on("mouseenter", () => crosshair.style("opacity", 1))
    .on("mouseleave", () => {
      crosshair.style("opacity", 0);
      highlightRing.style("opacity", 0);
      if (hoveredNode) { highlightPoint(hoveredNode, false); hoveredNode = null; }
      avlasning.rensa();
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event);
      crosshair.attr("x1", mx).attr("x2", mx);
      let closest = null, minDist = Infinity;
      for (const node of nodes) {
        const dist = Math.hypot(mx - node.x, my - node.y);
        if (dist < minDist) { minDist = dist; closest = node; }
      }
      if (closest && minDist < 50) {
        const isHl = isHighlighted(closest);
        const dotColor = isHl ? (group ? getColor(closest[group]) : colors[0]) : "#888";
        highlightRing.attr("cx", closest.x).attr("cy", closest.y)
          .attr("r", (isHl ? highlightedR : backgroundR) + 3).attr("stroke", dotColor).style("opacity", 1);
        if (hoveredNode && hoveredNode !== closest) highlightPoint(hoveredNode, false);
        if (hoveredNode !== closest) highlightPoint(closest, true);
        hoveredNode = closest;
      } else {
        highlightRing.style("opacity", 0);
        if (hoveredNode) { highlightPoint(hoveredNode, false); hoveredNode = null; }
        avlasning.rensa();
      }
    });

  addExportButton(container, svg.node(), { title, subtitle, caption, width: autoWidth, height, altText, info, logo });

  return container.node();
}
