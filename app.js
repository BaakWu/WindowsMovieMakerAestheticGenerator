/* Windows Movie Maker Title Generator — vanilla JS, no backend. */
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
  imgBlock: $('imgBlock'),
  videoBlock: $('video-block'),
  fmtBlock: $('fmt-block'),
  animateBlock: $('animate-block'),
  effect: $('effect'),
  effectDirWrap: $('effect-dir'),
  effectDir: $('effectDir'),
  fadeOutWrap: $('effect-fadeout'),
  fadeOut: $('fadeOut'),
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
  previewVideo: $('previewVideo'),
  previewImg: $('previewImg'),
  progress: $('progress'),
  progressLabel: document.querySelector('.preview__progress-label'),
  progressBar: $('progressBar'),
  progressValue: $('progressValue'),
  webcodecs: $('webcodecs-support'),
  controlsPanel: document.querySelector('.controls'),
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
    fadeOut: els.fadeOut.checked,
    duration: previewDuration(),
    sizeFactor: Number(els.size.value) / 100,
  };
}

function fontString(px) {
  return `${els.weight.value} ${Math.round(px)}px "${els.font.value}", Arial, sans-serif`;
}

// Image mode renders a single static card, so it ignores the animation effect;
// video mode keeps it.
function renderState() {
  const s = state();
  if (currentMode() === 'image') s.effect = 'none';
  return s;
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
// total is the full animation length in ms (used for the fade-out phase).
function draw(ctx, W, H, s, t = 0, total) {
  total = (total == null) ? s.duration * 1000 : total;
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
    // Moving titles: a big translucent copy of the title scrolls across the
    // background (upper and lower) while the real title + subtitle sit in the
    // center. All of it fades in at the start, and (optionally) fades out at
    // the end.
    const FADE_IN = 900; // ms for the initial fade-in
    const FADE_OUT = 1000; // ms for the final fade-out

    const fadeIn = easeInOutSine(clamp01(t / FADE_IN));
    const fadeOutFactor = s.fadeOut ? easeInOutSine(clamp01((total - t) / FADE_OUT)) : 1;
    const master = fadeIn * fadeOutFactor; // 0 → 1 → 0

    // Two large translucent copies scroll across the background (upper/lower),
    // each fading in with the card and fading out with it.
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
        if (alpha <= 0) return;
        ctx.globalAlpha = alpha;
        if (dir > 0) {
          for (let x = -unit + off; x < W + unit; x += unit) ctx.fillText(title, x, gy);
        } else {
          for (let x = W + unit - off; x > -unit; x -= unit) ctx.fillText(title, x, gy);
        }
      };
      scroll(H * 0.33, ((t / 1000) * speed) % unit, 0.13 * master, +1);
      scroll(H * 0.73, ((t / 1000) * speed * 1.18) % unit, 0.11 * master, -1);
      ctx.restore();
    }

    // Foreground: the real title + subtitle, stationary, riding the master alpha.
    lines.forEach((line) => {
      drawLine(ctx, line, W / 2, y, master, size, fg);
      y += lineHeight;
    });
    if (hasAuthor) drawLine(ctx, s.author, W / 2, subY, master, authorSize, fg);
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
function isVideoMode() {
  return currentMode() === 'video';
}

function videoFormat() {
  const checked = document.querySelector('input[name="fmt"]:checked');
  if (checked && checked.value === 'gif') return 'gif';
  return 'mp4';
}

let videoBuildSeq = 0; // increment on every rebuild; stale builds self-cancel

// One render per format, so flipping the format doesn't re-encode the other one.
let mp4Cache = null; // { url, blob, meta }
let gifCache = null; // { url, blob, meta }

function currentCache() {
  return videoFormat() === 'gif' ? gifCache : mp4Cache;
}
function setCache(fmt, entry) {
  if (fmt === 'gif') gifCache = entry;
  else mp4Cache = entry;
}

