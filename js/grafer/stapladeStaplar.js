// =============================================================================
// STAPLADE STAPLAR — horisontella 100 %-staplar (eller antal) per kategori,
// med färggrupper, region- och årsval och Andel/Antal som y-titelmeny.
// Byggd på grafRam så att den ser ut som övriga moduler.
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
//     measures: [{label, data, subtitle?}],  // flera datamängder (t.ex. region)
//     measureLabel: "Region",
//     time: "ar",              // tidsfält (filtrerar datan)
//     normalize: true,         // true = 100 %-staplar
//     toggle: true,            // Andel/Antal-växel i y-titeln (kräver xAntal)
//     facet: null,             // "measures" = en panel per datamängd (små multiplar)
//                              // "time" = en panel per år i facetValues
//     facetValues: null,       // vilka år som får en panel (default första och sista)
//     facetCols: null,         // antal panelkolumner (default: alla på en rad, högst 4)
//     subtitle: "…" | (ctx) => "…"   // funktion får { ar, matt, andel } och
//                              // anropas om vid varje val, så undertiteln alltid
//                              // beskriver det som visas
//     title, caption, logo, info, altText
//   })
//
// Jämförelser (år mot år, region mot region) ska synas utan klick: använd
// facet i stället för rullgardin när texten jämför. Rullgardinen passar när
// läsaren ska hitta "sin" kommun och huvudbudskapet syns i standardvyn.
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import { skapaRam, stilXAxel, ritaGrid, yTitel, valPill, skapaTooltip, tooltipHtml,
         FARG, TYP, STORLEK, SERIEFARGER, matText, fmtTal, pekarPos, axelFmt, medEnhet, ritbredd } from "../lib/grafRam.js";

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
  facet = null,
  facetValues = null,
  facetCols = null,
  enhetAntal = "antal",    // enhet i undertiteln när Antal visas (t.ex. "kilometer")
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
  let measureIdx = 0;
  let data = measures ? measures[0].data : initialData;
  let visaAndel = normalize;
  const allaRader = measures ? measures.flatMap(m => m.data) : initialData;
  const allYears = time
    ? [...new Set(allaRader.map(d => d[time]))].filter(v => v != null).sort(tidSort)
    : [];
  if (timeOrder) allYears.sort((a, b) => timeOrder.indexOf(a) - timeOrder.indexOf(b));
  let currentYear = allYears.length ? (timeDefault != null && allYears.includes(timeDefault) ? timeDefault : allYears[allYears.length - 1]) : null;

  // Små multiplar kräver bredd: på smal skärm blir panelerna en väljare i stället
  const W = width || ritbredd(820);
  const smal = W < 600;
  const facetMatt = !smal && facet === "measures" && measures && measures.length > 1;
  const facetTid = !smal && facet === "time" && time && allYears.length > 1;
  const tidPaneler = facetTid
    ? (facetValues ? facetValues.filter(v => allYears.includes(v)) : [allYears[0], allYears[allYears.length - 1]])
    : [];

  const groups = colorOrder || [...new Set(allaRader.map(d => d[color]))];
  const farg = Array.isArray(colors)
    ? d3.scaleOrdinal().domain(groups).range(colors)
    : (g) => colors[g] ?? "#999";

  // ── Layout ──
  const marginTop = 34;
  const marginRight = 22;
  const marginBottom = 30 + (xLabel ? 16 : 0);
  const fmtAndel = d => `${d.toFixed(0)} %`;
  const fmtAndel1 = d => `${d.toFixed(1).replace(".", ",")} %`;
  const fmtAntal = d => fmtTal(d);

  const undertext = () => {
    let t;
    if (typeof subtitle === "function") {
      t = subtitle({ ar: facetTid ? tidPaneler : currentYear, matt: measures ? measures[measureIdx].label : null, andel: visaAndel });
    } else if (measures && !facetMatt && measures[measureIdx].subtitle) t = measures[measureIdx].subtitle;
    else t = subtitle;
    // Med Andel/Antal-växel står enheten i undertiteln och byts vid växling
    return toggle && xAntal && !grouped ? medEnhet(t, visaAndel, { antal: enhetAntal }) : t;
  };

  const ram = skapaRam({ title, subtitle: undertext(), caption });
  const container = ram.container;
  const tooltip = skapaTooltip(ram.body);
  const svg = ram.svg(W, 100);
  const gPaneler = svg.append("g").attr("class", "graf-paneler");
  let ytit = null;

  // Legend (chips ovanför plotytan)
  const legend = container.insert("div", ".graf-body").attr("class", "graf-legend-chips");
  groups.forEach(g => {
    const item = legend.append("span").attr("class", "graf-legend-chip");
    item.append("span").attr("class", "graf-legend-prick").style("background", farg(g));
    item.append("span").text(g);
  });

  // ── Paneler: en utan facet, annars en per mått eller år ──
  function paneler() {
    if (facetMatt) return measures.map(m => ({
      namn: m.label,
      data: time && currentYear != null ? m.data.filter(r => r[time] === currentYear) : m.data
    }));
    if (facetTid) return tidPaneler.map(t => ({ namn: String(t), data: data.filter(r => r[time] === t) }));
    const d = time && currentYear != null ? data.filter(r => r[time] === currentYear) : data;
    return [{ namn: null, data: d }];
  }

  function ordning(d) {
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
    return ys;
  }

  function byggRader(d, ys) {
    const perY = d3.group(d, r => r[y]);
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
        return { key: k, seg, total, sum: d3.max(seg, s => s.v), min: d3.min(seg, s => s.v), tom: !rader.length };
      }
      seg.forEach(s => { s.v = visaAndel ? s.andel : (s.antal || 0); s.x0 = ack; s.x1 = ack + s.v; ack = s.x1; });
      return { key: k, seg, total, sum: ack, min: 0, tom: !rader.length };
    });
  }

  // ── Rita ──
  function rita() {
    const pan = paneler();
    // gemensam radordning: första panelens ordning, sedan nya nycklar
    const ys = [];
    pan.forEach(p => ordning(p.data).forEach(k => { if (!ys.includes(k)) ys.push(k); }));
    pan.forEach(p => { p.rader = byggRader(p.data, ys); });

    const nP = pan.length;
    const cols = Math.min(nP, facetCols || (nP <= 4 ? nP : 3));
    const radP = Math.ceil(nP / cols);
    const maxLabel = Math.max(0, ...ys.map(k => matText(String(k), { size: 13, weight: 600 })));
    const labelW = 16 + maxLabel + 12;
    const panelGap = nP > 1 ? 22 : 0;
    const panelW = (W - labelW - marginRight - panelGap * (cols - 1)) / cols;
    const radH = grouped ? barHeight * groups.length + 2 * (groups.length - 1) : barHeight;
    // Paneltitlar radbryts om de inte ryms i panelens bredd
    const titelRader = (t) => {
      if (!t || matText(t, { size: 12.5, weight: 600 }) <= panelW) return [t || ""];
      const ord = t.split(" "); let a = ord[0], i = 1;
      while (i < ord.length && matText(a + " " + ord[i], { size: 12.5, weight: 600 }) <= panelW) a += " " + ord[i++];
      return [a, ord.slice(i).join(" ")];
    };
    const tvaRader = nP > 1 && pan.some(p => titelRader(p.namn).length > 1);
    const titelH = nP > 1 ? (tvaRader ? 38 : 22) : 0;
    const plotH = ys.length * (radH + gap) - gap;
    const panelH = titelH + plotH + marginBottom;
    const H = marginTop + radP * panelH + (radP - 1) * 18;
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const andelSkala = visaAndel && !grouped;
    const alla = pan.flatMap(p => p.rader);
    const xMax = andelSkala ? 100 : (valueMax ?? (d3.max(alla, r => r.sum) || 1));
    const xMin = grouped ? Math.min(0, d3.min(alla, r => r.min) || 0) : 0;
    const xs0 = d3.scaleLinear().domain([xMin, xMax]).nice(andelSkala ? 1 : 5).range([0, panelW]);
    if (andelSkala) xs0.domain([0, 100]);
    const ticks = andelSkala ? (panelW < 260 ? [0, 50, 100] : [0, 20, 40, 60, 80, 100]) : xs0.ticks(panelW < 260 ? 3 : 5);
    const fmt = formatX || (andelSkala ? fmtAndel : fmtAntal);

    // y-titel (Andel/Antal)
    if (ytit) ytit.g.remove();
    const yt = { x: labelW, y: marginTop - 12 };
    if (toggle && xAntal && !grouped) {
      ytit = yTitel(svg, { ...yt, text: visaAndel ? "Andel" : "Antal", options: ["Andel", "Antal"],
        activeIndex: visaAndel ? 0 : 1, body: ram.body,
        onSelect: (i) => { visaAndel = i === 0; ram.setSubtitle(undertext()); rita(); } });
    } else {
      ytit = yTitel(svg, { ...yt, text: xLabel || (visaAndel ? "Andel" : "Antal") });
    }

    const gP = gPaneler.selectAll("g.panel").data(pan, p => p.namn ?? "_").join(
      enter => { const g = enter.append("g").attr("class", "panel");
        g.append("g").attr("class", "graf-grid"); g.append("g").attr("class", "graf-rader");
        g.append("g").attr("class", "graf-xaxel"); g.append("text").attr("class", "panel-titel"); return g; },
      update => update, exit => exit.remove());

    gP.each(function (p, pi) {
      const g = d3.select(this);
      const c = pi % cols, r = Math.floor(pi / cols);
      const ox = labelW + c * (panelW + panelGap), oy = marginTop + r * (panelH + 18);
      g.attr("transform", `translate(${ox},${oy})`);
      const xs = xs0.copy();
      const y0 = titelH;

      const pt = g.select("text.panel-titel")
        .attr("x", 0).attr("y", 12).attr("font-family", TYP.ui).attr("font-size", 12.5).attr("font-weight", 600)
        .attr("fill", FARG.ink).text(null);
      if (p.namn && nP > 1) titelRader(p.namn).forEach((r, i) => pt.append("tspan").attr("x", 0).attr("dy", i ? "1.25em" : 0).text(r));

      ritaGrid(g.select(".graf-grid"), { ticks, scale: xs, x1: y0 - 4, x2: y0 + plotH + 4, noll: grouped ? 0 : null, horisontell: false });
      g.select(".graf-xaxel").attr("transform", `translate(0,${y0 + plotH + 4})`)
        .call(d3.axisBottom(xs).tickValues(ticks).tickFormat(axelFmt(fmt)).tickSize(4))
        .call(ax => stilXAxel(ax));
      g.select(".graf-xaxel .domain").remove();
      // Små multiplar: ytterticksen ankras inåt så att "100 %" och nästa panels "0 %" inte går ihop
      {
        const tt = g.selectAll(".graf-xaxel .tick text");
        const n = tt.size();
        tt.attr("text-anchor", (_, i) => i === 0 && nP > 1 ? "start" : i === n - 1 ? "end" : "middle");
      }

      const rows = g.select(".graf-rader").selectAll("g.rad").data(p.rader, d => d.key).join(
        enter => enter.append("g").attr("class", "rad"),
        update => update,
        exit => exit.remove()
      ).attr("transform", (_, i) => `translate(0,${y0 + i * (radH + gap)})`);

      // kategorinamn bara i första kolumnen
      rows.selectAll("text.etikett").data(d => c === 0 ? [d] : []).join("text")
        .attr("class", "etikett")
        .attr("x", -10).attr("y", radH / 2).attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .attr("font-family", TYP.ui).attr("font-size", 13)
        .attr("font-weight", d => (bold || []).includes(d.key) ? 700 : 500)
        .attr("fill", FARG.ink)
        .text(d => d.key);

      const segs = rows.selectAll("g.seg").data(d => d.tom ? [] : d.seg.map(s => ({ ...s, rad: d, panel: p.namn })), s => s.grupp)
        .join(enter => {
          const sg = enter.append("g").attr("class", "seg").style("cursor", "pointer");
          sg.append("rect").attr("rx", 1);
          sg.append("text").attr("class", "inl").attr("pointer-events", "none")
            .attr("text-anchor", "middle").attr("font-family", TYP.ui)
            .attr("font-size", 12).attr("font-weight", 600).attr("fill", "#fff");
          return sg;
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
        gPaneler.selectAll("g.rad").style("opacity", d => d.key === s.rad.key ? 1 : 0.35);
        const delar = [s.rad.key, s.panel, time && currentYear != null && !facetTid ? currentYear : null].filter(v => v != null && v !== "");
        const rubrik = `${delar.join(" · ")}${s.rad.total != null ? ` <span style="font-weight:400;color:${FARG.mjuk}">${fmtAntal(s.rad.total)} totalt</span>` : ""}`;
        const rader = s.rad.seg.map(z => ({
          namn: z.grupp, farg: farg(z.grupp), fokus: z.grupp === s.grupp,
          varde: grouped ? fmt(z.v) : (xAntal ? `${fmtAndel1(z.andel)} (${fmtAntal(z.antal)})` : fmtAndel1(z.andel))
        }));
        tooltip.visa(tooltipHtml(rubrik, rader), pekarPos(event, ram.body));
      }).on("mousemove", (event) => tooltip.flytta(pekarPos(event, ram.body)))
        .on("mouseleave", () => { gPaneler.selectAll("g.rad").style("opacity", 1); tooltip.dolj(); });
    });
  }

  // ── Reglage i nedre raden (bara för dimensioner som inte redan är paneler) ──
  if (measures && measures.length > 1 && !facetMatt) {
    valPill(ram.controlsLeft, {
      label: measureLabel, options: measures.map(m => m.label), activeIndex: 0, body: ram.body,
      onSelect: (i) => { measureIdx = i; data = measures[i].data; ram.setSubtitle(undertext()); rita(); }
    });
  }
  if (time && allYears.length > 1 && !facetTid) {
    valPill(ram.controlsLeft, {
      label: timeLabel, options: allYears.map(String), activeIndex: Math.max(0, allYears.indexOf(currentYear)), body: ram.body,
      onSelect: (i) => { currentYear = allYears[i]; ram.setSubtitle(undertext()); rita(); }
    });
  }

  if (info) container.attr("data-info", info);
  if (altText) svg.attr("aria-label", altText);
  rita();
  addExportButton(container, svg.node(), { title, logo });
  return container.node();
}
