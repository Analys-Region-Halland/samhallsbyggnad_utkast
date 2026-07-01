// Minigrafer för kapitelkorten — rena D3-funktioner, en per graftyp.
// Alla har samma signatur:  rita(el, data, { farg, ...opts })
// och ritar en kompakt, axellös visual i kortets accentfärg.
import { d3, nar_matbar } from "../lib/d3.js";

const H = 64; // standardhöjd för kortvisualerna

// Yt-/linjespark — mjuk trend, t.ex. befolkning eller sysselsättning.
export function area(el, data, opts = {}) {
  const farg = opts.farg || "#00664D";
  el.innerHTML = "";
  const svg = d3.select(el).append("svg").style("width", "100%").style("height", H + "px").style("display", "block");
  const id = "g" + Math.abs(hash(farg + data.length + "a")).toString(36);
  const grad = svg.append("defs").append("linearGradient").attr("id", id).attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
  grad.append("stop").attr("offset", "0%").attr("stop-color", farg).attr("stop-opacity", 0.28);
  grad.append("stop").attr("offset", "100%").attr("stop-color", farg).attr("stop-opacity", 0);
  const gArea = svg.append("path").attr("fill", `url(#${id})`);
  const gLine = svg.append("path").attr("fill", "none").attr("stroke", farg).attr("stroke-width", 2).attr("stroke-linecap", "round").attr("stroke-linejoin", "round");
  const gDot = svg.append("circle").attr("r", 3).attr("fill", farg);

  function rita(w) {
    const p = 4;
    const x = d3.scaleLinear().domain([0, data.length - 1]).range([p, w - p]);
    const y = d3.scaleLinear().domain(d3.extent(data)).nice().range([H - p, p]);
    const line = d3.line().x((d, i) => x(i)).y((d) => y(d)).curve(d3.curveMonotoneX);
    const ar = d3.area().x((d, i) => x(i)).y0(H - p).y1((d) => y(d)).curve(d3.curveMonotoneX);
    gArea.attr("d", ar(data));
    gLine.attr("d", line(data));
    gDot.attr("cx", x(data.length - 1)).attr("cy", y(data[data.length - 1]));
  }
  return nar_matbar(el, rita);
}

// Staplar — t.ex. nyproduktion eller orter efter storlek.
export function bars(el, data, opts = {}) {
  const farg = opts.farg || "#00664D";
  const etiketter = opts.etiketter || data.map(() => "");
  el.innerHTML = "";
  const svg = d3.select(el).append("svg").style("width", "100%").style("height", H + "px").style("display", "block");
  const gBars = svg.append("g");
  const gLab = svg.append("g");

  function rita(w) {
    const lh = etiketter.some((e) => e) ? 12 : 0;
    const x = d3.scaleBand().domain(d3.range(data.length)).range([0, w]).padding(0.34);
    const y = d3.scaleLinear().domain([0, d3.max(data)]).range([H - lh - 2, 2]);
    gBars.selectAll("rect").data(data).join("rect")
      .attr("x", (d, i) => x(i))
      .attr("width", x.bandwidth())
      .attr("rx", Math.min(3, x.bandwidth() / 3))
      .attr("y", (d) => y(d))
      .attr("height", (d) => H - lh - 2 - y(d))
      .attr("fill", farg)
      .attr("fill-opacity", (d, i) => 0.42 + 0.58 * (i / (data.length - 1 || 1)));
    gLab.selectAll("text").data(etiketter).join("text")
      .attr("x", (d, i) => x(i) + x.bandwidth() / 2)
      .attr("y", H - 1)
      .attr("text-anchor", "middle")
      .attr("class", "kr-mini-lab")
      .text((d) => d);
  }
  return nar_matbar(el, rita);
}

// Ring/donut — andelar, t.ex. markanvändning.
export function ring(el, data, opts = {}) {
  el.innerHTML = "";
  const svg = d3.select(el).append("svg").style("width", "100%").style("height", H + "px").style("display", "block");
  const g = svg.append("g");
  const total = d3.sum(data, (d) => d.varde);
  const pie = d3.pie().sort(null).value((d) => d.varde).padAngle(0.04);

  function rita(w) {
    const r = Math.min(H, 96) / 2 - 2;
    g.attr("transform", `translate(${r + 4}, ${H / 2})`);
    const arc = d3.arc().innerRadius(r * 0.58).outerRadius(r).cornerRadius(2);
    g.selectAll("path").data(pie(data)).join("path")
      .attr("d", arc)
      .attr("fill", (d) => d.data.farg);
    // störst andel som siffra i mitten
    const mx = data.reduce((a, b) => (b.varde > a.varde ? b : a), data[0]);
    let mid = svg.select(".kr-ring-mid");
    if (mid.empty()) mid = svg.append("text").attr("class", "kr-ring-mid");
    mid.attr("x", r + 4).attr("y", H / 2).text(Math.round((mx.varde / total) * 100) + "%");
    // liten teckenförklaring till höger
    let leg = svg.select(".kr-ring-leg");
    if (leg.empty()) leg = svg.append("g").attr("class", "kr-ring-leg");
    const lx = 2 * r + 18;
    leg.attr("transform", `translate(${lx}, ${H / 2 - data.length * 6})`);
    const rows = leg.selectAll("g").data(data).join("g").attr("transform", (d, i) => `translate(0, ${i * 12})`);
    rows.selectAll("rect").data((d) => [d]).join("rect").attr("width", 7).attr("height", 7).attr("rx", 1.5).attr("y", -6).attr("fill", (d) => d.farg);
    rows.selectAll("text").data((d) => [d]).join("text").attr("x", 11).attr("class", "kr-ring-lab").text((d) => `${d.etikett} ${d.varde}%`);
  }
  return nar_matbar(el, rita);
}

export function ritaVisual(el, visual, farg) {
  if (!visual) return () => {};
  if (visual.typ === "area") return area(el, visual.data, { farg });
  if (visual.typ === "bars") return bars(el, visual.data, { farg, etiketter: visual.etiketter });
  if (visual.typ === "ring") return ring(el, visual.data, { farg });
  return () => {};
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return h;
}
