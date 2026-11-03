import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  FlatList,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import quran from "./assets/quran.json";
import { nextSurahNumber, surahByNumber } from "./src/reader";

const SERIF = Platform.select({ ios: "Georgia", android: "serif", default: "serif" });
const ARABIC = Platform.select({ ios: "Geeza Pro", android: "serif", default: "serif" });

const DARK = {
  bg: "#0f1210",
  fg: "#f2efe4",
  muted: "#aab0a4",
  accent: "#c9a227",
  accentFill: "#c9a227",
  onAccent: "#0f1210",
  panel: "#181b17",
  line: "rgba(242,239,228,0.14)",
  bar: "rgba(15,18,16,0.94)",
  status: "light-content",
};

const LIGHT = {
  bg: "#f7f4ea",
  fg: "#171b15",
  muted: "#55594e",
  accent: "#8a6d1f",
  accentFill: "#8a6d1f",
  onAccent: "#f7f4ea",
  panel: "#fffdf7",
  line: "rgba(23,27,21,0.14)",
  bar: "rgba(247,244,234,0.94)",
  status: "dark-content",
};

function usePalette() {
  return useColorScheme() === "dark" ? DARK : LIGHT;
}

const TEXT_SCALE_STEPS = [0.85, 1, 1.15, 1.3, 1.45];
const DEFAULT_TEXT_SCALE_INDEX = 1;

function textScaleIndex(scale) {
  const index = TEXT_SCALE_STEPS.indexOf(Number(scale));
  return index >= 0 ? index : DEFAULT_TEXT_SCALE_INDEX;
}

function nextTextScale(scale) {
  const index = textScaleIndex(scale);
  return TEXT_SCALE_STEPS[(index + 1) % TEXT_SCALE_STEPS.length];
}

function useStyles(textScale = 1) {
  const colors = usePalette();
  return useMemo(() => makeStyles(colors, textScale), [colors, textScale]);
}

function useReduceMotion() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setEnabled);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

function pressed(style) {
  return ({ pressed: down }) => [style, down ? { opacity: 0.55 } : null];
}

function useDismissPan(onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 64) closeRef.current();
      },
    }),
  ).current;
  return pan.panHandlers;
}

const TANZIL_URL = "https://tanzil.net";

function parseMap(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function surahText(surahNumber) {
  return quran.text[String(surahNumber)] || [];
}

function searchAyat(query) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits = [];
  for (const surah of quran.surahs) {
    const ayat = surahText(surah.number);
    for (let i = 0; i < ayat.length; i += 1) {
      const ayah = ayat[i];
      if (
        ayah.translation.toLowerCase().includes(needle) ||
        ayah.transliteration.toLowerCase().includes(needle) ||
        surah.nameEnglish.toLowerCase().includes(needle)
      ) {
        hits.push({
          surahNumber: surah.number,
          name: surah.nameEnglish,
          ayah: i + 1,
          text: ayah.translation,
        });
        if (hits.length === 40) return hits;
      }
    }
  }
  return hits;
}

