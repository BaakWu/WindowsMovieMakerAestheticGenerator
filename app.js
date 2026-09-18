/* Classic Movie Title Maker — vanilla JS, no backend. */
const $ = (id) => document.getElementById(id);

const els = {
  title: $('title'),
  author: $('author'),
  font: $('font'),
  weight: $('weight'),
  bgColor: $('bgColor'),
  textColor: $('textColor'),
  size: $('size'),
  sizeVal: $('sizeVal'),
  modeRadios: document.querySelectorAll('input[name="mode"]'),
  imgFormat: $('imgFormat'),
  imgBlock: $('img-block'),
  videoBlock: $('video-block'),
  animateBlock: $('animate-block'),
  effect: $('effect'),
  effectDirWrap: $('effect-dir'),
  effectDir: $('effectDir'),
  duration: $('duration'),
  durVal: $('durVal'),
  fpsVal: $('fpsVal'),
  fps: $('fps'),
  resPreset: $('resPreset'),
  customRes: $('custom-res'),
  resW: $('resW'),
  resH: $('resH'),
  resReadout: $('resReadout'),
  download: $('download'),
  status: $('status'),
  canvas: $('canvas'),
  webcodecs: $('webcodecs-support'),
};

const MAX_VIDEO_SECONDS = 10;
const MEDIA_ID = 'title';

/* ------------------------------------------------------------------ */
/* State helpers                                                       */
/* ------------------------------------------------------------------ */
function currentMode() {
  for (const r of els.modeRadios) if (r.checked) return r.value;
  return 'image';
}

function currentResolution() {
  if (els.resPreset.value === 'custom') {
    let w = Math.round(els.resW.value || 1920);
    let h = Math.round(els.resH.value || 1080);
    w = Math.min(Math.max(w, 160), 6000);
    h = Math.min(Math.max(h, 120), 6000);
    // force even dimensions (WebCodecs/encoders dislike odd sizes)
    if (w % 2) w += 1;
    if (h % 2) h += 1;
    return { w, h };
  }
  const [w, h] = els.resPreset.value.split('x').map(Number);
  return { w, h };
}

function state() {
  return {
    title: els.title.value.trim(),
    author: els.author.value.trim(),
    font: els.font.value,
    weight: els.weight.value,
    bg: els.bgColor.value,
    fg: els.textColor.value,
    effect: els.effect.value,
    direction: els.effectDir.value,
    sizeFactor: Number(els.size.value) / 100,
  };
}

function fontString(px) {
  return `${els.weight.value} ${Math.round(px)}px "${els.font.value}", Arial, sans-serif`;
}

/* ------------------------------------------------------------------ */
/* Text layout                                                         */
/* ------------------------------------------------------------------ */
function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para.trim() === '') {
      continue;
    }
    const words = para.split(' ');
    let cur = '';
    for (const word of words) {
      const trial = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(trial).width <= maxWidth || cur === '') {
        cur = trial;
      } else {
        if (cur) lines.push(cur);
        cur = '';
        // break an unbreakable word that is wider than maxWidth
        let chunk = '';
        for (const ch of word) {
          if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
            lines.push(chunk);
            chunk = '';
          }
          chunk += ch;
        }
        cur = chunk;
      }
    }
    if (cur !== '') lines.push(cur);
  }
  return lines;
}

function computeLayout(ctx, W, H, s) {
  const maxWidth = W * 0.86;
  let size = H * 0.17 * s.sizeFactor;

  // word-wrap at a trial size
  ctx.font = fontString(size);
  let lines = s.title ? wrapLines(ctx, s.title, maxWidth) : [];

  // if a single unwrappable word still overflows, shrink to fit
  if (lines.length) {
    let widest = 0;
    for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
    if (widest > maxWidth && widest > 0) {
      size *= maxWidth / widest;
      ctx.font = fontString(size);
      lines = s.title ? wrapLines(ctx, s.title, maxWidth) : [];
    }
  }

  const lineHeight = size * 1.14;
  const hasAuthor = !!s.author;
  const authorSize = Math.max(16, size * 0.5);
  const authorGap = size * 0.32;
  const blockH = lines.length * lineHeight + (hasAuthor ? authorGap + authorSize * 1.25 : 0);
  const budget = H * 0.82;
  if (blockH > budget && blockH > 0) {
    size *= budget / blockH;
    ctx.font = fontString(size);
    lines = s.title ? wrapLines(ctx, s.title, maxWidth) : [];
    lineHeight = size * 1.14;
  }

  return { size, lineHeight, lines, hasAuthor, authorSize: Math.max(16, size * 0.5), authorGap };
}

