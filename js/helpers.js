// ═══════════════════════════════════════════════════
// HELPERS — Core logic, leaderboard, game creation
// Uses variables from config.js (loaded first)
// ═══════════════════════════════════════════════════

// Shorthand references from config
var C = PALETTE;
var TC = TEAM_COLORS;
var TCL = TEAM_COLORS_LIGHT;
var TE = TEAM_EMOJIS;

// ─── Supabase ────────────────────────────────────
var sb = null;
try {
  if (SUPABASE_URL !== "YOUR_SUPABASE_URL_HERE")
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
} catch(e) {}

// ─── PIN Hashing ─────────────────────────────────
// Converts plain text PIN to SHA-256 hash
// Old plain-text PINs are auto-migrated on login
async function hashPin(pin) {
  var encoder = new TextEncoder();
  var data = encoder.encode(pin);
  var hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

// Check if a stored PIN is already hashed (64 hex chars = SHA-256)
function isHashed(pin) {
  return typeof pin === 'string' && pin.length === 64 && /^[0-9a-f]+$/.test(pin);
}

async function dbLoad(c) {
  if (!sb) return null;
  try {
    const { data } = await sb.from("family_games").select("games").eq("family_code", c).single();
    return data?.games || null;
  } catch { return null; }
}
async function dbSave(c, g) {
  if (!sb) return;
  try {
    await sb.from("family_games").upsert(
      { family_code: c, games: g, updated_at: new Date().toISOString() },
      { onConflict: "family_code" }
    );
  } catch {}
}
async function dbLoadUser(u) { return dbLoad("user_" + u); }
async function dbSaveUser(u, d) { return dbSave("user_" + u, d); }

// ═══ NEW DATABASE LAYER (tally_* tables) ═══
// Set USE_NEW_DB = true once you've verified migration
var USE_NEW_DB = true;

var db2 = {
  // ── Users ──
  async getUser(username) {
    if (!sb) return null;
    try {
      const { data } = await sb.from("tally_users").select("*").eq("username", username).single();
      return data;
    } catch { return null; }
  },
  async createUser(username, pinHash, displayName) {
    if (!sb) return null;
    try {
      const { data } = await sb.from("tally_users").insert({ username, pin_hash: pinHash, display_name: displayName }).select().single();
      return data;
    } catch { return null; }
  },
  async updateUser(username, updates) {
    if (!sb) return;
    try { await sb.from("tally_users").update(updates).eq("username", username); } catch {}
  },

  // ── Families ──
  async getOrCreateFamily(code) {
    if (!sb) return null;
    try {
      const { data: existing } = await sb.from("tally_families").select("*").eq("code", code).single();
      if (existing) return existing;
      const { data } = await sb.from("tally_families").insert({ code }).select().single();
      return data;
    } catch {
      try { const { data } = await sb.from("tally_families").select("*").eq("code", code).single(); return data; } catch { return null; }
    }
  },
  async getFamilyByCode(code) {
    if (!sb) return null;
    try { const { data } = await sb.from("tally_families").select("*").eq("code", code).single(); return data; } catch { return null; }
  },

  // ── Family Members ──
  async getFamilyMembers(familyId) {
    if (!sb) return [];
    try {
      const { data } = await sb.from("tally_family_members").select("*, tally_users(username, display_name)").eq("family_id", familyId);
      return data || [];
    } catch { return []; }
  },
  async joinFamily(userId, familyId, displayName) {
    if (!sb) return;
    try {
      await sb.from("tally_family_members").upsert(
        { user_id: userId, family_id: familyId, display_name: displayName, role: "member" },
        { onConflict: "user_id,family_id" }
      );
    } catch {}
  },
  async leaveFamily(userId, familyId) {
    if (!sb) return;
    try { await sb.from("tally_family_members").delete().eq("user_id", userId).eq("family_id", familyId); } catch {}
  },
  async updateMemberDisplayName(userId, familyId, displayName) {
    if (!sb) return;
    try { await sb.from("tally_family_members").update({ display_name: displayName }).eq("user_id", userId).eq("family_id", familyId); } catch {}
  },
  async getUserFamilies(userId) {
    if (!sb) return [];
    try {
      const { data } = await sb.from("tally_family_members").select("family_id, display_name, role, tally_families(code)").eq("user_id", userId);
      return data || [];
    } catch { return []; }
  },

  // ── Templates ──
  async getTemplates(familyId) {
    if (!sb) return [];
    try { const { data } = await sb.from("tally_templates").select("*").eq("family_id", familyId); return data || []; } catch { return []; }
  },
  async upsertTemplate(familyId, templateKey, template) {
    if (!sb) return;
    try {
      await sb.from("tally_templates").upsert({
        family_id: familyId,
        template_key: templateKey,
        name: template.name || template.gameName || templateKey,
        emoji: template.emoji || "🎲",
        game_key: template.gameKey || "custom",
        categories: template.categories || [],
        scoring_type: template.scoringType || "standard",
        tier: template.tier || 3,
        max_score: template.maxScore || null,
        low_wins: template.lowWins || false,
      }, { onConflict: "family_id,template_key" });
    } catch {}
  },
  async deleteTemplate(familyId, templateKey) {
    if (!sb) return;
    try { await sb.from("tally_templates").delete().eq("family_id", familyId).eq("template_key", templateKey); } catch {}
  },

  // ── Games ──
  async getGames(familyId) {
    if (!sb) return [];
    try {
      const { data } = await sb.from("tally_games").select("*").eq("family_id", familyId).order("finished_at", { ascending: false, nullsFirst: false });
      return (data || []).map(db2.gameFromRow);
    } catch { return []; }
  },
  async saveGame(familyId, game) {
    if (!sb) return;
    try {
      const existing = await sb.from("tally_games").select("id").eq("original_id", game.id).eq("family_id", familyId).maybeSingle();
      if (existing?.data) {
        await sb.from("tally_games").update(db2.gameToRow(game)).eq("id", existing.data.id);
      } else {
        await sb.from("tally_games").insert(Object.assign({ family_id: familyId }, db2.gameToRow(game)));
      }
    } catch {}
  },
  async deleteGame(familyId, originalId) {
    if (!sb) return;
    try { await sb.from("tally_games").delete().eq("original_id", originalId).eq("family_id", familyId); } catch {}
  },
  async saveAllGames(familyId, games) {
    // Bulk sync: used for claims/renames that touch many games
    if (!sb) return;
    for (var i = 0; i < games.length; i++) {
      await db2.saveGame(familyId, games[i]);
    }
  },

  // ── Row Converters ──
  gameToRow: function(g) {
    return {
      original_id: g.id,
      game_name: g.gameName || "Game",
      emoji: g.emoji || "🎲",
      game_key: g.gameKey || "custom",
      categories: g.categories || [],
      players: g.players || [],
      team_mode: g.teamMode || false,
      teams: g.teams || null,
      scoring_type: g.scoringType || "standard",
      tier: g.tier || 3,
      max_score: g.maxScore || null,
      low_wins: g.lowWins || false,
      finished: g.finished || false,
      started_at: g.startedAt || null,
      finished_at: g.finishedAt || null,
    };
  },
  gameFromRow: function(r) {
    return {
      id: r.original_id || r.id,
      gameName: r.game_name,
      emoji: r.emoji,
      gameKey: r.game_key,
      categories: r.categories,
      players: r.players,
      teamMode: r.team_mode,
      teams: r.teams,
      scoringType: r.scoring_type,
      tier: r.tier,
      maxScore: r.max_score,
      lowWins: r.low_wins,
      finished: r.finished,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    };
  },
};

// ─── Shared Styles ───────────────────────────────
var S = {
  card: { background: C.card, border: "2px solid " + C.ink, borderRadius: 14, boxShadow: "3px 3px 0 " + C.ink },
  limeCard: { background: C.lime, border: "2px solid " + C.ink, borderRadius: 14, boxShadow: "3px 3px 0 " + C.ink },
};
var secHead = { fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: C.muted, marginBottom: 10, fontFamily: "'Courier New',monospace" };
var inp = { width: "100%", background: "#fff", border: "2px solid " + C.ink, borderRadius: 10, color: C.ink, padding: "12px 14px", fontSize: 15, boxSizing: "border-box", fontFamily: "'Courier New',monospace" };

// ─── Utility Functions ───────────────────────────
var calcTotal = function(p) {
  return p?.scores ? Object.values(p.scores).reduce(function(s, v) { return s + (parseFloat(v) || 0); }, 0) : 0;
};

var fmtTime = function(s) {
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, '0');
};

