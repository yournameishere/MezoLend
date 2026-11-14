"use client";

import { useSyncExternalStore } from "react";

/** Minimal external store with optional localStorage persistence. */
function createStore<T>(initial: T, persistKey?: string) {
  let state = initial;
  let hydrated = false;
  const listeners = new Set<() => void>();

  const hydrate = () => {
    if (hydrated || !persistKey || typeof window === "undefined") return;
    hydrated = true;
    try {
      const raw = window.localStorage.getItem(persistKey);
      if (raw) state = { ...initial, ...JSON.parse(raw) };
    } catch {
      /* storage blocked — run in-memory */
    }
  };

  return {
    get: () => {
      hydrate();
      return state;
    },
    set: (next: T | ((s: T) => T)) => {
      hydrate();
      state = typeof next === "function" ? (next as (s: T) => T)(state) : next;
      if (persistKey && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(persistKey, JSON.stringify(state));
        } catch {
          /* ignore */
        }
      }
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    serverSnapshot: initial,
  };
}

function useStore<T, S>(store: ReturnType<typeof createStore<T>>, select: (s: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.serverSnapshot),
  );
}

// ───────────────────────── Toasts ─────────────────────────

export type Tone = "info" | "success" | "error" | "warning";
export type Toast = { id: string; tone: Tone; title: string; body?: string; hash?: string };

const toastStore = createStore<{ items: Toast[] }>({ items: [] });

export function toast(t: Omit<Toast, "id">, ttl = 6000) {
  const id = Math.random().toString(36).slice(2);
  toastStore.set((s) => ({ items: [...s.items.slice(-3), { ...t, id }] }));
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
  return id;
}
export function dismissToast(id: string) {
  toastStore.set((s) => ({ items: s.items.filter((x) => x.id !== id) }));
}
export const useToasts = () => useStore(toastStore, (s) => s.items);

// ───────────────────────── Notifications (persisted) ─────────────────────────

export type Notice = {
  id: string;
  ts: number;
  account: string;
  kind: "tx" | "alert";
  tone: Tone;
  title: string;
  body?: string;
  hash?: string;
  read: boolean;
};

const noticeStore = createStore<{ items: Notice[] }>({ items: [] }, "mezolend.notices.v1");

export function pushNotice(n: Omit<Notice, "id" | "ts" | "read">) {
  const item: Notice = { ...n, id: Math.random().toString(36).slice(2), ts: Date.now(), read: false };
  noticeStore.set((s) => ({ items: [item, ...s.items].slice(0, 100) }));
  const settings = settingsStore.get();
  if (settings.browserAlerts && typeof window !== "undefined" && "Notification" in window) {
    try {
      if (Notification.permission === "granted" && document.visibilityState !== "visible") {
        new Notification(`MezoLend · ${item.title}`, { body: item.body, tag: item.id });
      }
    } catch {
      /* unsupported */
    }
  }
}
export function markAllRead(account?: string) {
  noticeStore.set((s) => ({
    items: s.items.map((n) => (!account || n.account === account ? { ...n, read: true } : n)),
  }));
}
export function clearNotices(account?: string) {
  noticeStore.set((s) => ({ items: account ? s.items.filter((n) => n.account !== account) : [] }));
}
const EMPTY: Notice[] = [];
export function useNotices(account?: string) {
  const all = useStore(noticeStore, (s) => s.items);
  if (!account) return EMPTY;
  return all.filter((n) => n.account === account.toLowerCase());
}
// filter above allocates per render; stable enough for small lists

// ───────────────────────── Settings (persisted) ─────────────────────────

export type Settings = {
  marketId: number;
  warnHF: number;
  criticalHF: number;
  utilizationAlert: number; // 0..1
  browserAlerts: boolean;
};

export const settingsStore = createStore<Settings>(
  { marketId: 0, warnHF: 1.5, criticalHF: 1.15, utilizationAlert: 0.9, browserAlerts: false },
  "mezolend.settings.v1",
);
export const useSettings = () => useStore(settingsStore, (s) => s);
export const setSettings = (patch: Partial<Settings>) => settingsStore.set((s) => ({ ...s, ...patch }));

// ───────────────────────── Alert memory (avoid repeat alerts) ─────────────────────────

const alertMemory = createStore<Record<string, string>>({}, "mezolend.alertmemory.v1");
export function rememberAlert(key: string, level: string): boolean {
  const prev = alertMemory.get()[key];
  if (prev === level) return false;
  alertMemory.set((s) => ({ ...s, [key]: level }));
  return true;
}
