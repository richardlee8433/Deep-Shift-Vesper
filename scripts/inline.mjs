// Bundle each page in dist/ into a single self-contained file for sharing as one file:
// dist/vesper.html (idle game) and dist/vesper-dig.html (dig prototype).
// The output omits doctype/html/head/body so it can be published as an Artifact page.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const pages = [
  ['index.html', 'vesper.html'],
  ['dig.html', 'vesper-dig.html'],
];

for (const [src, out] of pages) {
  const html = readFileSync(join(dist, src), 'utf8');
  if (/<link rel="modulepreload"/.test(html)) throw new Error(`${src} has shared chunks; keep the pages independent so they inline cleanly`);

  const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)]
    .map((m) => readFileSync(join(dist, m[1]), 'utf8'))
    .join('\n');
  const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g)]
    .map((m) => readFileSync(join(dist, m[1]), 'utf8'))
    .join('\n')
    .replace(/<\/script/gi, '<\\/script');

  const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
  const fonts = [...html.matchAll(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts[^>]*>/g)].map((m) => m[0]).join('\n');
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();

  const page = `${title}
${fonts}
<style>
${css}
</style>
${body}
<script type="module">
${js}
</script>
`;
  writeFileSync(join(dist, out), page);
  console.log(`dist/${out} ${(page.length / 1024).toFixed(1)} KB`);
}
