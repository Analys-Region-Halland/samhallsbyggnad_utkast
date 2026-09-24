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
//     diverging: false,        // true = negativa delar staplas åt vänster från noll
//                              // (antal-läget), t.ex. komponenter som kan vara negativa
//     totalField: null,        // fält med ett totalvärde som skrivs vid stapelns slut
//                              // (t.ex. ett officiellt totaltal som inte är summan)
//     totalLabel: null,        // (värde, rad) => text för totaletiketten
//     measuresInYTitle: false, // true = measures väljs i y-titelns rullgardin (enhet)
//                              // i stället för i nedre raden; measures[i].formatX
//                              // formaterar axel, etiketter och tooltip
//     nivaer: null,            // nivåval länet/kommunerna, "Visa: Kommunerna ▾" (se
//                              // nivaKonfig i grafRam.js). Måttnyckeln för standard/snitt
//                              // är "andel"/"antal" vid toggle, annars measures[i].key ?? label.
//                              // Utan standard: Andel → Alla, Antal → Kommunerna.
//     subtitle: "…" | (ctx) => "…"   // funktion får { ar, matt, andel, niva } och
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
         FARG, TYP, STORLEK, SERIEFARGER, matText, fmtTal, pekarPos, axelFmt, medEnhet, ritbredd,
         nivaKonfig, nivaValjare } from "../lib/grafRam.js";

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
  diverging = false,
  totalField = null,
  totalLabel = null,
  measuresInYTitle = false,
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
  minLabelWidth = 34,
  nivaer = null
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

  // ── Nivåval (länet/kommunerna), bara med option nivaer ──
  const nivaCfg = nivaer ? nivaKonfig(nivaer, { serier: allaRader.map(d => d[y]) }) : null;
  const harToggle = toggle && xAntal && !grouped && !measuresInYTitle;
  const mattNyckel = () => harToggle ? (visaAndel ? "andel" : "antal")
    : measures && measures[measureIdx] ? (measures[measureIdx].key ?? measures[measureIdx].label) : null;
  const nivaReserv = () => (visaAndel && !grouped && !measuresInYTitle) ? "alla" : "kommuner";
  let niva = nivaCfg ? nivaCfg.standard(mattNyckel(), nivaReserv()) : "alla";
  let nivaCtrl = null;
  const nivaFilter = (rows) => nivaCfg ? rows.filter(r => nivaCfg.visas(r[y], niva)) : rows;
  const foljNiva = () => { if (nivaCtrl) niva = nivaCtrl.folj(mattNyckel(), nivaReserv()); };

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
  // Nya optioner (diverging, totalField, measuresInYTitle) använder måttets egen
  // formatterare för etiketter och tooltip; övriga anrop behåller sitt beteende.
  const nyStil = diverging || !!totalField || measuresInYTitle;
  const fmtMatt = () => (measures && measures[measureIdx] && measures[measureIdx].formatX) || formatX || fmtAntal;

  const undertext = () => {
    let t;
    if (typeof subtitle === "function") {
      t = subtitle({ ar: facetTid ? tidPaneler : currentYear, matt: measures ? measures[measureIdx].label : null, andel: visaAndel, niva });
    } else if (measures && !facetMatt && measures[measureIdx].subtitle) t = measures[measureIdx].subtitle;
    else t = subtitle;
    if (nivaCfg && typeof subtitle !== "function") t = nivaCfg.text(t, niva);
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
    let pan;
    if (facetMatt) pan = measures.map(m => ({
      namn: m.label,
      data: time && currentYear != null ? m.data.filter(r => r[time] === currentYear) : m.data
    }));
    else if (facetTid) pan = tidPaneler.map(t => ({ namn: String(t), data: data.filter(r => r[time] === t) }));
    else pan = [{ namn: null, data: time && currentYear != null ? data.filter(r => r[time] === currentYear) : data }];
    if (!nivaCfg) return pan;
    // Nivåval: visade rader + de dolda länsraderna (till tooltip och referens)
    return pan.map(p => ({ ...p, data: nivaFilter(p.data), lanData: niva === "kommuner" ? p.data.filter(r => nivaCfg.arLan(r[y])) : [] }));
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
      const totVal = totalField && rader.length ? rader[0][totalField] : null;
      let ack = 0;
      if (diverging && !grouped && !visaAndel) {
        let pos = 0, neg = 0;
        seg.forEach(s => {
          s.v = s.antal || 0;
          if (s.v >= 0) { s.x0 = pos; s.x1 = pos + s.v; pos = s.x1; }
          else { s.x1 = neg; s.x0 = neg + s.v; neg = s.x0; }
        });
        return { key: k, seg, total, totVal, sum: pos, min: neg, tom: !rader.length };
      }
      if (grouped) {
        seg.forEach(s => { s.v = +s.andel; s.x0 = Math.min(0, s.v); s.x1 = Math.max(0, s.v); });
        return { key: k, seg, total, sum: d3.max(seg, s => s.v), min: d3.min(seg, s => s.v), tom: !rader.length };
      }
      seg.forEach(s => { s.v = visaAndel ? s.andel : (s.antal || 0); s.x0 = ack; s.x1 = ack + s.v; ack = s.x1; });
      return { key: k, seg, total, totVal, sum: ack, min: 0, tom: !rader.length };
    });
  }

  // ── Rita ──
  function rita() {
    const pan = paneler();
    // gemensam radordning: första panelens ordning, sedan nya nycklar
    const ys = [];
    pan.forEach(p => ordning(p.data).forEach(k => { if (!ys.includes(k)) ys.push(k); }));
    pan.forEach(p => { p.rader = byggRader(p.data, ys); });
    // Kommunvyn: dolda länsrader (tooltip) och länssnittet som referens där länet är ett snitt
    pan.forEach(p => { p.lanRader = p.lanData && p.lanData.length ? byggRader(p.lanData, [...new Set(p.lanData.map(r => r[y]))]) : []; });
    const refAktiv = !!nivaCfg && niva === "kommuner" && nivaCfg.arSnitt(mattNyckel()) && !grouped && !(visaAndel && !grouped);
    pan.forEach(p => { p.ref = refAktiv ? (p.lanRader.find(r => nivaCfg.snittSerier.includes(r.key) && !r.tom) || null) : null; });

    const nP = pan.length;
    const cols = Math.min(nP, facetCols || (nP <= 4 ? nP : 3));
    const radP = Math.ceil(nP / cols);
    const maxLabel = Math.max(0, ...ys.map(k => matText(String(k), { size: 13, weight: 600 })));
    const labelW = 16 + maxLabel + 12;
    const totTxt = (r) => r.totVal == null ? "" : (totalLabel ? totalLabel(r.totVal, r) : fmtMatt()(r.totVal));
    const totW = totalField ? 10 + Math.max(0, ...pan.flatMap(p => p.rader).map(r => matText(totTxt(r), { size: 12.5, weight: 700 }))) : 0;
    const panelGap = nP > 1 ? 22 : 0;
    const panelW = (W - labelW - marginRight - totW - panelGap * (cols - 1)) / cols;
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
    const xMax = andelSkala ? 100 : (valueMax ?? (d3.max(alla.concat(pan.map(p => p.ref).filter(Boolean)), r => r.sum) || 1));
    const xMin = (grouped || (diverging && !visaAndel)) ? Math.min(0, d3.min(alla, r => r.min) || 0) : 0;
    const xs0 = d3.scaleLinear().domain([xMin, xMax]).nice(andelSkala ? 1 : 5).range([0, panelW]);
    // Diverging: en liten negativ del ska inte ge en hel negativ tickenhet;
    // bara övre gränsen rundas, den nedre följer datan.
    if (diverging && !visaAndel && !grouped && xMin < 0) {
      xs0.domain([xMin * 1.05, xs0.domain()[1]]);
    }
    if (andelSkala) xs0.domain([0, 100]);
    const fmt = (measures && measures[measureIdx] && measures[measureIdx].formatX) || formatX || (andelSkala ? fmtAndel : fmtAntal);
    // Grupperat med negativa värden: etiketten till vänster om den mest negativa
    // stapeln får inte gå in i kategorinamnen, så skalan förlängs vid behov.
    if (grouped && xMin < 0) {
      const [m0, M0] = xs0.domain();
      const k = (matText(fmt(xMin), { size: 12 }) + 10) / panelW;
      if (xs0(xMin) < k * panelW && k < 0.5) xs0.domain([(xMin - k * M0) / (1 - k), M0]);
    }
    const ticks = andelSkala ? (panelW < 260 ? [0, 50, 100] : [0, 20, 40, 60, 80, 100])
      : xs0.ticks(panelW < 260 ? 3 : 5).filter(t => t >= xs0.domain()[0] - 1e-9);

    // y-titel (Andel/Antal)
    if (ytit) ytit.g.remove();
    const yt = { x: labelW, y: marginTop - 12 };
    if (measuresInYTitle && measures && measures.length > 1) {
      ytit = yTitel(svg, { ...yt, text: measures[measureIdx].label, options: measures.map(m => m.label),
        activeIndex: measureIdx, body: ram.body,
        onSelect: (i) => { measureIdx = i; data = measures[i].data; foljNiva(); ram.setSubtitle(undertext()); rita(); } });
    } else if (toggle && xAntal && !grouped) {
      ytit = yTitel(svg, { ...yt, text: visaAndel ? "Andel" : "Antal", options: ["Andel", "Antal"],
        activeIndex: visaAndel ? 0 : 1, body: ram.body,
        onSelect: (i) => { visaAndel = i === 0; foljNiva(); ram.setSubtitle(undertext()); rita(); } });
    } else {
      ytit = yTitel(svg, { ...yt, text: xLabel || (visaAndel ? "Andel" : "Antal") });
    }

    const gP = gPaneler.selectAll("g.panel").data(pan, p => p.namn ?? "_").join(
      enter => { const g = enter.append("g").attr("class", "panel");
        g.append("g").attr("class", "graf-grid"); g.append("g").attr("class", "graf-ref").attr("pointer-events", "none"); g.append("g").attr("class", "graf-rader");
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

      ritaGrid(g.select(".graf-grid"), { ticks, scale: xs, x1: y0 - 4, x2: y0 + plotH + 4, noll: (grouped || (diverging && !visaAndel)) ? 0 : null, horisontell: false });
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
          .text(s => (xs(s.x1) - xs(s.x0)) >= minLabelWidth ? (visaAndel ? fmtAndel(s.andel) : (nyStil ? fmtMatt()(s.antal) : fmtAntal(s.antal))) : "");
      }

      // Totaletikett vid stapelns slut (totalField)
      rows.selectAll("text.total").data(d => totalField && !d.tom && d.totVal != null ? [d] : []).join("text")
        .attr("class", "total")
        .attr("x", d => xs(Math.max(0, d.sum)) + 6).attr("y", radH / 2).attr("dy", "0.35em")
        .attr("text-anchor", "start").attr("font-family", TYP.ui).attr("font-size", 12.5)
        .attr("font-weight", 700).attr("fill", FARG.ink).style("font-variant-numeric", "tabular-nums")
        .text(d => totTxt(d));
      // Länssnittet i kommunvyn: grå streckad linje med namn och värde ovanför
      const gRef = g.select(".graf-ref");
      gRef.selectAll("*").remove();
      if (p.ref) {
        const rx = xs(p.ref.sum);
        const txt = `${p.ref.key} ${fmtMatt()(p.ref.sum)}`;
        const tw = matText(txt, { size: 11.5, weight: 600 });
        // håll etiketten fri från y-titeln (första panelen) och paneltiteln
        const upptaget = titelH > 0 ? matText(p.namn || "", { size: 12.5, weight: 600 }) + 10
          : (pi === 0 ? matText(ytit ? ytit.g.select("text").text() : "", { size: STORLEK.yTitel, weight: 500 }) + 24 : 0);
        let lx = rx, anchor = "middle";
        if (rx + tw / 2 > panelW) { lx = rx; anchor = "end"; }
        if ((anchor === "end" ? rx - tw : rx - tw / 2) < upptaget) { lx = Math.max(rx + 5, upptaget); anchor = "start"; }
        gRef.append("line").attr("x1", rx).attr("x2", rx).attr("y1", y0 - 3).attr("y2", y0 + plotH + 4)
          .attr("stroke", FARG.mjuk).attr("stroke-width", 1.3).attr("stroke-dasharray", "5,4");
        gRef.append("text").attr("class", "graf-ref-etikett").attr("x", lx).attr("y", y0 - 7).attr("text-anchor", anchor)
          .attr("font-family", TYP.ui).attr("font-size", 11.5).attr("font-weight", 600).attr("fill", FARG.mjuk)
          .style("font-variant-numeric", "tabular-nums").text(txt);
      }

      segs.on("mouseenter", function (event, s) {
        gPaneler.selectAll("g.rad").style("opacity", d => d.key === s.rad.key ? 1 : 0.35);
        const delar = [s.rad.key, s.panel, time && currentYear != null && !facetTid ? currentYear : null].filter(v => v != null && v !== "");
        const totTooltip = nyStil ? (s.rad.totVal != null ? fmtMatt()(s.rad.totVal) : null) : (s.rad.total != null ? fmtAntal(s.rad.total) : null);
        const rubrik = `${delar.join(" · ")}${totTooltip != null ? ` <span style="font-weight:400;color:${FARG.mjuk}">${totTooltip} totalt</span>` : ""}`;
        const vardeTxt = z => grouped ? fmt(z.v) : (nyStil && !visaAndel) ? fmtMatt()(z.antal) : (xAntal ? `${fmtAndel1(z.andel)} (${fmtAntal(z.antal)})` : fmtAndel1(z.andel));
        const rader = s.rad.seg.map(z => ({
          namn: z.grupp, farg: farg(z.grupp), fokus: z.grupp === s.grupp,
          varde: vardeTxt(z)
        }));
        // Kommunvyn: länets värde för samma del står kvar i tooltipen (summa eller snitt)
        const lanTxt = (p.lanRader || []).filter(r => !r.tom).map(r => {
          const z = r.seg.find(q => q.grupp === s.grupp);
          return z ? `${r.key}: ${vardeTxt(z)}` : null;
        }).filter(Boolean);
        tooltip.visa(tooltipHtml(rubrik, rader, { extra: lanTxt.length ? lanTxt.join("<br>") : null }), pekarPos(event, ram.body));
      }).on("mousemove", (event) => tooltip.flytta(pekarPos(event, ram.body)))
        .on("mouseleave", () => { gPaneler.selectAll("g.rad").style("opacity", 1); tooltip.dolj(); });
    });
  }

  // ── Reglage i nedre raden (bara för dimensioner som inte redan är paneler) ──
  // Nivåvalet först: "Visa: Kommunerna ▾"
  if (nivaCfg) {
    nivaCtrl = nivaValjare(ram.controlsLeft, nivaCfg, { body: ram.body, start: niva,
      onSelect: (n) => { niva = n; ram.setSubtitle(undertext()); rita(); } });
  }
  if (measures && measures.length > 1 && !facetMatt && !measuresInYTitle) {
    valPill(ram.controlsLeft, {
      label: measureLabel, options: measures.map(m => m.label), activeIndex: 0, body: ram.body,
      onSelect: (i) => { measureIdx = i; data = measures[i].data; foljNiva(); ram.setSubtitle(undertext()); rita(); }
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
