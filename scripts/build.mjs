// Draws every image the profile README uses, in both GitHub themes.
//
// Text is converted to outlines because GitHub serves SVGs through <img>, where
// no web font loads. Colours and type follow brandtstack's DESIGN.md: one dawn
// (night for dark theme, day for light), condensed caps for plot lettering,
// amber only for "in service" and the contact action.
//
//   npm run build            -> writes assets/*.svg
//   npm run build -- --org   -> also writes the org profile's assets to ../brandtstack-github/profile/assets

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = (pkg) => join(root, 'node_modules', '@fontsource', pkg, 'files');
const load = (pkg, file) => {
    const buf = readFileSync(join(fontDir(pkg), file));
    return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

const F = {
    plot600: load('big-shoulders', 'big-shoulders-latin-600-normal.woff'),
    plot700: load('big-shoulders', 'big-shoulders-latin-700-normal.woff'),
    plot800: load('big-shoulders', 'big-shoulders-latin-800-normal.woff'),
    work400: load('archivo', 'archivo-latin-400-normal.woff'),
    work500: load('archivo', 'archivo-latin-500-normal.woff'),
};

const C = {
    night: '#06070c',
    deep: '#0b1330',
    cobalt: '#17307a',
    horizon: '#3a4a9c',
    rose: '#b06a80',
    blush: '#e0a08f',
    day: '#f4f1ec',
    inkBright: '#f6f3ec',
    inkDim: '#b9bed4',
    inkDark: '#14161c',
    inkDarkDim: '#23262f',
    gel: '#ffb020',
    gelInk: '#2a1a00',
};

/** Per-theme ink. Dark GitHub is the night band; light GitHub is the day band. */
const THEME = {
    dark: { ink: C.inkBright, quiet: C.inkDim, machinery: '#ffffff', rule: 'rgba(246,243,236,0.28)' },
    light: { ink: C.inkDark, quiet: C.inkDarkDim, machinery: '#14161c', rule: 'rgba(20,22,28,0.3)' },
};

// ---------------------------------------------------------------- text → path

/**
 * Serialises a glyph path. Not opentype's toPathData: in 2.0 its number
 * formatting writes NaN for float-noise inputs like 516.5800000000002, which
 * silently truncates the rest of the <path> in the browser.
 */
function pathData(path) {
    const n = (v) => {
        if (!Number.isFinite(v)) throw new Error(`non-finite path coordinate: ${v}`);
        return String(Math.round(v * 100) / 100);
    };
    return path.commands
        .map((c) => {
            switch (c.type) {
                case 'M':
                case 'L':
                    return `${c.type}${n(c.x)} ${n(c.y)}`;
                case 'Q':
                    return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
                case 'C':
                    return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
                case 'Z':
                    return 'Z';
                default:
                    throw new Error(`unknown path command ${c.type}`);
            }
        })
        .join('');
}

/** Lays out one line and returns its outline and advance width. Tracking is in em. */
function text(font, str, x, y, size, { tracking = 0 } = {}) {
    const scale = size / font.unitsPerEm;
    // charToGlyph, not stringToGlyphs: opentype.js 2.0 throws on these fonts' contextual (GSUB 6.2) lookups.
    const chars = [...str];
    const glyphs = chars.map((ch) => font.charToGlyph(ch));
    let pen = x;
    const parts = [];
    glyphs.forEach((g, i) => {
        if (g.index === 0) {
            // Neither face ships an arrow, so → is drawn: a stem and a chevron at cap mid-height.
            if (chars[i] !== '→') throw new Error(`no glyph for ${JSON.stringify(chars[i])} in ${font.names.fullName?.en}`);
            const w = size * 0.9;
            const mid = y - size * 0.34;
            const sw = size * 0.075;
            const head = size * 0.2;
            const a = pen + size * 0.1;
            const b = a + w - size * 0.2;
            parts.push(
                `M${a.toFixed(2)} ${(mid - sw / 2).toFixed(2)}H${(b - sw).toFixed(2)}V${(mid + sw / 2).toFixed(2)}H${a.toFixed(2)}Z` +
                    `M${(b - head).toFixed(2)} ${(mid - head).toFixed(2)}L${b.toFixed(2)} ${mid.toFixed(2)}L${(b - head).toFixed(2)} ${(mid + head).toFixed(2)}L${(b - head - sw * 1.2).toFixed(2)} ${(mid + head).toFixed(2)}L${(b - sw * 1.2).toFixed(2)} ${mid.toFixed(2)}L${(b - head - sw * 1.2).toFixed(2)} ${(mid - head).toFixed(2)}Z`,
            );
            pen += w;
            if (i < glyphs.length - 1) pen += tracking * size;
            return;
        }
        parts.push(pathData(g.getPath(pen, y, size)));
        pen += g.advanceWidth * scale;
        const next = glyphs[i + 1];
        if (next) {
            // getKerningValue returns NaN for some GPOS pairs in these fonts, which poisons every glyph after it.
            const k = font.getKerningValue(g, next);
            pen += (Number.isFinite(k) ? k : 0) * scale + tracking * size;
        }
    });
    return { d: parts.join(''), width: pen - x };
}

const measure = (font, str, size, opts) => text(font, str, 0, 0, size, opts).width;

/** Greedy wrap to a pixel width. */
function wrap(font, str, size, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of str.split(' ')) {
        const tryLine = line ? `${line} ${word}` : word;
        if (line && measure(font, tryLine, size) > maxWidth) {
            lines.push(line);
            line = word;
        } else line = tryLine;
    }
    if (line) lines.push(line);
    return lines;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const svg = (w, h, title, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${body}</svg>\n`;

// ------------------------------------------------------------------- the stage

/**
 * The cyclorama, the key light and the turntable, as one banner ground.
 * The turntable is a flat disc squashed to the floor's angle (cos 74° ≈ 0.28)
 * and turned by a CSS animation, so prefers-reduced-motion can freeze it.
 */
function stage(theme, w, h, { keyX = 0.71, keyY = 0.68, discX = 0.62 } = {}) {
    const t = THEME[theme];
    const dark = theme === 'dark';
    const ground = dark
        ? `<stop offset="0" stop-color="${C.night}"/><stop offset="0.55" stop-color="${C.deep}"/><stop offset="1" stop-color="#101d4c"/>`
        : `<stop offset="0" stop-color="#ecc3b5"/><stop offset="0.5" stop-color="#f1ddd3"/><stop offset="1" stop-color="${C.day}"/>`;
    const keyColour = dark ? '#ffffff' : '#ffffff';
    const keyPeak = dark ? 0.2 : 0.55;
    const ringAlpha = dark ? 0.14 : 0.12;
    const spokeAlpha = dark ? 0.2 : 0.16;
    const markAlpha = dark ? 0.6 : 0.42;

    const R = w * 0.62;
    const rings = [];
    for (let r = R * 0.08; r < R; r += R * 0.075) {
        rings.push(`<circle r="${r.toFixed(1)}" fill="none" stroke="${t.machinery}" stroke-opacity="${ringAlpha}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
    }
    const spokes = [];
    for (let a = 0; a < 360; a += 5) {
        const rad = (a * Math.PI) / 180;
        spokes.push(`M0 0L${(Math.cos(rad) * R).toFixed(1)} ${(Math.sin(rad) * R).toFixed(1)}`);
    }
    const marks = [0, 120, 240]
        .map((a, i) => `<rect x="0" y="-2" width="${(R * 0.62).toFixed(0)}" height="4" fill="url(#mark-${theme})" opacity="${i ? 0.55 : 1}" transform="rotate(${a})"/>`)
        .join('');

    return `<defs>
<linearGradient id="cyc-${theme}" x1="0" y1="0" x2="0" y2="1">${ground}</linearGradient>
<radialGradient id="key-${theme}" cx="${keyX}" cy="${keyY}" r="0.5" gradientTransform="translate(${keyX} ${keyY}) scale(0.76 0.68) translate(${-keyX} ${-keyY})">
<stop offset="0" stop-color="${keyColour}" stop-opacity="${keyPeak}"/><stop offset="0.44" stop-color="${keyColour}" stop-opacity="${keyPeak / 3}"/><stop offset="1" stop-color="${keyColour}" stop-opacity="0"/></radialGradient>
<radialGradient id="wash-${theme}" cx="${keyX}" cy="-0.08" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="${dark ? 0.1 : 0.3}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="mark-${theme}" x1="0" x2="1"><stop offset="0" stop-color="${t.machinery}" stop-opacity="${markAlpha}"/><stop offset="0.9" stop-color="${t.machinery}" stop-opacity="0"/></linearGradient>
<radialGradient id="fade-${theme}"><stop offset="0.34" stop-color="#fff"/><stop offset="0.6" stop-color="#fff" stop-opacity="0.7"/><stop offset="0.82" stop-color="#fff" stop-opacity="0"/></radialGradient>
<mask id="disc-${theme}" maskContentUnits="userSpaceOnUse"><circle r="${R.toFixed(1)}" fill="url(#fade-${theme})"/></mask>
</defs>
<style>
.revolve{animation:revolve 160s linear infinite}
@keyframes revolve{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}
@media (prefers-reduced-motion:reduce){.revolve{animation:none;transform:rotate(-18deg)}}
</style>
<rect width="${w}" height="${h}" fill="url(#cyc-${theme})"/>
<g transform="translate(${(w * discX).toFixed(0)} ${(h * 1.02).toFixed(0)}) scale(1 0.28)"><g mask="url(#disc-${theme})"><g class="revolve">
${rings.join('')}<path d="${spokes.join('')}" stroke="${t.machinery}" stroke-opacity="${spokeAlpha}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>${marks}
</g></g></g>
<rect width="${w}" height="${h}" fill="url(#wash-${theme})"/>
<rect width="${w}" height="${h}" fill="url(#key-${theme})"/>`;
}

