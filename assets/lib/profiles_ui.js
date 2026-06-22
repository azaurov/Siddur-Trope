// Profile management screens for Siddur & Trope.
// Two screens:
//   1. ProfileSelectScreen — landing picker (existing profiles + "Add new")
//   2. ProfileCreateScreen — name + avatar + color picker for new profile
//
// Plus a small switcher UI to call from the Home header.
//
// All UI lives in this single file to match the project's single-file App.js
// style. Designed to feel native to the existing home screen (navy header,
// cream cards, gold accents).

import React, { useState } from "react";
import {
  SafeAreaView, View, Text, ScrollView, TouchableOpacity, TextInput,
  StatusBar, StyleSheet, Alert, Modal, Pressable,
} from "react-native";
import {
  createProfile, deleteProfile, updateProfile,
  DEFAULT_AVATARS, DEFAULT_COLORS, bumpStreak,
} from "./profiles";

// ── Profile Select Screen ──────────────────────────────────────────────────
export function ProfileSelectScreen({ profiles, activeId, onSelectProfile, onCreateNew, onDeleteProfile }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="light-content" backgroundColor="#1E3A8A" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.header}>
          <Text style={styles.headerEyebrow}>SIDDUR & TROPE</Text>
          <Text style={styles.headerTitle}>Who's studying?</Text>
          <Text style={styles.headerSubtitle}>
            {profiles.length === 0
              ? "Create your first profile to begin."
              : "Pick a profile, or add a new one."}
          </Text>
        </View>

        {profiles.length === 0 ? null : (
          <View style={{ padding: 16, paddingTop: 24 }}>
            {profiles.map((p) => (
              <ProfileRow
                key={p.id}
                profile={p}
                isActive={p.id === activeId}
                onPress={() => onSelectProfile(p.id)}
                onLongPress={() => confirmDelete(p, onDeleteProfile)}
              />
            ))}
          </View>
        )}

        <View style={{ padding: 16, paddingTop: profiles.length === 0 ? 32 : 0 }}>
          <TouchableOpacity style={styles.addBtn} onPress={onCreateNew}>
            <Text style={styles.addBtnIcon}>＋</Text>
            <Text style={styles.addBtnText}>Add new profile</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileRow({ profile, isActive, onPress, onLongPress }) {
  const { name, avatar, color, stats } = profile;
  const xp = stats?.totalXP || 0;
  const lessons = stats?.lessons || 0;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.profileRow,
        isActive && { borderColor: color, borderWidth: 3 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: color }]}>
        <Text style={styles.avatarEmoji}>{avatar}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 16 }}>
        <Text style={styles.profileName}>{name}</Text>
        <Text style={styles.profileStats}>
          ⚡ {xp} XP · 🎓 {lessons} lessons
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function confirmDelete(profile, onDeleteProfile) {
  Alert.alert(
    "Delete profile?",
    `Permanently delete "${profile.name}" and all their progress? This cannot be undone.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => onDeleteProfile(profile.id),
      },
    ]
  );
}

// ── Profile Create Screen ─────────────────────────────────────────────────
export function ProfileCreateScreen({ onCancel, onCreated, initial }) {
  const isEditing = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [avatar, setAvatar] = useState(initial?.avatar || DEFAULT_AVATARS[0]);
  const [color, setColor] = useState(initial?.color || DEFAULT_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Name required", "Please enter a name for this profile.");
      return;
    }
    setSaving(true);
    try {
      if (isEditing) {
        const next = await updateProfile(initial.id, { name: name.trim(), avatar, color });
        onCreated(next, true);
      } else {
        const next = await createProfile({ name: name.trim(), avatar, color });
        onCreated(next, false);
      }
    } catch (err) {
      console.warn("[profiles] save failed:", err);
      Alert.alert("Could not save", String(err?.message || err));
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="light-content" backgroundColor="#1E3A8A" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.header}>
          <Text style={styles.headerEyebrow}>{isEditing ? "EDIT PROFILE" : "NEW PROFILE"}</Text>
          <Text style={styles.headerTitle}>{isEditing ? "Edit profile" : "New profile"}</Text>
          <Text style={styles.headerSubtitle}>
            Each profile keeps its own progress.
          </Text>
        </View>

        <View style={{ padding: 20, alignItems: "center" }}>
          <View style={[styles.previewAvatar, { backgroundColor: color }]}>
            <Text style={styles.previewAvatarEmoji}>{avatar}</Text>
          </View>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder="Name (e.g. David, Sarah)"
            placeholderTextColor="#9CA3AF"
            maxLength={30}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Avatar</Text>
          <View style={styles.pickerGrid}>
            {DEFAULT_AVATARS.map((emo) => (
              <TouchableOpacity
                key={emo}
                onPress={() => setAvatar(emo)}
                style={[styles.avatarChoice, emo === avatar && { borderColor: color, borderWidth: 3 }]}
              >
                <Text style={styles.avatarChoiceEmoji}>{emo}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Color</Text>
          <View style={styles.pickerGrid}>
            {DEFAULT_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setColor(c)}
                style={[
                  styles.colorChoice,
                  { backgroundColor: c },
                  c === color && { borderColor: "#1F2937", borderWidth: 4 },
                ]}
              />
            ))}
          </View>
        </View>

        <View style={{ padding: 20, paddingTop: 8, flexDirection: "row", gap: 12 }}>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={onCancel} disabled={saving}>
            <Text style={[styles.btnText, { color: "#1E3A8A" }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, { backgroundColor: color }, saving && { opacity: 0.5 }]} onPress={handleSave} disabled={saving}>
            <Text style={[styles.btnText, { color: "#fff" }]}>
              {saving ? "Saving…" : isEditing ? "Save changes" : "Create profile"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Profile Switcher Modal ─────────────────────────────────────────────────
// Small overlay launched from the Home header to switch profiles without
// returning to the full picker.
export function ProfileSwitcherModal({ visible, profiles, activeId, onClose, onSwitch, onAddNew, onDelete }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Switch profile</Text>
          {profiles.map((p) => (
            <ProfileRow
              key={p.id}
              profile={p}
              isActive={p.id === activeId}
              onPress={() => { onSwitch(p.id); onClose(); }}
              onLongPress={() => confirmDelete(p, onDelete)}
            />
          ))}
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => { onClose(); onAddNew(); }}
          >
            <Text style={styles.addBtnIcon}>＋</Text>
            <Text style={styles.addBtnText}>Add new profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={onClose}>
            <Text style={[styles.btnText, { color: "#1E3A8A" }]}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    backgroundColor: "#1E3A8A",
    padding: 28, paddingTop: 20, alignItems: "center",
  },
  headerEyebrow: {
    color: "rgba(255,255,255,0.8)", fontWeight: "900",
    letterSpacing: 2, fontSize: 12, marginBottom: 6,
  },
  headerTitle: {
    color: "#fff", fontSize: 28, fontWeight: "900", letterSpacing: -0.5,
  },
  headerSubtitle: {
    color: "rgba(255,255,255,0.85)", fontWeight: "700", marginTop: 6,
    fontSize: 13, textAlign: "center",
  },

  // Profile row (in picker + switcher)
  profileRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#F9FAFB", borderRadius: 16,
    padding: 16, marginBottom: 12, borderWidth: 2, borderColor: "#E5E7EB",
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    justifyContent: "center", alignItems: "center",
  },
  avatarEmoji: { fontSize: 28 },
  profileName: { fontSize: 18, fontWeight: "800", color: "#1F2937" },
  profileStats: { fontSize: 13, color: "#6B7280", marginTop: 4, fontWeight: "600" },
  chevron: { fontSize: 32, color: "#9CA3AF", fontWeight: "300", paddingHorizontal: 8 },

  // Add button
  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#EFF6FF", borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 20,
    borderWidth: 2, borderColor: "#BFDBFE", borderStyle: "dashed",
  },
  addBtnIcon: { fontSize: 22, color: "#1E3A8A", fontWeight: "900", marginRight: 8 },
  addBtnText: { fontSize: 16, fontWeight: "800", color: "#1E3A8A" },

  // Create / edit screen
  previewAvatar: {
    width: 96, height: 96, borderRadius: 48,
    justifyContent: "center", alignItems: "center",
    marginBottom: 20, shadowColor: "#000", shadowOpacity: 0.15,
    shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  previewAvatarEmoji: { fontSize: 48 },
  nameInput: {
    width: "100%", paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: "#F3F4F6", borderRadius: 12,
    fontSize: 17, fontWeight: "700", color: "#1F2937",
    borderWidth: 2, borderColor: "#E5E7EB",
    textAlign: "center",
  },

  section: { padding: 20, paddingTop: 4, paddingBottom: 4 },
  sectionTitle: {
    fontSize: 12, fontWeight: "900", color: "#6B7280",
    letterSpacing: 1.5, marginBottom: 12,
  },
  pickerGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 10,
  },
  avatarChoice: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center",
    borderWidth: 2, borderColor: "transparent",
  },
  avatarChoiceEmoji: { fontSize: 28 },
  colorChoice: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: "transparent",
  },

  btn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  btnSecondary: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#EFF6FF",
  },
  btnText: { fontSize: 16, fontWeight: "800" },

  // Modal switcher
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 32,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20, fontWeight: "900", color: "#1F2937",
    marginBottom: 16, textAlign: "center",
  },
});