function medal(r) {
  return r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : r + ".";
}

function getRanks(a, fn) {
  var r = [];
  for (var i = 0; i < a.length; i++) {
    if (i === 0) r.push(1);
    else if (Math.abs(fn(a[i]) - fn(a[i-1])) < 0.001) r.push(r[i-1]);
    else r.push(i + 1);
  }
  return r;
}

function pkey(p) { return p.userId || p.name; }

function rname(p, fu) {
  if (p.userId && fu[p.userId]) return fu[p.userId].displayName;
  return p.name;
}

function gameName(g) {
  // Priority: explicit gameName > customName > template lookup > gameKey (if not "custom") > fallback
  if (g.gameName && g.gameName !== "Game" && g.gameName !== "Custom Game") return g.gameName;
  if (g.customName) return g.customName;
  if (BUILT_IN_GAMES[g.gameKey] && g.gameKey !== "custom") return BUILT_IN_GAMES[g.gameKey].name;
  if (g.gameKey && g.gameKey !== "custom") return g.gameKey;
  if (g.gameName) return g.gameName;
  return "Game";
}

function gameEmoji(g) {
  return g.emoji || (BUILT_IN_GAMES[g.gameKey] ? BUILT_IN_GAMES[g.gameKey].emoji : null) || "🎲";
}

