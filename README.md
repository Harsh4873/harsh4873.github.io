# Daymark

Daymark is the local-first habit tracker published at `harsh.bet/tracker/`. Its source is isolated on the `tracker` branch of PickLedgerPro and assembled into the composite GitHub Pages artifact by `main`.

## Product model

- Daily, weekly, monthly, and rolling-year reviews
- Check, count, duration, quantity, and distance measurements
- Reach-at-least and stay-at-or-below goals
- Daily, selected-day, interval, weekly, and monthly rhythms
- Period-aware streaks, consistency scores, skips, notes, pause history, and normalized heatmaps
- Mirrored IndexedDB/localStorage persistence with lossless JSON backup and CSV export

No habit data is sent to a server. Clearing browser storage can still remove local history, so the Profile view makes JSON backup prominent.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
```

Vite's public base is `/tracker/`. Navigation is hash-based so every view remains safe on GitHub Pages without a server rewrite.
