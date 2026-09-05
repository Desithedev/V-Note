export interface SpeakerTheme {
  id: string;
  name: string;
  avatarLetter: string;
  avatarBg: string;
  badgeBg: string;
  badgeText: string;
  cardBg: string;
  cardBorder: string;
  cardActiveRing: string;
  cardHoverBorder: string;
  indicatorColor: string;
}

export const SPEAKER_THEMES: SpeakerTheme[] = [
  {
    id: "you",
    name: "Bạn (Mic)",
    avatarLetter: "B",
    avatarBg: "bg-sky-500 text-white shadow-sky-500/20",
    badgeBg: "bg-sky-500/15 border-sky-500/30 text-sky-600 dark:text-sky-400",
    badgeText: "text-sky-600 dark:text-sky-400",
    cardBg: "bg-sky-500/5 hover:bg-sky-500/10 dark:bg-sky-950/20 dark:hover:bg-sky-950/30",
    cardBorder: "border-sky-500/25",
    cardActiveRing: "ring-2 ring-sky-400 border-sky-500/60 bg-sky-500/15 dark:bg-sky-950/40 text-sky-100",
    cardHoverBorder: "hover:border-sky-500/50",
    indicatorColor: "bg-sky-500",
  },
  {
    id: "spk-1",
    name: "Người 1 (Hệ thống)",
    avatarLetter: "1",
    avatarBg: "bg-emerald-500 text-white shadow-emerald-500/20",
    badgeBg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
    badgeText: "text-emerald-600 dark:text-emerald-400",
    cardBg: "bg-emerald-500/5 hover:bg-emerald-500/10 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30",
    cardBorder: "border-emerald-500/25",
    cardActiveRing: "ring-2 ring-emerald-400 border-emerald-500/60 bg-emerald-500/15 dark:bg-emerald-950/40 text-emerald-100",
    cardHoverBorder: "hover:border-emerald-500/50",
    indicatorColor: "bg-emerald-500",
  },
  {
    id: "spk-2",
    name: "Người 2",
    avatarLetter: "2",
    avatarBg: "bg-violet-500 text-white shadow-violet-500/20",
    badgeBg: "bg-violet-500/15 border-violet-500/30 text-violet-600 dark:text-violet-400",
    badgeText: "text-violet-600 dark:text-violet-400",
    cardBg: "bg-violet-500/5 hover:bg-violet-500/10 dark:bg-violet-950/20 dark:hover:bg-violet-950/30",
    cardBorder: "border-violet-500/25",
    cardActiveRing: "ring-2 ring-violet-400 border-violet-500/60 bg-violet-500/15 dark:bg-violet-950/40 text-violet-100",
    cardHoverBorder: "hover:border-violet-500/50",
    indicatorColor: "bg-violet-500",
  },
  {
    id: "spk-3",
    name: "Người 3",
    avatarLetter: "3",
    avatarBg: "bg-amber-500 text-white shadow-amber-500/20",
    badgeBg: "bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400",
    badgeText: "text-amber-600 dark:text-amber-400",
    cardBg: "bg-amber-500/5 hover:bg-amber-500/10 dark:bg-amber-950/20 dark:hover:bg-amber-950/30",
    cardBorder: "border-amber-500/25",
    cardActiveRing: "ring-2 ring-amber-400 border-amber-500/60 bg-amber-500/15 dark:bg-amber-950/40 text-amber-100",
    cardHoverBorder: "hover:border-amber-500/50",
    indicatorColor: "bg-amber-500",
  },
  {
    id: "spk-4",
    name: "Người 4",
    avatarLetter: "4",
    avatarBg: "bg-rose-500 text-white shadow-rose-500/20",
    badgeBg: "bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400",
    badgeText: "text-rose-600 dark:text-rose-400",
    cardBg: "bg-rose-500/5 hover:bg-rose-500/10 dark:bg-rose-950/20 dark:hover:bg-rose-950/30",
    cardBorder: "border-rose-500/25",
    cardActiveRing: "ring-2 ring-rose-400 border-rose-500/60 bg-rose-500/15 dark:bg-rose-950/40 text-rose-100",
    cardHoverBorder: "hover:border-rose-500/50",
    indicatorColor: "bg-rose-500",
  },
  {
    id: "spk-5",
    name: "Người 5",
    avatarLetter: "5",
    avatarBg: "bg-cyan-500 text-white shadow-cyan-500/20",
    badgeBg: "bg-cyan-500/15 border-cyan-500/30 text-cyan-600 dark:text-cyan-400",
    badgeText: "text-cyan-600 dark:text-cyan-400",
    cardBg: "bg-cyan-500/5 hover:bg-cyan-500/10 dark:bg-cyan-950/20 dark:hover:bg-cyan-950/30",
    cardBorder: "border-cyan-500/25",
    cardActiveRing: "ring-2 ring-cyan-400 border-cyan-500/60 bg-cyan-500/15 dark:bg-cyan-950/40 text-cyan-100",
    cardHoverBorder: "hover:border-cyan-500/50",
    indicatorColor: "bg-cyan-500",
  },
];

/**
 * Resolve a speaker theme from a speakerId and optional custom label.
 * Stable across chunks — the same speakerId always returns the same theme.
 */
export function getSpeakerTheme(
  speakerKey: string,
  speakerIndex = 0,
  customLabel?: string,
): SpeakerTheme {
  if (speakerKey === "you" || speakerKey === "mic") {
    return {
      ...SPEAKER_THEMES[0],
      name: customLabel || SPEAKER_THEMES[0].name,
    };
  }

  let idx = speakerIndex;
  if (speakerKey) {
    const num = speakerKey.match(/\d+/);
    if (num) {
      const parsed = parseInt(num[0], 10);
      idx = speakerKey.startsWith("SPEAKER_")
        ? parsed
        : parsed > 0
          ? parsed - 1
          : 0;
    }
  }

  const themeIndex = 1 + (idx % (SPEAKER_THEMES.length - 1));
  const base = SPEAKER_THEMES[themeIndex] || SPEAKER_THEMES[1];
  const name = customLabel || (base ? base.name : `Người ${idx + 1}`);
  const letter = name.trim().charAt(0).toUpperCase() || `${idx + 1}`;

  return {
    ...base,
    id: `spk-${idx + 1}`,
    name,
    avatarLetter: letter,
  };
}