function getFreqPlayers(hist, uid, n) {
  if (!uid) return [];
  var ct = {};
  hist.slice(0, 15).forEach(function(g) {
    var allP = g.teamMode && g.teams ? g.teams.flatMap(function(t) { return t.members; }) : g.players.map(function(p) { return p.name; });
    if (!g.players.some(function(p) { return p.userId === uid; }) && !allP.includes(uid)) return;
    allP.forEach(function(nm) { if (nm !== uid) ct[nm] = (ct[nm] || 0) + 1; });
  });
  return Object.entries(ct).sort(function(a, b) { return b[1] - a[1]; }).slice(0, n || 5).map(function(e) { return e[0]; });
}

// ─── Team Helpers ────────────────────────────────
function teamTotals(game) {
  if (!game.teamMode || !game.teams) return [];
  return game.teams.map(function(t, i) {
    var tp = game.players.find(function(p) { return p.name === t.name; });
    return { name: t.name, members: t.members, total: tp ? calcTotal(tp) : 0, idx: i };
  });
}

function getWinner(game) {
  if (game.teamMode && game.teams) {
    var tt = teamTotals(game);
    var sorted = tt.slice().sort(function(a, b) { return game.lowWins ? (a.total - b.total) : (b.total - a.total); });
    return sorted[0];
  }
  var sorted = game.players.slice().sort(function(a, b) { return game.lowWins ? (calcTotal(a) - calcTotal(b)) : (calcTotal(b) - calcTotal(a)); });
  return sorted[0];
}

