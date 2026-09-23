// =============================================================================
// STAPLADE STAPLAR — horisontella 100 %-staplar (eller antal) per kategori,
// med färggrupper, region- och årsrullgardiner i nedre raden och Andel/Antal
// som y-titelmeny. Byggd på grafRam så att den ser ut som övriga moduler.
//
//   stapladeStaplar(data, {
//     y: "region_namn",        // en stapel per y-värde (kategori på vänsteraxeln)
//     x: "andel",              // fältet som staplas (används i andel-läget)
//     xAntal: "antal",         // fält för antal-läget (valfritt)
//     color: "storlek",        // färggrupp inom stapeln
//     colorOrder: [...],       // staplingsordning (vänster → höger)
//     colors: {...} | [...],   // färg per grupp
//     yOrder: [...] | "value:<grupp>"  // ordning på staplarna; "value:X" = fallande på grupp X
//     bold: [...],             // y-värden som skrivs i fetstil (referenser)
//     measures: [{label, data}],  // valfri region-rullgardin (byter datamängd)
//     measureLabel: "Region",
//     time: "ar",              // valfri årsrullgardin (filtrerar på fältet)
//     normalize: true,         // true = 100 %-staplar
//     toggle: true,            // Andel/Antal-växel i y-titeln (kräver xAntal)
//     title, subtitle, caption, logo, info, altText
//   })
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { skapaRam, stilXAxel, ritaGrid, yTitel, valPill, skapaTooltip, tooltipHtml,
         FARG, TYP, STORLEK, SERIEFARGER, matText, fmtTal } from "../lib/grafRam.js";

// Sorterar år och perioder ("2000–2005") efter startår, och vid samma startår
// det kortare spannet först, så att en helperiod ("2000–2025") hamnar sist.
function tidSort(a, b) {
  const tal = v => String(v).split(/[–-]/).map(Number);
  const [a0, a1 = a0] = tal(a), [b0, b1 = b0] = tal(b);
  if (isNaN(a0) || isNaN(b0)) return a > b ? 1 : a < b ? -1 : 0;
  const spA = a1 - a0, spB = b1 - b0;
  if (spA !== spB && (spA > 10 || spB > 10)) return spA - spB;   // helperioden sist
  return a0 - b0 || a1 - b1;
}