// --------------------------------------------------------------------- pieces

function header(theme, { name, label, sub, file }) {
    const t = THEME[theme];
    const W = 1200;
    const H = 400;
    const x = 72;
    const nameSize = 168;
    const n = text(F.plot700, name, x, 268, nameSize, { tracking: -0.035 });
    const l = text(F.plot600, label, x + 4, 104, 30, { tracking: 0.18 });
    const s = text(F.plot600, sub, x + 4, 330, 30, { tracking: 0.16 });
    const body = `${stage(theme, W, H)}
<path d="${l.d}" fill="${t.quiet}"/>
<path d="${n.d}" fill="${t.ink}"/>
<path d="${s.d}" fill="${t.quiet}"/>`;
    const title = `${name}. ${label}. ${sub}`;
    return [file(theme), svg(W, H, title, body)];
}

/** A scene heading: condensed caps on transparent ground, sized to sit in an h2. */
function heading(theme, label) {
    const t = THEME[theme];
    const size = 46;
    const tracking = 0.01;
    const w = Math.ceil(measure(F.plot700, label.toUpperCase(), size, { tracking })) + 4;
    const p = text(F.plot700, label.toUpperCase(), 2, 42, size, { tracking });
    return svg(w, 52, label, `<path d="${p.d}" fill="${t.ink}"/>`);
}

