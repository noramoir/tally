// ═══════════════════════════════════════════════════
// CONFIG — Edit this file for settings & game tuning
// ═══════════════════════════════════════════════════

// Supabase credentials
var SUPABASE_URL = "https://lijgbsxjatfzewogznwg.supabase.co";
var SUPABASE_ANON = "sb_publishable_Rll9McjZsM2fPYoYdXnMAA_j0Y37bHO";

// ─── Colour Palette ──────────────────────────────
// Change these to restyle the entire app
var PALETTE = {
  bg:     "#8C9EFF",
  card:   "#FCD9BE",
  lime:   "#D6F74C",
  tomato: "#F06038",
  ink:    "#1a1a1a",
  muted:  "#6b5a4e",
  white:  "#ffffff",
};

// ─── Team Colours ────────────────────────────────
var TEAM_COLORS = [PALETTE.tomato, "#3498db", "#2ecc71", "#f39c12"];
var TEAM_COLORS_LIGHT = ["#f8a898", "#aed6f1", "#a9dfbf", "#fdebd0"];
var TEAM_EMOJIS = ["🔴", "🔵", "🟢", "🟡"];

// ─── Built-in Games ──────────────────────────────
// Add/remove/edit games here. "custom" must always exist.
var BUILT_IN_GAMES = {
  catan: {
    name: "Catan",
    emoji: "🏝️",
    tier: 3,
    categories: ["Settlements", "Cities", "Longest Road", "Largest Army", "Dev Cards", "Special VP"],
  },
  wingspan: {
    name: "Wingspan",
    emoji: "🐦",
    tier: 4,
    categories: ["Birds", "Bonus Cards", "End-of-Round Goals", "Eggs", "Food on Cards", "Tucked Cards"],
  },
  scrabble: {
    name: "Scrabble",
    emoji: "🔡",
    tier: 3,
    categories: ["Round 1", "Round 2", "Round 3", "Round 4", "Round 5", "Round 6", "Round 7", "Round 8", "Tile Penalty"],
  },
  custom: {
    name: "Custom",
    emoji: "🎲",
    categories: [],
  },
};

// ─── Tier Overrides for Custom Games ─────────────
// Key = exact game name as it appears in your game list
// Value = tier number (1-5)
// Games not listed here default to 3
var TIER_OVERRIDES = {
  // "Monopoly": 5,
  // "Uno": 2,
};

// ─── Emoji Picker Options ────────────────────────
var EMOJI_OPTIONS = [
  "🎲","🃏","♟","🎯","🧩","🎮","🏆","🌍","🐉","🚂",
  "🏰","🌿","⚔","🔮","🎪","🦁","🚀","🍀","🎠","💎",
  "🫘","🐱","🌸","🏟️","🌈","🐰",
];

// ─── Leaderboard Formula ─────────────────────────
// Top Player score = winRate * WIN_WEIGHT + volume * VOLUME_WEIGHT
var WIN_WEIGHT = 0.6;
var VOLUME_WEIGHT = 0.4;

// Independent scoring (high-wins): effective = avg * min(1, count/cap)
// Independent scoring (low-wins):  effective = avg + (maxScore - avg) * (1 - min(1, count/cap))
var INDIE_VOLUME_CAP = 10;

// Default tier for games without one set
var DEFAULT_TIER = 3;

// Default max score for independent scoring games
var DEFAULT_MAX_SCORE = 50;
