// The full spin experience — wheel, animation, ticks, confetti, result card —
// reusable by the public customer page AND the marketing test mode. The
// component never decides the prize: `resolvePrize()` does (the server for
// real spins, local randomness for tests).
import { useState, useEffect, useRef, useCallback } from 'react';
import { WheelSvg } from './wheelShared';

const SPIN_MS = 6200;
const EXTRA_TURNS = 6;

const easeOutSpin = (t) => 1 - Math.pow(1 - t, 4);

export default function WheelStage({
  slices,
  resolvePrize,        // async () => { prize_label, prize_index, is_top_prize }
  initialResult = null, // pre-spun state (revisited link): show result, no spin
  resultNote = '',
  allowRespin = false,
  onPhaseChange = null
}) {
  const [phase, setPhase] = useState(initialResult ? 'done' : 'idle'); // idle | spinning | done
  const [result, setResult] = useState(initialResult);
  const [error, setError] = useState('');
  const [rotation, setRotation] = useState(() => {
    if (!initialResult || initialResult.prize_index === null || !slices.length) return 0;
    return 360 - (initialResult.prize_index + 0.5) * (360 / slices.length);
  });
  const [flash, setFlash] = useState(false);

  const confettiRef = useRef(null);
  const rafRef = useRef(0);
  const audioCtxRef = useRef(null);
  const confettiParticlesRef = useRef([]);
  const confettiRafRef = useRef(0);
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    cancelAnimationFrame(confettiRafRef.current);
  }, []);

  useEffect(() => {
    if (onPhaseChange) onPhaseChange(phase, result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const tick = useCallback((freq = 1200, gainPeak = 0.12) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(gainPeak, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    } catch { /* sound optional */ }
  }, []);

  const fanfare = useCallback((big) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      const notes = big ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const start = ctx.currentTime + i * (big ? 0.13 : 0.16);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + (big ? 0.9 : 0.5));
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 1);
      });
    } catch { /* sound optional */ }
  }, []);

  const burstConfetti = useCallback((opts = {}) => {
    const canvas = confettiRef.current;
    if (!canvas) return;
    const { count = 160, gold = false, spreadX = 0.5 } = opts;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    const palette = gold
      ? ['#fbbf24', '#f59e0b', '#fde68a', '#ffffff', '#fca5a5', '#fcd34d']
      : ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff'];
    const particles = confettiParticlesRef.current;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: canvas.width * (spreadX + (Math.random() - 0.5) * 0.3),
        y: canvas.height * 0.35,
        vx: (Math.random() - 0.5) * 22 * dpr,
        vy: (Math.random() * -18 - 6) * dpr,
        w: (Math.random() * 8 + 5) * dpr,
        h: (Math.random() * 5 + 4) * dpr,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        color: palette[Math.floor(Math.random() * palette.length)],
        life: 1
      });
    }
    if (confettiRafRef.current) return; // loop already running
    const ctx = canvas.getContext('2d');
    const gravity = 0.55 * dpr;
    const step = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const alive = [];
      for (const p of particles) {
        p.vy += gravity;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.006;
        if (p.life > 0 && p.y < canvas.height + 40) {
          alive.push(p);
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      }
      confettiParticlesRef.current = alive;
      if (alive.length > 0) {
        confettiRafRef.current = requestAnimationFrame(step);
      } else {
        confettiRafRef.current = 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    confettiRafRef.current = requestAnimationFrame(step);
  }, []);

  const celebrate = useCallback((isTop) => {
    fanfare(isTop);
    if (isTop) {
      setFlash(true);
      setTimeout(() => setFlash(false), 900);
      burstConfetti({ count: 260, gold: true, spreadX: 0.5 });
      setTimeout(() => burstConfetti({ count: 180, gold: true, spreadX: 0.15 }), 500);
      setTimeout(() => burstConfetti({ count: 180, gold: true, spreadX: 0.85 }), 1000);
      setTimeout(() => burstConfetti({ count: 220, gold: true, spreadX: 0.5 }), 1800);
    } else {
      burstConfetti({ count: 170, spreadX: 0.5 });
    }
  }, [burstConfetti, fanfare]);

  const spin = async () => {
    if (phase !== 'idle' || slices.length < 2) return;
    setPhase('spinning');
    setError('');
    let prize;
    try {
      prize = await resolvePrize();
    } catch (err) {
      setPhase('idle');
      setError(err?.message || 'No se pudo girar. Intenta de nuevo.');
      return;
    }
    if (!prize || prize.prize_index === null || prize.prize_index === undefined) {
      setPhase('idle');
      setError('No se pudo girar. Intenta de nuevo.');
      return;
    }

    const sliceAngle = 360 / slices.length;
    // Land the CENTER of the winning slice under the pointer, with a little
    // jitter so it doesn't look robotic (±35% of the slice, never the edge).
    const jitter = (Math.random() - 0.5) * sliceAngle * 0.7;
    const startRotation = rotationRef.current;
    // Delta from wherever the wheel currently rests to the target landing,
    // plus full extra turns — works for first spins AND test respins.
    const landing = 360 - (prize.prize_index + 0.5) * sliceAngle + jitter;
    const delta = 360 * EXTRA_TURNS + ((landing - (startRotation % 360)) % 360 + 360) % 360;

    const startTime = performance.now();
    let lastTickIndex = -1;
    const animate = (now) => {
      const t = Math.min(1, (now - startTime) / SPIN_MS);
      const angle = startRotation + delta * easeOutSpin(t);
      setRotation(angle);
      const boundaryIndex = Math.floor(angle / sliceAngle);
      if (boundaryIndex !== lastTickIndex) {
        lastTickIndex = boundaryIndex;
        tick(900 + Math.random() * 200, t > 0.8 ? 0.06 : 0.12);
      }
      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setResult(prize);
        setPhase('done');
        celebrate(Boolean(prize.is_top_prize));
      }
    };
    rafRef.current = requestAnimationFrame(animate);
  };

  const respin = () => {
    setResult(null);
    setPhase('idle');
    setError('');
  };

  return (
    <>
      {flash && <div className="wheel-flash" />}
      <canvas ref={confettiRef} className="wheel-confetti" />

      <div className="wheel-stage">
        <div className="wheel-pointer" aria-hidden="true" />
        <div className="wheel-ring" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => {
            const rad = (i * 30 * Math.PI) / 180;
            return (
              <span
                key={i}
                className="wheel-bulb"
                style={{ left: `${50 + 48.5 * Math.sin(rad)}%`, top: `${50 - 48.5 * Math.cos(rad)}%` }}
              />
            );
          })}
        </div>
        <WheelSvg slices={slices} rotation={rotation} />
        <button
          type="button"
          className={`wheel-hub ${phase !== 'idle' ? 'is-locked' : ''}`}
          onClick={spin}
          disabled={phase !== 'idle'}
        >
          {phase === 'idle' ? 'GIRAR' : phase === 'spinning' ? '…' : '🎉'}
        </button>
      </div>

      {error && phase === 'idle' && <div className="wheel-error">{error}</div>}

      {phase === 'done' && result && (
        <div className={`wheel-result ${result.is_top_prize ? 'is-top' : ''}`}>
          {result.is_top_prize && <div className="wheel-jackpot-banner">🏆 ¡PREMIO MAYOR! 🏆</div>}
          <div className="wheel-result-label">{result.is_top_prize ? 'Increíble, ganaste:' : 'Tu premio:'}</div>
          <div className="wheel-result-prize">{result.prize_label}</div>
          {resultNote && <p className="wheel-result-note">{resultNote}</p>}
          {allowRespin && (
            <button type="button" className="wheel-respin-btn" onClick={respin}>
              ↻ Girar de nuevo (prueba)
            </button>
          )}
        </div>
      )}
    </>
  );
}