/** The in-service lamp: the amber dot with its glow. Same in both themes. */
function lamp() {
    return svg(
        14,
        14,
        'In service',
        `<defs><radialGradient id="g"><stop offset="0.35" stop-color="${C.gel}" stop-opacity="0.65"/><stop offset="1" stop-color="${C.gel}" stop-opacity="0"/></radialGradient></defs><circle cx="7" cy="7" r="7" fill="url(#g)"/><circle cx="7" cy="7" r="3.5" fill="${C.gel}"/>`,
    );
}

/** The contact action: amber fill, gel ink, no radius. Same in both themes. */
function contactAction(label) {
    const size = 22;
    const tracking = 0.18;
    const tw = measure(F.plot700, label, size, { tracking });
    const padX = 30;
    const w = Math.ceil(tw + padX * 2);
    const h = 56;
    const p = text(F.plot700, label, padX, 36, size, { tracking });
    return svg(w, h, label, `<rect width="${w}" height="${h}" fill="${C.gel}"/><path d="${p.d}" fill="${C.gelInk}"/>`);
}

/**
 * How a change ships: merge → verify → version → image → deploy, with the one
 * branch that matters: verify fails, nothing deploys.
 */
function pipeline(theme) {
    const t = THEME[theme];
    const W = 1200;
    const H = 300;
    const steps = [
        ['MERGE', 'a pull request lands on main'],
        ['VERIFY', 'lint, typecheck, tests, build'],
        ['VERSION', 'minted from the title'],
        ['IMAGE', 'built once, pinned by tag'],
        ['DEPLOY', 'rolled out on my servers'],
    ];
    const col = W / steps.length;
    const lineY = 92;
    let out = '';
    steps.forEach(([label, note], i) => {
        const cx = col * i + 8;
        const L = text(F.plot700, label, cx, 66, 40, { tracking: 0.04 });
        out += `<path d="${L.d}" fill="${t.ink}"/>`;
        // the step's position mark on the rule
        out += `<rect x="${cx}" y="${lineY - 7}" width="2" height="14" fill="${t.ink}"/>`;
        wrap(F.work400, note, 24, col - 36).forEach((ln, j) => {
            out += `<path d="${text(F.work400, ln, cx, 136 + j * 32, 24).d}" fill="${t.quiet}"/>`;
        });
    });
    // the main rule, with an arrowhead at the deploy end
    out += `<rect x="8" y="${lineY - 0.75}" width="${W - 30}" height="1.5" fill="${t.rule}"/>`;
    out += `<path d="M${W - 22} ${lineY - 8}L${W - 8} ${lineY}L${W - 22} ${lineY + 8}" fill="none" stroke="${t.ink}" stroke-width="2"/>`;
    // the failure branch, dropping from VERIFY
    const vx = col + 8;
    out += `<path d="M${vx + 1} ${lineY + 7}V214H${vx + 30}" fill="none" stroke="${t.rule}" stroke-width="1.5" stroke-dasharray="5 5"/>`;
    const fail = text(F.plot700, 'FAILS', vx + 42, 224, 28, { tracking: 0.12 });
    out += `<path d="${fail.d}" fill="${t.ink}"/>`;
    const why = text(F.work400, 'nothing deploys, and the previous version keeps serving', vx + 52 + fail.width, 222, 24);
    out += `<path d="${why.d}" fill="${t.quiet}"/>`;
    const title =
        'How a change ships: merge, verify (lint, typecheck, tests, build), version, image, deploy. If verify fails, nothing deploys and the previous version keeps serving.';
    return svg(W, H, title, out);
}

