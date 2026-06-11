# Paris Grocery Heatmap

Interactive map of grocery stores in Paris with a proximity heatmap: enter
your address and see which stores are closest, filtered by store type.

Built with React, Vite, TypeScript and MapLibre GL JS. Store data ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL),
fetched via the Overpass API; geocoding by Nominatim.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

## Refreshing store data

```bash
npm run fetch-stores
```

Regenerates `public/data/stores.geojson` from Overpass (Paris proper, 12
grocery-related shop types). Intended to be run weekly.

## Docs

- [Product spec](docs/PRD.md)
- [Decisions log](docs/DECISIONS.md)

## License

Code is released under the [MIT License](LICENSE). The bundled store and
boundary data derive from OpenStreetMap and remain © OpenStreetMap
contributors under the [ODbL](https://www.openstreetmap.org/copyright).
