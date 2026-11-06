// Regenerates the ASSETS list in sw.js from the files in the repo (run after adding files).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => fs.readdirSync(path.join(repo, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = ['index.html', 'styles.css', 'manifest.webmanifest'].concat(walk('icons'), walk('js'), walk('samples'), ['vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs']).map((f) => './' + f.split(path.sep).join('/'));
const sw = fs.readFileSync(path.join(repo, 'sw.js'), 'utf8').replace(/const ASSETS = \[[^\]]*\];/, 'const ASSETS = ' + JSON.stringify(['./'].concat(files)) + ';');
fs.writeFileSync(path.join(repo, 'sw.js'), sw); console.log(files.length + 1, 'assets');