function settingsFingerprint() {
  const s = state();
  const { w, h } = currentResolution();
  return [
    w, h,
    s.title, s.author, s.font, s.weight, s.bg, s.fg,
    s.effect, s.direction, s.fadeOut ? 1 : 0, Math.round(s.sizeFactor * 1000),
    previewDuration(), previewFps(),
  ].join('|');
}

function revokeCurrentPreview() {
  // Keep both rendered blobs cached — only hide the media elements.
  try { els.previewVideo.pause(); } catch (_) {}
  els.previewVideo.hidden = true;
  els.previewImg.hidden = true;
}

function showPreview(url, fmt) {
  els.canvas.hidden = true;
  if (fmt === 'gif') {
    els.previewVideo.hidden = true;
    els.previewImg.hidden = false;
    els.previewImg.src = url;
  } else {
    els.previewImg.hidden = true;
    els.previewVideo.hidden = false;
    els.previewVideo.src = url;
    try { els.previewVideo.play().catch(() => {}); } catch (_) {}
  }
}

function showCanvas() {
  revokeCurrentPreview();
  hideProgress();
  els.canvas.hidden = false;
}

function showProgress(pct) {
  const rounded = Math.max(0, Math.min(1, pct));
  els.progress.hidden = false;
  els.progressBar.style.width = (rounded * 100) + '%';
  els.progressValue.textContent = Math.round(rounded * 100) + '%';
}

function hideProgress() {
  els.progress.hidden = true;
  els.progressBar.style.width = '0%';
  els.progressValue.textContent = '0%';
}

async function buildPreviewVideo() {
  const seq = ++videoBuildSeq;
  const fmt = videoFormat();
  const { w, h } = currentResolution();
  const duration = previewDuration();
  const fps = previewFps();
  const meta = settingsFingerprint();
  const cached = (fmt === 'gif' ? gifCache : mp4Cache);
  if (cached && cached.meta === meta) {
    // Already rendered from these settings — just flip the preview over.
    showPreview(cached.url, fmt);
    hideProgress();
    setControlsLocked(false);
    return;
  }

  els.download.disabled = true;
  setControlsLocked(true);
  els.progressLabel.textContent = 'Rendering preview…';
  showProgress(0);
  try {
    const blob = fmt === 'gif'
      ? await buildGif({ w, h, duration, fps, progress: (p) => seq === videoBuildSeq && showProgress(p) })
      : await buildVideo({ w, h, duration, fps, progress: (p) => seq === videoBuildSeq && showProgress(p) });
    if (seq !== videoBuildSeq) return; // stale — a newer rebuild superseded us
    const old = (fmt === 'gif' ? gifCache : mp4Cache);
    if (old && old.url) { try { URL.revokeObjectURL(old.url); } catch (_) {} }
    const url = URL.createObjectURL(blob);
    setCache(fmt, { url, blob, meta });
    showPreview(url, fmt);
    hideProgress();
  } catch (err) {
    if (seq !== videoBuildSeq) return;
    hideProgress();
    showCanvas();
    friendlyVideoError(err);
  } finally {
    // If a newer render superseded us, that render owns the lock now.
    if (seq === videoBuildSeq) {
      setControlsLocked(false);
      els.download.disabled = false;
    }
  }
}

let videoDeferred = false; // text still being typed — rebuild on blur instead

function setControlsLocked(locked) {
  els.controlsPanel.classList.toggle('controls--locked', locked);
}

let pendingToken = 0;
function schedulePreviewVideo() {
  // Defer so rapid typing / slider-dragging debounces to one rebuild.
  const token = ++pendingToken;
  setTimeout(() => {
    if (token !== pendingToken) return; // superseded by a newer schedule
    if (isVideoMode()) buildPreviewVideo();
  }, 250);
}

