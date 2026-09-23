// =============================================================================
// FACET-LINJER — sammanhållna små multiplar (en panel per facet), linjer per
// serie över tid. Fri eller delad y per panel, delad x (år).
//
// Byggd på grafRam: mått (Antal/Andel …) väljs i y-titeln uppe till vänster,
// klickbar färgchips-legend (tona ned serier) ligger till höger på samma rad.
// =============================================================================
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import {
  skapaRam, TYP, FARG, STORLEK, matText,
  yTitel, skapaTooltip, tooltipHtml
} from "../lib/grafRam.js";

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
  yLabel = null,
  formatY = d => d.toLocaleString("sv-SE"),
  formatEnd = null,
  curve = d3.curveMonotoneX,
  measures = null,           // [{key,label,data,formatY,formatEnd,shareY,note}]
  interactive = true,
  logo = null,
  altText = null,
  info = null
} = {}) {

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
  const topRowH = 34;              // y-titel + legend
  const panelTitleH = 22;
  const xAxisH = 24;
  const mL = 50, mR = 54, colGap = 14, rowGap = 20;
  const panelOuterW = (width - colGap * (cols - 1)) / cols;
  const plotW = panelOuterW - mL - mR;
  const panelOuterH = panelTitleH + plotH + xAxisH;
  const svgH = topRowH + rows * panelOuterH + rowGap * (rows - 1) + 6;

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

  // ── Ram ──
  const subtitleText = () => {
    const m = measures ? measures[mIdx] : null;
    // note är skriven som fortsättning på måttets namn ("Antal personer per år …")
    return (m && m.note !== undefined) ? `${m.label} ${m.note}` : subtitle;
  };
  const ram = skapaRam({ title, subtitle: subtitleText(), caption });
  const container = ram.container;
  const svg = ram.svg(width, svgH);
  const tip = skapaTooltip(ram.body);

  // Y-titel (mått) uppe till vänster
  const yTitelText = () => measures ? measures[mIdx].label : (yLabel || "");
  let yt = null;
  const harYTitel = !!(measures || yLabel);
  if (harYTitel) {
    yt = yTitel(svg, {
      x: 0, y: 16, text: yTitelText(),
      options: measures && measures.length > 1 ? measures.map(m => m.label) : null,
      activeIndex: 0, body: ram.body,
      onSelect: (i) => { mIdx = i; switchMeasure(); }
    });
  }

  // ── Klickbar chips-legend (höger på översta raden) ──
  const legendG = svg.append("g").attr("class", "facet-legend");
  function renderLegend() {
    legendG.selectAll("*").remove();
    const items = seriesList.map(s => ({ s, w: matText(s, { size: 12 }) + 26 }));
    const totalW = d3.sum(items, d => d.w) + (items.length - 1) * 8;
    const minLeft = harYTitel ? matText(yTitelText(), { size: STORLEK.yTitel, weight: 500 }) + 40 : 0;
    let lx = Math.max(minLeft, width - totalW);
    const ly = 12;
    items.forEach(it => {
      const off = muted.has(it.s);
      const g = legendG.append("g").attr("transform", `translate(${lx},${ly})`)
        .style("cursor", "pointer")
        .on("click", () => {
          if (muted.has(it.s)) muted.delete(it.s); else muted.add(it.s);
          renderLegend(); renderPanels();
        });
      g.append("rect").attr("x", -2).attr("y", -10).attr("width", it.w).attr("height", 20).attr("fill", "transparent");
      g.append("rect").attr("x", 0).attr("y", -6).attr("width", 12).attr("height", 12).attr("rx", 2)
        .attr("fill", off ? "#fff" : colorFor(it.s))
        .attr("stroke", colorFor(it.s)).attr("stroke-width", off ? 1.4 : 0);
      g.append("text").attr("x", 18).attr("y", 0).attr("dy", "0.32em")
        .attr("font-family", TYP.ui).attr("font-size", 12)
        .attr("fill", off ? FARG.mjuk : FARG.ink).text(it.s);
      if (off) {
        const tw = matText(it.s, { size: 12 });
        g.append("line").attr("x1", 17).attr("x2", 18 + tw + 2).attr("y1", 0).attr("y2", 0)
          .attr("stroke", FARG.mjuk).attr("stroke-width", 1.2);
      }
      lx += it.w + 8;
    });
  }

  const panelsG = svg.append("g").attr("class", "facet-panels");

  function switchMeasure() {
    const m = measures[mIdx];
    data = m.data;
    curFormatY = m.formatY || formatY;
    curFormatEnd = m.formatEnd || m.formatY || formatY;
    curShareY = (m.shareY !== undefined) ? m.shareY : shareY;
    if (yt) yt.set(yTitelText(), mIdx);
    ram.setSubtitle(subtitleText());
    renderLegend();
    renderPanels();
  }

  function visibleSeries() { return seriesList.filter(s => !muted.has(s)); }
  const facetNamn = f => (typeof f === "string" ? f.replace(/^\d+ /, "") : f);

  function renderPanels() {
    panelsG.selectAll("*").remove();
    const vis = visibleSeries();
    const globalYMax = d3.max(data.filter(d => !muted.has(d[series])), d => d[y]) || 1;

    facets.forEach((f, fi) => {
      const col = fi % cols, row = Math.floor(fi / cols);
      const gx = col * (panelOuterW + colGap);
      const gy = topRowH + row * (panelOuterH + rowGap);
      const isBottom = (row === rows - 1) || (fi + cols >= facets.length);

      const panelData = data.filter(d => d[facet] === f && !muted.has(d[series]));
      const yMaxPanel = curShareY ? globalYMax : (d3.max(panelData, d => d[y]) || 1);
      const ny = niceTop(yMaxPanel);

      const xScale = d3.scaleLinear().domain([xMinV, xMaxV]).range([gx + mL, gx + mL + plotW]);
      const plotTop = gy + panelTitleH, plotBot = plotTop + plotH;
      const yScale = d3.scaleLinear().domain([0, ny.max]).range([plotBot, plotTop]);

      const g = panelsG.append("g");

      // panelrubrik
      g.append("text").attr("x", gx + mL).attr("y", gy + 13)
        .attr("font-family", TYP.ui).attr("font-size", 13).attr("font-weight", 600)
        .attr("fill", FARG.ink).text(facetNamn(f));

      // grid + y-etiketter
      ny.ticks.forEach(t => {
        const noll = t === 0;
        g.append("line").attr("x1", gx + mL).attr("x2", gx + mL + plotW)
          .attr("y1", yScale(t)).attr("y2", yScale(t))
          .attr("stroke", noll ? FARG.noll : FARG.grid).attr("stroke-width", noll ? 1 : 0.8)
          .attr("stroke-dasharray", noll ? null : "4,4");
        g.append("text").attr("x", gx + mL - 6).attr("y", yScale(t)).attr("dy", "0.32em")
          .attr("text-anchor", "end").attr("font-family", TYP.ui).attr("font-size", 10.5)
          .attr("fill", FARG.text).style("font-variant-numeric", "tabular-nums").text(curFormatY(t));
      });

      // x-axel (bara nedersta raden får etiketter)
      if (isBottom) {
        const xticks = [xMinV, Math.round((xMinV + xMaxV) / 2), xMaxV];
        xticks.forEach(t => {
          g.append("line").attr("x1", xScale(t)).attr("x2", xScale(t))
            .attr("y1", plotBot).attr("y2", plotBot + 4).attr("stroke", FARG.axel);
          g.append("text").attr("x", xScale(t)).attr("y", plotBot + 16)
            .attr("text-anchor", "middle").attr("font-family", TYP.ui).attr("font-size", 11)
            .attr("fill", FARG.ink).style("font-variant-numeric", "tabular-nums").text(t);
        });
      }

      const ends = [];
      vis.forEach(s => {
        const sd = panelData.filter(d => d[series] === s).sort((a, b) => a[x] - b[x]);
        if (sd.length < 2) return;
        const lg = d3.line().x(d => xScale(d[x])).y(d => yScale(d[y])).curve(curve);
        g.append("path").datum(sd).attr("fill", "none").attr("stroke", colorFor(s))
          .attr("stroke-width", 2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round").attr("d", lg);
        const last = sd[sd.length - 1];
        g.append("circle").attr("cx", xScale(last[x])).attr("cy", yScale(last[y]))
          .attr("r", 2.8).attr("fill", colorFor(s));
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
      ends.forEach(e => g.append("text").attr("x", gx + mL + plotW + 6).attr("y", e.yPos)
        .attr("dy", "0.32em").attr("font-family", TYP.ui).attr("font-size", 10.5)
        .attr("font-weight", 600).attr("fill", e.color).style("font-variant-numeric", "tabular-nums")
        .text(curFormatEnd(e.val)));

      // ── hover ──
      if (interactive) {
        const cross = g.append("line").attr("y1", plotTop).attr("y2", plotBot)
          .attr("stroke", "#9a9f9d").attr("stroke-width", 1).attr("stroke-dasharray", "3,3")
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
            const rader = [];
            vis.forEach(s => {
              const rec = data.find(d => d[facet] === f && d[series] === s && +d[x] === yrClamped && !muted.has(s));
              if (!rec) return;
              dotsG.append("circle").attr("cx", xScale(yrClamped)).attr("cy", yScale(rec[y]))
                .attr("r", 3.4).attr("fill", colorFor(s)).attr("stroke", "#fff").attr("stroke-width", 1.4);
              rader.push({ namn: s, varde: curFormatY(rec[y]), farg: colorFor(s) });
            });
            const sr = svg.node().getBoundingClientRect();
            const br = ram.body.node().getBoundingClientRect();
            const sx = sr.width / width, sy = sr.height / svgH;
            tip.visa(tooltipHtml(`${facetNamn(f)} ${yrClamped}`, rader), {
              x: sr.left - br.left + xScale(yrClamped) * sx,
              y: sr.top - br.top + ((plotTop + plotBot) / 2) * sy
            });
          })
          .on("mouseleave", function () {
            cross.style("opacity", 0); dotsG.selectAll("*").remove(); tip.dolj();
          });
      }
    });
  }

  renderLegend();
  renderPanels();

  addExportButton(container, svg.node(), {
    title, subtitle: subtitle || (measures ? measures[mIdx].label : null), caption,
    width, height: svgH, altText, info, logo
  });
  return container.node();
}
