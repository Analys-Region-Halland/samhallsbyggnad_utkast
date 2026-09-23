// =============================================================================
// GRAFRAM — gemensam ram, typografi och reglage för alla grafmoduler.
//
// Alla moduler bygger sin figur i samma skal så att rapporten får ETT
// grafspråk (Our World in Data / kommundata-stil):
//
//   .graf-container
//     .graf-header      titel (Source Serif 4), undertitel, verktyg uppe till höger
//     (avlasning()      valfri tooltip vid pekaren för hover-värden)
//     .graf-body        svg + tooltip + rullgardinsmenyer
//     .graf-footer      .graf-controls (väljare: region, år …) + källrad
//
// Reglage som alla moduler delar:
//   yTitel()     horisontell y-titel ovanför y-axeln; blir en rullgardin när
//                grafen har flera mått (enhet väljs genom att klicka på titeln)
//   valPill()    liten knapp med rullgardin i nedre raden (t.ex. region)
//   skapaTooltip() enhetlig tooltip
//
// All CSS ligger i style.scss (sektionen GRAFSYSTEM). Ingen modul injicerar
// egna <style>-block längre.
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// ── Typografi och färger (speglar style.scss) ──
export const TYP = {
  ui:    "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
  titel: "'Source Serif 4', Georgia, serif"
};

export const FARG = {
  ink:    "#1f2422",   // starkaste text i grafen (titel, x-axel)
  text:   "#5b5b5b",   // axeletiketter, y-titel
  mjuk:   "#8a8f8d",   // undertext, källa
  dampad: "#c9cccb",   // nedtonade serier
  grid:   "#d9d9d9",   // streckade gridlinjer
  noll:   "#a8a8a8",   // nollinje / referens
  axel:   "#c4c8c6",   // x-axelns baslinje
  gron:   "#00664D",
  bla:    "#004990"
};

// Storlekar i SVG-pixlar (viewBox-enheter)
export const STORLEK = {
  tick: 12,        // y-axelns etiketter
  tickX: 12.5,     // x-axelns etiketter
  etikett: 12,     // direktetiketter vid linjeslut
  yTitel: 12,      // horisontell y-titel
  axelTitel: 12    // x-axeltitel
};

// Standardpalett för serier: Region Hallands grön och blå först
export const SERIEFARGER = ["#00664D", "#004990", "#FF7E00", "#433C9D", "#2DB8F6", "#A51300", "#895B42"];

// Kapitlets accentfärg (från --accent på .kr-rapport). Faller tillbaka på grön.
export function accentFarg(el) {
  try {
    const node = el && el.node ? el.node() : el;
    const v = getComputedStyle(node || document.body).getPropertyValue("--accent").trim();
    return v || FARG.gron;
  } catch (e) { return FARG.gron; }
}

// ── Textmätning (elementen är inte monterade när modulen ritar) ──
const _ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
export function matText(text, { size = 12, weight = 400, family = TYP.ui } = {}) {
  if (!_ctx) return String(text).length * size * 0.55;
  _ctx.font = `${weight} ${size}px ${family}`;
  return _ctx.measureText(String(text)).width;
}

// ── Ritbredd: graferna ritas i en viewBox som skalas till rutans bredd. På
// smala skärmar ritas de i stället nära den verkliga bredden, så att text och
// axlar behåller läsbar storlek (annars krymper 12 px till ~5 px på mobil).
// Beräknas när grafen skapas (fönstrets bredd), standardbredden på desktop.
export function ritbredd(standard = 780) {
  if (typeof document === "undefined") return standard;
  const vw = document.documentElement.clientWidth || window.innerWidth || standard;
  const tillg = vw - 58;                       // sidomarginaler + rutans padding
  if (tillg >= standard * 0.92) return standard;
  return Math.round(Math.min(standard, Math.max(standard * 0.5, tillg / 0.86)));
}
// Smal grafyta: färre ticks, legend/paneler byter läge
export const arSmal = (W, standard = 780) => W < standard * 0.75;

// Axeletiketter för stora tal på svenska: 2 500, 10 000, 250 000, 1 milj.
export const fmtAxelTal = (v) => {
  const a = Math.abs(+v);
  if (a >= 1e6) return (v / 1e6).toLocaleString("sv-SE", { maximumFractionDigits: 1 }) + " milj.";
  return (+v).toLocaleString("sv-SE", { maximumFractionDigits: 2 });
};