function renderPreview() {
  const { w, h } = currentResolution();
  els.resReadout.textContent = `${w} × ${h}`;

  // Always keep a settled frame painted on the canvas so there's something
  // visible behind the video (during encode, on failure, and in image mode).
  // Image mode renders the plain static card (animation only affects video).
  // In video mode settle the frame at the midpoint so the text is fully
  // visible (fade-in complete, fade-out not yet started).
  const dur = previewDuration() * 1000;
  if (els.canvas.width !== w) els.canvas.width = w;
  if (els.canvas.height !== h) els.canvas.height = h;
  const ctx = els.canvas.getContext('2d');
  const s = renderState();
  draw(ctx, w, h, s, currentMode() === 'video' ? dur / 2 : 0);

  if (isVideoMode()) {
    if (videoDeferred) {
      // Still typing in the title/subtitle: hide the now-stale video so the
      // live canvas (with the current text) stays visible until they finish.
      try { els.previewVideo.pause(); } catch (_) {}
      els.previewVideo.hidden = true;
      els.previewImg.hidden = true;
      els.canvas.hidden = false;
    }
    // While typing, defer the re-encode until focus leaves the text inputs.
    if (videoDeferred === false) schedulePreviewVideo();
  } else {
    // Image mode: show the canvas, no video.
    showCanvas();
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
  draw(ctx, w, h, renderState());

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

// Render the full animation into an .mp4 Blob. progress is called with 0..1.
async function buildVideo({ w, h, duration, fps, progress } = {}) {
  if (typeof window.VideoEncoder === 'undefined') {
    throw new Error('webcodecs-unavailable');
  }

  progress = progress || (() => {});

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
    throw new Error('no-codec');
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
    progress((i + 1) / totalFrames);
    await source.add(t, dt);
    await new Promise((r) => requestAnimationFrame(r)); // let the status paint
  }

  source.close();
  await output.finalize();

  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

/* GIF export (client-side, via gifenc) */
let gifencPromise = null;
function loadGifenc() {
  if (!gifencPromise) {
    // Use the ESM namespace directly — gifenc's `default` export is the
    // GIFEncoder function itself, so destructuring from it would not yield
    // quantize/applyPalette.
    gifencPromise = (
      import('https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm')
        .catch(() => import('/gifenc.module.js'))
    ).then((m) => {
      const ns = (m && m.default && typeof m.default === 'object') ? m.default : m;
      if (typeof ns.GIFEncoder !== 'function' || typeof ns.quantize !== 'function') {
        throw new Error('gifenc-missing-exports');
      }
      return ns;
    });
  }
  return gifencPromise;
}

// Render the full animation into an animated GIF Blob. progress is called with 0..1.
// GIFs are size-sensitive, so frames are rendered capped at 1280px wide.
async function buildGif({ w, h, duration, fps, progress } = {}) {
  progress = progress || (() => {});
  const lib = await loadGifenc();
  const { GIFEncoder, quantize, applyPalette } = lib;

  const scale = Math.min(1, 1280 / w);
  const rw = Math.max(2, Math.round((w / 2) * scale) * 2);
  const rh = Math.max(2, Math.round((h / 2) * scale) * 2);

  const canvas = document.createElement('canvas');
  canvas.width = rw;
  canvas.height = rh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const s = state();
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const delay = Math.max(20, Math.round(1000 / fps)); // ms per frame

  // gifenc expects a plain Uint8Array (a view over the same bytes), not the
  // browser's Uint8ClampedArray from getImageData().
  const rgba = (x, y, ww, hh) => new Uint8Array(ctx.getImageData(x, y, ww, hh).data.buffer);

  // Sample the palette from a mid-animation frame (same trick as the static
  // preview): at t=0 the "moving titles" effect is still fully faded out,
  // so the canvas is just the background color and the palette would omit
  // the text color — making white text collapse to the nearest bg shade.
  draw(ctx, rw, rh, s, (duration * 1000) / 2, duration * 1000);
  const palette = quantize(rgba(0, 0, rw, rh), 256);

  const gif = GIFEncoder();
  for (let i = 0; i < totalFrames; i++) {
    draw(ctx, rw, rh, s, (i * 1000) / fps);
    const index = applyPalette(rgba(0, 0, rw, rh), palette);
    gif.writeFrame(index, rw, rh, i === 0 ? { palette, delay } : { delay });
    progress((i + 1) / totalFrames);
    await new Promise((r) => requestAnimationFrame(r)); // keep the progress bar painting
  }
  gif.finish();

  return new Blob([gif.bytes()], { type: 'image/gif' });
}

async function exportVideo() {
  const fmt = videoFormat();
  const ext = fmt === 'gif' ? 'gif' : 'mp4';
  const { w, h } = currentResolution();
  const duration = previewDuration();
  const fps = previewFps();

  setStatus(`Preparing ${ext.toUpperCase()} encoder…`, '');
  els.download.disabled = true;

  try {
    // Reuse the already-rendered preview if it matches the current settings.
    const c = currentCache();
    let blob = (c && c.meta === settingsFingerprint()) ? c.blob : null;
    if (!blob) {
      els.progressLabel.textContent = 'Saving…';
      showProgress(0);
      blob = fmt === 'gif'
        ? await buildGif({ w, h, duration, fps, progress: showProgress })
        : await buildVideo({ w, h, duration, fps, progress: showProgress });
      hideProgress();
    }
    downloadBlob(blob, `${MEDIA_ID}-${slug(state().title)}-${w}x${h}-${duration}s.${ext}`);
    setStatus(`${ext.toUpperCase()} saved: ${w}×${h}, ${duration}s, ${fps}fps`, 'ok');
  } catch (err) {
    console.error(err);
    hideProgress();
    friendlyVideoError(err);
  } finally {
    els.download.disabled = false;
  }
}

function previewDuration() {
  let d = Number(els.duration.value);
  if (!Number.isFinite(d) || d <= 0) d = 5;
  return Math.min(Math.max(d, 1), MAX_VIDEO_SECONDS);
}

function previewFps() {
  const f = Number(els.fps.value);
  return Number.isFinite(f) && f > 0 ? f : 30;
}

function friendlyVideoError(err) {
  const msg = err && err.message ? ` (error: ${err.message})` : '';
  const kind = videoFormat() === 'gif' ? 'GIF' : '.mp4';
  if (err && err.message === 'gifenc-missing-exports') {
    return setStatus('The GIF encoder library failed to load from the CDN. Check your connection and retry, or fall back to Image (.png/.jpg) / .mp4 output.', 'error');
  }
  if (err && err.message === 'webcodecs-unavailable') {
    if (kind === '.mp4') {
      return setStatus('Your browser lacks WebCodecs, so .mp4 preview/export is unavailable. Open in Chrome or Edge, or switch the format to .gif.', 'error');
    }
  }
  setStatus(`${kind} failed.${msg} Try a Chrome/Edge browser, or use Image output.`, 'error');
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */
function updateModeSections() {
  const isVideo = currentMode() === 'video';
  els.imgBlock.hidden = isVideo;
  els.fmtBlock.hidden = !isVideo;
  els.videoBlock.hidden = !isVideo;
  els.animateBlock.hidden = !isVideo;
  els.effectDirWrap.hidden = els.effect.value !== 'fly-in';
  els.fadeOutWrap.hidden = els.effect.value !== 'moving';
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
els.fadeOut.addEventListener('change', onAnyUI);
els.resPreset.addEventListener('change', onAnyUI);
els.modeRadios.forEach((r) => r.addEventListener('change', onAnyUI));
document.querySelectorAll('input[name="fmt"]').forEach((r) => r.addEventListener('change', onAnyUI));

// While typing in the title/subtitle, don't re-encode the video on every keystroke —
// rebuild only once focus leaves those fields.
[els.title, els.author].forEach((el) => {
  el.addEventListener('blur', () => {
    if (!videoDeferred) return;
    videoDeferred = false;
    if (isVideoMode()) schedulePreviewVideo();
  });
});
document.addEventListener('focusin', (e) => {
  if (e.target === els.title || e.target === els.author) videoDeferred = true;
});

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
