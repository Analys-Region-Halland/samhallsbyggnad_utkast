// =============================================================================
// GRAFSTEPPER — bläddra mellan flera färdiga grafer i en figur.
// CSS ligger i style.scss (GRAFSYSTEM). Nav:en flyttas in i den aktiva
// slidens .graf-header och ligger nere till höger (verktygen ligger uppe till
// höger), så de krockar inte.
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

/**
 * grafStepper — visar en graf åt gången med navigation i graf-headern.
 *
 * @param {HTMLElement[]} elements - Array av DOM-noder (returnerade av graf-komponenterna)
 * @param {Object} [options]
 * @returns {HTMLElement} wrapper DOM-nod
 */
export function grafStepper(elements, options = {}) {
  let current = 0;
  const count = elements.length;

  const container = d3.create("div")
    .attr("class", "graf-stepper")
    .attr("tabindex", "0");

  // --- Slides ---
  const slides = [];
  for (let i = 0; i < count; i++) {
    const slide = container.append("div").attr("class", "graf-stepper-slide");
    slide.node().appendChild(elements[i]);
    slides.push(slide);
  }

  // --- Navigation (fristående, flyttas in i aktiv header) ---
  const nav = d3.create("div").attr("class", "graf-stepper-nav");

  const prevBtn = nav.append("button")
    .attr("type", "button")
    .attr("class", "graf-stepper-arrow")
    .attr("aria-label", "Föregående")
    .html("&#x2039;");

  const track = nav.append("div").attr("class", "graf-stepper-track");

  const markers = [];
  for (let i = 0; i < count; i++) {
    const marker = track.append("button")
      .attr("type", "button")
      .attr("class", "graf-stepper-marker")
      .attr("aria-label", `Visa vy ${i + 1}`);
    marker.append("span").attr("class", "graf-stepper-marker-dot");
    markers.push(marker);
  }

  const nextBtn = nav.append("button")
    .attr("type", "button")
    .attr("class", "graf-stepper-arrow")
    .attr("aria-label", "Nästa")
    .html("&#x203A;");

  const counter = nav.append("span").attr("class", "graf-stepper-counter");

  function goTo(index) {
    current = Math.max(0, Math.min(count - 1, index));
    slides.forEach((s, i) => s.classed("active", i === current));
    markers.forEach((m, i) => m.classed("active", i === current));
    prevBtn.attr("disabled", current === 0 ? true : null);
    nextBtn.attr("disabled", current === count - 1 ? true : null);
    counter.text(`${current + 1} / ${count}`);

    const header = slides[current].select(".graf-header");
    if (!header.empty()) header.node().appendChild(nav.node());
  }

  prevBtn.on("click", () => goTo(current - 1));
  nextBtn.on("click", () => goTo(current + 1));
  markers.forEach((m, i) => m.on("click", () => goTo(i)));

  container.on("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); goTo(current - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(current + 1); }
  });

  goTo(0);
  return container.node();
}
