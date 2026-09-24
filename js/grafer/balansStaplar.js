// =============================================================================
// BALANSSTAPLAR — flöden in och ut per område, med nettot markerat.
//
// En rad per område. Varje rad har tre delar som läses i samma skala:
//   bas     stapel i egen kolumn till vänster (t.ex. de som bor och arbetar i
//           kommunen), kan bestå av flera delar
//   ut      staplas åt vänster från en nollinje (inre del närmast noll)
//   in      staplas åt höger från samma nollinje
//   netto   = Σ in − Σ ut, markeras som en romb på flödesaxeln och som tal i
//           en egen kolumn längst till höger
//
// Raderna grupperas i paneler (t.ex. "Länet" och "Kommunerna"). Mått väljs i
// y-titelns rullgardin; med sharedScale: false får varje panel en egen skala
// (antal, där ett län annars trycker ihop kommunerna), med true delar alla
// paneler skala (andelar). Skalan hålls fast över åren, så att staplarna kan
// jämföras när året byts i rullgardinen nere till vänster.
//
//   balansStaplar({
//     measures: [{ label, rows, format, subtitle: ({ar}) => "…", sharedScale }],
//     // rows: [{ panel, rad, ar, bas: [{key, label, v}], ut: […], in: […], netto,
//     //          tipRubrik?, tipExtra? }]
//     colors: { <key>: "#…" },          // färg per del
//     panelOrder, rowOrder,
//     headers: { bas, ut, in, netto },  // kolumnrubriker
//     legend: [{ label, colors: [...] } | { label, symbol: "romb" }],
//     year: 2024,                       // startår (default senaste)
//     title, caption, logo, info, altText
//   })
// =============================================================================
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";
import {
  skapaRam, TYP, FARG, matText, yTitel, valPill, skapaTooltip, tooltipHtml,
  pekarPos, ritbredd, arSmal } from "../lib/grafRam.js";

