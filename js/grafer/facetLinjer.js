// =============================================================================
// FACET-LINJER — sammanhållna små multiplar (en panel per facet), linjer per
// serie över tid. Fri eller delad y per panel, delad x (år).
//
// Byggd på grafRam: mått (Antal/Andel …) väljs i y-titeln uppe till vänster,
// klickbar färgchips-legend (tona ned serier) ligger till höger på samma rad.
//
// ref (valfri, även per mått i measures): en streckad referenslinje per panel,
//   { values: { <facet>: värde, … }, label: "Behov" }. Linjen får en etikett
//   ("Behov 658") och ingår i y-skalan och i tooltipen.
//
// Tillägg 2026-09-24 (bakåtkompatibla, används av pendlingsgrafen i kap 03):
//   negativa värden   y-skalan går under noll när datan gör det (nollinjen heldragen)
//   measures[i].view  mått grupperade i vyer; vyn väljs i en rullgardin nere till
//                     vänster (viewLabel, t.ex. "Flöde"), måttet i y-titeln. Alla
//                     vyer ska ha samma måttnamn i samma ordning.
//   area              { series, pos, neg, opacity } fyller mellan serien och noll,
//                     färgad efter tecken (t.ex. ett netto)
//   seriesWidth       { <serie>: px } tjockare linje för en serie
//   markX             { x: 2019.5, label } streckad lodlinje i varje panel (metodbyte)
// =============================================================================
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import {
  skapaRam, TYP, FARG, STORLEK, matText,
  yTitel, valPill, skapaTooltip, tooltipHtml, ritbredd, arSmal } from "../lib/grafRam.js";

