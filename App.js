import { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Animated, ActivityIndicator, StatusBar,
  Platform, Dimensions, Alert, Linking,
} from "react-native";
import * as Speech from "expo-speech";
import { useAudioRecorder, useAudioRecorderState, useAudioPlayer, useAudioPlayerStatus, RecordingPresets } from "expo-audio";
import { PermissionsAndroid } from "react-native";
import { SafeAreaView, SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { UNITS, TIPS } from "./assets/data/units";
import { TROPES, TROPE_TIER_NAMES, TROPE_SYSTEMS, TROPE_MNEMONIC, TROPE_VERSES } from "./assets/data/tropes";
import { PRAYERS, HEBREW_VOCAB } from "./assets/data/prayers";
import { UNIT_EXERCISES, TROPE_ID_QUIZ } from "./assets/data/exercises";
import { transcribeFile, ensureWhisperLoaded, whisperStatus } from "./assets/lib/whisper";
import {
  loadProfiles, saveProfiles, loadActiveId, saveActiveId,
  createProfile as createProfileStore, updateProfile, deleteProfile as deleteProfileStore,
  updateProfileStats, setProfileAchievements, bumpStreak,
} from "./assets/lib/profiles";
import { ProfileSelectScreen, ProfileCreateScreen, ProfileSwitcherModal } from "./assets/lib/profiles_ui";
import * as FileSystem from "expo-file-system/legacy";
import { NativeModules } from "react-native";

const { width: SCREEN_W } = Dimensions.get("window");

/* ── Hebrew pronunciation scorer ─────────────────────────────────────────
 * Whisper transcribes Hebrew audio into plain text with niqqud (vowel marks)
 * stripped and an apostrophe between prefix and root words (e.g. "בְּרֵאשִׁית" → "בְּרֵאשִׁית").
 * Expected transliteration is romanized ("B'reishit"). So we:
 *   1. Strip diacritics / punctuation from both sides.
 *   2. Compute word-level recall: how many expected words have a near-match
 *      (Levenshtein ≤ 2) in the transcript.
 *   3. Compute edit-distance on the lowercased strings as a 0-100 score.
 */
function normalizeHebrew(s) {
  return (s || "")
    .replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, "")  // strip Hebrew niqqud
    .replace(/[׳'`״„«»"']/g, "'")                  // normalize Hebrew/English quotes
    .replace(/[^\u05D0-\u05EA\u05BE\u05F3\u05F4' a-zA-Z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeTranslit(s) {
  return (s || "")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function scorePronunciation(expectedTranslit, transcript) {
  const expWords = normalizeTranslit(expectedTranslit).split(" ").filter(Boolean);
  const gotWords = normalizeHebrew(transcript).split(" ").filter(Boolean);
  if (expWords.length === 0) return { score: 0, matches: 0, total: 0, transcript };
  // word recall
  let matches = 0;
  const used = new Set();
  for (const ew of expWords) {
    let bestIdx = -1, bestDist = 999;
    for (let i = 0; i < gotWords.length; i++) {
      if (used.has(i)) continue;
      const d = levenshtein(ew, gotWords[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestDist <= 2) { matches++; used.add(bestIdx); }
  }
  const recall = matches / expWords.length;
  // overall edit distance on the joined strings
  const joinedExp = expWords.join(" ");
  const joinedGot = gotWords.join(" ");
  const ed = levenshtein(joinedExp, joinedGot);
  const edScore = Math.max(0, 1 - ed / Math.max(joinedExp.length, 1));
  const score = Math.round(100 * (0.6 * recall + 0.4 * edScore));
  return { score, matches, total: expWords.length, transcript };
}

const HEARTS_MAX = 3;
const XP_PER_CORRECT = 10;

/* ─── Locale helper ─────────────────────────────────────────────────────── */
const SPEECH_LOCALE = { he: "he-IL" };

/* ─── Achievements (modeled after SilkRoadDuo) ───────────────────────────── */
const ACHIEVEMENTS = [
  { id: "first_lesson", name: "First Steps", emoji: "👣", desc: "Complete your first lesson", check: (s) => s.lessons >= 1 },
  { id: "streak_3",     name: "On Fire",     emoji: "🔥", desc: "Reach a 3-lesson streak", check: (s) => s.streak >= 3 },
  { id: "streak_7",     name: "Week Warrior",emoji: "⚔️", desc: "Reach a 7-lesson streak", check: (s) => s.streak >= 7 },
  { id: "xp_100",       name: "XP Collector",emoji: "⚡", desc: "Earn 100 total XP",       check: (s) => s.totalXP >= 100 },
  { id: "xp_500",       name: "XP Master",   emoji: "💎", desc: "Earn 500 total XP",       check: (s) => s.totalXP >= 500 },
  { id: "trope_10",     name: "Trope Reader",emoji: "🎵", desc: "Identify 10 trope marks", check: (s) => (s.trope_correct || 0) >= 10 },
  { id: "trope_25",     name: "Chazzan",     emoji: "🕍", desc: "Identify 25 trope marks", check: (s) => (s.trope_correct || 0) >= 25 },
  { id: "recite_5",     name: "Voice",       emoji: "🎤", desc: "Complete 5 record + judge exercises", check: (s) => (s.recordings || 0) >= 5 },
  { id: "all_units",    name: "Scholar",     emoji: "🎓", desc: "Complete all units",      check: (s) => (s.units_completed || 0) >= UNITS.length },
  { id: "perfect_5",    name: "Perfectionist",emoji: "🏅",desc: "5 perfect lessons",       check: (s) => (s.perfectLessons || 0) >= 5 },
];

/* ─── Animated Heart ────────────────────────────────────────────────────── */
function Heart({ filled }) {
  return <Text style={{ fontSize: 22, opacity: filled ? 1 : 0.25 }}>❤️</Text>;
}

/* ─── Progress Bar ──────────────────────────────────────────────────────── */
function ProgressBar({ current, total, color }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: Math.max(0.04, current / total), duration: 400, useNativeDriver: false }).start();
  }, [current]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  return (
    <View style={{ flex: 1, height: 14, backgroundColor: "#E5E5E5", borderRadius: 7, overflow: "hidden" }}>
      <Animated.View style={{ height: "100%", width, backgroundColor: color, borderRadius: 7 }} />
    </View>
  );
}

/* ─── Speak button (Hebrew TTS) ──────────────────────────────────────────── */
function SpeakButton({ text, color, size = 22 }) {
  const [speaking, setSpeaking] = useState(false);
  const [missing, setMissing] = useState(false); // true if Hebrew voice not installed
  const handle = async () => {
    try {
      Speech.stop();
      // Check voices first; if no Hebrew voice installed, show the "missing voice" state briefly
      const voices = await Speech.getAvailableVoicesAsync().catch(() => []);
      const heLocale = voices.find(v => v.language?.toLowerCase().startsWith("he"));
      if (!heLocale) {
        setMissing(true);
        setTimeout(() => setMissing(false), 1800);
        return;
      }
      setSpeaking(true);
      Speech.speak(text, { language: SPEECH_LOCALE.he, onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false) });
    } catch {
      setSpeaking(false);
    }
  };
  // 🔈 ready · 🔊 playing · ⚠ voice-missing
  const label = missing ? "⚠" : speaking ? "🔊" : "🔈";
  const tint  = missing ? "#B45309" : color;
  return (
    <TouchableOpacity onPress={handle} style={[styles.speakBtn, { backgroundColor: tint + "22" }]} activeOpacity={0.7}>
      <Text style={[styles.speakBtnText, { color: tint, opacity: speaking ? 1 : 0.9, fontSize: missing ? 18 : 22 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXERCISE COMPONENTS — modeled on SilkRoadDuo, adapted for Siddur/Trope
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── MCQ ───────────────────────────────────────────────────────────────── */
function ExerciseMCQ({ ex, onAnswer, color, factColor }) {
  const [selected, setSelected] = useState(null);
  const handle = (opt) => {
    if (selected) return;
    setSelected(opt);
    setTimeout(() => onAnswer(opt === ex.correct, opt), 350);
  };
  const optStyle = (opt) => {
    if (!selected) return [styles.optionBtn, { borderColor: "#E5E5E5" }];
    if (opt === ex.correct) return [styles.optionBtn, styles.optionCorrect];
    if (opt === selected) return [styles.optionBtn, styles.optionWrong];
    return [styles.optionBtn, { borderColor: "#E5E5E5", opacity: 0.4 }];
  };
  const optTextStyle = (opt) => {
    if (!selected) return styles.optionText;
    if (opt === ex.correct) return [styles.optionText, { color: "#2A7C00" }];
    if (opt === selected) return [styles.optionText, { color: "#8B0000" }];
    return [styles.optionText, { color: "#AFAFAF" }];
  };
  return (
    <View style={styles.exerciseContainer}>
      <View style={[styles.promptCard, { backgroundColor: color + "15", borderColor: color + "44" }]}>
        <Text style={styles.promptQuestion}>{ex.question}</Text>
      </View>
      <View style={{ gap: 10 }}>
        {ex.options.map((opt, i) => (
          <TouchableOpacity key={i} style={optStyle(opt)} onPress={() => handle(opt)} activeOpacity={0.7}>
            <Text style={optTextStyle(opt)}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/* ─── Fill in the Blank ─────────────────────────────────────────────────── */
function ExerciseFillBlank({ ex, onAnswer, color }) {
  const [selected, setSelected] = useState(null);
  const rawParts = ex.template.split("___");
  const parts = rawParts.length >= 2 ? rawParts : [ex.template, ""];
  const handle = (opt) => {
    if (selected) return;
    setSelected(opt);
    setTimeout(() => onAnswer(opt === ex.correct_target, opt), 350);
  };
  const optStyle = (opt) => {
    if (!selected) return [styles.optionBtn, { borderColor: "#E5E5E5" }];
    if (opt === ex.correct_target) return [styles.optionBtn, styles.optionCorrect];
    if (opt === selected) return [styles.optionBtn, styles.optionWrong];
    return [styles.optionBtn, { borderColor: "#E5E5E5", opacity: 0.4 }];
  };
  const optTextStyle = (opt) => {
    if (!selected) return styles.optionText;
    if (opt === ex.correct_target) return [styles.optionText, { color: "#2A7C00" }];
    if (opt === selected) return [styles.optionText, { color: "#8B0000" }];
    return [styles.optionText, { color: "#AFAFAF" }];
  };
  return (
    <View style={styles.exerciseContainer}>
      <View style={[styles.promptCard, { backgroundColor: color + "15", borderColor: color + "44" }]}>
        <Text style={styles.fillText}>
          {parts[0]}
          <Text style={[styles.fillBlank, { color: selected ? color : "#AFAFAF", borderBottomColor: selected ? color : "#AFAFAF" }]}>
            {selected ? ` ${selected} ` : "  ___  "}
          </Text>
          {parts[1]}
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {ex.options.map((opt, i) => (
          <TouchableOpacity key={i} style={[optStyle(opt), { flex: 1, minWidth: "45%" }]} onPress={() => handle(opt)} activeOpacity={0.7}>
            <Text style={optTextStyle(opt)}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/* ─── Match ─────────────────────────────────────────────────────────────── */
function ExerciseMatch({ ex, onComplete, color }) {
  const [selLeft, setSelLeft] = useState(null);
  const [selRight, setSelRight] = useState(null);
  const [matched, setMatched] = useState([]);
  const [wrong, setWrong] = useState(null);
  const [shuffled] = useState(() => ({
    left: [...ex.pairs].sort(() => Math.random() - 0.5),
    right: [...ex.pairs].sort(() => Math.random() - 0.5),
  }));
  useEffect(() => {
    if (!selLeft || !selRight) return;
    if (selLeft.right === selRight.right) {
      const next = [...matched, selLeft.right];
      setMatched(next);
      setSelLeft(null); setSelRight(null);
      if (next.length === ex.pairs.length) setTimeout(() => onComplete(), 500);
    } else {
      setWrong(`${selLeft.left}|${selRight.right}`);
      setTimeout(() => { setSelLeft(null); setSelRight(null); setWrong(null); }, 600);
    }
  }, [selLeft, selRight]);
  const tileStyle = (active, isMatched, isWrong) => [
    styles.matchTile, active && { borderColor: color, backgroundColor: color + "15" },
    isMatched && styles.matchMatched, isWrong && styles.matchWrong,
  ];
  return (
    <View style={styles.exerciseContainer}>
      <Text style={styles.matchInstruction}>Tap one from each side to match</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, gap: 10 }}>
          {shuffled.left.map((p, i) => {
            const isMatched = matched.includes(p.right);
            const active = selLeft?.left === p.left;
            const isWrong = wrong?.startsWith(p.left);
            return (
              <TouchableOpacity key={i} style={tileStyle(active, isMatched, isWrong)}
                onPress={() => !isMatched && setSelLeft(p)} activeOpacity={0.7}>
                <Text style={[styles.matchText, isMatched && { color: "#AFAFAF", textDecorationLine: "line-through" }, active && { color }]}>
                  {p.left}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ flex: 1, gap: 10 }}>
          {shuffled.right.map((p, i) => {
            const isMatched = matched.includes(p.right);
            const active = selRight?.right === p.right;
            const isWrong = wrong?.endsWith(p.right);
            return (
              <TouchableOpacity key={i} style={tileStyle(active, isMatched, isWrong)}
                onPress={() => !isMatched && setSelRight(p)} activeOpacity={0.7}>
                <Text style={[styles.matchText, isMatched && { color: "#AFAFAF", textDecorationLine: "line-through" }, active && { color }]}>
                  {p.right}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 16 }}>
        {ex.pairs.map((_, i) => (
          <View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i < matched.length ? color : "#E5E5E5" }} />
        ))}
      </View>
    </View>
  );
}

/* ─── Word Arrange ──────────────────────────────────────────────────────── */
function ExerciseWordArrange({ ex, onAnswer, color }) {
  const [placed, setPlaced] = useState([]);
  const [bank, setBank] = useState(() => [...ex.words].sort(() => Math.random() - 0.5));
  const [submitted, setSubmitted] = useState(false);
  const [correct, setCorrect] = useState(null);
  const addWord = (word, idx) => {
    if (submitted) return;
    setPlaced(p => [...p, word]);
    setBank(b => b.filter((_, i) => i !== idx));
  };
  const removeWord = (word, idx) => {
    if (submitted) return;
    setBank(b => [...b, word]);
    setPlaced(p => p.filter((_, i) => i !== idx));
  };
  const submit = () => {
    if (placed.length < ex.correct_order.length) return;
    const isCorrect = placed.join("|") === ex.correct_order.join("|");
    setCorrect(isCorrect);
    setSubmitted(true);
    setTimeout(() => onAnswer(isCorrect, placed.join(" ")), 500);
  };
  return (
    <View style={styles.exerciseContainer}>
      <View style={[styles.promptCard, { backgroundColor: color + "15", borderColor: color + "44" }]}>
        <Text style={styles.arrangeEnglish}>{ex.english}</Text>
        {ex.hint && <Text style={styles.arrangeHint}>💡 {ex.hint}</Text>}
      </View>
      <View style={[styles.arrangeZone, submitted && (correct ? styles.arrangeCorrect : styles.arrangeWrong)]}>
        {placed.length === 0 ? (
          <Text style={styles.arrangePlaceholder}>Tap words to build the sentence</Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {placed.map((w, i) => (
              <TouchableOpacity key={i} onPress={() => removeWord(w, i)}
                style={[styles.wordChip, { backgroundColor: color }]} activeOpacity={0.7}>
                <Text style={styles.wordChipText}>{w}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {bank.map((w, i) => (
          <TouchableOpacity key={i} onPress={() => addWord(w, i)}
            style={styles.wordBankChip} activeOpacity={0.7}>
            <Text style={styles.wordBankChipText}>{w}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!submitted && placed.length >= ex.correct_order.length && (
        <TouchableOpacity style={[styles.submitBtn, { backgroundColor: color, borderBottomColor: color + "AA" }]}
          onPress={submit} activeOpacity={0.85}>
          <Text style={styles.submitBtnText}>CHECK</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ─── Trope Identify (workbook page 19) ─────────────────────────────────── */
function ExerciseTropeIdentify({ ex, onAnswer, color }) {
  const [selected, setSelected] = useState(null);
  const handle = (opt) => {
    if (selected) return;
    setSelected(opt);
    setTimeout(() => onAnswer(opt === ex.answer, opt), 350);
  };
  const optStyle = (opt) => {
    if (!selected) return [styles.optionBtn, { borderColor: "#E5E5E5" }];
    if (opt === ex.answer) return [styles.optionBtn, styles.optionCorrect];
    if (opt === selected) return [styles.optionBtn, styles.optionWrong];
    return [styles.optionBtn, { borderColor: "#E5E5E5", opacity: 0.4 }];
  };
  const optTextStyle = (opt) => {
    if (!selected) return styles.optionText;
    if (opt === ex.answer) return [styles.optionText, { color: "#2A7C00" }];
    if (opt === selected) return [styles.optionText, { color: "#8B0000" }];
    return [styles.optionText, { color: "#AFAFAF" }];
  };
  return (
    <View style={styles.exerciseContainer}>
      <View style={[styles.promptCard, { backgroundColor: color + "15", borderColor: color + "44" }]}>
        <Text style={[styles.promptWord, { fontSize: 30 }]}>{ex.hebrew}</Text>
        <Text style={styles.promptRomanized}>Identify this trope mark</Text>
      </View>
      <View style={{ gap: 10 }}>
        {ex.options.map((opt, i) => (
          <TouchableOpacity key={i} style={optStyle(opt)} onPress={() => handle(opt)} activeOpacity={0.7}>
            <Text style={optTextStyle(opt)}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/* ─── Feedback Bar ──────────────────────────────────────────────────────── */
function FeedbackBar({ correct, funFact, onContinue, color, correctAnswer, isRecording }) {
  const slideAnim = useRef(new Animated.Value(200)).current;
  const insets = useSafeAreaInsets();
  useEffect(() => {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
  }, []);
  return (
    <Animated.View style={[styles.feedbackBar, { backgroundColor: correct ? "#D7FFB8" : "#FFD0D0", borderTopColor: correct ? "#58CC02" : "#FF4B4B", paddingBottom: Math.max(insets.bottom + 12, 24), transform: [{ translateY: slideAnim }] }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <Text style={{ fontSize: 28 }}>{correct ? "🎉" : "💡"}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.feedbackTitle, { color: correct ? "#2A7C00" : "#8B0000" }]}>
            {correct ? "Excellent!" : isRecording ? "Recording saved" : "Correct answer:"}
          </Text>
          {!correct && correctAnswer && (
            <Text style={styles.feedbackAnswer}>{correctAnswer}</Text>
          )}
        </View>
      </View>
      {correct && funFact && (
        <Text style={styles.funFact}>✦ {funFact}</Text>
      )}
      <TouchableOpacity
        style={[styles.continueBtn, { backgroundColor: correct ? "#58CC02" : "#FF4B4B", borderBottomColor: correct ? "#46A302" : "#CC1111" }]}
        onPress={onContinue} activeOpacity={0.85}>
        <Text style={styles.continueBtnText}>CONTINUE</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRAYER / TROPE RECITATION (Record + Judge)
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Record + Judge screen — used for prayer and trope recitation ──────── */
function RecitationScreen({ item, kind, onComplete, onQuit, color }) {
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

  // useAudioPlayer is a hook — must be called unconditionally. Pass null initially.
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);

  const [status, setStatus] = useState("idle"); // idle | recording | recorded | playing | transcribing
  const [audioUri, setAudioUri] = useState(null);
  const [micPermission, setMicPermission] = useState("unknown"); // unknown | granted | denied
  const [whisperReady, setWhisperReady] = useState(null); // null=loading, true, false
  const [transcriptPreview, setTranscriptPreview] = useState("");

  // Explicitly request mic permission when entering the screen.
  // expo-audio's recorder checks permission internally, but on Android 13+ the OS
  // doesn't grant RECORD_AUDIO until the user taps Allow — we make that request
  // explicit so the dialog shows up the moment they open a recitation screen.
  const requestMic = useCallback(async () => {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: "Microphone access",
          message: "Record yourself reciting prayers and trope so you can review your pronunciation.",
          buttonPositive: "Allow",
          buttonNegative: "Cancel",
        }
      );
      const ok = granted === PermissionsAndroid.RESULTS.GRANTED;
      setMicPermission(ok ? "granted" : "denied");
      return ok;
    } catch {
      setMicPermission("denied");
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Check current permission state without prompting first
    (async () => {
      try {
        const has = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (cancelled) return;
        if (has) {
          setMicPermission("granted");
        } else {
          // Don't auto-prompt; show a "Grant access" CTA so the user controls when the dialog appears.
          setMicPermission("not-asked");
        }
      } catch {
        if (!cancelled) setMicPermission("not-asked");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Drive a local "duration" view from the recorder state's poll
  const duration = recorderState.durationMillis || 0;
  const isRecording = recorderState.isRecording;

  // Lazy-load the Whisper model after the first recording is captured.
  // Model load takes ~2-3s on first run; doing it only when actually needed
  // keeps the screen snappy.
  useEffect(() => {
    if (status === "recorded" && whisperReady === null) {
      (async () => {
        try {
          await ensureWhisperLoaded();
          setWhisperReady(true);
        } catch (e) {
          console.warn("[Whisper] load failed", e);
          setWhisperReady(false);
        }
      })();
    }
  }, [status, whisperReady]);

  // When recorder transitions to !isRecording and we have a uri, mark "recorded"
  useEffect(() => {
    if (status === "recording" && !recorderState.isRecording && recorderState.url) {
      setAudioUri(recorderState.url);
      setStatus("recorded");
    }
  }, [recorderState.isRecording, recorderState.url, status]);

  // Detect playback end
  useEffect(() => {
    if (status === "playing" && playerStatus.didJustFinish) {
      setStatus("recorded");
    }
  }, [playerStatus.didJustFinish, status]);

  const startRecording = async () => {
    // Belt-and-braces: re-check permission right before recording. The recorder
    // throws "Required permission RECORD_AUDIO" if it's been revoked.
    if (micPermission !== "granted") {
      const ok = await requestMic();
      if (!ok) return;
    }
    try {
      setAudioUri(null);
      setStatus("recording");
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      Alert.alert("Recording error", e.message || String(e));
      setStatus("idle");
    }
  };

  const stopRecording = async () => {
    try {
      await recorder.stop();
      // The status effect above will transition us to "recorded" once uri arrives.
    } catch (e) {
      Alert.alert("Stop error", e.message || String(e));
    }
  };

  const playRecording = async () => {
    if (!audioUri) return;
    try {
      // Replace the player source. With useAudioPlayer, we replace via player.replace().
      try { player.replace(audioUri); } catch { /* first time may need a fresh player */ }
      setStatus("playing");
      player.seekTo(0);
      player.play();
    } catch (e) {
      Alert.alert("Playback error", e.message || String(e));
    }
  };

  const reset = () => {
    setAudioUri(null);
    setStatus("idle");
  };

  const submit = async () => {
    // Real pronunciation pipeline: AAC → WAV → Whisper ASR → word-level diff.
    // Whisper is slow on first run (model warm-up + inference) — show a status.
    setStatus("transcribing");
    setTranscriptPreview("");
    try {
      if (!audioUri) throw new Error("no recording");
      if (!NativeModules.WavModule) throw new Error("WavModule native module not registered");
      // 1) Convert AAC → 16kHz mono WAV using our Kotlin module.
      // expo-file-system v56 returns paths with a "file:" prefix (not "file://").
      // The Kotlin module expects a plain filesystem path, so strip it.
      const rawWavPath = `${FileSystem.cacheDirectory}whisper_${Date.now()}.wav`;
      const wavPath = rawWavPath.replace(/^file:\/?\/?/, "");
      await NativeModules.WavModule.convertToWav(audioUri.replace(/^file:\/\//, ""), wavPath);
      // 2) Transcribe the WAV with Whisper (language: Hebrew, multilingual model).
      const transcript = await transcribeFile(wavPath, { language: "he" });
      setTranscriptPreview(transcript);
      // 3) Score against expected transliteration.
      const { score, matches, total } = scorePronunciation(item.transliteration, transcript);
      const passed = score >= 50; // 50%+ recall + edit similarity → passing
      onComplete({ passed, duration, score, matches, total, transcript });
    } catch (e) {
      console.warn("[Submit] pipeline failed, falling back to duration heuristic", e);
      // Graceful fallback: if the ASR pipeline fails for any reason, fall back to
      // the old duration-based heuristic so the user still gets a result.
      const minMs = 1500;
      const target = item.transliteration.split(/\s+/).length * 350;
      const pct = Math.min(100, Math.round((duration / target) * 100));
      const passed = duration >= minMs;
      onComplete({ passed, duration, score: pct, matches: 0, total: 0, transcript: "" });
    }
  };

  const reference = kind === "trope" ? item : item;

  return (
    <SafeAreaView style={[styles.recitationScreen, { backgroundColor: color + "08" }]}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onQuit} style={styles.quitBtn}>
          <Text style={styles.quitBtnText}>✕</Text>
        </TouchableOpacity>
        <View style={[styles.recitationTitle, { backgroundColor: color }]}>
          <Text style={styles.recitationTitleText}>{item.title || item.ref}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
        {/* Reference card */}
        <View style={[styles.reciteRefCard, { borderColor: color + "44" }]}>
          <Text style={styles.reciteLabel}>{kind === "trope" ? "VERSE — read it aloud" : "PRAYER — read it aloud"}</Text>
          <Text style={[styles.hebrewLarge, { color }]} numberOfLines={6}>
            {item.hebrew}
          </Text>
          <Text style={styles.reciteTranslit} numberOfLines={6}>{item.transliteration}</Text>
          <Text style={styles.reciteEnglish} numberOfLines={4}>{item.english}</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <SpeakButton text={item.hebrew} color={color} />
            <TouchableOpacity
              style={[styles.hearReference, { borderColor: color + "44" }]}
              onPress={() => Speech.speak(item.transliteration, { language: "en-US" })}
              activeOpacity={0.7}>
              <Text style={[styles.hearRefText, { color }]}>🔊 Translit</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recording controls */}
        <View style={[styles.recordCard, { borderColor: status === "recording" ? "#FF4B4B" : (micPermission === "granted" ? "#E5E5E5" : "#FCD34D") }]}>
          <Text style={styles.recordLabel}>YOUR VOICE</Text>
          {(micPermission === "not-asked" || micPermission === "denied") && (
            <View style={{ alignItems: "center", marginTop: 8, marginBottom: 4 }}>
              <Text style={{ color: "#92400E", fontWeight: "700", textAlign: "center", fontSize: 13, lineHeight: 18 }}>
                {micPermission === "denied"
                  ? "Microphone access denied. Tap below to grant."
                  : "Allow microphone access to record yourself."}
              </Text>
              <TouchableOpacity
                style={[styles.recordBtn, { backgroundColor: "#92400E", borderBottomColor: "#78350F" }]}
                onPress={requestMic} activeOpacity={0.85}>
                <Text style={styles.recordBtnText}>🎤  GRANT ACCESS</Text>
              </TouchableOpacity>
            </View>
          )}
          {micPermission === "granted" && status === "idle" && (
            <TouchableOpacity style={[styles.recordBtn, { backgroundColor: "#FF4B4B", borderBottomColor: "#CC1111" }]} onPress={startRecording} activeOpacity={0.85}>
              <Text style={styles.recordBtnText}>● RECORD</Text>
            </TouchableOpacity>
          )}
          {status === "recording" && (
            <>
              <View style={styles.recordingPulse} />
              <Text style={styles.recordingText}>Recording… {(duration / 1000).toFixed(1)}s</Text>
              <TouchableOpacity style={[styles.recordBtn, { backgroundColor: "#3C3C3C", borderBottomColor: "#1F1F1F" }]} onPress={stopRecording} activeOpacity={0.85}>
                <Text style={styles.recordBtnText}>■ STOP</Text>
              </TouchableOpacity>
            </>
          )}
          {status === "recorded" && (
            <View style={{ gap: 12, alignItems: "center" }}>
              <Text style={styles.recordedText}>✓ Recorded ({(duration / 1000).toFixed(1)}s)</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: color }]} onPress={playRecording} activeOpacity={0.85}>
                  <Text style={styles.smallBtnText}>▶ Play</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.smallBtn, { borderColor: color, borderWidth: 2 }]} onPress={reset} activeOpacity={0.85}>
                  <Text style={[styles.smallBtnText, { color }]}>Re-record</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {status === "playing" && (
            <Text style={styles.recordingText}>Playing…</Text>
          )}
          {status === "transcribing" && (
            <View style={{ marginTop: 16, alignItems: "center" }}>
              <ActivityIndicator size="large" color={color} />
              <Text style={[styles.recordingText, { marginTop: 8 }]}>
                Transcribing with on-device Whisper…
              </Text>
              <Text style={[styles.recordingText, { fontSize: 12, opacity: 0.6 }]}>
                {whisperReady === false ? "(falling back if model fails to load)" : "First run may take 5-10s to load the model"}
              </Text>
            </View>
          )}
          {transcriptPreview && status === "recorded" && (
            <View style={{ marginTop: 12, padding: 10, backgroundColor: "#F5F5F5", borderRadius: 8 }}>
              <Text style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>LAST TRANSCRIPT</Text>
              <Text style={{ fontSize: 14, color: "#222" }}>{transcriptPreview || "(empty)"}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {audioUri && status !== "recording" && status !== "transcribing" && (
        <View style={[styles.submitBar, { paddingBottom: Math.max(insets.bottom + 12, 24), backgroundColor: color + "12", borderTopColor: color + "44" }]}>
          <TouchableOpacity
            style={[styles.continueBtn, { backgroundColor: color, borderBottomColor: color + "AA" }]}
            onPress={submit} activeOpacity={0.85}>
            <Text style={styles.continueBtnText}>
              {whisperReady === false ? "SUBMIT (duration only)" : "SUBMIT FOR REVIEW"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCREENS
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Home ──────────────────────────────────────────────────────────────── */
function HomeScreen({ onSelectUnit, onSelectTropes, onSelectPrayers, onSelectVocabulary, onAchievements, stats, voicesChecked, availableTtsLocales, profile, onSwitchProfile }) {
  const dailyTip = TIPS[new Date().getDate() % TIPS.length];
  const unlocked = ACHIEVEMENTS.filter(a => a.check(stats)).length;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="light-content" backgroundColor="#1E3A8A" />
      <ScrollView>
        <View style={styles.homeHeader}>
          {profile && (
            <TouchableOpacity
              onPress={onSwitchProfile}
              style={styles.profilePill}
              accessibilityLabel={`Active profile: ${profile.name}. Tap to switch.`}
            >
              <View style={[styles.profilePillAvatar, { backgroundColor: profile.color }]}>
                <Text style={styles.profilePillEmoji}>{profile.avatar}</Text>
              </View>
              <Text style={styles.profilePillName}>{profile.name}</Text>
              <Text style={styles.profilePillChevron}>⇅</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.homeHeaderEyebrow}>SIDDUR & TROPE</Text>
          <Text style={styles.homeTitle}>Workbook</Text>
          <Text style={styles.homeSubtitle}>21 units · 26 trope marks · 9 prayers</Text>
        </View>
        <View style={styles.statsBar}>
          {[
            { icon: "🔥", label: "Streak", value: stats.streak },
            { icon: "⚡", label: "Total XP", value: stats.totalXP },
            { icon: "🎓", label: "Lessons", value: stats.lessons },
          ].map((s, i) => (
            <View key={i} style={{ alignItems: "center", flex: 1 }}>
              <Text style={{ fontSize: 20 }}>{s.icon}</Text>
              <Text style={styles.statBarValue}>{s.value}</Text>
              <Text style={styles.statBarLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.tipCard}>
          <Text style={styles.tipLabel}>TODAY'S TIP</Text>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <Text style={{ fontSize: 26 }}>{dailyTip.emoji}</Text>
            <Text style={styles.tipText}>{dailyTip.text}</Text>
          </View>
        </View>

        {((voicesChecked && availableTtsLocales && !availableTtsLocales.has("he")) || (__DEV__ && false)) && (
          <TouchableOpacity
            style={[styles.tipCard, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]}
            onPress={async () => {
              // Try known TTS settings / store links in order. Verified working paths on Android 16:
              const candidates = [
                "market://details?id=com.google.android.tts",                          // Play Store app deep link
                "https://play.google.com/store/apps/details?id=com.google.android.tts", // web fallback
                "com.google.android.tts.settings.CheckVoiceData",                      // Google TTS voice install (if app handles it)
                "package:com.google.android.tts",                                      // app info page
              ];
              for (const target of candidates) {
                const ok = await Linking.openURL(target).then(() => true).catch(() => false);
                if (ok) return;
              }
              Alert.alert(
                "Hebrew voice not installed",
                "Open Settings → System → Languages & input → Text-to-speech output → Google TTS → Install voice data → Hebrew. The Play Store link could not be opened automatically."
              );
            }}
            activeOpacity={0.85}>
            <Text style={[styles.tipLabel, { color: "#B91C1C" }]}>HEBREW VOICE NOT INSTALLED</Text>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
              <Text style={{ fontSize: 26 }}>🔇</Text>
              <Text style={[styles.tipText, { color: "#7F1D1D" }]}>
                The Hebrew text-to-speech voice isn't installed on this device, so 🔊 buttons stay silent.
                Tap here to open Google TTS in the Play Store — install or update it, then in Settings → System → Languages & input → Text-to-speech output → Google TTS → Install voice data → Hebrew to download the voice.
              </Text>
            </View>
          </TouchableOpacity>
        )}

        <View style={{ padding: 20, gap: 14 }}>
          <Text style={styles.sectionLabel}>QUICK ACCESS</Text>

          {/* Trope catalog */}
          <TouchableOpacity style={styles.quickCard} onPress={onSelectTropes} activeOpacity={0.85}>
            <View style={[styles.quickIcon, { backgroundColor: "#FEF3C7" }]}>
              <Text style={{ fontSize: 32 }}>🎵</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickTitle}>Trope Catalog</Text>
              <Text style={styles.quickDesc}>All 26 marks — names, shapes, tiers, frequency</Text>
            </View>
            <Text style={styles.quickArrow}>→</Text>
          </TouchableOpacity>

          {/* Prayers */}
          <TouchableOpacity style={styles.quickCard} onPress={onSelectPrayers} activeOpacity={0.85}>
            <View style={[styles.quickIcon, { backgroundColor: "#DBF4FA" }]}>
              <Text style={{ fontSize: 32 }}>📜</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickTitle}>Prayers</Text>
              <Text style={styles.quickDesc}>Modeh Ani · Shema · Amidah · Priestly Blessing</Text>
            </View>
            <Text style={styles.quickArrow}>→</Text>
          </TouchableOpacity>

          {/* Vocabulary */}
          <TouchableOpacity style={styles.quickCard} onPress={onSelectVocabulary} activeOpacity={0.85}>
            <View style={[styles.quickIcon, { backgroundColor: "#D6F5F0" }]}>
              <Text style={{ fontSize: 32 }}>🔤</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickTitle}>Hebrew Vocabulary</Text>
              <Text style={styles.quickDesc}>24 essential words — hear the pronunciation</Text>
            </View>
            <Text style={styles.quickArrow}>→</Text>
          </TouchableOpacity>
        </View>

        <View style={{ padding: 20, gap: 14, paddingTop: 0 }}>
          <Text style={styles.sectionLabel}>WORKBOOK UNITS</Text>
          {UNITS.map((u) => {
            const xp = stats[u.id + "_xp"] || 0;
            const pct = Math.min(100, xp / 2);
            return (
              <TouchableOpacity key={u.id} style={[styles.unitCard, { borderColor: u.color + "44" }]} onPress={() => onSelectUnit(u)} activeOpacity={0.85}>
                <View style={[styles.unitIcon, { backgroundColor: u.pale }]}>
                  <Text style={{ fontSize: 28 }}>{u.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                    <Text style={styles.unitTitle}>{u.title}</Text>
                    <Text style={styles.unitHebrew}>{u.hebrewTitle}</Text>
                  </View>
                  <Text style={styles.unitDesc} numberOfLines={2}>{u.desc}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <View style={{ flex: 1, height: 4, backgroundColor: "#E5E5E5", borderRadius: 2, overflow: "hidden" }}>
                      <View style={{ height: "100%", backgroundColor: u.color, width: `${pct}%` }} />
                    </View>
                    <Text style={[styles.unitXP, { color: u.color }]}>{xp} XP</Text>
                  </View>
                </View>
                <Text style={[styles.quickArrow, { color: u.color }]}>→</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Achievements */}
        <TouchableOpacity style={styles.achieveBtn} onPress={onAchievements} activeOpacity={0.85}>
          <Text style={{ fontSize: 22 }}>🏅</Text>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.achieveBtnTitle}>Achievements</Text>
            <Text style={styles.achieveBtnSub}>{unlocked} of {ACHIEVEMENTS.length} unlocked</Text>
          </View>
          <Text style={styles.quickArrow}>→</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Powered by the Siddur & Trope Workbook (Expanded Edition)</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Unit detail ───────────────────────────────────────────────────────── */
function UnitDetailScreen({ unit, onStartLesson, onBack }) {
  const exercises = UNIT_EXERCISES[unit.id] || [];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.unitHeader, { backgroundColor: unit.color }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.unitHeaderTitle}>{unit.emoji} {unit.title}</Text>
          <Text style={styles.unitHeaderSub}>{unit.hebrewTitle}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={styles.unitDesc}>{unit.desc}</Text>

        {unit.id === "trope-recitation" && (
          <View>
            <Text style={styles.sectionLabel}>RECITE A TORAH VERSE</Text>
            {TROPE_VERSES.map((v) => (
              <TouchableOpacity key={v.id} style={[styles.prayerRow, { borderColor: unit.color + "44" }]}
                onPress={() => onStartLesson({ kind: "recite-trope", item: v, color: unit.color, title: v.title, sub: v.ref })}
                activeOpacity={0.85}>
                <Text style={{ fontSize: 22 }}>📜</Text>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.prayerRowTitle}>{v.ref}</Text>
                  <Text style={styles.prayerRowDesc}>{v.title}</Text>
                </View>
                <Text style={[styles.quickArrow, { color: unit.color }]}>→</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {unit.id === "prayer-recitation" && (
          <View>
            <Text style={styles.sectionLabel}>RECITE A PRAYER</Text>
            {PRAYERS.filter(p => ["morning","kriat-shema","amidah","torah"].includes(p.category)).map((p) => (
              <TouchableOpacity key={p.id} style={[styles.prayerRow, { borderColor: unit.color + "44" }]}
                onPress={() => onStartLesson({ kind: "recite-prayer", item: p, color: unit.color, title: p.title, sub: p.hebrewTitle })}
                activeOpacity={0.85}>
                <Text style={{ fontSize: 22 }}>🗣️</Text>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.prayerRowTitle}>{p.title}</Text>
                  <Text style={styles.prayerRowDesc}>{p.hebrewTitle} · {p.category}</Text>
                </View>
                <Text style={[styles.quickArrow, { color: unit.color }]}>→</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {exercises.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>PRACTICE EXERCISES</Text>
            <TouchableOpacity style={[styles.startBtn, { backgroundColor: unit.color, borderBottomColor: unit.shadow }]}
              onPress={() => onStartLesson({ kind: "lesson", exercises, color: unit.color, title: unit.title, unitId: unit.id })}
              activeOpacity={0.85}>
              <Text style={styles.startBtnText}>START {exercises.length} EXERCISES</Text>
            </TouchableOpacity>
          </>
        )}

        {unit.id === "taamei-hamikra" && (
          <>
            <Text style={styles.sectionLabel}>TROPE ID QUIZ</Text>
            <TouchableOpacity style={[styles.startBtn, { backgroundColor: unit.color, borderBottomColor: unit.shadow }]}
              onPress={() => onStartLesson({ kind: "trope-quiz", exercises: TROPE_ID_QUIZ.map(q => ({
                type: "mcq", question: q.question, options: q.options, correct: q.correct, fact: q.fact,
              })), color: unit.color, title: "Trope Identification", unitId: unit.id })}
              activeOpacity={0.85}>
              <Text style={styles.startBtnText}>START 5-QUESTION TROPE QUIZ</Text>
            </TouchableOpacity>
          </>
        )}

        {unit.id === "trope-dichotomy" && (
          <>
            <Text style={styles.sectionLabel}>VERSE PARSING PRACTICE</Text>
            {TROPE_VERSES.map((v) => (
              <TouchableOpacity key={v.id} style={[styles.prayerRow, { borderColor: unit.color + "44" }]}
                onPress={() => onStartLesson({ kind: "verse-parse", item: v, color: unit.color, title: v.title, sub: v.ref })}
                activeOpacity={0.85}>
                <Text style={{ fontSize: 22 }}>🌳</Text>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.prayerRowTitle}>{v.ref}</Text>
                  <Text style={styles.prayerRowDesc}>Identify every trope mark — {v.exercises.length} words</Text>
                </View>
                <Text style={[styles.quickArrow, { color: unit.color }]}>→</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Trope Catalog ─────────────────────────────────────────────────────── */
function TropeCatalogScreen({ onBack }) {
  const [filter, setFilter] = useState("all"); // all | disjunctive | conjunctive
  const filtered = TROPES.filter(t => filter === "all" || t.type === filter);
  const byTier = {};
  for (const t of filtered) {
    const k = t.type === "conjective" ? "conjective" : `tier-${t.tier}`;
    (byTier[k] = byTier[k] || []).push(t);
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="dark-content" />
      <View style={[styles.unitHeader, { backgroundColor: "#B45309" }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.unitHeaderTitle}>🎵 Trope Catalog</Text>
          <Text style={styles.unitHeaderSub}>טַעֲמֵי הַמִּקְרָא</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Filter pills */}
      <View style={{ flexDirection: "row", padding: 14, gap: 8 }}>
        {[
          { id: "all",          label: "All 26",         count: TROPES.length },
          { id: "disjunctive",  label: "Disjunctive",    count: TROPES.filter(t => t.type === "disjunctive").length },
          { id: "conjective",   label: "Conjunctive",    count: TROPES.filter(t => t.type === "conjective").length },
        ].map(f => (
          <TouchableOpacity key={f.id}
            style={[styles.filterPill, filter === f.id && styles.filterPillActive]}
            onPress={() => setFilter(f.id)} activeOpacity={0.85}>
            <Text style={[styles.filterPillText, filter === f.id && { color: "#fff" }]}>{f.label} ({f.count})</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, gap: 16 }}>
        {/* Mnemonic */}
        <View style={[styles.mnemonicCard, { borderColor: "#FEF3C7" }]}>
          <Text style={styles.mnemonicTitle}>Mnemonic: Hierarchy of Pauses</Text>
          {TROPE_MNEMONIC.map((m, i) => (
            <View key={i} style={styles.mnemonicRow}>
              <View style={[styles.strengthBar, { width: 12 + m.strength * 18 }]} />
              <Text style={styles.mnemonicEn}>{m.english}</Text>
              <Text style={styles.mnemonicTrope}>{m.trope}</Text>
            </View>
          ))}
        </View>

        {/* Systems */}
        <View style={styles.systemsCard}>
          <Text style={styles.mnemonicTitle}>Two Trope Systems</Text>
          {TROPE_SYSTEMS.map(s => (
            <View key={s.id} style={{ marginTop: 8 }}>
              <Text style={{ fontWeight: "800", color: "#3C3C3C" }}>{s.name}</Text>
              <Text style={{ fontSize: 12, color: "#5C5C5C", marginTop: 2 }}>{s.desc}</Text>
            </View>
          ))}
        </View>

        {/* Grouped tropes */}
        {Object.entries(byTier).map(([key, list]) => (
          <View key={key}>
            <Text style={styles.tierHeader}>
              {key === "conjective" ? "Conjunctive Tropes — Meshartim ('Servants')" : (TROPE_TIER_NAMES[parseInt(key.split("-")[1])] || key)}
            </Text>
            {list.map(t => (
              <View key={t.id} style={[styles.tropeCard, { borderColor: "#FEF3C7" }]}>
                <View style={styles.tropeShape}>
                  <Text style={styles.tropeShapeChar}>{t.shapeUnicode}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tropeName}>{t.name}</Text>
                  <Text style={styles.tropeHebrew}>{t.hebrew}</Text>
                  <Text style={styles.tropeTranslit}>{t.transliteration}</Text>
                  <Text style={styles.tropeFunc}>{t.function}</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6, alignItems: "center" }}>
                    <Text style={styles.tropeFreq}>📊 {t.frequency}</Text>
                    {t.example && <Text style={styles.tropeFreq}>· e.g. {t.example}</Text>}
                  </View>
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Prayer Catalog ────────────────────────────────────────────────────── */
function PrayerCatalogScreen({ onSelectPrayer, onBack }) {
  const grouped = {};
  for (const p of PRAYERS) {
    (grouped[p.category] = grouped[p.category] || []).push(p);
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="dark-content" />
      <View style={[styles.unitHeader, { backgroundColor: "#0EA5E9" }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.unitHeaderTitle}>📜 Prayers</Text>
          <Text style={styles.unitHeaderSub}>Tap to read, hear, and record</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        {Object.entries(grouped).map(([cat, list]) => (
          <View key={cat} style={{ marginBottom: 18 }}>
            <Text style={styles.tierHeader}>{cat.replace(/-/g, " ")}</Text>
            {list.map(p => (
              <TouchableOpacity key={p.id} style={styles.prayerBigCard} onPress={() => onSelectPrayer(p)} activeOpacity={0.85}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prayerBigTitle}>{p.title}</Text>
                  <Text style={styles.prayerBigHeb}>{p.hebrewTitle}</Text>
                  <Text style={styles.prayerBigMeta}>{p.occasion}</Text>
                </View>
                <Text style={styles.quickArrow}>→</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Prayer Detail (read + speak + record) ─────────────────────────────── */
function PrayerDetailScreen({ prayer, onRecite, onBack }) {
  const [showTranslit, setShowTranslit] = useState(true);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.unitHeader, { backgroundColor: "#0EA5E9" }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.unitHeaderTitle}>{prayer.title}</Text>
          <Text style={styles.unitHeaderSub}>{prayer.hebrewTitle}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.prayerViewCard}>
          <Text style={styles.prayerViewLabel}>HEBREW</Text>
          <Text style={[styles.hebrewLarge, { color: "#1E3A8A" }]}>{prayer.hebrew}</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <SpeakButton text={prayer.hebrew} color="#1E3A8A" />
            <TouchableOpacity
              style={[styles.hearReference, { borderColor: "#1E3A8A44" }]}
              onPress={() => Speech.speak(prayer.transliteration, { language: "en-US" })}
              activeOpacity={0.7}>
              <Text style={[styles.hearRefText, { color: "#1E3A8A" }]}>🔊 Translit</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.prayerViewLabel, { marginTop: 14 }]}>TRANSLITERATION</Text>
          <Text style={styles.prayerViewTranslit}>{prayer.transliteration}</Text>
          <Text style={[styles.prayerViewLabel, { marginTop: 14 }]}>ENGLISH</Text>
          <Text style={styles.prayerViewEnglish}>{prayer.english}</Text>
          <Text style={[styles.prayerViewLabel, { marginTop: 14 }]}>SOURCE</Text>
          <Text style={styles.prayerViewEnglish}>{prayer.source}</Text>
        </View>

        {prayer.vocabularyFocus && prayer.vocabularyFocus.length > 0 && (
          <View style={[styles.vocabCard, { marginTop: 16 }]}>
            <Text style={styles.prayerViewLabel}>VOCABULARY IN THIS PRAYER</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {prayer.vocabularyFocus.map(w => (
                <TouchableOpacity key={w} style={styles.vocabChip} onPress={() => Speech.speak(w, { language: "en-US" })} activeOpacity={0.7}>
                  <Text style={styles.vocabChipText}>{w}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.startBtn, { backgroundColor: "#0EA5E9", borderBottomColor: "#0A7BAB", marginTop: 20 }]}
          onPress={() => onRecite(prayer)} activeOpacity={0.85}>
          <Text style={styles.startBtnText}>🎤  RECORD YOURSELF READING THIS</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Vocabulary screen ─────────────────────────────────────────────────── */
function VocabularyScreen({ onBack }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="dark-content" />
      <View style={[styles.unitHeader, { backgroundColor: "#0D9488" }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.unitHeaderTitle}>🔤 Hebrew Vocabulary</Text>
          <Text style={styles.unitHeaderSub}>Tap 🔊 to hear the pronunciation</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <Text style={styles.tipText}>
          Each entry shows the Hebrew (native script), the transliteration (pronunciation guide), the English meaning, and the grammatical gender.
          On a Hebrew-voice-enabled Android device, 🔊 plays the word using the device's Hebrew TTS.
        </Text>
        {HEBREW_VOCAB.map((v, i) => (
          <View key={i} style={styles.vocabRow}>
            <View style={styles.vocabHebrew}>
              <Text style={[styles.vocabHebText, { textAlign: "right" }]}>{v.hebrew}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.vocabTranslit}>{v.transliteration}</Text>
              <Text style={styles.vocabEnglish}>{v.english}</Text>
              <Text style={styles.vocabGender}>{v.gender === "m" ? "♂ masculine" : "♀ feminine"}</Text>
            </View>
            <SpeakButton text={v.hebrew} color="#0D9488" />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Lesson Screen (mcq / fillblank / match / wordarrange) ─────────────── */
function LessonScreen({ lessonData, onComplete, onQuit }) {
  const { exercises, color, title, unitId } = lessonData;
  const [idx, setIdx] = useState(0);
  const [hearts, setHearts] = useState(HEARTS_MAX);
  const [xp, setXp] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [isPerfect, setIsPerfect] = useState(true);

  const ex = exercises[idx];

  const handleAnswer = useCallback((correct, answer) => {
    if (correct) {
      setXp(x => x + XP_PER_CORRECT);
      setCorrectCount(c => c + 1);
      setFeedback({ correct: true, funFact: ex.fact || null });
    } else {
      const newHearts = hearts - 1;
      setHearts(newHearts);
      setIsPerfect(false);
      setFeedback({ correct: false, correctAnswer: ex.correct || ex.correct_target || null });
      if (newHearts <= 0) {
        setTimeout(() => onComplete({ correctCount, xp, isPerfect: false, outOfHearts: true, unitId }), 1200);
      }
    }
  }, [ex, hearts, correctCount, xp]);

  const handleMatchComplete = useCallback(() => {
    setXp(x => x + XP_PER_CORRECT);
    setCorrectCount(c => c + 1);
    setFeedback({ correct: true, funFact: "Matching pairs builds deep vocabulary recall!" });
  }, []);

  const handleContinue = () => {
    setFeedback(null);
    if (idx + 1 >= exercises.length) {
      onComplete({ correctCount, xp, isPerfect, unitId });
      return;
    }
    setIdx(i => i + 1);
  };

  const exerciseLabel = {
    mcq: "Pick the right answer",
    fillblank: "Fill in the blank",
    match: "Match the pairs",
    wordarrange: "Arrange the words",
  }[ex.type] || "Complete the exercise";

  return (
    <SafeAreaView style={styles.lessonScreen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onQuit} style={styles.quitBtn}>
          <Text style={styles.quitBtnText}>✕</Text>
        </TouchableOpacity>
        <ProgressBar current={idx} total={exercises.length} color={color} />
        <View style={{ flexDirection: "row", gap: 3 }}>
          {Array.from({ length: HEARTS_MAX }).map((_, i) => <Heart key={i} filled={i < hearts} />)}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", paddingHorizontal: 20, marginBottom: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "800", color: "#FFD700" }}>⚡ {xp} XP</Text>
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: feedback ? 220 : 24 }}>
        <Text style={styles.exerciseLabel}>{exerciseLabel}</Text>
        {ex.type === "mcq" && <ExerciseMCQ key={idx} ex={ex} onAnswer={handleAnswer} color={color} />}
        {ex.type === "fillblank" && <ExerciseFillBlank key={idx} ex={ex} onAnswer={handleAnswer} color={color} />}
        {ex.type === "match" && <ExerciseMatch key={idx} ex={ex} onComplete={handleMatchComplete} color={color} />}
        {ex.type === "wordarrange" && <ExerciseWordArrange key={idx} ex={ex} onAnswer={handleAnswer} color={color} />}
      </ScrollView>
      {feedback && (
        <FeedbackBar correct={feedback.correct} funFact={feedback.funFact}
          onContinue={handleContinue} color={color} correctAnswer={feedback.correctAnswer} />
      )}
    </SafeAreaView>
  );
}

/* ─── Result Screen ─────────────────────────────────────────────────────── */
function ResultScreen({ color, colorShadow, correct, total, xpEarned, onHome, onRetry, newAchievements, isPerfect, kind, outOfHearts, transcript, wordMatches, wordTotal, pct: pctProp }) {
  const pct = kind === "recite" ? (pctProp ?? 0) : Math.round((correct / total) * 100);
  const passed = kind === "recite" ? isPerfect : pct >= 60;
  const scaleAnim = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 8 }).start();
  }, []);
  return (
    <SafeAreaView style={styles.resultScreen}>
      <StatusBar barStyle="dark-content" />
      <Animated.View style={[{ alignItems: "center" }, { transform: [{ scale: scaleAnim }] }]}>
        <Text style={{ fontSize: 80 }}>{isPerfect ? "🏆" : passed ? "⭐" : "📚"}</Text>
        <Text style={styles.resultTitle}>{isPerfect ? "Excellent pronunciation!" : passed ? "Good effort!" : outOfHearts ? "Out of hearts" : "Keep practicing!"}</Text>
        <Text style={styles.resultSubtitle}>{kind === "recite" ? "Pronunciation analysis" : "Lesson Complete"}</Text>
      </Animated.View>
      <View style={styles.statsRow}>
        {[
          { icon: "⚡", label: "XP Earned", value: `+${xpEarned}`, color: "#FFD700" },
          { icon: "🎯", label: kind === "recite" ? "Score" : "Accuracy", value: `${pct}%`, color },
          kind === "recite"
            ? { icon: "📝", label: "Words matched", value: wordTotal ? `${wordMatches}/${wordTotal}` : "—", color: "#0EA5E9" }
            : { icon: "✅", label: "Correct", value: `${correct}/${total}`, color: "#58CC02" },
        ].map((s, i) => (
          <View key={i} style={styles.statCard}>
            <Text style={{ fontSize: 22 }}>{s.icon}</Text>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
      {kind === "recite" && transcript !== undefined && (
        <View style={styles.transcriptCard}>
          <Text style={styles.transcriptLabel}>📝 WHAT WE HEARD (Whisper ASR)</Text>
          {transcript ? (
            <Text style={styles.transcriptText} numberOfLines={6}>{transcript}</Text>
          ) : (
            <Text style={[styles.transcriptText, { fontStyle: "italic", color: "#999" }]}>
              (no transcription — duration heuristic was used)
            </Text>
          )}
          <Text style={[styles.statLabel, { marginTop: 8, lineHeight: 18 }]}>
            Scored on a Levenshtein word-recall against the expected transliteration.
            {' '}First run takes ~5-10s for model warm-up; subsequent runs are 1-3s.
          </Text>
        </View>
      )}
      {newAchievements && newAchievements.length > 0 && (
        <View style={styles.achievementUnlock}>
          <Text style={styles.achievementUnlockTitle}>🏅 Achievement Unlocked!</Text>
          {newAchievements.map((a) => (
            <View key={a.id} style={styles.achievementRow}>
              <Text style={{ fontSize: 22 }}>{a.emoji}</Text>
              <View>
                <Text style={styles.achievementName}>{a.name}</Text>
                <Text style={styles.achievementDesc}>{a.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
      <View style={{ gap: 12, width: "100%" }}>
        {onRetry && (
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: color, borderBottomColor: colorShadow }]} onPress={onRetry} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.secondaryBtn} onPress={onHome} activeOpacity={0.85}>
          <Text style={styles.secondaryBtnText}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ─── Achievements Screen ───────────────────────────────────────────────── */
function AchievementsScreen({ stats, onBack }) {
  const unlocked = ACHIEVEMENTS.filter(a => a.check(stats));
  const locked = ACHIEVEMENTS.filter(a => !a.check(stats));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.achieveHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={[styles.backBtnText, { color: "#3C3C3C" }]}>←</Text>
        </TouchableOpacity>
        <Text style={styles.achieveHeaderTitle}>🏅 Achievements</Text>
        <Text style={styles.achieveHeaderCount}>{unlocked.length}/{ACHIEVEMENTS.length}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {unlocked.length > 0 && (
          <>
            <Text style={styles.achieveSectionLabel}>UNLOCKED</Text>
            <View style={{ gap: 10, marginBottom: 24 }}>
              {unlocked.map(a => (
                <View key={a.id} style={[styles.achieveCard, styles.achieveCardUnlocked]}>
                  <Text style={{ fontSize: 28 }}>{a.emoji}</Text>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={styles.achieveCardName}>{a.name}</Text>
                    <Text style={styles.achieveCardDesc}>{a.desc}</Text>
                  </View>
                  <Text style={{ color: "#58CC02", fontSize: 18 }}>✓</Text>
                </View>
              ))}
            </View>
          </>
        )}
        {locked.length > 0 && (
          <>
            <Text style={styles.achieveSectionLabel}>LOCKED</Text>
            <View style={{ gap: 10 }}>
              {locked.map(a => (
                <View key={a.id} style={[styles.achieveCard, styles.achieveCardLocked]}>
                  <Text style={{ fontSize: 28, opacity: 0.3 }}>{a.emoji}</Text>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={[styles.achieveCardName, { color: "#AFAFAF" }]}>{a.name}</Text>
                    <Text style={styles.achieveCardDesc}>{a.desc}</Text>
                  </View>
                  <Text style={{ color: "#AFAFAF", fontSize: 18 }}>🔒</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROOT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [screen, setScreen] = useState("home");
  const [activeUnit, setActiveUnit] = useState(null);
  const [activeLesson, setActiveLesson] = useState(null);
  const [activePrayer, setActivePrayer] = useState(null);
  const [activeRecite, setActiveRecite] = useState(null);

  // ── Profile state ─────────────────────────────────────────────────────
  // profiles: array of { id, name, avatar, color, stats, achievements, ... }
  // activeProfileId: id of currently selected profile (null = show picker)
  // stats: derived from active profile (mirrors profiles[i].stats for fast access)
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [profileBootstrapped, setProfileBootstrapped] = useState(false);
  const [showProfilePicker, setShowProfilePicker] = useState(false);
  const [showProfileCreate, setShowProfileCreate] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);

  // Compute the active profile object (or null) and a stats object that always
  // matches the active profile. Components read stats like before — no API
  // change at the call sites.
  const activeProfile = profiles.find((p) => p.id === activeProfileId) || null;
  const [stats, setStatsLocal] = useState({
    streak: 0,
    totalXP: 0,
    lessons: 0,
    perfectLessons: 0,
    trope_correct: 0,
    recordings: 0,
    units_completed: 0,
  });

  // Wrapper around setStats that also persists to the active profile's stats.
  // All existing call sites use setStats(newStats) — they keep working unchanged.
  const setStats = useCallback((updater) => {
    setStatsLocal((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (activeProfileId) {
        // Persist to AsyncStorage (fire and forget; UI is already updated).
        updateProfileStats(activeProfileId, next).catch((err) =>
          console.warn("[profiles] persist stats failed:", err)
        );
        // Mirror into the in-memory profile too so UI re-renders are consistent.
        setProfiles((prevProfiles) =>
          prevProfiles.map((p) =>
            p.id === activeProfileId ? { ...p, stats: { ...p.stats, ...next } } : p
          )
        );
      }
      return next;
    });
  }, [activeProfileId]);
  const [resultData, setResultData] = useState(null);
  const [availableTtsLocales, setAvailableTtsLocales] = useState(new Set());

  // Detect Hebrew TTS voice availability
  const [voicesChecked, setVoicesChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const check = async () => {
      const voices = await Speech.getAvailableVoicesAsync().catch(() => []);
      if (cancelled) return;
      attempts++;
      console.log("[TTS] check attempt", attempts, "voices.length=", voices.length, "he-?", voices.some(v => (v.language||"").toLowerCase().startsWith("he")));
      if (voices.length > 0) {
        const locales = new Set(voices.map(v => v.language?.split("-")[0].toLowerCase()).filter(Boolean));
        setAvailableTtsLocales(locales);
        setVoicesChecked(true);
      } else if (attempts >= 3) {
        setAvailableTtsLocales(new Set());
        setVoicesChecked(true);
      } else {
        setTimeout(check, 1500);
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  // Pre-warm Hebrew TTS (Android engine loads asynchronously)
  useEffect(() => {
    if (availableTtsLocales.has("he")) {
      try { Speech.warmupAsync?.(); } catch {}
    }
  }, [availableTtsLocales]);

  // ── Profile bootstrap ─────────────────────────────────────────────────
  // Load persisted profiles on app start, then either restore the active one
  // or leave activeProfileId null so the picker screen shows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadProfiles();
        const storedActiveId = await loadActiveId();
        if (cancelled) return;
        setProfiles(stored);
        const exists = stored.find((p) => p.id === storedActiveId);
        if (exists) {
          setActiveProfileId(exists.id);
          setStatsLocal(exists.stats || {
            streak: 0, totalXP: 0, lessons: 0, perfectLessons: 0,
            trope_correct: 0, recordings: 0, units_completed: 0,
          });
        }
        // else: no active profile; show picker screen on first render
      } catch (err) {
        console.warn("[profiles] bootstrap failed:", err);
      } finally {
        if (!cancelled) setProfileBootstrapped(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Profile actions ───────────────────────────────────────────────────
  const handleSelectProfile = async (id) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setActiveProfileId(id);
    await saveActiveId(id);
    setStatsLocal(p.stats || {
      streak: 0, totalXP: 0, lessons: 0, perfectLessons: 0,
      trope_correct: 0, recordings: 0, units_completed: 0,
    });
    setShowProfilePicker(false);
    setShowSwitcher(false);
  };

  const handleCreateProfile = () => {
    setShowProfilePicker(false);
    setShowSwitcher(false);
    setShowProfileCreate(true);
  };

  const handleProfileCreated = async (profile /*, wasEditing */) => {
    // Re-load profiles so the just-created one is in state with its server id.
    const fresh = await loadProfiles();
    setProfiles(fresh);
    setActiveProfileId(profile.id);
    await saveActiveId(profile.id);
    setStatsLocal(profile.stats);
    setShowProfileCreate(false);
  };

  const handleDeleteProfile = async (id) => {
    const fresh = await deleteProfileStore(id);
    setProfiles(fresh);
    if (activeProfileId === id) {
      const next = fresh[0]?.id ?? null;
      setActiveProfileId(next);
      await saveActiveId(next);
      const nextProfile = fresh.find((p) => p.id === next);
      setStatsLocal(nextProfile?.stats || {
        streak: 0, totalXP: 0, lessons: 0, perfectLessons: 0,
        trope_correct: 0, recordings: 0, units_completed: 0,
      });
    }
  };

  const handleUnitSelect = (unit) => { setActiveUnit(unit); setScreen("unit-detail"); };
  const handleStartLesson = (lesson) => {
    if (lesson.kind === "recite-prayer" || lesson.kind === "recite-trope") {
      setActiveRecite(lesson);
      setScreen("recitation");
    } else {
      setActiveLesson(lesson);
      setScreen("lesson");
    }
  };
  const handlePrayerSelect = (p) => { setActivePrayer(p); setScreen("prayer-detail"); };
  const handleReciteFromPrayer = (prayer) => {
    setActiveRecite({ kind: "recite-prayer", item: prayer, color: "#0EA5E9", title: prayer.title, sub: prayer.hebrewTitle });
    setScreen("recitation");
  };

  const handleLessonComplete = useCallback(({ correctCount, xp, isPerfect, unitId, outOfHearts }) => {
    const completedSet = new Set([...(stats.units_completed_set || []), unitId].filter(Boolean));
    const newStats = {
      ...stats,
      totalXP: stats.totalXP + xp,
      lessons: stats.lessons + 1,
      perfectLessons: stats.perfectLessons + (isPerfect ? 1 : 0),
      streak: stats.streak + 1,
      trope_correct: stats.trope_correct + (unitId === "taamei-hamikra" || unitId === "trope-dichotomy" ? xp / 10 : 0),
      units_completed: completedSet.size,
      units_completed_set: Array.from(completedSet),
      ...(unitId ? { [unitId + "_xp"]: (stats[unitId + "_xp"] || 0) + xp } : {}),
    };
    const prevUnlocked = new Set(ACHIEVEMENTS.filter(a => a.check(stats)).map(a => a.id));
    const newAchievements = ACHIEVEMENTS.filter(a => a.check(newStats) && !prevUnlocked.has(a.id));
    setStats(newStats);
    setResultData({
      correctCount: correctCount + (outOfHearts ? 0 : 0),
      total: activeLesson?.exercises?.length || 0,
      xpEarned: xp,
      newAchievements,
      isPerfect,
      kind: "lesson",
      outOfHearts,
    });
    setScreen("result");
  }, [stats, activeLesson]);

  const handleReciteComplete = useCallback(({ passed, duration, score, matches, total, transcript }) => {
    const xp = passed ? XP_PER_CORRECT * 3 : 0;  // recording practice earns 3× for the extra effort
    const newStats = {
      ...stats,
      totalXP: stats.totalXP + xp,
      lessons: stats.lessons + 1,
      streak: stats.streak + 1,
      recordings: (stats.recordings || 0) + 1,
    };
    const prevUnlocked = new Set(ACHIEVEMENTS.filter(a => a.check(stats)).map(a => a.id));
    const newAchievements = ACHIEVEMENTS.filter(a => a.check(newStats) && !prevUnlocked.has(a.id));
    setStats(newStats);
    setResultData({
      correctCount: 1,
      total: 1,
      xpEarned: xp,
      newAchievements,
      isPerfect: passed,
      kind: "recite",
      pct: score ?? 0,
      duration,
      // Pronunciation-specific data (used by ResultScreen for the new feedback card)
      transcript: transcript || "",
      wordMatches: matches || 0,
      wordTotal: total || 0,
    });
    setScreen("result");
  }, [stats]);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        {/* Profile gates: before bootstrap finishes, show nothing.
            When there's no active profile, show the picker. */}
        {!profileBootstrapped ? null :
         showProfileCreate ? (
          <ProfileCreateScreen
            onCancel={() => {
              setShowProfileCreate(false);
              if (profiles.length === 0) setShowProfilePicker(true);
            }}
            onCreated={handleProfileCreated}
          />
         ) :
         !activeProfileId ? (
          <ProfileSelectScreen
            profiles={profiles}
            activeId={activeProfileId}
            onSelectProfile={handleSelectProfile}
            onCreateNew={handleCreateProfile}
            onDeleteProfile={handleDeleteProfile}
          />
         ) : (
          <>
            {screen === "home" && (
              <HomeScreen
                onSelectUnit={handleUnitSelect}
                onSelectTropes={() => setScreen("tropes")}
                onSelectPrayers={() => setScreen("prayers")}
                onSelectVocabulary={() => setScreen("vocabulary")}
                onAchievements={() => setScreen("achievements")}
                stats={stats}
                voicesChecked={voicesChecked}
                availableTtsLocales={availableTtsLocales}
                profile={activeProfile}
                onSwitchProfile={() => setShowSwitcher(true)}
              />
        )}
        {screen === "unit-detail" && activeUnit && (
          <UnitDetailScreen unit={activeUnit} onStartLesson={handleStartLesson} onBack={() => setScreen("home")} />
        )}
        {screen === "tropes" && <TropeCatalogScreen onBack={() => setScreen("home")} />}
        {screen === "prayers" && (
          <PrayerCatalogScreen
            onSelectPrayer={handlePrayerSelect}
            onBack={() => setScreen("home")}
          />
        )}
        {screen === "prayer-detail" && activePrayer && (
          <PrayerDetailScreen
            prayer={activePrayer}
            onRecite={handleReciteFromPrayer}
            onBack={() => setScreen("prayers")}
          />
        )}
        {screen === "vocabulary" && <VocabularyScreen onBack={() => setScreen("home")} />}
        {screen === "achievements" && (
          <AchievementsScreen stats={stats} onBack={() => setScreen("home")} />
        )}
        {screen === "lesson" && activeLesson && (
          <LessonScreen
            lessonData={activeLesson}
            onComplete={handleLessonComplete}
            onQuit={() => setScreen(activeUnit ? "unit-detail" : "home")}
          />
        )}
        {screen === "recitation" && activeRecite && (
          <RecitationScreen
            item={activeRecite.item}
            kind={activeRecite.kind === "recite-trope" ? "trope" : "prayer"}
            onComplete={handleReciteComplete}
            onQuit={() => setScreen(activeUnit ? "unit-detail" : activePrayer ? "prayer-detail" : "home")}
            color={activeRecite.color || "#0EA5E9"}
          />
        )}
        {screen === "result" && resultData && (
          <ResultScreen
            color={activeLesson?.color || activeRecite?.color || "#1E3A8A"}
            colorShadow={(activeLesson?.color || activeRecite?.color || "#1E3A8A") + "AA"}
            correct={resultData.correctCount}
            total={resultData.total}
            xpEarned={resultData.xpEarned}
            newAchievements={resultData.newAchievements}
            isPerfect={resultData.isPerfect}
            kind={resultData.kind}
            outOfHearts={resultData.outOfHearts}
            // Pronunciation-specific data for recite-result variant
            transcript={resultData.transcript}
            wordMatches={resultData.wordMatches}
            wordTotal={resultData.wordTotal}
            pct={resultData.pct}
            onRetry={activeLesson ? () => { setActiveLesson({ ...activeLesson }); setScreen("lesson"); } : activeRecite ? () => { setActiveRecite({ ...activeRecite }); setScreen("recitation"); } : null}
            onHome={() => setScreen("home")}
          />
        )}
        <ProfileSwitcherModal
          visible={showSwitcher}
          profiles={profiles}
          activeId={activeProfileId}
          onClose={() => setShowSwitcher(false)}
          onSwitch={handleSelectProfile}
          onAddNew={handleCreateProfile}
          onDelete={handleDeleteProfile}
        />
          </>
        )}
      </View>
    </SafeAreaProvider>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  // ─── Top bar / progress ────────────────────────────────────────────────
  topBar: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, paddingTop: 8 },
  quitBtn: { padding: 8 },
  quitBtnText: { fontSize: 18, color: "#AFAFAF", fontWeight: "800" },

  // ─── Home screen ────────────────────────────────────────────────────────
  profilePill: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
    marginBottom: 12,
  },
  profilePillAvatar: {
    width: 24, height: 24, borderRadius: 12,
    justifyContent: "center", alignItems: "center",
    marginRight: 8,
  },
  profilePillEmoji: { fontSize: 14 },
  profilePillName: { color: "#fff", fontWeight: "800", fontSize: 13, letterSpacing: 0.3 },
  profilePillChevron: { color: "rgba(255,255,255,0.85)", fontSize: 16, marginLeft: 8, fontWeight: "900" },
  homeHeader: { backgroundColor: "#1E3A8A", padding: 28, paddingTop: 20, alignItems: "center" },
  homeHeaderEyebrow: { color: "rgba(255,255,255,0.8)", fontWeight: "900", letterSpacing: 2, fontSize: 12, marginBottom: 6 },
  homeTitle: { color: "#fff", fontSize: 34, fontWeight: "900", letterSpacing: -0.5 },
  homeSubtitle: { color: "rgba(255,255,255,0.8)", fontWeight: "700", marginTop: 4, fontSize: 14 },
  statsBar: { flexDirection: "row", padding: 16, borderBottomWidth: 2, borderBottomColor: "#E5E5E5" },
  statBarValue: { fontSize: 18, fontWeight: "900", color: "#3C3C3C" },
  statBarLabel: { fontSize: 11, fontWeight: "700", color: "#AFAFAF" },
  tipCard: { margin: 16, marginTop: 14, backgroundColor: "#FFFBEA", borderRadius: 16, padding: 16, borderWidth: 2, borderColor: "#FFE066" },
  tipLabel: { fontSize: 10, fontWeight: "900", color: "#C8960C", letterSpacing: 1.5, marginBottom: 8 },
  tipText: { fontSize: 13, color: "#5C4A00", lineHeight: 20, fontWeight: "600", flex: 1 },
  sectionLabel: { fontSize: 13, fontWeight: "800", color: "#AFAFAF", letterSpacing: 1, marginBottom: 4 },
  quickCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 18, padding: 16, borderWidth: 2, borderColor: "#E5E5E5", borderBottomWidth: 4, borderBottomColor: "#E5E5E5" },
  quickIcon: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  quickTitle: { fontSize: 17, fontWeight: "900", color: "#3C3C3C" },
  quickDesc: { fontSize: 12, color: "#AFAFAF", fontWeight: "600", marginTop: 2 },
  quickArrow: { fontSize: 22, color: "#AFAFAF", fontWeight: "800" },
  unitCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff", borderRadius: 18, padding: 16, borderWidth: 2 },
  unitIcon: { width: 56, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  unitTitle: { fontSize: 16, fontWeight: "900", color: "#3C3C3C" },
  unitHebrew: { fontSize: 12, color: "#AFAFAF", fontWeight: "700" },
  unitDesc: { fontSize: 12, color: "#5C5C5C", marginTop: 4, lineHeight: 17 },
  unitXP: { fontSize: 12, fontWeight: "900" },
  achieveBtn: { marginHorizontal: 16, marginTop: 8, marginBottom: 4, flexDirection: "row", alignItems: "center", backgroundColor: "#F7F7F7", borderRadius: 16, padding: 16, borderWidth: 2, borderColor: "#E5E5E5" },
  achieveBtnTitle: { fontSize: 16, fontWeight: "800", color: "#3C3C3C" },
  achieveBtnSub: { fontSize: 12, color: "#AFAFAF", fontWeight: "600", marginTop: 2 },
  footer: { textAlign: "center", padding: 20, color: "#AFAFAF", fontSize: 11, fontWeight: "700" },

  // ─── Unit detail ────────────────────────────────────────────────────────
  unitHeader: { flexDirection: "row", alignItems: "center", padding: 16, paddingTop: 14 },
  unitHeaderTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },
  unitHeaderSub: { fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: "600", marginTop: 2 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backBtnText: { fontSize: 22, fontWeight: "800", color: "#fff" },
  startBtn: { padding: 18, borderRadius: 16, alignItems: "center", borderBottomWidth: 4, marginTop: 8 },
  startBtnText: { color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },

  // ─── Trope catalog ──────────────────────────────────────────────────────
  filterPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: "#F7F7F7", borderWidth: 2, borderColor: "#E5E5E5" },
  filterPillActive: { backgroundColor: "#B45309", borderColor: "#92400E" },
  filterPillText: { fontSize: 13, fontWeight: "800", color: "#5C5C5C" },
  mnemonicCard: { padding: 14, borderRadius: 14, borderWidth: 2, backgroundColor: "#FFFBEA" },
  mnemonicTitle: { fontSize: 14, fontWeight: "900", color: "#5C4A00", marginBottom: 8 },
  mnemonicRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
  strengthBar: { height: 8, borderRadius: 4, backgroundColor: "#B45309" },
  mnemonicEn: { fontSize: 13, fontWeight: "700", color: "#3C3C3C", width: 80 },
  mnemonicTrope: { fontSize: 13, color: "#5C5C5C", flex: 1 },
  systemsCard: { padding: 14, borderRadius: 14, borderWidth: 2, borderColor: "#E5E5E5", backgroundColor: "#F7F7F7" },
  tierHeader: { fontSize: 14, fontWeight: "900", color: "#3C3C3C", letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  tropeCard: { flexDirection: "row", gap: 14, padding: 14, borderRadius: 14, borderWidth: 2, backgroundColor: "#fff", marginBottom: 10 },
  tropeShape: { width: 60, height: 60, borderRadius: 12, backgroundColor: "#FFFBEA", alignItems: "center", justifyContent: "center" },
  tropeShapeChar: { fontSize: 36, fontWeight: "900", color: "#92400E" },
  tropeName: { fontSize: 16, fontWeight: "900", color: "#3C3C3C" },
  tropeHebrew: { fontSize: 14, color: "#5C5C5C", fontWeight: "700", marginTop: 1 },
  tropeTranslit: { fontSize: 12, color: "#AFAFAF", fontStyle: "italic", marginTop: 1 },
  tropeFunc: { fontSize: 12, color: "#3C3C3C", marginTop: 6, lineHeight: 17 },
  tropeFreq: { fontSize: 11, color: "#AFAFAF", fontWeight: "700" },

  // ─── Prayers ────────────────────────────────────────────────────────────
  prayerRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 2, backgroundColor: "#fff", marginBottom: 8 },
  prayerRowTitle: { fontSize: 15, fontWeight: "900", color: "#3C3C3C" },
  prayerRowDesc: { fontSize: 12, color: "#AFAFAF", fontWeight: "600", marginTop: 2 },
  prayerBigCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 2, borderColor: "#E5E5E5", backgroundColor: "#fff", marginBottom: 10 },
  prayerBigTitle: { fontSize: 17, fontWeight: "900", color: "#3C3C3C" },
  prayerBigHeb: { fontSize: 14, color: "#0EA5E9", fontWeight: "700", marginTop: 2 },
  prayerBigMeta: { fontSize: 11, color: "#AFAFAF", fontWeight: "600", marginTop: 4 },
  prayerViewCard: { padding: 16, borderRadius: 16, backgroundColor: "#F7F7F7", borderWidth: 2, borderColor: "#E5E5E5" },
  prayerViewLabel: { fontSize: 10, fontWeight: "900", color: "#AFAFAF", letterSpacing: 1.5, marginBottom: 4 },
  hebrewLarge: { fontSize: 24, fontWeight: "700", color: "#1E3A8A", lineHeight: 36 },
  prayerViewTranslit: { fontSize: 16, color: "#3C3C3C", fontStyle: "italic", lineHeight: 24 },
  prayerViewEnglish: { fontSize: 15, color: "#3C3C3C", lineHeight: 22, fontWeight: "500" },
  vocabCard: { padding: 14, borderRadius: 14, backgroundColor: "#F7F7F7", borderWidth: 2, borderColor: "#E5E5E5" },
  vocabChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: "#0EA5E9" },
  vocabChipText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  vocabRow: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: "#F7F7F7", borderRadius: 12, marginBottom: 8 },
  vocabHebrew: { width: 56, height: 56, borderRadius: 10, backgroundColor: "#0D9488", alignItems: "center", justifyContent: "center" },
  vocabHebText: { color: "#fff", fontSize: 24, fontWeight: "900" },
  vocabTranslit: { fontSize: 14, fontWeight: "800", color: "#3C3C3C" },
  vocabEnglish: { fontSize: 13, color: "#5C5C5C", marginTop: 1 },
  vocabGender: { fontSize: 11, color: "#AFAFAF", fontWeight: "700", marginTop: 2 },
  speakBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  speakBtnText: { fontSize: 22 },
  hearReference: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 2 },
  hearRefText: { fontWeight: "800", fontSize: 13 },

  // ─── Lesson screen ──────────────────────────────────────────────────────
  lessonScreen: { flex: 1, backgroundColor: "#fff" },
  exerciseLabel: { fontSize: 20, fontWeight: "800", color: "#3C3C3C", paddingHorizontal: 20, marginBottom: 16 },
  exerciseContainer: { paddingHorizontal: 20, gap: 16 },
  promptCard: { borderRadius: 20, padding: 24, alignItems: "center", borderWidth: 2 },
  promptQuestion: { fontSize: 19, fontWeight: "700", color: "#3C3C3C", textAlign: "center", lineHeight: 28 },
  promptWord: { fontWeight: "900", color: "#3C3C3C", textAlign: "center" },
  promptRomanized: { fontSize: 15, color: "#AFAFAF", marginTop: 6, fontStyle: "italic" },

  optionBtn: { padding: 16, borderRadius: 16, borderWidth: 2, borderColor: "#E5E5E5", backgroundColor: "#fff" },
  optionCorrect: { borderColor: "#58CC02", backgroundColor: "#D7FFB8" },
  optionWrong: { borderColor: "#FF4B4B", backgroundColor: "#FFD0D0" },
  optionText: { fontSize: 16, fontWeight: "700", color: "#3C3C3C" },

  fillText: { fontSize: 20, fontWeight: "700", color: "#3C3C3C", textAlign: "center", lineHeight: 34 },
  fillBlank: { fontWeight: "900", textDecorationLine: "underline" },

  matchInstruction: { fontSize: 14, fontWeight: "700", color: "#AFAFAF", textAlign: "center", marginBottom: 8 },
  matchTile: { padding: 14, borderRadius: 14, borderWidth: 2, borderColor: "#E5E5E5", backgroundColor: "#fff", alignItems: "center", minHeight: 56, justifyContent: "center" },
  matchText: { fontSize: 13, fontWeight: "700", color: "#3C3C3C", textAlign: "center" },
  matchMatched: { borderColor: "#E5E5E5", backgroundColor: "#F7F7F7", opacity: 0.4 },
  matchWrong: { borderColor: "#FF4B4B", backgroundColor: "#FFD0D0" },

  arrangeEnglish: { fontSize: 18, fontWeight: "800", color: "#3C3C3C", textAlign: "center", marginBottom: 6 },
  arrangeHint: { fontSize: 12, color: "#AFAFAF", fontWeight: "600", textAlign: "center", marginTop: 4 },
  arrangeZone: { minHeight: 64, borderRadius: 16, borderWidth: 2, borderColor: "#E5E5E5", backgroundColor: "#FAFAFA", padding: 12, justifyContent: "center" },
  arrangeCorrect: { borderColor: "#58CC02", backgroundColor: "#D7FFB8" },
  arrangeWrong: { borderColor: "#FF4B4B", backgroundColor: "#FFD0D0" },
  arrangePlaceholder: { color: "#AFAFAF", fontWeight: "600", textAlign: "center" },
  wordChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  wordChipText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  wordBankChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 2, borderColor: "#E5E5E5", backgroundColor: "#fff", borderBottomWidth: 3, borderBottomColor: "#E5E5E5" },
  wordBankChipText: { color: "#3C3C3C", fontWeight: "700", fontSize: 15 },
  submitBtn: { padding: 14, borderRadius: 14, alignItems: "center", borderBottomWidth: 4, marginTop: 4 },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },

  feedbackBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, borderTopWidth: 4 },
  feedbackTitle: { fontSize: 18, fontWeight: "900" },
  feedbackAnswer: { fontSize: 16, fontWeight: "700", color: "#3C3C3C", marginTop: 2 },
  funFact: { fontSize: 13, color: "#3C3C3C", opacity: 0.75, marginBottom: 12, lineHeight: 18 },
  continueBtn: { padding: 16, borderRadius: 16, alignItems: "center", borderBottomWidth: 4 },
  continueBtnText: { color: "#fff", fontSize: 17, fontWeight: "900", letterSpacing: 0.5 },

  // ─── Recitation screen (record + judge) ─────────────────────────────────
  recitationScreen: { flex: 1 },
  recitationTitle: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  recitationTitleText: { color: "#fff", fontWeight: "900", fontSize: 14, textAlign: "center" },
  reciteRefCard: { padding: 18, borderRadius: 18, backgroundColor: "#fff", borderWidth: 2 },
  reciteLabel: { fontSize: 10, fontWeight: "900", color: "#AFAFAF", letterSpacing: 1.5, marginBottom: 6 },
  reciteTranslit: { fontSize: 14, color: "#5C5C5C", fontStyle: "italic", marginTop: 10, lineHeight: 22 },
  reciteEnglish: { fontSize: 13, color: "#5C5C5C", marginTop: 10, lineHeight: 20, fontWeight: "500" },
  recordCard: { marginTop: 16, padding: 20, borderRadius: 18, borderWidth: 3, backgroundColor: "#fff", alignItems: "center" },
  recordLabel: { fontSize: 11, fontWeight: "900", color: "#AFAFAF", letterSpacing: 1.5 },
  recordBtn: { paddingVertical: 16, paddingHorizontal: 36, borderRadius: 16, marginTop: 12, borderBottomWidth: 4, borderBottomColor: "#CC1111" },
  recordBtnText: { color: "#fff", fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  recordedText: { fontSize: 16, fontWeight: "800", color: "#3C3C3C" },
  recordingText: { fontSize: 14, fontWeight: "700", color: "#FF4B4B", marginTop: 12 },
  recordingPulse: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#FF4B4B", marginTop: 12 },
  smallBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderBottomWidth: 3 },
  smallBtnText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  submitBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, borderTopWidth: 3 },

  // ─── Result screen ──────────────────────────────────────────────────────
  resultScreen: { flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", padding: 24, gap: 20 },
  resultTitle: { fontSize: 32, fontWeight: "900", color: "#3C3C3C", marginTop: 8 },
  resultSubtitle: { fontSize: 16, color: "#AFAFAF", fontWeight: "700" },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, backgroundColor: "#F7F7F7", borderRadius: 16, padding: 16, alignItems: "center", borderWidth: 2, borderColor: "#E5E5E5" },
  statValue: { fontSize: 22, fontWeight: "900", marginTop: 4 },
  statLabel: { fontSize: 11, fontWeight: "700", color: "#AFAFAF", marginTop: 2 },
  primaryBtn: { padding: 16, borderRadius: 16, alignItems: "center", borderBottomWidth: 4 },
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "900" },
  secondaryBtn: { padding: 16, borderRadius: 16, alignItems: "center", borderWidth: 2, borderColor: "#E5E5E5", borderBottomWidth: 4, borderBottomColor: "#E5E5E5" },
  secondaryBtnText: { color: "#AFAFAF", fontSize: 17, fontWeight: "900" },
  achievementUnlock: { width: "100%", backgroundColor: "#FFF8E1", borderRadius: 16, padding: 16, borderWidth: 2, borderColor: "#FFD700" },
  achievementUnlockTitle: { fontSize: 15, fontWeight: "900", color: "#856300", marginBottom: 10 },
  achievementRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  achievementName: { fontSize: 14, fontWeight: "800", color: "#3C3C3C" },
  achievementDesc: { fontSize: 12, color: "#AFAFAF", fontWeight: "600" },
  transcriptCard: { width: "100%", backgroundColor: "#F0F9FF", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#7DD3FC" },
  transcriptLabel: { fontSize: 11, fontWeight: "800", color: "#0369A1", marginBottom: 6, letterSpacing: 0.5 },
  transcriptText: { fontSize: 16, color: "#0C4A6E", fontWeight: "600", lineHeight: 22 },

  // ─── Achievements screen ────────────────────────────────────────────────
  achieveHeader: { flexDirection: "row", alignItems: "center", padding: 16, paddingTop: 12, borderBottomWidth: 2, borderBottomColor: "#E5E5E5" },
  achieveHeaderTitle: { flex: 1, fontSize: 20, fontWeight: "900", color: "#3C3C3C", textAlign: "center" },
  achieveHeaderCount: { fontSize: 14, fontWeight: "800", color: "#AFAFAF" },
  achieveSectionLabel: { fontSize: 11, fontWeight: "900", color: "#AFAFAF", letterSpacing: 1.5, marginBottom: 10 },
  achieveCard: { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 14, borderWidth: 2 },
  achieveCardUnlocked: { backgroundColor: "#F0FDE8", borderColor: "#58CC02" },
  achieveCardLocked: { backgroundColor: "#F7F7F7", borderColor: "#E5E5E5" },
  achieveCardName: { fontSize: 15, fontWeight: "800", color: "#3C3C3C" },
  achieveCardDesc: { fontSize: 12, color: "#AFAFAF", fontWeight: "600", marginTop: 2 },
});
