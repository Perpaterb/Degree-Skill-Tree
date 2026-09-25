# Faculty colours

Degrees are coloured by faculty (US-039). This is how to find a university's faculty colours, the
same way every time, and record where each one came from (US-041).

## Where to look, in order

1. **Official faculty brand colours.** Search the university's brand or style guide for a faculty
   palette ("<university> brand guidelines faculty colours", the marketing or brand hub, any
   downloadable brand PDF). Use these only if the university publishes a colour per faculty.
2. **Academic dress.** Nearly every university sets a hood colour per faculty for graduation, and
   publishes it: search "<university> academic dress", "hood colours", "graduation regalia", or the
   academic dress rules or regulations. Supplier sites (gown hire companies) often list them too, but
   prefer the university's own page.
3. **Fallback palette.** If neither exists, give each faculty a distinct colour from a fixed palette
   and say so in the file (`"method": "fallback"`).

Avoid red for anything but a faculty that really is red: red also means a clash or a locked-out
program on the map. If a faculty is red (UTS Engineering is scarlet), keep it, and note it.

## Getting the hex

- Use the hex (or RGB, CMYK, Pantone converted to hex) when the source publishes one:
  `"hexFrom": "published"`.
- Otherwise sample it from the university's own photo of the hood: take the median colour of the
  hood fabric, ignoring the black gown, the background and the mannequin, from the Bachelor hood
  photo. Record the photo's path: `"hexFrom": "sampled"`.
- Record the university's own colour name where it gives one (`officialName`), even when the hex is
  sampled. `null` when the colour is only shown, never named.

The app adjusts each colour per theme only as far as needed to reach 3:1 contrast on the map,
keeping its hue (`readable` in `web/src/theme.ts`), so record the colour as the university shows it.

## Matching degrees to colours

A handbook gives each degree a faculty name, and a double degree lists one per component degree
(joined with ", " by the normaliser). `rules` are tried in order; the first whose `faculty` pattern
matches, and whose optional `title` pattern matches that component's title, gives the colour. Use a
`title` pattern where one faculty has several hood colours (UTS Engineering and IT: Engineering
degrees scarlet, the rest IT blue).

`npm run scrape -- normalize ...` warns about any degree it cannot colour, and
`scraper/test/facultyColours.test.ts` fails if a degree on the map has no colour.

## The file

`data/faculty-colours/<institution>.json`:

```json
{
  "institution": "...",
  "method": "brand | academic-dress | fallback",
  "retrieved": "YYYY-MM-DD",
  "source": "https://...",
  "notes": "what was found, and what was not",
  "colours": { "<key>": { "name": "...", "officialName": "... | null", "hex": "#rrggbb", "hexFrom": "published | sampled", "photo": "..." } },
  "rules": [{ "faculty": "<regex>", "title": "<regex, optional>", "colour": "<key>" }]
}
```

## UTS (25 Sep 2026)

No faculty brand colours are published (the brand is UTS blue and red), so UTS uses academic dress:
the [academic dress photo gallery](https://www.uts.edu.au/for-students/current-students/managing-your-course/graduation/academic-dress-and-history/academic-dress-photo-gallery).
Six colours are named there (uluru brown, jade green, chartreuse, eau de nil grey, scarlet, fuchsia);
Information Technology, Law, Science and Transdisciplinary Innovation are shown only in photos. All
ten hex values were sampled from the Bachelor hood photos. See `data/faculty-colours/uts.json`.
