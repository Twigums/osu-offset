# offset. - osu!mania hit timing analyzer

A static, local-first website for studying the timing spread of osu!mania replays. No accounts, database, API keys, or backend are required.

## Features

- Upload an exported osu!mania replay (`.osr`) and its exact matching `.osu` beatmap.
- MD5 verification of the beatmap against the replay's recorded beatmap hash.
- Signed hit-offset histogram: **negative = early**, **positive = late**.
- Stable osu!mania OD-based timing window guides for MAX, 300, 200, 100, and 50.
- Per-hit timeline with a rolling median, per-lane statistics, tap/hold filters.
- Timing mean, median, standard deviation, early/late breakdown.
- Official scorecard judgement counts from the replay header.
- Export matching note-start offsets as CSV, and the histogram as SVG.
- Responsive layout. Beatmap and replay data stay in your browser.

## Deploy with GitHub Pages

1. Create a public repository on GitHub, for example `osu-mania-offset`.
2. Upload the **contents of this folder** to the repository root (including `index.html` and `src/`). Alternatively, from this folder:

   ```sh
   git init
   git add .
   git commit -m "Add osu!mania timing analyzer"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/osu-mania-offset.git
   git push -u origin main
   ```

3. In the repository, open **Settings > Pages**. Under **Build and deployment**, select **Deploy from a branch**, branch **main**, folder **/(root)**, and save.
4. Open `https://YOUR-USERNAME.github.io/osu-mania-offset/` once GitHub Pages publishes the site.

All project paths are relative, so it works both in a project repository and as `YOUR-USERNAME.github.io`.

No `npm install`, compiler, or GitHub Actions workflow is needed.

## Run locally

Use a local HTTP server (ES modules generally cannot load from `file://`):

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## How hit matching works

1. Parse the binary osu!mania `.osr` header and decompress its LZMA event stream in JavaScript.
2. Accumulate the replay frame deltas (including initial negative deltas), then detect each lane's key-up to key-down transitions. Legacy osu!mania replays encode the key bitmap in the frame's **X coordinate**, not its normal button bitfield.
3. Parse mania hit circles and hold-note **starts** from the `.osu` file; assign lanes from X coordinates.
4. Match press events to notes in each lane using an order-preserving minimum-cost alignment, constrained by the stable osu!mania 50 timing window. Very large lanes use a simpler greedy match to cap memory use.
5. Compute `offset_ms = keypress_time_ms - note_time_ms` for each matched head.

The nominal stable osu!mania hit windows are:

| Head timing | Maximum absolute timing error |
| --- | --- |
| MAX | 16 ms |
| 300 | 64 - 3 * OD ms |
| 200 | 97 - 3 * OD ms |
| 100 | 127 - 3 * OD ms |
| 50 | 151 - 3 * OD ms |

Easy and Hard Rock adjust the OD displayed in the timing guides. **Rate mods (DT/NC/HT) are flagged** because the replay and beatmap clock can differ between replay formats; timings should be checked for plausibility. Some modded maps, lazer scoring variants, and unusual key layouts may not reconstruct perfectly.

**Important limitations:** This is an estimator of key-down timing, not an exact osu! scoring engine. Hold note *releases* are not reconstructed. In stable ScoreV1, holds receive a combined judgement for head and tail, so the in-game scorecard will often differ from the timing-window classification of note starts. Notelock and other internal scoring rules are also not simulated. Unmatched note starts are not necessarily identical to the official miss count.

References: [osu!mania judgement system](https://osu.ppy.sh/wiki/en/Gameplay/Judgement/osu%21mania), [hold note scoring](https://osu.ppy.sh/wiki/en/Gameplay/Hit_object/Hold_note), [replay file format](https://osu.ppy.sh/wiki/en/Client/File_formats/osr_%28file_format%29).

## Privacy and dependencies

- **Your `.osr` and `.osu` files never leave the browser.** No server receives them, and there are no analytics or tracking scripts.
- The site loads one pinned JavaScript dependency for replay decompression: [LZMA-JS 2.3.2](https://github.com/LZMA-JS/LZMA-JS), under the MIT license. It is loaded from jsDelivr on page load, so initial use requires an internet connection. You can vendor it by downloading `src/lzma-d.js` from LZMA-JS into a local `vendor/` folder and replacing the CDN URL in `index.html` with `./vendor/lzma-d.js`.
- All charting and analysis code is plain JavaScript and SVG; there are no build-time dependencies.

## Tests

Run `node --test tests/*.test.mjs` to verify parsers, scoring windows and alignment. Node 20+ recommended.

## License

Site code: MIT, see `LICENSE`. LZMA-JS is separately licensed under MIT by Nathan Rugg and is loaded, not included, in this repository.