// ---------------------------------------------------------------------- write

const out = (dir, files) => {
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of files) writeFileSync(join(dir, name), content);
    console.log(`${dir}: ${files.map(([n]) => n).join(', ')}`);
};

const themes = ['dark', 'light'];
const headings = { work: 'Selected work', backstage: 'Backstage', how: 'How I work', stack: 'Tools', contact: 'Get in touch' };

const profile = [];
for (const th of themes) {
    profile.push(header(th, { name: 'ADRIAN BRANDT', label: 'FULLSTACK DEVELOPER', sub: 'BERGEN → SARPSBORG → OSLO', file: (x) => `header-${x}.svg` }));
    for (const [id, label] of Object.entries(headings)) profile.push([`h-${id}-${th}.svg`, heading(th, label)]);
    profile.push([`pipeline-${th}.svg`, pipeline(th)]);
}
profile.push(['lamp.svg', lamp()]);
profile.push(['contact.svg', contactAction('SEND ME AN EMAIL')]);
out(join(root, 'assets'), profile);

if (process.argv.includes('--org')) {
    const org = [];
    for (const th of themes) {
        org.push(header(th, { name: 'BRANDTSTACK', label: 'ADRIAN BRANDT’S WORKSHOP', sub: 'SITES, APPS AND THE MACHINERY UNDER THEM', file: (x) => `header-${x}.svg` }));
        org.push([`h-public-${th}.svg`, heading(th, 'In the open')]);
        org.push([`h-private-${th}.svg`, heading(th, 'Behind the curtain')]);
    }
    out(join(root, '..', 'brandtstack-github', 'profile', 'assets'), org);
}
