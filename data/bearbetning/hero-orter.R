# hero-orter.R: tätorternas läge och folkmängd till förstasidans Hallandskarta
#
# Läser SCB:s tätortsytor (befolkning/data/tatorter-karta.topojson, SWEREF99 TM,
# folkmängd 2024) och skriver en punkt per tätort i WGS84 till data/hero-orter.json.
# Punkten är st_point_on_surface, så den hamnar alltid inne i tätortens yta.
#   Rscript data/bearbetning/hero-orter.R
suppressPackageStartupMessages(library(sf))
t <- st_read(here::here("befolkning", "data", "tatorter-karta.topojson"), layer = "tatorter", quiet = TRUE)
st_crs(t) <- 3006
p <- st_transform(st_point_on_surface(st_make_valid(t)), 4326)
xy <- st_coordinates(p)
ut <- data.frame(namn = t$name, kommun = t$kommun, inv = as.integer(t$bef_2024),
                 lon = round(xy[, 1], 4), lat = round(xy[, 2], 4))
ut <- ut[order(-ut$inv), ]
# Kungsbackas tätortsdel heter "Kungsbacka (GBG)" (den ingår i Göteborgs tätort).
ut$namn[ut$namn == "Kungsbacka (GBG)"] <- "Kungsbacka"
# Centralorterna märks i kartan och placeras i sina stadskärnor (ytans
# mittpunkt kan hamna en bit bort i utdragna tätorter)
karna <- list(Halmstad = c(12.8578, 56.6745), Kungsbacka = c(12.0761, 57.4872), Varberg = c(12.2502, 57.1057),
              Falkenberg = c(12.4912, 56.9055), Laholm = c(13.0437, 56.5121), Hyltebruk = c(13.2396, 56.9960))
ut$centralort <- ut$namn %in% names(karna)
for (n in names(karna)) { i <- which(ut$namn == n); ut$lon[i] <- karna[[n]][1]; ut$lat[i] <- karna[[n]][2] }
jsonlite::write_json(ut, here::here("data", "hero-orter.json"), auto_unbox = TRUE, digits = NA)
message(nrow(ut), " tätorter → data/hero-orter.json")
