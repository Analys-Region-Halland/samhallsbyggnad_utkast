// =============================================================================
// STACKED AREA — Stackade areor över kategorisk x-axel (t.ex. åldersklasser)
// =============================================================================
// Varje staplad yta är en kategori (ex. hushållsställning). x-axeln är
// kategorisk (en unik ålder/klass per position).
//
// Byggd på grafRam:
//   • measures (t.ex. regioner) väljs i en knapp nere till vänster ("Region: …")
//   • toggle (Andel/Antal) är enheten och väljs i y-titeln ovanför axeln
//   • time (år) väljs i en rullgardin i nedre raden, bredvid region

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import {
  skapaRam, TYP, FARG, STORLEK,
  stilYAxel, stilXAxel, ritaGrid, xTitel, yTitel, yTitelPos,
  valPill, skapaTooltip, tooltipHtml
} from "../lib/grafRam.js";

export function stackedArea(initialData, {
  x = "x",
  y = "y",
  color = "color",
  colorOrder = null,            // array av color-värden i stacking-ordning
  xOrder = null,                // array av x-värden i stigande ordning
  colors = ["#FFD939", "#D6D6D6", "#FF5F4A", "#2DB8F6", "#004990", "#895B42", "#00AB60"],
  normalize = false,            // true → 100 % stacked
  width = null,
  height = 440,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  yLabel = null,
  formatY = null,
  rotateX = false,              // true → vinkla x-etiketterna -35° (långa kategorinamn)
  measures = null,              // [{label, data, subtitle?, normalize?, formatY?}] – t.ex. regioner
  toggle = null,                // [{label, normalize, formatY}] – enhet (Andel/Antal)
  measureLabel = "Region",      // etikett på measure-knappen i nedre raden
  altText = null,
  info = null,
  logo = null,
  time = null                   // fältnamn för år (t.ex. "ar") → årsrullgardin
} = {}) {

  // ==========================================================================
  // STATE
  // ==========================================================================
  let data = measures ? measures[0].data : initialData;
  let currentMeasureIdx = 0;
  let currentToggleIdx = 0;
  let currentNormalize = normalize;
  let currentFormatY = null;

  if (toggle && toggle.length > 0) {
    currentNormalize = toggle[0].normalize;
    if (typeof toggle[0].formatY === "function") currentFormatY = toggle[0].formatY;
  }
  if (measures && measures[0].normalize !== undefined && !toggle) currentNormalize = measures[0].normalize;
  if (measures && typeof measures[0].formatY === "function" && !toggle) currentFormatY = measures[0].formatY;

  const allYears = time
    ? [...new Set((measures ? measures.flatMap(m => m.data) : initialData).map(d => d[time]))]
        .filter(v => v != null).sort((a, b) => a - b)
    : [];
  let currentYear = allYears.length ? allYears[allYears.length - 1] : null;

  const baseDefaultFormat = normalize
    ? d => (d * 100).toFixed(0) + " %"
    : d => d.toLocaleString("sv-SE");
  if (currentFormatY === null) currentFormatY = formatY || baseDefaultFormat;
  const resolvedFormat = () => currentFormatY || (currentNormalize
    ? d => (d * 100).toFixed(0) + " %"
    : d => d.toLocaleString("sv-SE"));

  // ==========================================================================
  // LAYOUT
  // ==========================================================================
  const autoWidth = width || 820;
  const harYTitel = !!(yLabel || (toggle && toggle.length > 0));
  const marginTop = harYTitel ? 36 : 18;
  const marginRight = 240;
  const marginBottom = (rotateX ? 74 : 40) + (xLabel ? 14 : 0);
  const marginLeft = 18;
  const tickWidth = () => {
    const fmt = resolvedFormat();
    const sample = currentNormalize ? [1] : [1000000];
    return Math.max(34, Math.max(...sample.map(v => String(fmt(v)).length)) * 6.6 + 4);
  };
  let axisLeft = marginLeft + 46;
  const plotRight = autoWidth - marginRight;

  // ==========================================================================
  // RAM
  // ==========================================================================
  const subtitleText = () => {
    const m = measures ? measures[currentMeasureIdx] : null;
    let s = (m && m.subtitle) ? m.subtitle : subtitle;
    if (time && currentYear != null && s && !String(s).includes(String(currentYear))) s = `${s}, ${currentYear}`;
    else if (time && currentYear != null && !s) s = String(currentYear);
    return s;
  };
  const ram = skapaRam({ title, subtitle: subtitleText(), caption });
  const container = ram.container;
  const svg = ram.svg(autoWidth, height);
  const tooltip = skapaTooltip(ram.body);

  // Lager
  const gridGroup = svg.append("g").attr("class", "grid");
  const areasGroup = svg.append("g").attr("class", "areas");
  const xAxisGroup = svg.append("g").attr("class", "x-axis");
  const yAxisGroup = svg.append("g").attr("class", "y-axis");
  const overlayGroup = svg.append("g").attr("class", "overlay");
  const legendGroup = svg.append("g").attr("class", "legend");

  if (xLabel) xTitel(svg, { x: (axisLeft + plotRight) / 2, y: height - 8, text: xLabel });

  // Y-titel (enhet) – rullgardin vid toggle
  const yTitelText = () => toggle && toggle.length ? toggle[currentToggleIdx].label : (yLabel || "");
  let yt = null;
  if (harYTitel) {
    const pos = yTitelPos(marginLeft, marginTop);
    yt = yTitel(svg, {
      x: pos.x, y: pos.y, text: yTitelText(),
      options: toggle && toggle.length > 1 ? toggle.map(t => t.label) : null,
      activeIndex: 0, body: ram.body,
      onSelect: (i) => switchToggle(i)
    });
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================
  function render() {
    const activeData = (time && currentYear != null) ? data.filter(d => d[time] === currentYear) : data;
    const xValues = xOrder || [...new Set(activeData.map(d => d[x]))];
    const categories = colorOrder || [...new Set(activeData.map(d => d[color]))];

    const wide = xValues.map(xv => {
      const row = { _x: xv };
      for (const k of categories) {
        const m = activeData.find(d => d[x] === xv && d[color] === k);
        row[k] = m ? (m[y] || 0) : 0;
      }
      return row;
    });
    if (currentNormalize) {
      for (const row of wide) {
        const sum = categories.reduce((s, k) => s + row[k], 0);
        if (sum > 0) for (const k of categories) row[k] = row[k] / sum;
      }
    }

    const series = d3.stack().keys(categories).offset(d3.stackOffsetNone)(wide);
    const fmt = resolvedFormat();

    const yMax = currentNormalize ? 1 : d3.max(series, layer => d3.max(layer, d => d[1]));
    const yScale = d3.scaleLinear().domain([0, yMax]).nice().range([height - marginBottom, marginTop]);
    const yTicks = yScale.ticks(5);
    axisLeft = marginLeft + Math.max(...yTicks.map(t => String(fmt(t)).length)) * 6.6 + 10;

    const xScale = d3.scaleBand().domain(xValues).range([axisLeft, plotRight]).padding(0);
    const colorScale = d3.scaleOrdinal().domain(categories).range(colors);

    const areaGen = d3.area()
      .x((_, i) => xScale(xValues[i]) + xScale.bandwidth() / 2)
      .y0(d => yScale(d[0]))
      .y1(d => yScale(d[1]))
      .curve(d3.curveMonotoneX);

    const paths = areasGroup.selectAll("path").data(series, d => d.key);
    paths.exit().remove();
    paths.enter().append("path")
      .attr("fill-opacity", 0.92)
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5)
      .merge(paths)
      .attr("fill", d => colorScale(d.key))
      .transition().duration(500)
      .attr("d", areaGen);

    // X-axel
    const tickEvery = Math.ceil(xValues.length / 12);
    const shownTicks = xValues.filter((_, i) => i % tickEvery === 0);
    xAxisGroup
      .attr("transform", `translate(0, ${height - marginBottom})`)
      .call(d3.axisBottom(xScale).tickValues(shownTicks).tickSize(5));
    stilXAxel(xAxisGroup);
    if (rotateX) {
      xAxisGroup.selectAll(".tick text")
        .attr("transform", "rotate(-35)")
        .attr("text-anchor", "end")
        .attr("dy", "0.5em");
    }
    if (xLabel) svg.select(".graf-xtitel").attr("x", (axisLeft + plotRight) / 2);

    // Y-axel
    yAxisGroup
      .attr("transform", `translate(${axisLeft}, 0)`)
      .transition().duration(500)
      .call(d3.axisLeft(yScale).tickValues(yTicks).tickFormat(fmt))
      .on("end", () => stilYAxel(yAxisGroup));
    stilYAxel(yAxisGroup);

    // Grid
    ritaGrid(gridGroup, { ticks: yTicks.filter(t => t > 0), scale: yScale, x1: axisLeft, x2: plotRight, noll: null });

    // Legend (höger, i stackordning uppifrån)
    legendGroup.selectAll("*").remove();
    legendGroup.attr("transform", `translate(${plotRight + 16}, ${marginTop})`);
    [...categories].reverse().forEach((k, i) => {
      const g = legendGroup.append("g").attr("transform", `translate(0, ${i * 21})`);
      g.append("rect").attr("width", 11).attr("height", 11).attr("rx", 2).attr("fill", colorScale(k));
      g.append("text")
        .attr("x", 17).attr("y", 5.5).attr("dy", "0.35em")
        .attr("font-family", TYP.ui).attr("font-size", 11.5).attr("fill", FARG.ink)
        .text(k);
    });

    // Overlay-kolumner för hover
    overlayGroup.selectAll("*").remove();
    xValues.forEach((xv, i) => {
      overlayGroup.append("rect")
        .attr("x", xScale(xv)).attr("y", marginTop)
        .attr("width", xScale.bandwidth()).attr("height", height - marginBottom - marginTop)
        .attr("fill", "transparent")
        .style("cursor", "pointer")
        .on("mouseenter", function () { d3.select(this).attr("fill", "rgba(0,0,0,0.04)"); })
        .on("mouseleave", function () { tooltip.dolj(); d3.select(this).attr("fill", "transparent"); })
        .on("mousemove", function (event) {
          const row = wide[i];
          const rader = categories.slice().reverse().map(k => ({ namn: k, varde: fmt(row[k]), farg: colorScale(k) }));
          const b = ram.body.node().getBoundingClientRect();
          tooltip.visa(tooltipHtml(xv, rader), { x: event.clientX - b.left, y: event.clientY - b.top });
        });
    });
  }

  // ==========================================================================
  // VÄXLINGAR
  // ==========================================================================
  function switchMeasure(idx) {
    if (!measures || idx === currentMeasureIdx) return;
    currentMeasureIdx = idx;
    const m = measures[idx];
    data = m.data;
    if (!toggle) {
      if (m.normalize !== undefined) currentNormalize = m.normalize;
      if (typeof m.formatY === "function") currentFormatY = m.formatY;
    }
    ram.setSubtitle(subtitleText());
    render();
  }

  function switchToggle(idx) {
    if (!toggle || idx === currentToggleIdx) return;
    currentToggleIdx = idx;
    const t = toggle[idx];
    currentNormalize = t.normalize;
    currentFormatY = typeof t.formatY === "function" ? t.formatY
      : (t.normalize ? d => (d * 100).toFixed(0) + " %" : d => d.toLocaleString("sv-SE"));
    if (yt) yt.set(yTitelText(), idx);
    render();
  }

  // Region-knapp (nedre raden, vänster)
  if (measures && measures.length > 1) {
    valPill(ram.controlsLeft, {
      label: measureLabel,
      options: measures.map(m => m.label),
      activeIndex: 0,
      body: ram.body,
      onSelect: (i) => switchMeasure(i)
    });
  }

  // År (nedre raden, rullgardin)
  if (time && allYears.length > 1) {
    valPill(ram.controlsLeft, {
      label: "År", options: allYears.map(String), activeIndex: allYears.indexOf(currentYear), body: ram.body,
      onSelect: (i) => { currentYear = allYears[i]; ram.setSubtitle(subtitleText()); render(); }
    });
  }

  render();

  addExportButton(container, svg.node(), { title, subtitle, caption, width: autoWidth, height, altText, info, logo });

  return container.node();
}