export function facetLinjer(initialData, {
  facet = "facet",
  x = "år",
  y = "värde",
  series = "serie",
  facetOrder = null,
  seriesOrder = null,
  colors = ["#00664D", "#0C8C7E", "#FF7E00", "#1A7BB0", "#433C9D", "#A51300"],
  columns = 3,
  width = null,
  plotH = 120,
  shareY = false,
  title = null,
  subtitle = null,
  caption = null,
  yLabel = null,
  formatY = d => d.toLocaleString("sv-SE"),
  formatEnd = null,
  curve = d3.curveMonotoneX,
  measures = null,           // [{key,label,data,formatY,formatEnd,shareY,note,ref}]
  ref = null,                // { values: {facet: värde}, label } — streckad referenslinje per panel
  interactive = true,
  viewLabel = "Visa",        // etikett på vyrullgardinen (measures[i].view)
  area = null,               // { series, pos, neg, opacity } yta mellan serien och noll
  seriesWidth = null,        // { <serie>: linjebredd }
  markX = null,              // { x, label } streckad lodlinje, t.ex. metodbyte
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
  // Vyer: mått med .view grupperas; y-titeln listar bara aktuell vys mått
  const views = measures ? [...new Set(measures.map(m => m.view).filter(v => v != null))] : [];
  let curView = views.length ? measures[0].view : null;
  const vyMatt = () => measures ? measures.map((m, i) => i).filter(i => curView == null || measures[i].view === curView) : [];

  const facets = facetOrder || [...new Set(initialData.map(d => d[facet]))];
  const seriesList = seriesOrder || [...new Set(initialData.map(d => d[series]))];
  const colorFor = s => colors[seriesList.indexOf(s) % colors.length];
  const muted = new Set();   // nedtonade (överstrukna) serier

  const xs = [...new Set(initialData.map(d => +d[x]))].sort((a, b) => a - b);
  const xMinV = xs[0], xMaxV = xs[xs.length - 1];

  // ── Layout ──
  if (!width) width = ritbredd(880);
  if (arSmal(width, 880)) columns = Math.min(columns, 2);   // smal skärm: högst två panelkolumner
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

  // Skala som tål negativa värden (nollan alltid en tick)
  function niceRange(minV, maxV) {
    if (!(minV < 0)) return niceTop(maxV);
    const span = Math.max(maxV, 0) - minV;
    const raw = span / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    const top = Math.max(0, Math.ceil(maxV / step) * step);
    const bot = Math.floor(minV / step) * step;
    const ticks = [];
    for (let v = bot; v <= top + step * 0.01; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { min: bot, max: top, ticks };
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
      options: measures && vyMatt().length > 1 ? vyMatt().map(i => measures[i].label) : null,
      activeIndex: 0, body: ram.body,
      onSelect: (i) => { mIdx = vyMatt()[i]; switchMeasure(); }
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
    if (yt) yt.set(yTitelText(), Math.max(0, vyMatt().indexOf(mIdx)));
    ram.setSubtitle(subtitleText());
    renderLegend();
    renderPanels();
  }

  function visibleSeries() { return seriesList.filter(s => !muted.has(s)); }
  const facetNamn = f => (typeof f === "string" ? f.replace(/^\d+ /, "") : f);

  function renderPanels() {
    panelsG.selectAll("*").remove();
    const vis = visibleSeries();
    const R = (measures && measures[mIdx].ref !== undefined) ? measures[mIdx].ref : ref;
    const refFor = f => (R && R.values && R.values[f] != null) ? +R.values[f] : null;
    const refMax = R && R.values ? (d3.max(Object.values(R.values), v => +v) || 0) : 0;
    const globalYMax = Math.max(d3.max(data.filter(d => !muted.has(d[series])), d => d[y]) || 1, refMax);
    const globalYMin = Math.min(0, d3.min(data.filter(d => !muted.has(d[series])), d => d[y]) || 0);

    facets.forEach((f, fi) => {
      const col = fi % cols, row = Math.floor(fi / cols);
      const gx = col * (panelOuterW + colGap);
      const gy = topRowH + row * (panelOuterH + rowGap);
      const isBottom = (row === rows - 1) || (fi + cols >= facets.length);

      const panelData = data.filter(d => d[facet] === f && !muted.has(d[series]));
      const refV = refFor(f);
      const yMaxPanel = curShareY ? globalYMax : Math.max(d3.max(panelData, d => d[y]) || 1, refV || 0);
      const yMinPanel = curShareY ? globalYMin : Math.min(0, d3.min(panelData, d => d[y]) || 0);
      const ny = niceRange(yMinPanel, yMaxPanel);

      const xScale = d3.scaleLinear().domain([xMinV, xMaxV]).range([gx + mL, gx + mL + plotW]);
      const plotTop = gy + panelTitleH, plotBot = plotTop + plotH;
      const yScale = d3.scaleLinear().domain([ny.min || 0, ny.max]).range([plotBot, plotTop]);

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

      // referenslinje (t.ex. beräknat behov)
      if (refV != null) {
        g.append("line").attr("x1", gx + mL).attr("x2", gx + mL + plotW)
          .attr("y1", yScale(refV)).attr("y2", yScale(refV))
          .attr("stroke", FARG.ink).attr("stroke-width", 1.3).attr("stroke-dasharray", "5,3")
          .attr("opacity", 0.75);
        const refTxt = `${R.label || ""} ${curFormatY(refV)}`.trim();
        const tw = matText(refTxt, { size: 10.5, weight: 600 });
        // Etiketten över linjen; vid taket under den; vid noll (linjen ligger på
        // axeln) uppe i panelen så att den inte hamnar bland seriernas lägsta värden.
        const ty = yScale(refV) > plotBot - 14 ? plotTop + 9
          : yScale(refV) - 5 < plotTop + 8 ? yScale(refV) + 12 : yScale(refV) - 5;
        g.append("rect").attr("x", gx + mL + 3).attr("y", ty - 9).attr("width", tw + 6).attr("height", 12)
          .attr("fill", "#fff").attr("opacity", 0.85);
        g.append("text").attr("x", gx + mL + 6).attr("y", ty)
          .attr("font-family", TYP.ui).attr("font-size", 10.5).attr("font-weight", 600)
          .attr("fill", FARG.ink).style("font-variant-numeric", "tabular-nums").text(refTxt);
      }

      // lodlinje (t.ex. metodbyte); etiketten bara i första panelen
      if (markX && markX.x > xMinV && markX.x < xMaxV) {
        g.append("line").attr("x1", xScale(markX.x)).attr("x2", xScale(markX.x))
          .attr("y1", plotTop).attr("y2", plotBot)
          .attr("stroke", FARG.mjuk).attr("stroke-width", 1).attr("stroke-dasharray", "2,3");
        if (fi === 0 && markX.label) g.append("text").attr("x", xScale(markX.x) - 4).attr("y", plotTop + 8)
          .attr("text-anchor", "end").attr("font-family", TYP.ui).attr("font-size", 9.5)
          .attr("fill", FARG.mjuk).text(markX.label);
      }

      // yta mellan en serie och noll, färgad efter tecken (t.ex. netto)
      if (area && vis.includes(area.series)) {
        const ad = panelData.filter(d => d[series] === area.series).sort((a, b) => a[x] - b[x]);
        if (ad.length > 1) {
          const y0 = yScale(0);
          const ag = d3.area().x(d => xScale(d[x])).y0(y0).y1(d => yScale(d[y])).curve(curve);
          const uid = "fl" + Math.random().toString(36).slice(2, 9);
          const defs = g.append("defs");
          defs.append("clipPath").attr("id", uid + "p").append("rect")
            .attr("x", gx + mL).attr("y", plotTop - 2).attr("width", plotW).attr("height", Math.max(0, y0 - plotTop + 2));
          defs.append("clipPath").attr("id", uid + "n").append("rect")
            .attr("x", gx + mL).attr("y", y0).attr("width", plotW).attr("height", Math.max(0, plotBot - y0 + 2));
          const op = area.opacity ?? 0.2;
          g.append("path").datum(ad).attr("d", ag).attr("fill", area.pos || colorFor(area.series))
            .attr("opacity", op).attr("clip-path", `url(#${uid}p)`);
          g.append("path").datum(ad).attr("d", ag).attr("fill", area.neg || colorFor(area.series))
            .attr("opacity", op).attr("clip-path", `url(#${uid}n)`);
        }
      }

      const ends = [];
      vis.forEach(s => {
        const sd = panelData.filter(d => d[series] === s).sort((a, b) => a[x] - b[x]);
        if (sd.length < 2) return;
        const lg = d3.line().x(d => xScale(d[x])).y(d => yScale(d[y])).curve(curve);
        g.append("path").datum(sd).attr("fill", "none").attr("stroke", colorFor(s))
          .attr("stroke-width", (seriesWidth && seriesWidth[s]) || 2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round").attr("d", lg);
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
            if (refV != null) rader.push({ namn: R.label || "Referens", varde: curFormatY(refV), farg: FARG.ink });
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

  if (views.length > 1) {
    valPill(ram.controlsLeft, {
      label: viewLabel, options: views, activeIndex: 0, body: ram.body,
      onSelect: (i) => {
        const gammal = measures[mIdx].label;
        curView = views[i];
        const kand = vyMatt();
        mIdx = kand.find(j => measures[j].label === gammal) ?? kand[0];
        switchMeasure();
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
