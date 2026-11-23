// Fail when the committed Music Studio bundle does not match a fresh build.
// Run after `npm run build` in music-studio-src; never rewrites tracked files.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const built = 'music-studio-src/dist/assets';
const deployed = 'music-studio/assets';
const htmlPath = 'music-studio/index.html';

if (!existsSync(built)) {
  console.error('Music Studio build output is missing. Run npm run build in music-studio-src first.');
  process.exit(1);
}

const assetPattern = /^index-[A-Za-z0-9_-]+\.(?:js|css)$/;
const builtAssets = readdirSync(built).filter(name => assetPattern.test(name)).sort();
const deployedAssets = readdirSync(deployed).filter(name => assetPattern.test(name)).sort();
const html = readFileSync(htmlPath, 'utf8');

if (!builtAssets.length) {
  console.error('The Music Studio build produced no index-*.js/css assets.');
  process.exit(1);
}

let failed = false;
for (const name of builtAssets) {
  const deployedPath = join(deployed, name);
  if (!html.includes(`./assets/${name}`)) {
    console.error(`${htmlPath} does not reference the fresh build asset ${name}.`);
    failed = true;
    continue;
  }
  if (!existsSync(deployedPath)) {
    console.error(`The committed bundle is missing ${name}.`);
    failed = true;
    continue;
  }
  if (!readFileSync(join(built, name)).equals(readFileSync(deployedPath))) {
    console.error(`${deployedPath} does not match the fresh build.`);
    failed = true;
  }
}

for (const name of deployedAssets) {
  if (!builtAssets.includes(name)) {
    console.error(`The committed bundle has a stale asset: ${name}.`);
    failed = true;
  }
}

if (failed) {
  console.error('Rebuild music-studio-src, copy its assets into music-studio/assets and update music-studio/index.html.');
  process.exit(1);
}

console.log(`Music Studio bundle is in sync (${builtAssets.join(', ')}).`);
