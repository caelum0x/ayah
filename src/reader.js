// Continuous surah-by-surah progression through the Quran in canonical
// order (1 Al-Faatiha ... 114 An-Naas), not a date-gated daily plan.
// Surah length varies from 3 ayat (An-Nasr) to 286 (Al-Baqara), so a
// Stichos-style "one unit a day" calendar would make some days trivial
// and others unreadable in one sitting. Position is saved as
// { surah, ayah } and resumed on next open; the reader advances to the
// next surah automatically once the last ayah of a surah is reached.

export function surahByNumber(surahs, number) {
  return surahs.find((s) => s.number === number) || null;
}

export function nextSurahNumber(surahs, number) {
  const index = surahs.findIndex((s) => s.number === number);
  if (index < 0) return surahs[0].number;
  return surahs[(index + 1) % surahs.length].number;
}

export function prevSurahNumber(surahs, number) {
  const index = surahs.findIndex((s) => s.number === number);
  if (index < 0) return surahs[0].number;
  return surahs[(index - 1 + surahs.length) % surahs.length].number;
}