/* ------------------------------------------------------------------ */
/* Rendering (shared by preview, image and video)                     */
/* ------------------------------------------------------------------ */
function easeOutCubic(p) {
  return 1 - Math.pow(1 - p, 3);
}

const FLY_DIRECTIONS = {
  'top-left': { dx: -0.6, dy: -0.6 },
  top: { dx: 0, dy: -0.9 },
  'top-right': { dx: 0.6, dy: -0.6 },
  left: { dx: -0.9, dy: 0 },
  right: { dx: 0.9, dy: 0 },
  'bottom-left': { dx: -0.6, dy: 0.6 },
  bottom: { dx: 0, dy: 0.9 },
  'bottom-right': { dx: 0.6, dy: 0.6 },
};

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

function withShadow(ctx, big) {
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = big ? 8 : 4;
  ctx.shadowOffsetX = big ? 2 : 1;
  ctx.shadowOffsetY = big ? 3 : 2;
}

// Draw one line of text at (x, y) with alpha (0-1) and a font size in px.
function drawLine(ctx, line, x, y, alpha, fontPx, color) {
  if (!line || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
  ctx.font = fontString(fontPx);
  withShadow(ctx, fontPx >= 64);
  ctx.fillStyle = color;
  ctx.fillText(line, x, y);
  ctx.restore();
}

// t is the animation time in ms since the start (0 = first frame).
function draw(ctx, W, H, s, t = 0) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const { size, lineHeight, lines, hasAuthor, authorSize, authorGap } = computeLayout(ctx, W, H, s);

  // Vertical layout: y is the baseline of the first title line.
  const blockH = lines.length * lineHeight + (hasAuthor ? authorGap + authorSize * 1.25 : 0);
  let y = (H - blockH) / 2 + lineHeight / 2;
  const subY = y + lines.length * lineHeight + authorGap / 2;

  // Shared shadow settings for title and subtitle text.
  const fg = s.fg;

  if ((s.effect || 'none') === 'moving') {
    const a = easeInOutSine(clamp01(t / 900));
    const sa = easeInOutSine(clamp01((t - 600) / 800));

    // Two large translucent copies of the title scroll across the background
    // (upper and lower), like the old Windows Movie Maker cards.
    const title = (s.title || '').trim();
    if (title) {
      ctx.save();
      const gsize = H * 0.42;
      ctx.font = fontString(gsize);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = fg;
      const tw = Math.max(1, ctx.measureText(title).width);
      const unit = tw + Math.max(60, W * 0.06); // spacing between repeats (seamless tiling)
      const speed = W * 0.05;                   // px per second

      const scroll = (gy, off, alpha, dir) => {
        ctx.globalAlpha = alpha;
        if (dir > 0) {
          for (let x = -unit + off; x < W + unit; x += unit) ctx.fillText(title, x, gy);
        } else {
          for (let x = W + unit - off; x > -unit; x -= unit) ctx.fillText(title, x, gy);
        }
      };
      scroll(H * 0.33, ((t / 1000) * speed) % unit, 0.13, +1);
      scroll(H * 0.73, ((t / 1000) * speed * 1.18) % unit, 0.11, -1);
      ctx.restore();
    }

    // Foreground: the real title + subtitle, stationary, fading in.
    lines.forEach((line) => {
      drawLine(ctx, line, W / 2, y, a, size, fg);
      y += lineHeight;
    });
    if (hasAuthor) drawLine(ctx, s.author, W / 2, subY, sa, authorSize, fg);
    return;
  }

  if ((s.effect || 'none') === 'fly-in') {
    const p = clamp01(t / 1000);
    const anim = 1 - easeOutCubic(p);
    let dir = FLY_DIRECTIONS.bottom;
    const d = FLY_DIRECTIONS[s.direction];
    if (d) dir = d;
    const cx = W / 2 + anim * dir.dx * W;
    const cy = H / 2 + anim * dir.dy * H;
    const off = cy - H / 2;

    lines.forEach((line) => {
      drawLine(ctx, line, cx, y + off, 1, size, fg);
      y += lineHeight;
    });
    if (hasAuthor) drawLine(ctx, s.author, cx, subY + off, 1, authorSize, fg);
    return;
  }

  // No animation: static centered card.
  lines.forEach((line) => {
    drawLine(ctx, line, W / 2, y, 1, size, fg);
    y += lineHeight;
  });
  if (hasAuthor) drawLine(ctx, s.author, W / 2, subY, 1, authorSize, fg);
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */
let previewRaf = 0;
let previewRunning = false;
function stopPreviewLoop() {
  previewRunning = false;
  if (previewRaf) cancelAnimationFrame(previewRaf);
  previewRaf = 0;
}

function previewStep(now) {
  if (!previewRunning) return;
  const st = state();
  const { w, h } = currentResolution();
  if (els.canvas.width !== w) els.canvas.width = w;
  if (els.canvas.height !== h) els.canvas.height = h;
  els.resReadout.textContent = `${w} × ${h}`;
  const ctx = els.canvas.getContext('2d');

  // Show the animation from the start; for moving titles it keeps running
  // (the motion is perpetual), for fly-in it settles and holds.
  const t = now - loopStart;
  draw(ctx, w, h, st, t);
  previewRaf = requestAnimationFrame(previewStep);
}

let loopStart = 0;
function startPreviewLoop() {
  stopPreviewLoop();
  previewRunning = true;
  loopStart = performance.now();
  previewRaf = requestAnimationFrame(previewStep);
}

function animationActive() {
  return currentMode() === 'video' && els.effect.value !== 'none';
}

function renderPreview() {
  const { w, h } = currentResolution();
  if (els.canvas.width !== w) els.canvas.width = w;
  if (els.canvas.height !== h) els.canvas.height = h;
  els.resReadout.textContent = `${w} × ${h}`;
  const ctx = els.canvas.getContext('2d');
  if (animationActive()) {
    startPreviewLoop();
  } else {
    stopPreviewLoop();
    // Static card: fly-in shown fully landed, moving shown settled.
    draw(ctx, w, h, state(), els.effect.value === 'fly-in' ? 1000 : 9000);
  }
}

/* ------------------------------------------------------------------ */
/* Status + download helpers                                           */
/* ------------------------------------------------------------------ */
function setStatus(msg, kind) {
  els.status.textContent = msg || '';
  els.status.className = 'status' + (kind ? ` status--${kind}` : '');
}

function slug(text) {
  const s = (text || 'title').split('\n')[0].trim();
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------------ */
/* Image export                                                        */
/* ------------------------------------------------------------------ */
function exportImage() {
  const { w, h } = currentResolution();
  els.canvas.width = w;
  els.canvas.height = h;
  const ctx = els.canvas.getContext('2d');
  draw(ctx, w, h, state());

  const mime = els.imgFormat.value === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
  const quality = mime === 'image/jpeg' ? 0.95 : undefined;
  els.canvas.toBlob(
    (blob) => {
      if (!blob) return setStatus('Image export failed.', 'error');
      downloadBlob(blob, `${MEDIA_ID}-${slug(state().title)}-${w}x${h}.${ext}`);
      setStatus(`Image saved: ${w}×${h} ${ext.toUpperCase()}`, 'ok');
    },
    mime,
    quality,
  );
}

/* ------------------------------------------------------------------ */
/* Video export (real .mp4, fully client-side via Mediabunny/WebCodecs) */
/* ------------------------------------------------------------------ */
let mediabunnyPromise = null;
function loadMediabunny() {
  if (!mediabunnyPromise) {
    mediabunnyPromise = import('https://cdn.jsdelivr.net/npm/mediabunny@1.58.0/+esm')
      .then((m) => m.default ?? m)
      .catch(() => import('/mediabunny.module.js').then((m) => m.default ?? m));
  }
  return mediabunnyPromise;
}

async function exportVideo() {
  if (typeof window.VideoEncoder === 'undefined') {
    return setStatus('Your browser lacks WebCodecs, so .mp4 export is unavailable. Open in Chrome or Edge.', 'error');
  }

  const { w, h } = currentResolution();
  let duration = Number(els.duration.value);
  if (!Number.isFinite(duration) || duration <= 0) duration = 5;
  duration = Math.min(Math.max(duration, 1), MAX_VIDEO_SECONDS);
  const fps = Number(els.fps.value) || 30;

  setStatus(`Preparing video encoder…`, '');
  els.download.disabled = true;

  try {
    // Render the still card to an offscreen canvas at full resolution.
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    draw(ctx, w, h, state());

    const MB = await loadMediabunny();
    const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality, getFirstEncodableVideoCodec } = MB;

    // Pick the best codec the browser can actually encode into MP4.
    const codec = await getFirstEncodableVideoCodec(
      ['avc', 'hevc', 'vp9', 'av1'],
      { width: w, height: h },
    );
    if (!codec) {
      return setStatus('No supported video codec could be found in this browser.', 'error');
    }

    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const source = new CanvasSource(canvas, { codec, quality: new Quality('high') });
    output.addVideoTrack(source);
    await output.start();

    const totalFrames = Math.max(1, Math.round(duration * fps));
    const dt = 1 / fps;
    const s = state();
    for (let i = 0; i < totalFrames; i++) {
      const t = (i * dt) / 1; // presentation timestamp in seconds
      draw(ctx, w, h, s, t * 1000); // animation time in ms
      setStatus(`Encoding video… ${Math.round(((i + 1) / totalFrames) * 100)}%`, '');
      await source.add(t, dt);
      await new Promise((r) => requestAnimationFrame(r)); // let the status paint
    }

    source.close();
    await output.finalize();

    const buffer = output.target.buffer;
    const blob = new Blob([buffer], { type: 'video/mp4' });
    downloadBlob(blob, `${MEDIA_ID}-${slug(state().title)}-${w}x${h}-${duration}s.mp4`);
    setStatus(`Video saved: ${w}×${h}, ${duration}s, ${codec.toUpperCase()}.mp4`, 'ok');
  } catch (err) {
    console.error(err);
    const msg = err && err.message ? ` (error: ${err.message})` : '';
    setStatus(`Video export failed.${msg} Try a Chrome/Edge browser, or use Image output.`, 'error');
  } finally {
    els.download.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */
function updateModeSections() {
  const mode = currentMode();
  els.imgBlock.hidden = mode !== 'image';
  els.videoBlock.hidden = mode !== 'video';
  els.animateBlock.hidden = mode !== 'video';
  els.effectDirWrap.hidden = els.effect.value !== 'fly-in';
}

function updateResolutionUI() {
  els.customRes.hidden = els.resPreset.value !== 'custom';
  if (els.resPreset.value !== 'custom') {
    const [w, h] = els.resPreset.value.split('x').map(Number);
    els.resW.value = w;
    els.resH.value = h;
  }
}

function onAnyUI() {
  els.sizeVal.textContent = els.size.value;
  els.durVal.textContent = els.duration.value;
  els.fpsVal.textContent = els.fps.value;
  updateModeSections();
  updateResolutionUI();
  renderPreview();
}

function checkWebcodecs() {
  const ok = typeof window.VideoEncoder !== 'undefined';
  els.webcodecs.textContent = ok ? 'MP4 ready' : 'MP4 unavailable';
  els.webcodecs.className = 'badge ' + (ok ? 'badge--ok' : 'badge--bad');
}

els.download.addEventListener('click', () => {
  if (currentMode() === 'image') {
    exportImage();
  } else {
    exportVideo();
  }
});

const liveInputs = [
  els.title,
  els.author,
  els.font,
  els.weight,
  els.bgColor,
  els.textColor,
  els.size,
  els.duration,
  els.fps,
  els.imgFormat,
  els.resW,
  els.resH,
];
liveInputs.forEach((el) => {
  el.addEventListener('input', onAnyUI);
});
els.effect.addEventListener('change', onAnyUI);
els.effectDir.addEventListener('change', onAnyUI);
els.resPreset.addEventListener('change', onAnyUI);
els.modeRadios.forEach((r) => r.addEventListener('change', onAnyUI));

// Preset color swatches — set the color input in the same row
document.querySelectorAll('[data-color]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = btn.closest('.color-row')?.querySelector('input[type=color]');
    if (input) {
      input.value = btn.dataset.color;
      onAnyUI();
    }
  });
});

checkWebcodecs();
onAnyUI();

// Small public API + test hook (exposes the render/export primitives)
window.TitleMaker = {
  state,
  currentResolution,
  draw,
  exportImage,
  exportVideo,
  renderPreview,
};