// Axeltick: heltal skrivs utan nolldecimaler ("25 %", inte "25,0 %"), även
// när grafens formatterare annars visar decimaler (värden, tooltips).
export const axelFmt = (fmt) => (t) => {
  const s = String(fmt(t));
  return Number.isInteger(+t) ? s.replace(/,0+(?![0-9])/, "") : s;
};

// Standardformatterare när grafen inte fått någon: samma antal decimaler på
// alla värden (0, 1 eller 2 efter vad datan kräver), så att "80" och "80,7"
// inte blandas i samma figur.
export function autoFmt(varden) {
  const v = varden.filter(x => x != null && !Number.isNaN(+x)).map(Number);
  let dec = 0;
  if (v.some(x => Math.abs(x * 1) % 1 > 1e-9)) dec = 1;
  if (dec && v.every(x => Math.abs(x) < 10) && v.some(x => Math.abs(x * 10) % 1 > 1e-6)) dec = 2;
  return (x) => x == null || Number.isNaN(+x) ? "" : (+x).toLocaleString("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Undertitel med enhet för grafer med Andel/Antal-växel: enheten skrivs in
// efter första satsen ("Hushållen efter antal personer, andel i procent, 2025")
// och byts när läsaren växlar. Instruktioner och gamla enhetsfraser rensas bort.
export function medEnhet(text, andel, { antal = "antal", procent = "andel i procent" } = {}) {
  if (!text) return text;
  let s = String(text)
    .replace(/\s*\((?:växla|byt|välj)[^)]*\)/gi, "")
    .replace(/\.?\s*Andel (?:eller|och) [^.]+\./, ".")
    .replace(/,?\s*andel (?:eller|och) [^,.]+/i, "")
    .replace(/,?\s*andel i procent/i, "")
    .replace(/^Andel av (\S)/, (m, c) => c.toUpperCase());
  const enhet = andel ? procent : antal;
  const i = s.search(/[,.]/);
  return i < 0 ? `${s}, ${enhet}` : `${s.slice(0, i)}, ${enhet}${s.slice(i)}`;
}

export const fmtTal = (v, dec = 0) =>
  v == null || Number.isNaN(+v) ? "" :
  (+v).toLocaleString("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec });

// ── Ikoner (Feather-lika, 1.8 px linje) ──
export const IKON = {
  play:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>',
  paus:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>',
  ner:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  info:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.8" r="0.6" fill="currentColor"/></svg>',
  plus:  '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  pil:   '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  kryss: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  aterstall: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/></svg>'
};

// =============================================================================
// RAMEN
// =============================================================================
export function skapaRam({ title = null, subtitle = null, caption = null } = {}) {
  const container = d3.create("div").attr("class", "graf-container");
  const header = container.append("div").attr("class", "graf-header");
  const titleEl = header.append("div").attr("class", "graf-title").text(title || "")
    .style("display", title ? null : "none");
  const subtitleEl = header.append("div").attr("class", "graf-subtitle").text(subtitle || "")
    .style("display", subtitle ? null : "none");
  const tools = header.append("div").attr("class", "graf-tools");

  const body = container.append("div").attr("class", "graf-body");
  const svgWrap = body.append("div").attr("class", "graf-svg-container");

  const footer = container.append("div").attr("class", "graf-footer");
  const controls = footer.append("div").attr("class", "graf-controls");
  const controlsLeft = controls.append("div").attr("class", "graf-controls-left");
  const controlsRight = controls.append("div").attr("class", "graf-controls-right");
  const captionEl = footer.append("div").attr("class", "graf-caption").text(caption || "")
    .style("display", caption ? null : "none");

  let avlasningObj = null;

  return {
    container, header, tools, body, svgWrap, footer, controls, controlsLeft, controlsRight,
    titleEl, subtitleEl, captionEl,
    node: () => container.node(),
    setTitle(t) { titleEl.text(t || "").style("display", t ? null : "none"); },
    setSubtitle(t) { subtitleEl.text(t || "").style("display", t ? null : "none"); },
    setCaption(t) { captionEl.text(t || "").style("display", t ? null : "none"); },
    // Avläsning vid hover (staplar, lollipop, beeswarm, scatter …). Visas som
    // en tooltip vid pekaren; utan position följer den senaste pekarläget i
    // grafen. Tidigare en rad under rubriken, därav namnet.
    avlasning() {
      if (!avlasningObj) {
        const tt = skapaTooltip(body);
        tt.el.classed("graf-tooltip--avlasning", true);
        let senast = { x: 0, y: 0 };
        const spara = (event) => { senast = pekarPos(event, body); tt.flytta(senast); };
        body.on("pointermove.avlasning", spara).on("pointerdown.avlasning", spara);
        body.on("pointerleave.avlasning", (event) => { if (event.pointerType === "mouse") tt.dolj(); });
        avlasningObj = {
          el: tt.el,
          visa(html, pos = null) { tt.visa(html, pos || senast); },
          rensa() { tt.dolj(); }
        };
      }
      return avlasningObj;
    },
    // Lägg en SVG i kroppen med rätt klass och viewBox
    svg(width, height) {
      return svgWrap.append("svg")
        .attr("class", "graf-svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    }
  };
}

// =============================================================================
// AXLAR OCH GRID — samma utseende i alla moduler
// =============================================================================

// Y-axel: bara etiketter, ingen linje, inga tick-streck
export function stilYAxel(g, { dx = -8 } = {}) {
  g.select(".domain").remove();
  g.selectAll(".tick line").remove();
  g.selectAll(".tick text")
    .attr("x", dx)
    .attr("text-anchor", "end")
    .attr("fill", FARG.text)
    .attr("font-size", STORLEK.tick)
    .attr("font-family", TYP.ui)
    .style("font-variant-numeric", "tabular-nums");
  return g;
}

// X-axel: tunn baslinje, korta tick-streck, mörkare etiketter
export function stilXAxel(g, { anchor = "middle" } = {}) {
  g.select(".domain").attr("stroke", FARG.axel).attr("stroke-width", 1);
  g.selectAll(".tick line").attr("stroke", FARG.axel).attr("y2", 5);
  g.selectAll(".tick text")
    .attr("fill", FARG.ink)
    .attr("font-size", STORLEK.tickX)
    .attr("font-family", TYP.ui)
    .attr("text-anchor", anchor)
    .style("font-variant-numeric", "tabular-nums");
  glesaTicks(g);
  return g;
}

// Döljer x-etiketter som skulle överlappa föregående synliga etikett (smala
// grafer, täta skalor). Mäter med canvas eftersom grafen inte är monterad än.
export function glesaTicks(g, { luft = 8 } = {}) {
  let sistaHoger = -Infinity;
  g.selectAll(".tick").each(function () {
    const tick = d3.select(this);
    const t = tick.select("text");
    if (t.empty() || !t.text() || t.attr("transform")) return;   // vinklade etiketter hanteras inte
    const m = /translate\(([-\d.e]+)/.exec(tick.attr("transform") || "");
    if (!m) return;
    const x = +m[1];
    const w = matText(t.text(), { size: +t.attr("font-size") || STORLEK.tickX });
    const anchor = t.attr("text-anchor") || "middle";
    const v = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
    const synlig = v >= sistaHoger + luft;
    t.attr("opacity", synlig ? null : 0);
    if (synlig) sistaHoger = v + w;
  });
}

// Horisontella gridlinjer: streckade, nollinjen (eller ett referensvärde) heldragen
export function ritaGrid(g, { ticks, scale, x1, x2, noll = 0, horisontell = true } = {}) {
  g.selectAll("*").remove();
  ticks.forEach(t => {
    const p = scale(t);
    const arNoll = noll != null && Math.abs(t - noll) < 1e-9;
    const l = g.append("line")
      .attr("stroke", arNoll ? FARG.noll : FARG.grid)
      .attr("stroke-width", arNoll ? 1 : 0.8)
      .attr("stroke-dasharray", arNoll ? null : "4,4");
    if (horisontell) l.attr("x1", x1).attr("x2", x2).attr("y1", p).attr("y2", p);
    else l.attr("y1", x1).attr("y2", x2).attr("x1", p).attr("x2", p);
  });
  return g;
}

// Axeltitel för x (centrerad under axeln)
export function xTitel(svg, { x, y, text }) {
  return svg.append("text")
    .attr("class", "graf-xtitel")
    .attr("x", x).attr("y", y)
    .attr("text-anchor", "middle")
    .attr("font-family", TYP.ui)
    .attr("font-size", STORLEK.axelTitel)
    .attr("font-weight", 500)
    .attr("fill", FARG.text)
    .text(text || "");
}

// =============================================================================
// Y-TITEL — horisontell ovanför y-axeln. Med options blir den en rullgardin.
//
//   const yt = yTitel(svg, { x, y, text: "% per år",
//                            options: ["Årlig förändring (%)", "Antal", …],
//                            activeIndex: 0, body: ram.body,
//                            onSelect: (i) => switchMeasure(i) });
//   yt.set("Index", 3)      // uppdatera titel + aktivt val
// =============================================================================
export function yTitel(svg, { x, y, text = "", options = null, activeIndex = 0, onSelect = null, body = null } = {}) {
  const valbar = Array.isArray(options) && options.length > 1 && body;
  const g = svg.append("g")
    .attr("class", "graf-ytitel" + (valbar ? " graf-ytitel--valbar" : ""))
    .attr("transform", `translate(${x},${y})`);

  const label = g.append("text")
    .attr("x", 0).attr("y", 0)
    .attr("text-anchor", "start")
    .attr("font-family", TYP.ui)
    .attr("font-size", STORLEK.yTitel)
    .attr("font-weight", 500)
    .attr("fill", FARG.text)
    .text(text || "");

  let chevron = null, under = null, hit = null, meny = null, aktiv = activeIndex;

  function layout() {
    if (!valbar) return;
    const w = matText(label.text(), { size: STORLEK.yTitel, weight: 500 });
    chevron.attr("transform", `translate(${w + 5},${-4.5})`);
    under.attr("x1", 0).attr("x2", w);
    hit.attr("x", -4).attr("width", w + 22);
  }

  if (valbar) {
    under = g.append("line")
      .attr("class", "graf-ytitel-under")
      .attr("y1", 3.5).attr("y2", 3.5);
    chevron = g.append("path")
      .attr("class", "graf-ytitel-pil")
      .attr("d", "M0,0 L4,4 L8,0")
      .attr("fill", "none").attr("stroke-width", 1.6)
      .attr("stroke-linecap", "round").attr("stroke-linejoin", "round");
    hit = g.append("rect")
      .attr("y", -13).attr("height", 20)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .attr("role", "button")
      .attr("aria-label", "Välj mått");
    layout();

    hit.on("click", (event) => {
      event.stopPropagation();
      if (meny) { meny.stang(); meny = null; return; }
      meny = oppnaMeny(body, hit.node(), {
        options, activeIndex: aktiv,
        onSelect: (i) => { aktiv = i; if (onSelect) onSelect(i); },
        onClose: () => { meny = null; }
      });
    });
  }

  return {
    g,
    set(t, i) {
      if (t != null) label.text(t);
      if (i != null) aktiv = i;
      layout();
    },
    flytta(nx, ny) { g.attr("transform", `translate(${nx},${ny})`); }
  };
}

// =============================================================================
// RULLGARDINSMENY — HTML-overlay i .graf-body, förankrad vid ett element
// (SVG- eller HTML-element). Stängs vid klick utanför, Escape eller val.
// =============================================================================
export function oppnaMeny(body, anchorNode, { options, activeIndex = 0, onSelect, onClose = null, rubrik = null, riktning = "ner" } = {}) {
  body.selectAll(".graf-meny").remove();
  const bodyRect = body.node().getBoundingClientRect();
  const r = anchorNode.getBoundingClientRect();

  const meny = body.append("div")
    .attr("class", "graf-meny")
    .attr("role", "listbox")
    .style("left", `${Math.max(0, r.left - bodyRect.left)}px`);
  if (riktning === "upp") meny.style("bottom", `${bodyRect.bottom - r.top + 4}px`);
  else meny.style("top", `${r.bottom - bodyRect.top + 4}px`);

  if (rubrik) meny.append("div").attr("class", "graf-meny-rubrik").text(rubrik);

  const stang = () => {
    meny.remove();
    document.removeEventListener("pointerdown", utanfor, true);
    document.removeEventListener("keydown", tangent, true);
    if (onClose) onClose();
  };
  const utanfor = (e) => { if (!meny.node().contains(e.target)) stang(); };
  const tangent = (e) => { if (e.key === "Escape") stang(); };

  options.forEach((opt, i) => {
    const txt = typeof opt === "string" ? opt : (opt.label ?? String(opt));
    const rad = meny.append("div")
      .attr("class", "graf-meny-val" + (i === activeIndex ? " aktiv" : ""))
      .attr("role", "option")
      .attr("aria-selected", i === activeIndex ? "true" : "false")
      .on("click", (event) => { event.stopPropagation(); stang(); if (onSelect) onSelect(i); });
    rad.append("span").attr("class", "graf-meny-bock").html(i === activeIndex ? "✓" : "");
    rad.append("span").attr("class", "graf-meny-text").text(txt);
    if (typeof opt === "object" && opt.description) {
      rad.append("span").attr("class", "graf-meny-beskrivning").text(opt.description);
    }
  });

  // Håll menyn inom kroppen horisontellt
  requestAnimationFrame(() => {
    const m = meny.node(); if (!m) return;
    const mw = m.offsetWidth, bw = body.node().clientWidth;
    const left = parseFloat(meny.style("left"));
    if (left + mw > bw - 4) meny.style("left", `${Math.max(0, bw - mw - 4)}px`);
  });

  setTimeout(() => {
    document.addEventListener("pointerdown", utanfor, true);
    document.addEventListener("keydown", tangent, true);
  }, 0);

  return { el: meny, stang };
}

// =============================================================================
// VALPILL — knapp i nedre raden med rullgardin. Ex: region i stackedArea.
//   valPill(ram.controlsLeft, { label: "Region", options: ["Halland", …],
//                              activeIndex: 0, body: ram.body, onSelect })
// =============================================================================
export function valPill(parent, { label = null, options, activeIndex = 0, onSelect, body, ikon = null } = {}) {
  let aktiv = activeIndex;
  const btn = parent.append("button")
    .attr("type", "button")
    .attr("class", "graf-knapp graf-knapp--val");
  if (ikon) btn.append("span").attr("class", "graf-knapp-ikon").html(ikon);
  if (label) btn.append("span").attr("class", "graf-knapp-etikett").text(label + ":");
  const varde = btn.append("span").attr("class", "graf-knapp-varde")
    .text(typeof options[aktiv] === "string" ? options[aktiv] : options[aktiv].label);
  btn.append("span").attr("class", "graf-knapp-pil").html(IKON.pil);

  let meny = null;
  btn.on("click", (event) => {
    event.stopPropagation();
    if (meny) { meny.stang(); meny = null; return; }
    btn.classed("oppen", true);
    meny = oppnaMeny(body, btn.node(), {
      options, activeIndex: aktiv, riktning: "upp",
      onSelect: (i) => {
        aktiv = i;
        varde.text(typeof options[i] === "string" ? options[i] : options[i].label);
        if (onSelect) onSelect(i);
      },
      onClose: () => { meny = null; btn.classed("oppen", false); }
    });
  });
  return { el: btn, set(i) { aktiv = i; varde.text(typeof options[i] === "string" ? options[i] : options[i].label); } };
}

// Enkel växlare (två till fyra lägen, segmenterad): Andel | Antal
export function segment(parent, { options, activeIndex = 0, onSelect } = {}) {
  const wrap = parent.append("div").attr("class", "graf-segment").attr("role", "tablist");
  const knappar = options.map((o, i) =>
    wrap.append("button").attr("type", "button")
      .attr("class", "graf-segment-val" + (i === activeIndex ? " aktiv" : ""))
      .attr("role", "tab")
      .text(typeof o === "string" ? o : o.label)
      .on("click", () => { satt(i); if (onSelect) onSelect(i); })
  );
  function satt(i) { knappar.forEach((k, j) => k.classed("aktiv", j === i)); }
  return { el: wrap, set: satt };
}

// =============================================================================
// TOOLTIP — en per graf, ligger i .graf-body
//   const tt = skapaTooltip(ram.body);
//   tt.visa(html, { x, y })   // x,y i CSS-pixlar relativt svg-container
//   tt.flytta({ x, y })       // följ pekaren utan att byta innehåll
//   tt.dolj()
//
// Placeringen hålls alltid inom BÅDE grafrutan (.graf-container) och
// fönstret: tooltipen byter sida vid kanten och skjuts in, aldrig ut.
// Vid tryck (touch) läggs den ovanför fingret så att den inte döljs.
// Esc stänger alla tooltips (WCAG 1.4.13), liksom tryck utanför grafen.
// =============================================================================
let _senastPekare = "mouse";
if (typeof document !== "undefined" && !document.__grafTooltipLyssnare) {
  document.__grafTooltipLyssnare = true;
  const doljAlla = () => document.querySelectorAll(".graf-tooltip").forEach(t => { t.style.display = "none"; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") doljAlla(); });
  document.addEventListener("pointerdown", (e) => {
    _senastPekare = e.pointerType || "mouse";
    if (_senastPekare !== "mouse" && !(e.target.closest && e.target.closest(".graf-body"))) doljAlla();
  }, true);
  document.addEventListener("pointermove", (e) => { if (e.pointerType) _senastPekare = e.pointerType; }, { capture: true, passive: true });
}

export function placeraTooltip(el, body, { x, y, sida = "auto", offset = 14 } = {}) {
  const node = el.node ? el.node() : el;
  const bodyNode = body.node ? body.node() : body;
  const b = bodyNode.getBoundingClientRect();
  const ram = (bodyNode.closest(".graf-container") || bodyNode).getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const w = node.offsetWidth, h = node.offsetHeight;
  // Tillåtet område i body-koordinater: grafrutan ∩ fönstret
  const minX = Math.max(ram.left, 0) - b.left + 6;
  const maxX = Math.min(ram.right, vw) - b.left - 6;
  const minY = Math.max(ram.top, 0) - b.top + 6;
  const maxY = Math.min(ram.bottom, vh) - b.top - 6;
  let left, top;
  if (_senastPekare === "touch" || sida === "ovan") {
    // Ovanför fingret, centrerad; under om det inte får plats ovanför
    left = x - w / 2;
    top = y - h - 22;
    if (top < minY) top = y + 26;
  } else {
    left = x + offset;
    if (sida === "vanster" || (sida === "auto" && left + w > maxX)) left = x - w - offset;
    top = y - h / 2;
  }
  left = Math.max(minX, Math.min(maxX - w, left));
  top = Math.max(minY, Math.min(maxY - h, top));
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

export function skapaTooltip(body) {
  const el = body.append("div").attr("class", "graf-tooltip").attr("role", "tooltip").style("display", "none");
  return {
    el,
    visa(html, pos = {}) {
      el.html(html).style("display", "block");
      placeraTooltip(el, body, pos);
    },
    flytta(pos) {
      if (el.style("display") === "none") return;
      placeraTooltip(el, body, pos);
    },
    dolj() { el.style("display", "none"); }
  };
}

// Pekarens position i .graf-body-koordinater (för tooltip-placering)
export function pekarPos(event, body) {
  const b = (body.node ? body.node() : body).getBoundingClientRect();
  const e = event.touches && event.touches[0] ? event.touches[0] : event;
  return { x: e.clientX - b.left, y: e.clientY - b.top };
}

// Bygger standard-tooltiphtml: rubrik (t.ex. år) + rader [{namn, varde, farg, fokus}]
export function tooltipHtml(rubrik, rader, { extra = null } = {}) {
  const rows = rader.map(r => `
    <div class="graf-tooltip-rad${r.fokus ? " fokus" : ""}${r.dampad ? " dampad" : ""}">
      <span class="graf-tooltip-prick" style="background:${r.farg || "#888"}"></span>
      <span class="graf-tooltip-namn">${r.namn}</span>
      <span class="graf-tooltip-varde">${r.varde}</span>
    </div>`).join("");
  return `${rubrik ? `<div class="graf-tooltip-rubrik">${rubrik}</div>` : ""}
    <div class="graf-tooltip-lista">${rows}</div>${extra ? `<div class="graf-tooltip-extra">${extra}</div>` : ""}`;
}

// Y-titelns standardposition: flush med y-etiketternas vänsterkant, ovanför axeln
export function yTitelPos(marginLeft, marginTop) {
  return { x: marginLeft, y: marginTop - 12 };
}