// ─── Sound Effects ───────────────────────────────
function playSound(type) {
  try {
    var c = new (window.AudioContext || window.webkitAudioContext)();
    var t = c.currentTime;
    if (type === "frog") {
      [0, 0.25].forEach(function(off) {
        var o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
        o.connect(g); g.connect(c.destination); lfo.connect(lg); lg.connect(o.frequency);
        o.frequency.value = 180; lfo.frequency.value = 30; lg.gain.value = 60;
        g.gain.setValueAtTime(0.4, t+off); g.gain.exponentialRampToValueAtTime(0.01, t+off+0.2);
        o.start(t+off); o.stop(t+off+0.22); lfo.start(t+off); lfo.stop(t+off+0.22);
      });
    } else if (type === "cat") {
      var o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.frequency.setValueAtTime(700, t); o.frequency.linearRampToValueAtTime(350, t+0.55);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t+0.05); g.gain.linearRampToValueAtTime(0, t+0.6);
      o.start(t); o.stop(t+0.65);
    } else if (type === "bird") {
      [0, 0.4].forEach(function(off) {
        var o = c.createOscillator(), g = c.createGain(), vib = c.createOscillator(), vg = c.createGain();
        o.connect(g); g.connect(c.destination); vib.connect(vg); vg.connect(o.frequency);
        o.frequency.setValueAtTime(1800, t+off); o.frequency.linearRampToValueAtTime(1200, t+off+0.3);
        vib.frequency.value = 25; vg.gain.value = 120;
        g.gain.setValueAtTime(0, t+off); g.gain.linearRampToValueAtTime(0.3, t+off+0.03); g.gain.linearRampToValueAtTime(0, t+off+0.35);
        o.start(t+off); o.stop(t+off+0.37); vib.start(t+off); vib.stop(t+off+0.37);
      });
    } else if (type === "dino") {
      var o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
      var dist = c.createWaveShaper(), curve = new Float32Array(256);
      for (var i = 0; i < 256; i++) { var x = i*2/256-1; curve[i] = Math.sign(x)*(1-Math.exp(-3*Math.abs(x))); }
      dist.curve = curve; o.connect(dist); o2.connect(dist); dist.connect(g); g.connect(c.destination);
      o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(45, t+0.8);
      o2.frequency.setValueAtTime(130, t); o2.frequency.linearRampToValueAtTime(55, t+0.8);
      o.type = "sawtooth"; o2.type = "square";
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4, t+0.08); g.gain.linearRampToValueAtTime(0, t+0.9);
      o.start(t); o.stop(t+0.95); o2.start(t); o2.stop(t+0.95);
    } else {
      var o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination); o.frequency.value = 800; g.gain.value = 0.3;
      o.start(); o.stop(t+0.3);
    }
  } catch(e) {}
}

// ─── Leaderboard Builder ─────────────────────────
// Accumulation model: points earned per game, no ceiling.
// Placement points (before tier multiplier):
//   1st: 10, 2nd: 8, 3rd: 5, 4th+: 3 (participation)
//   Independent winner: 5
// Ties split placement points equally.
// Team members split placement points by team size.
// Winners/2nd/3rd do NOT also get participation.

var PLACEMENT_PTS = [10, 8, 5]; // 1st, 2nd, 3rd
var PARTICIPATION_PTS = 3;      // 4th+
var INDIE_WIN_PTS = 5;          // independent game leader

