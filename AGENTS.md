# Project Overview

iTowns is a Three.js-based framework written in Javascript/WebGL for visualizing 3D geospatial data. It can connect to WMS/WMTS/TMS servers including elevation data and load many different data formats (3dTiles, GeoJSON, Vector Tiles, GPX and much more).

The project is organized as a **monorepo using npm workspaces** with the following packages:
- `packages/Geographic` (public): Utilities for handling coordinates, ellipsoids, extents and rotations across different coordinate systems
- `packages/Main` (public): Core features that haven't yet been moved to sub-modules
- `packages/Debug` (private): iTowns debugging utilities
- `packages/Widgets` (private): Graphic user interface for iTowns

**Tech Stack:**
- JavaScript/TypeScript
- Three.js (WebGL)
- Node.js (10+) and npm (6.x+)
- Webpack for bundling
- Babel for transpilation
- Mocha for testing
- Puppeteer for functional tests

## Build & Commands

### Installation
```bash
npm install
```

### Development
```bash
# Start development server (with hot reload)
npm start
# Opens at http://localhost:8080/
# Change port: npm start -- --port 3000

# Debug mode (with original source maps)
npm run debug

# Watch mode (auto-transpile on changes)
npm run watch
```

### Building
```bash
# Build for production (creates dist/ folder)
npm run build

# Build for development
npm run build-dev

# Transpile to ES5 (creates lib/ folder)
npm run transpile
```

### Testing
```bash
# Run all tests (unit + functional) - used by CI
npm run test

# Run all tests in development mode
npm run test-dev

# Run unit tests only
npm run test-unit

# Run functional tests only (requires build first)
npm run test-functional

# Run tests with coverage
npm run test-with-coverage

# Run specific functional test
mocha -t 30000 --require test/hooks_functional.js test/functional/<test_case>.js

# Continuous unit testing
npm run test-unit -- --watch
```

### Linting
```bash
# Lint all code
npm run lint
```

### Documentation
```bash
# Generate documentation
npm run doc

# Lint documentation
npm run doclint
```

## Code Style

### General Rules
- Search and use existing methods to avoid duplicate code
- Avoid instance `class/object` in method (optimization with the garbage collector)
- Give explicit names to constants
- Avoid duplicate code and encapsulate to simplify
- For performance reasons, update objects only when needed
- Don't add dead code
- Remove obsolete comments

### Formatting & Linting
- **Indentation**: 4 spaces
- **ESLint**: Uses Airbnb base config with custom rules
- **TypeScript**: Strict mode enabled with TypeScript ESLint rules
- **Line length**: 100 characters for code, 80 for comments (TypeScript files)
- Use single quotes (where enforced by linter)
- No semicolons (project preference)
- `one-var`: error - never use multiple variable declarations
- `no-var`: error - use `let` or `const` instead

### File Structure
- Source files in `packages/*/src/`
- Compiled output in `packages/*/lib/` (after transpile)
- Examples in `examples/`
- Tests in `packages/*/test/unit/` and `test/functional/`

### Code Organization
- Keep variables in the smallest scope (prefer `it()` scope in tests)
- Use functional patterns where possible
- TypeScript files should follow TSDoc conventions

## Testing

### Test Types
- **Unit tests**: Located in `packages/*/test/unit/`, use Mocha
- **Functional tests**: Located in `test/functional/`, test examples in browser with Puppeteer

### Test Environment Variables
- `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`: Define proxy settings
- `SCREENSHOT_FOLDER`: Take screenshots at end of each test
- `CHROME`: Path to Chrome executable
- `DEBUG`: Run Chrome in window with debug tools open
- `REMOTE_DEBUGGING`: Enable remote debugging on specified port

