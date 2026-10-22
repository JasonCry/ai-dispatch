const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STATIC_DIR = path.join(__dirname, '../src/ui/web/static');
const CHROME_PATH = process.env.CHROME_PATH;

const tasks = [
  { id: 't-8e774e33', agent: 'opencode-desktop', status: 'running', created_at: new Date().toISOString(), prompt: 'First task visibility regression', requested_model: 'minimax-cn/MiniMax-M3.1-Flash', duration_ms: 12000, tokens: 450, cost_usd: 0.02 },
  { id: 't-done-2', agent: 'codex', status: 'done', created_at: new Date(Date.now() - 60000).toISOString(), prompt: 'Done task verify', duration_ms: 45000, tokens: 1200, cost_usd: 0.05 },
  { id: 't-failed-3', agent: 'claude', status: 'failed', created_at: new Date(Date.now() - 120000).toISOString(), prompt: 'Failed task test', latest_error: 'Connection timeout', duration_ms: 5000, tokens: 100, cost_usd: 0 },
  { id: 't-stopped-4', agent: 'qwen', status: 'stopped', created_at: new Date(Date.now() - 180000).toISOString(), prompt: 'Stopped task test', duration_ms: 8000, tokens: 200, cost_usd: 0.01 },
  { id: 't-pending-5', agent: 'droid', status: 'pending', created_at: new Date(Date.now() - 240000).toISOString(), prompt: 'Pending task test' }
];

