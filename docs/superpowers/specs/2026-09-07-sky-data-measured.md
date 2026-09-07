# The sky data, measured — reference for round 2

Everything below was measured on 2026-09-06/07 with real requests. It exists so
that round 2's plan and its implementers do not repeat the research, and so a
later reader can tell which numbers were checked and which were assumed.

## Sources, checked with an Origin header

| Source | Gives | CORS | Licence |
|---|---|---|---|
| `cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/stars.6.json` | 5 044 stars to mag 6 as GeoJSON points, `{id: HIP, properties: {mag, bv}, geometry: {coordinates: [RA deg, Dec deg]}}`, 657 KB | yes | BSD-3-Clause, Olaf Frohn |
| `…/constellations.lines.json` | 88 `MultiLineString` figures in RA/Dec, 27 KB | yes | BSD-3 |
| `…/constellations.json` | 89 features with names in 20 languages — **no Norwegian** | yes | BSD-3 |
| `…/messier.json` | 110 objects, 21 KB | yes | BSD-3 |
| `…/starnames.json` | proper names by HIP, 681 KB | yes | BSD-3 |
| no.wikipedia.org `Liste_over_stjernebilder` | the 88 Norwegian names | yes | CC BY-SA |

`astronomy-engine@2.1.19` (already a dependency from round 1) supplies
`Equator` → `Horizon` for the observer, `SiderealTime`, `Illumination` and
`MoonPhase`. No new dependency is needed for round 2.

## The constellation figures reduce to star pairs

`constellations.lines.json` draws each figure as coordinate polylines, not as
star references. Measured: **every vertex lies within 0,35° of a star in the
magnitude-6 catalogue — 799 of 800 across all 88 constellations, one
unmatched.** Snapping each vertex to its nearest catalogue star therefore turns
the drawing into a machine-checkable answer key.

- **735 edges** over 88 constellations, as unordered pairs of HIP numbers.
- Smallest: Canis Minor and Canes Venatici, 1 edge each. Largest: Sagittarius
  29, Eridanus 26, Orion 24, Pisces 23, Perseus 23.
- **750 distinct stars** are touched by the lines.
- The faintest star any line uses is magnitude 5,89.

This is what makes the connect-the-stars exercise gradeable in both directions
(spec §6.2). Build it once with a script and commit the output; the app never
fetches it.

## The bundled star set must be a union, not a magnitude cut

**119 of the 750 stars the lines need are fainter than magnitude 4,5, and 28
are fainter than 5,0.** A plain magnitude cut therefore leaves constellation
figures with gaps where a line ends at a star that was not kept.

| set | stars | compact JSON |
|---|---|---|
| mag ≤ 3,5 alone | 288 | — |
| mag ≤ 4,5 alone | 921 | 36 KB |
| mag ≤ 5,0 alone | 1 627 | — |
| **mag ≤ 4,5 ∪ every constellation star** | **1 040** | **52 KB** |
| mag ≤ 3,5 ∪ every constellation star | 766 | 38 KB |
| mag ≤ 5,0 ∪ every constellation star | 1 655 | 82 KB |

Recommended bundle: the 4,5 union at 52 KB, plus 14 KB of names and edges =
**66 KB total**. Deeper stars stay an optional runtime fetch.

## The 88 Norwegian names

From the Norwegian Wikipedia list. All 88 match the abbreviations in
`constellations.lines.json` exactly — no gap in either direction.

```
And Andromeda Andromeda | Ant Antlia Luftpumpen | Aps Apus Paradisfuglen
Aqr Aquarius Vannmannen | Aql Aquila Ørnen | Ara Ara Alteret | Ari Aries Væren
Aur Auriga Kusken | Boo Bootes Bjørnevokteren | Cae Caelum Meiselen
Cam Camelopardalis Sjiraffen | Cnc Cancer Krepsen | CVn Canes Venatici Jakthundene
CMa Canis Major Store hund | CMi Canis Minor Den lille hund
Cap Capricornus Steinbukken | Car Carina Kjølen | Cas Cassiopeia Kassiopeia
Cen Centaurus Kentauren | Cep Cepheus Kefeus | Cet Cetus Hvalfisken
Cha Chamaeleon Kameleonen | Cir Circinus Passeren | Col Columba Duen
Com Coma Berenices Berenikes hår | CrA Corona Australis Den sørlige krone
CrB Corona Borealis Den nordlige krone | Crv Corvus Ravnen | Crt Crater Begeret
Cru Crux Sørkorset | Cyg Cygnus Svanen | Del Delphinus Delfinen
Dor Dorado Gullfisken | Dra Draco Dragen | Equ Equuleus Føllet
Eri Eridanus Floden | For Fornax Smelteovnen | Gem Gemini Tvillingene
Gru Grus Tranen | Her Hercules Herkules | Hor Horologium Uret
Hya Hydra Vannslangen | Hyi Hydrus Den sørlige vannslangen | Ind Indus Indianeren
Lac Lacerta Firfislen | Leo Leo Løven | LMi Leo Minor Den lille løve
Lep Lepus Haren | Lib Libra Vekten | Lup Lupus Ulven | Lyn Lynx Gaupen
Lyr Lyra Lyren | Men Mensa Bordet | Mic Microscopium Mikroskopet
Mon Monoceros Enhjørningen | Mus Musca Fluen | Nor Norma Vinkelhaken
Oct Octans Oktanten | Oph Ophiuchus Slangebæreren | Ori Orion Orion
Pav Pavo Påfuglen | Peg Pegasus Pegasus | Per Perseus Persevs
Phe Phoenix Føniks | Pic Pictor Maleren | Psc Pisces Fiskene
PsA Piscis Austrinus Den sørlige fisken | Pup Puppis Akterstavnen
Pyx Pyxis Kompasset | Ret Reticulum Nettet | Sge Sagitta Pilen
Sgr Sagittarius Skytten | Sco Scorpius Skorpionen | Scl Sculptor Billedhuggeren
Sct Scutum Skjoldet | Ser Serpens Slangen | Sex Sextans Sekstanten
Tau Taurus Tyren | Tel Telescopium Teleskopet
TrA Triangulum Australe Det sørlige triangelet | Tri Triangulum Triangelet
Tuc Tucana Tukanen | UMa Ursa Major Store bjørn | UMi Ursa Minor Lille bjørn
Vel Vela Seilet | Vir Virgo Jomfruen | Vol Volans Flygefisken
Vul Vulpecula Reven
```

## The build recipe, verified

For each feature in `constellations.lines.json`, for each vertex, take the
nearest star in `stars.6.json` by angular distance with the longitude
difference scaled by `cos(latitude)` and wrapped at ±180°; accept it under
0,35°. Consecutive distinct stars along a segment form an edge; store edges
sorted and de-duplicated. Then keep every star with `mag ≤ limit` plus every
star any edge names.

Rounding star coordinates to three decimals and storing
`{i: HIP, c: [ra, dec], m: mag, b: bv}` is what produced the sizes above.

## What is NOT usable

- **JPL Horizons and SBDB, and the NASA Exoplanet Archive TAP service: no CORS
  header.** Verified. They would need a proxy, and this repo has no proxy
  function.
- **api.le-systeme-solaire.net now returns 401** without an API key.
- **Wikidata** answers with CORS in about 0,5 s, but its raw values carry mixed
  units — Mars' semi-major axis in km against Earth's in AU, Jupiter's mass as
  "1" — so it cannot feed a figure directly.
