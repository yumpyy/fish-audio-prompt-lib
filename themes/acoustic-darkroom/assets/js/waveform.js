(function() {
  var ctx = null;
  var cache = {};

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function fetchPeaks(url, n) {
    var key = url + '|' + n;
    if (cache[key]) return Promise.resolve(cache[key]);

    return fetch(url)
      .then(function(r) { return r.arrayBuffer(); })
      .then(function(buf) { return getCtx().decodeAudioData(buf); })
      .then(function(ab) {
        var ch = ab.getChannelData(0);
        var len = ch.length;
        var peaks = new Float32Array(n);
        var spb = Math.floor(len / n);
        for (var i = 0; i < n; i++) {
          var max = 0;
          var start = i * spb;
          var end = start + spb;
          for (var j = start; j < end && j < len; j++) {
            var a = Math.abs(ch[j]);
            if (a > max) max = a;
          }
          peaks[i] = max;
        }
        var mx = 0;
        for (var i = 0; i < n; i++) if (peaks[i] > mx) mx = peaks[i];
        if (mx > 0) for (var i = 0; i < n; i++) peaks[i] /= mx;
        cache[key] = peaks;
        return peaks;
      })
      .catch(function(e) {
        console.warn('Waveform failed:', url, e.message);
        return null;
      });
  }

  function draw(canvas, peaks, pct) {
    var ctx2d = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width;
    var h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx2d.scale(dpr, dpr);

    var n = peaks.length;
    var gap = 0.5;
    var bw = Math.max(1, (w / n) - gap);
    var mid = h / 2;
    var threshold = pct * n;

    ctx2d.clearRect(0, 0, w, h);

    for (var i = 0; i < n; i++) {
      var x = (w / n) * i;
      var bh = Math.max(1, peaks[i] * (mid - 2));
      ctx2d.fillStyle = i < threshold ? '#ffffff' : '#1f1f1f';
      ctx2d.fillRect(x, mid - bh, bw, bh * 2);
    }
  }

  function initCanvas(canvas) {
    var url = canvas.dataset.audio;
    if (!url) return;
    var bars = Math.min(200, Math.max(30, Math.round(canvas.clientWidth / 2.5)));
    canvas._bars = bars;

    // Fast path: peaks precomputed at build/submit time (data-peaks = ints 0..999)
    var pre = canvas.dataset.peaks;
    if (pre) {
      try {
        var arr = JSON.parse(pre);
        var peaks = new Float32Array(arr.length);
        for (var i = 0; i < arr.length; i++) peaks[i] = arr[i] / 999;
        canvas._peaks = peaks;
        draw(canvas, peaks, 0);
        return;
      } catch (e) { /* malformed — fall through to fetch */ }
    }

    fetchPeaks(url, bars).then(function(peaks) {
      if (peaks) {
        canvas._peaks = peaks;
        draw(canvas, peaks, 0);
      }
    });
  }

  function initAll() {
    var cvs = document.querySelectorAll('.waveform-canvas');
    for (var i = 0; i < cvs.length; i++) initCanvas(cvs[i]);
  }

  function updateProgress(canvas, pct) {
    if (canvas && canvas._peaks) {
      draw(canvas, canvas._peaks, pct);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  window.waveform = { updateProgress: updateProgress };
})();
