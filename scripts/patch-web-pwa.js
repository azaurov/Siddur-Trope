#!/usr/bin/env node
// Post-build patcher for expo export --platform web.
//
// Expo SDK 56's web export generates index.html from its own template and
// doesn't honor a custom web/index.html. To make the PWA installable
// (required for iOS Safari's "Add to Home Screen" feature) we need:
//   1. <link rel="manifest" href="/manifest.json">
//   2. <link rel="apple-touch-icon" href="/..."> + apple-mobile-web-app meta
//   3. A service worker registration
// This script injects all three into the generated index.html.
//
// Usage: node scripts/patch-web-pwa.js [dist-dir] [base-path]
// Default dist-dir is `dist/`, default base-path is `/`.
// For GitHub Pages: node scripts/patch-web-pwa.js dist /Siddur-Trope

const fs = require("fs");
const path = require("path");

const distDir = path.resolve(process.argv[2] || "dist");
const basePath = (process.argv[3] || "").replace(/\/$/, ""); // strip trailing slash
const indexPath = path.join(distDir, "index.html");

if (!fs.existsSync(indexPath)) {
  console.error(`[patch-web-pwa] No index.html at ${indexPath}`);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, "utf8");

// 1. Inject PWA meta tags + manifest link + apple-touch-icon into <head>.
const headInjection = `
    <link rel="manifest" href="${basePath}/manifest.json" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="SiddurTrope" />
    <meta name="mobile-web-app-capable" content="yes" />
    <link rel="apple-touch-icon" href="${basePath}/favicon.ico" />`;

if (!html.includes('rel="manifest"')) {
  html = html.replace(/<\/head>/i, `${headInjection}\n  </head>`);
}

// 2. Inject service worker registration before </body>.
const swScript = `
    <script>
      if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('${basePath}/sw.js').catch((err) => {
            console.warn('[PWA] service worker registration failed:', err);
          });
        });
      }
    </script>`;

if (!html.includes("serviceWorker.register")) {
  html = html.replace(/<\/body>/i, `${swScript}\n  </body>`);
}

fs.writeFileSync(indexPath, html);
console.log(`[patch-web-pwa] Patched ${indexPath}`);
console.log(`[patch-web-pwa]   - manifest link: ${html.includes('rel="manifest"')}`);
console.log(`[patch-web-pwa]   - apple-touch-icon: ${html.includes('rel="apple-touch-icon"')}`);
console.log(`[patch-web-pwa]   - service worker: ${html.includes("serviceWorker.register")}`);