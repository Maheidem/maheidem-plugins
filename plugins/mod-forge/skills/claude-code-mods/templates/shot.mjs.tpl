// shot.mjs: open the storyboard player in Chrome, take a PNG, press one key, print where the player goes.
// mods_live.gen_shot writes this file from templates/shot.mjs.tpl. Each __NAME__ is replaced by a JSON string.
// Run it with: node shot.mjs
// Last line: player: #<node>, key <journey key> -> <location.hash after the key>, errors <JSON list>
import { chromium } from __PLAYWRIGHT__;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(__URL__);
await page.addStyleTag({ content: '.hot{outline:2px solid #f0f !important}' }); // make the hotspots visible in the PNG
await page.waitForTimeout(800);
await page.screenshot({ path: __PNG__ });
await page.keyboard.press(__KEY__);
await page.waitForTimeout(500);
const hash = await page.evaluate(() => location.hash);
console.log('player: #' + __NODE__ + ', key ' + __LABEL__ + ' -> ' + hash + ', errors ' + JSON.stringify(errors));
await browser.close();
