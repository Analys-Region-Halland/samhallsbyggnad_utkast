// Hero-karta över Halland — ren D3-funktion, anropas likt en ggplot:
//   hallandskarta(el, geo, { kommuner })
// Halland är en smal, hög kustform. Vi ritar den luminöst på mörk botten,
// med ett mjukt sken som följer formen, ljuspunkter per kommun (skalade efter
// invånare) och alltid synliga etiketter i en högerkolumn med ledarlinjer.
import { d3, PALETT, nar_matbar } from "../lib/d3.js";

export function hallandskarta(el, geo, opts = {}) {
  const kommuner = opts.kommuner || [];
  const inv = new Map(kommuner.map((k) => [String(k.id), k.invanare]));
  const maxInv = d3.max(kommuner, (k) => k.invanare) || 1;
  const rDot = d3.scaleSqrt().domain([0, maxInv]).range([3, 9]);

  el.innerHTML = "";
  el.style.position = "relative";

  const svg = d3
    .select(el)
    .append("svg")
    .attr("class", "kr-karta-svg")
    .style("width", "100%")
    .style("height", "100%")
    .style("overflow", "visible");

  const defs = svg.append("defs");

  // Mjukt sken kring punkterna
  const glow = defs.append("filter").attr("id", "kr-glow").attr("x", "-120%").attr("y", "-120%").attr("width", "340%").attr("height", "340%");
  glow.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "b");
  const fm = glow.append("feMerge");
  fm.append("feMergeNode").attr("in", "b");
  fm.append("feMergeNode").attr("in", "SourceGraphic");

  // Vertikal "glas"-fyllning för kommunerna
  const fyll = defs.append("linearGradient").attr("id", "kr-land-fyll").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
  fyll.append("stop").attr("offset", "0%").attr("stop-color", PALETT.gron3).attr("stop-opacity", 0.30);
  fyll.append("stop").attr("offset", "100%").attr("stop-color", PALETT.gron3).attr("stop-opacity", 0.13);

  const gHalo = svg.append("g").attr("class", "kr-karta-halo");
  const gLand = svg.append("g").attr("class", "kr-karta-land");
  const gLead = svg.append("g").attr("class", "kr-karta-leaders");
  const gDots = svg.append("g").attr("class", "kr-karta-dots");
  const gLabel = svg.append("g").attr("class", "kr-karta-labels");

  function rita(w) {
    const h = el.clientHeight || Math.round(w * 1.2);
    svg.attr("viewBox", `0 0 ${w} ${h}`);

    // Reservera plats till höger för etikettkolumnen
    const labelKol = Math.min(150, Math.max(110, w * 0.34));
    const pad = 20;
    const kartBredd = w - labelKol;
    const proj = d3.geoMercator().fitExtent([[pad, pad], [kartBredd - 8, h - pad]], geo);
    const path = d3.geoPath(proj);
    const bounds = path.bounds(geo);
    const labelX = Math.min(bounds[1][0] + 34, w - labelKol + 14);

    // ── Sken bakom hela formen ──
    const cx = (bounds[0][0] + bounds[1][0]) / 2;
    const cy = (bounds[0][1] + bounds[1][1]) / 2;
    const rx = (bounds[1][0] - bounds[0][0]) / 2 + 70;
    const ry = (bounds[1][1] - bounds[0][1]) / 2 + 50;
    let halo = gHalo.selectAll("ellipse").data([0]);
    halo = halo.join("ellipse").attr("cx", cx).attr("cy", cy).attr("rx", rx).attr("ry", ry)
      .attr("fill", "rgba(0,171,96,0.30)").style("filter", "blur(46px)");

    // ── Kommuner ──
    gLand.selectAll("path").data(geo.features, (d) => d.properties.id).join(
      (enter) =>
        enter.append("path")
          .attr("class", "kr-kommun")
          .attr("d", path)
          .attr("fill", "url(#kr-land-fyll)")
          .attr("stroke", "#ffffff")
          .attr("stroke-width", 1.4)
          .attr("stroke-opacity", 0.85)
          .attr("stroke-linejoin", "round")
          .style("pointer-events", "none")
          .style("opacity", 0)
          .call((s) => s.transition().duration(900).delay((d, i) => 150 + i * 110).style("opacity", 1)),
      (update) => update.attr("d", path)
    );
    gLand.style("filter", "drop-shadow(0 1px 12px rgba(0,171,96,0.55))");

    // ── Ljuspunkter ──
    gDots.selectAll("circle").data(geo.features, (d) => d.properties.id).join(
      (enter) =>
        enter.append("circle")
          .attr("class", "kr-ort-dot")
          .attr("cx", (d) => path.centroid(d)[0])
          .attr("cy", (d) => path.centroid(d)[1])
          .attr("r", 0)
          .attr("fill", PALETT.vit)
          .attr("filter", "url(#kr-glow)")
          .style("pointer-events", "none")
          .call((s) => s.transition().duration(700).delay((d, i) => 650 + i * 100)
            .attr("r", (d) => rDot(inv.get(String(d.properties.id)) || 0))),
      (update) => update
        .attr("cx", (d) => path.centroid(d)[0])
        .attr("cy", (d) => path.centroid(d)[1])
        .attr("r", (d) => rDot(inv.get(String(d.properties.id)) || 0))
    );

    // ── Etiketter i högerkolumn med enkel anti-kollision ──
    const rader = geo.features
      .map((f) => ({ f, c: path.centroid(f) }))
      .sort((a, b) => a.c[1] - b.c[1]);
    let prev = -Infinity;
    const minGap = 30;
    rader.forEach((o) => { o.y = Math.max(o.c[1], prev + minGap); prev = o.y; });
    // klamra inom höjd
    const overskott = rader.length ? rader[rader.length - 1].y - (h - pad) : 0;
    if (overskott > 0) rader.forEach((o) => (o.y -= overskott));

    gLead.selectAll("path").data(rader, (o) => o.f.properties.id).join("path")
      .attr("fill", "none")
      .attr("stroke", PALETT.gron3)
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 1)
      .attr("d", (o) => `M${o.c[0]},${o.c[1]} L${labelX - 12},${o.c[1]} L${labelX - 4},${o.y}`);

    const grp = gLabel.selectAll("g.kr-etikett").data(rader, (o) => o.f.properties.id).join((enter) => {
      const g = enter.append("g").attr("class", "kr-etikett");
      g.append("text").attr("class", "kr-karta-namn");
      return g;
    });
    grp.attr("transform", (o) => `translate(${labelX}, ${o.y})`);
    grp.select(".kr-karta-namn").attr("y", 4).text((o) => o.f.properties.kom_namn);
  }

  return nar_matbar(el, rita);
}
