# PROOF — a lifting log

> **At a glance** — A mobile workout tracker built with Expo / React Native and
> TypeScript. Logging a set takes one tap, and a built-in coach suggests the next
> weight from your history. It's local-first (SQLite, no account, no network) and
> supports English and Spanish. All the business rules live in pure TypeScript modules
> tested with `node --test`, so they run without a phone simulator.
> Built by Robert Schwartz, informed by his time selling memberships at EOS Fitness.

## What it does

- **Log a set in one tap.** The weight/reps dial comes pre-filled from your last session.
- **Coach suggestions.** It recommends when to add weight, repeat or back off, based on what you actually lifted.
- **Session recap.** At the end of a session it shows personal records and your next targets.
- **Workout splits and exercise library.** Programs are stored as data, not hard-coded screens.
- **English and Spanish.**

## Tech

| Layer | Choice |
|---|---|
| App | Expo 54, React Native, expo-router |
| Language | TypeScript (strict) |
| Storage | SQLite on device (`expo-sqlite`), a web adapter for the browser build |
| Tests | `node --test` over the domain and screen-model modules, plus `tsc --noEmit` |

The domain rules live in `app/src/domain/` and each screen's state in `app/src/ui/*-model.ts`.
The `.tsx` files only render. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full module map.

## Run it

```bash
cd app
npm install
npm test        # domain + model tests and a type check
npm run web     # browser build on http://localhost:8099
npm start       # Expo dev server (iOS / Android)
```
