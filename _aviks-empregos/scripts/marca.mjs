/**
 * Marca do Aviks Empregos: o MESMO símbolo e a mesma tipografia do Aviks (copiado de
 * estetic-pro/apps/web/scripts/brand.mjs), na paleta cinza do Empregos.
 * Gera a identidade visual a partir de uma única fonte (este arquivo):
 *   - ícone (SVG, PNGs 16–1024, maskable, apple-touch, .ico do Windows)
 *   - logotipos horizontal e vertical (SVG + PNG), com o texto convertido em curvas
 *
 * Símbolo oficial: "A" com um "V" sobreposto. Aqui: "A" grafite, "V" prata, fundo cinza-claro.
 *
 * Uso: npm run marca
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = process.env.BRAND_OUT ?? join(here, '..', 'public');
const brandDir = join(publicDir, 'marca');

// Paleta cinza do Aviks Empregos (os nomes das chaves seguem o script original).
const C = {
  green: '#3F4349',      // grafite
  greenLight: '#62676E',
  greenDark: '#25282C',
  gold: '#AEB3BA',       // prata
  goldLight: '#E6E8EB',
  goldDark: '#848A92',
  cream: '#F5F6F7',      // fundo
  creamDark: '#E4E6E9',
  ink: '#2F3337',        // texto
};

// ---------------------------------------------------------------------------
// Símbolo oficial: "A" verde com um "V" dourado sobreposto (AV de Aviks)
// ---------------------------------------------------------------------------

/** Em fundo escuro (`dark`), o "A" fica creme; o "V" continua dourado. */
const defs = (id, dark = false) => `
  <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${C.cream}"/>
    <stop offset="1" stop-color="${C.creamDark}"/>
  </linearGradient>
  <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${C.goldLight}"/>
    <stop offset=".5" stop-color="${C.gold}"/>
    <stop offset="1" stop-color="${C.goldDark}"/>
  </linearGradient>
  <linearGradient id="${id}-green" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${dark ? '#FFFFFF' : C.greenLight}"/>
    <stop offset=".55" stop-color="${dark ? C.cream : C.green}"/>
    <stop offset="1" stop-color="${dark ? C.creamDark : C.greenDark}"/>
  </linearGradient>
  <filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="${C.greenDark}" flood-opacity=".18"/>
  </filter>`;

/** Mesmos desenhos de src/lib/brand.ts (A_PATH e V_PATH). */
const A_PATH =
  'M232 112 Q242 98 260 98 Q280 98 288 112 L449 398 Q454 408 466 410 L466 412 H362 L362 410 Q376 406 372 392 L276 190 Q256 148 236 190 L152 388 Q148 404 160 406 Q176 408 192 410 L192 412 H46 L46 410 Q58 408 62 398 Z';
const V_PATH =
  'M114 250 Q160 243 240 246 L262 370 L344 262 Q372 247 412 248 Q392 255 380 268 L274 408 Q266 418 258 408 L178 274 Q164 256 114 250 Z';

/** Símbolo no espaço 512×512 (ocupa x 46–466, y 98–412); `gap` = cor do fundo, que contorna o "V". */
const mark = (id, gap = C.cream) => `
  <g filter="url(#${id}-shadow)">
    <path fill="url(#${id}-green)" d="${A_PATH}"/>
    <path fill="url(#${id}-gold)" stroke="${gap}" stroke-width="6" stroke-linejoin="round" d="${V_PATH}"/>
  </g>`;

