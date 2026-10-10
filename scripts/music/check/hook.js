/* Injected into the music page before it loads by drive.mjs (Page.addScriptToEvaluateOnNewDocument). Test-only.
   Records every Web Audio call the page makes (decode, source start/stop, gain automation), keeps the decoded buffers,
   taps the live output with a ScriptProcessor for the wrap check, and records what is copied to the clipboard.
   With ?pad=1 on the URL it hands the page buffers that still carry the MP3 delay and padding, to run the trim path. */
(function () {
  if (window.__hooked) return;
  window.__hooked = true;
  const log = (window.__log = []);
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    constructor(...a) {
      super(...a);
      window.__ctx = this;
      log.push({ e: "ctx", sr: this.sampleRate, state: this.state, base: this.baseLatency });
    }
  };
  const hashBuf = (ab) => {
    const u = new Uint8Array(ab);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < u.length; i += 7) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
    return h + ":" + u.length;
  };
  window.__hashBuf = hashBuf;
  window.__bufs = [];
  const PAD = /[?&]pad=1/.test(location.search);
  const dec = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (data, ok, no) {
    const key = hashBuf(data);
    const wrapOk = (b) => {
      let use = b, orig = null;
      if (PAD && b.length > 1e6) { // pretend to be a decoder that leaves the MP3 delay and padding in
        const lead = Math.round((1105 / 44100) * b.sampleRate);
        const p = new AudioBuffer({ length: b.length + lead + 1100, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
        for (let c = 0; c < b.numberOfChannels; c++) p.copyToChannel(b.getChannelData(c), c, lead);
        use = p; orig = b;
      }
      window.__bufs.push({ key, buf: use, orig });
      log.push({ e: "decoded", key, len: use.length, sr: use.sampleRate, ch: use.numberOfChannels, padded: !!orig });
      if (ok) ok(use);
    };
    return dec.call(this, data, ok ? wrapOk : undefined, no);
  };
  let gid = 0;
  const cg = BaseAudioContext.prototype.createGain;
  BaseAudioContext.prototype.createGain = function () {
    const g = cg.call(this);
    g.__id = ++gid;
    g.gain.__gid = g.__id;
    return g;
  };
  const rec = (window.__rec = { on: false, pts: [], chunks: [], sr: 0 });
  function ensureTap(ctx) {
    if (ctx.__sp) return;
    const sp = ctx.createScriptProcessor(4096, 2, 2);
    sp.onaudioprocess = (ev) => {
      if (!rec.on) return;
      rec.pts.push(ev.playbackTime);
      rec.chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
    };
    connect.call(sp, ctx.destination);
    ctx.__sp = sp;
    rec.sr = ctx.sampleRate;
  }
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dst, ...r) {
    if (this instanceof AudioBufferSourceNode && dst instanceof GainNode) this.__g = dst;
    const res = connect.call(this, dst, ...r);
    try {
      if (this instanceof GainNode && dst === this.context.destination) {
        ensureTap(this.context);
        connect.call(this, this.context.__sp);
      }
    } catch (e) { log.push({ e: "taperr", msg: String(e) }); }
    return res;
  };
  const st = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, off, dur) {
    const g = this.__g;
    const hit = this.buffer && window.__bufs.find((x) => x.buf === this.buffer);
    log.push({
      e: "start", t: window.__ctx && window.__ctx.currentTime, wall: performance.now(), when, off, dur,
      loop: this.loop, ls: this.loopStart, le: this.loopEnd,
      blen: this.buffer && this.buffer.length, bdur: this.buffer && this.buffer.duration,
      key: hit ? hit.key : null, gid: g && g.__id, gain: g && g.gain.value,
    });
    return st.call(this, when, off, dur);
  };
  const sp = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (when) {
    const g = this.__g;
    log.push({ e: "stop", t: window.__ctx && window.__ctx.currentTime, when, gid: g && g.__id });
    return sp.call(this, when);
  };
  for (const m of ["setValueAtTime", "linearRampToValueAtTime", "setValueCurveAtTime", "setTargetAtTime", "cancelScheduledValues", "cancelAndHoldAtTime"]) {
    const o = AudioParam.prototype[m];
    if (!o) continue;
    AudioParam.prototype[m] = function (...a) {
      log.push({
        e: "param", m, gid: this.__gid, t: window.__ctx && window.__ctx.currentTime,
        a: a.map((x) => (x && x.length !== undefined ? Array.from(x) : x)),
      });
      return o.apply(this, a);
    };
  }
  window.__clip = [];
  try {
    const w = Clipboard.prototype.writeText;
    Clipboard.prototype.writeText = function (text) {
      window.__clip.push(String(text));
      return w.call(this, text);
    };
  } catch (e) { /* ignore */ }

  /* Offline render of the page's own decoded buffer through the same looping path. */
  window.__offline = async (key, ls, le) => {
    const b = window.__bufs.find((x) => x.key === key).buf;
    const sr = b.sampleRate;
    const L = b.length;
    const oc = new OfflineAudioContext(2, 3 * L, sr);
    const s = oc.createBufferSource();
    s.buffer = b; s.loop = true; s.loopStart = ls; s.loopEnd = le;
    s.connect(oc.destination);
    s.start(0, ls);
    const out = (await oc.startRendering()).getChannelData(0);
    const B = b.getChannelData(0);
    const ofs = Math.round(ls * sr);
    let maxDiff = 0;
    for (let i = 0; i < out.length; i++) { const d = Math.abs(out[i] - B[(ofs + i) % L]); if (d > maxDiff) maxDiff = d; }
    const steps = new Float32Array(L - 1);
    for (let i = 1; i < L; i++) steps[i - 1] = Math.abs(B[i] - B[i - 1]);
    const sorted = Float32Array.from(steps).sort();
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const med = sorted[Math.floor(sorted.length * 0.5)];
    const wraps = [L - ofs, 2 * L - ofs].map((w) => {
      let m = 0;
      for (let i = w - 2; i <= w + 2; i++) m = Math.max(m, Math.abs(out[i] - out[i - 1]));
      return +(m / med).toFixed(2);
    });
    const loc = (w) => {
      let a = 0; for (let i = w - 2000; i < w + 2000; i++) { if (i !== w) a += Math.abs(out[i] - out[i - 1]); }
      return a / 3999;
    };
    return {
      key, sr, L, ofs, maxDiff, wrapStepOverMedian: wraps, p99OverMedian: +(p99 / med).toFixed(2),
      wrapStepOverLocalMean: [L - ofs, 2 * L - ofs].map((w) => {
        let m = 0; for (let i = w - 2; i <= w + 2; i++) m = Math.max(m, Math.abs(out[i] - out[i - 1]));
        return +(m / loc(w)).toFixed(2);
      }),
    };
  };

  /* Compare the live capture with the decoded buffer, either side of the wrap. */
  window.__analyze = (key, busGain) => {
    const sr = rec.sr; const bs = 4096; const n = rec.chunks.length;
    let blockGaps = 0;
    for (let i = 1; i < n; i++) if (Math.abs(rec.pts[i] - rec.pts[i - 1] - bs / sr) > 1e-4) blockGaps++;
    const R = new Float32Array(n * bs);
    rec.chunks.forEach((c, i) => R.set(c, i * bs));
    const ent = window.__bufs.find((x) => x.key === key);
    const b = ent.orig || ent.buf;
    const B = b.getChannelData(0); const L = B.length;
    const stl = [...window.__log].reverse().find((x) => x.e === "start" && x.key === key);
    const off = Math.round((stl.off - stl.ls) * sr);
    let first = 0; while (first < R.length && Math.abs(R[first]) < 1e-5) first++;
    const W = 8192;
    function fit(p, base) {
      // base: record index predicted for buffer position p
      let eb = 0; for (let k = 0; k < W; k++) eb += B[p + k] * B[p + k];
      let best = -2, bd = 0;
      for (let d = -5000; d <= 5000; d++) {
        const i0 = base + d; if (i0 < 0 || i0 + W > R.length) continue;
        let ab = 0, er = 0;
        for (let k = 0; k < W; k++) { const r = R[i0 + k]; ab += r * B[p + k]; er += r * r; }
        const c = ab / Math.sqrt(er * eb + 1e-30);
        if (c > best) { best = c; bd = d; }
      }
      return { d: bd, corr: +best.toFixed(6) };
    }
    const pPre = L - 3 * sr; const pPost = Math.round(0.5 * sr);
    const pre = fit(pPre, first + (pPre - off));
    const post = fit(pPost, first + (pPost + L - off));
    // gain from the pre window, then residual around the wrap using the pre shift
    const i0 = first + (pPre - off) + pre.d;
    let ab = 0, bb = 0; for (let k = 0; k < W; k++) { ab += R[i0 + k] * B[pPre + k]; bb += B[pPre + k] * B[pPre + k]; }
    const gain = ab / bb;
    const wrapIdx = first + (L - off) + pre.d;
    const resid = (a, z) => { let m = 0, s = 0, c = 0; for (let i = a; i < z; i++) { const p = ((i - first - pre.d + off) % L + L) % L; const e = R[i] - gain * B[p]; m = Math.max(m, Math.abs(e)); s += e * e; c++; } return { max: m, rms: Math.sqrt(s / c) }; };
    const near = resid(wrapIdx - 240, wrapIdx + 240);
    const farPre = resid(wrapIdx - 6000, wrapIdx - 5500);
    const farPost = resid(wrapIdx + 5500, wrapIdx + 6000);
    let sig = 0; for (let k = 0; k < W; k++) sig += (gain * B[pPre + k]) ** 2; sig = Math.sqrt(sig / W);
    return {
      key, sr, L, recSamples: R.length, blockGaps, firstAudible: first, gain: +gain.toFixed(4), expectedGain: busGain,
      pre, post, shiftDiff: post.d - pre.d, wrapIdx,
      residNear: { max: +near.max.toExponential(2), rms: +near.rms.toExponential(2) },
      residFarPre: { max: +farPre.max.toExponential(2), rms: +farPre.rms.toExponential(2) },
      residFarPost: { max: +farPost.max.toExponential(2), rms: +farPost.rms.toExponential(2) },
      signalRms: +sig.toExponential(2),
    };
  };
})();
