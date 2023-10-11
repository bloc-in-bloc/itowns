# iTowns Copilot Instructions

## Build, Test & Lint

```bash
npm install                     # install dependencies
npm start                       # dev server at http://localhost:8080 (hot reload)
npm run debug                   # dev server with original source maps (bypasses babel-inline-import-loader)
npm run build                   # production build → dist/
npm run transpile               # ES5 transpile → lib/
npm run lint                    # lint all source files
npm run test                    # full test suite (unit + functional), used by CI
npm run test-unit               # unit tests only
npm run test-unit -- --watch    # unit tests in watch mode
npm run test-functional         # functional tests only (requires build first)
npm run test-with-coverage      # full suite with coverage report
```

**Single unit test file:**
```bash
npm run base-test-unit packages/Main/test/unit/<file>.js
npm run base-test-unit packages/Main/test/unit/<file>.js -- --watch
```

**Single functional test:**
```bash
mocha -t 30000 --require test/hooks_functional.js test/functional/<test_case>.js
```

## Architecture

iTowns is a **monorepo (npm workspaces)** with 4 packages:

| Package | Public | Purpose |
|---|---|---|
| `packages/Geographic` | ✅ | Coordinates, CRS, Extent, Ellipsoid, OrientationUtils (100% TypeScript) |
| `packages/Main` | ✅ | Core framework: rendering, layers, sources, controls, parsing (mixed JS/TS) |
| `packages/Debug` | ❌ | Debugging utilities |
| `packages/Widgets` | ❌ | GUI components |

### Core Concepts

The main abstraction stack in `packages/Main/src/`:

```
View (GlobeView / PlanarView)     # Three.js scene + camera + main loop
  └── Layer                       # What to display (ColorLayer, ElevationLayer, GeometryLayer, ...)
        └── Source                # Where data comes from (WMSSource, FileSource, C3DTilesSource, ...)
              └── Provider        # How data is fetched and scheduled (TileProvider, DataSourceProvider, ...)
                    └── Fetcher   # Low-level HTTP fetching

Controls (GlobeControls, PlanarControls, ...)   # Detachable camera interaction
```

- **Layers** define visualization; **Sources** define data origin — they are separate concerns.
- `View#addLayer(layer)` returns a `Promise` that resolves when the layer is ready.
- All major classes extend `THREE.EventDispatcher`. Use `layer.whenReady` to await initialization.
- `TiledGeometryLayer` drives tile-based subdivision; `zoom.min`/`zoom.max` on a layer controls tile-level visibility.
- `packages/Geographic` is imported as `@itowns/geographic` everywhere in the codebase (alias configured in both Webpack and Babel).

### Key Directories in `packages/Main/src/`

```
Core/         # View, MainLoop, Scheduler, Picking, Feature, Style, Prefab (GlobeView/PlanarView), 3DTiles
Layer/        # All layer types (ColorLayer, ElevationLayer, PointCloudLayer, C3DTilesLayer, ...)
Source/       # All source types (WMS/WMTS/TMS/WFS, File, C3DTiles, Potree, COPC, ...)
Provider/     # Tile/data scheduling and fetching
Controls/     # Camera controls (Globe, Planar, FirstPerson, Fly, Street, VR)
Renderer/     # Three.js shaders, materials, camera, WebXR, LayeredMaterial
Parser/       # Format parsers (3D Tiles, GeoJSON, Vector Tiles, LAS, ...)
Converter/    # Feature → Mesh conversion
Utils/        # DEMUtils, CameraUtils, FeaturesUtils, ...
Worker/       # Web worker implementations
```

## Key Conventions

### TypeScript vs JavaScript
- `packages/Geographic` is **100% TypeScript** — all new code there must be `.ts`.
- `packages/Main` is mixed (~25% TS): newer foundational files use `.ts`; most existing files are `.js`. Follow the pattern of the file you're editing.
- TypeScript is configured in strict mode. The `tsconfig.json` sets `allowJs: true` for interop.

### Code Style
- **4-space indentation**, **no semicolons**, **single quotes**.
- `const`/`let` only — `var` is an ESLint error.
- `one-var: never` — declare each variable in its own statement.
- ESLint extends Airbnb base config. Run `npm run lint` before committing.
- TypeScript files additionally enforce: max line length 100 (code) / 80 (comments), TSDoc syntax.

### JSDoc
- Public API classes and methods require JSDoc with `@property`, `@param`, `@returns`, `@example`.
- `valid-jsdoc` is an ESLint **error** — keep docs consistent with signatures.
- TypeScript files use TSDoc (`/** */` blocks).

### Import Paths
Use bare aliases, never relative paths crossing package boundaries:
```js
import { Coordinates } from '@itowns/geographic';   // Geographic package
import Source from 'Source/Source';                  // within Main (alias = packages/Main/src/)
import Layer from 'Layer/Layer';
```

### Avoid Object Allocations in Hot Paths
A recurring pattern throughout the codebase: reuse objects instead of allocating in methods called each frame. Use class-level static or instance fields for temporary vectors, matrices, etc.

### Test Conventions (Mocha)
- Keep variables in the smallest scope — almost always inside `it()`, not `describe()`.
- Shared setup goes in `before()` inside `describe()`.
- Unit tests live in `packages/*/test/unit/`; functional tests in `test/functional/`.
- Functional tests use Puppeteer (`page.evaluate()`) against built examples. They require a prior `npm run build`.

### Commit Messages (Angular convention)
```
feat: add support for XYZ
fix: resolve coordinate transformation issue
doc: update Layer API reference
refactor: simplify tile scheduling
test: add unit tests for Extent
chore: bump three.js to 0.x
```

### Webpack Aliases (configured in `webpack.config.cjs` and `.eslintrc.cjs`)
```js
'itowns'               → packages/Main/src/Main.js
'@itowns/geographic'   → packages/Geographic/src/index.ts
```
Workers (Potree2Worker, LASLoaderWorker) are bundled as separate entry points.

### `__DEBUG__` Global
Replaced at build time via Babel `minify-replace`. Guards debug-only code paths — do not use in production logic.
