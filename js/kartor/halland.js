// Hero-karta över Halland: ren D3-funktion, anropas likt en ggplot:
//   hallandskarta(el, geo, { orter })
//
// Kommunerna ritas som glas på mörk botten. Varje tätort är en ljuspunkt på sin
// VERKLIGA plats (SCB:s tätortsytor, data/hero-orter.json, byggs av
// data/bearbetning/hero-orter.R) med ytan efter folkmängd 2024. De sex
// centralorterna har namn och folkmängd; kustorternas namn står ute i havet så
// att de aldrig ligger på land eller på varandra. Göteborg markeras norr om
// länet som referens. Peka på en punkt för namn och folkmängd.
import { d3, PALETT, nar_matbar } from "../lib/d3.js";

const GBG = { namn: "Göteborg", lon: 11.9746, lat: 57.7089 };
const fmt = (v) => Math.round(v).toLocaleString("sv-SE");

export function hallandskarta(el, geo, opts = {}) {
  const orter = (opts.orter || []).slice().sort((a, b) => b.inv - a.inv);
  const maxInv = d3.max(orter, (d) => d.inv) || 1;
  const rDot = d3.scaleSqrt().domain([0, maxInv]).range([1.2, 13]);
  const rorelse = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  el.innerHTML = "";
  el.style.position = "relative";

  const svg = d3.select(el).append("svg")
    .attr("class", "kr-karta-svg")
    .attr("role", "img")
    .attr("aria-label", `Karta över Hallands sex kommuner och ${orter.length} tätorter, storlek efter folkmängd 2024. Största orterna: ${orter.filter((o) => o.centralort).map((o) => `${o.namn} ${fmt(o.inv)} invånare`).join(", ")}.`)
    .style("width", "100%").style("height", "100%").style("overflow", "visible");

  const defs = svg.append("defs");
  const glow = defs.append("filter").attr("id", "kr-glow").attr("x", "-150%").attr("y", "-150%").attr("width", "400%").attr("height", "400%");
  glow.append("feGaussianBlur").attr("stdDeviation", "3.2").attr("result", "b");
  const fm = glow.append("feMerge");
  fm.append("feMergeNode").attr("in", "b");
  fm.append("feMergeNode").attr("in", "SourceGraphic");
  const fyll = defs.append("linearGradient").attr("id", "kr-land-fyll").attr("x1", 0).attr("y1", 0).attr("x2", 0.4).attr("y2", 1);
  fyll.append("stop").attr("offset", "0%").attr("stop-color", PALETT.gron3).attr("stop-opacity", 0.24);
  fyll.append("stop").attr("offset", "100%").attr("stop-color", PALETT.gron3).attr("stop-opacity", 0.09);

  const gHalo = svg.append("g");
  const gLand = svg.append("g").attr("class", "kr-karta-land");
  const gGbg = svg.append("g").attr("class", "kr-karta-gbg");
  const gDots = svg.append("g").attr("class", "kr-karta-dots");
  const gLead = svg.append("g").attr("class", "kr-karta-leaders");
  const gLabel = svg.append("g").attr("class", "kr-karta-labels");

  const tip = d3.select(el).append("div").attr("class", "kr-hero-tip").attr("aria-hidden", "true");

  let forsta = true;

  function rita(w) {
    const h = el.clientHeight || Math.round(w * 1.2);
    svg.attr("viewBox", `0 0 ${w} ${h}`);

    // Plats till vänster för kustorternas namn (i havet) och upptill för Göteborg
    const vanster = Math.min(118, Math.max(84, w * 0.26));
    const utsnitt = { type: "FeatureCollection", features: [...geo.features,
      { type: "Feature", geometry: { type: "Point", coordinates: [GBG.lon, GBG.lat] } }] };
    const proj = d3.geoMercator().fitExtent([[vanster, 14], [w - 16, h - 14]], utsnitt);
    const path = d3.geoPath(proj);
    const xy = (d) => proj([d.lon, d.lat]);
    const b = path.bounds(geo);

    gHalo.selectAll("ellipse").data([0]).join("ellipse")
      .attr("cx", (b[0][0] + b[1][0]) / 2).attr("cy", (b[0][1] + b[1][1]) / 2)
      .attr("rx", (b[1][0] - b[0][0]) / 2 + 60).attr("ry", (b[1][1] - b[0][1]) / 2 + 40)
      .attr("fill", "rgba(0,171,96,0.26)").style("filter", "blur(48px)");

    // ── Kommuner ──
    gLand.selectAll("path").data(geo.features, (d) => d.properties.id).join(
      (enter) => enter.append("path")
        .attr("d", path)
        .attr("fill", "url(#kr-land-fyll)")
        .attr("stroke", "#ffffff").attr("stroke-width", 1).attr("stroke-opacity", 0.55)
        .attr("stroke-linejoin", "round")
        .style("opacity", forsta && rorelse ? 0 : 1)
        .call((s) => forsta && rorelse && s.transition().duration(900).delay((d, i) => 100 + i * 90).style("opacity", 1)),
      (update) => update.attr("d", path)
    );
    gLand.style("filter", "drop-shadow(0 1px 14px rgba(0,171,96,0.45))");

    // ── Göteborg: referens norr om länet ──
    const [gx, gy] = xy(GBG);
    gGbg.selectAll("*").remove();
    gGbg.append("circle").attr("cx", gx).attr("cy", gy).attr("r", 5.5)
      .attr("fill", "none").attr("stroke", "rgba(255,255,255,0.65)").attr("stroke-width", 1.2).attr("stroke-dasharray", "2 2");
    gGbg.append("text").attr("class", "kr-karta-ref").attr("x", gx - 10).attr("y", gy + 4).attr("text-anchor", "end").text("Göteborg");

    // ── Tätorter ──
    const prick = gDots.selectAll("circle").data(orter, (d) => d.namn).join(
      (enter) => enter.append("circle")
        .attr("class", (d) => "kr-ort-dot" + (d.centralort ? " kr-ort-dot--central" : ""))
        .attr("cx", (d) => xy(d)[0]).attr("cy", (d) => xy(d)[1])
        .attr("r", forsta && rorelse ? 0 : (d) => rDot(d.inv))
        .attr("fill", "#fff")
        .attr("fill-opacity", (d) => (d.inv > 10000 ? 0.95 : d.inv > 2000 ? 0.8 : 0.6))
        .attr("filter", (d) => (d.inv > 3000 ? "url(#kr-glow)" : null))
        .call((s) => forsta && rorelse && s.transition().duration(650)
          .delay((d) => 500 + (57.75 - d.lat) * 900 + Math.random() * 120)
          .attr("r", (d) => rDot(d.inv))),
      (update) => update.attr("cx", (d) => xy(d)[0]).attr("cy", (d) => xy(d)[1]).attr("r", (d) => rDot(d.inv))
    );

    // Peka: närmaste ort inom 18 px (små prickar går då också att nå)
    const pts = orter.map((d) => ({ d, p: xy(d) }));
    svg.on("pointermove", (ev) => {
      const [mx, my] = d3.pointer(ev, svg.node());
      const sx = w / (svg.node().getBoundingClientRect().width || w);
      let bast = null, bd = 18 * sx;
      pts.forEach((o) => { const dd = Math.hypot(o.p[0] - mx, o.p[1] - my) - rDot(o.d.inv); if (dd < bd) { bd = dd; bast = o; } });
      prick.classed("ar-aktiv", (d) => bast && d === bast.d);
      if (!bast) { tip.classed("synlig", false); return; }
      const r = svg.node().getBoundingClientRect();
      tip.html(`<b>${bast.d.namn}</b>${fmt(bast.d.inv)} invånare`)
        .style("left", `${(bast.p[0] / w) * r.width}px`)
        .style("top", `${(bast.p[1] / h) * r.height}px`)
        .classed("synlig", true);
    }).on("pointerleave", () => { tip.classed("synlig", false); prick.classed("ar-aktiv", false); });

    // ── Centralorternas namn ──
    // Kustorter: namnet i havet till vänster; inlandsorter (Hyltebruk) till höger.
    const centrala = orter.filter((d) => d.centralort).map((d) => {
      const [x, y] = xy(d);
      return { d, x, y, hoger: d.namn === "Hyltebruk" };
    });
    const vansterSida = centrala.filter((o) => !o.hoger).sort((a, b) => a.y - b.y);
    const kolumn = Math.max(8, Math.min(...vansterSida.map((o) => o.x)) - 34);
    let prev = -Infinity;
    vansterSida.forEach((o) => { o.ly = Math.max(o.y, prev + 30); prev = o.ly; });
    centrala.filter((o) => o.hoger).forEach((o) => { o.ly = o.y; });

    gLead.selectAll("path").data(centrala, (o) => o.d.namn).join("path")
      .attr("fill", "none").attr("stroke", "rgba(193,232,196,0.55)").attr("stroke-width", 0.9)
      .attr("d", (o) => {
        const r = rDot(o.d.inv) + 2;
        return o.hoger
          ? `M${o.x + r},${o.y} L${o.x + 16},${o.y}`
          : `M${o.x - r},${o.y} L${kolumn + 12},${o.y} L${kolumn + 4},${o.ly}`;
      });

    const grp = gLabel.selectAll("g").data(centrala, (o) => o.d.namn).join((enter) => {
      const g = enter.append("g").attr("class", "kr-etikett");
      g.append("text").attr("class", "kr-karta-namn");
      g.append("text").attr("class", "kr-karta-inv");
      return g;
    });
    grp.attr("transform", (o) => `translate(${o.hoger ? o.x + 20 : kolumn}, ${o.ly})`)
      .attr("text-anchor", (o) => (o.hoger ? "start" : "end"));
    grp.select(".kr-karta-namn").attr("y", 1).text((o) => o.d.namn);
    grp.select(".kr-karta-inv").attr("y", 14).text((o) => `${fmt(o.d.inv)} inv.`);
    if (forsta && rorelse) grp.style("opacity", 0).transition().duration(600).delay(1500).style("opacity", 1);

    forsta = false;
  }

  return nar_matbar(el, rita);
}
