// =============================================================================
// LINJEDIAGRAM — tidsserier med highlight och måttväxling.
//
// Byggd på den gemensamma ramen (js/lib/grafRam.js):
//   • y-titeln ligger horisontellt ovanför axeln och är en rullgardin när
//     grafen har flera mått (measures)
//   • regionväljaren är en knapp i samma nedre rad
//   • tooltip, gridlinjer, axlar och etiketter följer grafsystemet
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { createFilterState, createSelectorPanel } from "../lib/filterUtils.js";
import {
  skapaRam, TYP, FARG, STORLEK, SERIEFARGER,
  stilYAxel, stilXAxel, ritaGrid, xTitel, yTitel, yTitelPos,
  skapaTooltip, tooltipHtml, matText, axelFmt, ritbredd, arSmal } from "../lib/grafRam.js";

// Direktetiketter: längre namn än ETIKETT_MAX bryts på två rader
let ETIKETT_MAX = 170;
const etikettBredd = (t) => matText(String(t), { size: STORLEK.etikett, weight: 500 });
function etikettRader(t) {
  const txt = String(t);
  if (etikettBredd(txt) <= ETIKETT_MAX) return [txt];
  const ord = txt.split(" ");
  let bast = [txt], bastW = Infinity;
  for (let i = 1; i < ord.length; i++) {
    const a = ord.slice(0, i).join(" "), b = ord.slice(i).join(" ");
    const w = Math.max(etikettBredd(a), etikettBredd(b));
    if (w < bastW) { bastW = w; bast = [a, b]; }
  }
  return bast;
}

// ── Skalhjälpare: jämna ticks (d3.ticks) som täcker datan ──
// Returnerar { min, max, ticks }. Ticks omsluter alltid datan: en gridlinje
// ovanför högsta och (vid fri nedre gräns) under lägsta värdet.
function niceScaleRange(dataMin, dataMax, targetTicks = 5) {
  if (!(dataMax > dataMin)) return { min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10] };
  let ticks = d3.ticks(dataMin, dataMax, targetTicks);
  if (ticks.length < 2) ticks = d3.ticks(dataMin, dataMax, targetTicks + 2);
  const step = ticks[1] - ticks[0];
  while (ticks[0] > dataMin) ticks.unshift(Math.round((ticks[0] - step) * 1e9) / 1e9);
  while (ticks[ticks.length - 1] < dataMax) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 1e9) / 1e9);
  return { min: ticks[0], max: ticks[ticks.length - 1], interval: step, ticks };
}

function niceScaleFromZero(dataMax, targetTicks = 5) {
  if (!(dataMax > 0)) return { min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10] };
  let ticks = d3.ticks(0, dataMax, targetTicks);
  if (ticks.length < 2) ticks = d3.ticks(0, dataMax, targetTicks + 2);
  const step = ticks[1] - ticks[0];
  while (ticks[ticks.length - 1] < dataMax) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 1e9) / 1e9);
  return { min: 0, max: ticks[ticks.length - 1], interval: step, ticks };
}

// Icke-överlappande etikettstapling
function placeLabels(endpoints, minSpacing, top, bottom) {
  const arr = endpoints
    .map(ep => ({ ...ep, idealY: ep.yPos, labelY: ep.yPos }))
    .sort((a, b) => a.idealY - b.idealY);
  // avstånd mellan två etiketters mittpunkter (tvåradiga etiketter tar mer plats)
  const avst = (a, b) => minSpacing * ((a.rader || 1) + (b.rader || 1)) / 2;
  for (let i = 0; i < arr.length; i++) {
    let y = arr[i].idealY;
    if (i > 0) y = Math.max(y, arr[i - 1].labelY + avst(arr[i - 1], arr[i]));
    arr[i].labelY = y;
  }
  if (arr.length && arr[arr.length - 1].labelY > bottom) {
    arr[arr.length - 1].labelY = bottom;
    for (let i = arr.length - 2; i >= 0; i--) {
      if (arr[i].labelY > arr[i + 1].labelY - avst(arr[i], arr[i + 1])) arr[i].labelY = arr[i + 1].labelY - avst(arr[i], arr[i + 1]);
    }
  }
  for (let i = 0; i < arr.length; i++) arr[i].labelY = Math.max(top, arr[i].labelY);
  return arr;
}

