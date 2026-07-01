// =============================================================================
// FACET-LINJER — sammanhållna små multiplar (en panel per facet), linjer per
// serie över tid. Fri eller delad y per panel, delad x (år).
//
// v2: mått-växling (t.ex. Antal/Andel), interaktiv (per-panel hover-avläsning +
// klickbar färgchips-legend i SVG med överstrykning vid nedtoning, ersätter
// statisk legendruta). Region Halland-estetik.
// =============================================================================
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";

export function facetLinjer(initialData, {
  facet = "facet",
  x = "år",
  y = "värde",
  series = "serie",
  facetOrder = null,
  seriesOrder = null,
  colors = ["#00664D", "#0C8C7E", "#FF7E00", "#1A7BB0", "#433C9D", "#A51300"],
  columns = 3,
  width = 880,
  plotH = 120,
  shareY = false,
  title = null,
  subtitle = null,
  caption = null,
  formatY = d => d.toLocaleString("sv-SE"),
  formatEnd = null,
  curve = d3.curveMonotoneX,
  measures = null,           // [{key,label,data,formatY,formatEnd,shareY,note}]
  interactive = true,
  logo = null,
  altText = null,
  info = null
} = {}) {
  const SANS = "'IBM Plex Sans', sans-serif";

  // ── Mutabelt mått-tillstånd ──
  let mIdx = 0;
  const M = measures ? measures[mIdx] : null;
  let data = M ? M.data : initialData;
  let curFormatY = (M && M.formatY) ? M.formatY : formatY;
  let curFormatEnd = (M && M.formatEnd) ? M.formatEnd : (formatEnd || curFormatY);
  let curShareY = (M && M.shareY !== undefined) ? M.shareY : shareY;

  const facets = facetOrder || [...new Set(initialData.map(d => d[facet]))];
  const seriesList = seriesOrder || [...new Set(initialData.map(d => d[series]))];
  const colorFor = s => colors[seriesList.indexOf(s) % colors.length];
  const muted = new Set();   // nedtonade (överstrukna) serier

  const xs = [...new Set(initialData.map(d => +d[x]))].sort((a, b) => a - b);
  const xMinV = xs[0], xMaxV = xs[xs.length - 1];

  // ── Layout ──
  const cols = Math.min(columns, facets.length);
  const rows = Math.ceil(facets.length / cols);
  const legendH = 30;
  const panelTitleH = 20;
  const xAxisH = 24;
  const mL = 46, mR = 52, colGap = 14, rowGap = 18;
  const panelOuterW = (width - colGap * (cols - 1)) / cols;
  const plotW = panelOuterW - mL - mR;
  const panelOuterH = panelTitleH + plotH + xAxisH;
  const svgH = legendH + rows * panelOuterH + rowGap * (rows - 1) + 6;

  function niceTop(maxV) {
    if (!(maxV > 0)) return { max: 10, ticks: [0, 5, 10] };
    const raw = maxV / 3;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
    const top = Math.ceil(maxV / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step * 0.01; v += step) ticks.push(v);
    return { max: top, ticks };
  }

  // ── Container + header ──
  const container = d3.create("div").attr("class", "graf-container").style("position", "relative");
  const header = container.append("div").attr("class", "graf-header");
  if (title) header.append("div").attr("class", "graf-title").text(title);

  // Undertitel med klickbar mått-växlare (cyklar) + statisk text
  let subtitleValSpan = null;
  if (subtitle || measures) {
    const sub = header.append("div").attr("class", "graf-subtitle").style("font-family", SANS);
    if (measures && measures.length > 1) {
      subtitleValSpan = sub.append("span")
        .style("cursor", "pointer")
        .style("font-weight", "600")
        .style("color", "#1a1a1a")
        .style("border-bottom", "1px dotted #999")
        .text(measures[mIdx].label)
        .on("click", () => { mIdx = (mIdx + 1) % measures.length; switchMeasure(); });
      sub.append("span").text(" ⇅ ").style("color", "#999").style("font-size", "11px");
      sub.append("span").attr("class", "facet-sub-rest").text(subtitle ? subtitle : "");
    } else if (subtitle) {
      sub.append("span").text(subtitle);
    }
  }

  const svgWrap = container.append("div").attr("class", "graf-svg-container");
  const svg = svgWrap.append("svg")
    .attr("viewBox", `0 0 ${width} ${svgH}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  // ── Interaktiv färgchips-legend i SVG (ersätter legendruta; klick = överstryk/tona) ──
  const legendG = svg.append("g").attr("class", "facet-legend");
  function renderLegend() {
    legendG.selectAll("*").remove();
    const items = seriesList.map(s => ({ s, w: s.length * 6.4 + 26 }));
    const totalW = d3.sum(items, d => d.w) + (items.length - 1) * 6;
    let lx = Math.max(0, (width - totalW) / 2);
    const ly = 14;
    items.forEach(it => {
      const off = muted.has(it.s);
      const g = legendG.append("g").attr("transform", `translate(${lx},${ly})`)
        .style("cursor", "pointer")
        .on("click", () => {
          if (muted.has(it.s)) muted.delete(it.s); else muted.add(it.s);
          renderLegend(); renderPanels();
        });
      // osynlig träffyta
      g.append("rect").attr("x", -2).attr("y", -10).attr("width", it.w).attr("height", 20).attr("fill", "transparent");
      g.append("rect").attr("x", 0).attr("y", -6.5).attr("width", 13).attr("height", 13).attr("rx", 2)
        .attr("fill", off ? "#fff" : colorFor(it.s))
        .attr("stroke", colorFor(it.s)).attr("stroke-width", off ? 1.4 : 0);
      const txt = g.append("text").attr("x", 19).attr("y", 0).attr("dy", "0.32em")
        .attr("font-family", SANS).attr("font-size", "12px")
        .attr("fill", off ? "#aaa" : "#333").text(it.s);
      if (off) {  // överstrykning
        const tw = it.s.length * 6.4;
        g.append("line").attr("x1", 18).attr("x2", 18 + tw + 2).attr("y1", 0).attr("y2", 0)
          .attr("stroke", "#aaa").attr("stroke-width", 1.2);
      }
      lx += it.w + 6;
    });
  }

  const panelsG = svg.append("g").attr("class", "facet-panels");

  // ── Hover-tooltip (HTML, container-relativ) ──
  const tip = container.append("div")
    .style("position", "absolute").style("display", "none").style("pointer-events", "none")
    .style("background", "#fff").style("border", "1px solid #1a1a1a").style("border-radius", "3px")
    .style("font-family", SANS).style("font-size", "11px").style("z-index", "1000")
    .style("box-shadow", "0 2px 8px rgba(0,0,0,0.12)").style("overflow", "hidden");

  function switchMeasure() {
    const m = measures[mIdx];
    data = m.data;
    curFormatY = m.formatY || formatY;
    curFormatEnd = m.formatEnd || m.formatY || formatY;
    curShareY = (m.shareY !== undefined) ? m.shareY : shareY;
    if (subtitleValSpan) subtitleValSpan.text(m.label);
    if (m.note !== undefined) container.select(".facet-sub-rest").text(m.note);
    renderPanels();
  }

  function visibleSeries() { return seriesList.filter(s => !muted.has(s)); }

  function renderPanels() {
    panelsG.selectAll("*").remove();
    const vis = visibleSeries();
    const globalYMax = d3.max(data.filter(d => !muted.has(d[series])), d => d[y]) || 1;

    facets.forEach((f, fi) => {
      const col = fi % cols, row = Math.floor(fi / cols);
      const gx = col * (panelOuterW + colGap);
      const gy = legendH + row * (panelOuterH + rowGap);
      const isBottom = (row === rows - 1) || (fi + cols >= facets.length);

      const panelData = data.filter(d => d[facet] === f && !muted.has(d[series]));
      const yMaxPanel = curShareY ? globalYMax : (d3.max(panelData, d => d[y]) || 1);
      const ny = niceTop(yMaxPanel);

      const xScale = d3.scaleLinear().domain([xMinV, xMaxV]).range([gx + mL, gx + mL + plotW]);
      const plotTop = gy + panelTitleH, plotBot = plotTop + plotH;
      const yScale = d3.scaleLinear().domain([0, ny.max]).range([plotBot, plotTop]);

      const g = panelsG.append("g");

      g.append("text").attr("x", gx + mL).attr("y", gy + 13)
        .attr("font-family", SANS).attr("font-size", "13px").attr("font-weight", 700)
        .attr("fill", "#1a1a1a").text(typeof f === "string" ? f.replace(/^\d+ /, "") : f);

      ny.ticks.forEach(t => {
        g.append("line").attr("x1", gx + mL).attr("x2", gx + mL + plotW)
          .attr("y1", yScale(t)).attr("y2", yScale(t))
          .attr("stroke", "#e6e6e6").attr("stroke-width", 1).attr("stroke-dasharray", "10,6");
        g.append("text").attr("x", gx + mL - 6).attr("y", yScale(t)).attr("dy", "0.32em")
          .attr("text-anchor", "end").attr("font-family", SANS).attr("font-size", "10px")
          .attr("fill", "#888").text(curFormatY(t));
      });

      if (isBottom) {
        const xticks = [xMinV, Math.round((xMinV + xMaxV) / 2), xMaxV];
        g.append("line").attr("x1", gx + mL).attr("x2", gx + mL + plotW)
          .attr("y1", plotBot).attr("y2", plotBot).attr("stroke", "#1a1a1a").attr("stroke-width", 1);
        xticks.forEach(t => g.append("text").attr("x", xScale(t)).attr("y", plotBot + 14)
          .attr("text-anchor", "middle").attr("font-family", SANS).attr("font-size", "10px")
          .attr("fill", "#1a1a1a").text(t));
      } else {
        g.append("line").attr("x1", gx + mL).attr("x2", gx + mL + plotW)
          .attr("y1", plotBot).attr("y2", plotBot).attr("stroke", "#ccc").attr("stroke-width", 1);
      }

      const ends = [];
      vis.forEach(s => {
        const sd = panelData.filter(d => d[series] === s).sort((a, b) => a[x] - b[x]);
        if (sd.length < 2) return;
        const lg = d3.line().x(d => xScale(d[x])).y(d => yScale(d[y])).curve(curve);
        g.append("path").datum(sd).attr("fill", "none").attr("stroke", colorFor(s))
          .attr("stroke-width", 2).attr("d", lg);
        const last = sd[sd.length - 1];
        g.append("circle").attr("cx", xScale(last[x])).attr("cy", yScale(last[y]))
          .attr("r", 2.6).attr("fill", colorFor(s));
        ends.push({ s, yPos: yScale(last[y]), val: last[y], color: colorFor(s) });
      });

      ends.sort((a, b) => a.yPos - b.yPos);
      const minGap = 12;
      for (let i = 1; i < ends.length; i++)
        if (ends[i].yPos - ends[i - 1].yPos < minGap) ends[i].yPos = ends[i - 1].yPos + minGap;
      for (let i = ends.length - 1; i >= 0; i--) {
        if (ends[i].yPos > plotBot) ends[i].yPos = plotBot;
        if (i > 0 && ends[i].yPos - ends[i - 1].yPos < minGap) ends[i - 1].yPos = ends[i].yPos - minGap;
      }
      ends.forEach(e => g.append("text").attr("x", gx + mL + plotW + 5).attr("y", e.yPos)
        .attr("dy", "0.32em").attr("font-family", SANS).attr("font-size", "10px")
        .attr("font-weight", 600).attr("fill", e.color).text(curFormatEnd(e.val)));

      // ── hover ──
      if (interactive) {
        const cross = g.append("line").attr("y1", plotTop).attr("y2", plotBot)
          .attr("stroke", "#bbb").attr("stroke-width", 1).attr("stroke-dasharray", "3,3")
          .style("opacity", 0).style("pointer-events", "none");
        const dotsG = g.append("g").style("pointer-events", "none");
        g.append("rect").attr("x", gx + mL).attr("y", plotTop)
          .attr("width", plotW).attr("height", plotH).attr("fill", "transparent")
          .style("cursor", "crosshair")
          .on("mousemove", function (event) {
            const [mx] = d3.pointer(event, svg.node());
            const yr = Math.round(xScale.invert(mx));
            const yrClamped = Math.max(xMinV, Math.min(xMaxV, yr));
            cross.attr("x1", xScale(yrClamped)).attr("x2", xScale(yrClamped)).style("opacity", 1);
            dotsG.selectAll("*").remove();
            const rowsHtml = [];
            vis.forEach(s => {
              const rec = data.find(d => d[facet] === f && d[series] === s && +d[x] === yrClamped && !muted.has(s));
              if (!rec) return;
              dotsG.append("circle").attr("cx", xScale(yrClamped)).attr("cy", yScale(rec[y]))
                .attr("r", 3.4).attr("fill", colorFor(s)).attr("stroke", "#fff").attr("stroke-width", 1.4);
              rowsHtml.push(`<div style="display:flex;align-items:center;gap:6px;padding:2px 9px"><span style="width:8px;height:8px;border-radius:50%;background:${colorFor(s)};flex-shrink:0"></span><span style="color:#555;flex:1">${s}</span><b style="margin-left:8px;font-variant-numeric:tabular-nums">${curFormatY(rec[y])}</b></div>`);
            });
            tip.html(`<div style="font-weight:700;color:#fff;background:#1a1a1a;padding:4px 9px">${(typeof f === "string" ? f.replace(/^\d+ /, "") : f)} ${yrClamped}</div>${rowsHtml.join("")}`)
              .style("display", "block");
            const cr = container.node().getBoundingClientRect();
            const sr = svg.node().getBoundingClientRect();
            const sx = sr.width / width;
            let px = xScale(yrClamped) * sx + (sr.left - cr.left) + 12;
            let py = plotTop * (sr.height / svgH) + (sr.top - cr.top);
            const tw = tip.node().offsetWidth, th = tip.node().offsetHeight;
            if (px + tw > cr.width - 6) px = xScale(yrClamped) * sx + (sr.left - cr.left) - tw - 12;
            py = Math.max(4, Math.min(py, cr.height - th - 4));
            tip.style("left", px + "px").style("top", py + "px");
          })
          .on("mouseleave", function () {
            cross.style("opacity", 0); dotsG.selectAll("*").remove(); tip.style("display", "none");
          });
      }
    });
  }

  renderLegend();
  renderPanels();

  if (caption) container.append("div").attr("class", "graf-caption").text(caption);
  addExportButton(container, svg.node(), {
    title, subtitle: subtitle || (measures ? measures[mIdx].label : null), caption,
    width, height: svgH, altText, info, logo
  });
  return container.node();
}