export function stapladeStaplar(initialData, {
  y = "kategori",
  x = "andel",
  xAntal = null,
  color = "grupp",
  colorOrder = null,
  colors = SERIEFARGER,
  yOrder = null,
  bold = [],
  measures = null,
  measureLabel = "Region",
  time = null,
  normalize = true,
  toggle = false,
  grouped = false,          // true = staplarna ritas sida vid sida (ej staplade), värdena kan vara negativa
  timeDefault = null,       // startvärde för tidsrullgardinen (annars sista)
  timeLabel = "År",         // etikett på tidsrullgardinen (t.ex. "Restid")
  timeOrder = null,         // explicit ordning för tidsrullgardinen (annars kronologiskt, helperioder sist)
  valueMax = null,          // fast övre gräns för värdeaxeln i antal-/grupperat läge (ger plats åt etiketter)
  width = null,
  barHeight = 30,
  gap = 10,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  formatX = null,
  altText = null,
  info = null,
  logo = null,
  minLabelWidth = 34
} = {}) {

  // ── State ──
  let data = measures ? measures[0].data : initialData;
  let measureIdx = 0;
  let visaAndel = normalize;
  const allYears = time
    ? [...new Set((measures ? measures.flatMap(m => m.data) : initialData).map(d => d[time]))]
        .filter(v => v != null).sort(tidSort)
    : [];
  if (timeOrder) allYears.sort((a, b) => timeOrder.indexOf(a) - timeOrder.indexOf(b));
  let currentYear = allYears.length ? (timeDefault != null && allYears.includes(timeDefault) ? timeDefault : allYears[allYears.length - 1]) : null;

  const groups = colorOrder || [...new Set(data.map(d => d[color]))];
  const farg = Array.isArray(colors)
    ? d3.scaleOrdinal().domain(groups).range(colors)
    : (g) => colors[g] ?? "#999";

  // ── Layout ──
  const W = width || 820;
  const marginTop = 34;
  const marginRight = 22;
  const marginBottom = 30 + (xLabel ? 16 : 0);
  const fmtAndel = d => `${d.toFixed(0)} %`;
  const fmtAndel1 = d => `${d.toFixed(1).replace(".", ",")} %`;
  const fmtAntal = d => fmtTal(d);

  const ram = skapaRam({ title, subtitle, caption });
  const container = ram.container;
  const tooltip = skapaTooltip(ram.body);
  const svg = ram.svg(W, 100);
  const gGrid = svg.append("g").attr("class", "graf-grid");
  const gRows = svg.append("g").attr("class", "graf-rader");
  const gAxis = svg.append("g").attr("class", "graf-xaxel");
  let ytit = null;

  // Legend (chips under rubriken)
  const legend = container.insert("div", ".graf-body").attr("class", "graf-legend-chips");
  groups.forEach(g => {
    const item = legend.append("span").attr("class", "graf-legend-chip");
    item.append("span").attr("class", "graf-legend-prick").style("background", farg(g));
    item.append("span").text(g);
  });

  // ── Data för aktuell vy ──
  function aktuellData() {
    let d = data;
    if (time && currentYear != null) d = d.filter(r => r[time] === currentYear);
    return d;
  }

  function byggRader() {
    const d = aktuellData();
    const perY = d3.group(d, r => r[y]);
    let ys = [...perY.keys()];
    if (Array.isArray(yOrder)) {
      const ord = new Map(yOrder.map((v, i) => [v, i]));
      ys.sort((a, b) => (ord.has(a) ? ord.get(a) : 1e9) - (ord.has(b) ? ord.get(b) : 1e9));
    } else if (typeof yOrder === "string" && yOrder.startsWith("value:")) {
      const grp = yOrder.slice(6);
      const val = k => { const r = (perY.get(k) || []).find(z => z[color] === grp); return r ? +r[x] : -1; };
      const fasta = Array.isArray(bold) ? bold.filter(b => ys.includes(b)) : [];
      const rest = ys.filter(k => !fasta.includes(k)).sort((a, b) => val(b) - val(a));
      ys = [...fasta, ...rest];
    }
    return ys.map(k => {
      const rader = perY.get(k) || [];
      const seg = groups.map(g => {
        const r = rader.find(z => z[color] === g);
        return { grupp: g, andel: r ? +r[x] : 0, antal: (r && xAntal) ? +r[xAntal] : null };
      });
      const total = xAntal ? d3.sum(seg, s => s.antal || 0) : null;
      let ack = 0;
      if (grouped) {
        seg.forEach(s => { s.v = +s.andel; s.x0 = Math.min(0, s.v); s.x1 = Math.max(0, s.v); });
        return { key: k, seg, total, sum: d3.max(seg, s => s.v), min: d3.min(seg, s => s.v) };
      }
      seg.forEach(s => { s.v = visaAndel ? s.andel : (s.antal || 0); s.x0 = ack; s.x1 = ack + s.v; ack = s.x1; });
      return { key: k, seg, total, sum: ack, min: 0 };
    });
  }

  // ── Rita ──
  function rita() {
    const rader = byggRader();
    const maxLabel = Math.max(0, ...rader.map(r => matText(String(r.key), { size: 13, weight: 600 })));
    const marginLeft = 16 + maxLabel + 12;
    const chartW = W - marginLeft - marginRight;
    const radH = grouped ? barHeight * groups.length + 2 * (groups.length - 1) : barHeight;
    const H = marginTop + rader.length * (radH + gap) - gap + marginBottom;
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const andelSkala = visaAndel && !grouped;
    const xMax = andelSkala ? 100 : (valueMax ?? (d3.max(rader, r => r.sum) || 1));
    const xMin = grouped ? Math.min(0, d3.min(rader, r => r.min) || 0) : 0;
    const xs = d3.scaleLinear().domain([xMin, xMax]).nice(andelSkala ? 1 : 5).range([marginLeft, marginLeft + chartW]);
    if (andelSkala) xs.domain([0, 100]);
    const ticks = andelSkala ? [0, 20, 40, 60, 80, 100] : xs.ticks(5);
    const fmt = formatX || (andelSkala ? fmtAndel : fmtAntal);

    ritaGrid(gGrid, { ticks, scale: xs, x1: marginTop - 6, x2: H - marginBottom + 4, noll: grouped ? 0 : null, horisontell: false });
    gAxis.attr("transform", `translate(0,${H - marginBottom + 4})`)
      .call(d3.axisBottom(xs).tickValues(ticks).tickFormat(fmt).tickSize(4))
      .call(g => stilXAxel(g));
    gAxis.select(".domain").remove();

    // y-titel (Andel/Antal)
    if (ytit) ytit.g.remove();
    const yt = { x: marginLeft, y: marginTop - 12 };
    if (toggle && xAntal && !grouped) {
      ytit = yTitel(svg, { ...yt, text: visaAndel ? "Andel" : "Antal", options: ["Andel", "Antal"],
        activeIndex: visaAndel ? 0 : 1, body: ram.body,
        onSelect: (i) => { visaAndel = i === 0; rita(); } });
    } else {
      ytit = yTitel(svg, { ...yt, text: xLabel || (visaAndel ? "Andel" : "Antal") });
    }

    const rows = gRows.selectAll("g.rad").data(rader, d => d.key).join(
      enter => enter.append("g").attr("class", "rad"),
      update => update,
      exit => exit.remove()
    ).attr("transform", (_, i) => `translate(0,${marginTop + i * (radH + gap)})`);

    rows.selectAll("text.etikett").data(d => [d]).join("text")
      .attr("class", "etikett")
      .attr("x", marginLeft - 10).attr("y", radH / 2).attr("dy", "0.35em")
      .attr("text-anchor", "end")
      .attr("font-family", TYP.ui).attr("font-size", 13)
      .attr("font-weight", d => (bold || []).includes(d.key) ? 700 : 500)
      .attr("fill", FARG.ink)
      .text(d => d.key);

    const segs = rows.selectAll("g.seg").data(d => d.seg.map(s => ({ ...s, rad: d })), s => s.grupp)
      .join(enter => {
        const g = enter.append("g").attr("class", "seg").style("cursor", "pointer");
        g.append("rect").attr("rx", 1);
        g.append("text").attr("class", "inl").attr("pointer-events", "none")
          .attr("text-anchor", "middle").attr("font-family", TYP.ui)
          .attr("font-size", 12).attr("font-weight", 600).attr("fill", "#fff");
        return g;
      });
    const gIdx = s => groups.indexOf(s.grupp);
    segs.select("rect").transition().duration(350)
      .attr("x", s => xs(s.x0)).attr("y", s => grouped ? gIdx(s) * (barHeight + 2) : 0)
      .attr("width", s => Math.max(0, xs(s.x1) - xs(s.x0) - (grouped ? 0 : 1))).attr("height", barHeight)
      .attr("fill", s => farg(s.grupp));
    if (grouped) {
      segs.select("text.inl")
        .attr("text-anchor", s => s.v < 0 ? "end" : "start").attr("fill", FARG.ink).attr("font-weight", 500)
        .attr("x", s => s.v < 0 ? xs(s.x0) - 4 : xs(s.x1) + 4).attr("y", s => gIdx(s) * (barHeight + 2) + barHeight / 2).attr("dy", "0.35em")
        .text(s => fmt(s.v));
    } else {
      segs.select("text.inl")
        .attr("x", s => (xs(s.x0) + xs(s.x1)) / 2).attr("y", barHeight / 2).attr("dy", "0.35em")
        .text(s => (xs(s.x1) - xs(s.x0)) >= minLabelWidth ? (visaAndel ? fmtAndel(s.andel) : fmtAntal(s.antal)) : "");
    }

    segs.on("mouseenter", function (event, s) {
      gRows.selectAll("g.rad").style("opacity", 0.35);
      d3.select(this.parentNode).style("opacity", 1);
      const rubrik = `${s.rad.key}${s.rad.total != null ? ` · ${fmtAntal(s.rad.total)} totalt` : ""}${time && currentYear != null ? ` · ${currentYear}` : ""}`;
      const rader = s.rad.seg.map(z => ({
        namn: z.grupp, farg: farg(z.grupp), fokus: z.grupp === s.grupp,
        varde: grouped ? fmt(z.v) : (xAntal ? `${fmtAndel1(z.andel)} (${fmtAntal(z.antal)})` : fmtAndel1(z.andel))
      }));
      tooltip.visa(tooltipHtml(rubrik, rader), pos(event));
    }).on("mousemove", (event) => {
      const el = tooltip.el.node(); if (el && el.innerHTML) { const p = pos(event); tooltip.el.style("left", `${p.x + 14}px`).style("top", `${p.y - 20}px`); }
    }).on("mouseleave", () => { gRows.selectAll("g.rad").style("opacity", 1); tooltip.dolj(); });

    function pos(event) {
      const b = ram.body.node().getBoundingClientRect();
      return { x: event.clientX - b.left, y: event.clientY - b.top };
    }
  }

  // ── Reglage i nedre raden ──
  if (measures && measures.length > 1) {
    valPill(ram.controlsLeft, {
      label: measureLabel, options: measures.map(m => m.label), activeIndex: 0, body: ram.body,
      onSelect: (i) => { measureIdx = i; data = measures[i].data; if (measures[i].subtitle) ram.setSubtitle(measures[i].subtitle); rita(); }
    });
  }
  if (time && allYears.length > 1) {
    valPill(ram.controlsLeft, {
      label: timeLabel, options: allYears.map(String), activeIndex: Math.max(0, allYears.indexOf(currentYear)), body: ram.body,
      onSelect: (i) => { currentYear = allYears[i]; rita(); }
    });
  }

  if (info) container.attr("data-info", info);
  if (altText) svg.attr("aria-label", altText);
  rita();
  addExportButton(container, svg.node(), { title, logo });
  return container.node();
}
