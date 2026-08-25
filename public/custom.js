!function(o,c){var n=c.documentElement,t=" w-mod-";n.className+=t+"js",("ontouchstart"in o||o.DocumentTouch&&c instanceof DocumentTouch)&&(n.className+=t+"touch")}(window,document);






  /* iOS Safari fires window "resize" while scrolling because the URL bar
       collapse/expand changes the viewport height. Anything that redraws on
       resize (rough.js doodles especially) flickers on every scroll there.
       Doodle redraws must go through this helper: it only fires the handler
       when the viewport WIDTH actually changes (rotation / real resize). */
  function onWidthResize(handler) {
    let lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (Math.abs(window.innerWidth - lastW) < 2) return;
      lastW = window.innerWidth;
      handler();
    });
  }

  // Same problem at the ScrollTrigger level: toolbar height shifts trigger
  // ScrollTrigger.refresh(), which re-runs refresh listeners mid-scroll.
  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });
  }



  function initRippleGrid() {
    const svg = document.querySelector('[data-ripple-grid]');
    const pageShell = document.querySelector('.page-shell');
    if (!svg || !pageShell) return;

    const paths = Array.from(svg.querySelectorAll('path'));
    if (paths.length !== 5) return;

    const footerSvg = document.querySelector('[data-footer-grid]');
    const footerEl = document.querySelector('.site-footer');
    const footerPaths = footerSvg ? Array.from(footerSvg.querySelectorAll('path')) : [];

    const editorialSvg = document.querySelector('[data-editorial-line-grid]');
    const editorialEl = document.querySelector('.editorial-section');
    const editorialPaths = editorialSvg ? Array.from(editorialSvg.querySelectorAll('path')) : [];

    const curtainSvg = document.querySelector('[data-curtain-line-grid]');
    // resources.html reuses the curtain grid slot for its light browse panel
    const curtainEl = document.querySelector('.column-curtain, .resources-browse');
    const curtainPaths = curtainSvg ? Array.from(curtainSvg.querySelectorAll('path')) : [];

    const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (REDUCED_MOTION) return;

    // ---- tunables ----
    const SAMPLES = 36; // sample points per line

    // -- Continuous (proximity) field: drives slow-motion behaviour smoothly.
    //    Each line has a persistent displacement at the cursor's y, based on
    //    how close the cursor is to the line. No pulses needed for slow moves.
    const FIELD_RADIUS = 220; // px - horizontal range where cursor bends a line
    const FIELD_MAX_AMP = 10; // px - max bend from proximity alone
    const FIELD_ENV_PX = 160; // px - gaussian envelope height (absolute, cross-section)
    const FIELD_SMOOTH = 12; // 1/s - how fast the field follows the smoothed cursor

    // -- Pulses: only for fast/expressive movement. Higher threshold means
    //    slow movement doesn't spawn them at all (no stop-motion artifact).
    const HIT_RADIUS = 220; // px - range where cursor can spawn pulses
    const MAX_AMPLITUDE = 14; // px - cap per pulse
    const SPEED_TO_AMP = 0.025; // cursor px/s -> pulse amplitude contribution
    const PULSE_MIN_SPEED = 550; // px/s - pulses only spawn when moving quickly
    const PULSE_TAU = 0.38; // s - exponential decay time constant (shorter, less overlap)
    const PULSE_SPEED = 0.55; // fraction of line length per second (traveling wave)
    const WAVELENGTH = 0.45; // fraction of line length between wave peaks
    const ENV_WIDTH = 0.14; // gaussian envelope width around pulse origin
    const ENV_SPREAD = 0.06; // how fast the envelope widens with age
    const PULSE_RISE = 0.06; // s - attack/fade-in so new pulses don't pop at full amp
    const SPAWN_COOLDOWN = 0.09; // s between pulses per line
    const MAX_PULSES = 3; // per line (was 4 - fewer = less interference on reversal)
    const AMP_THRESHOLD = 0.4; // px - retire pulse when peak falls below this
    // On direction reversal near the same y, fast-decay any lingering opposite
    // pulse instead of letting it sum destructively with the new one.
    const REVERSAL_DECAY = 6.0; // 1/s applied to the old pulse's amplitude

    // -- Cursor smoothing: move events fire at irregular cadence, so we
    //    track raw pointer targets and spring toward them each frame.
    const CURSOR_SPRING = 22; // 1/s - how fast smoothed cursor chases raw cursor

    // x-position formulas, in order - match the Figma layout.
    // Frame width 1920px, lines at 64, 512, 960, 1408, 1856.
    // Expressed viewport-relative: 64px outer margins, 3 interior dividers
    // evenly spaced between them.
    const X_FORMULAS_DESKTOP = [(w) => 64, (w) => 64 + (w - 128) * 0.25, (w) => w * 0.5, (w) => 64 + (w - 128) * 0.75, (w) => w - 64];
    // Mobile: 3 lines only - two on the 24px page gutters, one centered.
    // Matches the mobile .column-curtain__col positions in hero.css.
    const GRID_MOBILE_BP = 768;
    const X_FORMULAS_MOBILE = [(w) => 24, (w) => w * 0.5, (w) => w - 24];
    const activeFormulas = () => (W <= GRID_MOBILE_BP ? X_FORMULAS_MOBILE : X_FORMULAS_DESKTOP);

    let W = 0,
      H = 0;
    let lineStates = []; // [{ baseX, samples: [{y}], pulses: [{origin,age,amp,sign,dead}], lastSpawnT }]
    let footerLineStates = [];
    let editorialLineStates = [];
    let curtainLineStates = [];

    function makeLineStates(height) {
      return activeFormulas().map((fn) => ({
        baseX: fn(W),
        samples: new Array(SAMPLES).fill(0).map((_, i) => ({ y: (i / (SAMPLES - 1)) * height })),
        pulses: [],
        lastSpawnT: -Infinity,
        fieldAmp: 0,
        fieldOrigin: height / 2,
      }));
    }

    // The HTML always ships 5 <path> elements; on mobile only 3 line states
    // exist, so blank out the unused paths after every rebuild.
    function clearStalePaths(pathList, usedCount) {
      for (let i = usedCount; i < pathList.length; i++) {
        pathList[i].setAttribute('d', 'M 0 0');
      }
    }

    function resize() {
      W = pageShell.clientWidth;
      H = window.innerHeight;
      const mainW = svg.getBoundingClientRect().width || W;
      svg.setAttribute('viewBox', `0 0 ${mainW} ${H}`);
      lineStates = makeLineStates(H);
      clearStalePaths(paths, lineStates.length);

      if (footerSvg && footerEl) {
        const fH = footerEl.clientHeight || H;
        const fW = footerSvg.getBoundingClientRect().width || W;
        footerSvg.setAttribute('viewBox', `0 0 ${fW} ${fH}`);
        footerLineStates = makeLineStates(fH);
        clearStalePaths(footerPaths, footerLineStates.length);
      }

      if (editorialSvg && editorialEl) {
        const eH = editorialEl.clientHeight || H;
        const eW = editorialSvg.getBoundingClientRect().width || W;
        editorialSvg.setAttribute('viewBox', `0 0 ${eW} ${eH}`);
        editorialLineStates = makeLineStates(eH);
        clearStalePaths(editorialPaths, editorialLineStates.length);
      }

      if (curtainSvg && curtainEl) {
        const cH = curtainEl.clientHeight || H;
        const cW = curtainSvg.getBoundingClientRect().width || W;
        curtainSvg.setAttribute('viewBox', `0 0 ${cW} ${cH}`);
        curtainLineStates = makeLineStates(cH);
        clearStalePaths(curtainPaths, curtainLineStates.length);
      }
    }

    // Build a smooth path through displaced points using quadratic Beziers
    // with midpoint smoothing - cheaper than cubic, still curvy. Returns a d string.
    function buildPath(baseX, samples, disp) {
      const n = samples.length;
      if (n < 2) return `M ${baseX} 0`;
      let d = `M ${(baseX + disp[0]).toFixed(2)} ${samples[0].y.toFixed(2)}`;
      for (let i = 1; i < n - 1; i++) {
        const x0 = baseX + disp[i];
        const y0 = samples[i].y;
        const x1 = baseX + disp[i + 1];
        const y1 = samples[i + 1].y;
        const mx = (x0 + x1) * 0.5;
        const my = (y0 + y1) * 0.5;
        d += ` Q ${x0.toFixed(2)} ${y0.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
      }
      // close to last sample
      d += ` T ${(baseX + disp[n - 1]).toFixed(2)} ${samples[n - 1].y.toFixed(2)}`;
      return d;
    }

    // ---- cursor tracking ----
    // We store the RAW cursor target (where the pointer actually is) and a
    // SMOOTHED cursor that chases it each frame. The smoothed cursor is what
    // drives both the continuous field and the speed estimate, so irregular
    // pointermove cadence cannot translate into visual jitter.
    let rawX = -9999,
      rawY = -9999,
      inside = false;
    let smX = -9999,
      smY = -9999;
    let prevSmX = -9999,
      prevSmY = -9999;
    let cursorSpeed = 0; // px/s, measured from smoothed positions on the RAF clock

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      rawX = e.clientX;
      rawY = e.clientY;
      if (!inside) {
        // first entry: snap smoothed position so the field doesn't tween in
        // from off-screen, which would ripple everything
        smX = prevSmX = rawX;
        smY = prevSmY = rawY;
        inside = true;
      }
    });

    window.addEventListener('pointerout', (e) => {
      if (e.relatedTarget) return;
      inside = false;
      rawX = rawY = -9999;
    });

    function spawnPulse(L, nowS) {
      const dx = L.baseX - smX;
      const adx = Math.abs(dx);
      const closeness = 1 - adx / HIT_RADIUS;
      const shaped = closeness * closeness;
      const amp = Math.min(MAX_AMPLITUDE, cursorSpeed * SPEED_TO_AMP * shaped);
      if (amp < 0.5) return;
      const sign = dx >= 0 ? 1 : -1;
      const origin = Math.max(0, Math.min(1, smY / H));

      // Reversal handling: if there are recent pulses on this line with the
      // opposite sign and a nearby origin, mark them for fast decay so they
      // don't destructively interfere with the new one. Interference between
      // opposite-sign overlapping sinusoids is exactly what "buggy fast back
      // and forth" looks like.
      for (let p = 0; p < L.pulses.length; p++) {
        const P = L.pulses[p];
        if (P.sign !== sign && Math.abs(P.origin - origin) < 0.25) {
          P.fadeOut = true;
        }
      }

      if (L.pulses.length >= MAX_PULSES) L.pulses.shift();
      L.pulses.push({
        origin,
        age: 0,
        amp,
        sign,
        fadeOut: false,
      });
      L.lastSpawnT = nowS;
    }

    // ---- RAF loop (gsap.ticker) ----
    let lastT = null;
    gsap.ticker.add((time) => {
      if (lastT == null) {
        lastT = time;
        return;
      }
      const dt = Math.min(0.05, time - lastT);
      lastT = time;

      const nowS = time; // gsap.ticker passes seconds

      // 1) Smooth the cursor toward the raw target. When the pointer has left
      //    the hero (inside=false) we don't move smX/smY, so the continuous
      //    field decays to zero as the active-field check fails.
      if (inside) {
        const k = 1 - Math.exp(-CURSOR_SPRING * dt);
        smX += (rawX - smX) * k;
        smY += (rawY - smY) * k;
      }

      // 2) Measure smoothed speed from frame-to-frame deltas. Because this
      //    runs on the RAF clock, dt is always ~16ms - no more jitter from
      //    irregular pointermove cadence.
      if (inside && prevSmX !== -9999) {
        const dxp = smX - prevSmX;
        const dyp = smY - prevSmY;
        const inst = Math.hypot(dxp, dyp) / dt;
        // light low-pass on the already-smooth signal
        const kSpd = 1 - Math.exp(-18 * dt);
        cursorSpeed += (inst - cursorSpeed) * kSpd;
      } else {
        cursorSpeed *= Math.exp(-6 * dt); // decay outside hero
      }
      prevSmX = smX;
      prevSmY = smY;

      // 3) Per-line update
      for (let li = 0; li < lineStates.length; li++) {
        const L = lineStates[li];

        // age pulses; retire dead ones. Pulses flagged fadeOut shrink in
        // amplitude each frame so they clear before contributing to the
        // interference pattern for a reversal pulse.
        for (let p = L.pulses.length - 1; p >= 0; p--) {
          const P = L.pulses[p];
          P.age += dt;
          if (P.fadeOut) {
            P.amp *= Math.exp(-REVERSAL_DECAY * dt);
          }
          const peak = P.amp * Math.exp(-P.age / PULSE_TAU);
          if (peak < AMP_THRESHOLD) L.pulses.splice(p, 1);
        }

        // Spawn a pulse only if the cursor is genuinely moving fast. This
        // replaces the per-event spawn model - slow movement now produces
        // zero pulses and is handled entirely by the continuous field below,
        // which eliminates the stop-motion jump between discrete pulses.
        if (inside && cursorSpeed >= PULSE_MIN_SPEED) {
          const dx = L.baseX - smX;
          const adx = Math.abs(dx);
          if (adx <= HIT_RADIUS && nowS - L.lastSpawnT >= SPAWN_COOLDOWN) {
            spawnPulse(L, nowS);
          }
        }

        // 4) Continuous proximity field: each line has a smooth target
        //    displacement based purely on where the smoothed cursor is.
        //    We tween the line's current field toward that target, so even
        //    if the cursor suddenly jumps (first entry, tab switch), the
        //    visual change is gentle.
        let fieldTarget = 0;
        let fieldOriginTarget = L.fieldOrigin;
        if (inside) {
          const dx = L.baseX - smX;
          const adx = Math.abs(dx);
          if (adx <= FIELD_RADIUS) {
            const closeness = 1 - adx / FIELD_RADIUS;
            const shaped = closeness * closeness;
            const sign = dx >= 0 ? 1 : -1;
            fieldTarget = sign * FIELD_MAX_AMP * shaped;
            fieldOriginTarget = smY;
          }
        }
        const kf = 1 - Math.exp(-FIELD_SMOOTH * dt);
        L.fieldAmp += (fieldTarget - L.fieldAmp) * kf;
        L.fieldOrigin += (fieldOriginTarget - L.fieldOrigin) * kf;

        // 5) Compose displacement: continuous field + sum of pulses
        const disp = new Array(SAMPLES);
        for (let i = 0; i < SAMPLES; i++) {
          const y01 = i / (SAMPLES - 1);

          // continuous field contribution — absolute pixel space so envelope
          // width matches identically across all section grids
          const dyPx = y01 * H - L.fieldOrigin;
          const fEnv = Math.exp(-(dyPx * dyPx) / (2 * FIELD_ENV_PX * FIELD_ENV_PX));
          let d = L.fieldAmp * fEnv;

          // pulse contributions. Attack envelope (1 - exp(-age/rise)) stops
          // pulses from popping in at full amplitude on spawn, which is what
          // makes rapid-fire back-and-forth read as "glitchy".
          for (let p = 0; p < L.pulses.length; p++) {
            const P = L.pulses[p];
            const attack = 1 - Math.exp(-P.age / PULSE_RISE);
            const decay = Math.exp(-P.age / PULSE_TAU);
            const delta = y01 - P.origin;
            const w = ENV_WIDTH + ENV_SPREAD * P.age;
            const env = Math.exp(-(delta * delta) / (2 * w * w));
            const phase = (delta - PULSE_SPEED * P.age) / WAVELENGTH;
            const wave = Math.cos(2 * Math.PI * phase);
            d += P.sign * P.amp * attack * decay * env * wave;
          }
          disp[i] = d;
        }

        paths[li].setAttribute('d', buildPath(L.baseX, L.samples, disp));
      }

      // ---- footer grid: same physics, cursor Y is footer-local ----
      if (footerPaths.length === 5 && footerLineStates.length) {
        const footerH = footerEl ? footerEl.clientHeight : H;
        const footerTop = footerEl ? footerEl.getBoundingClientRect().top : 0;
        const fSmY = smY - footerTop;
        const footerInside = inside && fSmY >= 0 && fSmY <= footerH;

        for (let li = 0; li < footerLineStates.length; li++) {
          const L = footerLineStates[li];

          for (let p = L.pulses.length - 1; p >= 0; p--) {
            const P = L.pulses[p];
            P.age += dt;
            if (P.fadeOut) P.amp *= Math.exp(-REVERSAL_DECAY * dt);
            if (P.amp * Math.exp(-P.age / PULSE_TAU) < AMP_THRESHOLD) L.pulses.splice(p, 1);
          }

          if (footerInside && cursorSpeed >= PULSE_MIN_SPEED) {
            const dx = L.baseX - smX;
            if (Math.abs(dx) <= HIT_RADIUS && nowS - L.lastSpawnT >= SPAWN_COOLDOWN) {
              const closeness = 1 - Math.abs(dx) / HIT_RADIUS;
              const amp = Math.min(MAX_AMPLITUDE, cursorSpeed * SPEED_TO_AMP * closeness * closeness);
              if (amp >= 0.5) {
                const sign = dx >= 0 ? 1 : -1;
                const origin = Math.max(0, Math.min(1, fSmY / footerH));
                for (let p = 0; p < L.pulses.length; p++) {
                  if (L.pulses[p].sign !== sign && Math.abs(L.pulses[p].origin - origin) < 0.25) L.pulses[p].fadeOut = true;
                }
                if (L.pulses.length >= MAX_PULSES) L.pulses.shift();
                L.pulses.push({ origin, age: 0, amp, sign, fadeOut: false });
                L.lastSpawnT = nowS;
              }
            }
          }

          let fieldTarget = 0;
          let fieldOriginTarget = L.fieldOrigin;
          if (inside) {
            const dx = L.baseX - smX;
            const adx = Math.abs(dx);
            if (adx <= FIELD_RADIUS) {
              const shaped = Math.pow(1 - adx / FIELD_RADIUS, 2);
              fieldTarget = (dx >= 0 ? 1 : -1) * FIELD_MAX_AMP * shaped;
              fieldOriginTarget = smY;
            }
          }
          const kf = 1 - Math.exp(-FIELD_SMOOTH * dt);
          L.fieldAmp += (fieldTarget - L.fieldAmp) * kf;
          L.fieldOrigin += (fieldOriginTarget - L.fieldOrigin) * kf;

          const disp = new Array(SAMPLES);
          for (let i = 0; i < SAMPLES; i++) {
            const y01 = i / (SAMPLES - 1);
            const dyPx = footerTop + y01 * footerH - L.fieldOrigin;
            let d = L.fieldAmp * Math.exp(-(dyPx * dyPx) / (2 * FIELD_ENV_PX * FIELD_ENV_PX));
            for (let p = 0; p < L.pulses.length; p++) {
              const P = L.pulses[p];
              const attack = 1 - Math.exp(-P.age / PULSE_RISE);
              const decay = Math.exp(-P.age / PULSE_TAU);
              const delta = y01 - P.origin;
              const w = ENV_WIDTH + ENV_SPREAD * P.age;
              const env = Math.exp(-(delta * delta) / (2 * w * w));
              const wave = Math.cos((2 * Math.PI * (delta - PULSE_SPEED * P.age)) / WAVELENGTH);
              d += P.sign * P.amp * attack * decay * env * wave;
            }
            disp[i] = d;
          }

          footerPaths[li].setAttribute('d', buildPath(L.baseX, L.samples, disp));
        }
      }

      // ---- editorial grid: same physics, cursor Y is editorial-section-local ----
      if (editorialPaths.length === 5 && editorialLineStates.length) {
        const editorialH = editorialEl ? editorialEl.clientHeight : H;
        const editorialTop = editorialEl ? editorialEl.getBoundingClientRect().top : 0;
        const eSmY = smY - editorialTop;
        const editorialInside = inside && eSmY >= 0 && eSmY <= editorialH;

        for (let li = 0; li < editorialLineStates.length; li++) {
          const L = editorialLineStates[li];

          for (let p = L.pulses.length - 1; p >= 0; p--) {
            const P = L.pulses[p];
            P.age += dt;
            if (P.fadeOut) P.amp *= Math.exp(-REVERSAL_DECAY * dt);
            if (P.amp * Math.exp(-P.age / PULSE_TAU) < AMP_THRESHOLD) L.pulses.splice(p, 1);
          }

          if (editorialInside && cursorSpeed >= PULSE_MIN_SPEED) {
            const dx = L.baseX - smX;
            if (Math.abs(dx) <= HIT_RADIUS && nowS - L.lastSpawnT >= SPAWN_COOLDOWN) {
              const closeness = 1 - Math.abs(dx) / HIT_RADIUS;
              const amp = Math.min(MAX_AMPLITUDE, cursorSpeed * SPEED_TO_AMP * closeness * closeness);
              if (amp >= 0.5) {
                const sign = dx >= 0 ? 1 : -1;
                const origin = Math.max(0, Math.min(1, eSmY / editorialH));
                for (let p = 0; p < L.pulses.length; p++) {
                  if (L.pulses[p].sign !== sign && Math.abs(L.pulses[p].origin - origin) < 0.25) L.pulses[p].fadeOut = true;
                }
                if (L.pulses.length >= MAX_PULSES) L.pulses.shift();
                L.pulses.push({ origin, age: 0, amp, sign, fadeOut: false });
                L.lastSpawnT = nowS;
              }
            }
          }

          let fieldTarget = 0;
          let fieldOriginTarget = L.fieldOrigin;
          if (inside) {
            const dx = L.baseX - smX;
            const adx = Math.abs(dx);
            if (adx <= FIELD_RADIUS) {
              const shaped = Math.pow(1 - adx / FIELD_RADIUS, 2);
              fieldTarget = (dx >= 0 ? 1 : -1) * FIELD_MAX_AMP * shaped;
              fieldOriginTarget = smY;
            }
          }
          const kf = 1 - Math.exp(-FIELD_SMOOTH * dt);
          L.fieldAmp += (fieldTarget - L.fieldAmp) * kf;
          L.fieldOrigin += (fieldOriginTarget - L.fieldOrigin) * kf;

          const disp = new Array(SAMPLES);
          for (let i = 0; i < SAMPLES; i++) {
            const y01 = i / (SAMPLES - 1);
            const dyPx = editorialTop + y01 * editorialH - L.fieldOrigin;
            let d = L.fieldAmp * Math.exp(-(dyPx * dyPx) / (2 * FIELD_ENV_PX * FIELD_ENV_PX));
            for (let p = 0; p < L.pulses.length; p++) {
              const P = L.pulses[p];
              const attack = 1 - Math.exp(-P.age / PULSE_RISE);
              const decay = Math.exp(-P.age / PULSE_TAU);
              const delta = y01 - P.origin;
              const w = ENV_WIDTH + ENV_SPREAD * P.age;
              const env = Math.exp(-(delta * delta) / (2 * w * w));
              const wave = Math.cos((2 * Math.PI * (delta - PULSE_SPEED * P.age)) / WAVELENGTH);
              d += P.sign * P.amp * attack * decay * env * wave;
            }
            disp[i] = d;
          }

          editorialPaths[li].setAttribute('d', buildPath(L.baseX, L.samples, disp));
        }
      }

      // ---- curtain grid: same physics, cursor Y is column-curtain-local ----
      if (curtainPaths.length === 5 && curtainLineStates.length) {
        const curtainH = curtainEl ? curtainEl.clientHeight : H;
        const curtainTop = curtainEl ? curtainEl.getBoundingClientRect().top : 0;
        const cSmY = smY - curtainTop;
        const curtainInside = inside && cSmY >= 0 && cSmY <= curtainH;

        for (let li = 0; li < curtainLineStates.length; li++) {
          const L = curtainLineStates[li];

          for (let p = L.pulses.length - 1; p >= 0; p--) {
            const P = L.pulses[p];
            P.age += dt;
            if (P.fadeOut) P.amp *= Math.exp(-REVERSAL_DECAY * dt);
            if (P.amp * Math.exp(-P.age / PULSE_TAU) < AMP_THRESHOLD) L.pulses.splice(p, 1);
          }

          if (curtainInside && cursorSpeed >= PULSE_MIN_SPEED) {
            const dx = L.baseX - smX;
            if (Math.abs(dx) <= HIT_RADIUS && nowS - L.lastSpawnT >= SPAWN_COOLDOWN) {
              const closeness = 1 - Math.abs(dx) / HIT_RADIUS;
              const amp = Math.min(MAX_AMPLITUDE, cursorSpeed * SPEED_TO_AMP * closeness * closeness);
              if (amp >= 0.5) {
                const sign = dx >= 0 ? 1 : -1;
                const origin = Math.max(0, Math.min(1, cSmY / curtainH));
                for (let p = 0; p < L.pulses.length; p++) {
                  if (L.pulses[p].sign !== sign && Math.abs(L.pulses[p].origin - origin) < 0.25) L.pulses[p].fadeOut = true;
                }
                if (L.pulses.length >= MAX_PULSES) L.pulses.shift();
                L.pulses.push({ origin, age: 0, amp, sign, fadeOut: false });
                L.lastSpawnT = nowS;
              }
            }
          }

          let fieldTarget = 0;
          let fieldOriginTarget = L.fieldOrigin;
          if (inside) {
            const dx = L.baseX - smX;
            const adx = Math.abs(dx);
            if (adx <= FIELD_RADIUS) {
              const shaped = Math.pow(1 - adx / FIELD_RADIUS, 2);
              fieldTarget = (dx >= 0 ? 1 : -1) * FIELD_MAX_AMP * shaped;
              fieldOriginTarget = smY;
            }
          }
          const kfc = 1 - Math.exp(-FIELD_SMOOTH * dt);
          L.fieldAmp += (fieldTarget - L.fieldAmp) * kfc;
          L.fieldOrigin += (fieldOriginTarget - L.fieldOrigin) * kfc;

          const disp = new Array(SAMPLES);
          for (let i = 0; i < SAMPLES; i++) {
            const y01 = i / (SAMPLES - 1);
            const dyPx = curtainTop + y01 * curtainH - L.fieldOrigin;
            let d = L.fieldAmp * Math.exp(-(dyPx * dyPx) / (2 * FIELD_ENV_PX * FIELD_ENV_PX));
            for (let p = 0; p < L.pulses.length; p++) {
              const P = L.pulses[p];
              const attack = 1 - Math.exp(-P.age / PULSE_RISE);
              const decay = Math.exp(-P.age / PULSE_TAU);
              const delta = y01 - P.origin;
              const w = ENV_WIDTH + ENV_SPREAD * P.age;
              const env = Math.exp(-(delta * delta) / (2 * w * w));
              const wave = Math.cos((2 * Math.PI * (delta - PULSE_SPEED * P.age)) / WAVELENGTH);
              d += P.sign * P.amp * attack * decay * env * wave;
            }
            disp[i] = d;
          }

          curtainPaths[li].setAttribute('d', buildPath(L.baseX, L.samples, disp));
        }
      }
    });

    // init + resize
    resize();
    let lastGridW = window.innerWidth;
    let lastGridH = window.innerHeight;
    window.addEventListener('resize', () => {
      const nextW = window.innerWidth;
      const nextH = window.innerHeight;
      if (Math.abs(nextW - lastGridW) < 2 && Math.abs(nextH - lastGridH) < 2) return;
      lastGridW = nextW;
      lastGridH = nextH;
      resize();
    });
    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.addEventListener('refreshInit', resize);
      ScrollTrigger.addEventListener('refresh', resize);
    }
  }



  function initBoldFullScreenNavigation() {
    // Rough.js bracket doodle around the active nav link. Uses the same
    // 8-frame "boiling" pattern as the doodle showcase so the stroke has a
    // living, hand-drawn feel.
    const reducedMotionNav = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const drawNavBracket = () => {
      const host = document.querySelector('.bold-nav-full__link.is--current [data-nav-bracket]');
      if (!host || typeof rough === 'undefined') return;
      const linkEl = host.closest('.bold-nav-full__link');
      if (!linkEl) return;
      const w = linkEl.offsetWidth;
      const h = linkEl.offsetHeight;
      if (!w || !h) return;
      host.innerHTML = '';
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      host.appendChild(svg);

      const rc = rough.svg(svg);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--e2vc-accent').trim() || '#3451f5';
      const makeBase = (frame) => (extra) => {
        const s = extra && extra.seed !== undefined ? extra.seed : 4;
        return Object.assign(
          {
            roughness: 2.8,
            strokeWidth: 3,
            stroke: accent,
            fill: 'none',
          },
          extra,
          { seed: s + frame * 17 },
        );
      };
      const inset = Math.max(6, Math.min(w, h) * 0.04);
      const tipLen = Math.max(14, h * 0.12);
      const top = Math.max(4, h * 0.12);
      const bot = h - Math.max(4, h * 0.12);
      const left = inset;
      const right = w - inset;
      const drawBracket = (rc, b) => [rc.line(left + tipLen, top, left, top, b({ seed: 3, roughness: 1.6 })), rc.line(left, top, left, bot, b({ seed: 5, roughness: 2.2 })), rc.line(left, bot, left + tipLen, bot, b({ seed: 7, roughness: 1.6 })), rc.line(right - tipLen, top, right, top, b({ seed: 11, roughness: 1.6 })), rc.line(right, top, right, bot, b({ seed: 13, roughness: 2.2 })), rc.line(right, bot, right - tipLen, bot, b({ seed: 17, roughness: 1.6 }))];

      const frames = [];
      const firstPaths = [];
      for (let f = 0; f < 8; f++) {
        const frameG = document.createElementNS(svgNS, 'g');
        frameG.setAttribute('filter', 'url(#ink-texture)');
        if (f > 0) frameG.style.display = 'none';
        drawBracket(rc, makeBase(f)).forEach((g) => frameG.appendChild(g));
        svg.appendChild(frameG);
        frames.push(frameG);
        if (f === 0) frameG.querySelectorAll('path').forEach((p) => firstPaths.push(p));
      }

      if (!reducedMotionNav) {
        firstPaths.forEach((p) => {
          const len = p.getTotalLength();
          p.style.strokeDasharray = `${len} ${len + 1}`;
          p.style.strokeDashoffset = `${len}`;
        });
      }
      host.__frames = frames;
      host.__firstPaths = firstPaths;
    };

    const animateNavBracket = () => {
      const host = document.querySelector('.bold-nav-full__link.is--current [data-nav-bracket]');
      if (!host || !host.__frames || typeof gsap === 'undefined') return;
      if (reducedMotionNav) {
        if (typeof startBoiling === 'function') startBoiling([host.__frames]);
        return;
      }
      gsap.fromTo(
        host.__firstPaths,
        { strokeDashoffset: (i, el) => el.getTotalLength() },
        {
          strokeDashoffset: 0,
          duration: 1.4,
          ease: 'power2.out',
          stagger: 0.05,
          delay: 0.55,
          onComplete: () => {
            if (typeof startBoiling === 'function') startBoiling([host.__frames]);
          },
        },
      );
    };

    // NEW badge doodle rectangle — drawn with Rough.js, boils like all other doodles.
    const drawNewBadge = () => {
      const host = document.querySelector('[data-new-badge]');
      if (!host || typeof rough === 'undefined') return;
      const svg = host.querySelector('.bold-nav-full__badge-svg');
      if (!svg) return;
      const rect = host.getBoundingClientRect();
      const w = rect.width || host.offsetWidth;
      const h = rect.height || host.offsetHeight;
      if (!w || !h) return;
      svg.innerHTML = '';
      const pad = 1;
      const svgNS = 'http://www.w3.org/2000/svg';
      svg.setAttribute('viewBox', `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--e2vc-accent').trim() || '#3451f5';
      const rc = rough.svg(svg);
      const frames = [];
      for (let f = 0; f < 8; f++) {
        const g = document.createElementNS(svgNS, 'g');
        g.setAttribute('filter', 'url(#ink-texture)');
        if (f > 0) g.style.display = 'none';
        const el = rc.rectangle(-pad, -pad, w + pad * 2, h + pad * 2, {
          roughness: 2.2,
          strokeWidth: 1.8,
          stroke: accent,
          fill: 'none',
          seed: 42 + f * 13,
        });
        g.appendChild(el);
        svg.appendChild(g);
        frames.push(g);
      }
      // animate draw-on for the first frame paths
      const firstPaths = Array.from(frames[0].querySelectorAll('path'));
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        firstPaths.forEach((p) => {
          const len = p.getTotalLength();
          p.style.strokeDasharray = `${len} ${len + 1}`;
          p.style.strokeDashoffset = `${len}`;
        });
        gsap &&
          gsap.to(firstPaths, {
            strokeDashoffset: 0,
            duration: 0.5,
            ease: 'power2.out',
            stagger: 0.05,
            delay: 0.4,
            onComplete: () => {
              if (typeof startBoiling === 'function') startBoiling([frames]);
            },
          });
      } else {
        if (typeof startBoiling === 'function') startBoiling([frames]);
      }
    };

    // Draw badge once nav opens (rough.js and layout are ready).
    const _origAnimateNav = animateNavBracket;
    // Hook into nav open; we patch the toggle handler below after it's defined.
    window.__drawNewBadge = drawNewBadge;

    let navBracketReady = false;
    onWidthResize(() => {
      if (!navBracketReady) return;
      drawNavBracket();
      const host = document.querySelector('.bold-nav-full__link.is--current [data-nav-bracket]');
      if (host && host.__firstPaths)
        host.__firstPaths.forEach((p) => {
          p.style.strokeDashoffset = 0;
        });
      if (host && host.__frames && typeof startBoiling === 'function') startBoiling([host.__frames]);
      drawNewBadge();
    });

    // Toggle Navigation
    document.querySelectorAll('[data-navigation-toggle="toggle"]').forEach((toggleBtn) => {
      toggleBtn.addEventListener('click', () => {
        const navStatusEl = document.querySelector('[data-navigation-status]');
        if (!navStatusEl) return;
        if (navStatusEl.getAttribute('data-navigation-status') === 'not-active') {
          navStatusEl.setAttribute('data-navigation-status', 'active');
          if (!navBracketReady) {
            drawNavBracket();
            navBracketReady = true;
            // small delay so layout has settled before measuring the badge
            requestAnimationFrame(() => requestAnimationFrame(drawNewBadge));
          }
          animateNavBracket();
          // If you use Lenis you can 'stop' Lenis here: Example Lenis.stop();
        } else {
          navStatusEl.setAttribute('data-navigation-status', 'not-active');
          // If you use Lenis you can 'start' Lenis here: Example Lenis.start();
        }
      });
    });

    // Close Navigation
    document.querySelectorAll('[data-navigation-toggle="close"]').forEach((closeBtn) => {
      closeBtn.addEventListener('click', () => {
        const navStatusEl = document.querySelector('[data-navigation-status]');
        if (!navStatusEl) return;
        navStatusEl.setAttribute('data-navigation-status', 'not-active');
        // If you use Lenis you can 'start' Lenis here: Example Lenis.start();
      });
    });

    // Clicking the current page's link inside the open menu just closes
    // the menu — no reload, no navigation.
    document.querySelectorAll('.bold-nav-full__link.is--current').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const navStatusEl = document.querySelector('[data-navigation-status]');
        if (!navStatusEl) return;
        navStatusEl.setAttribute('data-navigation-status', 'not-active');
      });
    });

    // Key ESC - Close Navigation
    document.addEventListener('keydown', (e) => {
      if (e.keyCode === 27) {
        const navStatusEl = document.querySelector('[data-navigation-status]');
        if (!navStatusEl) return;
        if (navStatusEl.getAttribute('data-navigation-status') === 'active') {
          navStatusEl.setAttribute('data-navigation-status', 'not-active');
          // If you use Lenis you can 'start' Lenis here: Example Lenis.start();
        }
      }
    });
  }



  /* ---------- Text Reveal (word-by-word Y translate) ----------
 Applies to every [data-text-reveal] element.
   - data-text-reveal="hero"   → plays after loader ready (e2vc:ready).
   - data-text-reveal="scroll" → plays once the element scrolls into
     view (ScrollTrigger at top 85%, once).
 Pure Y movement, no mask, no opacity. Snappy stagger. */
  function drawHeadlineTasteScribble(heading) {
    const tasteEl = heading.querySelector('.headline__friends');
    if (!tasteEl || typeof rough === 'undefined') return;
    if (tasteEl.__scribbled) return;
    tasteEl.__scribbled = true;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let svg, rc;
    const frames = [];

    // Recomputes size/position and regenerates the ellipse paths in place,
    // without removing or recreating the svg/group elements.
    const renderFrames = () => {
      const w = tasteEl.offsetWidth;
      const h = tasteEl.offsetHeight;
      const padX = w * 0.18;
      const padY = h * 0.32;
      const svgW = w + padX * 2;
      const svgH = h + padY * 2;

      svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
      svg.style.left = `${-padX}px`;
      svg.style.top = `${-padY}px`;
      svg.style.width = `${svgW}px`;
      svg.style.height = `${svgH}px`;

      frames.forEach((frameG, f) => {
        const shape = rc.ellipse(svgW / 2, svgH / 2, svgW * 0.9, svgH * 0.82, {
          roughness: 2.8,
          strokeWidth: 3.5,
          stroke: '#3451f5',
          fill: 'none',
          seed: 4 + f * 17,
        });
        frameG.replaceChildren(shape);
      });
    };

    const drawRoughCircle = () => {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'taste-rough-circle');
      svg.setAttribute('aria-hidden', 'true');
      rc = rough.svg(svg);

      for (let f = 0; f < 8; f++) {
        const frameG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        frameG.setAttribute('filter', 'url(#ink-texture)');
        if (f > 0) frameG.style.display = 'none';
        svg.appendChild(frameG);
        frames.push(frameG);
      }

      tasteEl.appendChild(svg);
      renderFrames();

      if (!reducedMotion) {
        gsap.registerPlugin(DrawSVGPlugin);
        const paths = frames[0].querySelectorAll('path');
        gsap.from(paths, {
          drawSVG: '0%',
          duration: 2.0,
          stagger: 0.15,
          ease: 'power2.out',
          onComplete: () => startBoiling([frames]),
        });
      } else {
        startBoiling([frames]);
      }
    };

    gsap.delayedCall(0.05, drawRoughCircle);

    if (!heading.__scribbleResizeObserver && 'ResizeObserver' in window) {
      let _scribbleT;
      let skippedInitial = false;
      const ro = new ResizeObserver(() => {
        // ResizeObserver fires once immediately on observe() with the current
        // size — skip that so it doesn't clobber the in-progress intro animation.
        if (!skippedInitial) {
          skippedInitial = true;
          return;
        }
        clearTimeout(_scribbleT);
        _scribbleT = setTimeout(() => {
          if (svg) renderFrames();
        }, 150);
      });
      ro.observe(tasteEl);
      heading.__scribbleResizeObserver = ro;
    }
  }



  function initTextReveal() {
    if (typeof SplitText === 'undefined' || typeof ScrollTrigger === 'undefined') {
      console.warn('SplitText or ScrollTrigger missing; skipping text reveal.');
      return;
    }
    gsap.registerPlugin(SplitText, ScrollTrigger);

    document.querySelectorAll('[data-text-reveal]').forEach((el) => {
      if (el.__textRevealDone) return;
      el.__textRevealDone = true;

      const mode = el.dataset.textReveal || 'scroll';

      SplitText.create(el, {
        type: 'lines, words',
        mask: 'lines',
        linesClass: 'text-reveal-line',
        wordsClass: 'text-reveal-word',
        autoSplit: true,
        onSplit: function (instance) {
          const words = instance.words;
          gsap.set(words, { yPercent: 110 });

          const tween = gsap.to(words, {
            yPercent: 0,
            duration: 0.7,
            stagger: 0.045,
            ease: 'power4.out',
            paused: true,
            onStart: () => {
              gsap.set(el, { visibility: 'visible' });
            },
            onComplete: () => {
              // Clear the line-mask clip once words have landed so
              // absolutely-positioned decorations (e.g. the taste
              // scribble) can overflow the line box.
              el.querySelectorAll('.text-reveal-line, .text-reveal-line *').forEach((node) => {
                const ov = node.style.overflow;
                if (ov === 'clip' || ov === 'hidden' || node.classList.contains('text-reveal-line')) {
                  node.style.overflow = 'visible';
                }
              });
              el.classList.add('is-revealed');
              if (el.querySelector('.headline__friends')) {
                drawHeadlineTasteScribble(el);
              }
            },
          });

          if (mode === 'hero') {
            const play = () => gsap.delayedCall(0.45, () => tween.play());
            if (window.__e2vcReady) play();
            else window.addEventListener('e2vc:ready', play, { once: true });
          } else {
            ScrollTrigger.create({
              trigger: el,
              start: 'top 85%',
              once: true,
              onEnter: () => tween.play(),
            });
          }

          return tween;
        },
      });
    });
  }



  /* ---------- Editorial theme switch (Osmo-style scrub) ----
   Scrub the editorial section's CSS variables from cream to navy as the
   section enters the viewport, so the theme change reads as a single
   continuous transition instead of a hard seam. */
  /* ---------- Column Curtain transition (light → dark) ----
   Pinned section. Scroll progress 0→1 grows four dark columns inside the
   four grid tracks. Stagger order is 1, 3, 2, 4 (non-sequential) so it
   reads as a scattered fill rather than a wipe. */
  /* ---------- Column curtain + "from the group chat" — single continuous pin ----
   Phase 1: dark columns rise (scroll distance = 1 viewport height).
   Phase 2: "from the group chat" pans right→left with elastic letter bounce
            (scroll distance = text overflow width).
   One ScrollTrigger pins the section for both phases so there is no
   unpin/repin gap between the column fill and the text slide. */
  function initNavThemeOverFooter() {
    if (document.body.hasAttribute('no-initNavThemeOverFooter')) return;

    const nav = document.querySelector('.bold-nav-full');
    const targets = document.querySelectorAll('.site-footer, .editorial-section');
    if (!nav || !targets.length || !('IntersectionObserver' in window)) return;
    const navHeight = 80;
    const active = new Set();
    let io;
    const buildIO = () => {
      if (io) io.disconnect();
      active.clear();
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) active.add(entry.target);
            else active.delete(entry.target);
          });
          if (active.size) nav.setAttribute('data-nav-theme', 'light');
          else nav.removeAttribute('data-nav-theme');
        },
        { rootMargin: `0px 0px -${window.innerHeight - navHeight}px 0px`, threshold: 0 },
      );
      targets.forEach((t) => io.observe(t));
    };
    buildIO();
    let _navIOT;
    window.addEventListener('resize', () => {
      clearTimeout(_navIOT);
      _navIOT = setTimeout(buildIO, 150);
    });
  }



  /* Magnifying-glass doodle, drawn + boiled exactly like drawDoodleAsterisk:          
    rough.js strokes, 8 pre-rendered frames cycled by startBoiling, textured          
    via the #ink-texture filter. 64×64 coordinate box. */
  function drawDoodleSearch(svgEl, color) {
    if (typeof rough === 'undefined') return;
    svgEl.innerHTML = '';
    const rc = rough.svg(svgEl);
    const cx = 26,
      cy = 26,
      r = 16; // lens
    const hx1 = cx + r * 0.7,
      hy1 = cy + r * 0.7,
      hx2 = 55,
      hy2 = 55; // handle
    const mkOpts = (f, s) => ({
      roughness: 2.6,
      strokeWidth: 3.2,
      stroke: color,
      fill: 'none',
      seed: s + f * 17,
    });
    const frames = [];
    for (let f = 0; f < 8; f++) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('filter', 'url(#ink-texture)');
      if (f > 0) g.style.display = 'none';
      g.appendChild(rc.circle(cx, cy, r * 2, mkOpts(f, 1)));
      g.appendChild(rc.line(hx1, hy1, hx2, hy2, mkOpts(f, 7)));
      svgEl.appendChild(g);
      frames.push(g);
    }
    startBoiling([frames]);
  }



  /* ---------- Footer clocks (multi-timezone) ---------- */
  function initFooterClock() {
    const els = document.querySelectorAll('[data-footer-clock]');
    if (!els.length) return;
    const formatters = new Map();
    const partsFormatters = new Map();
    const tick = () => {
      const now = new Date();
      els.forEach((el) => {
        const tz = el.getAttribute('data-footer-clock');
        if (!formatters.has(tz)) {
          formatters.set(
            tz,
            new Intl.DateTimeFormat('en-US', {
              timeZone: tz,
              hour: 'numeric',
              minute: '2-digit',
            }),
          );
        }
        el.textContent = formatters.get(tz).format(now);
      });
    };
    tick();
    setInterval(tick, 30000);

    // Analog clock: show on hover, point hands at the hovered city's time
    const footer = document.querySelector('.site-footer');
    const clock = document.querySelector('[data-footer-analog]');
    if (!footer || !clock) return;

    const getHM = (tz) => {
      if (!partsFormatters.has(tz)) {
        partsFormatters.set(
          tz,
          new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          }),
        );
      }
      const parts = partsFormatters.get(tz).formatToParts(new Date());
      const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
      return { h: get('hour') % 12, m: get('minute'), s: get('second') };
    };

    const setHands = (tz) => {
      const { h, m, s } = getHM(tz);
      const minuteDeg = m * 6 + s * 0.1;
      const hourDeg = h * 30 + m * 0.5;
      clock.style.setProperty('--clock-hour', hourDeg + 'deg');
      clock.style.setProperty('--clock-minute', minuteDeg + 'deg');
    };

    let activeTz = null;
    const rows = document.querySelectorAll('.site-footer__meta-row');
    rows.forEach((row) => {
      const timeEl = row.querySelector('[data-footer-clock]');
      if (!timeEl) return;
      const tz = timeEl.getAttribute('data-footer-clock');
      const enter = () => {
        activeTz = tz;
        setHands(tz);
        footer.setAttribute('data-clock-active', 'true');
      };
      const leave = () => {
        activeTz = null;
        footer.removeAttribute('data-clock-active');
      };
      row.addEventListener('mouseenter', enter);
      row.addEventListener('mouseleave', leave);
      row.addEventListener('focusin', enter);
      row.addEventListener('focusout', leave);
    });

    setInterval(() => {
      if (activeTz) setHands(activeTz);
    }, 1000);
  }



  /* ---------- Falling 2D Objects (Osmo: falling-2d-objects-matterjs) ---------- */
  function initFooterParallax() {
    const wrap = document.querySelector('[data-footer-parallax]');
    if (!wrap) return;
    const inner = wrap.querySelector('[data-footer-parallax-inner]');
    const dark = wrap.querySelector('[data-footer-parallax-dark]');
    if (!inner) return;

    let lastP = -1;
    function tick() {
      const rect = wrap.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 = footer just entering viewport; 1 = footer fully in viewport
      const p = Math.max(0, Math.min(1, 1 - rect.top / vh));
      if (p !== lastP) {
        lastP = p;
        inner.style.transform = `translateY(${(1 - p) * -25}%) rotate(0.001deg)`;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }



  /* ---------- Shutter Scroll Transition (Osmo: shutter-scroll-transition) ----
   Pasted verbatim from Osmo snippet. Do not modify data attributes or
   animation approach. Builds shutter rows inside each
   [data-shutter-scroll-transition] wrapper and drives a ScrollTrigger
   scaleY timeline per instance.                                           */
  function initGlobalChromatic() {
    const AMP = 8;
    function wire(stage) {
      if (stage.__chromaticBound) return;
      stage.__chromaticBound = true;
      const layers = Array.from(stage.querySelectorAll('img'));
      if (layers.length < 3) return;
      const setters = layers.map((el) => ({
        x: gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3.out' }),
        y: gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3.out' }),
      }));
      const host = stage.parentElement || stage;
      host.addEventListener('pointermove', (e) => {
        const r = stage.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        setters[0].x(nx * AMP);
        setters[0].y(ny * AMP);
        setters[1].x(-nx * AMP * 0.25);
        setters[1].y(-ny * AMP * 0.25);
        setters[2].x(-nx * AMP);
        setters[2].y(-ny * AMP);
      });
      host.addEventListener('pointerleave', () => {
        setters.forEach((s) => {
          s.x(0);
          s.y(0);
        });
      });
    }

    function wireAll() {
      document.querySelectorAll('[data-chromatic-stage]').forEach(wire);
    }

    // Wire static stacks immediately, then defer a second pass two frames
    // out so the overlapping slider's clones (added inside a rAF boot) are
    // also covered. Rerun on resize because the slider rebuilds clones
    // when viewport width changes.
    wireAll();
    requestAnimationFrame(() => requestAnimationFrame(wireAll));
    let lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (Math.abs(window.innerWidth - lastW) < 2) return;
      lastW = window.innerWidth;
      requestAnimationFrame(() => requestAnimationFrame(wireAll));
    });
  }



  /* ---------- Editorial cards: cursor parallax + scroll-in reveal ---------- */
  function initNavDoodleAsterisk() {
    const svgEl = document.querySelector('.bold-nav-full__menu-dot');
    if (!svgEl) return;
    const nav = svgEl.closest('[data-navigation-status]') || document.querySelector('.bold-nav-full__bar');
    const redraw = () => {
      const isLightFooter = document.documentElement.hasAttribute('data-footer-tone');
      const isLightNav = nav && nav.getAttribute('data-nav-theme') === 'light';
      const isNavOpen = nav && nav.closest('[data-navigation-status="active"]');
      let color;
      if (isLightFooter && isLightNav) color = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
      else if (isLightNav || isNavOpen) color = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      else color = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
      drawDoodleAsterisk(svgEl, color);
    };
    redraw();
    if (nav) {
      new MutationObserver(redraw).observe(nav, { attributes: true, attributeFilter: ['data-nav-theme', 'data-navigation-status'] });
    }
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-footer-tone'] });
  }



  function initFooterDoodleAsterisks() {
    document.querySelectorAll('.site-footer__dot').forEach((svgEl) => {
      const color = getComputedStyle(svgEl).color;
      drawDoodleAsterisk(svgEl, color);
    });
  }



  function startBoiling(frameSets) {
    if (!frameSets || !frameSets.length) return;

    const store = (window.__boilStore = window.__boilStore || []);

    const swapOne = (entry) => {
      const n = entry.frames.length;
      if (n < 2) return;
      let next = Math.floor(Math.random() * (n - 1));
      if (next >= entry.current) next += 1;
      entry.frames[entry.current].style.display = 'none';
      entry.frames[next].style.display = '';
      entry.current = next;
    };

    const newEntries = frameSets.map((frames) => ({ frames, current: 0 }));
    newEntries.forEach((entry) => store.push(entry));

    // Swap immediately so a doodle doesn't sit static right after its
    // intro animation finishes, waiting for the shared timer's next tick.
    newEntries.forEach(swapOne);

    if (window.__boilStarted) return;
    window.__boilStarted = true;

    setInterval(() => {
      for (let i = store.length - 1; i >= 0; i--) {
        if (!store[i].frames[0].isConnected) store.splice(i, 1);
      }
      store.forEach(swapOne);
    }, 500);
  }



  function initSelectionColorCycle() {
    const FOOTER_COLORS = ['#E4FC53', '#31FE6A', '#C294FF', '#FF5001', '#2D51FF', '#FF6FFF', '#680030'];
    const LIGHT_TONE_INDICES = new Set([0, 1]); // #E4FC53, #31FE6A
    const root = document.documentElement;
    let i = 0;
    root.addEventListener('selectstart', () => {
      const bg = FOOTER_COLORS[i % FOOTER_COLORS.length];
      const ink = LIGHT_TONE_INDICES.has(i % FOOTER_COLORS.length) ? '#1c2121' : '#fcf7f0';
      root.style.setProperty('--selection-bg', bg);
      root.style.setProperty('--selection-ink', ink);
      i++;
    });
  }

  document.addEventListener('DOMContentLoaded', initSelectionColorCycle)



  function drawDoodleAsterisk(svgEl, color) {
    if (typeof rough === 'undefined') return;
    svgEl.innerHTML = '';
    const rc = rough.svg(svgEl);
    const cx = 32,
      cy = 32,
      r = 22,
      spokes = 3;
    const mkOpts = (f, s) => ({
      roughness: 2.6,
      strokeWidth: 3.2,
      stroke: color,
      fill: 'none',
      seed: s + f * 17,
    });
    const frames = [];
    for (let f = 0; f < 8; f++) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('filter', 'url(#ink-texture)');
      if (f > 0) g.style.display = 'none';
      for (let i = 0; i < spokes; i++) {
        const a = (Math.PI / spokes) * i;
        g.appendChild(rc.line(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx - Math.cos(a) * r, cy - Math.sin(a) * r, mkOpts(f, i * 3 + 1)));
      }
      svgEl.appendChild(g);
      frames.push(g);
    }
    startBoiling([frames]);
  }



  function initFalling2DMatterJS() {
    const canvas = document.querySelector('#canvas-target');
    if (!canvas) return;
    if (typeof Matter === 'undefined') return;

    let canvasWidth = canvas.clientWidth + 2;
    let canvasHeight = canvas.clientHeight + 2;
    const canvasWallDepth = canvasWidth / 4;
    const smileyAmount = 4;
    const smileySize = Math.min(canvasWidth / 4.5, canvasHeight / 2.2);
    const smileySizeTexture = 256;
    const smileySizeScale = smileySize / smileySizeTexture;
    const smileyRestitution = 0.5;
    const worldGravity = 1.6;
    const bodySize = smileySize * 0.55;

    let { Engine, Render, Runner, Bodies, Body, Composite, Mouse, MouseConstraint, Events } = Matter;

    let engine = Engine.create();
    engine.world.gravity.y = worldGravity;

    let render = Render.create({
      element: canvas,
      engine: engine,
      options: {
        background: 'transparent',
        wireframes: false,
        width: canvasWidth,
        height: canvasHeight,
        pixelRatio: 2,
        border: 'none',
      },
    });

    function getRandomNumber(min, max) {
      return Math.random() * (max - min) + min;
    }

    let min = smileySize / 2;
    let max = canvasWidth - smileySize / 2;

    // Letter textures: e, 2, v, c — Inter Tight 900, 256x256 SVG as data URI.
    const letterTexture = (char, fill = '%23fcf7f0') => {
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256' viewBox='0 0 256 256'><text x='128' y='128' text-anchor='middle' dominant-baseline='central' font-family='Inter Tight, system-ui, sans-serif' font-weight='900' font-size='220' fill='${fill}' letter-spacing='-8'>${char}</text></svg>`;
      return 'data:image/svg+xml;utf8,' + svg.replace(/#/g, '%23').replace(/"/g, "'");
    };

    const letterChars = ['e', '2', 'v', 'c'];
    const letterImgs = {};
    const rebuildLetterImgs = (fill) => {
      letterChars.forEach((c) => {
        const img = new Image();
        img.src = letterTexture(c, fill);
        letterImgs[c] = img;
      });
    };
    rebuildLetterImgs('%23fcf7f0');

    let textureIndex = 0;

    // Per-letter collision box sized as a fraction of smileySize.
    // w/h = collision size; x/y = offset relative to the rendered glyph.
    const LETTER_TUNING = {
      e: { w: 0.45, h: 0.47, x: 0.02, y: 0.09 },
      2: { w: 0.47, h: 0.6, x: 0.02, y: 0.02 },
      v: { w: 0.5, h: 0.46, x: 0.01, y: 0.1 },
      c: { w: 0.46, h: 0.47, x: 0.02, y: 0.1 },
    };

    function createLetterBody(x, y, char, scale) {
      const s = scale || 1;
      const t = LETTER_TUNING[char] || { w: 0.8, h: 0.8 };
      const body = Bodies.rectangle(x, y, smileySize * t.w * s, smileySize * t.h * s, {
        restitution: smileyRestitution,
        friction: 0.05,
        render: { visible: false },
      });
      body.letterChar = char;
      body.scaleFactor = s;
      return body;
    }

    const smileyCreate = (x, y) => {
      const spawnX = typeof x === 'number' ? x : getRandomNumber(min, max);
      const spawnY = typeof y === 'number' ? y : smileySize;
      const char = letterChars[textureIndex];
      textureIndex = (textureIndex + 1) % letterChars.length;
      const body = createLetterBody(spawnX, spawnY, char);
      Composite.add(engine.world, body);
    };

    let boxTop = Bodies.rectangle(canvasWidth / 2 + canvasWallDepth * 2, canvasHeight + canvasWallDepth, canvasWidth + canvasWallDepth * 4, canvasWallDepth * 2, { isStatic: true });
    let boxLeft = Bodies.rectangle(canvasWallDepth * -1, canvasHeight / 2, canvasWallDepth * 2, canvasHeight, { isStatic: true });
    let boxRight = Bodies.rectangle(canvasWidth + canvasWallDepth, canvasHeight / 2, canvasWallDepth * 2, canvasHeight, { isStatic: true });
    let boxBottom = Bodies.rectangle(canvasWidth / 2 + canvasWallDepth * 2, canvasWallDepth * -1, canvasWidth + canvasWallDepth * 4, canvasWallDepth * 2, { isStatic: true });

    Composite.add(engine.world, [boxTop, boxLeft, boxRight, boxBottom]);

    Render.run(render);
    let runner = Runner.create();
    Matter.Runner.run(runner, engine);

    Events.on(render, 'afterRender', () => {
      const ctx = render.context;
      const bodies = Composite.allBodies(engine.world);
      for (const body of bodies) {
        if (!body.letterChar) continue;
        const img = letterImgs[body.letterChar];
        if (!img || !img.complete || !img.naturalWidth) continue;
        const t = LETTER_TUNING[body.letterChar] || { x: 0, y: 0 };
        const offX = (t.x || 0) * smileySize;
        const offY = (t.y || 0) * smileySize;
        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);
        // Draw sprite shifted by -offset so the collision box (at body centre)
        // sits +offset within the rendered glyph.
        const s = body.scaleFactor || 1;
        const drawSize = smileySize * s;
        ctx.drawImage(img, -drawSize / 2 - offX * s, -drawSize / 2 - offY * s, drawSize, drawSize);
        ctx.restore();
      }
    });

    // Spacejump: hold Space to trigger a bullet-time slow-mo and launch all
    // letters upward. Release to return to normal speed.
    const Common = Matter.Common;
    let timeScaleTarget = 1;
    let spaceHeld = false;

    const FOOTER_COLORS = ['#E4FC53', '#31FE6A', '#C294FF', '#FF5001', '#2D51FF', '#FF6FFF', '#680030'];
    const LIGHT_TONE_INDICES = new Set([0, 1]); // #E4FC53, #31FE6A
    let footerColorIndex = 0;
    const cycleFooterColor = () => {
      const i = footerColorIndex % FOOTER_COLORS.length;
      const isLight = LIGHT_TONE_INDICES.has(i);
      document.documentElement.style.setProperty('--footer-bg', FOOTER_COLORS[i]);
      if (isLight) document.documentElement.setAttribute('data-footer-tone', 'light');
      else document.documentElement.removeAttribute('data-footer-tone');
      rebuildLetterImgs(isLight ? '%231c2121' : '%23fcf7f0');
      initFooterDoodleAsterisks();
      footerColorIndex++;
    };

    const explosion = (delta) => {
      const tScale = 1000 / 60 / delta;
      const bodies = Composite.allBodies(engine.world);
      for (const body of bodies) {
        if (body.isStatic || !body.letterChar) continue;
        const f = 0.05 * body.mass * tScale;
        Body.applyForce(body, body.position, {
          x: (f + Common.random() * f) * Common.choose([1, -1]),
          y: -f + Common.random() * -f,
        });
      }
    };

    Events.on(engine, 'afterUpdate', (event) => {
      const dt = (event.delta || 1000 / 60) / 1000;
      engine.timing.timeScale += (timeScaleTarget - engine.timing.timeScale) * 12 * dt;
    });

    const resetLetters = () => {
      const all = Composite.allBodies(engine.world).filter((b) => b.letterChar);
      all.forEach((b) => {
        if (mouseConstraint && mouseConstraint.body === b) {
          mouseConstraint.constraint.bodyB = null;
          mouseConstraint.body = null;
        }
        Composite.remove(engine.world, b);
      });
      textureIndex = 0;
      dropped = false;
      startDrop();
    };

    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!spaceHeld) {
          spaceHeld = true;
          timeScaleTarget = 0.15;
          explosion(engine.timing.lastDelta || 1000 / 60);
          cycleFooterColor();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        resetLetters();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        spaceHeld = false;
        timeScaleTarget = 1;
      }
    });

    function repeatedFunction(count, maxCount) {
      if (count < maxCount) {
        smileyCreate();
        setTimeout(() => {
          repeatedFunction(count + 1, maxCount);
        }, 180);
      }
    }

    // Hold the drop until the footer scrolls into view — surprise reveal.
    let dropped = false;
    const startDrop = () => {
      if (dropped) return;
      dropped = true;
      repeatedFunction(0, smileyAmount);
    };
    const footerEl = document.querySelector('.site-footer');
    if (footerEl && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.25) {
              startDrop();
              io.disconnect();
            }
          });
        },
        { threshold: [0, 0.25, 0.5] },
      );
      io.observe(footerEl);
    } else {
      startDrop();
    }

    let mouse = Mouse.create(render.canvas);
    let mouseConstraint = MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: {
        stiffness: 0.2,
        render: { visible: false },
      },
    });

    Composite.add(engine.world, mouseConstraint);

    let _matterResizeT;
    window.addEventListener('resize', () => {
      clearTimeout(_matterResizeT);
      _matterResizeT = setTimeout(() => {
        canvasWidth = canvas.clientWidth + 2;
        canvasHeight = canvas.clientHeight + 2;
        const wd = canvasWidth / 4;
        min = smileySize / 2;
        max = canvasWidth - smileySize / 2;
        const pr = render.options.pixelRatio || 2;
        render.options.width = canvasWidth;
        render.options.height = canvasHeight;
        render.canvas.width = canvasWidth * pr;
        render.canvas.height = canvasHeight * pr;
        render.canvas.style.width = canvasWidth + 'px';
        render.canvas.style.height = canvasHeight + 'px';
        Composite.remove(engine.world, boxTop);
        Composite.remove(engine.world, boxLeft);
        Composite.remove(engine.world, boxRight);
        Composite.remove(engine.world, boxBottom);
        boxTop = Bodies.rectangle(canvasWidth / 2 + wd * 2, canvasHeight + wd, canvasWidth + wd * 4, wd * 2, { isStatic: true });
        boxLeft = Bodies.rectangle(wd * -1, canvasHeight / 2, wd * 2, canvasHeight, { isStatic: true });
        boxRight = Bodies.rectangle(canvasWidth + wd, canvasHeight / 2, wd * 2, canvasHeight, { isStatic: true });
        boxBottom = Bodies.rectangle(canvasWidth / 2 + wd * 2, wd * -1, canvasWidth + wd * 4, wd * 2, { isStatic: true });
        Composite.add(engine.world, [boxTop, boxLeft, boxRight, boxBottom]);
      }, 150);
    });

    const canvasPoint = (e) => {
      const rect = render.canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvasWidth / rect.width),
        y: (e.clientY - rect.top) * (canvasHeight / rect.height),
      };
    };

    const letterAt = (point) => {
      const hits = Matter.Query.point(Composite.allBodies(engine.world), point);
      for (const b of hits) {
        const target = b.parent || b;
        if (target.letterChar) return target;
      }
      return null;
    };

    const detachFromMouse = (body) => {
      if (mouseConstraint.body === body) {
        mouseConstraint.constraint.bodyB = null;
        mouseConstraint.body = null;
      }
    };

    function changeLetter(body) {
      const curIdx = letterChars.indexOf(body.letterChar);
      const nextChar = letterChars[(curIdx + 1) % letterChars.length];
      const pos = { x: body.position.x, y: body.position.y };
      const angle = body.angle;
      const velocity = { x: body.velocity.x, y: body.velocity.y };
      const angularVelocity = body.angularVelocity;
      detachFromMouse(body);
      Composite.remove(engine.world, body);
      const next = createLetterBody(pos.x, pos.y, nextChar);
      Body.setAngle(next, angle);
      Body.setVelocity(next, velocity);
      Body.setAngularVelocity(next, angularVelocity);
      Composite.add(engine.world, next);
    }

    let pressStart = null;
    // Growth state for click-and-hold spawning.
    // Click: generates a letter at 1x. Click & hold: the letter grows linearly
    // up to 3x over 5 seconds while static, then drops free on mouseup.
    const GROW_MAX_SCALE = 2;
    const GROW_DURATION_MS = 2000;
    let growState = null;
    let growRAF = 0;

    function stopGrowth() {
      if (growRAF) cancelAnimationFrame(growRAF);
      growRAF = 0;
      if (growState && growState.body) {
        // Release into the world so it falls with gravity.
        Body.setStatic(growState.body, false);
      }
      growState = null;
    }

    function tickGrowth() {
      if (!growState) return;
      const elapsed = performance.now() - growState.start;
      const progress = Math.min(elapsed / GROW_DURATION_MS, 1);
      const targetScale = 1 + (GROW_MAX_SCALE - 1) * progress;
      const factor = targetScale / growState.body.scaleFactor;
      if (factor !== 1) {
        Body.scale(growState.body, factor, factor);
        growState.body.scaleFactor = targetScale;
      }
      if (progress < 1) {
        growRAF = requestAnimationFrame(tickGrowth);
      } else {
        growRAF = 0;
      }
    }

    render.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const point = canvasPoint(e);
      const hit = letterAt(point);
      if (hit) {
        pressStart = { x: point.x, y: point.y, body: hit };
      } else {
        // Spawn a letter at scale 1 and lock it in place while the mouse is
        // held. The letter grows via rAF up to 3x over 5s. mouseup releases.
        const char = letterChars[textureIndex];
        textureIndex = (textureIndex + 1) % letterChars.length;
        const body = createLetterBody(point.x, point.y, char, 1);
        Body.setStatic(body, true);
        Composite.add(engine.world, body);
        growState = { body, start: performance.now() };
        growRAF = requestAnimationFrame(tickGrowth);
        pressStart = null;
      }
    });

    render.canvas.addEventListener('mousemove', (e) => {
      if (!growState) return;
      const p = canvasPoint(e);
      Body.setPosition(growState.body, { x: p.x, y: p.y });
    });

    render.canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (growState) {
        stopGrowth();
        return;
      }
      if (!pressStart) return;
      const point = canvasPoint(e);
      const moved = Math.hypot(point.x - pressStart.x, point.y - pressStart.y);
      if (moved < 8 && pressStart.body.letterChar) {
        changeLetter(pressStart.body);
      }
      pressStart = null;
    });

    // If the cursor leaves the canvas while holding, release too.
    render.canvas.addEventListener('mouseleave', () => {
      if (growState) stopGrowth();
    });

    render.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const hit = letterAt(canvasPoint(e));
      if (hit) {
        detachFromMouse(hit);
        Composite.remove(engine.world, hit);
      }
      pressStart = null;
    });

    mouseConstraint.mouse.element.removeEventListener('mousewheel', mouseConstraint.mouse.mousewheel);
    mouseConstraint.mouse.element.removeEventListener('DOMMouseScroll', mouseConstraint.mouse.mousewheel);

    mouseConstraint.mouse.element.removeEventListener('touchstart', mouseConstraint.mouse.mousedown);
    mouseConstraint.mouse.element.removeEventListener('touchmove', mouseConstraint.mouse.mousemove);
    mouseConstraint.mouse.element.removeEventListener('touchend', mouseConstraint.mouse.mouseup);

    mouseConstraint.mouse.element.addEventListener('touchstart', mouseConstraint.mouse.mousedown, { passive: true });
    mouseConstraint.mouse.element.addEventListener('touchmove', (e) => {
      if (mouseConstraint.body) {
        mouseConstraint.mouse.mousemove(e);
      }
    });
    mouseConstraint.mouse.element.addEventListener('touchend', (e) => {
      if (mouseConstraint.body) {
        mouseConstraint.mouse.mouseup(e);
      }
    });

    // Catch-and-release combo: while holding one letter, every clean
    // collision (start -> end, both while still held) ticks a combo counter
    // floating above the held letter. Dropping the held letter resets.
    const footerRoot = document.querySelector('.site-footer');
    if (footerRoot) {
      const comboEl = document.createElement('div');
      comboEl.className = 'site-footer__combo';
      const comboInner = document.createElement('span');
      comboInner.className = 'site-footer__combo-inner';
      comboEl.appendChild(comboInner);
      footerRoot.appendChild(comboEl);

      let heldBody = null;
      let comboCount = 0;
      // Partner id -> { body } for bodies currently in contact with held.
      const activePartners = new Map();
      // Partner id -> { body } for bodies that separated but haven't yet
      // cleared the distance threshold. Re-contact cancels; enough distance
      // promotes to +1.
      const pendingReleases = new Map();
      // Require partners to move at least this far from the held body's
      // centre before a catch-and-release counts. Filters out tiny jitter
      // collisions where bodies touch and barely part.
      const RELEASE_DISTANCE = smileySize * 0.9;
      // Partner must be airborne (not resting on the floor or another
      // letter) at the moment of contact. Resting bodies have speed ~0;
      // a falling/tossed body is well above this.
      const AIRBORNE_SPEED_MIN = 2;
      let bumpTimer = 0;

      // ── Cursor Confetti (Osmo / GSAP Physics2D-style) ──────────────────
      // Canvas is fixed over the full viewport so particles aren't clipped
      // by the footer's overflow:hidden. Particles are plain JS objects;
      // GSAP drives x/y/alpha while we paint each frame via afterRender.
      const confettiCanvas = document.createElement('canvas');
      confettiCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
      document.body.appendChild(confettiCanvas);
      const confettiCtx = confettiCanvas.getContext('2d');
      let confettiParticles = [];

      const resizeConfettiCanvas = () => {
        confettiCanvas.width = window.innerWidth;
        confettiCanvas.height = window.innerHeight;
      };
      resizeConfettiCanvas();
      window.addEventListener('resize', resizeConfettiCanvas);

      // Palette lifted from e2VC brand / footer colours.
      const CONFETTI_SHAPES = ['rect', 'circle', 'strip'];

      const fireConfetti = (originX, originY) => {
        const isLightTone = document.documentElement.hasAttribute('data-footer-tone');
        const CONFETTI_COLORS = isLightTone ? ['#1c2121'] : ['#fcf7f0'];
        const COUNT = 48;
        for (let i = 0; i < COUNT; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 4 + Math.random() * 9;
          const p = {
            x: originX,
            y: originY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - (3 + Math.random() * 4),
            gy: 0.35 + Math.random() * 0.25,
            alpha: 1,
            size: 5 + Math.random() * 6,
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            shape: CONFETTI_SHAPES[Math.floor(Math.random() * CONFETTI_SHAPES.length)],
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.25,
            life: 0,
          };
          confettiParticles.push(p);
          gsap.to(p, {
            life: 1,
            duration: 1.2 + Math.random() * 0.6,
            ease: 'power1.in',
            onUpdate() {
              p.alpha = 1 - p.life;
            },
            onComplete() {
              confettiParticles = confettiParticles.filter((q) => q !== p);
            },
          });
        }
        // Start the draw loop if not already running.
        if (!confettiRafId) confettiRafId = requestAnimationFrame(drawConfetti);
      };

      // Own RAF loop — independent of Matter so particles draw even when
      // the physics engine has gone quiet between interactions.
      let confettiRafId = null;
      const drawConfetti = () => {
        confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
        for (const p of confettiParticles) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += p.gy;
          p.rot += p.rotSpeed;
          confettiCtx.save();
          confettiCtx.globalAlpha = Math.max(0, p.alpha);
          confettiCtx.translate(p.x, p.y);
          confettiCtx.rotate(p.rot);
          confettiCtx.fillStyle = p.color;
          if (p.shape === 'circle') {
            confettiCtx.beginPath();
            confettiCtx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            confettiCtx.fill();
          } else if (p.shape === 'strip') {
            confettiCtx.fillRect(-p.size / 2, -p.size / 6, p.size, p.size / 3);
          } else {
            confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          }
          confettiCtx.restore();
        }
        confettiRafId = confettiParticles.length > 0 ? requestAnimationFrame(drawConfetti) : null;
      };
      // ── end Cursor Confetti ─────────────────────────────────────────────

      const showCombo = () => {
        // Subtle easter egg: hide the counter until the user chains two
        // catch-and-releases in a row. 1x is counted internally but never
        // rendered.
        if (comboCount < 2) return;
        comboInner.textContent = comboCount + 'x';
        comboEl.classList.add('is-active');
        comboEl.classList.remove('is-bump');
        void comboEl.offsetWidth;
        comboEl.classList.add('is-bump');
        clearTimeout(bumpTimer);
        bumpTimer = setTimeout(() => comboEl.classList.remove('is-bump'), 300);

        // Fire confetti on every 10x milestone.
        if (comboCount % 10 === 0 && heldBody) {
          const rect = render.canvas.getBoundingClientRect();
          const scaleX = rect.width / canvasWidth;
          const scaleY = rect.height / canvasHeight;
          const cx = rect.left + heldBody.position.x * scaleX;
          const cy = rect.top + heldBody.position.y * scaleY;
          fireConfetti(cx, cy);
        }
      };

      const hideCombo = () => {
        comboEl.classList.remove('is-active');
      };

      Events.on(mouseConstraint, 'startdrag', (e) => {
        const b = e.body;
        if (!b || !b.letterChar) return;
        heldBody = b;
        comboCount = 0;
        activePartners.clear();
        pendingReleases.clear();
        comboInner.textContent = '0x';
      });

      Events.on(mouseConstraint, 'enddrag', () => {
        heldBody = null;
        comboCount = 0;
        activePartners.clear();
        pendingReleases.clear();
        hideCombo();
      });

      const otherIfHeld = (pair) => {
        if (!heldBody) return null;
        if (pair.bodyA === heldBody && pair.bodyB.letterChar) return pair.bodyB;
        if (pair.bodyB === heldBody && pair.bodyA.letterChar) return pair.bodyA;
        return null;
      };

      Events.on(engine, 'collisionStart', (event) => {
        if (!heldBody) return;
        for (const pair of event.pairs) {
          const other = otherIfHeld(pair);
          if (!other) continue;
          // Skip letters that are effectively at rest (sitting on the
          // floor / stacked). Only airborne catches count.
          const speed = Math.hypot(other.velocity.x, other.velocity.y);
          if (speed < AIRBORNE_SPEED_MIN) continue;
          // New contact or re-contact while pending — treat as active again,
          // cancel any pending promotion.
          pendingReleases.delete(other.id);
          activePartners.set(other.id, other);
        }
      });

      Events.on(engine, 'collisionEnd', (event) => {
        if (!heldBody) return;
        for (const pair of event.pairs) {
          const other = otherIfHeld(pair);
          if (other && activePartners.has(other.id)) {
            activePartners.delete(other.id);
            // Defer counting until the partner clears RELEASE_DISTANCE.
            pendingReleases.set(other.id, other);
          }
        }
      });

      // Reposition combo label and promote pending releases once they've
      // moved far enough from the held letter.
      Events.on(render, 'afterRender', () => {
        if (!heldBody) return;

        if (pendingReleases.size) {
          const hx = heldBody.position.x;
          const hy = heldBody.position.y;
          const toRemove = [];
          pendingReleases.forEach((body, id) => {
            // Body may have been removed (e.g., reset).
            if (!body.letterChar || body.id !== id) {
              toRemove.push(id);
              return;
            }
            const dx = body.position.x - hx;
            const dy = body.position.y - hy;
            if (Math.hypot(dx, dy) >= RELEASE_DISTANCE) {
              toRemove.push(id);
              comboCount += 1;
              showCombo();
            }
          });
          toRemove.forEach((id) => pendingReleases.delete(id));
        }

        const rect = render.canvas.getBoundingClientRect();
        const scaleX = rect.width / canvasWidth;
        const scaleY = rect.height / canvasHeight;
        // Anchor label's bottom-left at the held letter's top-right corner.
        const rightX = rect.left + heldBody.bounds.max.x * scaleX;
        const topY = rect.top + heldBody.bounds.min.y * scaleY;
        const OFFSET_X = 6;
        const OFFSET_Y = 6;
        comboEl.style.transform = 'translate(' + (rightX + OFFSET_X) + 'px, ' + (topY - OFFSET_Y) + 'px) translate(0, -100%)';
      });
    }
  }



  /* ---------- Dynamic Text Cursor (shared) ----------
   Osmo Supply: Scramble Text Cursor. Two-line variant: name + company.
   Velocity lean via --rot CSS variable on .cursor-scramble-lean.
   stripState is defined in hero.js when the slider exists; falls back to 0. */
  function initScrambleTextCursor() {
    gsap.registerPlugin(ScrambleTextPlugin);

    const cursor = document.querySelector('[data-cursor]');
    const lean = cursor && cursor.querySelector('.cursor-scramble-lean');
    const nameTarget = cursor && cursor.querySelector('[data-cursor-name-target]');
    const coTarget = cursor && cursor.querySelector('[data-cursor-company-target]');

    if (!cursor || !lean || !nameTarget || !coTarget) return;
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const scrambleChars = 'XYZxy#&@0$€£';
    let activeHoverItem = null;
    let mouseX = 0;
    let mouseY = 0;
    let hasMouseMoved = false;

    const xTo = gsap.quickTo(cursor, 'x', { duration: 0.4, ease: 'power3.out' });
    const yTo = gsap.quickTo(cursor, 'y', { duration: 0.4, ease: 'power3.out' });

    function updateCursor() {
      const hoverItem = document.elementFromPoint(mouseX, mouseY)?.closest('[data-cursor-hover]');
      const rect = cursor.getBoundingClientRect();
      const isHovering = !!hoverItem;
      const isEdge = rect.right >= window.innerWidth;
      cursor.setAttribute('data-cursor', isHovering ? (isEdge ? 'active-edge' : 'active') : '');

      if (hoverItem !== activeHoverItem) {
        const name = hoverItem?.getAttribute('data-cursor-text') || '';
        const co = hoverItem?.getAttribute('data-cursor-company') || '';
        gsap.to(nameTarget, { duration: 0.6, overwrite: 'auto', scrambleText: { text: name, chars: scrambleChars, speed: 1.2 } });
        gsap.to(coTarget, { duration: 0.5, overwrite: 'auto', scrambleText: { text: co, chars: scrambleChars, speed: 1.4 } });
        activeHoverItem = hoverItem;
      }
    }

    window.addEventListener('mousemove', (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      hasMouseMoved = true;
      xTo(mouseX);
      yTo(mouseY);
      requestAnimationFrame(updateCursor);
    });

    window.addEventListener(
      'scroll',
      () => {
        if (!hasMouseMoved) return;
        requestAnimationFrame(updateCursor);
      },
      { passive: true },
    );

    const MAX_ROT_DEG = 20;
    const STRIP_VEL_NORM = 500;
    const MOUSE_VEL_NORM = 800;
    const CURSOR_SMOOTH = 22;
    let smRot = 0;
    let lastTickTime = null;
    let lastMouseX = 0;
    let mouseVelX = 0;
    let lastMouseTime = null;

    window.addEventListener(
      'mousemove',
      (e) => {
        const now = performance.now() / 1000;
        if (lastMouseTime != null) {
          const dt = Math.min(0.05, now - lastMouseTime);
          if (dt > 0) mouseVelX = (e.clientX - lastMouseX) / dt;
        }
        lastMouseX = e.clientX;
        lastMouseTime = now;
      },
      { passive: true },
    );

    gsap.ticker.add((time) => {
      if (lastTickTime == null) {
        lastTickTime = time;
        return;
      }
      const dt = Math.min(0.05, time - lastTickTime);
      lastTickTime = time;
      const stripVel = (typeof stripState !== 'undefined' ? stripState.value : 0) || 0;
      const stripNorm = Math.max(-1, Math.min(1, stripVel / STRIP_VEL_NORM));
      mouseVelX *= Math.pow(0.85, dt * 60);
      const mouseNorm = Math.max(-1, Math.min(1, mouseVelX / MOUSE_VEL_NORM));
      const norm = Math.abs(stripNorm) > Math.abs(mouseNorm) ? stripNorm : mouseNorm;
      const shaped = Math.sign(norm) * (norm * norm);
      const k = 1 - Math.exp(-CURSOR_SMOOTH * dt);
      smRot += (shaped - smRot) * k;
      lean.style.setProperty('--rot', (-smRot * MAX_ROT_DEG).toFixed(2) + 'deg');
    });
  }



  /* ---------- Idle screensaver (classic DVD-player bounce) ----------
   After 5s of no input, dim the page and bounce the e2VC logo around
   the viewport, reversing off the edges and cycling the brand palette
   on each hit (with a scale-pop flourish on a true corner hit). Any
   input dismisses it instantly. Desktop only; respects reduced motion. */
  function initIdleScreensaver() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const IDLE_MS = 45000;
    const SPEED = 110; // px/s
    // accent (--e2vc-accent) + footer palette (see FOOTER_COLORS, initFalling2DMatterJS)
    const COLORS = ['#3451f5', '#E4FC53', '#31FE6A', '#C294FF', '#FF5001', '#2D51FF', '#FF6FFF', '#680030'];

    // Exact nav logo markup (see .bold-nav-full__logo). fill="currentColor"
    // so the bouncing colour is driven by the element's `color`.
    const LOGO_SVG = '<svg viewBox="0 0 84 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + '<path fill-rule="evenodd" clip-rule="evenodd" d="M24.0214 19.7005C25.9701 18.234 27.919 16.7676 29.8678 15.3013L24.0214 19.7005Z"/>' + '<path fill-rule="evenodd" clip-rule="evenodd" d="M24.0214 19.7005L29.8678 15.3013L35.7066 10.9078C36.0217 10.6543 36.6403 10.0837 36.9865 9.13999C37.5586 7.58132 36.9185 6.15087 36.8562 6.01808C36.3659 4.96942 35.5609 4.44529 35.1981 4.21622C33.9314 3.41572 32.6636 3.4622 32.1725 3.4871C31.6577 3.51324 30.4948 3.64479 29.3245 4.45027C28.9148 4.73246 28.0517 5.40888 27.4779 6.6169C27.0682 7.47965 26.9602 8.28969 26.949 8.87648C26.942 9.24913 26.6389 9.54792 26.2661 9.54792H24.1613C23.7773 9.54792 23.4692 9.23212 23.478 8.84826C23.5041 7.71453 23.7511 5.8193 24.9937 3.96433C26.0174 2.43636 27.277 1.59187 27.9487 1.20386C29.8509 0.104576 31.6498 0 32.4431 0C33.383 0 35.2886 0.146904 37.1451 1.32794C37.936 1.8309 38.4437 2.34714 38.5977 2.50815C40.0059 3.97968 40.4236 5.61554 40.5344 6.11435C40.7096 6.90241 40.9483 8.57396 40.2156 10.4576C39.5493 12.1706 38.4209 13.1803 37.8837 13.6052L37.8725 13.6136C35.0362 15.7521 32.1999 17.8906 29.3631 20.0287H39.8378C40.2152 20.0287 40.5211 20.3346 40.5211 20.7118V22.7896C40.5211 23.1668 40.2152 23.4727 39.8378 23.4727H24.2688C23.8914 23.4727 23.5855 23.1668 23.5855 22.7896V20.574C23.5855 20.2304 23.747 19.9071 24.0214 19.7005ZM17.2834 2.28033C19.2786 3.72654 20.2662 5.48483 20.6735 6.32351C21.8392 8.72376 21.8073 10.9132 21.7334 11.8938L21.7118 12.0648C21.6466 12.5727 21.214 12.9533 20.7017 12.9533H3.48543C3.50702 13.7185 3.65191 15.0153 4.40209 16.3586C5.56907 18.4476 7.93004 20.1661 10.8174 20.198C13.3656 20.2263 15.7465 18.9344 17.1273 16.8105C17.3104 16.5292 17.6217 16.3586 17.9572 16.3586H20.1463C20.6436 16.3586 20.9766 16.8736 20.7682 17.3251C20.4506 18.0123 19.9927 18.8178 19.3301 19.6324C17.6769 21.665 15.7262 22.5543 14.9158 22.8767C12.2559 23.9341 9.91861 23.642 8.97954 23.4735C6.52184 23.0315 4.8492 21.8542 4.08989 21.2434C3.30775 20.6143 1.84725 19.2606 0.899044 17.0259C0.426603 15.9125 0.147206 14.7232 0.0637608 13.5172C-0.0271572 12.1976 -0.0391966 10.8182 0.150527 9.50725C0.448605 7.45724 1.26853 5.97658 1.71606 5.2682C3.02835 3.1908 4.71179 2.09608 5.49476 1.64707C6.3068 1.18146 8.19822 0.236541 10.78 0.209567C11.6485 0.200438 14.516 0.274719 17.2834 2.28033ZM10.8174 3.65351C7.36377 3.6921 4.36223 6.15087 3.64111 9.54792C8.47762 9.53464 13.3145 9.52095 18.1515 9.50725C17.4009 6.06954 14.3167 3.61408 10.8174 3.65351Z"/>' + '<g transform="translate(41 0)">' + '<path d="M32.8352 24C30.6364 24 28.6908 23.4889 26.9968 22.4652C25.3028 21.4414 23.9749 20.0308 23.0132 18.2285C22.0516 16.4278 21.5708 14.3516 21.5708 12C21.5708 9.6484 22.0436 7.57384 22.991 5.77153C23.9367 3.97081 25.2582 2.55858 26.9522 1.53483C28.6463 0.512671 30.5775 0 32.746 0C34.9145 0 36.8363 0.480828 38.516 1.44248C40.1941 2.40414 41.4933 3.73995 42.4088 5.44991L40.0269 6.73159C39.3248 5.41966 38.3392 4.38954 37.0735 3.63964C35.8061 2.89134 34.3636 2.51718 32.746 2.51718C31.1284 2.51718 29.6398 2.92159 28.3724 3.7304C27.1051 4.53921 26.1132 5.65371 25.3951 7.0739C24.677 8.4941 24.3188 10.1356 24.3188 11.9968C24.3188 13.858 24.685 15.4995 25.4174 16.9197C26.1498 18.3399 27.1576 19.4544 28.4393 20.2632C29.721 21.072 31.1873 21.4764 32.8352 21.4764C34.4831 21.4764 35.9494 21.0577 37.2311 20.2171C38.5128 19.378 39.4904 18.2094 40.1622 16.7143L42.5903 17.996C41.6748 19.8588 40.3692 21.3236 38.6752 22.3919C36.9811 23.4603 35.0323 24 32.8352 24ZM9.66273 23.4507L0 0.552471H2.83879L11.1052 20.2359L19.3716 0.552471H22.2566L12.5939 23.4507H12.4553H9.75507H9.66273Z"/>' + '</g></svg>';

    let overlay = null,
      logo = null,
      inner = null;
    let active = false;
    let logoW = 0,
      logoH = 0;
    let x = 0,
      y = 0,
      vx = 0,
      vy = 0;
    let colorIndex = 0;
    let idleTimer = null;

    function build() {
      overlay = document.createElement('div');
      overlay.className = 'dvd-screensaver';
      logo = document.createElement('div');
      logo.className = 'dvd-screensaver__logo';
      inner = document.createElement('div');
      inner.className = 'dvd-screensaver__logo-inner';
      inner.innerHTML = LOGO_SVG;
      logo.appendChild(inner);
      overlay.appendChild(logo);
      document.body.appendChild(overlay);
      inner.addEventListener('animationend', () => inner.classList.remove('is-corner'));
    }

    function bounds() {
      const r = logo.getBoundingClientRect();
      logoW = r.width;
      logoH = r.height;
    }

    function activate() {
      if (active) return;
      if (!overlay) build();
      bounds();
      active = true;
      colorIndex = Math.floor(Math.random() * COLORS.length);
      x = Math.random() * Math.max(0, window.innerWidth - logoW);
      y = Math.random() * Math.max(0, window.innerHeight - logoH);
      const ang = Math.random() * Math.PI * 2;
      vx = Math.cos(ang) * SPEED;
      vy = Math.sin(ang) * SPEED;
      logo.style.color = COLORS[colorIndex];
      logo.style.transform = `translate(${x}px, ${y}px)`;
      overlay.classList.add('is-active');
    }

    function deactivate() {
      if (!active) return;
      active = false;
      if (overlay) overlay.classList.remove('is-active');
    }

    function resetTimer() {
      if (active) {
        deactivate();
      }
      clearTimeout(idleTimer);
      if (document.hidden) return;
      idleTimer = setTimeout(activate, IDLE_MS);
    }

    let lastT = null;
    gsap.ticker.add((time) => {
      if (!active) {
        lastT = null;
        return;
      }
      if (lastT == null) {
        lastT = time;
        return;
      }
      const dt = Math.min(0.05, time - lastT);
      lastT = time;

      x += vx * dt;
      y += vy * dt;

      const maxX = window.innerWidth - logoW;
      const maxY = window.innerHeight - logoH;
      let hitX = false,
        hitY = false;

      if (x <= 0) {
        x = 0;
        vx = Math.abs(vx);
        hitX = true;
      } else if (x >= maxX) {
        x = maxX;
        vx = -Math.abs(vx);
        hitX = true;
      }
      if (y <= 0) {
        y = 0;
        vy = Math.abs(vy);
        hitY = true;
      } else if (y >= maxY) {
        y = maxY;
        vy = -Math.abs(vy);
        hitY = true;
      }

      if (hitX || hitY) {
        colorIndex = (colorIndex + 1) % COLORS.length;
        logo.style.color = COLORS[colorIndex];
        if (hitX && hitY) {
          inner.classList.remove('is-corner');
          void inner.offsetWidth;
          inner.classList.add('is-corner');
        }
      }

      logo.style.transform = `translate(${x}px, ${y}px)`;
    });

    ['mousemove', 'pointerdown', 'mousedown', 'keydown', 'wheel', 'scroll'].forEach((ev) => {
      window.addEventListener(ev, resetTimer, { passive: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearTimeout(idleTimer);
        deactivate();
      } else resetTimer();
    });
    window.addEventListener('resize', () => {
      if (active && logo) bounds();
    });

    resetTimer();
  }



  document.querySelectorAll('.bold-nav-full__link').forEach((a) => {
    console.log(a.href);
    if (a.href.endsWith(window.location.pathname)) a.classList.add('is--current');

    const bracket = document.createElement('div');
    bracket.setAttribute('data-nav-bracket', '');
    bracket.classList.add('bold-nav-full__bracket');
    a.appendChild(bracket);
  });

  document.querySelectorAll('a').forEach((a) => {
    if (a.getAttribute('href').trim() === '') a.remove();
  });



  var PALETTE = [
    { hex: '#E4FC53', ink: 'dark' },
    { hex: '#31FE6A', ink: 'dark' },
    { hex: '#C294FF', ink: 'light' },
    { hex: '#FF5001', ink: 'light' },
    { hex: '#2D51FF', ink: 'light' },
    { hex: '#FF6FFF', ink: 'light' },
    { hex: '#680030', ink: 'light' },
  ];

  function shuffleGrid(el) {
    var cards = Array.from(el.children);
    var pool = PALETTE.slice();
    cards.forEach(function (card) {
      var idx = Math.floor(Math.random() * pool.length);
      var c = pool.splice(idx, 1)[0];
      card.style.background = c.hex;
      card.classList.remove('ink-dark', 'ink-light');
      card.classList.add(c.ink === 'dark' ? 'ink-dark' : 'ink-light');
    });
  }

  document.querySelectorAll('[randomcolors]').forEach((elm) => shuffleGrid(elm));



  document.addEventListener('DOMContentLoaded', () => {
    let i = 0,
      interval = setInterval(() => {
        i++;
        dispatchEvent(new CustomEvent('resize'));
        if (i === 2) clearInterval(interval);
      }, 2000);
  });



  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.querySelector('.bold-nav-full__bar');
    const divider = document.querySelector('.bold-nav-full__divider');

    let lastScrollY = window.scrollY;

    // Adjust this to match the height you want to hide (e.g. bar's own height)
    const HIDE_DISTANCE = 100; // px to translate upward
    const SCROLL_THRESHOLD = 5; // ignore tiny scroll jitters

    function setTransform(hide) {
      const value = hide ? `translateY(-${HIDE_DISTANCE}px)` : 'translateY(0)';
      if (bar) bar.style.transform = value;
      if (divider) divider.style.transform = value;
    }

    function onScroll() {
      const currentScrollY = window.scrollY;
      const diff = currentScrollY - lastScrollY;

      if (Math.abs(diff) > SCROLL_THRESHOLD) {
        if (diff > 0 && currentScrollY > HIDE_DISTANCE) {
          // Scrolling down
          setTransform(true);
        } else {
          // Scrolling up
          setTransform(false);
        }
        lastScrollY = currentScrollY;
      }
    }

    window.addEventListener('scroll', onScroll);

    // Optional: make sure the transition is smooth
    [bar, divider].forEach((el) => {
      if (el) {
        el.style.transition = 'all 0.3s ease 0.7s';
      }
    });
  });



  /* ---------- Shared strip state (read by the cursor, written by the strip) ---------- */
  // `value` is the strip's effective velocity each frame. Positive = cards
  // drifting up-right in screen space. The cursor reads this each frame to
  // stretch / tilt / brighten itself.
  const stripState = { value: 0 };



  function initOverlappingSlider() {
    gsap.registerPlugin(CustomEase, InertiaPlugin, DrawSVGPlugin);
    CustomEase.create('osmo', '0.625, 0.05, 0, 1');

    // Osmo Supply: Momentum Based Hover (Inertia) — tuning constants
    const MOMENTUM_XY_MULT = 12;
    const MOMENTUM_ROT_MULT = 8;
    const MOMENTUM_RESISTANCE = 400;
    const momentumClampXY = gsap.utils.clamp(-1080, 1080);
    const momentumClampRot = gsap.utils.clamp(-60, 60);

    const inits = document.querySelectorAll('[data-overlap-slider-init]');
    if (!inits.length) return;

    inits.forEach(setupOverlappingSlider);

    function setupOverlappingSlider(init) {
      const list = init.querySelector('[data-overlap-slider-list]');
      const sourceItems = Array.from(init.querySelectorAll('[data-overlap-slider-item]'));

      if (!list || !sourceItems.length) {
        console.warn('OverlappingSlider: missing structure');
        return;
      }

      // Accessibility
      init.setAttribute('role', 'region');
      init.setAttribute('aria-roledescription', 'carousel');
      init.setAttribute('aria-label', 'Portfolio - drifts on its own, drag or scroll to influence');

      // ---- tunables ----
      // Negative BASE_DRIFT = idle autoplay drifts DOWN-LEFT in screen space
      // (cards travel toward lower-left by default).
      const BASE_DRIFT = -40; // px/s - steady autoplay (negative = down-left)
      const FRICTION = 5.5; // 1/s - how fast velocity settles to baseDrift (snappier)
      const MAX_VELOCITY = 700; // px/s - safety clamp
      // Flipped sign so scroll-down -> DOWN-LEFT boost, scroll-up -> UP-RIGHT reverse
      const SCROLL_SPEED_GAIN = -0.4; // page scroll speed (px/s) -> strip velocity multiplier
      const SCROLL_MAX_BOOST = 450; // px/s - magnitude cap on scroll boost
      const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Per-item drag lag: higher = more stagger/delay when dragging, so each
      // card trails the one "ahead" of it in the drag direction. Keep modest
      // so the strip still reads as a coherent unit.
      const ITEM_LAG_SPRING = 14; // stiffness (1/s) - softer = more visible trail
      const ITEM_LAG_DAMPING = 0.85; // <1 = springier overshoot on release
      const ITEM_LAG_MAX_PX = 56; // max offset per card, px along the strip axis
      const ITEM_ROT_MAX_DEG = 6; // max velocity-driven rotation per card
      const ITEM_ROT_GAIN = 0.012; // stripVel x weight -> target rotation (deg)

      // ---- one-time DOM work: clone source items to fill >3 viewport widths ----
      function readStepPx() {
        // read the CSS token so it matches whatever media query is active
        const px = parseFloat(getComputedStyle(init).getPropertyValue('--strip-step-x'));
        return Number.isFinite(px) && px > 0 ? px : 333;
      }

      let stepPx = readStepPx();
      let setWidth = sourceItems.length * stepPx; // px in one original set
      let totalWidth = 0; // px in the whole cloned strip

      // All items currently in the list (originals + clones), with their
      // per-item spring-lag state.
      let itemStates = []; // [{ el, lag, lagVel }]

      function rebuildItemStates() {
        itemStates = Array.from(list.querySelectorAll('[data-overlap-slider-item]')).map((el) => ({ el, lag: 0, lagVel: 0, rot: 0, rotVel: 0 }));
      }

      function fillTrack() {
        // remove previous clones (anything not in the sourceItems array)
        Array.from(list.children).forEach((child) => {
          if (!sourceItems.includes(child)) list.removeChild(child);
        });

        stepPx = readStepPx();
        setWidth = sourceItems.length * stepPx;

        // We need the track long enough that any translation up to setWidth
        // has visible cards covering the viewport. 3x viewport width is a safe floor.
        const targetWidth = Math.max(window.innerWidth * 3, setWidth * 3);
        const copies = Math.max(3, Math.ceil(targetWidth / setWidth));

        // Append (copies - 1) additional sets after the originals
        for (let c = 1; c < copies; c++) {
          sourceItems.forEach((srcItem) => {
            const clone = srcItem.cloneNode(true);
            clone.setAttribute('aria-hidden', 'true');
            list.appendChild(clone);
          });
        }

        totalWidth = setWidth * copies;
        rebuildItemStates();
      }

      // ---- state ----
      let position = 0; // 0..setWidth, the amount of "strip travel" we've consumed
      let velocity = BASE_DRIFT;
      let lastTime = null;
      let anchorX = 0; // the base x-translation before modulo offset

      // scroll-velocity tracking (separate from strip velocity)
      let lastScrollY = window.scrollY || 0;
      let lastScrollT = performance.now();
      let scrollVel = 0; // smoothed px/s of page scroll (positive = down)

      // pointer drag state
      let pointerDown = false; // finger/mouse is down, gesture not yet classified
      let pointerActive = false; // gesture classified as horizontal drag of strip
      let pointerId = null;
      let lastPointerX = 0;
      let lastPointerY = 0;
      let pointerStartX = 0;
      let pointerStartY = 0;
      let lastPointerTime = 0;
      let dragLatestDx = 0;
      let isDraggingClass = false;
      let isPressed = false; // pointer currently down on the strip
      const GESTURE_THRESHOLD = 6; // px before we commit to horizontal drag
      const PRESS_SCALE = 0.96; // all cards shrink slightly while held

      function setAnchor() {
        // center the strip so the middle set is on-screen
        anchorX = -totalWidth / 2;
      }

      function applyTransform() {
        // Seamless wrap: we translate by (anchor - position), and whenever
        // position crosses setWidth, the visual state is identical one set
        // earlier - so we mod it. This is the infinite part.
        const wrapped = ((position % setWidth) + setWidth) % setWidth;
        gsap.set(list, { x: anchorX - wrapped });
      }

      // Per-item spring-lag - each card's offset lazily trails the strip's
      // motion so dragging/spinning feels like an elastic chain rather than
      // a rigid bar. Further-from-center cards have a smaller spring, so
      // they visibly drag behind; they all settle back to 0 when idle.
      function updateItemLags(dt, stripVel) {
        if (!itemStates.length) return;
        const viewportCenterX = window.innerWidth * 0.5;

        for (let i = 0; i < itemStates.length; i++) {
          const st = itemStates[i];

          // Find each card's local horizontal center once per frame. We use
          // getBoundingClientRect on the item's parent list translation, which
          // is acceptable for ~15-30 cards at 60fps.
          const rect = st.el.getBoundingClientRect();
          const itemCenterX = rect.left + rect.width * 0.5;
          // Distance from viewport center, normalised to [-1, +1] roughly.
          // Items to the RIGHT of center get positive weight; LEFT get negative.
          const dx = (itemCenterX - viewportCenterX) / Math.max(1, window.innerWidth * 0.5);
          const weight = Math.max(-1.5, Math.min(1.5, dx)); // clamp to +/-1.5

          // Target lag: proportional to strip velocity x weight, clamped.
          // Sign: positive stripVel advances position (cards drift up-right).
          // We want trailing cards to lag BEHIND the motion, so their local
          // offset goes OPPOSITE the motion direction. Right-side items (positive
          // weight) lag when the strip moves left (negative stripVel), and vice
          // versa, which gives the chain-stretch feel.
          let target = -stripVel * weight * 0.12;
          if (target > ITEM_LAG_MAX_PX) target = ITEM_LAG_MAX_PX;
          if (target < -ITEM_LAG_MAX_PX) target = -ITEM_LAG_MAX_PX;

          // spring toward target (under-damped for a springier overshoot)
          const accel = (target - st.lag) * ITEM_LAG_SPRING - st.lagVel * ITEM_LAG_SPRING * ITEM_LAG_DAMPING;
          st.lagVel += accel * dt;
          st.lag += st.lagVel * dt;

          // Rotation target: cards tilt opposite the motion (trailing edge
          // swings up), weighted by position so edges rotate more than center.
          let rotTarget = -stripVel * weight * ITEM_ROT_GAIN;
          if (rotTarget > ITEM_ROT_MAX_DEG) rotTarget = ITEM_ROT_MAX_DEG;
          if (rotTarget < -ITEM_ROT_MAX_DEG) rotTarget = -ITEM_ROT_MAX_DEG;

          const rAccel = (rotTarget - st.rot) * ITEM_LAG_SPRING - st.rotVel * ITEM_LAG_SPRING * ITEM_LAG_DAMPING;
          st.rotVel += rAccel * dt;
          st.rot += st.rotVel * dt;

          // apply translation + rotation on the flex slot (card-tilt keeps its
          // own static tilt underneath, so these compose cleanly)
          st.el.style.transform = `translate3d(${st.lag}px, 0, 0) rotate(${st.rot}deg)`;
        }
      }

      // ---- RAF loop via gsap.ticker ----
      function tick(time) {
        // gsap.ticker.add callback receives time in seconds
        if (lastTime == null) {
          lastTime = time;
          return;
        }
        // Freeze the strip while the Willem-style loader is handing off.
        // The loader measures card rects and teleports clones onto them;
        // any drift during that window would cause the clones to overshoot.
        if (window.__e2vcFreezeStrip) {
          lastTime = time;
          return;
        }
        const dt = Math.min(0.05, time - lastTime); // clamp dt (tab-switch safety)
        lastTime = time;

        // --- measure page scroll velocity (px/s) with exponential smoothing ---
        const nowMs = performance.now();
        const sdt = Math.max(0.001, (nowMs - lastScrollT) / 1000);
        const sy = window.scrollY || 0;
        const rawScrollVel = (sy - lastScrollY) / sdt; // +ve = scrolling down
        // low-pass filter so a single event-loop jitter doesn't spike it
        const smoothing = 1 - Math.exp(-8 * sdt); // ~120ms time constant
        scrollVel += (rawScrollVel - scrollVel) * smoothing;
        lastScrollY = sy;
        lastScrollT = nowMs;

        // While dragging, position is moved 1:1 with the finger inside
        // the pointermove handler - no velocity-driven motion this frame.
        if (pointerActive) {
          // still publish drag velocity for the cursor, and update item lags
          stripState.value = velocity;
          updateItemLags(dt, velocity);
          return;
        }

        // Scroll boost is capped so no scroll can make the strip feel nuts.
        const boost = Math.max(-SCROLL_MAX_BOOST, Math.min(SCROLL_MAX_BOOST, scrollVel * SCROLL_SPEED_GAIN));
        const target = REDUCED_MOTION ? 0 : BASE_DRIFT + boost;

        // ease velocity toward the target (baseDrift + scroll boost)
        const k = 1 - Math.exp(-FRICTION * dt);
        velocity += (target - velocity) * k;

        // clamp for safety
        if (velocity > MAX_VELOCITY) velocity = MAX_VELOCITY;
        if (velocity < -MAX_VELOCITY) velocity = -MAX_VELOCITY;

        position += velocity * dt;
        applyTransform();

        // publish for the cursor and drive per-item spring lags
        stripState.value = velocity;
        updateItemLags(dt, velocity);
      }

      gsap.ticker.add(tick);

      // ---- input: trackpad horizontal swipe over the slider ----
      // Two-finger horizontal swipes on a MacBook trackpad deliver wheel
      // events with dominant deltaX. When the pointer is over the strip and
      // the gesture is mostly horizontal, feed that delta straight into the
      // strip's position (and capture the resulting velocity so release feel
      // matches drag). We preventDefault only when we claim the gesture, so
      // vertical scrolling is never interrupted.
      let lastTrackpadTime = 0;
      init.addEventListener(
        'wheel',
        (e) => {
          const absX = Math.abs(e.deltaX);
          const absY = Math.abs(e.deltaY);

          // Shift+wheel on a traditional mouse also signals horizontal intent.
          const horizontalIntent = absX > absY || (e.shiftKey && absY > 0);
          if (!horizontalIntent) return;

          // Claim the gesture so vertical page scroll isn't triggered by the
          // horizontal component bleeding into deltaY.
          e.preventDefault();

          const now = performance.now();
          const dt = Math.max(0.008, Math.min(0.1, (now - lastTrackpadTime) / 1000));
          lastTrackpadTime = now;

          // Reversed direction (user preference): swipe direction MATCHES the
          // direction the cards travel.
          //   two-finger swipe LEFT  -> deltaX > 0 -> cards travel UP-RIGHT
          //   two-finger swipe RIGHT -> deltaX < 0 -> cards travel DOWN-LEFT
          // Our `position` sign: increasing position makes cards appear to move
          // UP-RIGHT. So deltaX > 0 -> position should INCREASE.
          const dx = e.shiftKey && absY > absX ? e.deltaY : e.deltaX;
          // move position immediately so the strip responds 1:1 with the swipe
          position += dx;
          applyTransform();

          // estimate velocity from this event (px/s), blend into current velocity
          const instVel = dx / dt;
          // clamp each event so a single jumbo-delta doesn't blow things up
          const clamped = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, instVel));
          // weighted blend - newer reads carry more weight but we keep some memory
          velocity = velocity * 0.3 + clamped * 0.7;
        },
        { passive: false },
      );

      // ---- input: pointer drag adds to velocity ----
      function setPressedScale(on) {
        isPressed = on;
        const cards = list.querySelectorAll('.card');
        gsap.to(cards, {
          scale: on ? PRESS_SCALE : 1,
          duration: on ? 0.22 : 0.35,
          ease: 'osmo',
          overwrite: 'auto',
        });
      }

      function onPointerDown(e) {
        // only primary button / single touch
        if (e.button != null && e.button !== 0) return;
        pointerDown = true;
        pointerActive = false; // wait until the gesture passes the threshold
        pointerId = e.pointerId;
        lastPointerX = pointerStartX = e.clientX;
        lastPointerY = pointerStartY = e.clientY;
        lastPointerTime = performance.now();
        dragLatestDx = 0;
        setPressedScale(true);
      }

      function onPointerMove(e) {
        if (!pointerDown || e.pointerId !== pointerId) return;

        const totalDx = e.clientX - pointerStartX;
        const totalDy = e.clientY - pointerStartY;

        // Classify gesture: if user hasn't crossed threshold yet, observe only.
        if (!pointerActive) {
          const absX = Math.abs(totalDx);
          const absY = Math.abs(totalDy);
          if (absX < GESTURE_THRESHOLD && absY < GESTURE_THRESHOLD) return;

          // On touch, only claim the gesture if it's mostly horizontal - otherwise
          // let the page scroll vertically.
          if (e.pointerType === 'touch' && absY > absX) {
            // give up: the page should scroll, not the strip
            pointerDown = false;
            pointerActive = false;
            pointerId = null;
            return;
          }

          // Commit: it's a horizontal drag on the strip
          pointerActive = true;
          try {
            init.setPointerCapture(pointerId);
          } catch (_) {}
          if (!isDraggingClass) {
            init.classList.add('is-dragging');
            isDraggingClass = true;
          }
          lastPointerX = e.clientX;
          lastPointerY = e.clientY;
          lastPointerTime = performance.now();
          return;
        }

        const now = performance.now();
        const dt = Math.max(0.008, (now - lastPointerTime) / 1000); // seconds, min 8ms to avoid spikes
        const dx = e.clientX - lastPointerX;
        const dy = e.clientY - lastPointerY;

        // The CSS rotates the wrap by -13.2deg (a negative angle that tilts
        // the local +x axis UP-and-RIGHT in screen space). Converting a
        // screen-space pointer delta into local-x uses the inverse rotation.
        const theta = (-13.2 * Math.PI) / 180;
        const localDx = dx * Math.cos(theta) - dy * Math.sin(theta);

        // Move the strip by the finger delta directly (1:1 tracking during drag).
        // Sign: finger moving right-up (positive localDx) drags cards right-up,
        // which in our convention means position DECREASES.
        position -= localDx;
        applyTransform();

        // Measure instantaneous velocity but ease it, so the release takes
        // the smoothed recent speed - not whatever the last single frame was.
        const instVel = -(localDx / dt);
        const k = 1 - Math.exp(-20 * dt); // ~50ms time constant
        velocity += (instVel - velocity) * k;

        dragLatestDx = localDx;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        lastPointerTime = now;
      }

      function endPointer(e) {
        const wasActive = pointerActive;
        pointerDown = false;
        pointerActive = false;
        if (pointerId != null) {
          try {
            init.releasePointerCapture(pointerId);
          } catch (_) {}
        }
        pointerId = null;
        if (isDraggingClass) {
          init.classList.remove('is-dragging');
          isDraggingClass = false;
        }
        if (isPressed) setPressedScale(false);
        if (!wasActive) return;
        // velocity already holds the latest finger speed; the tick loop will
        // decay it back toward baseDrift via friction. Clamp any absurd values.
        if (Math.abs(velocity) > MAX_VELOCITY) {
          velocity = Math.sign(velocity) * MAX_VELOCITY;
        }
      }

      init.addEventListener('pointerdown', onPointerDown);
      init.addEventListener('pointermove', onPointerMove);
      init.addEventListener('pointerup', endPointer);
      init.addEventListener('pointercancel', endPointer);
      init.addEventListener('lostpointercapture', endPointer);

      // ---- hover lift on the card under the pointer (desktop only) ----
      // .card-tilt carries a CSS rotate() (the Figma per-card tilt), so we
      // animate the inner .card instead to avoid clobbering that transform.
      const mm = gsap.matchMedia();
      let hoverEnabled = false;
      mm.add('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)', () => {
        hoverEnabled = true;
        bindHoverToAll();
        bindMomentumToAll();
        return () => {
          hoverEnabled = false;
        };
      });

      // ---- Osmo momentum hover: pointer velocity tracker ----
      // rAF-throttled so velX/velY reflect one value per frame.
      let momentumPrevX = 0,
        momentumPrevY = 0;
      let momentumVelX = 0,
        momentumVelY = 0;
      let momentumRaf = null;
      init.addEventListener('mousemove', (e) => {
        if (momentumRaf) return;
        momentumRaf = requestAnimationFrame(() => {
          momentumVelX = e.clientX - momentumPrevX;
          momentumVelY = e.clientY - momentumPrevY;
          momentumPrevX = e.clientX;
          momentumPrevY = e.clientY;
          momentumRaf = null;
        });
      });

      function bindMomentumToAll() {
        list.querySelectorAll('[data-momentum-hover-element]').forEach((el) => {
          if (el.__osmoMomentumBound) return;
          el.__osmoMomentumBound = true;
          el.addEventListener('mouseenter', (e) => {
            if (!hoverEnabled || isPressed) return;
            const target = el.querySelector('[data-momentum-hover-target]');
            if (!target) return;
            const { left, top, width, height } = target.getBoundingClientRect();
            const centerX = left + width / 2;
            const centerY = top + height / 2;
            const offsetX = e.clientX - centerX;
            const offsetY = e.clientY - centerY;
            const rawTorque = offsetX * momentumVelY - offsetY * momentumVelX;
            const leverDist = Math.hypot(offsetX, offsetY) || 1;
            const angularForce = rawTorque / leverDist;
            const velocityX = momentumClampXY(momentumVelX * MOMENTUM_XY_MULT);
            const velocityY = momentumClampXY(momentumVelY * MOMENTUM_XY_MULT);
            const rotationVelocity = momentumClampRot(angularForce * MOMENTUM_ROT_MULT);
            gsap.to(target, {
              inertia: {
                x: { velocity: velocityX, end: 0 },
                y: { velocity: velocityY, end: 0 },
                rotation: { velocity: rotationVelocity, end: 0 },
                resistance: MOMENTUM_RESISTANCE,
              },
            });
          });
        });
      }

      function bindHoverToAll() {
        list.querySelectorAll('[data-overlap-slider-item]').forEach((slide) => {
          if (slide.__osmoHoverBound) return;
          slide.__osmoHoverBound = true;
          const card = slide.querySelector('.card');
          if (!card) return;
          slide.addEventListener('mouseenter', () => {
            if (!hoverEnabled || isPressed) return;
            gsap.to(card, { scale: 1.03, duration: 0.5, ease: 'osmo' });
          });
          slide.addEventListener('mouseleave', () => {
            if (!hoverEnabled || isPressed) return;
            gsap.to(card, { scale: 1, duration: 0.5, ease: 'osmo' });
          });
        });
      }

      // ---- resize: rebuild clones, re-anchor ----
      let lastW = window.innerWidth;
      window.addEventListener('resize', () => {
        // Only rebuild if width changed meaningfully (ignore iOS toolbar height shifts)
        if (Math.abs(window.innerWidth - lastW) < 2) return;
        lastW = window.innerWidth;

        // preserve "where we are in the loop" across rebuilds
        const currentPhase = setWidth ? (((position % setWidth) + setWidth) % setWidth) / setWidth : 0;
        fillTrack();
        setAnchor();
        position = currentPhase * setWidth;
        applyTransform();
        bindHoverToAll();
        bindMomentumToAll();
      });

      // ---- go ----
      function boot() {
        fillTrack();
        setAnchor();
        position = 0;
        velocity = BASE_DRIFT;
        applyTransform();
        bindHoverToAll();
        bindMomentumToAll();
      }

      // wait one frame so fonts/layout settle, then boot
      requestAnimationFrame(boot);
    }
  }



  function initColumnCurtain() {
    if (typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);

    const section = document.querySelector('.column-curtain');
    if (!section) return;
    const cols = section.querySelectorAll('.column-curtain__col');
    const edgeLeft = section.querySelector('.column-curtain__edge[data-edge="left"]');
    const edgeRight = section.querySelector('.column-curtain__edge[data-edge="right"]');
    const text = section.querySelector('.text');
    if (cols.length !== 4 || !edgeLeft || !edgeRight) return;

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const run = () => {
      if (text) {
        wrapLettersInSpan(text);
      }
      const groupSpan = text ? wrapTrailingChildren(text, 10, 'mwg_effect011__group') : null;
      const letters = text ? section.querySelectorAll('.letter') : [];

      const getDistance = () => (text ? Math.max(0, text.scrollWidth - document.body.clientWidth) : 0);

      // Column stagger patterns — same shuffled set as before.
      const patterns = [
        { start: 0.0, end: 0.75, ease: 'power2.out' },
        { start: 0.05, end: 0.65, ease: 'none' },
        { start: 0.1, end: 0.8, ease: 'power1.out' },
        { start: 0.2, end: 0.9, ease: 'none' },
        { start: 0.3, end: 1.0, ease: 'power2.out' },
        { start: 0.05, end: 0.7, ease: 'power1.out' },
      ];
      for (let i = patterns.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [patterns[i], patterns[j]] = [patterns[j], patterns[i]];
      }
      const targets = [edgeLeft, cols[0], cols[1], cols[2], cols[3], edgeRight];

      // Normalized fractions: colFrac = fraction of total scroll for columns,
      // textFrac = remainder for the text pan. Timeline progress 0→1 maps
      // linearly to scroll 0→(vh+dist), so each phase occupies its exact share.
      const vh = window.innerHeight;
      const dist = getDistance();
      const colFrac = vh / (vh + (dist || 1));
      const textFrac = 1 - colFrac;

      const curtainNav = document.querySelector('.bold-nav-full');
      const colTl = gsap.timeline({
        scrollTrigger: {
          id: 'curtain-combined',
          trigger: section,
          start: window.innerWidth < 700 ? 'top 70%' : 'top top',
          end: () => `+=${window.innerHeight * 0.5 + getDistance() * 0.5}`,
          pin: window.innerWidth < 700 ? false : true,
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate(self) {
            if (!curtainNav) return;
            if (self.progress >= colFrac) {
              curtainNav.setAttribute('data-nav-theme', 'light');
              console.log(colFrac, 1);
            } else {
              console.log(colFrac, 2);

              curtainNav.removeAttribute('data-nav-theme');
            }
          },
          onLeaveBack() {
            if (curtainNav) curtainNav.removeAttribute('data-nav-theme');
          },
        },
      });

      // Phase 1: column fills — patterns are 0→1 fractions of the column phase,
      // scaled to occupy only the colFrac slice of the unified timeline.
      targets.forEach((col, i) => {
        const { start: s, end: e, ease } = patterns[i];
        colTl.fromTo(col, { height: '0vh' }, { height: '100vh', duration: (e - s) * colFrac, ease: ease || 'none' }, s * colFrac);
      });
      // Flip bg dark just before columns finish so sub-pixel gaps close.
      colTl.to(section, { backgroundColor: '#1c2121', duration: 0.001 }, colFrac * 0.99);

      if (!text || dist <= 0) return;

      // Text pan starts at 40% of the way through the column phase so text
      // enters from the right while columns are still rising — both read as
      // one simultaneous act rather than sequential phases.
      const textStart = colFrac * 0.4;
      colTl.to(
        text,
        {
          x: () => -getDistance(),
          ease: 'none',
          duration: 1 - textStart,
          invalidateOnRefresh: true,
        },
        textStart,
      );

      // Letters and underline use colTl as containerAnimation.
      // colTl drives text.x so GSAP can map each letter's left position to
      // the correct scroll window within the combined range.

      // Underline: build the SVG now (at 0% draw) then scrub it with scroll
      // so the stroke draws in as "group chat" crosses the viewport.
      if (groupSpan && typeof rough !== 'undefined' && typeof DrawSVGPlugin !== 'undefined') {
        gsap.registerPlugin(DrawSVGPlugin);
        const w = groupSpan.offsetWidth;
        const h = groupSpan.offsetHeight;
        if (w && h) {
          const padX = Math.max(8, w * 0.02);
          const padY = Math.max(12, h * 0.22);
          const svgW = w + padX * 2;
          const svgH = padY * 2;
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('class', 'group-rough-underline');
          svg.setAttribute('aria-hidden', 'true');
          svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
          svg.style.left = `-${padX}px`;
          svg.style.top = `${h - padY * 0.35}px`;
          svg.style.width = `${svgW}px`;
          svg.style.height = `${svgH}px`;
          const rc = rough.svg(svg);
          const ulFrames = [];
          for (let f = 0; f < 8; f++) {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('filter', 'url(#ink-texture)');
            if (f > 0) g.style.display = 'none';
            g.appendChild(
              rc.line(padX * 0.6, svgH * 0.45, svgW - padX * 0.6, svgH * 0.55, {
                roughness: 2.2,
                strokeWidth: 5,
                stroke: '#3451f5',
                seed: 4 + f * 17,
              }),
            );
            svg.appendChild(g);
            ulFrames.push(g);
          }
          groupSpan.appendChild(svg);
          const paths = ulFrames[0].querySelectorAll('path');
          let boilStarted = false;
          gsap.fromTo(
            paths,
            { drawSVG: '0%' },
            {
              drawSVG: '100%',
              ease: 'none',
              scrollTrigger: {
                trigger: groupSpan,
                containerAnimation: colTl,
                start: 'left 75%',
                end: 'left 20%',
                scrub: 0.4,
                onLeave: () => {
                  if (boilStarted) return;
                  boilStarted = true;
                  startBoiling([ulFrames]);
                },
              },
            },
          );
        }
      } else if (groupSpan) {
        let mwgDoodleDrawn = false;
        ScrollTrigger.create({
          trigger: groupSpan,
          containerAnimation: colTl,
          start: 'left 55%',
          once: true,
          onEnter: () => {
            drawMwgGroupDoodle(groupSpan);
            mwgDoodleDrawn = true;
          },
        });
        let _mwgT;
        onWidthResize(() => {
          if (!mwgDoodleDrawn) return;
          clearTimeout(_mwgT);
          _mwgT = setTimeout(() => drawMwgGroupDoodle(groupSpan), 150);
        });
      }

      letters.forEach((letter) => {
        gsap.from(letter, {
          yPercent: (Math.random() - 0.5) * 1200,
          rotation: (Math.random() - 0.5) * 60,
          ease: 'elastic.out(1.2, 1)',
          scrollTrigger: {
            trigger: letter,
            containerAnimation: colTl,
            start: 'left 90%',
            end: 'left 10%',
            scrub: 0.5,
          },
        });
      });
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(run);
    } else {
      run();
    }
  }



  function wrapLettersInSpan(element) {
    const text = element.textContent;
    element.innerHTML = text
      .split('')
      .map((char) => (char === ' ' ? '<span>&nbsp;</span>' : `<span class="letter">${char}</span>`))
      .join('');
  }



  // Move the last `count` direct children of `parent` into a new wrapper
  // element with `className`, appended back as the parent's last child.
  // Used to group "group chat" letter spans for the rough underline.
  function wrapTrailingChildren(parent, count, className) {
    const all = Array.from(parent.children);
    if (all.length < count) return null;
    const wrap = document.createElement('span');
    wrap.className = className;
    all.slice(-count).forEach((child) => wrap.appendChild(child));
    parent.appendChild(wrap);
    return wrap;
  }



  // Draws a rough.js underline beneath the given target, using the same
  // 8-frame boil pattern as the editorial title doodle. Called once, after
  // the mwg_effect011 horizontal scroll settles.
  function drawMwgGroupDoodle(target) {
    if (!target || typeof rough === 'undefined') return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const old = target.querySelector('.group-rough-underline');
    if (old) old.remove();
    const w = target.offsetWidth;
    const h = target.offsetHeight;
    if (!w || !h) return;
    const padX = Math.max(8, w * 0.02);
    const padY = Math.max(12, h * 0.22);
    const svgW = w + padX * 2;
    const svgH = padY * 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'group-rough-underline');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    svg.style.left = `-${padX}px`;
    svg.style.top = `${h - padY * 0.35}px`;
    svg.style.width = `${svgW}px`;
    svg.style.height = `${svgH}px`;
    const rc = rough.svg(svg);
    const frames = [];
    for (let f = 0; f < 8; f++) {
      const frameG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      frameG.setAttribute('filter', 'url(#ink-texture)');
      if (f > 0) frameG.style.display = 'none';
      frameG.appendChild(
        rc.line(padX * 0.6, svgH * 0.45, svgW - padX * 0.6, svgH * 0.55, {
          roughness: 2.2,
          strokeWidth: 5,
          stroke: '#3451f5',
          seed: 4 + f * 17,
        }),
      );
      svg.appendChild(frameG);
      frames.push(frameG);
    }
    target.appendChild(svg);
    if (reducedMotion) {
      startBoiling([frames]);
      return;
    }
    if (typeof DrawSVGPlugin !== 'undefined') gsap.registerPlugin(DrawSVGPlugin);
    const paths = frames[0].querySelectorAll('path');
    gsap.set(paths, { drawSVG: '0%' });
    gsap.to(paths, {
      drawSVG: '100%',
      duration: 1.0,
      stagger: 0.08,
      ease: 'power2.out',
      onComplete: () => startBoiling([frames]),
    });
  }



  function initEditorialThemeSwitch() {
    if (typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);

    const section = document.querySelector('[data-theme-switch="editorial"]');
    if (!section) return;

    const LIGHT_BG = '#fcf7f0';
    const DARK_BG = '#1c2121';

    const darkSectionVars = {
      '--section-bg': DARK_BG,
      '--section-ink': LIGHT_BG,
      '--section-kicker': 'rgba(252, 247, 240, 0.55)',
      '--section-copy': 'rgba(252, 247, 240, 0.78)',
    };

    const mm = gsap.matchMedia();

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline({
        defaults: { ease: 'none', duration: 1 },
        scrollTrigger: {
          trigger: section,
          start: 'top bottom',
          end: 'top 25%',
          scrub: true,
          invalidateOnRefresh: true,
        },
      });

      tl.fromTo(document.body, { backgroundColor: LIGHT_BG }, { backgroundColor: DARK_BG }, 0);
      tl.to(section, darkSectionVars, 0);
    });

    mm.add('(prefers-reduced-motion: reduce)', () => {
      gsap.set(document.body, { backgroundColor: DARK_BG });
      gsap.set(section, darkSectionVars);
    });
  }



  /* ---------- Hero stacking-cards parallax (Osmo: stacking-cards-parallax) ----
   As the hero scrolls out of view, translate and rotate the headline and
   the carousel at slightly different rates so they separate like the
   inner elements of an exiting stacking card. */
  function initHeroStackingParallax() {
    if (typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);

    const hero = document.querySelector('.hero');
    const headline = document.querySelector('.headline');
    const slider = document.querySelector('.slider-section');
    if (!hero || !headline || !slider) return;

    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline({
        defaults: { ease: 'none', duration: 1 },
        scrollTrigger: {
          trigger: hero,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
          invalidateOnRefresh: true,
        },
      });

      tl.fromTo(headline, { yPercent: 0, rotate: 0 }, { yPercent: -25, rotate: -5 }).fromTo(slider, { yPercent: 0, rotate: 0 }, { yPercent: -18, rotate: -3 }, '<');
    });
  }



  /* ---------- Sticky Features (Osmo) ---------- */
  function initStickyFeatures(root) {
    if (typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);

    const wraps = Array.from((root || document).querySelectorAll('[data-sticky-feature-wrap]'));
    if (!wraps.length) return;

    wraps.forEach((w) => {
      const visualWraps = Array.from(w.querySelectorAll('[data-sticky-feature-visual-wrap]'));
      const items = Array.from(w.querySelectorAll('[data-sticky-feature-item]'));
      const progressBar = w.querySelector('[data-sticky-feature-progress]');

      const count = Math.min(visualWraps.length, items.length);
      if (count < 1) return;

      const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const DURATION = rm ? 0.01 : 0.75;
      const EASE = 'power4.inOut';
      const SCROLL_AMOUNT = 0.9;
      const getTexts = (el) => Array.from(el.querySelectorAll('[data-sticky-feature-text]'));

      if (visualWraps[0]) gsap.set(visualWraps[0], { clipPath: 'inset(0% round 1.5rem)' });
      gsap.set(items[0], { autoAlpha: 1 });

      let currentIndex = 0;

      function animateOut(itemEl) {
        const texts = getTexts(itemEl);
        gsap.to(texts, {
          autoAlpha: 0,
          y: -30,
          ease: 'power4.out',
          duration: 0.4,
          onComplete: () => gsap.set(itemEl, { autoAlpha: 0 }),
        });
      }

      function animateIn(itemEl) {
        const texts = getTexts(itemEl);
        gsap.set(itemEl, { autoAlpha: 1 });
        gsap.fromTo(
          texts,
          {
            autoAlpha: 0,
            y: 30,
          },
          {
            autoAlpha: 1,
            y: 0,
            ease: 'power4.out',
            duration: DURATION,
            stagger: 0.1,
          },
        );
      }

      function transition(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        const tl = gsap.timeline({ defaults: { overwrite: 'auto' } });

        if (fromIndex < toIndex) {
          tl.to(
            visualWraps[toIndex],
            {
              clipPath: 'inset(0% round 1.5rem)',
              duration: DURATION,
              ease: EASE,
            },
            0,
          );
        } else {
          tl.to(
            visualWraps[fromIndex],
            {
              clipPath: 'inset(50% round 1.5rem)',
              duration: DURATION,
              ease: EASE,
            },
            0,
          );
        }

        animateOut(items[fromIndex]);
        animateIn(items[toIndex]);
      }

      const steps = Math.max(1, count - 1);

      ScrollTrigger.create({
        trigger: w,
        start: 'center center',
        end: () => `+=${steps * 100}%`,
        pin: true,
        scrub: true,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          const p = Math.min(self.progress, SCROLL_AMOUNT) / SCROLL_AMOUNT;
          let idx = Math.floor(p * steps + 1e-6);
          idx = Math.max(0, Math.min(steps, idx));

          if (progressBar) {
            gsap.to(progressBar, {
              scaleX: p,
              ease: 'none',
              overwrite: true,
            });
          }

          if (idx !== currentIndex) {
            transition(currentIndex, idx);
            currentIndex = idx;
          }
        },
      });
    });
  }



  /* ---------- Elements Reveal on Scroll (Osmo) ---------- */
  function initContentRevealScroll() {
    if (typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.querySelectorAll('[data-reveal-group]').forEach((groupEl) => {
      const groupStaggerSec = (parseFloat(groupEl.getAttribute('data-stagger')) || 100) / 1000;
      const groupDistance = groupEl.getAttribute('data-distance') || '2em';
      const triggerStart = groupEl.getAttribute('data-start') || 'top 80%';
      const animDuration = 0.8;
      const animEase = 'power4.inOut';

      if (prefersReduced) {
        gsap.set(groupEl, { clearProps: 'all', y: 0, autoAlpha: 1 });
        return;
      }

      const directChildren = Array.from(groupEl.children).filter((el) => el.nodeType === 1);
      if (!directChildren.length) {
        gsap.set(groupEl, { y: groupDistance, autoAlpha: 0 });
        ScrollTrigger.create({
          trigger: groupEl,
          start: triggerStart,
          once: true,
          onEnter: () =>
            gsap.to(groupEl, {
              y: 0,
              autoAlpha: 1,
              duration: animDuration,
              ease: animEase,
              onComplete: () => gsap.set(groupEl, { clearProps: 'all' }),
            }),
        });
        return;
      }

      const slots = [];
      directChildren.forEach((child) => {
        const nestedGroup = child.matches('[data-reveal-group-nested]') ? child : child.querySelector(':scope [data-reveal-group-nested]');

        if (nestedGroup) {
          const includeParent = child.getAttribute('data-ignore') !== 'true' && (child.getAttribute('data-ignore') === 'false' || nestedGroup.getAttribute('data-ignore') === 'false');

          const nestedChildren = Array.from(nestedGroup.children).filter((el) => el.nodeType === 1 && el.getAttribute('data-ignore') !== 'true');

          slots.push({
            type: 'nested',
            parentEl: child,
            nestedEl: nestedGroup,
            includeParent,
            nestedChildren,
          });
        } else {
          if (child.getAttribute('data-ignore') === 'true') return;
          slots.push({ type: 'item', el: child });
        }
      });

      slots.forEach((slot) => {
        if (slot.type === 'item') {
          const isNestedSelf = slot.el.matches('[data-reveal-group-nested]');
          const d = isNestedSelf ? groupDistance : slot.el.getAttribute('data-distance') || groupDistance;
          gsap.set(slot.el, { y: d, autoAlpha: 0 });
        } else {
          if (slot.includeParent) gsap.set(slot.parentEl, { y: groupDistance, autoAlpha: 0 });
          const nestedD = slot.nestedEl.getAttribute('data-distance') || groupDistance;
          slot.nestedChildren.forEach((target) => gsap.set(target, { y: nestedD, autoAlpha: 0 }));
        }
      });

      ScrollTrigger.create({
        trigger: groupEl,
        start: triggerStart,
        once: true,
        onEnter: () => {
          const tl = gsap.timeline();

          slots.forEach((slot, slotIndex) => {
            const slotTime = slotIndex * groupStaggerSec;

            if (slot.type === 'item') {
              tl.to(
                slot.el,
                {
                  y: 0,
                  autoAlpha: 1,
                  duration: animDuration,
                  ease: animEase,
                  onComplete: () => gsap.set(slot.el, { clearProps: 'all' }),
                },
                slotTime,
              );
            } else {
              if (slot.includeParent) {
                tl.to(
                  slot.parentEl,
                  {
                    y: 0,
                    autoAlpha: 1,
                    duration: animDuration,
                    ease: animEase,
                    onComplete: () => gsap.set(slot.parentEl, { clearProps: 'all' }),
                  },
                  slotTime,
                );
              }

              const nestedMs = parseFloat(slot.nestedEl.getAttribute('data-stagger'));
              const nestedStaggerSec = Number.isNaN(nestedMs) ? groupStaggerSec : nestedMs / 1000;
              slot.nestedChildren.forEach((nestedChild, nestedIndex) => {
                tl.to(
                  nestedChild,
                  {
                    y: 0,
                    autoAlpha: 1,
                    duration: animDuration,
                    ease: animEase,
                    onComplete: () => gsap.set(nestedChild, { clearProps: 'all' }),
                  },
                  slotTime + nestedIndex * nestedStaggerSec,
                );
              });
            }
          });
        },
      });
    });
  }



  /* ---------- Line Reveal Testimonials (Osmo) ---------- */
  function initLineRevealTestimonials() {
    if (typeof SplitText === 'undefined' || typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(SplitText, ScrollTrigger);

    const wraps = document.querySelectorAll('[data-testimonial-wrap]');
    if (!wraps.length) return;

    const imageClipHidden = 'circle(0% at 50% 50%)';
    const imageClipVisible = 'circle(50% at 50% 50%)';

    wraps.forEach((wrap) => {
      const list = wrap.querySelector('[data-testimonial-list]');
      if (!list) return;

      const items = Array.from(list.querySelectorAll('[data-testimonial-item]'));
      if (!items.length) return;

      const btnPrev = wrap.querySelector('[data-prev]');
      const btnNext = wrap.querySelector('[data-next]');
      const elCurrent = wrap.querySelector('[data-current]');
      const elTotal = wrap.querySelector('[data-total]');

      if (elTotal) elTotal.textContent = String(items.length);

      let activeIndex = items.findIndex((el) => el.classList.contains('is--active'));
      if (activeIndex < 0) activeIndex = 0;

      let isAnimating = false;
      let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let isInView = true;

      const autoplayEnabled = wrap.getAttribute('data-autoplay') === 'true';
      const autoplayDuration = parseInt(wrap.getAttribute('data-autoplay-duration'), 10) || 4000;
      let autoplayCall = null;

      const slides = items.map((item) => ({
        item,
        image: item.querySelector('[data-testimonial-img]'),
        splitTargets: [item.querySelector('[data-testimonial-text]'), ...item.querySelectorAll('[data-testimonial-split]')].filter(Boolean),
        splitInstances: [],
        getLines() {
          return this.splitInstances.flatMap((instance) => instance.lines);
        },
      }));

      function setSlideState(slideIndex, isActive) {
        const { item } = slides[slideIndex];
        item.classList.toggle('is--active', isActive);
        item.setAttribute('aria-hidden', String(!isActive));
        gsap.set(item, {
          autoAlpha: isActive ? 1 : 0,
          pointerEvents: isActive ? 'auto' : 'none',
        });
      }

      function updateCounter() {
        if (elCurrent) elCurrent.textContent = String(activeIndex + 1);
      }

      function startAutoplay() {
        if (!autoplayEnabled) return;
        if (autoplayCall) autoplayCall.kill();

        autoplayCall = gsap.delayedCall(autoplayDuration / 1000, () => {
          if (!isInView || isAnimating) {
            startAutoplay();
            return;
          }
          goTo((activeIndex + 1) % slides.length);
          startAutoplay();
        });
      }

      function pauseAutoplay() {
        if (autoplayCall) autoplayCall.pause();
      }

      function resumeAutoplay() {
        if (!autoplayEnabled) return;
        if (!autoplayCall) startAutoplay();
        else autoplayCall.resume();
      }

      function resetAutoplay() {
        if (!autoplayEnabled) return;
        startAutoplay();
      }

      slides.forEach((_, i) => setSlideState(i, i === activeIndex));
      updateCounter();

      slides.forEach((slide, slideIndex) => {
        slide.splitInstances = slide.splitTargets.map((el) =>
          SplitText.create(el, {
            type: 'lines',
            mask: 'lines',
            linesClass: 'text-line',
            autoSplit: true,
            onSplit(self) {
              if (reduceMotion) return;

              const isActive = slideIndex === activeIndex;
              gsap.set(self.lines, { yPercent: isActive ? 0 : 110 });

              if (slide.image) {
                gsap.set(slide.image, {
                  clipPath: isActive ? imageClipVisible : imageClipHidden,
                });
              }
            },
          }),
        );
      });

      function goTo(nextIndex) {
        if (isAnimating || nextIndex === activeIndex) return;
        isAnimating = true;

        const outgoingSlide = slides[activeIndex];
        const incomingSlide = slides[nextIndex];

        const tl = gsap.timeline({
          onComplete: () => {
            setSlideState(activeIndex, false);
            setSlideState(nextIndex, true);
            activeIndex = nextIndex;
            updateCounter();
            isAnimating = false;
          },
        });

        if (reduceMotion) {
          tl.to(
            outgoingSlide.item,
            {
              autoAlpha: 0,
              duration: 0.4,
              ease: 'power2',
            },
            0,
          ).fromTo(
            incomingSlide.item,
            {
              autoAlpha: 0,
            },
            {
              autoAlpha: 1,
              duration: 0.4,
              ease: 'power2',
            },
            0,
          );
          return;
        }

        const outgoingLines = outgoingSlide.getLines();
        const incomingLines = incomingSlide.getLines();

        gsap.set(incomingSlide.item, { autoAlpha: 1, pointerEvents: 'auto' });
        gsap.set(incomingLines, { yPercent: 110 });
        if (outgoingSlide.image) gsap.set(outgoingSlide.image, { clipPath: imageClipVisible });

        tl.to(
          outgoingLines,
          {
            yPercent: -110,
            duration: 0.6,
            ease: 'power4.inOut',
            stagger: { amount: 0.25 },
          },
          0,
        );

        if (outgoingSlide.image) {
          tl.to(
            outgoingSlide.image,
            {
              clipPath: imageClipHidden,
              duration: 0.6,
              ease: 'power4.inOut',
            },
            0,
          );
        }

        tl.to(
          incomingLines,
          {
            yPercent: 0,
            duration: 0.7,
            ease: 'power4.inOut',
            stagger: { amount: 0.4 },
          },
          '>-=' + 0.3,
        );

        if (incomingSlide.image) {
          tl.fromTo(
            incomingSlide.image,
            {
              clipPath: imageClipHidden,
            },
            {
              clipPath: imageClipVisible,
              duration: 0.75,
              ease: 'power4.inOut',
            },
            '<',
          );
        }

        tl.set(outgoingSlide.item, { autoAlpha: 0 }, '>');
      }

      startAutoplay();

      if (btnNext) {
        btnNext.addEventListener('click', () => {
          resetAutoplay();
          goTo((activeIndex + 1) % slides.length);
        });
      }

      if (btnPrev) {
        btnPrev.addEventListener('click', () => {
          resetAutoplay();
          goTo((activeIndex - 1 + slides.length) % slides.length);
        });
      }

      window.addEventListener('keydown', (e) => {
        if (!isInView) return;

        const t = e.target;
        const isTypingTarget = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (isTypingTarget) return;

        if (e.key === 'ArrowRight') {
          e.preventDefault();
          resetAutoplay();
          goTo((activeIndex + 1) % slides.length);
        }

        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          resetAutoplay();
          goTo((activeIndex - 1 + slides.length) % slides.length);
        }
      });

      ScrollTrigger.create({
        trigger: wrap,
        start: 'top bottom',
        end: 'bottom top',
        onEnter: () => {
          isInView = true;
          resumeAutoplay();
        },
        onEnterBack: () => {
          isInView = true;
          resumeAutoplay();
        },
        onLeave: () => {
          isInView = false;
          pauseAutoplay();
        },
        onLeaveBack: () => {
          isInView = false;
          pauseAutoplay();
        },
      });
    });
  }



  /* ---------- Footer Parallax ---------- */
  function initShutterScrollTransition() {
    const defaultRows = 6;
    const defaultMode = 'cover';
    const defaultScrollStart = { cover: 'bottom bottom', reveal: 'top bottom' };
    const defaultScrollEnd = { cover: 'bottom top', reveal: 'top center' };
    const defaultScrub = 0.3;
    const defaultShutterDuration = 0.1;
    const defaultStaggerAmount = 0.01;

    const panelClass = 'shutter-scroll-transition__panel';
    const rowClass = 'shutter-scroll-transition__row';

    const breakpoints = {
      mobile: '(max-width: 478px)',
      landscape: '(max-width: 767px)',
      tablet: '(max-width: 991px)',
    };

    const instances = [];
    let mm = null;

    function getMode(wrapper) {
      return wrapper.dataset.mode === 'reveal' ? 'reveal' : defaultMode;
    }

    function getRows(wrapper) {
      const base = parseInt(wrapper.dataset.rows, 10) || defaultRows;
      if (window.matchMedia(breakpoints.mobile).matches) {
        return parseInt(wrapper.dataset.rowsMobile, 10) || base;
      }
      if (window.matchMedia(breakpoints.landscape).matches) {
        return parseInt(wrapper.dataset.rowsLandscape, 10) || base;
      }
      if (window.matchMedia(breakpoints.tablet).matches) {
        return parseInt(wrapper.dataset.rowsTablet, 10) || base;
      }
      return base;
    }

    function getScrollStart(wrapper, mode) {
      return wrapper.dataset.scrollStart || defaultScrollStart[mode];
    }

    function getScrollEnd(wrapper, mode) {
      return wrapper.dataset.scrollEnd || defaultScrollEnd[mode];
    }

    function createRow() {
      const row = document.createElement('div');
      row.classList.add(rowClass);
      row.setAttribute('data-shutter-scroll-row', '');
      return row;
    }

    function buildRows(wrapper, rows) {
      const panel = document.createElement('div');
      panel.classList.add(panelClass);
      panel.setAttribute('data-shutter-scroll-panel', '');
      const fragment = document.createDocumentFragment();
      for (let r = 0; r < rows; r++) {
        fragment.appendChild(createRow());
      }
      panel.appendChild(fragment);
      wrapper.appendChild(panel);
      return { panel };
    }

    function collectRows(panel) {
      return Array.from(panel.children);
    }

    function createAnimation(wrapper, rows, section, mode) {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: getScrollStart(wrapper, mode),
          end: getScrollEnd(wrapper, mode),
          scrub: defaultScrub,
          invalidateOnRefresh: true,
        },
      });

      const fromScale = mode === 'cover' ? 0 : 1;
      const toScale = mode === 'cover' ? 1 : 0;
      const origin = mode === 'cover' ? 'bottom center' : 'top center';

      gsap.set(rows, { scaleY: fromScale, transformOrigin: origin });

      tl.to(rows, {
        scaleY: toScale,
        duration: defaultShutterDuration,
        stagger: { each: defaultStaggerAmount, from: 'end' },
        ease: 'none',
      });

      return tl;
    }

    function setupInstance(wrapper) {
      const section = wrapper.closest('section') || wrapper.parentElement;
      const rows = getRows(wrapper);
      const mode = getMode(wrapper);
      const { panel } = buildRows(wrapper, rows);
      const rowList = collectRows(panel);
      const tl = createAnimation(wrapper, rowList, section, mode);
      return { wrapper, tl };
    }

    function destroyInstance(instance) {
      if (instance.tl) {
        instance.tl.scrollTrigger?.kill();
        instance.tl.kill();
      }
      const panel = instance.wrapper.querySelector('[data-shutter-scroll-panel]');
      if (panel) panel.remove();
    }

    function buildAll() {
      const wrappers = document.querySelectorAll('[data-shutter-scroll-transition]');
      wrappers.forEach((wrapper) => {
        instances.push(setupInstance(wrapper));
      });
      ScrollTrigger.refresh();
    }

    function destroyAll() {
      instances.forEach(destroyInstance);
      instances.length = 0;
    }

    const wrappers = document.querySelectorAll('[data-shutter-scroll-transition]');
    if (!wrappers.length) return;

    mm = gsap.matchMedia();

    mm.add(
      {
        isDesktop: '(min-width: 992px)',
        isTablet: '(min-width: 768px) and (max-width: 991px)',
        isLandscape: '(min-width: 479px) and (max-width: 767px)',
        isMobile: '(max-width: 478px)',
        reduceMotion: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        if (context.conditions.reduceMotion) return;
        buildAll();
        return () => {
          destroyAll();
        };
      },
    );
  }



  /* ---------- Global chromatic aberration: per-channel stacks ----------
   Every .chromatic-stack has three <img> children (R/G/B). On pointer
   move the R and B channels translate in opposite directions to create
   the aberration; the G channel barely shifts to keep the image
   anchored. Handlers are wired after the overlapping slider clones the
   founder items, so every live stack (originals + clones) is covered. */
  function initEditorialCards() {
    if (typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);

    const grid = document.querySelector('[data-editorial-grid]');
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll('.editorial-card'));
    if (!cards.length) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasHover = window.matchMedia('(hover: hover)').matches;

    // Scroll-in reveal: images first, then text per card
    const mediaEls = cards.map((c) => c.querySelector('.editorial-card__media')).filter(Boolean);
    const bodyEls = cards.map((c) => c.querySelector('.editorial-card__body')).filter(Boolean);

    if (reduceMotion) {
      gsap.set([...mediaEls, ...bodyEls], { opacity: 1, y: 0 });
      grid.classList.add('is-ready');
    } else {
      gsap.set(mediaEls, { autoAlpha: 0, y: 40, scale: 1.06 });
      gsap.set(bodyEls, { autoAlpha: 0, y: 16 });
      grid.classList.add('is-ready');

      ScrollTrigger.create({
        trigger: grid,
        start: 'top 82%',
        once: true,
        onEnter: () => {
          const tl = gsap.timeline();
          tl.to(mediaEls, {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.9,
            ease: 'power3.out',
            stagger: 0.1,
          });
          tl.to(
            bodyEls,
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.7,
              ease: 'power2.out',
              stagger: 0.08,
            },
            '-=0.55',
          );
        },
      });
    }

    // Per-card overlay tracks cursor vertically inside the media.
    // Also recomputes on scroll so the overlay follows when the page moves
    // under a stationary cursor.
    if (!reduceMotion && hasHover) {
      let lastClientY = null;
      let hoveredCard = null;
      let raf = 0;

      const applyOverlay = () => {
        if (!hoveredCard || lastClientY == null) return;
        const media = hoveredCard.querySelector('.editorial-card__media');
        const overlay = hoveredCard.querySelector('.editorial-card__overlay');
        if (!media || !overlay) return;
        const r = media.getBoundingClientRect();
        const y = Math.max(0, Math.min(1, (lastClientY - r.top) / r.height));
        overlay.style.setProperty('--overlay-y', (y * 100).toFixed(1) + '%');
      };

      const schedule = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(applyOverlay);
      };

      cards.forEach((card) => {
        const media = card.querySelector('.editorial-card__media');
        const overlay = card.querySelector('.editorial-card__overlay');
        if (!media || !overlay) return;
        media.addEventListener('pointerenter', (e) => {
          hoveredCard = card;
          lastClientY = e.clientY;
          schedule();
        });
        media.addEventListener('pointermove', (e) => {
          hoveredCard = card;
          lastClientY = e.clientY;
          schedule();
        });
        media.addEventListener('pointerleave', () => {
          if (hoveredCard === card) {
            hoveredCard = null;
          }
          cancelAnimationFrame(raf);
        });
      });

      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
    }

    // Cursor-follow parallax (desktop + hover only)
    if (reduceMotion || !hasHover) return;

    const setters = cards.map((card) => ({
      x: gsap.quickTo(card, 'x', { duration: 0.7, ease: 'power3.out' }),
      y: gsap.quickTo(card, 'y', { duration: 0.7, ease: 'power3.out' }),
      el: card,
    }));

    const AMP = 18; // max px offset
    let gridRect = null;
    let pointerActive = false;
    let pointerX = 0;
    let pointerY = 0;

    function refreshRect() {
      gridRect = grid.getBoundingClientRect();
    }
    refreshRect();
    window.addEventListener('resize', refreshRect);
    window.addEventListener('scroll', refreshRect, { passive: true });

    grid.addEventListener('pointermove', (e) => {
      pointerActive = true;
      pointerX = e.clientX;
      pointerY = e.clientY;
    });

    grid.addEventListener('pointerleave', () => {
      pointerActive = false;
      setters.forEach((s) => {
        s.x(0);
        s.y(0);
      });
    });

    gsap.ticker.add(() => {
      if (!pointerActive || !gridRect) return;
      // normalized pointer position relative to grid center
      const cx = gridRect.left + gridRect.width / 2;
      const cy = gridRect.top + gridRect.height / 2;
      const nx = gsap.utils.clamp(-1, 1, (pointerX - cx) / (gridRect.width / 2));
      const ny = gsap.utils.clamp(-1, 1, (pointerY - cy) / (gridRect.height / 2));

      setters.forEach((s, i) => {
        // alternate direction per card for an editorial, layered feel
        const dir = i % 2 === 0 ? 1 : -1;
        const depth = 0.6 + (i % 3) * 0.25; // 0.6, 0.85, 1.1
        s.x(-nx * AMP * dir * depth);
        s.y(-ny * AMP * dir * depth * 0.7);
      });
    });
  }



  /* ---------- e2VC Willem-style loader ----------
   Opens the "e2" + "vc" wordmark halves apart, grows an image box between
   them, flashes through the 8 founder images, then teleports them out to
   the live carousel slot positions before fading the overlay away. */
  function initE2vcLoader({ onReady } = {}) {
    const container = document.querySelector('.e2vc-loader');
    const body = document.body;
    const signalReady = () => {
      if (window.__e2vcReady) return;
      window.__e2vcReady = true;
      window.dispatchEvent(new CustomEvent('e2vc:ready'));
    };
    if (!container) {
      body.classList.remove('is-loading');
      signalReady();
      onReady && onReady();
      return;
    }

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      container.remove();
      body.classList.remove('is-loading');
      signalReady();
      onReady && onReady();
      return;
    }

    const letters = container.querySelectorAll('.e2vc-loader__letter');
    const h1Start = container.querySelector('.e2vc-loader__h1-start');
    const h1End = container.querySelector('.e2vc-loader__h1-end');
    const box = container.querySelector('.e2vc-loader__box');
    const stack = container.querySelector('.e2vc-loader__stack');
    // Stack imgs come pre-shuffled by shuffleFoundersDOM() (called before
    // this init), so DOM order + z-indexes already encode the random order
    // shared with the carousel.
    const stackImgs = Array.from(container.querySelectorAll('.e2vc-loader__img'));

    // Preload founder images so the cycle doesn't flash empty boxes.
    // Capped at 400ms so a slow connection never stalls the intro; any
    // late image will pop in mid-cycle, which is an acceptable tradeoff.
    const preload = Promise.race([
      Promise.all(
        stackImgs.map((img) =>
          img.complete && img.naturalWidth
            ? Promise.resolve()
            : new Promise((res) => {
                img.addEventListener('load', res, { once: true });
                img.addEventListener('error', res, { once: true });
              }),
        ),
      ),
      new Promise((res) => setTimeout(res, 400)),
    ]);

    preload.then(() => {
      // Freeze the infinite strip so cards stay put while we measure rects
      // and teleport clones onto them. Released on timeline completion.
      window.__e2vcFreezeStrip = true;

      document.querySelectorAll('section, footer, .page-shell__grid, nav').forEach((elm) => elm.style.opacity = '1')


      const tl = gsap.timeline({
        defaults: { ease: 'expo.inOut' },
        onStart: () => container.classList.remove('is--hidden'),
        onComplete: () => {
          container.remove();
          body.classList.remove('is-loading');
          signalReady();
          window.__e2vcFreezeStrip = false;
        },
      });

      // Cycle constants (declared early so Beat B can reach cycleStartScale).
      const cycleStartScale = 2.0;
      const cycleStagger = 0.07;
      const cycleStepDur = 0.04;
      const cycleLen = 7; // 7 fades → all 8 founders shown

      // Stack reveals via centered scale (not width) so the image grows
      // outward from a single point at the wordmark center, instead of
      // opening as a thin vertical line that expands horizontally. Width
      // is forced to 100% so the underlying box is always full-size; only
      // the scale transform animates.
      gsap.set(stack, { transformOrigin: '50% 50%', width: '100%', scale: 0 });

      // Beat A: letter reveal.
      tl.from(letters, { yPercent: 100, stagger: 0.04, duration: 0.55, ease: 'expo.out' });

      // Beat B: spread halves so "e2" left edge aligns with the first grid
      // line (64px from left) and "vc" right edge aligns with the last grid
      // line (64px from right). Grid margin matches .column-curtain__col CSS.
      // The box grows from 0 → 1em simultaneously, which shifts h1Start left
      // and h1End right by 0.5em in the flex layout. The x calculation must
      // compensate for that shift so letters land exactly on the grid lines.
      const gridMargin = 64;
      const h1El = container.querySelector('.e2vc-loader__h1');
      const halfBox = () => parseFloat(getComputedStyle(h1El).fontSize) * 0.5;
      tl.to(
        h1Start,
        {
          x: () => -(h1Start.getBoundingClientRect().left - gridMargin - halfBox()),
          duration: 0.95,
          ease: 'expo.inOut',
        },
        '<0.30',
      );
      tl.to(
        h1End,
        {
          x: () => window.innerWidth - gridMargin - halfBox() - h1End.getBoundingClientRect().right,
          duration: 0.95,
          ease: 'expo.inOut',
        },
        '<',
      );
      tl.fromTo(box, { width: '0em' }, { width: '1em', duration: 0.95 }, '<');
      tl.to(stack, { scale: cycleStartScale, duration: 0.95 }, '<');

      // Beat C: slot-machine cycle through ALL 8 founder images. The last
      // image (Victor at z-index 1) stays as the final frame and flies to
      // the carousel as a clone. The other 7 fade in sequence to reveal
      // the founder beneath them.
      // Stack scale lands at 1.0 by the end of the cycle, matching the
      // natural box size — the burst handoff is unaffected.
      const cycleTargets = stackImgs.slice(0, cycleLen);
      tl.addLabel('cycleStart', '>-0.05');
      tl.to(
        cycleTargets,
        {
          opacity: 0,
          duration: cycleStepDur,
          ease: 'none',
          stagger: cycleStagger,
        },
        'cycleStart',
      );
      // Stack shrinks in lockstep with each image fade — linear ramp from
      // cycleStartScale down to 1.0 across `cycleLen` steps.
      for (let i = 1; i <= cycleLen; i++) {
        const targetScale = cycleStartScale - (cycleStartScale - 1.0) * (i / cycleLen);
        tl.to(
          stack,
          {
            scale: targetScale,
            duration: cycleStepDur,
            ease: 'none',
          },
          `cycleStart+=${(i - 1) * cycleStagger}`,
        );
      }

      // Beat D: founder clones fly to the live carousel.
      tl.add(() => runTeleport(), '+=0.05');
      // Hold the timeline open while the parallel clone tweens fly + land.
      tl.to({}, { duration: 0.9 });

      // Beat E: close the gap so "e2vc" reads as a single word again.
      // Overlap with Beat D's settle so there's no dead air after the
      // portraits land (was the "f_018" blank-page moment).
      tl.to([h1Start, h1End], { x: 0, duration: 0.65, ease: 'expo.inOut' }, '<+=0.20');
      tl.to(box, { width: 0, duration: 0.65, ease: 'expo.inOut' }, '<');
      // Close the stack symmetrically via centered scale (matches Beat B).
      tl.to(stack, { scale: 0, duration: 0.65, ease: 'expo.inOut' }, '<');

      // Fade the loader background in parallel with the closing gap and
      // the wordmark flight. Targets backgroundColor (not opacity) so the
      // wordmark h1 inside stays fully opaque as it flies to the nav.
      // Tween to the same --bg color with alpha 0 (not rgba(0,0,0,0)) so
      // GSAP's RGB interpolation doesn't pass through a dark midpoint.
      tl.to(container, { backgroundColor: 'rgba(252,247,240,0)', duration: 0.7, ease: 'power2.out' }, '<');

      // Beat F: teleport the closed wordmark to the nav logo. Kicks off
      // while E is still closing so the wordmark is shrinking toward the
      // nav while the headline + carousel are already fading in.
      tl.add(() => runWordmarkTeleport(), '<+=0.10');
      tl.to({}, { duration: 0.55 }); // wait for wordmark to land
    });

    function runTeleport() {
      // Reset all 8 imgs to opaque so every founder is visible during the fan-out.
      // (Beat C scales the parent .stack — not the imgs — and lands at scale 1
      // by the end of the cycle, so we don't need to reset img transforms here.)
      gsap.set(stackImgs, { opacity: 1 });

      // Reveal the real hero + nav + grid now, so they fade in (via the CSS
      // opacity transition) while the clones are flying toward their slots.
      body.classList.remove('is-loading');
      signalReady();
      onReady && onReady();

      // Find the 8 slider items (one per unique founder) closest to viewport
      // center. Match by the founder's alt text so each loader img lands on
      // the actual on-screen card that represents the same person.
      const liveItems = Array.from(document.querySelectorAll('[data-overlap-slider-item]'));
      const vcx = window.innerWidth / 2;
      const vcy = window.innerHeight / 2;

      const scored = liveItems
        .map((el) => {
          const tilt = el.querySelector('.card-tilt');
          const img = el.querySelector('img');
          const rect = tilt.getBoundingClientRect();
          // Bounding-rect midpoint is rotation-invariant for rectangles, so it
          // gives us the true visual center of each rotated card.
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          return {
            founder: img ? img.getAttribute('alt') : '',
            cx,
            cy,
            // Un-rotated card face dimensions (per-slot sizing via CSS vars).
            width: tilt.offsetWidth,
            height: tilt.offsetHeight,
            dist: Math.hypot(cx - vcx, cy - vcy),
            tiltDeg: readCardTiltDeg(el),
          };
        })
        .sort((a, b) => a.dist - b.dist);

      // For each loader img, pick the nearest-to-center live slot matching
      // this founder (fallback: nearest unused slot).
      const used = new Set();
      const pairs = stackImgs.map((img) => {
        const founder = img.getAttribute('data-founder');
        let target = scored.find((s) => s.founder === founder && !used.has(s));
        if (!target) target = scored.find((s) => !used.has(s));
        if (target) used.add(target);
        return { img, target };
      });

      // Hide the live carousel wrap until the last clone has landed, so the
      // real cards don't render on top of the in-flight clones (double-image
      // ghosting). We hard-swap when the last clone settles - no fade,
      // because clone + live card are visually identical at that moment and
      // any crossfade would make both dim simultaneously.
      const sliderWrap = document.querySelector('.overlapping-slider__wrap');
      if (sliderWrap) gsap.set(sliderWrap, { autoAlpha: 0 });

      const lastIdx = pairs.reduce((acc, p, i) => (p.target ? i : acc), -1);

      // Track wrappers for cleanup.
      const wrappers = [];

      // Convert each loader img to a free-floating fixed element centered on
      // its current viewport midpoint. Each img is placed inside an
      // overflow:hidden wrapper so the inner image can animate from scale 1
      // (loader appearance) to scale 1.25 (matching .card .image-frame
      // .chromatic-stack { scale: 1.25 }) during flight, eliminating the
      // zoom jump at the hard-swap moment.
      pairs.forEach(({ img, target }, i) => {
        if (!target) return;
        const start = img.getBoundingClientRect();
        const startCX = start.left + start.width / 2;
        const startCY = start.top + start.height / 2;

        // Wrapper carries the box-shadow, position, size, and rotation.
        // overflow:hidden clips the inner img's scale so it never bleeds
        // beyond the card-slot boundary.
        const wrapper = document.createElement('div');
        wrapper.style.cssText = ['position:fixed', 'top:0', 'left:0', 'overflow:hidden', 'border-radius:0', 'will-change:transform,width,height', 'pointer-events:none'].join(';');

        img.classList.add('is-teleport');
        gsap.set(img, {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          scale: 1,
          transformOrigin: '50% 50%',
        });

        wrapper.appendChild(img);
        document.body.appendChild(wrapper);
        wrappers.push(wrapper);

        // xPercent/yPercent = -50 anchors the wrapper at its own center so
        // rotation pivots around the visual center and size tweens don't
        // offset the anchor.
        gsap.set(wrapper, {
          xPercent: -50,
          yPercent: -50,
          transformOrigin: '50% 50%',
          x: startCX,
          y: startCY,
          width: start.width,
          height: start.height,
          rotation: 0,
          zIndex: 10003,
        });

        // Fly wrapper to card slot.
        gsap.to(wrapper, {
          x: target.cx,
          y: target.cy,
          width: target.width,
          height: target.height,
          rotation: target.tiltDeg,
          duration: 0.55,
          ease: 'power3.inOut',
          delay: i * 0.04,
          onComplete: () => {
            // Hold each clone at its landed spot until the last one arrives,
            // then hard-swap: slider wrap becomes visible instantly and all
            // clones are removed the same frame. No crossfade = no dimming.
            if (i === lastIdx) {
              if (sliderWrap) gsap.set(sliderWrap, { autoAlpha: 1 });
              wrappers.forEach((w) => {
                if (w.isConnected) w.remove();
              });
              // Fade card shadows in after the swap — no shadow during load.
              gsap.to((sliderWrap || document).querySelectorAll('.card'), {
                '--card-shadow-a': 1,
                duration: 0.9,
                ease: 'power2.out',
                stagger: 0.05,
              });
            }
          },
        });

        // No scale tween needed — live chromatic-stack is scale:1.0, matching
        // the clone start state, so hard-swap is seamless without animation.
      });
    }

    function readCardTiltDeg(itemEl) {
      // Screen-space rotation of a live card = slot tilt only. The parent
      // .overlapping-slider__wrap rotates by --strip-angle; .card-tilt
      // rotates by (slotTilt - stripAngle); the two cancel, leaving slotTilt.
      const slot = parseInt(itemEl.getAttribute('data-slot') || '2', 10);
      return { 0: 4, 1: -2, 2: 0, 3: 2, 4: -4 }[slot] ?? 0;
    }

    function runWordmarkTeleport() {
      // Fly the closed "e2vc" h1 to the nav logo's position + size. Same
      // center-anchored math as the founder clones: read the bounding-rect
      // midpoint for both start and target, scale to match the nav logo's
      // rendered height.
      const h1 = container.querySelector('.e2vc-loader__h1');
      const navSvg = document.querySelector('.bold-nav-full__logo svg');
      if (!h1 || !navSvg) return;

      const start = h1.getBoundingClientRect();
      const target = navSvg.getBoundingClientRect();
      if (start.width === 0 || target.width === 0) return;

      const startCX = start.left + start.width / 2;
      const startCY = start.top + start.height / 2;
      const targetCX = target.left + target.width / 2;
      const targetCY = target.top + target.height / 2;
      // Scale by width: h1 specs now match the nav SVG (weight 700, ls
      // -0.02em), so letter shapes are identical and width-based scaling
      // produces a 1:1 hand-off. Height naturally matches.
      const scale = target.width / start.width;

      // Pin the h1 at its current viewport spot, then tween to the nav logo.
      gsap.set(h1, {
        position: 'fixed',
        top: 0,
        left: 0,
        margin: 0,
        xPercent: -50,
        yPercent: -50,
        transformOrigin: '50% 50%',
        x: startCX,
        y: startCY,
        scale: 1,
        zIndex: 10002,
      });

      // Hide the real nav logo during flight so the flying wordmark
      // doesn't visually duplicate against the static one underneath.
      gsap.set(navSvg, { autoAlpha: 0 });

      gsap.to(h1, {
        x: targetCX,
        y: targetCY,
        scale,
        duration: 0.5,
        ease: 'power3.inOut',
        onComplete: () => {
          // Hard-swap: reveal the real nav logo as we hide the flying clone.
          gsap.set(navSvg, { autoAlpha: 1 });
          gsap.set(h1, { autoAlpha: 0 });
        },
      });
    }
  }



  function initHeroScrollCue() {
    const cue = document.querySelector('.hero__scroll-cue');
    if (!cue) return;
    const svgEl = cue.querySelector('svg[data-doodle="down-arrow"]');
    if (!svgEl || typeof rough === 'undefined') return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const accent = '#3451f5';
    const rc = rough.svg(svgEl);

    // 8 seeded frame variants, cycled by startBoiling for the same
    // "boiling line" texture as the rest of the doodle kit.
    const frames = [];
    for (let f = 0; f < 8; f++) {
      const base = (extra) => Object.assign({ roughness: 1.8, strokeWidth: 3, stroke: accent, fill: 'none' }, extra, { seed: ((extra && extra.seed) || 4) + f * 17 });
      const frameG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      frameG.setAttribute('filter', 'url(#ink-texture)');
      if (f > 0) frameG.style.display = 'none';
      frameG.appendChild(rc.line(40, 8, 40, 104, base()));
      frameG.appendChild(rc.line(16, 80, 40, 104, base({ roughness: 1.4, seed: 8 })));
      frameG.appendChild(rc.line(64, 80, 40, 104, base({ roughness: 1.4, seed: 11 })));
      svgEl.appendChild(frameG);
      frames.push(frameG);
    }

    if (!reducedMotion) {
      startBoiling([frames]);
      gsap.to(cue, {
        y: 10,
        duration: 1.1,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        delay: 0.5,
      });
    }

    cue.addEventListener('click', () => {
      const hero = document.querySelector('.hero');
      const target = (hero && hero.nextElementSibling) || document.querySelector('.doodle-showcase');
      const top = target ? target.getBoundingClientRect().top + window.scrollY : window.scrollY + window.innerHeight;
      window.scrollTo({ top, behavior: 'smooth' });
    });

    // Hide once the hero section scrolls out of view
    const label = document.querySelector('.hero__scroll-cue-label');
    const heroSection = document.querySelector('.hero');
    if (heroSection) {
      const obs = new IntersectionObserver(
        ([entry]) => {
          cue.classList.toggle('is-hidden', !entry.isIntersecting);
          if (label) label.classList.toggle('is-hidden', !entry.isIntersecting);
        },
        { threshold: 0 },
      );
      obs.observe(heroSection);
    }
  }



  function initDoodleShowcase() {
    const section = document.querySelector('.doodle-showcase');
    if (!section || typeof rough === 'undefined') return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const accent = '#3451f5';

    // Each doodle renders 3 frame variants with different Rough.js seeds,
    // cycled at ~15fps for a hand-drawn "boiling line" feel.
    const makeBase = (frame) => (extra) => {
      const s = extra && extra.seed !== undefined ? extra.seed : 4;
      return Object.assign(
        {
          roughness: 2.8,
          strokeWidth: 3,
          stroke: accent,
          fill: 'none',
        },
        extra,
        { seed: s + frame * 17 },
      );
    };

    const recipes = {
      circle: (rc, b) => [rc.ellipse(80, 40, 112, 54, b())],
      underline: (rc, b) => [rc.line(16, 54, 144, 50, b({ roughness: 1.8 }))],
      box: (rc, b) => [rc.rectangle(16, 10, 128, 60, b({ roughness: 2.4 }))],
      highlight: (rc, b) => [
        rc.rectangle(
          16,
          18,
          128,
          44,
          b({
            roughness: 1.4,
            strokeWidth: 0,
            stroke: 'none',
            fill: 'rgba(52,81,245,0.22)',
            fillStyle: 'hachure',
            fillWeight: 2.5,
            hachureGap: 8,
            hachureAngle: -41,
          }),
        ),
        rc.rectangle(16, 18, 128, 44, b({ roughness: 1.6, strokeWidth: 2 })),
      ],
      'strike-through': (rc, b) => [rc.line(14, 40, 146, 36, b({ roughness: 1.8 }))],
      'crossed-off': (rc, b) => [rc.line(14, 12, 146, 68, b()), rc.line(146, 12, 14, 68, b({ seed: 9 }))],
      bracket: (rc, b) => [rc.line(44, 10, 30, 10, b({ roughness: 1.5 })), rc.line(30, 10, 30, 70, b({ roughness: 1.8 })), rc.line(30, 70, 44, 70, b({ roughness: 1.5 })), rc.line(116, 10, 130, 10, b({ roughness: 1.5, seed: 7 })), rc.line(130, 10, 130, 70, b({ roughness: 1.8, seed: 7 })), rc.line(130, 70, 116, 70, b({ roughness: 1.5, seed: 7 }))],
      arrow: (rc, b) => [rc.line(14, 40, 138, 40, b({ roughness: 1.6 })), rc.line(114, 22, 138, 40, b({ roughness: 1.4, seed: 8 })), rc.line(114, 58, 138, 40, b({ roughness: 1.4, seed: 11 }))],
      'curved-arrow': (rc, b) => [
        rc.curve(
          [
            [18, 68],
            [80, 10],
            [142, 68],
          ],
          b({ roughness: 2 }),
        ),
        rc.line(118, 52, 142, 68, b({ roughness: 1.4, seed: 5 })),
        rc.line(118, 74, 142, 68, b({ roughness: 1.4, seed: 6 })),
      ],
      'wavy-line': (rc, b) => [
        rc.curve(
          [
            [6, 40],
            [34, 12],
            [62, 40],
            [90, 68],
            [118, 40],
            [146, 12],
            [158, 40],
          ],
          b({ roughness: 1.6 }),
        ),
      ],
    };

    const tl = gsap.timeline({ paused: true });
    const boilers = [];

    section.querySelectorAll('[data-doodle]').forEach((svgEl, ci) => {
      const type = svgEl.getAttribute('data-doodle');
      const fn = recipes[type];
      if (!fn) return;
      const rc = rough.svg(svgEl);

      // Build 8 frame groups; only frame 0 is visible initially. More
      // variants + random pick = generative, non-repeating feel at low fps.
      const frames = [];
      const paths = [];
      for (let f = 0; f < 8; f++) {
        const frameG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        frameG.setAttribute('filter', 'url(#ink-texture)');
        if (f > 0) frameG.style.display = 'none';
        fn(rc, makeBase(f)).forEach((g) => frameG.appendChild(g));
        svgEl.appendChild(frameG);
        frames.push(frameG);
        if (f === 0) frameG.querySelectorAll('path').forEach((p) => paths.push(p));
      }
      boilers.push(frames);

      if (reducedMotion) return;

      // Hide via direct CSS (no GSAP tick needed at init time)
      paths.forEach((p) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray = `${len} ${len + 1}`;
        p.style.strokeDashoffset = `${len}`;
      });

      tl.to(
        paths,
        {
          strokeDashoffset: 0,
          duration: 1.4,
          ease: 'power2.out',
          stagger: 0.05,
        },
        ci * 0.13,
      );
    });

    if (reducedMotion) return;

    tl.eventCallback('onComplete', () => startBoiling(boilers));

    // IntersectionObserver is immune to Locomotive Scroll scroll position quirks
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          tl.play();
        }
      },
      { threshold: 0.15 },
    );

    observer.observe(section);
  }



  function initEditorialTitleDoodle() {
    const target = document.querySelector('.editorial-title__group');
    if (!target || typeof rough === 'undefined') return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = () => {
      const old = target.querySelector('.group-rough-underline');
      if (old) old.remove();
      const w = target.offsetWidth;
      const h = target.offsetHeight;
      if (!w || !h) return;
      const padX = Math.max(8, w * 0.02);
      const padY = Math.max(12, h * 0.22);
      const svgW = w + padX * 2;
      const svgH = padY * 2;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'group-rough-underline');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
      svg.style.left = `-${padX}px`;
      svg.style.top = `${h - padY * 0.35}px`;
      svg.style.width = `${svgW}px`;
      svg.style.height = `${svgH}px`;
      const rc = rough.svg(svg);
      // 8 seeded frame variants so the underline boils like the rest.
      const frames = [];
      for (let f = 0; f < 8; f++) {
        const frameG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        frameG.setAttribute('filter', 'url(#ink-texture)');
        if (f > 0) frameG.style.display = 'none';
        frameG.appendChild(
          rc.line(padX * 0.6, svgH * 0.45, svgW - padX * 0.6, svgH * 0.55, {
            roughness: 2.2,
            strokeWidth: 5,
            stroke: '#3451f5',
            seed: 4 + f * 17,
          }),
        );
        svg.appendChild(frameG);
        frames.push(frameG);
      }
      target.appendChild(svg);
      if (reducedMotion) {
        startBoiling([frames]);
        return;
      }
      gsap.registerPlugin(DrawSVGPlugin, ScrollTrigger);
      const paths = frames[0].querySelectorAll('path');
      // Set starting state immediately so the line is hidden before trigger fires.
      gsap.set(paths, { drawSVG: '0%' });
      ScrollTrigger.create({
        trigger: target,
        start: 'top 85%',
        once: true,
        onEnter: () => {
          gsap.to(paths, {
            drawSVG: '100%',
            duration: 0.9,
            stagger: 0.08,
            ease: 'power2.out',
            onComplete: () => startBoiling([frames]),
          });
        },
      });
      ScrollTrigger.refresh();
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => requestAnimationFrame(draw));
    } else {
      requestAnimationFrame(draw);
    }
    let resizeRaf = null;
    window.addEventListener('resize', () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(draw);
    });
  }



  // Slow, generative hand-drawn "boiling" effect across every registered
  // set of frame groups. Each set tracks its own current frame and picks a
  // new random one every tick (never the same one twice in a row), so the
  // doodles look like fresh drawings each time rather than a short loop.
  // ~4fps keeps it pleasant / ambient rather than distracting.
  function startBoiling(frameSets) {
    if (!frameSets || !frameSets.length) return;
    const store = (window.__boilStore = window.__boilStore || []);
    frameSets.forEach((frames) => store.push({ frames, current: 0 }));
    if (window.__boilStarted) return;
    window.__boilStarted = true;
    setInterval(() => {
      // Reap detached sets (e.g. the editorial underline that redraws on resize).
      for (let i = store.length - 1; i >= 0; i--) {
        if (!store[i].frames[0].isConnected) store.splice(i, 1);
      }
      store.forEach((entry) => {
        const n = entry.frames.length;
        if (n < 2) return;
        let next = Math.floor(Math.random() * (n - 1));
        if (next >= entry.current) next += 1; // skip current → non-repeating
        entry.frames[entry.current].style.display = 'none';
        entry.frames[next].style.display = '';
        entry.current = next;
      });
    }, 500);
  }



  /* Osmo "Interactive Pixel Grid" adapted for the editorial section:
   - single white fill, alpha tweens to 0.1 (subtle drawing trail)
   - no stroked grid lines
   - mousemove bound to host section (canvas is pointer-events: none so
     card clicks pass through)
   - rAF paused via IntersectionObserver when offscreen
   - skipped for prefers-reduced-motion + touch devices */

  /* Doodle asterisk in each editorial card image — drawn with Rough.js,
   boiling while hovered. Stroke color matches --card-color. */
  function initEditorialCardAsterisks() {
    if (typeof rough === 'undefined') return;

    document.querySelectorAll('.editorial-card__asterisk').forEach((svgEl) => {
      const card = svgEl.closest('.editorial-card');
      if (!card) return;

      // Parse --card-color from the element's style attribute string directly
      const styleAttr = card.getAttribute('style') || '';
      const colorMatch = styleAttr.match(/--card-color:\s*([^;}"]+)/);
      const color = colorMatch ? colorMatch[1].trim() : '#ffffff';

      const rc = rough.svg(svgEl);
      const cx = 32,
        cy = 32,
        r = 22,
        spokes = 3;
      const mkOpts = (f, s) => ({
        roughness: 2.6,
        strokeWidth: 3.2,
        stroke: color,
        fill: 'none',
        seed: s + f * 17,
      });

      const frames = [];
      for (let f = 0; f < 8; f++) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('filter', 'url(#ink-texture)');
        if (f > 0) g.style.display = 'none';
        for (let i = 0; i < spokes; i++) {
          const a = (Math.PI / spokes) * i;
          g.appendChild(rc.line(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx - Math.cos(a) * r, cy - Math.sin(a) * r, mkOpts(f, i * 3 + 1)));
        }
        svgEl.appendChild(g);
        frames.push(g);
      }
      startBoiling([frames]);
    });
  }



  function drawDoodleAsterisk(svgEl, color) {
    if (typeof rough === 'undefined') return;
    svgEl.innerHTML = '';
    const rc = rough.svg(svgEl);
    const cx = 32,
      cy = 32,
      r = 22,
      spokes = 3;
    const mkOpts = (f, s) => ({
      roughness: 2.6,
      strokeWidth: 3.2,
      stroke: color,
      fill: 'none',
      seed: s + f * 17,
    });
    const frames = [];
    for (let f = 0; f < 8; f++) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('filter', 'url(#ink-texture)');
      if (f > 0) g.style.display = 'none';
      for (let i = 0; i < spokes; i++) {
        const a = (Math.PI / spokes) * i;
        g.appendChild(rc.line(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx - Math.cos(a) * r, cy - Math.sin(a) * r, mkOpts(f, i * 3 + 1)));
      }
      svgEl.appendChild(g);
      frames.push(g);
    }
    startBoiling([frames]);
  }



  function initEditorialPixelGrid() {
    const hosts = document.querySelectorAll('[data-editorial-pixel-grid]');
    if (!hosts.length) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    const debounce = (fn, wait) => {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
      };
    };

    hosts.forEach((el) => {
      const section = el.closest('section') || el.parentElement;
      if (!section) return;

      const gridSizeDesktop = parseInt(el.getAttribute('data-grid-size-desktop'), 10) || 28;
      const gridSizeMobile = parseInt(el.getAttribute('data-grid-size-mobile'), 10) || 12;
      const gridBackground = el.getAttribute('data-grid-background') || 'transparent';

      if (gridBackground && gridBackground !== 'transparent') {
        el.style.backgroundColor = gridBackground;
      }

      const canvas = document.createElement('canvas');
      el.appendChild(canvas);
      const ctx = canvas.getContext('2d');

      let cols, rows, squareSize, blocks;
      let lastHoveredIndex = null;
      let rafId = null;

      function setupGrid() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        cols = window.innerWidth < 768 ? gridSizeMobile : gridSizeDesktop;
        squareSize = w / cols;
        rows = Math.ceil(h / squareSize);
        blocks = [];
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            blocks.push({ x: x * squareSize, y: y * squareSize, alpha: 0 });
          }
        }
      }

      function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fcf7f0';
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          if (b.alpha <= 0) continue;
          ctx.globalAlpha = b.alpha;
          ctx.fillRect(b.x, b.y, squareSize, squareSize);
        }
        ctx.globalAlpha = 1;
        rafId = requestAnimationFrame(draw);
      }

      function startDraw() {
        if (rafId == null) rafId = requestAnimationFrame(draw);
      }
      function stopDraw() {
        if (rafId != null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      }

      const onMove = (event) => {
        if (!blocks || !blocks.length) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        if (mouseX < 0 || mouseY < 0 || mouseX >= rect.width || mouseY >= rect.height) return;
        const cx = Math.floor(mouseX / squareSize);
        const cy = Math.floor(mouseY / squareSize);
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
        const idx = cy * cols + cx;
        if (idx === lastHoveredIndex) return;
        lastHoveredIndex = idx;
        const block = blocks[idx];
        if (!block) return;
        gsap.killTweensOf(block);
        gsap.to(block, { alpha: 0.1, duration: 0.1, overwrite: true });
        gsap.to(block, { alpha: 0, duration: 2, delay: 0.5 });
      };

      setupGrid();
      startDraw();

      window.addEventListener('resize', debounce(setupGrid, 200));

      if (!reduceMotion && !isTouch) {
        section.addEventListener('mousemove', onMove, { passive: true });
      }

      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) startDraw();
              else stopDraw();
            }
          },
          { rootMargin: '200px 0px' },
        );
        io.observe(section);
      }
    });
  }



  /* ---------- Founder order shuffle (loader + carousel in lockstep) ----------
   Runs once before initE2vcLoader / initOverlappingSlider so both the
   loader's vertical image stack AND the carousel's source items end up
   in the same random order on every reload. The loader's burst hands
   each clone off to the matching carousel slot, so by keeping orders in
   sync the flights stay parallel — no crossing paths or z-index glitches
   as multiple clones overlap mid-flight.
   data-slot (0..4) is reassigned by NEW position so the lg/md/sm/md/lg
   size + rotation pattern stays consistent regardless of which founder
   lands in each slot. */
  function shuffleFoundersDOM() {
    const stackEl = document.querySelector('.e2vc-loader__stack');
    const listEl = document.querySelector('[data-overlap-slider-list]');

    const loaderImgs = stackEl ? Array.from(stackEl.querySelectorAll('.e2vc-loader__img')) : [];
    const sourceItems = listEl ? Array.from(listEl.querySelectorAll('[data-overlap-slider-item]')) : [];
    const n = Math.max(loaderImgs.length, sourceItems.length);
    if (!n) return;

    // Fisher-Yates on a shared index permutation.
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    order.forEach((srcIdx, newIdx) => {
      const img = loaderImgs[srcIdx];
      if (img && stackEl) {
        stackEl.appendChild(img);
        // Highest z-index on top — cycle fades from top down, so newIdx 0
        // shows first and newIdx (n-1) is the final/stay frame.
        img.style.zIndex = String(loaderImgs.length - newIdx);
      }
      const item = sourceItems[srcIdx];
      if (item && listEl) {
        listEl.appendChild(item);
        item.setAttribute('data-slot', String(newIdx % 5));
      }
    });
  }



  document.addEventListener('DOMContentLoaded', () => {
    shuffleFoundersDOM();
    initE2vcLoader();
    const locomotiveScroll = new LocomotiveScroll({
      lenisOptions: {
        lerp: 0.075,
        smoothWheel: true,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      },
    });
    initOverlappingSlider();
    initScrambleTextCursor();
    initRippleGrid();
    initBoldFullScreenNavigation();
    initIdleScreensaver();
    initHeroStackingParallax();
    initColumnCurtain();
    initEditorialThemeSwitch();
    initShutterScrollTransition();
    initEditorialCards();
    initContentRevealScroll();

    initFooterClock();
    initNavThemeOverFooter();
    initDoodleShowcase();
    initHeroScrollCue();
    initEditorialTitleDoodle();
    initEditorialCardAsterisks();
    initNavDoodleAsterisk();
    initFooterDoodleAsterisks();
    initEditorialPixelGrid();
    // Defer Matter init until after layout + locomotive-scroll mount so
    // the canvas reads its real pixel size.
    window.addEventListener('load', () => {
      requestAnimationFrame(() => initFalling2DMatterJS());
      initFooterParallax();
      ScrollTrigger.refresh();
    });
    // Wait for fonts so line splits are stable. Fallback if document.fonts
    // is unavailable (very old browsers) runs immediately.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(initTextReveal);
    } else {
      initTextReveal();
    }
  });



