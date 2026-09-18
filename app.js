/* Classic Movie Title Maker — vanilla JS, no backend. */
const $ = (id) => document.getElementById(id);

const els = {
  title: $('title'),
  author: $('author'),
  font: $('font'),
  weight: $('weight'),
  bgColor: $('bgColor'),
  textColor: $('textColor'),
  animate: $('animateTitle'),
  size: $('size'),
  sizeVal: $('sizeVal'),
  modeRadios: document.querySelectorAll('input[name="mode"]'),
  imgFormat: $('imgFormat'),
  imgBlock: $('img-block'),
  videoBlock: $('video-block'),
  animateBlock: $('animate-block'),
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
    animate: els.animate.checked,
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

// progress goes 0→1; when 0 the text sits at the top-left, at 1 it is centered.
function draw(ctx, W, H, s, progress = 1) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const { size, lineHeight, lines, hasAuthor, authorSize, authorGap } = computeLayout(ctx, W, H, s);

  const anim = progress !== undefined && progress < 1 ? 1 - easeOutCubic(progress) : 0;
  const cx = W / 2 - anim * W * 0.5;
  const cy = H / 2 - anim * H * 0.5;

  // Vertical layout
  const blockH = lines.length * lineHeight + (hasAuthor ? authorGap + authorSize * 1.25 : 0);
  let y = (H - blockH) / 2 + lineHeight / 2;

  // Main title lines with a subtle dark drop shadow
  if (lines.length) {
    ctx.save();
    ctx.font = fontString(size);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = Math.max(2, size * 0.05);
    ctx.shadowOffsetX = Math.max(1, size * 0.012);
    ctx.shadowOffsetY = Math.max(1, size * 0.02);
      ctx.fillStyle = s.fg;
      for (const line of lines) {
        ctx.fillText(line, cx, y);
        y += lineHeight;
      }
      ctx.restore();
  }

  // Author line
  if (hasAuthor) {
    const ay = y + authorGap / 2;
    ctx.save();
    ctx.font = fontString(authorSize);
    ctx.shadowColor = 'rgba(0,0,0,0.30)';
    ctx.shadowBlur = Math.max(1, authorSize * 0.05);
    ctx.shadowOffsetY = Math.max(1, authorSize * 0.02);
      ctx.fillStyle = s.fg;
      ctx.fillText(s.author, cx, ay);
      ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */
let previewRaf = 0;
function stopPreviewLoop() {
  if (previewRaf) cancelAnimationFrame(previewRaf);
  previewRaf = 0;
}

const PREVIEW_LOOP_MS = 2200; // full fly-in + hold cycle for the preview
function previewStep(now) {
  const st = state();
  const { w, h } = currentResolution();
  if (els.canvas.width !== w) els.canvas.width = w;
  if (els.canvas.height !== h) els.canvas.height = h;
  els.resReadout.textContent = `${w} × ${h}`;
  const ctx = els.canvas.getContext('2d');

  // fly-in over the first ~1s, hold, then loop so the preview always shows motion
  const FLY = 1000;
  const t = (now - loopStart) % PREVIEW_LOOP_MS;
  const p = Math.min(t / FLY, 1);
  draw(ctx, w, h, st, p);
  if (els.animate.checked && currentMode() === 'video') previewRaf = requestAnimationFrame(previewStep);
}

let loopStart = 0;
function startPreviewLoop() {
  stopPreviewLoop();
  loopStart = performance.now();
  previewRaf = requestAnimationFrame(previewStep);
}

function renderPreview() {
  const { w, h } = currentResolution();
  if (els.canvas.width !== w) els.canvas.width = w;
  if (els.canvas.height !== h) els.canvas.height = h;
  els.resReadout.textContent = `${w} × ${h}`;
  const ctx = els.canvas.getContext('2d');
  if (els.animate.checked && currentMode() === 'video') {
    startPreviewLoop();
  } else {
    stopPreviewLoop();
    draw(ctx, w, h, state());
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
    const FLY_SECONDS = 1; // the text flies in over the first ~second
    const animate = els.animate.checked && currentMode() === 'video';
    for (let i = 0; i < totalFrames; i++) {
      const t = (i * dt) / 1; // presentation timestamp in seconds
      const progress = animate ? Math.min(t / FLY_SECONDS, 1) : 1; // 0 at start → 1 once landed
      draw(ctx, w, h, s, progress);
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
els.animate.addEventListener('change', onAnyUI);
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
