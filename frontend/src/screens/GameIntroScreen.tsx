import { useState, useEffect } from 'react';

const LOADING_STEPS = [
  { icon: '⭐', label: 'Connecting to Stellar Testnet…' },
  { icon: '🔐', label: 'Loading ZK circuit…' },
  { icon: '🃏', label: 'Shuffling the deck…' },
  { icon: '⚡', label: 'Verifying on-chain proofs…' },
  { icon: '✅', label: 'Table ready!' },
];

const FLYING_CARDS = [
  { face: 'A', suit: '♠', red: false, cls: 'fc-0' },
  { face: 'K', suit: '♥', red: true,  cls: 'fc-1' },
  { face: 'Q', suit: '♦', red: true,  cls: 'fc-2' },
  { face: 'J', suit: '♣', red: false, cls: 'fc-3' },
  { face: '10', suit: '♥', red: true, cls: 'fc-4' },
  { face: 'A', suit: '♦', red: true,  cls: 'fc-5' },
  { face: '7', suit: '♠', red: false, cls: 'fc-6' },
  { face: '9', suit: '♣', red: false, cls: 'fc-7' },
];

export interface GameIntroScreenProps {
  gameName: string;
  tagline?: string;
  onComplete: () => void;
}

export function GameIntroScreen({ gameName, tagline = 'Provably Fair · Zero-Knowledge · Stellar', onComplete }: GameIntroScreenProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [exiting, setExiting] = useState(false);

  const finish = () => {
    setExiting(true);
    setTimeout(onComplete, 500);
  };

  useEffect(() => {
    const totalMs = 3200;
    const stepMs = totalMs / LOADING_STEPS.length;
    const timers: ReturnType<typeof setTimeout>[] = [];

    LOADING_STEPS.forEach((_, i) => {
      timers.push(setTimeout(() => setCurrentStep(i), i * stepMs + 80));
    });

    timers.push(setTimeout(finish, totalMs + 200));

    const interval = setInterval(() => {
      setProgress(p => {
        const next = p + 100 / (totalMs / 40);
        return next >= 100 ? 100 : next;
      });
    }, 40);

    return () => {
      timers.forEach(clearTimeout);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className={`gi-overlay${exiting ? ' gi-exit' : ''}`}>
      {/* Animated background layers */}
      <div className="gi-bg-glow" />
      <div className="gi-bg-grid" />

      {/* Flying cards */}
      {FLYING_CARDS.map((c) => (
        <div key={c.cls} className={`gi-card ${c.cls} ${c.red ? 'red' : 'blk'}`}>
          <span className="gi-cr">{c.face}</span>
          <span className="gi-cs">{c.suit}</span>
        </div>
      ))}

      {/* Chip particles */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} className={`gi-chip gi-chip-${i}`} />
      ))}

      {/* Center stage */}
      <div className="gi-center">
        <div className="gi-emblem">
          <div className="gi-emblem-ring" />
          <span className="gi-emblem-icon">🃏</span>
        </div>

        <h1 className="gi-title">{gameName}</h1>
        <p className="gi-tagline">{tagline}</p>

        <div className="gi-steps">
          {LOADING_STEPS.map((step, i) => (
            <div
              key={i}
              className={`gi-step ${i < currentStep ? 'gi-step-done' : i === currentStep ? 'gi-step-active' : 'gi-step-pending'}`}
            >
              <span className="gi-step-icon">
                {i < currentStep ? '✓' : step.icon}
              </span>
              <span className="gi-step-label">{step.label}</span>
              {i === currentStep && <span className="gi-step-spinner" />}
            </div>
          ))}
        </div>

        <div className="gi-bar-wrap">
          <div className="gi-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="gi-bar-pct">{Math.round(progress)}%</div>

        <button type="button" className="gi-skip" onClick={finish}>
          Pular intro →
        </button>
      </div>
    </div>
  );
}