async function runTest(label, cssOverride = null) {
  console.log(`\n=== Running Test: ${label} ===`);
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    for (const viewport of [{ name: 'Desktop', width: 1440, height: 900 }, { name: 'Mobile', width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });

      await page.route('http://aid.test/**', route => {
        const url = new URL(route.request().url());
        const pathname = url.pathname;

        if (pathname === '/api/events') {
          return route.fulfill({ contentType: 'text/event-stream', body: ': ready\n\n' });
        }
        if (pathname === '/api/tasks') {
          return route.fulfill({ json: tasks });
        }
        if (pathname.startsWith('/api/tasks/')) {
          const id = decodeURIComponent(pathname.replace('/api/tasks/', '').split('/')[0]);
          const found = tasks.find(t => t.id === id) || tasks[0];
          if (pathname.endsWith('/events')) return route.fulfill({ json: [] });
          if (pathname.endsWith('/output')) return route.fulfill({ json: { output: 'Sample task output' } });
          if (pathname.endsWith('/diff')) return route.fulfill({ json: { diff: '--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+new' } });
          return route.fulfill({ json: found });
        }
        if (pathname === '/api/usage') {
          return route.fulfill({ json: { agents: [{ agent: 'codex', task_count: 5, success_rate: 0.8, avg_cost: 0.04 }] } });
        }

        const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
        const filePath = path.join(STATIC_DIR, filename);

        if (filename === 'style.css' && cssOverride !== null) {
          return route.fulfill({ body: cssOverride, contentType: 'text/css' });
        }

        if (fs.existsSync(filePath)) {
          const contentType = filename.endsWith('.css') ? 'text/css'
            : filename.endsWith('.js') ? 'text/javascript'
            : filename.endsWith('.svg') ? 'image/svg+xml'
            : 'text/html';
          return route.fulfill({ body: fs.readFileSync(filePath), contentType });
        }

        return route.fulfill({ status: 404, body: 'Not found' });
      });

      await page.goto('http://aid.test/');
      await page.waitForSelector('.task-row');
      await page.waitForTimeout(250); // Let the 200ms entry animation finish.

      // Check all task rows rendered for multiple statuses
      const renderedCount = await page.locator('.task-row').count();
      if (renderedCount !== tasks.length) {
        throw new Error(`Expected ${tasks.length} rows, found ${renderedCount}`);
      }

      // Check bounding rects and hit testing on the first row
      const firstRowAnalysis = await page.evaluate(() => {
        const row = document.querySelector('.task-row');
        const thead = document.querySelector('thead');
        const theadRect = thead.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();

        const cells = Array.from(row.cells).map((cell, idx) => {
          const r = cell.getBoundingClientRect();
          // If cell is offscreen horizontally in viewport, check if it's within scrollable table
          const cx = (Math.max(r.left, 16) + Math.min(r.right, window.innerWidth - 16)) / 2;
          const cy = r.top + r.height / 2;
          const hitElement = document.elementFromPoint(cx, cy);
          const isContained = cell.contains(hitElement);
          return {
            idx,
            text: cell.textContent.trim(),
            rect: { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right },
            hitTagName: hitElement ? hitElement.tagName : 'NONE',
            hitText: hitElement ? hitElement.textContent.trim() : 'NONE',
            hitContained: isContained,
            inViewport: r.right > 16 && r.left < window.innerWidth - 16
          };
        });

        return {
          theadBottom: theadRect.bottom,
          rowTop: rowRect.top,
          overlap: rowRect.top < theadRect.bottom,
          cells
        };
      });

      console.log(`[${viewport.name}] First row evaluation:`);
      console.log(`  theadBottom: ${firstRowAnalysis.theadBottom}, rowTop: ${firstRowAnalysis.rowTop}`);
      firstRowAnalysis.cells.slice(0, 4).forEach(c => {
        console.log(`  Cell[${c.idx}] "${c.text}": hit=${c.hitContained} (hitTag=${c.hitTagName}, hitText="${c.hitText}")`);
      });

      const obscuredCells = firstRowAnalysis.cells.filter(c => c.inViewport && !c.hitContained);
      if (obscuredCells.length > 0) {
        throw new Error(`First row obscured by header! Obscured cells: ${obscuredCells.map(c => `[${c.idx}]: ${c.text} (covered by ${c.hitTagName} "${c.hitText}")`).join(', ')}`);
      }

      // Verify horizontal scroll
      const scrollResult = await page.evaluate(() => {
        const wrap = document.querySelector('.task-table-wrap');
        const maxScroll = wrap.scrollWidth - wrap.clientWidth;
        if (maxScroll > 0) {
          wrap.scrollLeft = maxScroll;
          return { canScroll: true, scrolledLeft: wrap.scrollLeft, maxScroll };
        }
        return { canScroll: false, scrolledLeft: 0, maxScroll: 0 };
      });
      console.log(`  Horizontal scroll check: canScroll=${scrollResult.canScroll}, scrolledLeft=${scrollResult.scrolledLeft}/${scrollResult.maxScroll}`);

      if (scrollResult.canScroll) {
        // After full horizontal scroll, test that the right-most cell (Prompt) is in viewport and hit-testable
        const scrolledHit = await page.evaluate(() => {
          const row = document.querySelector('.task-row');
          const lastCell = row.cells[row.cells.length - 1]; // Prompt cell
          const r = lastCell.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const hitElement = document.elementFromPoint(cx, cy);
          return {
            text: lastCell.textContent.trim(),
            hit: lastCell.contains(hitElement),
            hitTag: hitElement ? hitElement.tagName : 'NONE',
            rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
          };
        });
        console.log(`  Scrolled cell check: "${scrolledHit.text}" -> hit=${scrolledHit.hit} (tag=${scrolledHit.hitTag}, rect=${JSON.stringify(scrolledHit.rect)})`);
        if (!scrolledHit.hit) {
          throw new Error(`Scrolled cell obscured: ${scrolledHit.text} covered by ${scrolledHit.hitTag}`);
        }
        // Restore scroll position
        await page.evaluate(() => { document.querySelector('.task-table-wrap').scrollLeft = 0; });
      }

      // Verify first row hit target and task navigation
      await page.locator('.task-row td').first().click();
      await page.waitForURL('**/#/task/t-8e774e33');
      await page.waitForSelector('.detail-id');
      const detailId = await page.locator('.detail-id').textContent();
      if (detailId !== 't-8e774e33') {
        throw new Error(`Navigation failed: expected task t-8e774e33, got ${detailId}`);
      }
      console.log(`  Task navigation PASS -> loaded detail for ${detailId}`);

      await page.close();
    }
    console.log(`>>> RESULT: ${label} PASSED <<<`);
    return true;
  } catch (err) {
    console.error(`>>> RESULT: ${label} FAILED: ${err.message} <<<`);
    return false;
  } finally {
    await browser.close();
  }
}

(async () => {
  const rawCss = fs.readFileSync(path.join(STATIC_DIR, 'style.css'), 'utf8');

  // If argument is "reproduce-red", test with top: 49px (original bug)
  if (process.argv[2] === 'red') {
    const redCss = rawCss.includes('top: 49px;') ? rawCss : rawCss.replace(/(\.task-table th \{[^}]*?top:)\s*0;/, '$1 49px;');
    const passed = await runTest('Unpatched (top: 49px RED)', redCss);
    process.exit(passed ? 0 : 1);
  }

  // Otherwise, test the current style.css
  const passed = await runTest('Current style.css', null);
  process.exit(passed ? 0 : 1);
})();
