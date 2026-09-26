# Raw handbook snapshots

Compressed copies of `data/raw/<year>/` (which is gitignored), as a backup of each pull, so the
handbook never has to be pulled again to rebuild the maps.

- `uts-2027-raw.tgz`: the full 2027 UTS handbook as pulled 25-26 Sep 2026 (444 courses, 957 areas
  of study, 3,299 subjects, 3,309 requisite pages; see `data/reports/full-2027.json`). 10.8 MB,
  138 MB unpacked, 8,033 files.

Restore: `tar -xzf data/snapshots/uts-2027-raw.tgz -C data/raw`

This is UTS's handbook content, backed up in a private repository. Remove it (from history too)
before this repository is ever made public.
