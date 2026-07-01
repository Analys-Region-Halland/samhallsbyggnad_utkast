// =============================================================================
// SCROLLSTEGARE — minimal scroll-driven stegare via IntersectionObserver
// =============================================================================
// Observerar en uppsättning steg-element och anropar onStep(index) när ett nytt
// steg passerar skärmens mitt. Passiv och billig: inga egna scroll-lyssnare.
//
//   scrollstegare(stegElement[], { onStep, rootMargin })
//
// rootMargin "-45% 0px -45% 0px" gör att aktivt steg = det som ligger i en smal
// remsa kring vertikala mitten. Returnerar { destroy }.

export function scrollstegare(steg, { onStep, rootMargin = "-45% 0px -45% 0px" } = {}) {
  let aktiv = -1;

  const obs = new IntersectionObserver((entries) => {
    // Välj det intersectande steget närmast mitten.
    let bast = null, bastAvst = Infinity;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const r = e.boundingClientRect;
      const mitt = r.top + r.height / 2;
      const avst = Math.abs(mitt - window.innerHeight / 2);
      if (avst < bastAvst) { bastAvst = avst; bast = e.target; }
    }
    if (!bast) return;
    const i = steg.indexOf(bast);
    if (i !== -1 && i !== aktiv) { aktiv = i; onStep?.(i); }
  }, { rootMargin, threshold: 0 });

  steg.forEach((s) => obs.observe(s));

  // Initiera på första steget så scenen har ett känt utgångsläge.
  if (steg.length) { aktiv = 0; onStep?.(0); }

  return { destroy: () => obs.disconnect() };
}
