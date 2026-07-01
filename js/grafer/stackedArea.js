// =============================================================================
// STACKED AREA — Stackade areor över kategorisk x-axel (t.ex. åldersklasser)
// =============================================================================
// Varje staplad yta är en kategori (ex. hushållsställning). x-axeln är
// kategorisk (en unik ålder/klass per position). Stödjer measures-växling
// mellan olika data-vyer (t.ex. region eller år).

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "../lib/exportSvg.js";

export function stackedArea(initialData, {
  x = "x",
  y = "y",
  color = "color",
  colorOrder = null,            // array av color-värden i stacking-ordning
  xOrder = null,                // array av x-värden i stigande ordning
  colors = ["#FFD939", "#D6D6D6", "#FF5F4A", "#2DB8F6", "#004990", "#895B42", "#00AB60"],
  normalize = false,            // true → 100 % stacked
  width = null,
  height = 440,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  yLabel = null,
  formatY = null,
  rotateX = false,              // true → vinkla x-etiketterna -35° (långa kategorinamn)
  measures = null,
  toggle = null,   // [{label, normalize, formatY}] — växlar två lägen av normalize/format
  altText = null,
  info = null,
  logo = null,
  time = null      // fältnamn för år (t.ex. "ar") → aktiverar års-reglage (slider + play)
} = {}) {

  // ==========================================================================
  // STATE
  // ==========================================================================
  let data = measures ? measures[0].data : initialData;
  let currentMeasureIdx = 0;
  let currentToggleIdx = 0;
  let currentNormalize = normalize;
  let currentFormatY = null; // sätts nedan

  // Toggle överstyr normalize/formatY (första laget som körs)
  if (toggle && toggle.length > 0) {
    currentNormalize = toggle[0].normalize;
    if (typeof toggle[0].formatY === "function") currentFormatY = toggle[0].formatY;
  }
  // Measure kan överstyra om den inte styrs av toggle
  if (measures && measures[0].normalize !== undefined && !toggle) {
    currentNormalize = measures[0].normalize;
  }
  if (measures && typeof measures[0].formatY === "function" && !toggle) {
    currentFormatY = measures[0].formatY;
  }

  // Tidsdimension — års-reglage (slider + play). allYears samlas från alla
  // measures (regioner) så reglaget täcker hela serien oavsett vald region.
  const allYears = time
    ? [...new Set((measures ? measures.flatMap(m => m.data) : initialData).map(d => d[time]))]
        .filter(v => v != null).sort((a, b) => a - b)
    : [];
  let currentYear = allYears.length ? allYears[allYears.length - 1] : null;
  let playTimer = null;

  // ==========================================================================
  // CONSTANTS
  // ==========================================================================
  const autoWidth = width || 820;
  const marginTop = 20;
  const marginRight = 240;
  const marginBottom = rotateX ? 74 : 44;
  const marginLeft = 64;

  const baseDefaultFormat = normalize
    ? d => (d * 100).toFixed(0) + " %"
    : d => d.toLocaleString("sv-SE");
  if (currentFormatY === null) {
    currentFormatY = formatY || baseDefaultFormat;
  }
  const resolvedFormat = () => {
    if (currentFormatY) return currentFormatY;
    return currentNormalize
      ? d => (d * 100).toFixed(0) + " %"
      : d => d.toLocaleString("sv-SE");
  };

  // ==========================================================================
  // CONTAINER + HEADER
  // ==========================================================================
  const container = d3.create("div")
    .attr("class", "graf-container")
    .style("position", "relative");

  const header = container.append("div").attr("class", "graf-header");
  if (title) header.append("div").attr("class", "graf-title").text(title);

  // Measures-kontroll + subtitle
  let subtitleWrapper = null;
  let subtitleTextSpan = null;
  let measurePanel = null;
  let measureLabel = null;

  if (subtitle || (measures && measures.length > 1)) {
    // CSS för measure-väljare (återanvänds från linjediagram om redan injicerad)
    if (measures && measures.length > 1 && !document.getElementById("graf-measure-styles")) {
      const mStyles = document.createElement("style");
      mStyles.id = "graf-measure-styles";
      mStyles.textContent = `
        .graf-measure-control { display: inline; position: relative; user-select: none; }
        .graf-measure-label {
          cursor: pointer; font-weight: 600; color: #1a1a1a;
          text-decoration: underline; text-decoration-style: dotted;
          text-decoration-color: #bbb; text-underline-offset: 2px;
          transition: text-decoration-color 0.15s;
        }
        .graf-measure-label:hover { text-decoration-color: #00664D; text-decoration-style: solid; }
        .graf-measure-panel {
          display: none; position: absolute; top: 100%; left: 0;
          margin-top: 4px; background: #fff; border: 1px solid #1a1a1a;
          z-index: 100; white-space: nowrap; padding: 4px 0; min-width: 160px;
        }
        .graf-measure-control.expanded .graf-measure-panel { display: block; }
        .graf-measure-option {
          display: block; padding: 5px 14px; font-size: 13px;
          cursor: pointer; font-family: 'IBM Plex Sans', sans-serif;
          color: #555; transition: background 0.1s;
        }
        .graf-measure-option:hover { background: #f0f0f0; color: #1a1a1a; }
        .graf-measure-option.active { font-weight: 600; color: #1a1a1a; }
      `;
      document.head.appendChild(mStyles);
    }

    subtitleWrapper = header.append("div").attr("class", "graf-subtitle-wrapper")
      .style("font-family", "'IBM Plex Sans', sans-serif")
      .style("font-size", "14px")
      .style("color", "#666");

    if (measures && measures.length > 1) {
      const measureControl = subtitleWrapper.append("span")
        .attr("class", "graf-measure-control");
      measureLabel = measureControl.append("span")
        .attr("class", "graf-measure-label")
        .text(measures[0].label);

      measurePanel = measureControl.append("div")
        .attr("class", "graf-measure-panel");

      measures.forEach((m, i) => {
        measurePanel.append("div")
          .attr("class", `graf-measure-option${i === 0 ? " active" : ""}`)
          .text(m.filterLabel || m.label)
          .on("click", () => {
            switchMeasure(i);
            measureControl.classed("expanded", false);
          });
      });

      let mTimeout;
      measureControl.on("mouseenter", () => {
        clearTimeout(mTimeout);
        measureControl.classed("expanded", true);
      });
      measureControl.on("mouseleave", () => {
        clearTimeout(mTimeout);
        mTimeout = setTimeout(() => measureControl.classed("expanded", false), 200);
      });

      if (measures[0].subtitle) {
        subtitleTextSpan = subtitleWrapper.append("span")
          .style("margin-left", "8px")
          .text(measures[0].subtitle);
      }
    } else if (subtitle) {
      subtitleTextSpan = subtitleWrapper.append("span").text(subtitle);
    }

    // Toggle-switch (andel/antal eller liknande)
    if (toggle && toggle.length > 1) {
      if (!document.getElementById("graf-toggle-styles")) {
        const tStyles = document.createElement("style");
        tStyles.id = "graf-toggle-styles";
        tStyles.textContent = `
          .graf-toggle-wrap {
            display: inline-flex; margin-left: 12px; vertical-align: middle;
          }
          .graf-toggle-pill {
            display: inline-flex; border: 1px solid #1a1a1a;
            border-radius: 3px; overflow: hidden;
            font-family: 'IBM Plex Sans', sans-serif; font-size: 11px;
          }
          .graf-toggle-opt {
            padding: 3px 10px; cursor: pointer; background: #fff;
            color: #555; user-select: none; transition: background 0.15s;
          }
          .graf-toggle-opt:hover { background: #f0f0f0; color: #1a1a1a; }
          .graf-toggle-opt.active {
            background: #1a1a1a; color: #fff; font-weight: 600;
          }
          .graf-toggle-opt:not(:last-child) {
            border-right: 1px solid #1a1a1a;
          }
        `;
        document.head.appendChild(tStyles);
      }

      const togglePill = subtitleWrapper.append("span")
        .attr("class", "graf-toggle-wrap")
        .append("span")
        .attr("class", "graf-toggle-pill");

      toggle.forEach((opt, i) => {
        togglePill.append("span")
          .attr("class", `graf-toggle-opt${i === currentToggleIdx ? " active" : ""}`)
          .text(opt.label)
          .on("click", () => switchToggle(i));
      });
    }
  }

  // ==========================================================================
  // ÅRS-REGLAGE (tidsdimension) — slider + play
  // ==========================================================================
  let yearLabel = null;
  if (time && allYears.length > 1) {
    if (!document.getElementById("graf-timeslider-styles")) {
      const s = document.createElement("style");
      s.id = "graf-timeslider-styles";
      s.textContent = `
        .graf-timeslider { display:flex; align-items:center; gap:11px; margin-top:9px;
          font-family:'IBM Plex Sans',sans-serif; }
        .graf-time-play { width:26px; height:26px; border:1px solid #1a1a1a; background:#fff;
          border-radius:5px; cursor:pointer; display:inline-flex; align-items:center;
          justify-content:center; color:#1a1a1a; padding:0; flex-shrink:0; transition:all .15s; }
        .graf-time-play:hover { background:#1a1a1a; color:#fff; }
        .graf-time-play svg { width:11px; height:11px; display:block; }
        .graf-time-year { font-weight:700; font-variant-numeric:tabular-nums; color:#1a1a1a;
          min-width:42px; font-size:14px; }
        .graf-timeslider input[type=range] { flex:0 1 240px; accent-color:#00664D;
          cursor:pointer; height:4px; }
      `;
      document.head.appendChild(s);
    }
    const ICON_PLAY = '<svg viewBox="0 0 10 12"><path d="M0 0l10 6-10 6z" fill="currentColor"/></svg>';
    const ICON_PAUSE = '<svg viewBox="0 0 10 12"><rect x="0" width="3.5" height="12" fill="currentColor"/><rect x="6.5" width="3.5" height="12" fill="currentColor"/></svg>';

    const sliderRow = header.append("div").attr("class", "graf-timeslider");
    const playBtn = sliderRow.append("button")
      .attr("class", "graf-time-play").attr("type", "button")
      .attr("aria-label", "Spela upp").html(ICON_PLAY);
    yearLabel = sliderRow.append("span").attr("class", "graf-time-year").text(currentYear);
    const slider = sliderRow.append("input")
      .attr("type", "range").attr("min", 0).attr("max", allYears.length - 1)
      .attr("step", 1).attr("value", allYears.indexOf(currentYear))
      .attr("aria-label", "Välj år");

    function setYear(yr) {
      currentYear = yr;
      if (yearLabel) yearLabel.text(yr);
      slider.property("value", allYears.indexOf(yr));
      render();
    }
    function stopPlay() {
      if (playTimer) { clearInterval(playTimer); playTimer = null; }
      playBtn.html(ICON_PLAY).attr("aria-label", "Spela upp");
    }
    function startPlay() {
      if (allYears.indexOf(currentYear) >= allYears.length - 1) setYear(allYears[0]);
      playBtn.html(ICON_PAUSE).attr("aria-label", "Pausa");
      playTimer = setInterval(() => {
        const i = allYears.indexOf(currentYear);
        if (i >= allYears.length - 1) { stopPlay(); return; }
        setYear(allYears[i + 1]);
      }, 1100);
    }
    slider.on("input", function () { stopPlay(); setYear(allYears[+this.value]); });
    playBtn.on("click", () => (playTimer ? stopPlay() : startPlay()));
  }

  // ==========================================================================
  // TOOLTIP
  // ==========================================================================
  if (!document.getElementById("graf-tooltip-styles")) {
    const styles = document.createElement("style");
    styles.id = "graf-tooltip-styles";
    styles.textContent = `
      .graf-tooltip {
        position: absolute; background: #fff;
        font-family: 'IBM Plex Sans', sans-serif; font-size: 11px;
        pointer-events: none; z-index: 1000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08);
        border: 1px solid #1a1a1a; min-width: 160px; overflow: hidden;
      }
      .graf-tooltip-year {
        font-size: 12px; font-weight: 700; color: #fff;
        background: #1a1a1a; padding: 6px 10px; letter-spacing: 0.02em;
      }
      .graf-tooltip-list { display: flex; flex-direction: column; }
      .graf-tooltip-row {
        display: flex; align-items: center; gap: 8px;
        padding: 3px 10px; line-height: 1.3;
      }
      .graf-tooltip-row:nth-child(odd) { background: #f8f8f8; }
      .graf-tooltip-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
      .graf-tooltip-name { color: #444; flex: 1; }
      .graf-tooltip-val {
        font-weight: 600; font-variant-numeric: tabular-nums; color: #1a1a1a;
      }
    `;
    document.head.appendChild(styles);
  }

  const tooltip = container.append("div")
    .attr("class", "graf-tooltip")
    .style("display", "none");

  // ==========================================================================
  // SVG
  // ==========================================================================
  const svgContainer = container.append("div").attr("class", "graf-svg-container");
  const svg = svgContainer.append("svg")
    .attr("viewBox", `0 0 ${autoWidth} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  // Persisterande grupper (för transitions vid measure-byte)
  const areasGroup = svg.append("g").attr("class", "areas");
  const xAxisGroup = svg.append("g").attr("class", "x-axis");
  const yAxisGroup = svg.append("g").attr("class", "y-axis");
  const gridGroup = svg.insert("g", ".areas").attr("class", "grid");
  const overlayGroup = svg.append("g").attr("class", "overlay");
  const legendGroup = svg.append("g").attr("class", "legend");

  // ==========================================================================
  // RENDER
  // ==========================================================================
  function render() {
    // Filtrera på valt år om tidsdimensionen är aktiv
    const activeData = (time && currentYear != null)
      ? data.filter(d => d[time] === currentYear) : data;

    // Bestäm x-värden och kategorier (stabila över år via xOrder/colorOrder)
    const xValues = xOrder || [...new Set(activeData.map(d => d[x]))];
    const categories = colorOrder || [...new Set(activeData.map(d => d[color]))];

    // Pivot till wide per x-värde
    const wide = xValues.map(xv => {
      const row = { _x: xv };
      for (const k of categories) {
        const m = activeData.find(d => d[x] === xv && d[color] === k);
        row[k] = m ? (m[y] || 0) : 0;
      }
      return row;
    });

    // Normalisering (100 % stack)
    if (currentNormalize) {
      for (const row of wide) {
        const sum = categories.reduce((s, k) => s + row[k], 0);
        if (sum > 0) for (const k of categories) row[k] = row[k] / sum;
      }
    }

    // Stack
    const stack = d3.stack().keys(categories).offset(d3.stackOffsetNone);
    const series = stack(wide);

    // Skalor
    const xScale = d3.scaleBand()
      .domain(xValues)
      .range([marginLeft, autoWidth - marginRight])
      .padding(0);

    const yMax = currentNormalize ? 1 : d3.max(series, layer => d3.max(layer, d => d[1]));
    const yScale = d3.scaleLinear()
      .domain([0, yMax]).nice()
      .range([height - marginBottom, marginTop]);

    const colorScale = d3.scaleOrdinal().domain(categories).range(colors);

    const areaGen = d3.area()
      .x((_, i) => xScale(xValues[i]) + xScale.bandwidth() / 2)
      .y0(d => yScale(d[0]))
      .y1(d => yScale(d[1]))
      .curve(d3.curveMonotoneX);

    // Areor (med transition)
    const paths = areasGroup.selectAll("path").data(series, d => d.key);
    paths.exit().remove();
    paths.enter().append("path")
      .attr("fill-opacity", 0.92)
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.3)
      .merge(paths)
      .attr("fill", d => colorScale(d.key))
      .transition().duration(500)
      .attr("d", areaGen);

    // X-axel
    const tickEvery = Math.ceil(xValues.length / 12);
    const shownTicks = xValues.filter((_, i) => i % tickEvery === 0);

    xAxisGroup
      .attr("transform", `translate(0, ${height - marginBottom})`)
      .call(d3.axisBottom(xScale).tickValues(shownTicks))
      .call(g => g.select(".domain").attr("stroke", "#1a1a1a"))
      .call(g => g.selectAll(".tick line").attr("stroke", "#1a1a1a"))
      .call(g => g.selectAll(".tick text")
        .attr("fill", "#1a1a1a").attr("font-size", "11px")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("transform", rotateX ? "rotate(-35)" : null)
        .attr("text-anchor", rotateX ? "end" : "middle")
        .attr("dy", rotateX ? "0.5em" : "0.71em"));

    if (xLabel) {
      xAxisGroup.selectAll(".x-label").remove();
      xAxisGroup.append("text")
        .attr("class", "x-label")
        .attr("x", marginLeft + (autoWidth - marginRight - marginLeft) / 2)
        .attr("y", 36)
        .attr("text-anchor", "middle")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "11px").attr("fill", "#666")
        .text(xLabel);
    }

    // Y-axel
    const fmt = resolvedFormat();
    yAxisGroup
      .attr("transform", `translate(${marginLeft}, 0)`)
      .transition().duration(500)
      .call(d3.axisLeft(yScale).ticks(5).tickFormat(fmt))
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick line").remove())
      .call(g => g.selectAll(".tick text")
        .attr("x", -6).attr("text-anchor", "end")
        .attr("fill", "#666").attr("font-size", "11px")
        .attr("font-family", "'IBM Plex Sans', sans-serif"));

    // Gridlinjer
    gridGroup.selectAll("*").remove();
    yScale.ticks(5).forEach(tv => {
      gridGroup.append("line")
        .attr("x1", marginLeft).attr("x2", autoWidth - marginRight)
        .attr("y1", yScale(tv)).attr("y2", yScale(tv))
        .attr("stroke", "#eee").attr("stroke-width", 1);
    });

    // Legend
    legendGroup.selectAll("*").remove();
    legendGroup.attr("transform", `translate(${autoWidth - marginRight + 12}, ${marginTop})`);
    categories.forEach((k, i) => {
      const g = legendGroup.append("g").attr("transform", `translate(0, ${i * 22})`);
      g.append("rect")
        .attr("width", 12).attr("height", 12)
        .attr("fill", colorScale(k));
      g.append("text")
        .attr("x", 17).attr("y", 6).attr("dy", "0.35em")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "11px").attr("fill", "#1a1a1a")
        .text(k);
    });

    // Overlay-kolumner för hover (osynliga)
    overlayGroup.selectAll("*").remove();
    xValues.forEach((xv, i) => {
      overlayGroup.append("rect")
        .attr("x", xScale(xv))
        .attr("y", marginTop)
        .attr("width", xScale.bandwidth())
        .attr("height", height - marginBottom - marginTop)
        .attr("fill", "transparent")
        .style("cursor", "pointer")
        .on("mouseenter", function() {
          tooltip.style("display", "block");
          d3.select(this).attr("fill", "rgba(0,0,0,0.04)");
        })
        .on("mouseleave", function() {
          tooltip.style("display", "none");
          d3.select(this).attr("fill", "transparent");
        })
        .on("mousemove", function(event) {
          const row = wide[i];
          const rows = categories.slice().reverse().map(k => `
            <div class="graf-tooltip-row">
              <span class="graf-tooltip-dot" style="background:${colorScale(k)}"></span>
              <span class="graf-tooltip-name">${k}</span>
              <span class="graf-tooltip-val">${fmt(row[k])}</span>
            </div>
          `).join("");
          tooltip.html(`
            <div class="graf-tooltip-year">${xv}</div>
            <div class="graf-tooltip-list">${rows}</div>
          `);

          const rect = container.node().getBoundingClientRect();
          const tipRect = tooltip.node().getBoundingClientRect();
          let tx = event.clientX - rect.left + 14;
          let ty = event.clientY - rect.top - tipRect.height / 2;
          if (tx + tipRect.width > rect.width - 10) {
            tx = event.clientX - rect.left - tipRect.width - 14;
          }
          ty = Math.max(10, Math.min(ty, rect.height - tipRect.height - 10));
          tooltip.style("left", tx + "px").style("top", ty + "px");
        });
    });
  }

  // ==========================================================================
  // MEASURE SWITCH
  // ==========================================================================
  function switchMeasure(idx) {
    if (!measures || idx === currentMeasureIdx) return;
    currentMeasureIdx = idx;
    const m = measures[idx];
    data = m.data;

    // Om measure anger egna normalize/formatY (och toggle INTE används) — override
    if (!toggle) {
      if (m.normalize !== undefined) currentNormalize = m.normalize;
      if (typeof m.formatY === "function") currentFormatY = m.formatY;
    }

    if (measureLabel) measureLabel.text(m.label);
    if (subtitleTextSpan && m.subtitle) subtitleTextSpan.text(m.subtitle);
    if (measurePanel) {
      measurePanel.selectAll(".graf-measure-option")
        .each(function(d, i) { d3.select(this).classed("active", i === idx); });
    }

    render();
  }

  function switchToggle(idx) {
    if (!toggle || idx === currentToggleIdx) return;
    currentToggleIdx = idx;
    const t = toggle[idx];
    currentNormalize = t.normalize;
    if (typeof t.formatY === "function") {
      currentFormatY = t.formatY;
    } else {
      currentFormatY = t.normalize
        ? d => (d * 100).toFixed(0) + " %"
        : d => d.toLocaleString("sv-SE");
    }

    // Uppdatera CSS-klasser
    d3.select(container.node()).selectAll(".graf-toggle-opt")
      .each(function(d, i) { d3.select(this).classed("active", i === idx); });

    render();
  }

  // Initial render
  render();

  // Caption
  if (caption) container.append("div").attr("class", "graf-caption").text(caption);

  // Export
  addExportButton(container, svg.node(), {
    title, subtitle, caption,
    width: autoWidth, height,
    altText, info, logo
  });

  return container.node();
}