function iconSvg({ size = 512, maskable = false } = {}) {
  const id = maskable ? 'm' : 'i';
  if (maskable) {
    // Ícone "maskable": fundo cheio e símbolo dentro da zona segura (80%).
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>${defs(id)}</defs>
  <rect width="512" height="512" fill="url(#${id}-bg)"/>
  <g transform="translate(256 255) scale(.72) translate(-256 -255)">${mark(id, C.cream)}</g>
</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>${defs(id)}</defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#${id}-bg)"/>
  <g transform="translate(256 262) scale(.9) translate(-256 -255)">${mark(id, C.cream)}</g>
</svg>`;
}

/** Símbolo sem fundo (logotipos); `gap` = cor do fundo onde será usado. */
const markSvg = (id, gap, dark = false) => `<defs>${defs(id, dark)}</defs>${mark(id, gap)}`;
/** Recorte quadrado em volta do símbolo, para encaixá-lo nos logotipos. */
const MARK_BOX = '36 35 440 440';

// ---------------------------------------------------------------------------
// Logotipo: texto convertido em curvas
// ---------------------------------------------------------------------------

const font = (pkg, file) => {
  const buf = readFileSync(require.resolve(`${pkg}/files/${file}`));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const greek = font('@fontsource/manrope', 'manrope-greek-500-normal.woff');
const light = font('@fontsource/manrope', 'manrope-latin-300-normal.woff');
const regular = font('@fontsource/manrope', 'manrope-latin-500-normal.woff');

/** Texto → path SVG, com espaçamento extra entre letras. "Λ" vem da fonte grega (A sem barra). */
function textPath(fontFile, text, size, x, y, letterSpacing = 0) {
  let cursor = x;
  const parts = [];
  for (const char of text) {
    const source = char === 'Λ' ? greek : fontFile;
    const glyph = source.charToGlyph(char);
    parts.push(glyph.getPath(cursor, y, size).toPathData(2));
    cursor += (glyph.advanceWidth / source.unitsPerEm) * size + letterSpacing;
  }
  return { d: parts.join(' '), width: cursor - x - letterSpacing };
}

function wordmark(x, baseline, size, fill) {
  const alpha = textPath(regular, 'ΛVIKS', size, x, baseline, size * 0.12);
  const space = size * 0.32;
  const produto = textPath(light, 'EMPREGOS', size, x + alpha.width + space, baseline, size * 0.06);
  return { svg: `<path fill="${fill}" d="${alpha.d} ${produto.d}"/>`, width: alpha.width + space + produto.width };
}

const TAGLINE = 'SUA CARREIRA NO PILOTO AUTOMÁTICO';

/** Frase com filetes dourados dos dois lados, centrada em `centerX`. */
function tagline(size, centerX, baseline, spacing, fill) {
  const measure = textPath(regular, TAGLINE, size, 0, 0, spacing);
  const start = centerX - measure.width / 2;
  const line = size * 3.2;
  const gap = size * 1.2;
  const y = baseline - size * 0.36;
  return `<path fill="${fill}" d="${textPath(regular, TAGLINE, size, start, baseline, spacing).d}"/>
  <path stroke="${C.gold}" stroke-width="${Math.max(1.5, size / 9)}" d="M${start - gap - line} ${y} H${start - gap} M${start + measure.width + gap} ${y} H${start + measure.width + gap + line}"/>`;
}


function logoHorizontal({ fill = C.ink, gap = C.cream, dark = false } = {}) {
  const iconSize = 150;
  const space = 22;
  const word = wordmark(iconSize + space, 96, 74, fill);
  const width = Math.ceil(iconSize + space + word.width + 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${iconSize}" viewBox="0 0 ${width} ${iconSize}">
  <svg x="0" y="0" width="${iconSize}" height="${iconSize}" viewBox="${MARK_BOX}">${markSvg(dark ? 'hd' : 'h', gap, dark)}</svg>
  ${word.svg}
  ${tagline(13.5, iconSize + space + word.width / 2, 132, 3.6, fill)}
</svg>`;
}

function logoStacked({ fill = C.ink, gap = C.cream } = {}) {
  const width = 1000;
  const iconSize = 340;
  const size = 104;
  const probe = wordmark(0, 0, size, fill);
  const word = wordmark((width - probe.width) / 2, iconSize + 120, size, fill);
  const height = iconSize + 220;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <svg x="${(width - iconSize) / 2}" y="0" width="${iconSize}" height="${iconSize}" viewBox="${MARK_BOX}">${markSvg('v', gap)}</svg>
  ${word.svg}
  ${tagline(22, width / 2, iconSize + 186, 7, fill)}
</svg>`;
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

const png = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();

/** Arquivo .ico com imagens PNG embutidas (formato aceito pelo Windows Vista+). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

await mkdir(brandDir, { recursive: true });

const icon = iconSvg();
const maskable = iconSvg({ maskable: true });
const horizontal = logoHorizontal();
const stacked = logoStacked();

const files = {
  'favicon.svg': icon,
  'marca/icon.svg': icon,
  'marca/logo-horizontal.svg': horizontal,
  // Versão para fundo grafite (tela de entrar e modo escuro): texto e "A" claros.
  'marca/logo-horizontal-claro.svg': logoHorizontal({ fill: '#FFFFFF', gap: C.green, dark: true }),
  'marca/logo-vertical.svg': stacked,
};
for (const [name, content] of Object.entries(files)) await writeFile(join(publicDir, name), content);

for (const size of [16, 32, 48, 64, 128, 192, 256, 512, 1024]) await writeFile(join(brandDir, `icon-${size}.png`), png(icon, size));
await writeFile(join(brandDir, 'icon-maskable-512.png'), png(maskable, 512));
await writeFile(join(publicDir, 'apple-touch-icon.png'), png(maskable, 180));
await writeFile(join(brandDir, 'logo-horizontal.png'), png(horizontal, 1600));
await writeFile(join(brandDir, 'logo-vertical.png'), png(stacked, 1800));
/**
 * Imagem DIB 32 bits (BGRA + máscara), o formato clássico do .ico. O Explorer do
 * Windows nem sempre lê PNG embutido nos tamanhos pequenos (ícone em branco no atalho).
 */
function dib(svg, size) {
  const rgba = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().pixels;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // altura dobrada: imagem + máscara
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = ((size - 1 - y) * size + x) * 4; // linhas de baixo para cima
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size); // transparência vem do canal alfa
  return Buffer.concat([header, pixels, mask]);
}

await writeFile(
  join(publicDir, 'favicon.ico'),
  ico([16, 24, 32, 48, 64, 256].map((size) => ({ size, data: size >= 256 ? png(icon, size) : dib(icon, size) }))),
);

console.log(`Marca gerada em ${publicDir} (favicon, ícones e logotipos).`);