function buildLeaderboard(history, fu) {
  fu = fu || {};
  var players = {};

  function ensure(k, dn) {
    if (!players[k]) players[k] = { name: dn, key: k, points: 0, wins: 0, games: 0 };
    players[k].name = dn;
  }

  // ── Standard & team games ──
  history.forEach(function(game) {
    if (!game.finished || game.scoringType === "independent") return;
    var tier = game.tier || DEFAULT_TIER;

    if (game.teamMode && game.teams) {
      // Build team totals and sort by placement
      var tt = teamTotals(game);
      var sorted = tt.slice().sort(function(a, b) {
        return game.lowWins ? (a.total - b.total) : (b.total - a.total);
      });

      // Assign placement ranks with tie handling
      var teamPlacements = assignPlacements(sorted, function(t) { return t.total; });

      tt.forEach(function(team) {
        var sz = Math.max(1, team.members.length);
        // Find this team's placement info
        var pl = null;
        for (var i = 0; i < teamPlacements.length; i++) {
          if (teamPlacements[i].item.name === team.name) { pl = teamPlacements[i]; break; }
        }
        if (!pl) return;
        var ptsPerMember = (pl.pts * tier) / sz;

        team.members.forEach(function(memberName) {
          // Resolve userId
          var uid = null;
          for (var gi = 0; gi < history.length; gi++) {
            var found = history[gi].players.find(function(p) { return p.name === memberName && p.userId; });
            if (found) { uid = found.userId; break; }
          }
          var k = uid || memberName;
          var dn = uid && fu[uid] ? fu[uid].displayName : memberName;
          ensure(k, dn);
          players[k].games += 1;
          players[k].points += ptsPerMember;
          if (pl.rank === 1) players[k].wins += 1 / sz;
        });
      });
    } else {
      // Individual game
      var scored = game.players.map(function(p) {
        return { player: p, total: calcTotal(p) };
      });
      var sorted = scored.slice().sort(function(a, b) {
        return game.lowWins ? (a.total - b.total) : (b.total - a.total);
      });

      var placements = assignPlacements(sorted, function(s) { return s.total; });

      placements.forEach(function(pl) {
        var p = pl.item.player;
        var k = pkey(p), dn = rname(p, fu);
        ensure(k, dn);
        players[k].games += 1;
        players[k].points += pl.pts * tier;
        if (pl.rank === 1) players[k].wins += 1;
      });
    }
  });

  // ── Independent game leaders ──
  // For each independent game, find the leader(s) using effective score,
  // award INDIE_WIN_PTS × tier (split if tied)
  var indGames = {};
  history.forEach(function(g) {
    if (!g.finished || g.scoringType !== "independent") return;
    var k = g.gameKey === "custom" ? gameName(g) : g.gameKey;
    if (!indGames[k]) indGames[k] = { entries: {}, tier: g.tier || DEFAULT_TIER };
    g.players.forEach(function(p) {
      var sc = parseFloat(p.scores && p.scores.Score) || 0;
      var pk = pkey(p);
      if (!indGames[k].entries[pk]) indGames[k].entries[pk] = { total: 0, count: 0, name: rname(p, fu) };
      indGames[k].entries[pk].total += sc;
      indGames[k].entries[pk].count += 1;
    });
  });

  Object.values(indGames).forEach(function(ig) {
    var best = -1, effs = {};
    Object.entries(ig.entries).forEach(function(e) {
      var n = e[0], total = e[1].total, count = e[1].count;
      var eff = (total / count) * Math.min(1, count / INDIE_VOLUME_CAP);
      effs[n] = eff;
      if (eff > best) best = eff;
    });
    if (best <= 0) return;
    // Count how many tied for best
    var tiedKeys = [];
    Object.entries(effs).forEach(function(e) {
      if (Math.abs(e[1] - best) < 0.001) tiedKeys.push(e[0]);
    });
    var tiedCount = tiedKeys.length;
    tiedKeys.forEach(function(n) {
      var dn = ig.entries[n] ? ig.entries[n].name : n;
      ensure(n, dn);
      players[n].points += (INDIE_WIN_PTS / tiedCount) * ig.tier;
      players[n].wins += 1 / tiedCount;
      players[n].games += 1;
    });
  });

  return Object.values(players).map(function(p) {
    return {
      name: p.name, key: p.key,
      points: Math.round(p.points * 100) / 100,
      wins: Math.round(p.wins * 100) / 100,
      games: p.games,
      winRate: p.games > 0 ? p.wins / p.games : 0,
    };
  });
}

