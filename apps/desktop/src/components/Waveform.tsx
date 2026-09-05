import { motion } from "framer-motion";

interface WaveformProps {
  index: number;
  isRecording: boolean;
  // Real-time amplitude in [0, 1]. Drives the *envelope* (bar height) only;
  // the wavy oscillation is decoupled and runs at fixed amplitude so it
  // doesn't restart on every level update.
  level: number;
  baseHeight?: number;
  silentHeight?: number;
}

// Per-bar height factor — gives the row a "mountain" silhouette.
const BAR_FACTORS = [0.65, 0.9, 1.15, 1.15, 0.9, 0.65];

// Below this normalised level we settle to a gentle idle wave —
// keeps bars visibly listening rather than dead flat.
const WAVE_THRESHOLD = 0.01;

const SCALE_WAVE = [1, 1.35, 1, 0.75, 1];
const SCALE_IDLE = [1, 1.15, 1, 0.9, 1];

export function Waveform({
  index,
  isRecording,
  level,
  baseHeight = 85,
  silentHeight = 25,
}: WaveformProps) {
  if (!isRecording) {
    return <div className="h-[20%] w-1 rounded-full bg-white/40" />;
  }

  const factor = BAR_FACTORS[index % BAR_FACTORS.length] ?? 1;
  const range = baseHeight - silentHeight;
  const clamped = Math.min(1, Math.max(0, level));
  const center = silentHeight + range * clamped * factor;
  const isWaving = clamped > WAVE_THRESHOLD;

  return (
    <motion.div
      className={`w-1 rounded-full transition-colors duration-150 ${
        isWaving
          ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
          : "bg-white/80"
      }`}
      animate={{
        // Envelope: smooth single-value tween. Changes with level.
        height: `${center}%`,
        // Wave: fixed keyframes that animate dynamically when speech is present
        scaleY: isWaving ? SCALE_WAVE : SCALE_IDLE,
      }}
      transition={{
        height: { duration: 0.1, ease: "easeOut" },
        scaleY: {
          duration: isWaving ? 0.6 : 1.2,
          ease: "easeInOut",
          repeat: Number.POSITIVE_INFINITY,
          repeatType: "loop",
          delay: index * 0.08,
        },
      }}
    />
  );
}