### Test Conventions
- Use [Mocha](https://mochajs.org/) for both unit and functional tests
- Keep variables in smallest scope (usually in `it()` section)
- Use `before()` sections for shared setup within a `describe()` block
- Tests should be fast and independent

### Important Notes
- Chrome in headless mode doesn't support WebGL `EXT_frag_depth` extension
- Rendering may differ in headless mode
- Some bugs may only be present in headless mode

## Pull Request Instructions

### Pre-submission Checklist
1. ✅ Code passes linter: `npm run lint`
2. ✅ All tests pass: `npm run test`
3. ✅ Git history is clean (rebase on `master`)
4. ✅ Commit messages follow Angular convention

### Commit Message Convention
Follow the [Angular commit convention](https://github.com/bcoe/conventional-changelog-standard/blob/master/convention.md):

**Format:** `<type>: <subject>`

**Supported types:**
- `feat`, `features`, `feature`: Feature addition
- `fix`: Bug fix
- `perf`: Performance improvements
- `revert`: Undo operation
- `doc`, `docs`: Documentation changes
- `refactor`, `refacto`, `refactoring`: Code refactoring
- `test`, `tests`: Test-related changes
- `chore`, `rename`, `workflow`: Package versions, dependency updates, file renaming, workflow changes
- `example`, `examples`: Changes to examples or new examples

**Example:**
```
feat: add support for 3D tiles point clouds
fix: resolve coordinate transformation issue
doc: update contributing guide
```

### PR Guidelines
- **For major changes**: Open an issue first to discuss
- **For small features/bug fixes**: Can open PR directly
- **Include issue links**: If fixing an issue, link to it in the description
- **Add to CONTRIBUTORS.md**: If first contribution, add your name
- **Reference documentation**: Include JSDoc for new API identifiers
- **Provide demos**: If adding significant features, provide a demo
- **Update LICENSE.md**: If adding third-party libraries
- **Split PRs**: Don't mix features from different scopes
- **Squash commits**: Commits with the same scope should be squashed

### PR Labels
- Use `in progress` label if PR needs additional work
- Include task lists for complex PRs
- Consider splitting large PRs into smaller ones

## Monorepo Structure

### Package Management
- Uses npm workspaces
- Run commands across all workspaces with `--workspaces` flag
- Each package has its own `package.json` and `tsconfig.json`
- Shared dependencies in root `package.json`

### Package Commands
```bash
# Run command in all workspaces
npm run <command> --workspaces

# Run command in specific workspace
npm run <command> --workspace packages/Main
```

## Development Notes

### Debugging
- Use `npm run debug` for source map debugging (bypasses `babel-inline-import-loader`)
- For debugging in your own project: use `npm link` and `npm run watch`
- Browser DevTools: Chrome DevTools for WebGL debugging

### Release Process
- Generate changelog: `npm run changelog`
- Bump version: `npm run bump --level=minor` (or major/patch)
- Pre-release for next: `npm run prerelease-next`
- Publish next: `npm run publish-next`
- Publish latest: `npm run publish-latest`

### Proxies
If working behind a proxy, set environment variables:
- `HTTP_PROXY`
- `HTTPS_PROXY`
- `NO_PROXY`

### Browser Compatibility
Target browsers: Last two major versions of:
- Firefox
- Safari
- Chromium-based browsers (Chrome, Edge, etc.)

Requires WebGL 2.0 support.

## Security & IP

- **License**: Dual-licensed under CeCILL-B v1.0 and MIT
- **IP Review**: Ensure all rights to code and no patent restrictions
- **Third-party libraries**: Must update LICENSE.md when adding new dependencies

## Resources

- **Documentation**: http://www.itowns-project.org/itowns/docs/
- **Examples**: http://www.itowns-project.org/itowns/examples/
- **Issues**: https://github.com/iTowns/itowns/issues
- **Discussions**: https://github.com/iTowns/itowns/discussions
- **Mailing lists**: 
  - Developer: https://lists.osgeo.org/mailman/listinfo/itowns-dev
  - User: https://lists.osgeo.org/mailman/listinfo/itowns-user
