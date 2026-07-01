// Central D3-import. Alla graf- och kartmoduler importerar härifrån,
// så vi har EN version och EN källa att byta vid behov.
// ESM-bygge från CDN (kräver internet vid visning, precis som Google Fonts).
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
export { d3 };

// Region Hallands palett — samma hex som style.scss och data.
// Importeras av moduler som behöver färger i ritlogiken.
export const PALETT = {
  gron1: "#00664D",
  gron2: "#00AB60",
  gron3: "#C1E8C4",
  gron4: "#E3F4E2",
  bla1:  "#004990",
  bla2:  "#2DB8F6",
  bla3:  "#A2D9F8",
  bla4:  "#E2F6FF",
  svart: "#000000",
  gra1:  "#83888A",
  gra2:  "#D6D6D6",
  vit:   "#FFFFFF"
};

// Liten hjälpare: kör en ritfunktion när elementet har en bredd och
// rita om vid storleksändring. Returnerar en cleanup-funktion.
// Detta är limmet som gör att kartor/grafer beter sig som "ggplot-funktioner":
// rita(el, data) → snyggt, responsivt resultat.
export function nar_matbar(el, rita) {
  let bredd = 0;
  const ro = new ResizeObserver((poster) => {
    const w = Math.round(poster[0].contentRect.width);
    if (w > 0 && w !== bredd) {
      bredd = w;
      rita(w);
    }
  });
  ro.observe(el);
  return () => ro.disconnect();
}
