# Paris Grocery Store Heatmap — PRD

**Version:** v0.1
**Date:** June 2026
**Status:** Draft

> **Note to model:** This document is your build spec. Anything marked with `>` is a directive to you. For every open question, either ask the user for their preference or propose what you think is best with a brief rationale — never leave them unanswered silently.

---

## 1. Overview

A web application that displays grocery stores across Paris on an interactive map, with a heatmap overlay representing **proximity to the user's address** (not store density). The goal of v1 is to let any Parisian instantly visualize which grocery stores are closest to them, filtered by store type.

---

## 2. Goals & Non-Goals

### Goals
- Allow users to enter a Paris address and see nearby grocery stores on a map
- Render a proximity heatmap: intensity reflects how close each store is to the user's pin
- Filter the map by store type (multiple types supported in v1)
- Show store name, type, and distance on click/tap
- Work on mobile browsers without a native app

### Non-Goals (v1)
- Real-time stock or pricing data
- User accounts or saved preferences
- Routing / turn-by-turn directions
- Store hours or opening status
- Stores outside Paris proper

---

## 3. User Stories

| ID | As a user, I want to… | So that… |
|----|-----------------------|----------|
| US-01 | Enter my home address | The map centers on my location and the heatmap updates |
| US-02 | See a proximity heatmap | I can visually identify which areas have stores close to me |
| US-03 | Toggle store type filters | I only see the types of stores I care about |
| US-04 | Click on a store marker | I can see its name, type, and distance from my address |
| US-05 | See a ranked list of closest stores | I can quickly identify my top options without reading the map |

---

## 4. Functional Requirements

### 4.1 Address Input
- Autocomplete input field restricted to Paris addresses
- On submit: geocode address to lat/lng using Nominatim (OSM)
- Clear/reset button resets map to default Paris view
- Error state if address is outside Paris or unresolvable

### 4.2 Map
- **Rendering:** React + MapLibre GL JS as the primary map renderer; Leaflet used for heatmap overlay layer (via leaflet.heat)
- Interactive map of Paris (panning, zooming)
- Default view: full Paris bounding box (~48.815–48.902 lat, 2.225–2.470 lng)
- After address input: map pans and zooms to user location (zoom 14)
- User location shown as a distinct pin

> Ask the user: should MapLibre handle the base map tiles and Leaflet be layered on top, or should we use one renderer only? Suggest your preferred approach with a rationale.

### 4.3 Store Data
- **Source:** OpenStreetMap via Overpass API or pre-baked GeoJSON
- OSM data is ODbL licensed — map must include OSM attribution
- Store types to include (OSM tags):
  - `shop=supermarket` — Supermarkets (Monoprix, Carrefour, Franprix, etc.)
  - `shop=convenience` — Convenience stores (Spar, G20, etc.)
  - `shop=greengrocer` — Fruit & vegetable shops
  - `shop=butcher` — Butchers
  - `shop=fishmonger` — Fishmongers
  - `shop=bakery` — Bakeries
  - `shop=deli` — Delicatessens / charcuteries
  - `shop=cheese` — Fromageries
  - `shop=organic` — Bio / organic stores (Naturalia, Bio c' Bon, etc.)
  - `shop=frozen_food` — Frozen food stores (Picard)
  - `shop=alcohol` — Wine shops / cavistes
  - `shop=beverages` — Drink shops
- Stores rendered as map markers, styled by type
- Marker clustering at low zoom levels
- Click on marker: popup with store name, type, and straight-line distance from user address

> Ask the user: should we fetch store data live from Overpass at runtime (always fresh, slower) or pre-download a Paris GeoJSON extract and bundle it (fast, needs periodic refresh)? Recommend what you think is best.

### 4.4 Heatmap Overlay
- **Logic:** proximity-based only — the heatmap reflects distance from the user's pin, not store density
- Each store contributes a heat point; intensity = `1 / distance_in_metres` (closer = hotter)
- Stores beyond a maximum radius contribute zero intensity (cutoff TBD)
- Color scale: cool (blue) = far → warm (red) = close
- Heatmap updates every time the address or active filters change
- Opacity slider to adjust heatmap visibility (0–100%)
- Heatmap only renders after an address has been entered; default state shows no heatmap

> Ask the user: what should the maximum radius cutoff be (e.g. 500m, 1km, 2km)? Suggest a sensible default with reasoning.

### 4.5 Store Type Filters
- Filter bar with one toggle per store type (see §4.3 list)
- Filters affect both map markers and the heatmap simultaneously
- Default state: all types active
- "Select all / Clear all" shortcut buttons

> Ask the user: should filters be a horizontal pill bar, a dropdown panel, or a sidebar? Suggest what works best for mobile and desktop.

### 4.6 Results Panel
- List of the N closest stores (respecting active filters), ranked by distance
- Default N = 5, expandable to 10
- Each row: store name, type badge, distance in metres
- Clicking a row pans the map to that marker and opens its popup

---

## 5. Non-Functional Requirements

- Initial page load under 3 seconds on a 4G connection
- Address geocoding response under 1 second
- Works on Chrome, Firefox, Safari (last 2 major versions), iOS Safari, Android Chrome
- Responsive layout for mobile and desktop
- No user data stored server-side; address must not be persisted

---

## 6. Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend framework | React |
| Map renderer | MapLibre GL JS |
| Heatmap layer | Leaflet + leaflet.heat |
| Map tiles | OpenStreetMap (free, attribution required) |
| Geocoding | Nominatim (OSM) |
| Store data | OpenStreetMap via Overpass API or GeoJSON extract (see §4.3) |
| Hosting | TBD |
| Bundler | TBD |

> Ask the user about hosting and bundler preferences, or suggest sensible defaults (e.g. Vite + Vercel) with reasoning.

---

## 7. Future Iterations (Out of Scope for v1)

- Weighted heatmap by store surface area or chain type
- Isochrone overlay (actual walking/cycling time instead of radius)
- Store hours / open-now filter
- Shareable URL with encoded address
- PWA / offline mode
