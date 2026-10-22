# Dashboard layout regression

Uses the actual embedded HTML, CSS and JavaScript with fixture API responses; no running AID server or real task mutations are required.

Install Playwright in a temporary directory and run from the repository root:

```sh
npm install --prefix /tmp/aid-browser-tests playwright
NODE_PATH=/tmp/aid-browser-tests/node_modules node scripts/test-dashboard-layout.cjs
```

Use Playwright's installed Chromium (`npx playwright install chromium` in the temporary directory), or set `CHROME_PATH` to an existing Chromium/Chrome executable.

Checks desktop and mobile first-row hit targets, mixed task statuses, horizontal scrolling and navigation to the first task detail. `node scripts/test-dashboard-layout.cjs red` injects the original 49px offset and must fail with `First row obscured by header` (exit 1).