function buildLeaderboardForMonth(history, fu, year, month) {
  var filtered = history.filter(function(g) {
    if (!g.finished) return false;
    var d = new Date(g.finishedAt || g.startedAt);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  return buildLeaderboard(filtered, fu);
}

// ── Placement assigner with tie splitting ──
// Takes a sorted array and a value function.
// Returns array of { item, rank, pts } where pts accounts for tie splits.
function assignPlacements(sorted, valFn) {
  var result = [];
  var i = 0;
  while (i < sorted.length) {
    // Find all items tied at this position
    var tieStart = i;
    var tieVal = valFn(sorted[i]);
    while (i < sorted.length && Math.abs(valFn(sorted[i]) - tieVal) < 0.001) {
      i++;
    }
    var tieCount = i - tieStart;
    var rank = tieStart + 1; // 1-indexed rank

    // Calculate points: average the placement points across tied positions
    // e.g. 2 tied for 1st: each gets PLACEMENT_PTS[0] / 2
    // e.g. 2 tied for 2nd: each gets PLACEMENT_PTS[1] / 2
    var pts;
    if (rank <= 3) {
      // All tied players are in a podium position
      pts = (PLACEMENT_PTS[rank - 1] || PARTICIPATION_PTS) / tieCount;
    } else {
      // 4th+ all get participation
      pts = PARTICIPATION_PTS;
    }

    for (var j = tieStart; j < i; j++) {
      result.push({ item: sorted[j], rank: rank, pts: pts });
    }
  }
  return result;
}

// ─── New Game Creator ────────────────────────────
function newGame(gk, pn, cats, cn, ce, tm, teams, st, ms, user, fu, lw) {
  var def = BUILT_IN_GAMES[gk] || { name: cn, emoji: ce || "🎲", categories: cats, scoringType: st };
  var isInd = st === "independent" || def.scoringType === "independent";
  var categories = isInd ? ["Score"] : (gk === "custom" ? cats : def.categories);
  var emoji = gk === "custom" ? (ce || "🎲") : def.emoji;
  var maxScore = isInd ? (ms || def.maxScore || DEFAULT_MAX_SCORE) : null;
  var lowWins = !!(lw || def.lowWins);
  var gn = gk === "custom" ? (cn || "Custom Game") : def.name;
  var tier = TIER_OVERRIDES[gn] || def.tier || DEFAULT_TIER;
  var myName = user && fu && fu[user.userId] ? fu[user.userId].displayName : (user ? user.displayName : null);

  // Build reverse map: displayName -> userId, covering all known family members
  var nameToUserId = {};
  if (fu) {
    Object.entries(fu).forEach(function([uid, u]) { if (u.displayName) nameToUserId[u.displayName] = uid; });
  }
  // Ensure the current user is always included even if not yet in familyUsers
  if (user && myName) nameToUserId[myName] = user.userId;

  var players;
  if (tm && teams) {
    players = teams.map(function(t) {
      return { name: t.name, scores: Object.fromEntries(categories.map(function(c) { return [c, ""]; })) };
    });
  } else {
    players = pn.map(function(n) {
      return { name: n, scores: Object.fromEntries(categories.map(function(c) { return [c, ""]; })), userId: nameToUserId[n] || undefined };
    });
  }

  return {
    id: Date.now(), gameKey: gk, gameName: gn, emoji: emoji, categories: categories,
    players: players, teamMode: !!tm, teams: tm ? teams : null,
    startedAt: new Date().toISOString(), finished: false,
    scoringType: isInd ? "independent" : "standard",
    maxScore: maxScore, lowWins: lowWins, tier: tier,
  };
}
// ─── Badge & Award Helpers ───────────────────────

var BADGES = [
  { key: "game_hoe",        name: "Game Hoe",           emoji: "🫯", desc: "Play 10 unique game types." },
  { key: "grand_architect", name: "Grand Architect",     emoji: "👷", desc: "Be the first player to create 5 unique custom game templates." },
  { key: "consistency",     name: "Consistency is Key",  emoji: "🔥", desc: "Play games in 3 consecutive months." },
  { key: "comeback_kid",    name: "Comeback Kid",        emoji: "🕺", desc: "Place last in one season, then finish top 3 in the very next season." },
  { key: "big_nerd",        name: "Big Nerd",            emoji: "🤓", desc: "Play a tier 5 (highest weight) game." },
];

function playerInGame(g, playerKey, fu) {
  var displayName = fu && fu[playerKey] ? fu[playerKey].displayName : playerKey;
  if (g.teamMode && g.teams) {
    return g.teams.some(function(t) {
      return t.members.some(function(m) { return m === displayName || m === playerKey; });
    });
  }
  return g.players.some(function(p) {
    return pkey(p) === playerKey || p.name === displayName;
  });
}

function computeBadges(playerKey, history, fu) {
  var earned = [];
  var finished = history.filter(function(g) { return g.finished; });
  var mine = finished.filter(function(g) { return playerInGame(g, playerKey, fu); });

  // Game Hoe: 10+ unique game names
  var uniqueNames = new Set(mine.map(function(g) { return gameName(g); }));
  if (uniqueNames.size >= 10) earned.push(BADGES[0]);

  // Grand Architect: 5+ unique custom templates where player was first player on first-ever play
  var templateFirstPlay = {};
  finished.forEach(function(g) {
    if (BUILT_IN_GAMES[g.gameKey] && g.gameKey !== "custom") return;
    var name = gameName(g);
    var d = new Date(g.finishedAt || g.startedAt);
    if (!templateFirstPlay[name] || d < new Date(templateFirstPlay[name].finishedAt || templateFirstPlay[name].startedAt)) {
      templateFirstPlay[name] = g;
    }
  });
  var createdCount = Object.values(templateFirstPlay).filter(function(g) {
    return g.players && g.players.length > 0 && pkey(g.players[0]) === playerKey;
  }).length;
  if (createdCount >= 5) earned.push(BADGES[1]);

  // Consistency is Key: 3 consecutive months with at least 1 game
  var monthSet = new Set();
  mine.forEach(function(g) {
    var d = new Date(g.finishedAt || g.startedAt);
    monthSet.add(d.getFullYear() * 12 + d.getMonth());
  });
  var months = Array.from(monthSet).sort(function(a, b) { return a - b; });
  var hasConsecutive3 = false;
  for (var i = 0; i <= months.length - 3; i++) {
    if (months[i+1] === months[i]+1 && months[i+2] === months[i]+2) { hasConsecutive3 = true; break; }
  }
  if (hasConsecutive3) earned.push(BADGES[2]);

  // Comeback Kid: last in one season, top 3 in the next consecutive season
  var allMonthSet = new Set();
  finished.forEach(function(g) {
    var d = new Date(g.finishedAt || g.startedAt);
    allMonthSet.add(d.getFullYear() * 12 + d.getMonth());
  });
  var allMonths = Array.from(allMonthSet).sort(function(a, b) { return a - b; });
  var isComeback = false;
  for (var i = 0; i < allMonths.length - 1 && !isComeback; i++) {
    if (allMonths[i+1] !== allMonths[i] + 1) continue;
    var y1 = Math.floor(allMonths[i] / 12), m1 = allMonths[i] % 12;
    var y2 = Math.floor(allMonths[i+1] / 12), m2 = allMonths[i+1] % 12;
    var lb1 = buildLeaderboardForMonth(history, fu, y1, m1);
    var lb2 = buildLeaderboardForMonth(history, fu, y2, m2);
    var s1 = lb1.slice().sort(function(a, b) { return b.points - a.points; });
    var s2 = lb2.slice().sort(function(a, b) { return b.points - a.points; });
    if (!s1.length || !s2.length) continue;
    var r1 = getRanks(s1, function(p) { return p.points; });
    var r2 = getRanks(s2, function(p) { return p.points; });
    var idx1 = s1.findIndex(function(p) { return p.key === playerKey; });
    var idx2 = s2.findIndex(function(p) { return p.key === playerKey; });
    if (idx1 < 0 || idx2 < 0) continue;
    var maxRank1 = Math.max.apply(null, r1);
    if (r1[idx1] === maxRank1 && r2[idx2] <= 3) isComeback = true;
  }
  if (isComeback) earned.push(BADGES[3]);

  // Big Nerd: played any tier 5 game
  if (mine.some(function(g) { return (g.tier || DEFAULT_TIER) === 5; })) earned.push(BADGES[4]);

  return earned;
}

function getWoodenSpoon(lb) {
  if (!lb || lb.length < 2) return null;
  var eligible = lb.filter(function(p) { return p.games >= 2; });
  if (!eligible.length) return null;
  var sorted = eligible.slice().sort(function(a, b) {
    var aRatio = (a.games - a.wins) / a.games;
    var bRatio = (b.games - b.wins) / b.games;
    if (Math.abs(bRatio - aRatio) > 0.001) return bRatio - aRatio;
    return b.games - a.games;
  });
  return sorted[0];
}

// ─── Independent Game Rankings ───────────────────
function buildIndependentRankings(history, gameKey, fu) {
  fu = fu || {};
  var entries = {};
  var maxScore = 50;
  history.forEach(function(g) {
    if (!g.finished || g.scoringType !== "independent") return;
    var gk = g.gameKey === "custom" ? gameName(g) : g.gameKey;
    if (gk !== gameKey) return;
    if (g.maxScore) maxScore = g.maxScore;
    g.players.forEach(function(p) {
      var k = pkey(p);
      var dn = rname(p, fu);
      var sc = parseFloat(p.scores && p.scores.Score) || 0;
      if (!entries[k]) entries[k] = { key: k, name: dn, total: 0, count: 0, lastPlayed: null };
      entries[k].total += sc;
      entries[k].count += 1;
      var d = g.finishedAt || g.startedAt;
      if (!entries[k].lastPlayed || d > entries[k].lastPlayed) entries[k].lastPlayed = d;
    });
  });
  return Object.values(entries).map(function(e) {
    var avg = e.count > 0 ? e.total / e.count : 0;
    var effective = avg * Math.min(1, e.count / INDIE_VOLUME_CAP);
    return { name: e.name, key: e.key, avg: avg, count: e.count, effective: effective, maxScore: maxScore, lastPlayed: e.lastPlayed };
  }).sort(function(a, b) { return b.effective - a.effective; });
}