export function linjediagram(initialData, {
  x = "år",
  y = "värde",
  color = null,
  width = null,
  height = 500,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  yLabel = null,
  colors = SERIEFARGER,
  formatY = d => d.toLocaleString("sv-SE"),
  formatX = null,           // valfri formatering av x-axelns tickar (default heltal, t.ex. årtal)
  labels = "end",           // "end" = direktetiketter vid linjeslutet; "legend-br"/"legend-tl" = teckenförklaring
                            // inne i diagramytan (nere till höger / uppe till vänster), t.ex. för kurvor som
                            // slutar i samma värde (kumulativa andelar) där slutetiketter krockar
  curve = d3.curveMonotoneX,
  filter = null,
  highlight = null,
  backgroundOpacity = 0.45,
  backgroundStrokeWidth = 1.1,
  yMin = 0,                 // 0, "auto" eller ett tal
  altText = null,
  info = null,
  hline = null,             // tal eller {value, label, color, dashed}
  vline = null,             // tal eller {value, label, color, dashed}
  logo = null,
  showGrid = true,
  interactive = false,      // regionväljare i nedre raden
  maxHighlights = 6,
  rescaleY = false,         // omskalera y efter synliga serier
  measures = null           // [{key, label, filterLabel?, description?, subtitle?, data, yLabel?, yMin?, hline?, formatY?}]
} = {}) {

  // ── Måttläge (mutabelt) ──
  let data = measures ? measures[0].data : initialData;
  let currentMeasureIdx = 0;
  const applyMeasure = (m) => {
    if (!m) return;
    if (m.formatY) formatY = m.formatY;
    if (m.yMin !== undefined) yMin = m.yMin;
    if (m.hline !== undefined) hline = m.hline;
    if (m.yLabel || m.filterLabel || m.label) yLabel = m.yLabel || m.filterLabel || m.label;
  };
  if (measures) applyMeasure(measures[0]);
  const measureSubtitle = (m) => (m && m.subtitle) ? m.subtitle : subtitle;

  // ── Layout ──
  const autoWidth = width || ritbredd(780);
  if (arSmal(autoWidth)) ETIKETT_MAX = 110;   // smal skärm: kortare etikettkolumn, fler radbrytningar
  const harYTitel = !!(yLabel || (measures && measures.length > 1));
  const marginTop = harYTitel ? 36 : 18;
  // Högermarginalen rymmer den bredaste direktetiketten som kan visas
  // (alla serier om grafen är interaktiv, annars de markerade).
  let marginRight = 28;
  if (labels === "end" && color) {
    const allaNycklar = [...new Set((measures ? measures.flatMap(m => m.data) : initialData).map(d => d[color]))];
    const kandidater = interactive || !highlight ? allaNycklar
      : allaNycklar.filter(k => [].concat(highlight).includes(k)).concat([].concat(highlight).filter(k => !allaNycklar.includes(k)).length ? allaNycklar : []);
    const bredast = Math.max(40, ...kandidater.map(k => Math.max(...etikettRader(k).map(etikettBredd))));
    marginRight = Math.round(Math.min(ETIKETT_MAX, bredast) + 26);
  }
  const marginBottom = xLabel ? 46 : 30;
  const marginLeft = 18;

  // ── Ram ──
  const ram = skapaRam({ title, subtitle: measures ? measureSubtitle(measures[0]) : subtitle, caption });
  const container = ram.container;
  const svg = ram.svg(autoWidth, height);
  const tooltip = skapaTooltip(ram.body);

  // ── Tidsintervall ──
  let allXValues = [...new Set(data.map(d => d[x]))].sort((a, b) => a - b);
  let currentStartYear = allXValues[0];
  let currentEndYear = allXValues[allXValues.length - 1];

  // ── Grupper och filter ──
  let groups = color ? d3.group(data, d => d[color]) : new Map([["_all", data]]);
  let allKeys = [...groups.keys()];
  const filterState = color
    ? createFilterState(data, { itemField: color, groupField: null, filter, highlight })
    : null;
  const isHighlighted = (key) => !filterState || filterState.isHighlighted(key);

  const mutedColor = FARG.dampad;
  const otherColor = "#7a8b99";
  const getColor = (key) => {
    const hl = filterState ? filterState.getHighlight() : null;
    if (!hl) return colors[allKeys.indexOf(key) % colors.length];
    const idx = hl.indexOf(key);
    if (idx < 0) return mutedColor;
    if (idx < colors.length) return colors[idx];
    return otherColor;
  };
  const colorScale = (key) => getColor(key);

  // ── Skalor ──
  const computeYNice = (rows) => {
    const dataMax = d3.max(rows, d => d[y]);
    const dataMinVal = d3.min(rows, d => d[y]);
    if (yMin === "auto") return niceScaleRange(dataMinVal, dataMax, 5);
    if (typeof yMin === "number") return niceScaleRange(Math.min(yMin, dataMinVal), dataMax, 5);
    return niceScaleFromZero(dataMax, 5);
  };
  let yNice = computeYNice(data);

  const tickWidth = () => Math.max(...yNice.ticks.map(t => String(formatY(t)).length)) * 6.6 + 8;
  let axisLeft = marginLeft + tickWidth();
  const plotRight = autoWidth - marginRight;

  const xScale = d3.scaleLinear().range([axisLeft, plotRight]);
  const yScale = d3.scaleLinear().domain([yNice.min, yNice.max]).range([height - marginBottom, marginTop]);
  const xDomain = () => [currentStartYear, currentEndYear];
  xScale.domain(xDomain());

  // ── Lager (ordning = ritordning) ──
  const gridGroup = svg.append("g").attr("class", "grid-lines");
  const hlineGroup = svg.append("g").attr("class", "hline-group");
  const vlineGroup = svg.append("g").attr("class", "vline-group");
  const xAxisGroup = svg.append("g").attr("class", "x-axis").attr("transform", `translate(0,${height - marginBottom})`);
  const yAxisGroup = svg.append("g").attr("class", "y-axis");
  const linesGroup = svg.append("g").attr("class", "lines-group");
  const labelsGroup = svg.append("g").attr("class", "line-labels");

  if (xLabel) xTitel(svg, { x: axisLeft + (plotRight - axisLeft) / 2, y: height - 8, text: xLabel });

  // Y-titel (horisontell, valbar vid flera mått)
  let yt = null;
  if (harYTitel) {
    const pos = yTitelPos(marginLeft, marginTop);
    yt = yTitel(svg, {
      x: pos.x, y: pos.y, text: yLabel || "",
      options: measures && measures.length > 1
        ? measures.map(m => ({ label: m.filterLabel || m.label, description: m.description || null }))
        : null,
      activeIndex: 0,
      body: ram.body,
      onSelect: (i) => switchMeasure(i)
    });
  }

  // ── Axlar och grid ──
  function renderYAxis(animate = false) {
    const axis = d3.axisLeft(yScale).tickFormat(axelFmt(formatY)).tickValues(yNice.ticks);
    yAxisGroup.attr("transform", `translate(${axisLeft},0)`);
    if (animate) {
      yAxisGroup.transition().duration(400).call(axis).on("end", () => stilYAxel(yAxisGroup));
    } else {
      yAxisGroup.call(axis);
    }
    // stilen sätts direkt på nya element (och igen efter transition)
    stilYAxel(yAxisGroup);
    if (showGrid) ritaGrid(gridGroup, { ticks: yNice.ticks, scale: yScale, x1: axisLeft, x2: plotRight, noll: 0 });
    else gridGroup.selectAll("*").remove();
  }

  function renderXAxis(animate = false) {
    const [d0, d1] = xScale.domain();
    const span = Math.max(1, d1 - d0);
    const axis = d3.axisBottom(xScale).tickFormat(formatX || d3.format("d")).ticks(Math.min(10, span, Math.max(3, Math.floor((plotRight - axisLeft) / 56)))).tickSize(5);
    const g = animate ? xAxisGroup.transition().duration(300) : xAxisGroup;
    g.call(axis);
    stilXAxel(xAxisGroup);
    if (animate) xAxisGroup.transition().duration(300).on("end", () => stilXAxel(xAxisGroup));
  }

  function renderHline() {
    hlineGroup.selectAll("*").remove();
    if (hline === null || hline === undefined) return;
    const c = typeof hline === "number" ? { value: hline } : hline;
    if (c.value < yNice.min || c.value > yNice.max) return;
    const hy = yScale(c.value);
    const col = c.color || FARG.noll;
    hlineGroup.append("line")
      .attr("x1", axisLeft).attr("x2", plotRight).attr("y1", hy).attr("y2", hy)
      .attr("stroke", col).attr("stroke-width", 1)
      .attr("stroke-dasharray", c.dashed === true ? "6,4" : "none");
    if (c.label) {
      hlineGroup.append("text")
        .attr("x", plotRight + 6).attr("y", hy).attr("dy", "0.35em")
        .attr("font-family", TYP.ui).attr("font-size", 10.5).attr("font-weight", 500)
        .attr("fill", col).text(c.label);
    }
  }

  function renderVline() {
    vlineGroup.selectAll("*").remove();
    if (vline === null || vline === undefined) return;
    const c = typeof vline === "number" ? { value: vline } : vline;
    const [d0, d1] = xScale.domain();
    if (c.value < d0 || c.value > d1) return;
    const vx = xScale(c.value);
    const col = c.color || FARG.text;
    vlineGroup.append("line")
      .attr("x1", vx).attr("x2", vx).attr("y1", marginTop).attr("y2", height - marginBottom)
      .attr("stroke", col).attr("stroke-width", 1)
      .attr("stroke-dasharray", c.dashed === false ? "none" : "4,3").attr("stroke-opacity", 0.7);
    if (c.label) {
      vlineGroup.append("text")
        .attr("x", vx + 6).attr("y", marginTop + 12)
        .attr("font-family", TYP.ui).attr("font-size", 11).attr("font-weight", 500)
        .attr("fill", col).text(c.label);
    }
  }

  const line = d3.line()
    .defined(d => d[y] != null && !Number.isNaN(+d[y]))
    .x(d => xScale(d[x]))
    .y(d => yScale(d[y]))
    .curve(curve);

  // Data för en serie inom aktuellt intervall
  // Sista punkten med ett faktiskt värde (serier kan sluta med saknade år)
  const sistaVarde = (rows) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][y] != null && !Number.isNaN(+rows[i][y])) return rows[i]; return rows[rows.length - 1]; };
  const serieData = (values) => [...values]
    .filter(d => d[x] >= currentStartYear && d[x] <= currentEndYear)
    .sort((a, b) => a[x] - b[x]);

  // ── Omskalning av y efter synliga serier ──
  function rescaleYAxis(force = false) {
    if (!rescaleY && !force) return;
    const hiddenSet = new Set(filterState ? filterState.getHidden() : []);
    const hl = filterState ? filterState.getHighlight() : null;
    let visible;
    if (force || !hl || hl.length === 0) {
      visible = data.filter(d => !hiddenSet.has(d[color]) && d[x] >= currentStartYear && d[x] <= currentEndYear);
    } else {
      const hlSet = new Set(hl);
      visible = data.filter(d => hlSet.has(d[color]) && !hiddenSet.has(d[color]) && d[x] >= currentStartYear && d[x] <= currentEndYear);
    }
    if (visible.length === 0) return;
    yNice = computeYNice(visible);
    yScale.domain([yNice.min, yNice.max]);
    renderYAxis(true);
    renderHline();
  }

  // ── Linjer och direktetiketter ──
  function renderLines() {
    linesGroup.selectAll("*").remove();
    labelsGroup.selectAll("*").remove();
    const endpoints = [];

    // bakgrundslinjer först
    for (const [key, values] of groups) {
      if (isHighlighted(key)) continue;
      if (filterState && filterState.isHidden(key)) continue;
      const rows = serieData(values);
      if (rows.length < 2) continue;
      linesGroup.append("path")
        .datum(rows)
        .attr("class", "line-bg").attr("data-key", key)
        .attr("fill", "none").attr("stroke", "#b9bdbb")
        .attr("stroke-width", backgroundStrokeWidth)
        .attr("stroke-opacity", backgroundOpacity)
        .attr("d", line);
    }

    // markerade linjer ovanpå
    for (const [key, values] of groups) {
      if (!isHighlighted(key)) continue;
      if (filterState && filterState.isHidden(key)) continue;
      const rows = serieData(values);
      if (rows.length < 2) continue;
      const lineColor = colorScale(key);
      linesGroup.append("path")
        .datum(rows)
        .attr("class", "line-highlight").attr("data-key", key)
        .attr("fill", "none").attr("stroke", lineColor)
        .attr("stroke-width", 2.2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round")
        .attr("d", line);
      const last = sistaVarde(rows);
      linesGroup.append("circle")
        .attr("class", "endpoint").attr("data-key", key)
        .attr("cx", xScale(last[x])).attr("cy", yScale(last[y]))
        .attr("r", 3.6).attr("fill", lineColor);
      endpoints.push({ key, xPos: xScale(last[x]), yPos: yScale(last[y]), yVal: last[y], color: lineColor, rader: etikettRader(key).length });
    }

    // direktetiketter med kopplingslinjer (bara när serierna har namn).
    // Etikettkolumnen följer det högraste linjeslutet (under uppspelning
    // vandrar den med), så kopplingslinjerna aldrig blir långa streck.
    if (endpoints.length > 0 && color && labels !== "end") {
      // Teckenförklaring inne i ytan: en rad per markerad serie, i markeringsordning
      const hl = filterState ? (filterState.getHighlight() || []) : [];
      const ordning = [...endpoints].sort((a, b) => {
        const ia = hl.indexOf(a.key), ib = hl.indexOf(b.key);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
      const radH = 18, pad = 8, linjeW = 18;
      const textW = Math.max(...ordning.map(e => String(e.key).length)) * 6.6;
      const boxW = pad * 2 + linjeW + 8 + textW, boxH = pad * 2 + ordning.length * radH - 4;
      const bx = labels === "legend-tl" ? axisLeft + 10 : plotRight - boxW - 4;
      const by = labels === "legend-tl" ? marginTop + 8 : height - marginBottom - boxH - 8;
      const lg = labelsGroup.append("g").attr("class", "line-legend").attr("transform", `translate(${bx},${by})`);
      lg.append("rect").attr("width", boxW).attr("height", boxH).attr("rx", 6)
        .attr("fill", "#ffffff").attr("fill-opacity", 0.9).attr("stroke", "#e3e5e4");
      ordning.forEach((e, i) => {
        const yy = pad + i * radH + 6;
        lg.append("line").attr("x1", pad).attr("x2", pad + linjeW).attr("y1", yy).attr("y2", yy)
          .attr("stroke", e.color).attr("stroke-width", 2.6).attr("stroke-linecap", "round");
        lg.append("text").attr("x", pad + linjeW + 8).attr("y", yy).attr("dy", "0.35em")
          .attr("font-family", TYP.ui).attr("font-size", STORLEK.etikett).attr("font-weight", 500)
          .attr("fill", FARG.text).text(e.key);
      });
    } else if (endpoints.length > 0 && color) {
      const minSpacing = 16;
      const placed = placeLabels(endpoints, minSpacing, marginTop + 6, height - marginBottom - 6);
      const endX = Math.min(plotRight, Math.max(...endpoints.map(e => e.xPos)));
      const connStart = endX + 6;
      const labelX = endX + 14;
      for (const lp of placed) {
        const fromX = lp.xPos + 6;
        const bend = Math.abs(lp.labelY - lp.yPos) > 2;
        labelsGroup.append("path")
          .attr("d", bend
            ? `M${fromX},${lp.yPos} H${connStart} L${connStart + 4},${lp.labelY} H${labelX - 3}`
            : `M${fromX},${lp.yPos} H${labelX - 3}`)
          .attr("fill", "none").attr("stroke", lp.color)
          .attr("stroke-width", 1).attr("stroke-opacity", 0.45);
        const rader = etikettRader(lp.key);
        const t = labelsGroup.append("text")
          .attr("x", labelX).attr("y", lp.labelY - (rader.length - 1) * 7).attr("dy", "0.35em")
          .attr("font-family", TYP.ui).attr("font-size", STORLEK.etikett)
          .attr("font-weight", 500).attr("fill", lp.color);
        rader.forEach((r, i) => t.append("tspan").attr("x", labelX).attr("dy", i ? "1.15em" : "0.35em").text(r));
        t.attr("dy", null);
      }
    }

    if (selectorCtrl) selectorCtrl.update();
  }

  function updateChart() {
    rescaleYAxis();
    renderLines();
  }

  function updateRange() {
    xScale.domain(xDomain());
    renderXAxis(true);
    renderVline();
    renderLines();
  }

  // ── Byte av mått ──
  function switchMeasure(idx) {
    if (!measures || idx === currentMeasureIdx || idx < 0 || idx >= measures.length) return;
    currentMeasureIdx = idx;
    const m = measures[idx];
    data = m.data;
    applyMeasure(m);
    ram.setSubtitle(measureSubtitle(m));

    groups = color ? d3.group(data, d => d[color]) : new Map([["_all", data]]);
    allKeys = [...groups.keys()];

    allXValues = [...new Set(data.map(d => d[x]))].sort((a, b) => a - b);
    currentStartYear = Math.max(currentStartYear, allXValues[0]);
    currentEndYear = Math.min(currentEndYear, allXValues[allXValues.length - 1]);

    yNice = computeYNice(data);
    yScale.domain([yNice.min, yNice.max]);
    axisLeft = marginLeft + tickWidth();
    xScale.range([axisLeft, plotRight]).domain(xDomain());
    if (yt) yt.set(yLabel || "", idx);
    renderYAxis(false);
    renderXAxis(false);
    updateRange();
    // overlay följer den nya plotytan
    svg.select(".overlay").attr("x", axisLeft).attr("width", plotRight - axisLeft);
    crosshair.style("opacity", 0);
    renderHline();
    renderVline();
    updateChart();
  }

  // ── Regionväljare (nedre raden, vänster) ──
  let selectorCtrl = null;
  if (interactive && color && filterState) {
    selectorCtrl = createSelectorPanel(ram.controlsLeft, {
      filterState,
      allItems: allKeys,
      colorScale,
      triggerText: "Jämför regioner",
      onUpdate: () => { rescaleYAxis(true); updateChart(); },
      onItemHover: (item) => {
        const hoverColor = isHighlighted(item) ? colorScale(item) : "#555";
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
          const rows = serieData(groups.get(item) || []);
          if (rows.length) {
            const last = sistaVarde(rows);
            labelsGroup.selectAll(".hover-label").remove();
            labelsGroup.append("circle").attr("class", "hover-label")
              .attr("cx", xScale(last[x])).attr("cy", yScale(last[y])).attr("r", 4).attr("fill", hoverColor);
            labelsGroup.append("text").attr("class", "hover-label")
              .attr("x", xScale(last[x]) + 8).attr("y", yScale(last[y])).attr("dy", "0.35em")
              .attr("font-family", TYP.ui).attr("font-size", 11).attr("font-weight", 600)
              .attr("fill", hoverColor).text(item);
          }
        }
      },
      onItemLeave: () => {
        linesGroup.selectAll("path").each(function () {
          const el = d3.select(this);
          const key = el.attr("data-key");
          if (el.classed("line-highlight")) el.attr("stroke-width", 2.2).attr("stroke-opacity", 1).attr("stroke", colorScale(key));
          else el.attr("stroke-width", backgroundStrokeWidth).attr("stroke-opacity", backgroundOpacity).attr("stroke", "#b9bdbb");
        });
        linesGroup.selectAll("circle").attr("fill-opacity", 1);
        labelsGroup.selectAll(".hover-label").remove();
      }
    });
  }

  // ── Första rendering ──
  renderYAxis(false);
  renderXAxis(false);
  renderHline();
  renderVline();
  renderLines();

  // ── Crosshair och tooltip ──
  const crosshair = svg.append("line")
    .attr("class", "crosshair")
    .attr("y1", marginTop).attr("y2", height - marginBottom)
    .attr("stroke", "#9a9f9d").attr("stroke-width", 1).attr("stroke-dasharray", "3,3")
    .style("opacity", 0).style("pointer-events", "none");
  const highlights = svg.append("g").attr("class", "highlights");
  let lastFocusedKey = null;

  const resetLineStyle = () => {
    linesGroup.selectAll("path").each(function () {
      const el = d3.select(this);
      const key = el.attr("data-key");
      if (el.classed("line-highlight")) el.attr("stroke-width", 2.2).attr("stroke-opacity", 1).attr("stroke", colorScale(key));
      else el.attr("stroke-width", backgroundStrokeWidth).attr("stroke-opacity", backgroundOpacity).attr("stroke", "#b9bdbb");
    });
  };

  svg.append("rect")
    .attr("class", "overlay")
    .attr("x", axisLeft).attr("y", marginTop - 16)
    .attr("width", plotRight - axisLeft).attr("height", height - marginTop - marginBottom + 32)
    .attr("fill", "transparent")
    .on("mouseenter", () => { crosshair.style("opacity", 1); })
    .on("mouseleave", () => {
      crosshair.style("opacity", 0);
      highlights.selectAll("*").remove();
      tooltip.dolj();
      lastFocusedKey = null;
      resetLineStyle();
    })
    .on("click", () => {
      if (lastFocusedKey && filterState) { filterState.toggle(lastFocusedKey); updateChart(); }
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event);
      const xValue = xScale.invert(mx);
      const xs = allXValues.filter(v => v >= currentStartYear && v <= currentEndYear);
      if (!xs.length) return;
      const closestX = xs.reduce((p, c) => Math.abs(c - xValue) < Math.abs(p - xValue) ? c : p);
      const xPos = xScale(closestX);
      crosshair.attr("x1", xPos).attr("x2", xPos);

      const allValues = [];
      for (const [key, rows] of groups) {
        if (filterState && filterState.isHidden(key)) continue;
        const p = rows.find(d => d[x] === closestX);
        if (p && p[y] != null) allValues.push({
          key: key === "_all" ? "" : key, value: p[y], yPos: yScale(p[y]),
          color: colorScale(key), highlighted: isHighlighted(key)
        });
      }

      let focusedKey = null, focusedIsGray = false, minDist = Infinity;
      for (const v of allValues) {
        const dist = Math.abs(v.yPos - my);
        if (dist < minDist && dist < 20) { minDist = dist; focusedKey = v.key; focusedIsGray = !v.highlighted; }
      }
      lastFocusedKey = focusedKey;
      d3.select(this).style("cursor", focusedKey && filterState ? "pointer" : "default");

      // linjestil vid fokus
      linesGroup.selectAll("path").each(function () {
        const el = d3.select(this);
        const key = el.attr("data-key");
        if (!focusedKey) {
          if (el.classed("line-highlight")) el.attr("stroke-width", 2.2).attr("stroke-opacity", 1).attr("stroke", colorScale(key));
          else el.attr("stroke-width", backgroundStrokeWidth).attr("stroke-opacity", backgroundOpacity).attr("stroke", "#b9bdbb");
        } else if (key === focusedKey) {
          el.attr("stroke-width", 2.8).attr("stroke-opacity", 1).attr("stroke", focusedIsGray ? "#555" : colorScale(key));
        } else if (isHighlighted(key)) {
          el.attr("stroke-width", 1.8).attr("stroke-opacity", 0.5);
        } else {
          el.attr("stroke-width", 1).attr("stroke-opacity", 0.12);
        }
      });

      const values = allValues.filter(v => v.highlighted).sort((a, b) => b.value - a.value);
      const rader = values.map(v => ({
        namn: v.key || (yLabel || ""), varde: formatY(v.value), farg: v.color,
        fokus: v.key === focusedKey && !focusedIsGray
      }));
      let extra = null;
      if (focusedIsGray && focusedKey) {
        const g = allValues.find(v => v.key === focusedKey);
        if (g) rader.push({ namn: g.key, varde: formatY(g.value), farg: "#555", dampad: true });
        extra = "Klicka för att markera";
      }
      tooltip.visa(tooltipHtml(closestX, rader, { extra }), {
        x: (() => {
          const s = svg.node().getBoundingClientRect(), b = ram.body.node().getBoundingClientRect();
          return s.left - b.left + xPos * (s.width / autoWidth);
        })(),
        y: (() => {
          const s = svg.node().getBoundingClientRect(), b = ram.body.node().getBoundingClientRect();
          return s.top - b.top + my * (s.height / height);
        })()
      });

      // markörer vid crosshair
      highlights.selectAll("*").remove();
      if (focusedIsGray && focusedKey) {
        const g = allValues.find(v => v.key === focusedKey);
        if (g) {
          highlights.append("circle").attr("cx", xPos).attr("cy", g.yPos).attr("r", 4).attr("fill", "#555").style("pointer-events", "none");
          const rows = serieData(groups.get(focusedKey) || []);
          if (rows.length) {
            const last = sistaVarde(rows);
            highlights.append("circle").attr("cx", xScale(last[x])).attr("cy", yScale(last[y])).attr("r", 4).attr("fill", "#555").style("pointer-events", "none");
            highlights.append("text").attr("x", xScale(last[x]) + 8).attr("y", yScale(last[y])).attr("dy", "0.35em")
              .attr("font-family", TYP.ui).attr("font-size", 11).attr("font-weight", 600).attr("fill", "#555")
              .text(focusedKey).style("pointer-events", "none");
          }
        }
      }
      for (const v of values) {
        const isFocused = v.key === focusedKey && !focusedIsGray;
        highlights.append("circle")
          .attr("cx", xPos).attr("cy", v.yPos).attr("r", isFocused ? 5 : 3.5)
          .attr("fill", v.color).attr("stroke", "#fff").attr("stroke-width", 1.5)
          .style("pointer-events", "none");
      }
    });

  addExportButton(container, svg.node(), { title, subtitle, caption, width: autoWidth, height, altText, info, logo });

  return container.node();
}
