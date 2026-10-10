import type { Hotspot } from "./types";

/**
 * DEV-ONLY SAMPLE LIST for `npm run dev` without a database (the same rule as src/components/me/demo.ts): the 13
 * junctions from supabase/hotspot_zones.sql with made-up counts, wave 1 open. No zone shapes, so in the demo the
 * nearest hotspot stands in for your zone. Nothing here is a real count.
 */
const row = (
  slug: string,
  name: string,
  zoneName: string,
  zoneLabel: string,
  side: Hotspot["side"],
  roadA: string,
  roadB: string,
  lat: number,
  lng: number,
  wave: number,
  here: [Hotspot["hereBand"], number | null],
  today: [Hotspot["todayBand"], number | null]
): Hotspot => ({
  id: `demo-${slug}`,
  slug,
  name,
  zoneName,
  zoneLabel,
  side,
  junction: name,
  roadA,
  roadB,
  lat,
  lng,
  wave,
  status: wave === 1 ? "open" : "planned",
  zone: null,
  hereBand: wave === 1 ? here[0] : "quiet",
  hereN: wave === 1 ? here[1] : null,
  todayBand: wave === 1 ? today[0] : "quiet",
  todayN: wave === 1 ? today[1] : null,
});

export const DEMO_HOTSPOTS: Hotspot[] = [
  row("yaba", "Jibowu", "Yaba", "Yaba, Jibowu, Ebute Metta, Akoka, Shomolu, Bariga, Makoko", "mainland", "Herbert Macaulay Street", "Murtala Muhammed Way", 6.5167, 3.36862, 1, ["some", 7], ["busy", 31]),
  row("lekki", "Lekki Phase 1", "Lekki", "Lekki Phase 1 to Chevron and Jakande, Ikate, Osapa, Ikota", "island", "Admiralty Way", "Fatai Idowu Arobieke Street", 6.44787, 3.47021, 1, ["few", null], ["some", 9]),
  row("victoria-island", "Adeola Odeku", "Victoria Island", "Victoria Island, Oniru, Maroko, Eko Atlantic", "island", "Akin Adesola Street", "Adeola Odeku Street", 6.4292, 3.42393, 1, ["busy", 24], ["busy", 58]),
  row("ikeja", "Allen Roundabout", "Ikeja", "Ikeja, Alausa, Opebi, Maryland, Ogba, Ojodu, Agege", "mainland", "Obafemi Awolowo Way", "Allen Avenue", 6.60716, 3.34917, 1, ["quiet", null], ["few", null]),
  row("surulere", "Ojuelegba", "Surulere, Mushin and Oshodi", "Surulere, Mushin, Ojuelegba, Ilupeju, Isolo, Oshodi, Okota", "mainland", "Western Avenue", "Ojuelegba Road", 6.51006, 3.36317, 2, ["quiet", null], ["quiet", null]),
  row("ikoyi", "Bourdillon", "Ikoyi", "Ikoyi, Falomo, Banana Island, Parkview", "island", "Bourdillon Road", "Alexander Avenue", 6.44491, 3.44976, 2, ["quiet", null], ["quiet", null]),
  row("lagos-island", "Obalende", "Lagos Island", "Marina, CMS, Obalende, Idumota, Onikan", "island", "Obalende Road", "Massey Bamgboshe Street", 6.44931, 3.40712, 2, ["quiet", null], ["quiet", null]),
  row("ojota", "Ojota", "Ojota and Gbagada", "Ojota, Ketu, Ogudu, Magodo, Gbagada, Anthony, Oworonshoki, Mile 12", "mainland", "Ikorodu Road", "Ogudu Road", 6.58853, 3.37953, 3, ["quiet", null], ["quiet", null]),
  row("festac", "Mile 2", "Festac and Apapa", "Festac, Mile 2, Amuwo Odofin, Apapa, Ajegunle", "mainland", "Lagos-Badagry Expressway", "Jakande Estate Road", 6.46019, 3.30985, 3, ["quiet", null], ["quiet", null]),
  row("ajah", "Ajah", "Ajah and beyond", "Ajah, Sangotedo, Awoyaya, Ibeju-Lekki", "island", "Lekki-Epe Expressway", "Mobil Estate Road", 6.46563, 3.5616, 3, ["quiet", null], ["quiet", null]),
  row("alimosho", "Ikotun", "Alimosho", "Egbeda, Ikotun, Igando, Idimu, Ipaja, Iyana Ipaja", "mainland", "Idimu - Ikotun Road", "Egbe Road", 6.54812, 3.26773, 4, ["quiet", null], ["quiet", null]),
  row("ojo-badagry", "Iyana Iba", "Ojo and Badagry", "Ojo, Alaba, Okokomaiko, Iba, Badagry", "mainland", "Lasu-Isheri Road", "Lagos-Badagry Expressway", 6.46121, 3.2039, 4, ["quiet", null], ["quiet", null]),
  row("ikorodu", "Ikorodu Garage", "Ikorodu and Epe", "Ikorodu, Itoikin, Epe", "mainland", "Ikorodu Road", "Ayangburen Road", 6.62045, 3.50345, 4, ["quiet", null], ["quiet", null]),
];
