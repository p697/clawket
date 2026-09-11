// Rasterize the same approved vector geometry used by the runtime component.
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const geometry = require('../src/brand/companion.json');
const root = path.resolve(__dirname, '..');

function artwork({ ink, paper, scale = 8.1, transparent = false }) {
  const x = (1024 - geometry.width * scale) / 2;
  const y = (1024 - geometry.height * scale) / 2;
  const parts = geometry.parts.map(p => `<path d="${p.d}" ${p.transform ? `transform="${p.transform}"` : ''}/>`).join('');
  const eyes = geometry.eyes.map(e => `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${e.rx}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${transparent ? '' : `<rect width="1024" height="1024" fill="${paper}"/>`}<g transform="translate(${x} ${y}) scale(${scale})"><g fill="${ink}">${parts}</g><g fill="${paper}">${eyes}</g></g></svg>`;
}

async function main() {
  const sourceDir = path.join(root, 'assets/companion');
  await fs.mkdir(sourceDir, { recursive: true });
  const variants = {
    light: artwork({ ink: '#191b1d', paper: '#ffffff' }),
    dark: artwork({ ink: '#f8f8fa', paper: '#191b1d' }),
    adaptive: artwork({ ink: '#191b1d', paper: '#ffffff', scale: 5.5, transparent: true }),
    splash: artwork({ ink: '#191b1d', paper: '#ffffff', scale: 3.2, transparent: true }),
  };
  for (const [name, svg] of Object.entries(variants)) await fs.writeFile(path.join(sourceDir, `${name}.svg`), svg);
  const outputs = [
    ['light', 'assets/icon.png', 1024], ['light', 'assets/icon-512.png', 512],
    ['light', 'assets/favicon.png', 48], ['light', 'assets/adaptive-icon.png', 1024],
    ['adaptive', 'assets/adaptive-icon-foreground.png', 1024], ['splash', 'assets/splash-icon.png', 1024],
    ['dark', 'assets/app-icons/black/app-icon-black-1024.png', 1024],
    ...Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }).map(([density, size]) => ['dark', `assets/app-icons/black/android/mipmap-${density}/ic_launcher_black.png`, size]),
  ];
  for (const [variant, output, size] of outputs) {
    let image = sharp(Buffer.from(variants[variant])).resize(size, size);
    if (variant === 'light' || variant === 'dark') image = image.removeAlpha();
    await image.png().toFile(path.join(root, output));
  }
  console.log(`Generated ${outputs.length} launcher/splash assets from approved companion A geometry.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