export default function App() {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const readWidth = Math.min(Math.max(width - 48, 0), 560);
  const introWidth = Math.min(Math.max(width - 56, 0), 420);
  const colors = usePalette();
  const [storageReady, setStorageReady] = useState(false);
  const [seen, setSeen] = useState(false);
  const [likes, setLikes] = useState({});
  const [notes, setNotes] = useState({});
  const [textScale, setTextScale] = useState(TEXT_SCALE_STEPS[DEFAULT_TEXT_SCALE_INDEX]);
  const styles = useStyles(textScale);
  const [current, setCurrent] = useState(null); // { surahNumber, ayah }
  const [active, setActive] = useState(null);
  const [studyOpen, setStudyOpen] = useState(false);
  const [surahsOpen, setSurahsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [seenRaw, likesRaw, notesRaw, posRaw, textScaleRaw] = await Promise.all([
        AsyncStorage.getItem("ayah:seen"),
        AsyncStorage.getItem("ayah:likes"),
        AsyncStorage.getItem("ayah:notes"),
        AsyncStorage.getItem("ayah:pos"),
        AsyncStorage.getItem("ayah:textScale"),
      ]);
      if (cancelled) return;
      const saved = parseMap(posRaw);
      let surahNumber = Number(saved.surah) || 1;
      let ayah = Number(saved.ayah) || 1;
      const meta = surahByNumber(quran.surahs, surahNumber);
      if (!meta || ayah < 1 || ayah > meta.ayahCount) {
        surahNumber = 1;
        ayah = 1;
      }
      setSeen(seenRaw === "1");
      setLikes(parseMap(likesRaw));
      setNotes(parseMap(notesRaw));
      setTextScale(TEXT_SCALE_STEPS[textScaleIndex(Number(textScaleRaw))]);
      setCurrent({ surahNumber, ayah });
      setStorageReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const surah = current ? surahByNumber(quran.surahs, current.surahNumber) : null;
  const ayat = current ? surahText(current.surahNumber) : [];
  const following = surah ? nextSurahNumber(quran.surahs, surah.number) : null;
  const followingSurah = following ? surahByNumber(quran.surahs, following) : null;
  const isFirstOpen = current ? current.surahNumber === 1 && current.ayah === 1 : true;

  const rows = useMemo(() => {
    if (!current) return [];
    const items = ayat.map((entry, index) => ({
      kind: "verse",
      key: `${current.surahNumber}.${index + 1}`,
      ayah: index + 1,
      arabic: entry.arabic,
      transliteration: entry.transliteration,
      translation: entry.translation,
    }));
    items.push({ kind: "end", key: `${current.surahNumber}.end` });
    return items;
  }, [current, ayat]);

  useEffect(() => {
    if (!current || ayat.length === 0) return;
    const ayah = Math.min(current.ayah, ayat.length);
    const entry = ayat[ayah - 1];
    setActive({
      kind: "verse",
      key: `${current.surahNumber}.${ayah}`,
      ayah,
      arabic: entry.arabic,
      transliteration: entry.transliteration,
      translation: entry.translation,
    });
  }, [current, ayat]);

  useEffect(() => {
    if (!current || !active || active.kind !== "verse") return;
    AsyncStorage.setItem(
      "ayah:pos",
      JSON.stringify({ surah: current.surahNumber, ayah: active.ayah }),
    );
  }, [active, current]);

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const visible = viewableItems.find((item) => item.isViewable);
    if (visible) setActive(visible.item);
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

  const openSurah = useCallback((surahNumber, ayah = 1) => {
    setCurrent({ surahNumber, ayah });
    setSurahsOpen(false);
    setStudyOpen(false);
  }, []);

  const toggleKeep = useCallback(() => {
    if (!active || active.kind !== "verse" || !current) return;
    const key = `${current.surahNumber}.${active.ayah}`;
    setLikes((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      AsyncStorage.setItem("ayah:likes", JSON.stringify(next));
      return next;
    });
  }, [active, current]);

  const cycleTextScale = useCallback(() => {
    setTextScale((prev) => {
      const next = nextTextScale(prev);
      AsyncStorage.setItem("ayah:textScale", String(next));
      return next;
    });
  }, []);

  const shareAyah = useCallback(async () => {
    if (!active || active.kind !== "verse" || !surah) return;
    const message = `${surah.nameEnglish} ${surah.number}:${active.ayah}\n${active.translation}\n\n${active.arabic}`;
    await Share.share({ message });
  }, [active, surah]);

  if (!storageReady || !current || !surah || height < 100) {
    return (
      <View style={styles.fill}>
        <StatusBar barStyle={colors.status} />
      </View>
    );
  }

  if (!seen) {
    return (
      <View style={[styles.fill, styles.onboarding, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <StatusBar barStyle={colors.status} />
        <View style={{ width: introWidth }}>
          <Text style={styles.mark}>۝</Text>
          <Text style={styles.title}>Ayah</Text>
          <Text style={styles.subtitle}>One verse at a time.</Text>
          <Pressable
            style={pressed(styles.primary)}
            onPress={() => {
              setSeen(true);
              AsyncStorage.setItem("ayah:seen", "1");
            }}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{isFirstOpen ? "Begin Reading" : "Continue Reading"}</Text>
          </Pressable>
          <Pressable style={pressed(styles.ghost)} onPress={() => setPrivacyOpen(true)} accessibilityRole="button">
            <Text style={styles.privacyText}>Privacy</Text>
          </Pressable>
        </View>
        <PrivacySheet visible={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      </View>
    );
  }

  const pageHeight = height;
  const kept = !!(active && active.kind === "verse" && likes[`${current.surahNumber}.${active.ayah}`]);
  const pagePad = { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 108 };

  return (
    <View style={styles.fill}>
      <StatusBar barStyle={colors.status} />
      <FlatList
        key={`${current.surahNumber}`}
        data={rows}
        keyExtractor={(item) => item.key}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        initialScrollIndex={Math.max(0, Math.min(current.ayah, ayat.length) - 1)}
        getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item }) => (
          <VersePage height={pageHeight} paddingTop={pagePad.paddingTop} paddingBottom={pagePad.paddingBottom} contentWidth={readWidth}>
            {item.kind === "verse" ? (
              <Pressable
                style={pressed(styles.verseHit)}
                onPress={() => setStudyOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Study ${surah.nameEnglish} ${surah.number}:${item.ayah}`}
              >
                <Text style={styles.verseNum}>{item.ayah}</Text>
                <Text style={styles.verseArabic}>{item.arabic}</Text>
                <Text style={styles.verseText}>{item.translation}</Text>
              </Pressable>
            ) : (
              <View style={styles.endWrap}>
                <Text style={styles.endTitle}>End of {surah.nameEnglish}.</Text>
                <Text style={styles.endBody}>Next is {followingSurah.nameEnglish} ({followingSurah.meaning}).</Text>
                <Pressable style={pressed(styles.primary)} onPress={() => openSurah(following, 1)} accessibilityRole="button">
                  <Text style={styles.primaryText}>Read {followingSurah.nameEnglish}</Text>
                </Pressable>
                <Pressable style={pressed(styles.ghost)} onPress={() => openSurah(1, 1)} accessibilityRole="button">
                  <Text style={styles.ghostText}>Back to Al-Faatiha</Text>
                </Pressable>
              </View>
            )}
          </VersePage>
        )}
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable style={pressed(styles.headerButton)} onPress={() => openSurah(1, 1)} accessibilityRole="button">
          <Text style={styles.headerSide}>Surah {surah.number}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{surah.nameEnglish}</Text>
        <Pressable
          style={pressed([styles.headerButton, styles.headerButtonRight])}
          onPress={() => setSurahsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Surahs and search"
        >
          <Text style={[styles.headerSide, styles.headerRight]}>Surahs</Text>
        </Pressable>
      </View>

      {active && active.kind === "verse" ? (
        <View style={[styles.actions, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.progress}>{active.ayah} of {ayat.length}</Text>
          <View style={styles.actionRow}>
            <Pressable style={pressed(styles.action)} onPress={toggleKeep} accessibilityRole="button" accessibilityState={{ selected: kept }}>
              <Text style={[styles.actionText, kept && styles.actionOn]}>{kept ? "Kept" : "Keep"}</Text>
            </Pressable>
            <Pressable
              style={pressed(styles.action)}
              onPress={cycleTextScale}
              accessibilityRole="button"
              accessibilityLabel={`Text size, ${Math.round(textScale * 100)} percent, tap to change`}
            >
              <Text style={styles.actionText}>Aa {Math.round(textScale * 100)}%</Text>
            </Pressable>
            <Pressable style={pressed(styles.action)} onPress={() => setStudyOpen(true)} accessibilityRole="button">
              <Text style={styles.actionText}>Study</Text>
            </Pressable>
            <Pressable style={pressed(styles.action)} onPress={shareAyah} accessibilityRole="button">
              <Text style={styles.actionText}>Share</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <StudySheet
        visible={studyOpen}
        surah={surah}
        textScale={textScale}
        item={active && active.kind === "verse" ? active : null}
        note={active ? notes[`${current.surahNumber}.${active.ayah}`] || "" : ""}
        onChangeNote={(value) => {
          if (!active || active.kind !== "verse") return;
          const key = `${current.surahNumber}.${active.ayah}`;
          setNotes((prev) => {
            const next = { ...prev };
            if (value) next[key] = value;
            else delete next[key];
            AsyncStorage.setItem("ayah:notes", JSON.stringify(next));
            return next;
          });
        }}
        onClose={() => setStudyOpen(false)}
      />
      <SurahsSheet
        visible={surahsOpen}
        likes={likes}
        onClose={() => setSurahsOpen(false)}
        onOpen={openSurah}
        onPrivacy={() => {
          setSurahsOpen(false);
          setPrivacyOpen(true);
        }}
      />
      <PrivacySheet visible={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </View>
  );
}

function VersePage({ height, paddingTop, paddingBottom, contentWidth, children }) {
  const styles = useStyles();
  const [frame, setFrame] = useState(0);
  const [content, setContent] = useState(0);
  const overflow = frame > 0 && content > frame;
  return (
    <View style={[styles.page, { height, paddingTop, paddingBottom }]}>
      <ScrollView
        style={[styles.pageScroll, { width: contentWidth }]}
        contentContainerStyle={overflow ? null : styles.pageCenter}
        scrollEnabled={overflow}
        nestedScrollEnabled
        onLayout={(event) => setFrame(event.nativeEvent.layout.height)}
        showsVerticalScrollIndicator={overflow}
      >
        <View onLayout={(event) => setContent(event.nativeEvent.layout.height)}>{children}</View>
      </ScrollView>
    </View>
  );
}

function Sheet({ visible, title, onClose, children }) {
  const styles = useStyles();
  const motion = useReduceMotion();
  const dismiss = useDismissPan(onClose);
  return (
    <Modal visible={visible} animationType={motion ? "none" : "slide"} transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View {...dismiss}>
            <View style={styles.grabberWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.grabber} />
            </View>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetKicker}>{title}</Text>
              <Pressable style={pressed(styles.hit)} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.close}>Close</Text>
              </Pressable>
            </View>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function PrivacySheet({ visible, onClose }) {
  const styles = useStyles();
  return (
    <Sheet visible={visible} title="Privacy" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.sheetBody}>
        <Text style={styles.blurb}>
          Kept ayat and notes stay on this phone. Ayah has no account and does not upload them. Share uses the system share sheet, which you control. The Arabic text and transliteration are from the Tanzil Project (CC BY 3.0). The English translation is M. M. Pickthall's 1930 translation, public domain, quoted unchanged.
        </Text>
      </ScrollView>
    </Sheet>
  );
}

function StudySheet({ visible, surah, item, note, onChangeNote, onClose, textScale }) {
  const styles = useStyles(textScale);
  const colors = usePalette();
  if (!item || !surah) {
    return null;
  }
  return (
    <Sheet visible={visible} title={`${surah.nameEnglish} ${surah.number}:${item.ayah}`} onClose={onClose}>
      <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
        <Text style={styles.blurb}>
          {surah.nameArabic} · {surah.meaning} · {surah.revelationType} · {surah.ayahCount} ayat
        </Text>
        <Text style={styles.sheetContext}>{surah.context}</Text>
        <Text style={styles.sheetArabic}>{item.arabic}</Text>
        <Text style={styles.translitLabel}>Transliteration</Text>
        <Text style={styles.translitText}>{item.transliteration}</Text>
        <Text style={styles.translitLabel}>Translation</Text>
        <Text style={styles.sheetVerse}>{item.translation}</Text>
        <Text style={styles.noteLabel}>Private note</Text>
        <TextInput
          value={note}
          onChangeText={onChangeNote}
          placeholder="Only on this phone"
          placeholderTextColor={colors.muted}
          multiline
          style={styles.note}
          accessibilityLabel="Private note"
        />
        <Text style={styles.sheetCredit}>Arabic and transliteration: Tanzil Project (CC BY 3.0). Translation: M. M. Pickthall, 1930, public domain.</Text>
      </ScrollView>
    </Sheet>
  );
}

function SurahsSheet({ visible, likes, onClose, onOpen, onPrivacy }) {
  const styles = useStyles();
  const colors = usePalette();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const hits = useMemo(() => searchAyat(query), [query]);
  const kept = Object.keys(likes);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setPicked(null);
    }
  }, [visible]);

  return (
    <Sheet visible={visible} title={picked ? picked.nameEnglish : "Surahs"} onClose={onClose}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search the translation"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.search}
          accessibilityLabel="Search the translation"
        />
        {query.length > 0 ? (
          <Pressable style={pressed(styles.hit)} onPress={() => setQuery("")} accessibilityRole="button" accessibilityLabel="Clear search">
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
        {query.trim().length >= 2 ? (
          hits.length ? hits.map((hit) => (
            <Pressable key={`${hit.surahNumber}.${hit.ayah}`} style={pressed(styles.row)} onPress={() => onOpen(hit.surahNumber, hit.ayah)} accessibilityRole="button">
              <Text style={styles.rowTitle}>{hit.name} {hit.surahNumber}:{hit.ayah}</Text>
              <Text style={styles.rowBody} numberOfLines={2}>{hit.text}</Text>
            </Pressable>
          )) : <Text style={styles.empty}>No ayah has that wording.</Text>
        ) : picked ? (
          <View>
            <Pressable style={pressed(styles.hit)} onPress={() => setPicked(null)} accessibilityRole="button">
              <Text style={styles.backLink}>All Surahs</Text>
            </Pressable>
            <Text style={styles.rowBody}>{picked.nameArabic} · {picked.meaning} · {picked.revelationType}</Text>
            <Text style={[styles.rowBody, { marginTop: 8 }]}>{picked.context}</Text>
            <Pressable style={pressed(styles.primary)} onPress={() => onOpen(picked.number, 1)} accessibilityRole="button">
              <Text style={styles.primaryText}>Read {picked.nameEnglish}</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            {kept.length ? (
              <View>
                <Text style={styles.group}>Kept</Text>
                {kept.map((key) => {
                  const [surahNumber, ayah] = key.split(".").map(Number);
                  const meta = surahByNumber(quran.surahs, surahNumber);
                  const entry = surahText(surahNumber)[ayah - 1];
                  if (!meta || !entry) return null;
                  return (
                    <Pressable key={key} style={pressed(styles.row)} onPress={() => onOpen(surahNumber, ayah)} accessibilityRole="button">
                      <Text style={styles.rowTitle}>{meta.nameEnglish} {surahNumber}:{ayah}</Text>
                      <Text style={styles.rowBody} numberOfLines={2}>{entry.translation}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <Text style={styles.group}>All Surahs</Text>
            {quran.surahs.map((item) => (
              <Pressable key={item.number} style={pressed(styles.row)} onPress={() => setPicked(item)} accessibilityRole="button">
                <Text style={styles.rowTitle}>{item.number}. {item.nameEnglish}</Text>
                <Text style={styles.rowBody}>{item.meaning} · {item.ayahCount} ayat</Text>
              </Pressable>
            ))}
            <Pressable style={pressed(styles.row)} onPress={() => Linking.openURL(TANZIL_URL)} accessibilityRole="link">
              <Text style={styles.rowTitle}>Source and License</Text>
              <Text style={styles.rowBody}>Arabic/transliteration: Tanzil Project (CC BY 3.0). Translation: Pickthall 1930, public domain.</Text>
            </Pressable>
            <Pressable style={pressed(styles.row)} onPress={onPrivacy} accessibilityRole="button">
              <Text style={styles.rowTitle}>Privacy</Text>
              <Text style={styles.rowBody}>Notes and kept ayat stay on this phone.</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

function makeStyles(colors, textScale = 1) {
  return StyleSheet.create({
    fill: { flex: 1, backgroundColor: colors.bg },
    onboarding: { alignItems: "center", justifyContent: "center" },
    mark: { color: colors.accent, fontFamily: ARABIC, fontSize: 56, marginBottom: 8 },
    title: { color: colors.fg, fontFamily: SERIF, fontSize: 48 },
    subtitle: { color: colors.accent, fontSize: 18, marginTop: 6 },
    primary: { alignSelf: "flex-start", marginTop: 28, minHeight: 44, backgroundColor: colors.accentFill, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 22, alignItems: "center", justifyContent: "center" },
    primaryText: { color: colors.onAccent, fontSize: 17, fontWeight: "600" },
    ghost: { alignSelf: "flex-start", marginTop: 8, minHeight: 44, paddingHorizontal: 2, justifyContent: "center" },
    ghostText: { color: colors.fg, fontSize: 17 },
    privacyText: { color: colors.accent, fontSize: 17 },
    page: { alignItems: "center" },
    pageScroll: { flex: 1 },
    pageCenter: { flexGrow: 1, justifyContent: "center" },
    verseHit: { gap: 14 },
    verseNum: { color: colors.accent, fontVariant: ["tabular-nums"], fontSize: 15 },
    verseArabic: { color: colors.fg, fontFamily: ARABIC, fontSize: 26 * textScale, lineHeight: 42 * textScale, textAlign: "right", writingDirection: "rtl" },
    verseText: { color: colors.muted, fontFamily: SERIF, fontSize: 22 * textScale, lineHeight: 30 * textScale },
    endWrap: { gap: 8 },
    endTitle: { color: colors.fg, fontFamily: SERIF, fontSize: 32, lineHeight: 40 },
    endBody: { color: colors.muted, fontSize: 17, lineHeight: 24 },
    header: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      paddingHorizontal: 12,
      paddingBottom: 4,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.bar,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    headerButton: { minWidth: 72, minHeight: 44, justifyContent: "center" },
    headerButtonRight: { alignItems: "flex-end" },
    headerTitle: { color: colors.fg, fontSize: 17, fontWeight: "600", flex: 1, textAlign: "center" },
    headerSide: { color: colors.accent, fontSize: 17 },
    headerRight: { textAlign: "right" },
    actions: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      paddingTop: 8,
      paddingHorizontal: 12,
      backgroundColor: colors.bar,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    progress: { color: colors.muted, textAlign: "center", fontSize: 12, fontVariant: ["tabular-nums"] },
    actionRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 4 },
    action: { minHeight: 44, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
    actionText: { color: colors.fg, fontSize: 17 },
    actionOn: { color: colors.accent },
    modalRoot: { flex: 1, justifyContent: "flex-end" },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
    sheet: { width: "100%", maxWidth: 560, alignSelf: "center", maxHeight: "88%", backgroundColor: colors.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 24 },
    grabberWrap: { alignItems: "center", paddingTop: 8, paddingBottom: 2 },
    grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: colors.muted, opacity: 0.45 },
    sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, minHeight: 44 },
    sheetKicker: { color: colors.fg, fontSize: 17, fontWeight: "600", flex: 1, paddingRight: 12 },
    hit: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
    close: { color: colors.accent, fontSize: 17 },
    sheetBody: { paddingHorizontal: 20, paddingBottom: 32 },
    blurb: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 12 },
    sheetContext: { color: colors.fg, fontSize: 16, lineHeight: 23, marginTop: 10 },
    sheetArabic: { color: colors.fg, fontFamily: ARABIC, fontSize: 24 * textScale, lineHeight: 38 * textScale, marginTop: 20, textAlign: "right", writingDirection: "rtl" },
    translitLabel: { color: colors.accent, fontSize: 12, marginTop: 16, marginBottom: 4 },
    translitText: { color: colors.fg, fontSize: 16 * textScale, lineHeight: 22 * textScale, fontStyle: "italic" },
    sheetVerse: { color: colors.fg, fontFamily: SERIF, fontSize: 20 * textScale, lineHeight: 28 * textScale },
    noteLabel: { color: colors.muted, fontSize: 12, marginTop: 22, marginBottom: 6 },
    note: { minHeight: 88, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: 10, padding: 12, color: colors.fg, fontSize: 17, textAlignVertical: "top" },
    sheetCredit: { color: colors.muted, fontSize: 12, marginTop: 16 },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: 20,
      marginTop: 12,
      marginBottom: 8,
      minHeight: 44,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      borderRadius: 10,
    },
    search: { flex: 1, minHeight: 44, paddingHorizontal: 12, color: colors.fg, fontSize: 17 },
    clear: { color: colors.accent, fontSize: 17, paddingRight: 12 },
    row: { minHeight: 44, paddingVertical: 12, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
    rowTitle: { color: colors.fg, fontSize: 17 },
    rowBody: { color: colors.muted, fontSize: 15, lineHeight: 20, marginTop: 3 },
    group: { color: colors.accent, fontSize: 12, marginTop: 18, marginBottom: 4 },
    empty: { color: colors.muted, fontSize: 17, marginTop: 12 },
    backLink: { color: colors.accent, fontSize: 17, marginBottom: 12 },
  });
}
