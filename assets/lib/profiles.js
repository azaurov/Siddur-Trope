// Local-only profile storage for Siddur & Trope.
// Each profile has its own stats, achievements, and lesson progress.
//
// Persistence: @react-native-async-storage/async-storage
// Storage layout (single JSON blob):
//   @siddur-trope:profiles     -> [{id, name, avatar, color, createdAt, stats, achievements}, ...]
//   @siddur-trope:activeId     -> "uuid" of last-selected profile (string | null)
//
// No backend, no sync — this is intentionally offline-only.

import AsyncStorage from "@react-native-async-storage/async-storage";

const PROFILES_KEY = "@siddur-trope:profiles";
const ACTIVE_KEY   = "@siddur-trope:activeId";

// ── Default profile factory ─────────────────────────────────────────────────
export const DEFAULT_AVATARS = [
  "🕎", "✡️", "📖", "🌟", "🕊️", "🔥", "🌙",
  "👤", "👩", "👨", "🧑", "👴", "👵", "🧒",
  "🎓", "📚", "✨", "💫", "🌿", "🍇",
];

export const DEFAULT_COLORS = [
  "#1E3A8A", // navy (default)
  "#7C2D12", // sienna
  "#065F46", // emerald
  "#7C3AED", // violet
  "#B91C1C", // crimson
  "#0369A1", // ocean blue
  "#A16207", // ochre
  "#581C87", // royal purple
];

export const DEFAULT_STATS = {
  streak: 0,
  totalXP: 0,
  lessons: 0,
  perfectLessons: 0,
  trope_correct: 0,
  recordings: 0,
  units_completed: 0,
  units_completed_set: [],
  lastActiveDate: null,
};

function uuid() {
  // RFC 4122 v4-ish — good enough for local IDs. Not cryptographic.
  return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function makeProfile({ name, avatar, color }) {
  const now = Date.now();
  return {
    id: uuid(),
    name: (name || "").trim() || "Student",
    avatar: avatar || "📖",
    color: color || DEFAULT_COLORS[0],
    createdAt: now,
    stats: { ...DEFAULT_STATS },
    achievements: [],
  };
}

// ── Storage operations ──────────────────────────────────────────────────────
export async function loadProfiles() {
  try {
    const raw = await AsyncStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[profiles] loadProfiles failed:", err);
    return [];
  }
}

export async function saveProfiles(profiles) {
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export async function loadActiveId() {
  try {
    return await AsyncStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export async function saveActiveId(id) {
  if (id == null) {
    await AsyncStorage.removeItem(ACTIVE_KEY);
  } else {
    await AsyncStorage.setItem(ACTIVE_KEY, id);
  }
}

// ── CRUD helpers ────────────────────────────────────────────────────────────
export async function createProfile({ name, avatar, color }) {
  const profiles = await loadProfiles();
  const profile = makeProfile({ name, avatar, color });
  profiles.push(profile);
  await saveProfiles(profiles);
  await saveActiveId(profile.id);
  return profile;
}

export async function updateProfile(id, patch) {
  const profiles = await loadProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const next = {
    ...profiles[idx],
    ...patch,
    // Don't let callers accidentally clobber stats or achievements;
    // those go through dedicated helpers.
    stats: profiles[idx].stats,
    achievements: profiles[idx].achievements,
  };
  profiles[idx] = next;
  await saveProfiles(profiles);
  return next;
}

export async function deleteProfile(id) {
  const profiles = await loadProfiles();
  const next = profiles.filter((p) => p.id !== id);
  await saveProfiles(next);
  const active = await loadActiveId();
  if (active === id) {
    await saveActiveId(next[0]?.id ?? null);
  }
  return next;
}

// Update the stats object of one profile (called from App.js on lesson completion).
// IMPORTANT: callers should pass the COMPLETE new stats object (not a partial
// patch), because we replace `stats` wholesale rather than merging — this avoids
// the race where two near-simultaneous writes overwrite each other's fields
// via stale snapshots.
export async function updateProfileStats(id, newStats) {
  const profiles = await loadProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  profiles[idx] = {
    ...profiles[idx],
    stats: { ...newStats },
  };
  await saveProfiles(profiles);
  return profiles[idx];
}

// Update the achievements array of one profile. Same rule as updateProfileStats:
// pass the complete new array, not a partial.
export async function setProfileAchievements(id, achievements) {
  const profiles = await loadProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  profiles[idx] = {
    ...profiles[idx],
    achievements: Array.isArray(achievements) ? achievements : [],
  };
  await saveProfiles(profiles);
  return profiles[idx];
}

// Atomic combined write: load once, apply both mutations, save once.
// All writes to the profiles blob go through this function so that near-
// simultaneous calls (e.g. stats + achievements from one lesson completion)
// are serialized through a single in-memory mutex queue. Without this,
// two concurrent loads could each read the same stale snapshot and the second
// writer would silently overwrite the first writer's fields.
//
// Returns the updated profile.
let _writeQueue = Promise.resolve();
export async function updateProfileAtomic(id, mut) {
  const next = (async () => {
    const profiles = await loadProfiles();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const patch = {};
    if (mut.stats !== undefined)             patch.stats        = { ...mut.stats };
    if (mut.achievements !== undefined)      patch.achievements = Array.isArray(mut.achievements) ? mut.achievements : [];
    profiles[idx] = { ...profiles[idx], ...patch };
    await saveProfiles(profiles);
    return profiles[idx];
  })();
  // Chain: the new write waits for the previous one to finish, then runs.
  // We don't propagate errors from older writes to newer ones; each writes
  // own promise resolves independently.
  _writeQueue = _writeQueue.then(() => next, () => next);
  return _writeQueue;
}

// ── One-time migration: if no profiles exist but legacy stats are around ──
// (Currently no migration is needed because stats were in-memory only.
//  Future-proof: this function is a placeholder.)
export async function migrateLegacyIfNeeded() {
  // No-op: original app never persisted stats. Returning profiles-as-is.
  return await loadProfiles();
}

// ── Streak helpers ──────────────────────────────────────────────────────────
// "Streak" means consecutive days with at least one lesson completed.
// Returns the new streak value.
export function bumpStreak(currentStreak, lastActiveDate) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (lastActiveDate === today) {
    // Already counted today — no change.
    return { streak: currentStreak, lastActiveDate: today };
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (lastActiveDate === yesterday) {
    // Continuing streak.
    return { streak: currentStreak + 1, lastActiveDate: today };
  }
  // First activity, or streak was broken.
  return { streak: 1, lastActiveDate: today };
}