export function balansStaplar({
  measures,
  colors = {},
  panelOrder = null,
  rowOrder = null,
  headers = { bas: "Bor och arbetar där", ut: "Utpendling", in: "Inpendling", netto: "Netto" },
  legend = null,
  year = null,
  nettoFarg = { pos: "#004990", neg: "#B35400", noll: FARG.ink },
  width = null,
  title = null,
  caption = null,
  logo = null,
  info = null,
  altText = null
} = {}) {

  let mIdx = 0;
  const alla = measures.flatMap(m => m.rows);
  const years = [...new Set(alla.map(r => r.ar))].sort((a, b) => a - b);
  let ar = year != null && years.includes(year) ? year : years[years.length - 1];
  const panels = panelOrder || [...new Set(alla.map(r => r.panel))];
  const rowsOf = p => {
    const rs = [...new Set(alla.filter(r => r.panel === p).map(r => r.rad))];
    return rowOrder ? rs.sort((a, b) => rowOrder.indexOf(a) - rowOrder.indexOf(b)) : rs;
  };
  const M = () => measures[mIdx];
  const fmt = v => (M().format || (x => Math.round(x).toLocaleString("sv-SE")))(v);
  const fmtNetto = v => (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v));
  const farg = k => colors[k] || "#999";
  const sum = parts => d3.sum(parts, p => p.v);

  // ── Layout ──
  const W = width || ritbredd(880);
  const smal = arSmal(W, 880);
  const fs = smal ? 12 : 12.5;           // radetiketter och värden
  const rowH = smal ? 26 : 28, barH = smal ? 15 : 16;
  const topH = 30;                        // y-titel
  const headH = 22;                       // kolumnrubriker
  const panelTitleH = 26, panelGap = 16;
  const gapBas = smal ? 12 : 22, gapNetto = smal ? 10 : 16;

  const subtitleText = () => {
    const s = M().subtitle;
    return typeof s === "function" ? s({ ar }) : s;
  };
  const ram = skapaRam({ title, subtitle: subtitleText(), caption });
  const container = ram.container;

  // Chips-legend ovanför plotytan
  if (legend && legend.length) {
    const lg = container.insert("div", ".graf-body").attr("class", "graf-legend-chips");
    legend.forEach(it => {
      const chip = lg.append("span").attr("class", "graf-legend-chip");
      if (it.symbol === "romb") {
        chip.append("span").attr("class", "graf-legend-prick")
          .style("background", FARG.ink).style("width", "9px").style("height", "9px")
          .style("transform", "rotate(45deg)").style("border-radius", "1px").style("margin", "0 2px");
      } else {
        const par = chip.append("span").style("display", "inline-flex").style("gap", "2px");
        (it.colors || []).forEach(c => par.append("span").attr("class", "graf-legend-prick").style("background", c));
      }
      chip.append("span").text(it.label);
    });
  }

  const svg = ram.svg(W, 100);
  const tip = skapaTooltip(ram.body);
  const yt = yTitel(svg, {
    x: 0, y: 16, text: M().label,
    options: measures.length > 1 ? measures.map(m => m.label) : null,
    activeIndex: 0, body: ram.body,
    onSelect: i => { mIdx = i; yt.set(M().label, i); ram.setSubtitle(subtitleText()); rita(); }
  });
  const g = svg.append("g");

  function rita() {
    g.selectAll("*").remove();
    const rows = M().rows;
    const cur = rows.filter(r => r.ar === ar);

    // Etikettbredder
    const labelW = Math.max(...rows.map(r => matText(r.rad, { size: fs, weight: 600 }))) + 14;
    const valW = Math.max(...rows.flatMap(r => [sum(r.bas), sum(r.ut), sum(r.in)]).map(v => matText(fmt(v), { size: fs - 0.5 }))) + 8;
    const netW = Math.max(matText(headers.netto, { size: 11, weight: 600 }),
      ...rows.map(r => matText(fmtNetto(r.netto), { size: fs, weight: 700 }))) + 4;

    // Kolumnbredder: andelar ur varje panels största värden (över alla år)
    const ext = panels.map(p => {
      const pr = rows.filter(r => r.panel === p);
      return { p, b: d3.max(pr, r => sum(r.bas)) || 0, u: d3.max(pr, r => sum(r.ut)) || 0, i: d3.max(pr, r => sum(r.in)) || 0 };
    });
    const shared = !!M().sharedScale;
    let fb, fu, fi;
    if (shared) {
      fb = d3.max(ext, e => e.b); fu = d3.max(ext, e => e.u); fi = d3.max(ext, e => e.i);
    } else {
      const fr = ext.map(e => { const t = e.b + e.u + e.i || 1; return { b: e.b / t, u: e.u / t, i: e.i / t }; });
      fb = d3.max(fr, f => f.b); fu = d3.max(fr, f => f.u); fi = d3.max(fr, f => f.i);
    }
    const fT = fb + fu + fi || 1;
    // Smal skärm: basvärdet skrivs inne i stapeln, så basen behöver ingen etikettmarginal
    const valB = smal ? 0 : valW;
    const barArea = W - labelW - valB - gapBas - valW - valW - gapNetto - netW - 2;
    const Wb = barArea * fb / fT, Wu = barArea * fu / fT, Wi = barArea * fi / fT;
    const xBas = labelW;
    const x0 = labelW + Wb + valB + gapBas + valW + Wu;     // nollinjen
    const xNet = x0 + Wi + valW + gapNetto + netW;          // högerkant nettokolumn
    const kFor = e => shared
      ? Math.min(Wb / (fb || 1), Wu / (fu || 1), Wi / (fi || 1))
      : Math.min(e.b ? Wb / e.b : Infinity, e.u ? Wu / e.u : Infinity, e.i ? Wi / e.i : Infinity);

    // Kolumnrubriker
    const hy = topH + 12;
    const hText = (x, anchor, t) => g.append("text").attr("x", x).attr("y", hy)
      .attr("text-anchor", anchor).attr("font-family", TYP.ui).attr("font-size", 11)
      .attr("font-weight", 600).attr("fill", FARG.text).text(t);
    hText(xBas, "start", headers.bas);
    hText(x0 - 6, "end", "← " + headers.ut);
    hText(x0 + 6, "start", headers.in + " →");
    hText(xNet, "end", headers.netto);

    let y = topH + headH;
    panels.forEach((p, pi) => {
      const e = ext[pi];
      const k = kFor(e);
      const rs = rowsOf(p);
      if (pi > 0) y += panelGap;
      // panelrubrik + tunn linje
      g.append("line").attr("x1", 0).attr("x2", xNet).attr("y1", y + 2).attr("y2", y + 2)
        .attr("stroke", FARG.grid).attr("stroke-width", 1);
      g.append("text").attr("x", 0).attr("y", y + 18).attr("font-family", TYP.ui)
        .attr("font-size", 11.5).attr("font-weight", 700).attr("letter-spacing", "0.04em")
        .attr("fill", FARG.mjuk).text(String(p).toUpperCase());
      y += panelTitleH;
      const yTop = y;

      // nollinje
      g.append("line").attr("x1", x0).attr("x2", x0).attr("y1", yTop - 3).attr("y2", yTop + rs.length * rowH - (rowH - barH) + 3)
        .attr("stroke", FARG.noll).attr("stroke-width", 1);

      rs.forEach((radNamn, ri) => {
        const r = cur.find(z => z.panel === p && z.rad === radNamn);
        const ry = yTop + ri * rowH;
        const rg = g.append("g").attr("class", "balans-rad");
        rg.append("text").attr("x", 0).attr("y", ry + barH / 2).attr("dy", "0.35em")
          .attr("font-family", TYP.ui).attr("font-size", fs).attr("font-weight", 600)
          .attr("fill", FARG.ink).text(radNamn);
        if (!r) return;
        const nx = x0 + r.netto * k, ny = ry + barH / 2, s = barH / 2 + (smal ? 0.5 : 1.5);

        // bas
        let bx = xBas;
        r.bas.forEach(s => {
          const w = Math.max(0, s.v * k);
          rg.append("rect").attr("x", bx).attr("y", ry).attr("width", Math.max(0, w - (w > 2 ? 1 : 0)))
            .attr("height", barH).attr("fill", farg(s.key)).attr("rx", 1);
          bx += w;
        });
        const bTxt = fmt(sum(r.bas)), bEnd = xBas + r.bas[0].v * k, bInne = smal && (bEnd - xBas) > matText(bTxt, { size: fs - 0.5 }) + 10;
        rg.append("text").attr("x", bInne ? bEnd - 5 : bx + 5).attr("y", ry + barH / 2).attr("dy", "0.35em")
          .attr("text-anchor", bInne ? "end" : "start")
          .attr("font-family", TYP.ui).attr("font-size", fs - 0.5).attr("fill", bInne ? "#fff" : FARG.text)
          .attr("font-weight", bInne ? 600 : 400)
          .style("font-variant-numeric", "tabular-nums").text(bTxt);

        // ut (åt vänster, inre del först)
        let ux = x0;
        r.ut.forEach(s => {
          const w = Math.max(0, s.v * k);
          rg.append("rect").attr("x", ux - w).attr("y", ry).attr("width", Math.max(0, w - (w > 2 ? 1 : 0)))
            .attr("height", barH).attr("fill", farg(s.key));
          ux -= w;
        });
        rg.append("text").attr("x", Math.min(ux, nx - s) - 5).attr("y", ry + barH / 2).attr("dy", "0.35em")
          .attr("text-anchor", "end").attr("font-family", TYP.ui).attr("font-size", fs - 0.5)
          .attr("fill", FARG.text).style("font-variant-numeric", "tabular-nums").text(fmt(sum(r.ut)));

        // in (åt höger)
        let ix = x0;
        r.in.forEach(s => {
          const w = Math.max(0, s.v * k);
          rg.append("rect").attr("x", ix + (w > 2 ? 1 : 0)).attr("y", ry).attr("width", Math.max(0, w - (w > 2 ? 1 : 0)))
            .attr("height", barH).attr("fill", farg(s.key));
          ix += w;
        });
        rg.append("text").attr("x", Math.max(ix, nx + s) + 5).attr("y", ry + barH / 2).attr("dy", "0.35em")
          .attr("font-family", TYP.ui).attr("font-size", fs - 0.5).attr("fill", FARG.text)
          .style("font-variant-numeric", "tabular-nums").text(fmt(sum(r.in)));

        // netto: romb på flödesaxeln + tal i egen kolumn
        rg.append("path").attr("d", `M${nx},${ny - s} L${nx + s},${ny} L${nx},${ny + s} L${nx - s},${ny} Z`)
          .attr("fill", FARG.ink).attr("stroke", "#fff").attr("stroke-width", 1.6);
        const nf = r.netto > 0 ? nettoFarg.pos : r.netto < 0 ? nettoFarg.neg : nettoFarg.noll;
        rg.append("text").attr("x", xNet).attr("y", ny).attr("dy", "0.35em").attr("text-anchor", "end")
          .attr("font-family", TYP.ui).attr("font-size", fs).attr("font-weight", 700).attr("fill", nf)
          .style("font-variant-numeric", "tabular-nums").text(fmtNetto(r.netto));

        // hover: hela raden
        rg.append("rect").attr("x", 0).attr("y", ry - (rowH - barH) / 2).attr("width", xNet).attr("height", rowH)
          .attr("fill", "transparent").style("cursor", "default")
          .on("pointerenter", function (event) {
            g.selectAll("g.balans-rad").style("opacity", 0.4);
            rg.style("opacity", 1);
            tip.visa(tipHtml(r), pekarPos(event, ram.body));
          })
          .on("pointermove", event => tip.flytta(pekarPos(event, ram.body)))
          .on("pointerleave", () => { g.selectAll("g.balans-rad").style("opacity", 1); tip.dolj(); });
      });
      y = yTop + rs.length * rowH - (rowH - barH);
    });

    const H = y + 10;
    svg.attr("viewBox", `0 0 ${W} ${H}`);
  }

  function tipHtml(r) {
    const rad = (s, fokus = false) => ({ namn: s.label, varde: fmt(s.v), farg: farg(s.key), fokus });
    const rader = [];
    const tot = (label, parts, key) => {
      rader.push({ namn: `<b>${label}</b>`, varde: `<b>${fmt(sum(parts))}</b>`, farg: parts.length === 1 ? farg(parts[0].key) : "transparent" });
      if (parts.length > 1) parts.forEach(s => rader.push({ namn: "&nbsp;&nbsp;" + s.label, varde: fmt(s.v), farg: farg(s.key) }));
    };
    tot(headers.bas, r.bas);
    tot(headers.ut, r.ut);
    tot(headers.in, r.in);
    rader.push({ namn: "<b>Nettopendling (in − ut)</b>", varde: `<b>${fmtNetto(r.netto)}</b>`, farg: FARG.ink });
    return tooltipHtml(r.tipRubrik || `${r.rad} ${r.ar}`, rader, { extra: r.tipExtra || null });
  }

  if (years.length > 1) {
    valPill(ram.controlsLeft, {
      label: "År", options: years.map(String), activeIndex: years.indexOf(ar), body: ram.body,
      onSelect: i => { ar = years[i]; ram.setSubtitle(subtitleText()); rita(); }
    });
  }

  rita();
  addExportButton(container, svg.node(), {
    title, subtitle: subtitleText(), caption, width: W, height: +svg.attr("viewBox").split(" ")[3],
    altText, info, logo
  });
  return container.node();
}
