// ═══════════════════════════════════════════════════
// COMPONENTS — All React UI screens
// Uses: React (global), config.js, helpers.js, reducer.js
// ═══════════════════════════════════════════════════

const { useState, useEffect, useReducer, useCallback, useRef } = React;
const MNAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/* ═══ App ═══ */
function App() {
  const [state, dispatch] = useReducer(reducer, INIT);
  const [syncing, setSyncing] = useState(false);
  const [timerSet, setTimerSet] = useState({ min: 1, sec: 0 });
  const [timerRem, setTimerRem] = useState(null);
  const [timerRun, setTimerRun] = useState(false);
  const [timerRepeat, setTimerRepeat] = useState(false);
  const [timerSound, setTimerSound] = useState("beep");

  useEffect(() => {
  // Load only login info from localStorage (lightweight — just who you are)
  localStorage.removeItem("bgs_v3"); // Clean up old cache from all devices
    try {
    const s = JSON.parse(localStorage.getItem("bgs_login") || "null");
    if (s && s.userId) {
      // Re-fetch full user data from Supabase
      (async () => {
        const u = await db2.getUser(s.userId);
        if (!u) { localStorage.removeItem("bgs_login"); return; }
        const memberRows = await db2.getUserFamilies(u.id);
        const fams = memberRows.map(function(m) { return m.tally_families ? m.tally_families.code : null; }).filter(Boolean);
        const user = { userId: u.username, displayName: u.display_name, pin: u.pin_hash, families: fams, createdAt: u.created_at };
        dispatch({ type: "SET_USER", user: user });
        if (fams.length > 0) dispatch({ type: "JOIN_FAMILY", family: s.family || fams[0] });
      })();
    }
  } catch {}
}, []);

useEffect(() => {
  // Only persist login identity — everything else comes from Supabase
  if (state.user && !state.user.guest) {
    localStorage.setItem("bgs_login", JSON.stringify({ userId: state.user.userId, family: state.family }));
  } else {
    localStorage.removeItem("bgs_login");
  }
}, [state.user, state.family]);

  // Sync family data
  useEffect(() => {
    if (!state.family || !sb) return;
    (async () => {
      setSyncing(true);
      if (USE_NEW_DB) {
        const fam = await db2.getFamilyByCode(state.family);
        if (fam) {
          const [games, tplRows, members] = await Promise.all([
            db2.getGames(fam.id),
            db2.getTemplates(fam.id),
            db2.getFamilyMembers(fam.id),
          ]);
          if (games.length) dispatch({ type: "SYNC_HISTORY", history: games });
          // Convert template rows to object keyed by template_key
          const tplObj = {};
          tplRows.forEach(function(t) {
            tplObj[t.template_key] = { gameKey: t.game_key, name: t.name, gameName: t.name, emoji: t.emoji, categories: t.categories, scoringType: t.scoring_type, tier: t.tier, maxScore: t.max_score, lowWins: t.low_wins };
          });
          dispatch({ type: "SYNC_TEMPLATES", templates: tplObj, replace: true });
          // Convert members to familyUsers map
          const fuMap = {};
          members.forEach(function(m) {
            const uname = m.tally_users ? m.tally_users.username : null;
            if (uname) fuMap[uname] = { displayName: m.display_name };
          });
          if (Object.keys(fuMap).length) dispatch({ type: "SET_FAMILY_USERS", familyUsers: fuMap });
        }
      } else {
        const [g, rt, fu] = await Promise.all([dbLoad(state.family), dbLoad(state.family + "_templates"), dbLoad(state.family + "_users")]);
        if (g) dispatch({ type: "SYNC_HISTORY", history: g });
        if (rt) dispatch({ type: "SYNC_TEMPLATES", templates: rt });
        if (fu) dispatch({ type: "SET_FAMILY_USERS", familyUsers: fu });
      }
      setSyncing(false);
    })();
  }, [state.family, state.screen]);

  // Sync familyUsers
  useEffect(() => {
    if (!state.family || !sb || !Object.keys(state.familyUsers).length) return;
    if (!USE_NEW_DB) {
      dbSave(state.family + "_users", state.familyUsers).catch(() => {});
    }
    // New DB: family members are synced via joinFamily/rename, not bulk
  }, [state.familyUsers, state.family]);

  // Sync user record
  useEffect(() => {
    if (!state.user || state.user.guest || !sb) return;
    if (USE_NEW_DB) {
      db2.updateUser(state.user.userId, { pin_hash: state.user.pin, display_name: state.user.displayName }).catch(() => {});
    } else {
      dbSaveUser(state.user.userId, { pin: state.user.pin, displayName: state.user.displayName, families: state.user.families || [], createdAt: state.user.createdAt }).catch(() => {});
    }
  }, [state.user]);

  // Timer tick
  useEffect(() => { if (!timerRun || timerRem === null) return; const id = setInterval(() => { setTimerRem(prev => { if (prev <= 1) { playSound(timerSound); if (timerRepeat) return timerSet.min * 60 + timerSet.sec; setTimerRun(false); return 0; } return prev - 1; }); }, 1000); return () => clearInterval(id); }, [timerRun, timerRepeat, timerSet, timerSound]);

  const finishGame = useCallback(async () => {
    dispatch({ type: "FINISH" });
    if (state.family && sb && state.current) {
      const fin = Object.assign({}, state.current, { finished: true, finishedAt: new Date().toISOString() });
      if (USE_NEW_DB) {
        const fam = await db2.getFamilyByCode(state.family);
        if (fam) {
          await db2.saveGame(fam.id, fin);
          const tKey = fin.gameKey === "custom" ? fin.gameName : fin.gameKey;
          await db2.upsertTemplate(fam.id, tKey, {
            gameKey: fin.gameKey, name: fin.gameName, gameName: fin.gameName, emoji: fin.emoji,
            categories: fin.categories, scoringType: fin.scoringType, maxScore: fin.maxScore,
            lowWins: fin.lowWins, tier: fin.tier,
          });
        }
      } else {
        const existing = await dbLoad(state.family) || [];
        await dbSave(state.family, [fin].concat(existing.filter(g => g.id !== fin.id)));
      }
    }
  }, [state.family, state.current]);

  const timerProps = { timerSet, setTimerSet, timerRem, setTimerRem, timerRun, setTimerRun, timerRepeat, setTimerRepeat, timerSound, setTimerSound };
  const screens = { welcome: WelcomeScreen, home: HomeScreen, setup: SetupScreen, game: GameScreen, history: HistoryScreen, historyDetail: HistoryDetail, leaderboard: LeaderboardScreen, family: FamilyScreen, timer: TimerScreen };
  const Screen = screens[state.screen] || HomeScreen;
  const showNav = state.screen !== "welcome";

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "'Courier New',monospace" }}>
      {syncing && <div style={{ background: C.tomato, color: C.white, textAlign: "center", fontSize: 12, padding: "4px 0" }}>Syncing…</div>}
      {!sb && showNav && <div style={{ background: C.lime, color: C.muted, textAlign: "center", fontSize: 11, padding: "4px 8px", borderBottom: "2px solid " + C.ink }}>⚠️ Supabase not configured</div>}
      <Screen state={state} dispatch={dispatch} finishGame={finishGame} timerProps={timerProps} />
      {showNav && state.screen !== "timer" && timerRem !== null && timerRem > 0 && <div onClick={() => dispatch({ type: "GO", screen: "timer" })} style={{ position: "fixed", bottom: 66, right: 12, background: timerRun ? C.tomato : C.muted, color: C.white, borderRadius: 28, padding: "12px 22px", fontSize: 22, fontWeight: 900, cursor: "pointer", zIndex: 100, border: "2px solid " + C.ink, boxShadow: "3px 3px 0 " + C.ink }}>{timerRun ? "⏱" : "⏸"} {fmtTime(timerRem)}</div>}
      {showNav && <BottomNav screen={state.screen} dispatch={dispatch} state={state} />}
    </div>
  );
}

/* ═══ Welcome ═══ */
function WelcomeScreen({ state, dispatch }) {
  const [mode, setMode] = useState(null); const [uid, setUid] = useState(""); const [pin, setPin] = useState(""); const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  async function create() {
    if (!uid.trim() || !pin.trim()) { setErr("Username and PIN required"); return; }
    if (pin.trim().length < 4) { setErr("PIN must be 4+ chars"); return; }
    setLoading(true); setErr("");
    const id = uid.trim().toLowerCase().replace(/\s+/g, "");
    const hashedPin = await hashPin(pin.trim());
    if (USE_NEW_DB) {
      const existing = await db2.getUser(id);
      if (existing) { setErr("Username taken"); setLoading(false); return; }
      const created = await db2.createUser(id, hashedPin, id);
      if (!created) { setErr("Error creating account"); setLoading(false); return; }
      dispatch({ type: "SET_USER", user: { userId: id, displayName: id, pin: hashedPin, families: [], createdAt: new Date().toISOString() } });
    } else {
      if (sb) { const ex = await dbLoadUser(id); if (ex) { setErr("Username taken"); setLoading(false); return; } }
      const user = { userId: id, displayName: id, pin: hashedPin, families: [], createdAt: new Date().toISOString() };
      if (sb) await dbSaveUser(id, { pin: hashedPin, displayName: id, families: [], createdAt: user.createdAt });
      dispatch({ type: "SET_USER", user });
    }
    setLoading(false);
  }
  async function login() {
    if (!uid.trim() || !pin.trim()) { setErr("Both required"); return; }
    setLoading(true); setErr("");
    const id = uid.trim().toLowerCase().replace(/\s+/g, "");
    if (!sb) { setErr("Supabase required"); setLoading(false); return; }
    const hashedInput = await hashPin(pin.trim());
    if (USE_NEW_DB) {
      const u = await db2.getUser(id);
      if (!u) { setErr("Not found"); setLoading(false); return; }
      if (u.pin_hash !== hashedInput) { setErr("Wrong PIN"); setLoading(false); return; }
      // Get their families
      const memberRows = await db2.getUserFamilies(u.id);
      const fams = memberRows.map(function(m) { return m.tally_families ? m.tally_families.code : null; }).filter(Boolean);
      const user = { userId: u.username, displayName: u.display_name, pin: u.pin_hash, families: fams, createdAt: u.created_at };
      dispatch({ type: "SET_USER", user });
      if (fams.length > 0) dispatch({ type: "JOIN_FAMILY", family: fams[0] });
    } else {
      const data = await dbLoadUser(id);
      if (!data) { setErr("Not found"); setLoading(false); return; }
      const match = isHashed(data.pin) ? (hashedInput === data.pin) : (pin.trim() === data.pin);
      if (!match) { setErr("Wrong PIN"); setLoading(false); return; }
      if (!isHashed(data.pin)) { await dbSaveUser(id, Object.assign({}, data, { pin: hashedInput })); data.pin = hashedInput; }
      const user = { userId: id, displayName: data.displayName || id, pin: data.pin, families: data.families || [], createdAt: data.createdAt };
      dispatch({ type: "SET_USER", user });
      if (user.families.length > 0) dispatch({ type: "JOIN_FAMILY", family: user.families[0] });
    }
    setLoading(false);
  }
  return (<div style={{ padding: "40px 24px", minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
    <div style={{ textAlign: "center", marginBottom: 40 }}><div style={{ fontSize: 56, marginBottom: 8 }}>🎲</div><h1 style={{ fontSize: 32, fontFamily: "Georgia,serif", fontWeight: 900 }}>Tally</h1><p style={{ color: C.white, fontSize: 14, marginTop: 8 }}>Track scores, settle debates.</p></div>
    {!mode ? <div style={{ display: "flex", flexDirection: "column", gap: 12 }}><Btn full primary onClick={() => setMode("create")}>Create Account</Btn><Btn full onClick={() => setMode("login")}>I have an account</Btn><div onClick={() => dispatch({ type: "GUEST" })} style={{ textAlign: "center", color: C.white, fontSize: 13, cursor: "pointer", marginTop: 8, textDecoration: "underline" }}>Skip — play as guest</div></div>
    : mode === "create" ? <div style={{ ...S.card, padding: 20 }}><h3 style={{ fontFamily: "Georgia,serif", marginBottom: 16, fontSize: 18 }}>Create Account</h3><div style={{ marginBottom: 12 }}><div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>USERNAME</div><input style={inp} placeholder="e.g. sarah123" value={uid} onChange={e => setUid(e.target.value)} /></div><div style={{ marginBottom: 16 }}><div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>PIN (4+ chars)</div><input style={inp} type="password" placeholder="••••" value={pin} onChange={e => setPin(e.target.value)} /></div>{err && <div style={{ color: C.tomato, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{err}</div>}<Btn full primary disabled={loading} onClick={create}>{loading ? "Creating…" : "Create →"}</Btn><div style={{ textAlign: "center", marginTop: 12 }}><span onClick={() => { setMode(null); setErr(""); }} style={{ color: C.muted, fontSize: 13, cursor: "pointer" }}>← Back</span></div></div>
    : <div style={{ ...S.card, padding: 20 }}><h3 style={{ fontFamily: "Georgia,serif", marginBottom: 16, fontSize: 18 }}>Log In</h3><div style={{ marginBottom: 12 }}><div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>USERNAME</div><input style={inp} placeholder="e.g. sarah123" value={uid} onChange={e => setUid(e.target.value)} /></div><div style={{ marginBottom: 16 }}><div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>PIN</div><input style={inp} type="password" placeholder="••••" value={pin} onChange={e => setPin(e.target.value)} /></div>{err && <div style={{ color: C.tomato, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{err}</div>}<Btn full primary disabled={loading} onClick={login}>{loading ? "Logging in…" : "Log In →"}</Btn><div style={{ textAlign: "center", marginTop: 12 }}><span onClick={() => { setMode(null); setErr(""); }} style={{ color: C.muted, fontSize: 13, cursor: "pointer" }}>← Back</span></div></div>}
  </div>);
}

/* ═══ Bottom Nav ═══ */
function BottomNav({ screen, dispatch, state }) {
  const tabs = [{ id: "home", label: "Home", icon: "🏠" }, { id: "leaderboard", label: "Board", icon: "🏆" }, { id: "timer", label: "Timer", icon: "⏱" }, { id: "history", label: "History", icon: "📋" }, { id: "family", label: "Family", icon: "👨‍👩‍👧" }];
  return (<div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: C.card, borderTop: "3px solid " + C.ink, display: "flex" }}>
    {!!state.current && screen !== "game" && <button onClick={() => dispatch({ type: "GO", screen: "game" })} style={{ position: "absolute", top: -44, left: "50%", transform: "translateX(-50%)", background: C.tomato, border: "2px solid " + C.ink, color: C.white, borderRadius: 20, padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "3px 3px 0 " + C.ink }}>▶ Resume Game</button>}
    {tabs.map(t => <button key={t.id} onClick={() => dispatch({ type: "GO", screen: t.id })} style={{ flex: 1, background: "none", border: "none", color: screen === t.id ? C.tomato : C.ink, padding: "10px 0 8px", cursor: "pointer", fontSize: 11, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontWeight: 900 }}><span style={{ fontSize: 18 }}>{t.icon}</span>{t.label}</button>)}
  </div>);
}

/* ═══ Timer ═══ */
function TimerScreen({ timerProps }) {
  const { timerSet, setTimerSet, timerRem, setTimerRem, timerRun, setTimerRun, timerRepeat, setTimerRepeat, timerSound, setTimerSound } = timerProps;
  const SOUNDS = [{ id: "beep", emoji: "⏰" }, { id: "frog", emoji: "🐸" }, { id: "cat", emoji: "🐱" }, { id: "bird", emoji: "🦅" }, { id: "dino", emoji: "🦖" }];
  const total = timerSet.min * 60 + timerSet.sec; const active = timerRem !== null && timerRem > 0;
  return (<div style={{ padding: "20px 20px 80px" }}><h2 style={{ fontFamily: "Georgia,serif", fontWeight: 900, marginBottom: 16 }}>⏱ Timer</h2>
    {!active ? <div><div style={{ ...S.card, padding: 24, marginBottom: 20, textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 }}><div><div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>MIN</div><div style={{ display: "flex", alignItems: "center", gap: 6 }}><button onClick={() => setTimerSet(p => ({ ...p, min: Math.max(0, p.min - 1) }))} style={{ width: 36, height: 36, borderRadius: 8, border: "2px solid " + C.ink, background: C.white, fontSize: 18, cursor: "pointer", fontWeight: 900 }}>−</button><span style={{ fontSize: 36, fontWeight: 900, fontFamily: "Georgia,serif", width: 50, textAlign: "center" }}>{timerSet.min}</span><button onClick={() => setTimerSet(p => ({ ...p, min: p.min + 1 }))} style={{ width: 36, height: 36, borderRadius: 8, border: "2px solid " + C.ink, background: C.white, fontSize: 18, cursor: "pointer", fontWeight: 900 }}>+</button></div></div><span style={{ fontSize: 36, fontWeight: 900, marginTop: 16 }}>:</span><div><div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>SEC</div><div style={{ display: "flex", alignItems: "center", gap: 6 }}><button onClick={() => setTimerSet(p => ({ ...p, sec: Math.max(0, p.sec - 5) }))} style={{ width: 36, height: 36, borderRadius: 8, border: "2px solid " + C.ink, background: C.white, fontSize: 18, cursor: "pointer", fontWeight: 900 }}>−</button><span style={{ fontSize: 36, fontWeight: 900, fontFamily: "Georgia,serif", width: 50, textAlign: "center" }}>{String(timerSet.sec).padStart(2, '0')}</span><button onClick={() => setTimerSet(p => ({ ...p, sec: Math.min(55, p.sec + 5) }))} style={{ width: 36, height: 36, borderRadius: 8, border: "2px solid " + C.ink, background: C.white, fontSize: 18, cursor: "pointer", fontWeight: 900 }}>+</button></div></div></div>
      <button onClick={() => setTimerRepeat(r => !r)} style={{ background: timerRepeat ? C.lime : C.white, border: "2px solid " + C.ink, borderRadius: 10, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontWeight: 700, marginBottom: 16 }}>🔁 Repeat {timerRepeat ? "ON" : "OFF"}</button>
      <div><div style={{ fontSize: 11, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 2 }}>Sound</div><div style={{ display: "flex", gap: 8, justifyContent: "center" }}>{SOUNDS.map(s => <button key={s.id} onClick={() => { setTimerSound(s.id); playSound(s.id); }} style={{ background: timerSound === s.id ? C.tomato : C.white, border: "2px solid " + C.ink, borderRadius: 12, padding: "10px 14px", fontSize: 22, cursor: "pointer", color: timerSound === s.id ? C.white : C.ink, boxShadow: timerSound === s.id ? "2px 2px 0 " + C.ink : "none" }}>{s.emoji}</button>)}</div></div>
    </div><Btn full primary disabled={total === 0} onClick={() => { setTimerRem(total); setTimerRun(true); }}>▶ Start Timer</Btn></div>
    : <div style={{ textAlign: "center" }}><div style={{ ...S.card, padding: 32, marginBottom: 20 }}><div style={{ fontSize: 64, fontWeight: 900, fontFamily: "Georgia,serif", color: timerRem <= 5 ? C.tomato : C.ink, marginBottom: 8 }}>{fmtTime(timerRem)}</div>{timerRepeat && <div style={{ fontSize: 12, color: C.muted }}>🔁 Repeat ON</div>}</div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>{timerRun ? <button onClick={() => setTimerRun(false)} style={{ flex: 3, padding: "20px", fontSize: 18, fontWeight: 900, borderRadius: 14, border: "2px solid " + C.ink, background: C.lime, cursor: "pointer", boxShadow: "3px 3px 0 " + C.ink }}>⏸ Pause</button> : <button onClick={() => setTimerRun(true)} style={{ flex: 3, padding: "20px", fontSize: 18, fontWeight: 900, borderRadius: 14, border: "2px solid " + C.ink, background: C.lime, cursor: "pointer", boxShadow: "3px 3px 0 " + C.ink }}>▶ Resume</button>}<button onClick={() => { setTimerRun(false); setTimerRem(null); }} style={{ flex: 1, padding: "20px", fontSize: 14, fontWeight: 700, borderRadius: 14, border: "2px solid " + C.ink, background: "#fde8e8", color: "#c0392b", cursor: "pointer" }}>⏹</button></div>
      <button onClick={() => setTimerRepeat(r => !r)} style={{ marginTop: 16, background: timerRepeat ? C.lime : C.white, border: "2px solid " + C.ink, borderRadius: 10, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>🔁 {timerRepeat ? "ON" : "OFF"}</button>
      <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center" }}>{SOUNDS.map(s => <button key={s.id} onClick={() => { setTimerSound(s.id); playSound(s.id); }} style={{ background: timerSound === s.id ? C.tomato : C.white, border: "2px solid " + C.ink, borderRadius: 12, padding: "8px 12px", fontSize: 20, cursor: "pointer", color: timerSound === s.id ? C.white : C.ink }}>{s.emoji}</button>)}</div>
    </div>}
  </div>);
}

/* ═══ Home ═══ */
function HomeScreen({ state, dispatch }) {
  const fu = state.familyUsers || {}; const now = new Date(); const lb = buildLeaderboardForMonth(state.history, fu, now.getFullYear(), now.getMonth());
const top = [...lb].sort((a, b) => b.points - a.points)[0]; const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const myName = state.user && fu[state.user.userId] ? fu[state.user.userId].displayName : ((state.user && state.user.displayName) || null);
  return (<div style={{ padding: "20px 20px 80px" }}>
    <h1 style={{ textAlign: "center", fontSize: 34, margin: "24px 0 4px", fontFamily: "Georgia,serif", fontWeight: 900, letterSpacing: -1 }}>🎲 Tally</h1>
    {myName && <p style={{ textAlign: "center", color: C.white, fontSize: 13, marginBottom: 4 }}>Hey, <b>{myName}</b>!</p>}
    {(state.user && state.user.guest) && <p style={{ textAlign: "center", color: C.white, fontSize: 12, marginBottom: 4, opacity: 0.7 }}>Playing as guest</p>}
    {state.family && <p style={{ textAlign: "center", color: C.muted, fontSize: 12, marginBottom: 8 }}>👨‍👩‍👧 <b style={{ color: C.card }}>{state.family}</b></p>}
    {!state.family && <div style={{ ...S.limeCard, padding: "14px 18px", marginBottom: 12, textAlign: "center", cursor: "pointer" }} onClick={() => dispatch({ type: "GO", screen: "family" })}><div style={{ fontSize: 14, fontWeight: 700 }}>👨‍👩‍👧 Join a Family Space to start</div></div>}
    <div style={{ ...S.limeCard, padding: "14px 18px", marginBottom: 12, textAlign: "center", cursor: "pointer" }} onClick={() => dispatch({ type: "GO", screen: "setup" })}><div style={{ fontSize: 28, fontWeight: 900, fontFamily: "Georgia,serif" }}>+ New Game</div><div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Tap to start playing</div></div>
    {top && <div style={{ background: C.tomato, border: "2px solid " + C.ink, borderRadius: 14, boxShadow: "3px 3px 0 " + C.ink, padding: "14px 18px", marginBottom: 20, textAlign: "center" }}><div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", letterSpacing: 2 }}>⭐ {MNAMES[now.getMonth()]} Top Player ⭐</div><div style={{ fontSize: 24, fontWeight: 900, fontFamily: "Georgia,serif", color: C.white }}>{top.name}</div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>{daysLeft} day{daysLeft !== 1 ? "s" : ""} left to take the trophy</div></div>}
    {state.history.length > 0 && <><h3 style={{ ...secHead, marginTop: 20 }}>Recent Games</h3>{state.history.slice(0, 3).map(g => { const w = getWinner(g); const wName = (w && w.members) ? w.name : rname(w, fu); const wPts = (w && w.members) ? w.total : calcTotal(w); return (<div key={g.id} onClick={() => dispatch({ type: "GO", screen: "historyDetail", id: g.id })} style={{ ...S.card, padding: "14px 16px", marginBottom: 10, cursor: "pointer" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontFamily: "Georgia,serif", fontWeight: 700 }}>{gameEmoji(g)} {gameName(g)}</span><span style={{ color: C.muted, fontSize: 11 }}>{new Date(g.finishedAt || g.startedAt).toLocaleDateString()}</span></div><div style={{ color: C.tomato, fontSize: 13, fontWeight: 700 }}>🏆 {wName} — {wPts} pts</div></div>); })}</>}
  </div>);
}

/* ═══ Setup, Game, Capture, Leaderboard, History, Family ═══ */
/* NOTE: These screens are identical to the current single-file version. */
/* Due to length, they continue in this same file below. */
/* In Phase 2, we'll extract styles. For now, the logic is preserved exactly. */

// I'm truncating here for the artifact — the remaining screens
// (SetupScreen, GameScreen, CaptureScores, LeaderboardScreen,
//  HistoryScreen, HistoryDetail, FamilyScreen, TopBar, Btn)
// would be copied verbatim from your current working code.
// They reference C, S, secHead, inp, TC, TCL, TE, BUILT_IN_GAMES,
// EMOJI_OPTIONS, WIN_WEIGHT, VOLUME_WEIGHT etc. from config/helpers.

// ═══ PLACEHOLDER — paste remaining screens from your current code here ═══
// SetupScreen, GameScreen, CaptureScores, LeaderboardScreen,
// HistoryScreen, HistoryDetail, FamilyScreen, TopBar, Btn

/* ═══ Scored Game Info (shared components) ═══ */
var SCORED_INFO_TEXT = "Individually scored games are ones you play against the computer — like the Stuff Quiz or Wordle. Use this for games you're playing often and want to track against other players, but you don't need other players to compete with! These games give you a score, rather than a clear winner/loser. If you're currently the leader in a scored game, you'll take some points to the leaderboard! If you're not winning, they make no effect on the leaderboard points.";

function ScoredInfoModal({open, onClose}) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{...S.card,padding:24,maxWidth:360,width:"100%"}}>
        <div style={{fontSize:28,textAlign:"center",marginBottom:8}}>⭐</div>
        <h3 style={{textAlign:"center",fontFamily:"Georgia,serif",marginBottom:12,fontSize:18}}>About Scored Games</h3>
        <p style={{color:C.muted,fontSize:13,lineHeight:"1.5"}}>{SCORED_INFO_TEXT}</p>
        <div style={{marginTop:16}}><Btn full onClick={onClose}>Got it</Btn></div>
      </div>
    </div>
  );
}

function ScoredInfoIcon({light}) {
  const [open, setOpen] = useState(false);
  var hoverTimer = useRef(null);
  function handleEnter() { hoverTimer.current = setTimeout(function(){ setOpen(true); }, 400); }
  function handleLeave() { clearTimeout(hoverTimer.current); }
  return (
    <>
      <span
        onClick={function(e){ e.stopPropagation(); setOpen(true); }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,borderRadius:9,border:"1.5px solid "+(light?C.white:C.muted),color:light?C.white:C.muted,fontSize:11,fontWeight:900,cursor:"pointer",marginLeft:6,flexShrink:0,fontStyle:"italic",fontFamily:"Georgia,serif",lineHeight:1,verticalAlign:"middle"}}
      >i</span>
      {open && ReactDOM.createPortal(
        <ScoredInfoModal open={true} onClose={function(){ setOpen(false); }} />,
        document.body
      )}
    </>
  );
}

function ScoredInfoBlock() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div onClick={function(){ setOpen(true); }} style={{...S.card,background:C.lime,padding:"10px 14px",marginBottom:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:20,height:20,borderRadius:10,border:"1.5px solid "+C.muted,color:C.muted,fontSize:12,fontWeight:900,fontStyle:"italic",fontFamily:"Georgia,serif"}}>i</span>
        <span style={{fontSize:13,fontWeight:700,color:C.muted}}>About scored games</span>
      </div>
      <ScoredInfoModal open={open} onClose={function(){ setOpen(false); }} />
    </>
  );
}

function SetupScreen({state,dispatch}){
  const fu=state.familyUsers||{};const myName=state.user&&fu[state.user.userId]?fu[state.user.userId].displayName:((state.user && state.user.displayName)||null);
  const[gameKey,setGameKey]=useState(null);const[cats,setCats]=useState([""]);const[custName,setCustName]=useState("");const[custEmoji,setCustEmoji]=useState("🎲");const[showPick,setShowPick]=useState(false);
  const[teamMode,setTeamMode]=useState(false);const[numTeams,setNumTeams]=useState(2);
  const[teams,setTeams]=useState([{name:"Team 1",members:[]},{name:"Team 2",members:[]},{name:"Team 3",members:[]},{name:"Team 4",members:[]}]);
  const[solo,setSolo]=useState(()=>myName?[myName]:[]);const[newName,setNewName]=useState("");
  const[scoringType,setScoringType]=useState("standard");const[maxScoreInput,setMaxScoreInput]=useState("10");const[lowWins,setLowWins]=useState(false);
  const[deleteTarget,setDeleteTarget]=useState(null);const lp=useRef(null);const pc=useRef(false);
  const[gameFilter,setGameFilter]=useState("recent");
  const customRef=useRef(null);const modeRef=useRef(null);
  function hpd(k){if(BUILT_IN_GAMES[k])return;pc.current=false;lp.current=setTimeout(()=>{pc.current=true;setDeleteTarget(k)},600)}function hpu(){clearTimeout(lp.current)}
  const lastPlayed={};state.history.forEach(g=>{const k=g.gameKey==="custom"?gameName(g):g.gameKey;if(!lastPlayed[k])lastPlayed[k]=g.finishedAt||g.startedAt});
  const playCount={};state.history.forEach(g=>{if(!g.finished)return;const k=g.gameKey==="custom"?gameName(g):g.gameKey;playCount[k]=(playCount[k]||0)+1});
  const allGames={...BUILT_IN_GAMES};Object.entries(state.templates||{}).forEach(([k,t])=>{allGames[k]={...t,name:t.name||t.gameName||k}});
  const gameListAll=Object.entries(allGames).filter(([k])=>k!=="custom");
  const sortedGames=gameFilter==="alpha"
    ?[...gameListAll].sort(([,a],[,b])=>a.name.localeCompare(b.name))
    :gameFilter==="popular"
    ?[...gameListAll].sort(([ka],[kb])=>{const ca=playCount[ka]||0,cb=playCount[kb]||0;if(cb!==ca)return cb-ca;return a_name_cmp(allGames[ka],allGames[kb])})
    :[...gameListAll].sort(([ka],[kb])=>{const ta=lastPlayed[ka]||null,tb=lastPlayed[kb]||null;if(ta&&tb)return new Date(tb)-new Date(ta);if(ta)return -1;if(tb)return 1;return 0});
  function a_name_cmp(a,b){return(a.name||"").localeCompare(b.name||"")}
  const gameList=[["custom",allGames["custom"]||{name:"Custom Game",emoji:"✏️"}],...sortedGames];
  const knownPlayersRaw=state.history.flatMap(g=>{if(g.teams)return g.teams.flatMap(t=>t.members);return g.players.map(p=>rname(p,fu))});
  const knownPlayersSeen={};const knownPlayers=[];
    knownPlayersRaw.forEach(function(n){const key=n.trim().toLowerCase();if(!knownPlayersSeen[key]){knownPlayersSeen[key]=n;knownPlayers.push(n)}});
  const freq=getFreqPlayers(state.history,(state.user && state.user.userId),5);
  const allPoolRaw=[...(myName?[myName]:[]),...freq,...knownPlayers,...teams.flatMap(t=>t.members),...solo];
  const allPoolSeen={};const allPool=[];
  allPoolRaw.forEach(function(n){const key=n.trim().toLowerCase();if(!allPoolSeen[key]){allPoolSeen[key]=n;allPool.push(n)}});  const selectedDef=gameKey?allGames[gameKey]:null;const isIndependent=gameKey==="custom"?scoringType==="independent":(selectedDef && selectedDef.scoringType)==="independent";
  function pickGame(k){if(pc.current)return;setGameKey(k);const def=allGames[k];setCats(k!=="custom"&&(def && def.categories)&&def.scoringType!=="independent"?def.categories:[""]);setCustEmoji((def && def.emoji)||"🎲");if(k!=="custom"&&(def && def.scoringType))setScoringType(def.scoringType);if(k!=="custom"&&(def && def.maxScore))setMaxScoreInput(String(def.maxScore));setLowWins(!!((def && def.lowWins)));setTimeout(function(){var target=k==="custom"?customRef.current:modeRef.current;if(target)target.scrollIntoView({behavior:"smooth",block:"start"})},100)}
  function toggleSolo(n){setSolo(p=>p.includes(n)?p.filter(x=>x!==n):[...p,n])}
  function assignTeam(name,ti){setTeams(prev=>prev.map((t,i)=>{if(i===ti)return t.members.includes(name)?{...t,members:t.members.filter(m=>m!==name)}:{...t,members:[...t.members,name]};return{...t,members:t.members.filter(m=>m!==name)}}))}
  function addNew(){const n=newName.trim();if(!n)return;setNewName("");if(teamMode){const ti=teams.slice(0,numTeams).reduce((mi,t,i,arr)=>t.members.length<arr[mi].members.length?i:mi,0);setTeams(prev=>prev.map((t,i)=>i===ti?{...t,members:[...t.members,n]}:t))}else{setSolo(p=>p.includes(n)?p:[...p,n])}}
  const activeTeams=teams.slice(0,numTeams).filter(t=>t.members.length>0);const validCats=cats.map((c,i)=>c.trim()||`Round ${i+1}`);
  const canStart=gameKey&&(teamMode?activeTeams.length>=2:solo.length>=1);
  const filterIcon=<svg width="14" height="14" viewBox="0 0 14 14" style={{verticalAlign:"middle",marginRight:4}}><line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><line x1="5" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
  const filters=[{id:"recent",label:"Recent"},{id:"alpha",label:"A–Z"},{id:"popular",label:"Popular"}];
  return(<div style={{padding:"20px 20px 100px"}}>
    <TopBar title="New Game" onBack={()=>dispatch({type:"GO",screen:"home"})}/>
    <h3 style={secHead}>Choose Game</h3>
    <div style={{display:"flex",gap:6,marginBottom:12}}>{filters.map(f=><button key={f.id} onClick={()=>setGameFilter(f.id)} style={{display:"flex",alignItems:"center",background:gameFilter===f.id?C.ink:C.card,color:gameFilter===f.id?C.white:C.ink,border:"2px solid "+C.ink,borderRadius:16,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>{gameFilter===f.id&&filterIcon}{f.label}</button>)}</div>
    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>{gameList.map(([k,g])=>{const isCustom=k==="custom";const isBI=!!BUILT_IN_GAMES[k];const isSelected=gameKey===k;const cardBg=isSelected?C.tomato:isCustom?C.lime:C.card;const subtextColor=isSelected?"rgba(255,255,255,0.8)":isCustom?C.muted:C.muted;const mainColor=isSelected?C.white:C.ink;return(<div key={k} onClick={()=>pickGame(k)} onPointerDown={()=>hpd(k)} onPointerUp={hpu} onPointerLeave={hpu} onPointerCancel={hpu} onContextMenu={e=>{if(!isBI&&!isCustom)e.preventDefault()}} style={{...S.card,background:cardBg,padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,userSelect:"none",WebkitUserSelect:"none"}}><span style={{fontSize:26}}>{g.emoji}</span><div style={{flex:1}}><div style={{fontSize:15,fontWeight:700,fontFamily:"Georgia,serif",color:mainColor}}>{isCustom?"✨ Custom Game":g.name}{!isCustom&&g.scoringType==="independent"?<span style={{fontSize:11,opacity:0.7,marginLeft:6}}>(scored) <ScoredInfoIcon light={isSelected} /></span>:""}</div><div style={{fontSize:11,color:subtextColor,marginTop:2}}>{isCustom?"Create your own game":(lastPlayed[k]?`Last played ${new Date(lastPlayed[k]).toLocaleDateString()}`:"Not played yet")+(playCount[k]?` · ${playCount[k]}×`:"")}{!isBI&&!isCustom&&<span style={{marginLeft:6,opacity:0.5}}>· hold to delete</span>}</div></div>{isSelected&&<span style={{color:C.white,fontWeight:700}}>✓</span>}<TierBadge tier={k==="custom"?null:g.tier}/></div>)})}</div>
    {gameKey==="custom"&&<div ref={customRef} style={{...S.limeCard,padding:16,marginBottom:24}}>
      <h3 style={{...secHead,marginBottom:10}}>Custom Game</h3>
      <div style={{display:"flex",gap:8,marginBottom:8}}><button onClick={()=>setShowPick(p=>!p)} style={{fontSize:24,background:C.white,border:"2px solid "+C.ink,borderRadius:10,padding:"10px 12px",cursor:"pointer"}}>{custEmoji}</button><input style={{...inp,flex:1}} placeholder="Game name" value={custName} onChange={e=>setCustName(e.target.value)}/></div>
      {showPick&&<div style={{display:"flex",flexWrap:"wrap",gap:6,background:C.white,borderRadius:10,padding:10,marginBottom:10,border:"2px solid "+C.ink}}>{EMOJI_OPTIONS.map(e=><button key={e} onClick={()=>{setCustEmoji(e);setShowPick(false)}} style={{fontSize:22,background:custEmoji===e?C.tomato:"transparent",border:"none",borderRadius:6,padding:"4px 6px",cursor:"pointer"}}>{e}</button>)}</div>}
      <h3 style={{...secHead,marginTop:12,marginBottom:8}}>Scoring Type</h3>
      <div style={{display:"flex",gap:10,marginBottom:16}}>{[{v:"standard",l:"📊 Standard"},{v:"independent",l:"⭐ Independent"}].map(({v,l})=><button key={v} onClick={()=>setScoringType(v)} style={{flex:1,padding:"12px 0",fontSize:13,fontWeight:700,background:scoringType===v?C.tomato:C.white,color:scoringType===v?C.white:C.ink,border:"2px solid "+C.ink,borderRadius:10,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{l}{v==="independent"&&<ScoredInfoIcon light={scoringType==="independent"} />}</button>)}</div>
      {scoringType==="standard"?<div><h3 style={{...secHead,marginBottom:8}}>Score Categories</h3>{cats.map((c,i)=><input key={i} style={{...inp,marginBottom:8}} placeholder={`Round ${i+1}`} value={c} onChange={e=>setCats(cats.map((x,j)=>j===i?e.target.value:x))}/>)}<Btn onClick={()=>setCats(c=>[...c,""])}>+ Add Round</Btn>
        <div onClick={()=>setLowWins(v=>!v)} style={{display:"flex",alignItems:"center",gap:10,marginTop:16,cursor:"pointer"}}><div style={{width:28,height:28,borderRadius:8,border:"2px solid "+C.ink,background:lowWins?C.tomato:C.white,display:"flex",alignItems:"center",justifyContent:"center",color:C.white,fontSize:16,fontWeight:900,flexShrink:0}}>{lowWins?"✓":""}</div><div><div style={{fontWeight:700,fontSize:14}}>Lowest score wins</div><div style={{fontSize:11,color:C.muted}}>Player with lowest total wins</div></div></div>
      </div>:<div><h3 style={{...secHead,marginBottom:8}}>Max Score</h3><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:14,fontWeight:700}}>Out of</span><input type="number" inputMode="numeric" style={{...inp,width:80,textAlign:"center"}} value={maxScoreInput} onChange={e=>setMaxScoreInput(e.target.value)}/></div><p style={{color:C.muted,fontSize:11,marginTop:8}}>Each player rates once. Leader earns a leaderboard win.</p></div>}
    </div>}
    <h3 ref={modeRef} style={secHead}>Mode</h3>
    <div style={{display:"flex",gap:10,marginBottom:24}}>{[{v:false,l:"👤 Individual"},{v:true,l:"👥 Team Mode"}].map(({v,l})=><button key={String(v)} onClick={()=>setTeamMode(v)} style={{flex:1,padding:"14px 0",fontSize:14,fontWeight:700,background:teamMode===v?C.tomato:C.card,color:teamMode===v?C.white:C.ink,border:"2px solid "+C.ink,borderRadius:12,cursor:"pointer",boxShadow:teamMode===v?"3px 3px 0 "+C.ink:"none"}}>{l}</button>)}</div>
    {!teamMode&&<div style={{...S.card,padding:16,marginBottom:24}}>
      <h3 style={{...secHead,marginBottom:12}}>Select Players</h3>
      {allPool.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>{allPool.map(n=><button key={n} onClick={()=>toggleSolo(n)} style={{background:solo.includes(n)?C.tomato:C.white,border:"2px solid "+(n===myName?"#3498db":C.ink),color:solo.includes(n)?C.white:C.ink,borderRadius:20,padding:"7px 16px",fontSize:13,cursor:"pointer",fontWeight:700}}>{solo.includes(n)?"✓ ":""}{n}{n===myName?" (you)":""}</button>)}</div>}
      <div style={{display:"flex",gap:8}}><input style={{...inp,flex:1}} placeholder="Add player…" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNew()}/><Btn primary onClick={addNew}>Add</Btn></div>
    </div>}
    {teamMode&&<div style={{...S.card,padding:16,marginBottom:24}}>
      <h3 style={{...secHead,marginBottom:10}}>Teams</h3>
      <div style={{display:"flex",gap:8,marginBottom:20}}>{[2,3,4].map(n=><button key={n} onClick={()=>setNumTeams(n)} style={{flex:1,padding:"10px 0",fontSize:15,fontWeight:700,background:numTeams===n?C.tomato:C.white,color:numTeams===n?C.white:C.ink,border:"2px solid "+C.ink,borderRadius:10,cursor:"pointer"}}>{n}</button>)}</div>
      <h3 style={{...secHead,marginBottom:10}}>Team Names</h3>
      {teams.slice(0,numTeams).map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><span style={{fontSize:20}}>{TE[i]}</span><input style={{...inp,flex:1,borderColor:TC[i]}} value={t.name} onChange={e=>setTeams(prev=>prev.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/></div>)}
      <h3 style={{...secHead,marginTop:20,marginBottom:10}}>Assign Players</h3>
      {allPool.length===0&&<p style={{color:C.muted,fontSize:13,marginBottom:8}}>Add players below.</p>}
      {allPool.map(name=>{const ti=teams.slice(0,numTeams).findIndex(t=>t.members.includes(name));return(<div key={name} style={{display:"flex",alignItems:"center",gap:8,background:C.white,border:"2px solid "+C.ink,borderRadius:10,padding:"10px 12px",marginBottom:8}}><span style={{flex:1,fontSize:14,fontWeight:700}}>{name}{name===myName?" (you)":""}</span><div style={{display:"flex",gap:6}}>{teams.slice(0,numTeams).map((t,i)=><button key={i} onClick={()=>assignTeam(name,i)} style={{width:34,height:34,borderRadius:8,border:"2px solid "+(ti===i?TC[i]:C.ink),background:ti===i?TC[i]:C.white,color:ti===i?C.white:C.ink,fontSize:16,cursor:"pointer",fontWeight:700}}>{TE[i]}</button>)}</div></div>)})}
      <div style={{display:"flex",gap:8,marginTop:12}}><input style={{...inp,flex:1}} placeholder="Add player…" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNew()}/><Btn primary onClick={addNew}>Add</Btn></div>
      <div style={{marginTop:16}}>{teams.slice(0,numTeams).map((t,i)=><div key={i} style={{borderLeft:"4px solid "+TC[i],paddingLeft:12,marginBottom:8}}><span style={{fontWeight:700,color:TC[i]}}>{TE[i]} {t.name}</span><span style={{color:C.muted,fontSize:12,marginLeft:8}}>{t.members.length?t.members.join(", "):"Empty"}</span></div>)}</div>
    </div>}
    <Btn full primary disabled={!canStart} onClick={()=>dispatch({type:"START_GAME",gameKey,players:teamMode?teams.slice(0,numTeams).map(t=>t.name):solo,cats:validCats,customName:custName,customEmoji:custEmoji,teamMode,teams:teamMode?teams.slice(0,numTeams):null,scoringType:isIndependent?"independent":"standard",maxScore:isIndependent?(parseInt(maxScoreInput)||50):null,lowWins:isIndependent?false:lowWins})}>Start Game →</Btn>
    {deleteTarget&&(()=>{const hasHist=state.history.some(g=>{const gk=g.gameKey==="custom"?gameName(g):g.gameKey;return gk===deleteTarget});const tgt=allGames[deleteTarget];return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}} onClick={()=>setDeleteTarget(null)}><div style={{...S.card,padding:24,maxWidth:340,width:"100%"}} onClick={e=>e.stopPropagation()}><div style={{fontSize:32,textAlign:"center",marginBottom:8}}>{(tgt && tgt.emoji)||"🎲"}</div><h3 style={{textAlign:"center",fontFamily:"Georgia,serif",marginBottom:12,fontSize:18}}>Delete "{(tgt && tgt.name)||deleteTarget}"?</h3>{hasHist?<p style={{color:C.tomato,fontSize:13,marginBottom:16,textAlign:"center",fontWeight:700}}>⚠️ Past scores still count.</p>:<p style={{color:C.muted,fontSize:13,marginBottom:16,textAlign:"center"}}>Removes from everyone's list.</p>}<div style={{display:"flex",gap:10}}><Btn full onClick={()=>setDeleteTarget(null)}>Cancel</Btn><Btn full onClick={()=>{dispatch({type:"DELETE_TEMPLATE",key:deleteTarget});setDeleteTarget(null);if(gameKey===deleteTarget)setGameKey(null)}} style={{background:"#fde8e8",color:"#c0392b",borderColor:"#c0392b"}}>Delete</Btn></div></div></div>)})()}
  </div>);
}

function GameScreen({state,dispatch,finishGame}){const game=state.current;const[newCat,setNewCat]=useState("");const[showAdd,setShowAdd]=useState(false);const[capturing,setCapturing]=useState(false);const[catIdx,setCatIdx]=useState(0);if(!game)return null;const isInd=game.scoringType==="independent";const lowW=!!game.lowWins;const isTeam=game.teamMode&&game.teams;if(capturing)return<CaptureScores game={game} dispatch={dispatch} finishGame={finishGame} catIdx={catIdx} setCatIdx={setCatIdx} onBack={()=>setCapturing(false)} lowWins={lowW}/>;const sortFn=lowW?(a,b)=>a.total-b.total:(a,b)=>b.total-a.total;const rows=isTeam?game.teams.map((t,i)=>{const tp=game.players.find(p=>p.name===t.name);return{label:t.name,sub:t.members.join(", "),total:tp?calcTotal(tp):0,color:TC[i]}}).sort(sortFn):game.players.map(p=>({label:p.name,sub:null,total:calcTotal(p),color:null})).sort(sortFn);const bestTotal=(rows[0] ? rows[0].total : 0);const maxLT=Math.max(...rows.map(r=>r.total),1);return(<div style={{padding:"20px 20px 180px"}}><TopBar title={`${gameEmoji(game)} ${gameName(game)}`} onBack={()=>dispatch({type:"GO",screen:"home"})}/>{lowW&&<div style={{background:C.lime,border:"2px solid "+C.ink,borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.muted,textAlign:"center"}}>⬇️ Lowest score wins</div>}{isInd&&<div style={{background:C.lime,border:"2px solid "+C.ink,borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.muted,textAlign:"center"}}>⭐ Rate out of {game.maxScore}</div>}<div style={{...S.limeCard,padding:16,marginBottom:16}}><div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:2,marginBottom:12}}>Live Scores</div>{rows.map(({label,sub,total,color})=>{const isLeader=total===bestTotal;return(<div key={label} style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontWeight:700}}>{isLeader?"🏆 ":""}<span style={{color:color||C.ink}}>{label}</span>{sub&&<span style={{fontSize:11,color:C.muted,marginLeft:6}}>({sub})</span>}</span><span style={{fontWeight:900,color:isLeader?C.tomato:C.ink}}>{isInd?`${total}/${game.maxScore}`:total}</span></div><div style={{height:8,background:"rgba(0,0,0,0.15)",borderRadius:4,overflow:"hidden",border:"1px solid "+C.ink}}><div style={{height:"100%",width:`${maxLT>0?(total/maxLT)*100:0}%`,background:color||(isLeader?C.tomato:C.ink),borderRadius:4,transition:"width 0.3s"}}/></div></div>)})}</div><button onClick={()=>setCapturing(true)} style={{width:"100%",marginBottom:16,padding:"14px",fontSize:15,fontWeight:900,borderRadius:14,border:"2px solid "+C.ink,cursor:"pointer",background:C.tomato,color:C.white,boxShadow:"3px 3px 0 "+C.ink}}>📝 Capture Scores</button><div style={{...S.card,overflow:"hidden",padding:0,marginBottom:8}}><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}><thead><tr style={{background:C.ink}}><th style={{textAlign:"left",padding:"10px 12px",color:C.white,fontWeight:700,fontSize:12}}>{isInd?"PLAYER":"CATEGORY"}</th>{isInd?<th style={{padding:"10px 8px",fontSize:12,textAlign:"center",color:C.white}}>/{game.maxScore}</th>:game.players.map(p=><th key={p.name} style={{padding:"10px 8px",fontSize:12,textAlign:"center",minWidth:60,color:C.white}}>{p.name}</th>)}</tr></thead><tbody>{isInd?game.players.map((p,pi)=><tr key={p.name} style={{background:pi%2===0?C.white:C.card}}><td style={{padding:"8px 12px",fontWeight:700}}>{p.name}</td><td style={{padding:4,textAlign:"center"}}><input type="number" inputMode="decimal" step="any" style={{width:74,background:C.white,border:"2px solid "+C.ink,borderRadius:8,textAlign:"center",padding:"8px 4px",fontSize:15,fontWeight:700}} value={p.scores.Score} onChange={e=>dispatch({type:"SET_SCORE",pi,cat:"Score",val:e.target.value})}/></td></tr>):game.categories.map((cat,ci)=><tr key={cat} style={{background:ci%2===0?C.white:C.card}}><td style={{padding:"8px 12px",fontWeight:700}}>{cat}</td>{game.players.map((p,pi)=><td key={p.name} style={{padding:4,textAlign:"center"}}><input type="number" inputMode="numeric" style={{width:54,background:C.white,border:"2px solid "+C.ink,borderRadius:8,textAlign:"center",padding:"8px 4px",fontSize:15,fontWeight:700}} value={p.scores[cat]} onChange={e=>dispatch({type:"SET_SCORE",pi,cat,val:e.target.value})}/></td>)}</tr>)}{!isInd&&<tr style={{background:C.tomato}}><td style={{padding:"10px 12px",fontWeight:900,color:C.white,fontFamily:"Georgia,serif"}}>TOTAL</td>{game.players.map((p,pi)=><td key={p.name} style={{textAlign:"center",fontWeight:900,color:C.white,fontSize:18,fontFamily:"Georgia,serif"}}>{calcTotal(p)}</td>)}</tr>}</tbody></table></div></div>{!isInd&&(showAdd?<div style={{marginTop:12,display:"flex",gap:8}}><input style={{...inp,flex:1}} placeholder="Category name" value={newCat} onChange={e=>setNewCat(e.target.value)}/><Btn primary onClick={()=>{if(newCat.trim()){dispatch({type:"ADD_CATEGORY",cat:newCat.trim()});setNewCat("");setShowAdd(false)}}}>Add</Btn></div>:<Btn onClick={()=>setShowAdd(true)} style={{marginTop:12}}>+ Add Row</Btn>)}<div style={{position:"fixed",bottom:56,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,padding:"12px 20px",background:C.card,borderTop:"3px solid "+C.ink}}><Btn full primary onClick={finishGame}>✅ Finish {"&"} Save Game</Btn></div></div>);}

function CaptureScores({game,dispatch,finishGame,catIdx,setCatIdx,onBack,lowWins}){const isInd=game.scoringType==="independent";const isTeam=game.teamMode&&game.teams;const cat=game.categories[catIdx]||game.categories[0];const maxVal=isInd?(game.maxScore||50):Infinity;return(<div style={{padding:"0 0 140px"}}><div onClick={onBack} style={{background:C.lime,color:C.ink,textAlign:"center",padding:"14px",fontSize:15,fontWeight:900,cursor:"pointer",borderBottom:"2px solid "+C.ink}}>🏆 Live Score Overview</div>{game.categories.length>1&&<div style={{textAlign:"center",padding:"16px 20px 8px"}}><div style={{fontSize:11,color:C.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:2}}>Scoring Category</div><div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12}}><button onClick={()=>setCatIdx(i=>(i-1+game.categories.length)%game.categories.length)} style={{width:40,height:40,borderRadius:20,border:"2px solid "+C.ink,background:C.card,fontSize:18,cursor:"pointer",fontWeight:900}}>◀</button><div style={{minWidth:120}}><div style={{fontSize:18,fontWeight:900,fontFamily:"Georgia,serif"}}>{cat}</div><div style={{fontSize:11,color:C.muted}}>{catIdx+1} of {game.categories.length}</div></div><button onClick={()=>setCatIdx(i=>(i+1)%game.categories.length)} style={{width:40,height:40,borderRadius:20,border:"2px solid "+C.ink,background:C.card,fontSize:18,cursor:"pointer",fontWeight:900}}>▶</button></div></div>}{lowWins&&<div style={{textAlign:"center",padding:"8px 16px",fontSize:11,color:C.muted}}>⬇️ Lowest score wins</div>}<div style={{padding:"12px 16px"}}>{game.players.map((p,pi)=>{const ci=isTeam?game.teams.findIndex(t=>t.name===p.name):pi;const dark=TC[ci%TC.length];const light=TCL[ci%TCL.length];const score=parseFloat(p.scores[cat])||0;const teamMembers=isTeam?(game.teams[ci] && game.teams[ci].members):null;return(<div key={p.name} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",borderRadius:12,marginBottom:8,background:pi%2===0?C.card:C.white,border:"2px solid "+C.ink}}><div style={{flex:1,minWidth:0}}><div style={{fontWeight:900,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>{teamMembers&&<div style={{fontSize:10,color:C.muted}}>{teamMembers.join(", ")}</div>}</div><button onClick={()=>{if(score>0)dispatch({type:"SET_SCORE",pi,cat,val:String(Math.max(0,score-1))})}} style={{width:44,height:44,borderRadius:10,border:"2px solid "+C.ink,background:light,color:C.ink,fontSize:22,fontWeight:900,cursor:score<=0?"not-allowed":"pointer",opacity:score<=0?0.4:1,flexShrink:0}}>−</button><button onClick={()=>{if(score<maxVal)dispatch({type:"SET_SCORE",pi,cat,val:String(Math.min(maxVal,score+1))})}} style={{width:44,height:44,borderRadius:10,border:"2px solid "+C.ink,background:dark,color:C.white,fontSize:22,fontWeight:900,cursor:score>=maxVal?"not-allowed":"pointer",opacity:score>=maxVal?0.4:1,flexShrink:0}}>+</button><input type="number" inputMode="decimal" step="any" value={p.scores[cat]} onChange={e=>dispatch({type:"SET_SCORE",pi,cat,val:e.target.value})} style={{width:64,background:C.white,border:"2px solid "+C.ink,borderRadius:10,color:C.ink,textAlign:"center",padding:"10px 4px",fontSize:16,fontWeight:900,flexShrink:0}}/></div>)})}</div><div style={{padding:"16px",position:"fixed",bottom:56,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:C.card,borderTop:"3px solid "+C.ink}}><Btn full primary onClick={()=>{onBack();finishGame()}}>✅ Finish {"&"} Save</Btn></div></div>);}

function LeaderboardScreen({state}){const fu=state.familyUsers||{};const[tab,setTab]=useState("topPlayer");const[indGame,setIndGame]=useState(null);const[openMonth,setOpenMonth]=useState(null);const[selectedPlayer,setSelectedPlayer]=useState(null);const[selectedIndPlayer,setSelectedIndPlayer]=useState(null);const now=new Date();const lb=buildLeaderboardForMonth(state.history,fu,now.getFullYear(),now.getMonth());const indGameKeys={};state.history.forEach(g=>{if(g.finished&&g.scoringType==="independent"){const k=g.gameKey==="custom"?gameName(g):g.gameKey;if(!indGameKeys[k])indGameKeys[k]={name:gameName(g),emoji:gameEmoji(g)}}});Object.entries(state.templates||{}).forEach(([k,t])=>{if(t.scoringType==="independent"&&!indGameKeys[k])indGameKeys[k]={name:t.name||t.gameName||k,emoji:t.emoji||"⭐"}});const indList=Object.entries(indGameKeys);const activeInd=indGame||(indList[0] ? indList[0][0] : null)||null;const tabs=[{id:"topPlayer",icon:"⭐",label:"Top",sort:(a,b)=>b.points-a.points,val:p=>`${p.points}pts`,sub:"Total points"},{id:"mostWins",icon:"🏆",label:"Wins",sort:(a,b)=>b.wins-a.wins,val:p=>`${p.wins%1===0?p.wins:p.wins.toFixed(2)}W`,sub:"Total wins"},{id:"topTime",icon:"🎮",label:"Games",sort:(a,b)=>b.games-a.games,val:p=>`${p.games}G`,sub:"Most played"},{id:"independent",icon:"⭐",label:"Scored",sort:null,val:null,sub:"Independent scoring"}];const cur=tabs.find(t=>t.id===tab);if(!lb.length&&!indList.length)return<div style={{padding:"20px 20px 80px"}}><h2 style={{fontFamily:"Georgia,serif",fontWeight:900,marginBottom:2}}>🏆 Leaderboard</h2><div style={{fontSize:12,color:C.muted,marginBottom:16}}>{MNAMES[now.getMonth()]} {now.getFullYear()} Season</div><p style={{color:C.muted,textAlign:"center",marginTop:60}}>Play some games first!</p></div>;const sorted=lb.length&&cur.sort?[...lb].sort(cur.sort):[];const ranks=sorted.length?getRanks(sorted,p=>tab==="topPlayer"?p.points:tab==="mostWins"?p.wins:p.games):[];const indR=tab==="independent"&&activeInd?buildIndependentRankings(state.history,activeInd,fu):[];const indRanks=indR.length?getRanks(indR,p=>p.effective):[];return(<div style={{padding:"20px 20px 80px"}}><h2 style={{fontFamily:"Georgia,serif",fontWeight:900,marginBottom:2}}>🏆 Leaderboard</h2><div style={{fontSize:12,color:C.muted,marginBottom:16}}>{MNAMES[now.getMonth()]} {now.getFullYear()} Season</div><div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:12,marginBottom:20}}>{tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{flexShrink:0,background:tab===t.id?C.tomato:C.card,border:"2px solid "+C.ink,color:tab===t.id?C.white:C.ink,borderRadius:20,padding:"8px 14px",fontSize:12,cursor:"pointer",fontWeight:700,boxShadow:tab===t.id?"2px 2px 0 "+C.ink:"none"}}>{t.icon} {t.label}</button>)}</div>{tab!=="independent"&&sorted.length>0&&<>{sorted.length>=3&&(()=>{const po=[sorted[1],sorted[0],sorted[2]];const pr=[ranks[1],ranks[0],ranks[2]];const baseH={1:130,2:90,3:75};const heights=pr.map(r=>baseH[r]||60);const bgs=[C.bg,C.lime,C.card];return(<div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:8,marginBottom:24,height:150}}>{po.map((p,ri)=><div key={p.key} onClick={()=>setSelectedPlayer(p)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",cursor:"pointer"}}><div style={{fontSize:12,textAlign:"center",fontWeight:700,marginBottom:2}}>{p.name}</div><div style={{fontSize:12,color:C.tomato,fontWeight:900,marginBottom:4}}>{cur.val(p)}</div><div style={{width:"100%",height:heights[ri],background:bgs[ri],border:"2px solid "+C.ink,borderRadius:"8px 8px 0 0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>{medal(pr[ri])}</div></div>)}</div>)})()}<h3 style={{...secHead,marginBottom:12}}>{cur.sub}</h3>{sorted.map((p,i)=><div key={p.key} onClick={()=>setSelectedPlayer(p)} style={{...S.card,padding:"12px 16px",marginBottom:10,display:"flex",alignItems:"center",gap:12,cursor:"pointer",background:ranks[i]===1?C.lime:C.card}}><span style={{fontSize:22,width:28,textAlign:"center"}}>{medal(ranks[i])}</span><div style={{flex:1}}><div style={{fontWeight:900,fontFamily:"Georgia,serif",fontSize:16}}>{p.name}</div><div style={{fontSize:11,color:C.muted}}>{p.wins%1===0?p.wins:p.wins.toFixed(2)}W / {p.games}G</div></div><div style={{fontWeight:900,color:C.tomato,fontSize:20,fontFamily:"Georgia,serif"}}>{cur.val(p)}</div></div>)}</>}{tab==="independent"&&<div>{indList.length===0?<p style={{color:C.muted,textAlign:"center",marginTop:40}}>No scored games yet.</p>:<div><select value={activeInd||""} onChange={e=>setIndGame(e.target.value)} style={{...inp,marginBottom:20,fontSize:14}}>{indList.map(([k,{name,emoji}])=><option key={k} value={k}>{emoji} {name}</option>)}</select><ScoredInfoBlock />{indR.length===0?<p style={{color:C.muted,textAlign:"center"}}>No games yet.</p>:indR.map((p,i)=><div key={p.name} onClick={()=>setSelectedIndPlayer(p)} style={{...S.card,padding:"12px 16px",marginBottom:10,display:"flex",alignItems:"center",gap:12,cursor:"pointer",background:indRanks[i]===1?C.lime:C.card}}><span style={{fontSize:22,width:28,textAlign:"center"}}>{medal(indRanks[i])}</span><div style={{flex:1}}><div style={{fontWeight:900,fontFamily:"Georgia,serif",fontSize:16}}>{p.name}</div><div style={{fontSize:11,color:C.muted}}>{p.count}G · avg {p.avg.toFixed(1)}/{p.maxScore}{p.lastPlayed&&<span> · {new Date(p.lastPlayed).toLocaleDateString()}</span>}</div></div><div style={{textAlign:"right"}}><div style={{fontWeight:900,color:C.tomato,fontSize:18,fontFamily:"Georgia,serif"}}>{p.effective.toFixed(1)}</div><div style={{fontSize:10,color:C.muted}}>eff</div></div></div>)}</div>}</div>}<HistoricalWins history={state.history} fu={fu} openMonth={openMonth} setOpenMonth={setOpenMonth}/>{selectedPlayer&&<PlayerPopup player={selectedPlayer} history={state.history} fu={fu} now={now} onClose={()=>setSelectedPlayer(null)}/>}{selectedIndPlayer&&<IndPlayerPopup player={selectedIndPlayer} history={state.history} fu={fu} now={now} activeInd={activeInd} indGameKeys={indGameKeys} onClose={()=>setSelectedIndPlayer(null)}/>}</div>);}

function PlayerPopup({player, history, fu, now, onClose}) {
  const curLb = buildLeaderboardForMonth(history, fu, now.getFullYear(), now.getMonth());
  const curPlayer = curLb.find(function(p) { return p.key === player.key; });
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const priorPlacements = [];
  let y = 2025, m = 3;
  while (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth())) {
    const mlb = buildLeaderboardForMonth(history, fu, y, m);
    const sorted = [...mlb].sort(function(a, b) { return b.points - a.points; });
    const ranks = sorted.length ? getRanks(sorted, function(p) { return p.points; }) : [];
    const idx = sorted.findIndex(function(p) { return p.key === player.key; });
    if (idx >= 0 && ranks[idx] <= 3) priorPlacements.push({ year: y, month: m, rank: ranks[idx] });
    m++; if (m > 11) { m = 0; y++; }
  }
  priorPlacements.reverse();
  const T = { 1: "🥇", 2: "🥈", 3: "🥉" };
  const TBG = { 1: "#FFFACC", 2: "#F4F4F4", 3: "#FDF0E0" };
  const TBorder = { 1: "#D4A017", 2: "#999999", 3: "#CD7F32" };
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}}>
      <div onClick={function(e) { e.stopPropagation(); }} style={{...S.card,padding:24,maxWidth:380,width:"100%",maxHeight:"80vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontFamily:"Georgia,serif",fontWeight:900,fontSize:22}}>{player.name}</div>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:C.muted,padding:4}}>✕</button>
        </div>
        {curPlayer
          ? <div style={{...S.limeCard,padding:14,marginBottom:20}}>
              <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:2,marginBottom:10}}>{MNAMES[now.getMonth()]} {now.getFullYear()} · Current Season</div>
              <div style={{display:"flex",gap:24,marginBottom:8}}>
                <div><div style={{fontSize:24,fontWeight:900,fontFamily:"Georgia,serif"}}>{curPlayer.points}</div><div style={{fontSize:11,color:C.muted}}>pts</div></div>
                <div><div style={{fontSize:24,fontWeight:900,fontFamily:"Georgia,serif"}}>{curPlayer.wins % 1 === 0 ? curPlayer.wins : curPlayer.wins.toFixed(2)}</div><div style={{fontSize:11,color:C.muted}}>wins</div></div>
                <div><div style={{fontSize:24,fontWeight:900,fontFamily:"Georgia,serif"}}>{curPlayer.games}</div><div style={{fontSize:11,color:C.muted}}>games</div></div>
              </div>
              <div style={{fontSize:11,color:C.muted}}>{daysLeft} day{daysLeft !== 1 ? "s" : ""} left this season</div>
            </div>
          : <div style={{...S.card,padding:14,marginBottom:20,textAlign:"center"}}><p style={{color:C.muted,fontSize:13,margin:0}}>No games played this month yet.</p></div>
        }
        {(function() {
          var badges = computeBadges(player.key, history, fu);
          return (
            <div style={{background:"#fde8e8",border:"2px solid "+C.ink,borderRadius:14,boxShadow:"3px 3px 0 "+C.ink,padding:14,marginBottom:20}}>
              <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:2,marginBottom:10}}>Badges</div>
              {badges.length === 0
                ? <p style={{color:C.muted,fontSize:13,margin:0,textAlign:"center"}}>No badges earned yet.</p>
                : <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                    {badges.map(function(b) {
                      return (
                        <div key={b.key} style={{background:C.white,border:"2px solid "+C.ink,borderRadius:10,padding:"8px 12px",display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:20}}>{b.emoji}</span>
                          <span style={{fontSize:12,fontWeight:700}}>{b.name}</span>
                        </div>
                      );
                    })}
                  </div>
              }
            </div>
          );
        })()}
        {priorPlacements.length > 0
          ? <>
              <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:2,marginBottom:10}}>Past Podiums</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {priorPlacements.map(function(pl) {
                  return (
                    <div key={pl.year + "-" + pl.month} style={{background:TBG[pl.rank],border:"2px solid "+TBorder[pl.rank],borderRadius:10,padding:"8px 12px",textAlign:"center",minWidth:72}}>
                      <div style={{fontSize:22}}>{T[pl.rank]}</div>
                      <div style={{fontSize:12,fontWeight:700,fontFamily:"Georgia,serif"}}>{MNAMES[pl.month].slice(0, 3)}</div>
                      <div style={{fontSize:10,color:C.muted}}>{pl.year}</div>
                    </div>
                  );
                })}
              </div>
            </>
          : <p style={{color:C.muted,fontSize:13,textAlign:"center"}}>No prior podium finishes yet.</p>
        }
      </div>
    </div>
  );
}

function IndPlayerPopup({player, history, fu, now, activeInd, indGameKeys, onClose}) {
  const gameInfo = (indGameKeys && indGameKeys[activeInd]) || { name: activeInd || "Game", emoji: "⭐" };
  const plays = [];
  history.forEach(function(g) {
    if (!g.finished || g.scoringType !== "independent") return;
    const gk = g.gameKey === "custom" ? gameName(g) : g.gameKey;
    if (gk !== activeInd) return;
    const d = new Date(g.finishedAt || g.startedAt);
    if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return;
    g.players.forEach(function(p) {
      if (pkey(p) !== player.key) return;
      const sc = parseFloat(p.scores && p.scores.Score) || 0;
      plays.push({ score: sc, maxScore: g.maxScore || player.maxScore || 10, date: g.finishedAt || g.startedAt });
    });
  });
  plays.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
  const totalScore = plays.reduce(function(s, p) { return s + p.score; }, 0);
  const totalMax = plays.reduce(function(s, p) { return s + p.maxScore; }, 0);
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}}>
      <div onClick={function(e) { e.stopPropagation(); }} style={{...S.card,padding:24,maxWidth:380,width:"100%",maxHeight:"80vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontFamily:"Georgia,serif",fontWeight:900,fontSize:22}}>{player.name}</div>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:C.muted,padding:4}}>✕</button>
        </div>
        <div style={{fontSize:11,color:C.muted,marginBottom:16}}>{gameInfo.emoji} {gameInfo.name} · {MNAMES[now.getMonth()]} {now.getFullYear()}</div>
        {plays.length === 0
          ? <p style={{color:C.muted,fontSize:13,textAlign:"center"}}>No plays this month yet.</p>
          : <>
              {plays.map(function(play, i) {
                return (
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:i < plays.length - 1 ? "1px solid " + C.ink + "20" : "none"}}>
                    <span style={{fontSize:13,color:C.muted}}>{new Date(play.date).toLocaleDateString("en-GB", {day:"numeric", month:"short"})}</span>
                    <span style={{fontWeight:900,fontSize:17,fontFamily:"Georgia,serif"}}>{play.score}<span style={{fontWeight:400,fontSize:12,color:C.muted}}>/{play.maxScore}</span></span>
                  </div>
                );
              })}
              <div style={{borderTop:"2px solid "+C.ink,marginTop:8,paddingTop:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,color:C.muted}}>{plays.length} play{plays.length !== 1 ? "s" : ""} this month</span>
                <span style={{fontWeight:900,fontSize:18,fontFamily:"Georgia,serif",color:C.tomato}}>{totalScore}<span style={{fontWeight:400,fontSize:13,color:C.muted}}>/{totalMax}</span></span>
              </div>
            </>
        }
      </div>
    </div>
  );
}

function HistoricalWins({history, fu, openMonth, setOpenMonth}) {
  const [showHistory, setShowHistory] = useState(false);
  const now = new Date();
  const histMonths = [];
  let y = 2026, m = 3;
  while (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth())) {
    histMonths.push({ year: y, month: m });
    m++; if (m > 11) { m = 0; y++; }
  }
  histMonths.reverse();
  return (
    <div style={{marginTop:28,paddingTop:20,borderTop:"2px dashed "+C.ink}}>
      <button onClick={function(){ setShowHistory(function(v){ return !v; }); }} style={{width:"100%",padding:"16px",fontSize:16,fontWeight:900,background:C.tomato,color:C.white,border:"2px solid "+C.ink,borderRadius:14,cursor:"pointer",boxShadow:"3px 3px 0 "+C.ink,fontFamily:"Georgia,serif",marginBottom:showHistory?12:0}}>
        🏅 Historical Wins {showHistory ? "▲" : "▼"}
      </button>
      {showHistory && (histMonths.length === 0
        ? <p style={{color:C.muted,textAlign:"center",fontSize:13,marginTop:12}}>No past seasons yet!</p>
        : histMonths.map(function({ year, month }) {
            const mk = year + "-" + month;
            const isOpen = openMonth === mk;
            const mlb = buildLeaderboardForMonth(history, fu, year, month);
            const top3 = [...mlb].sort(function(a, b) { return b.points - a.points; }).slice(0, 3);
            const ws = getWoodenSpoon(mlb);
            return (
              <div key={mk} style={{...S.card,marginBottom:8,overflow:"hidden",padding:0}}>
                <div onClick={function() { setOpenMonth(isOpen ? null : mk); }} style={{padding:"13px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
                  <div>
                    <div style={{fontWeight:900,fontFamily:"Georgia,serif"}}>{MNAMES[month]} {year}</div>
                    {!isOpen && top3[0] && <div style={{fontSize:11,color:C.muted,marginTop:2}}>🥇 {top3[0].name}</div>}
                    {!isOpen && !top3[0] && <div style={{fontSize:11,color:C.muted,marginTop:2}}>No games played</div>}
                  </div>
                  <span style={{color:C.muted,fontSize:12}}>{isOpen ? "▲" : "▼"}</span>
                </div>
                {isOpen &&
                  <div style={{borderTop:"2px solid "+C.ink,padding:"12px 16px"}}>
                    {top3.length === 0
                      ? <p style={{color:C.muted,fontSize:13,textAlign:"center",margin:0}}>No games played this month.</p>
                      : <>
                          {["🥇","🥈","🥉"].map(function(trophy, ti) {
                            return top3[ti]
                              ? <div key={ti} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",marginBottom:6,borderRadius:10,border:"2px solid "+C.ink,background:ti === 0 ? C.lime : C.card}}>
                                  <span style={{fontSize:24,lineHeight:1}}>{trophy}</span>
                                  <div style={{flex:1}}>
                                    <div style={{fontWeight:900,fontFamily:"Georgia,serif",fontSize:15}}>{top3[ti].name}</div>
                                    <div style={{fontSize:11,color:C.muted}}>{top3[ti].points}pts · {top3[ti].wins % 1 === 0 ? top3[ti].wins : top3[ti].wins.toFixed(2)}W</div>
                                  </div>
                                </div>
                              : null;
                          })}
                          {ws && <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,border:"2px solid "+C.ink,background:"#f5f0e8"}}>
                            <span style={{fontSize:24,lineHeight:1}}>🥄</span>
                            <div style={{flex:1}}>
                              <div style={{fontWeight:900,fontFamily:"Georgia,serif",fontSize:15}}>{ws.name}</div>
                              <div style={{fontSize:11,color:C.muted}}>Wooden Spoon · {ws.games}G · {Math.round((ws.games - ws.wins) / ws.games * 100)}% loss rate</div>
                            </div>
                          </div>}
                        </>
                    }
                  </div>
                }
              </div>
            );
          })
      )}
    </div>
  );
}

function HistoryScreen({state,dispatch}){const fu=state.familyUsers||{};return(<div style={{padding:"20px 20px 80px"}}><h2 style={{fontFamily:"Georgia,serif",fontWeight:900,marginBottom:16}}>📋 History</h2>{!state.history.length?<p style={{color:C.muted,textAlign:"center",marginTop:60}}>No games yet!</p>:state.history.map(g=>{const w=getWinner(g);const wName=(w && w.members)?w.name:rname(w,fu);const wPts=(w && w.members)?w.total:calcTotal(w);return(<div key={g.id} onClick={()=>dispatch({type:"GO",screen:"historyDetail",id:g.id})} style={{...S.card,padding:"14px 16px",marginBottom:10,cursor:"pointer"}}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontFamily:"Georgia,serif",fontWeight:700}}>{gameEmoji(g)} {gameName(g)}</span><span style={{color:C.muted,fontSize:11}}>{new Date(g.finishedAt||g.startedAt).toLocaleDateString()}</span></div><div style={{marginTop:6,color:C.tomato,fontSize:13,fontWeight:700}}>🏆 {wName} — {g.scoringType==="independent"?`${wPts}/${g.maxScore}`:wPts+" pts"}</div><div style={{marginTop:4,color:C.muted,fontSize:11}}>{g.teamMode&&g.teams?g.teams.map(t=>`${t.name} (${t.members.join(", ")})`).join(" vs "):g.players.map(p=>rname(p,fu)).join(", ")}</div></div>)})}</div>);}

function HistoryDetail({state,dispatch}){const fu=state.familyUsers||{};const game=state.history.find(g=>g.id===state.detailId);if(!game)return<div style={{padding:"20px 20px 80px"}}><TopBar title="Game Detail" onBack={()=>dispatch({type:"GO",screen:"history"})}/><p style={{color:C.muted,textAlign:"center",marginTop:60}}>Game not found.</p></div>;const isInd=game.scoringType==="independent";const isTeam=game.teamMode&&game.teams;const sortFn=game.lowWins?(a,b)=>a.t-b.t:(a,b)=>b.t-a.t;const rows=game.players.map(p=>({name:isTeam?(((game.teams.find(function(t){return t.name===p.name})||{}).members||[]).join(", ")||p.name):rname(p,fu),label:p.name,t:calcTotal(p)})).sort(sortFn);return(<div style={{padding:"20px 20px 80px"}}><TopBar title={`${gameEmoji(game)} ${gameName(game)}`} onBack={()=>dispatch({type:"GO",screen:"history"})}/><p style={{color:C.muted,fontSize:12,marginBottom:16}}>{new Date(game.finishedAt||game.startedAt).toLocaleDateString("en-GB",{dateStyle:"long"})}{game.lowWins&&" · ⬇️ Lowest wins"}</p><div style={{...S.limeCard,padding:16,marginBottom:20}}>{rows.map((r,ri)=><div key={r.label} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:ri<rows.length-1?"1px solid "+C.ink:"none"}}><div><span style={{fontWeight:700}}>{ri===0?"🏆 ":`${ri+1}. `}{r.label}</span>{isTeam&&<div style={{fontSize:10,color:C.muted}}>{r.name}</div>}</div><span style={{color:C.tomato,fontWeight:900}}>{isInd?`${r.t}/${game.maxScore}`:r.t+" pts"}</span></div>)}</div>{!isInd&&<div style={{...S.card,overflow:"hidden",padding:0,marginBottom:20}}><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}><thead><tr style={{background:C.ink}}><th style={{textAlign:"left",padding:"10px 12px",color:C.white,fontSize:11}}>CATEGORY</th>{game.players.map(p=><th key={p.name} style={{padding:"10px 8px",color:C.white,fontSize:11,textAlign:"center"}}>{p.name}</th>)}</tr></thead><tbody>{game.categories.map((cat,ci)=><tr key={cat} style={{background:ci%2===0?C.white:C.card}}><td style={{padding:"8px 12px",fontWeight:700}}>{cat}</td>{game.players.map(p=><td key={p.name} style={{textAlign:"center",padding:"8px 4px",fontWeight:700}}>{p.scores[cat]||0}</td>)}</tr>)}<tr style={{background:C.tomato}}><td style={{padding:"10px 12px",fontWeight:900,color:C.white,fontFamily:"Georgia,serif"}}>TOTAL</td>{game.players.map(p=><td key={p.name} style={{textAlign:"center",fontWeight:900,color:C.white,fontSize:18,fontFamily:"Georgia,serif"}}>{calcTotal(p)}</td>)}</tr></tbody></table></div></div>}<Btn full onClick={()=>{if(window.confirm("Delete this game?"))dispatch({type:"DELETE_HISTORY",id:game.id})}} style={{background:"#fde8e8",color:"#c0392b",borderColor:"#c0392b"}}>🗑 Delete Game</Btn></div>);}

function FamilyScreen({state,dispatch}){const fu=state.familyUsers||{};const myDname=state.user&&fu[state.user.userId]?fu[state.user.userId].displayName:((state.user && state.user.displayName)||null);const[pw,setPw]=useState("");const[loading,setLoading]=useState(false);const[msg,setMsg]=useState("");const[editName,setEditName]=useState(false);const[newDname,setNewDname]=useState(myDname||"");const[nameErr,setNameErr]=useState("");const[claimTarget,setClaimTarget]=useState(null);const[claimSel,setClaimSel]=useState({});const[showDiag,setShowDiag]=useState(false);const unclaimed={};state.history.forEach(g=>{g.players.forEach(p=>{if(!p.userId){if(!unclaimed[p.name])unclaimed[p.name]={name:p.name,games:[]};unclaimed[p.name].games.push(g)}})});const registeredNames=new Set(Object.values(fu).map(u=>u.displayName));const claimable=Object.values(unclaimed).filter(u=>!registeredNames.has(u.name));const myDupes=[];if(state.user&&!state.user.guest&&myDname)state.history.forEach(g=>{if(g.players.some(p=>p.name===myDname&&!p.userId))myDupes.push(g)});  async function fixMyDupes(){const ids=myDupes.map(d=>d.id);const uid=state.user.userId;const newH=state.history.map(g=>{if(!ids.includes(g.id))return g;return{...g,players:g.players.map(p=>p.name===myDname&&!p.userId?{...p,userId:uid}:p)}});dispatch({type:"SYNC_HISTORY",history:newH});if(state.family&&sb){if(USE_NEW_DB){const fam=await db2.getFamilyByCode(state.family);if(fam)await db2.saveAllGames(fam.id,newH.filter(g=>ids.includes(g.id)))}else{await dbSave(state.family,newH)}}}const diagPlayers={};state.history.forEach(g=>{if(!g.finished)return;(g.teamMode&&g.teams?g.teams.flatMap(t=>t.members.map(m=>({name:m,userId:null}))):g.players).forEach(p=>{const k=pkey(p);if(!diagPlayers[k])diagPlayers[k]={key:k,names:new Set(),userId:p.userId||null,games:0};diagPlayers[k].names.add(p.name);diagPlayers[k].games+=1})});const nameToKeys={};Object.entries(diagPlayers).forEach(([k,v])=>{v.names.forEach(n=>{const norm=n.trim().toLowerCase();if(!nameToKeys[norm])nameToKeys[norm]=[];if(!nameToKeys[norm].includes(k))nameToKeys[norm].push(k)})});const dupeNames=Object.entries(nameToKeys).filter(([,keys])=>keys.length>1);  async function mergeDupe(nameNorm,keys){const primary=keys.find(k=>diagPlayers[k].userId)||keys[0];const others=keys.filter(k=>k!==primary);const newH=state.history.map(g=>({...g,players:g.players.map(p=>{if(others.includes(pkey(p)))return{...p,userId:diagPlayers[primary].userId||undefined};return p})}));dispatch({type:"SYNC_HISTORY",history:newH});if(state.family&&sb){if(USE_NEW_DB){const fam=await db2.getFamilyByCode(state.family);if(fam)await db2.saveAllGames(fam.id,newH)}else{await dbSave(state.family,newH)}}}  async function joinFamily(){if(!pw.trim())return;setLoading(true);setMsg("");const code=pw.trim().toLowerCase().replace(/\s+/g,"-");
    if(USE_NEW_DB){
      const fam=await db2.getOrCreateFamily(code);
      if(!fam){setMsg("Error");setLoading(false);return}
      dispatch({type:"JOIN_FAMILY",family:code});
      // Register self as member
      if(state.user&&!state.user.guest){
        const u=await db2.getUser(state.user.userId);
        if(u)await db2.joinFamily(u.id,fam.id,state.user.displayName||state.user.userId);
      }
      // Load family data
      const[games,tplRows,members]=await Promise.all([db2.getGames(fam.id),db2.getTemplates(fam.id),db2.getFamilyMembers(fam.id)]);
      if(games.length)dispatch({type:"SYNC_HISTORY",history:games});
      const tplObj={};tplRows.forEach(function(t){tplObj[t.template_key]={gameKey:t.game_key,name:t.name,gameName:t.name,emoji:t.emoji,categories:t.categories,scoringType:t.scoring_type,tier:t.tier,maxScore:t.max_score,lowWins:t.low_wins}});
      dispatch({type:"SYNC_TEMPLATES",templates:tplObj,replace:true});
      const fuMap={};members.forEach(function(m){const uname=m.tally_users?m.tally_users.username:null;if(uname)fuMap[uname]={displayName:m.display_name}});
      dispatch({type:"SET_FAMILY_USERS",familyUsers:fuMap});
    }else{
      const games=await dbLoad(code);if(games===null)await dbSave(code,[]);
      dispatch({type:"JOIN_FAMILY",family:code});
      const rfu=(await dbLoad(code+"_users"))||{};
      if(state.user&&!state.user.guest&&!rfu[state.user.userId]){rfu[state.user.userId]={displayName:state.user.displayName||state.user.userId};await dbSave(code+"_users",rfu)}
      dispatch({type:"SET_FAMILY_USERS",familyUsers:rfu});
      if(games)dispatch({type:"SYNC_HISTORY",history:games});
    }
    setMsg(`✅ Joined "${code}"`);setLoading(false);setPw("")}  async function doRename(){const n=newDname.trim();if(!n){setNameErr("Required");return}const other=Object.entries(fu).filter(([uid])=>uid!==state.user.userId).map(([,u])=>u.displayName);if(other.includes(n)){setNameErr("Name taken");return}setNameErr("");dispatch({type:"RENAME_USER",userId:state.user.userId,newName:n});
    if(state.family&&sb){
      const h=state.history.map(g=>({...g,players:g.players.map(p=>p.userId===state.user.userId?{...p,name:n}:p)}));
      if(USE_NEW_DB){
        const fam=await db2.getFamilyByCode(state.family);
        if(fam){
          await db2.saveAllGames(fam.id,h);
          const u=await db2.getUser(state.user.userId);
          if(u){await db2.updateMemberDisplayName(u.id,fam.id,n);await db2.updateUser(state.user.userId,{display_name:n})}
        }
      }else{
        await dbSave(state.family,h);
        const rfu=(await dbLoad(state.family+"_users"))||{};rfu[state.user.userId]={displayName:n};await dbSave(state.family+"_users",rfu);
        await dbSaveUser(state.user.userId,{pin:state.user.pin,displayName:n,families:state.user.families||[],createdAt:state.user.createdAt});
      }
    }setEditName(false)}function startClaim(c){setClaimTarget(c);const sel={};c.games.forEach(g=>{sel[g.id]=true});setClaimSel(sel)}  async function doClaim(){if(!claimTarget||!state.user)return;const ids=Object.keys(claimSel).filter(k=>claimSel[k]).map(Number);const dn=myDname||state.user.userId;dispatch({type:"CLAIM_GAMES",gameIds:ids,oldName:claimTarget.name,userId:state.user.userId,newName:dn});
    if(state.family&&sb){
      const h=state.history.map(g=>{if(!ids.includes(g.id))return g;return{...g,players:g.players.map(p=>p.name===claimTarget.name&&!p.userId?{...p,userId:state.user.userId,name:dn}:p)}});
      if(USE_NEW_DB){const fam=await db2.getFamilyByCode(state.family);if(fam)await db2.saveAllGames(fam.id,h.filter(g=>ids.includes(g.id)))}
      else{await dbSave(state.family,h)}
    }setClaimTarget(null)}return(<div style={{padding:"20px 20px 80px"}}><h2 style={{fontFamily:"Georgia,serif",fontWeight:900,marginBottom:16}}>👨‍👩‍👧 Family</h2>{state.user&&!state.user.guest&&<div style={{...S.card,padding:20,marginBottom:20}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}><div><div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:2}}>Profile</div><div style={{fontSize:20,fontWeight:900,fontFamily:"Georgia,serif",marginTop:4}}>{myDname||state.user.userId}</div><div style={{fontSize:12,color:C.muted}}>@{state.user.userId}</div></div><div style={{fontSize:36}}>👤</div></div>{editName?<div><input style={{...inp,marginBottom:8}} value={newDname} onChange={e=>{setNewDname(e.target.value);setNameErr("")}}/>{nameErr&&<div style={{color:C.tomato,fontSize:12,fontWeight:700,marginBottom:8}}>{nameErr}</div>}<div style={{display:"flex",gap:8}}><Btn onClick={()=>setEditName(false)}>Cancel</Btn><Btn primary onClick={doRename}>Save</Btn></div></div>:<Btn onClick={()=>{setEditName(true);setNewDname(myDname||"")}}>✏️ Change Display Name</Btn>}<div style={{marginTop:12}}><span onClick={()=>{if(window.confirm("Log out?"))dispatch({type:"LOGOUT"})}} style={{color:"#c0392b",fontSize:13,cursor:"pointer",fontWeight:700}}>Log out</span></div></div>}{(state.user && state.user.guest)&&<div style={{...S.limeCard,padding:20,marginBottom:20,textAlign:"center"}}><div style={{fontSize:32,marginBottom:8}}>👤</div><div style={{fontWeight:700,fontSize:15,marginBottom:4}}>Guest</div><p style={{color:C.muted,fontSize:12,marginBottom:12}}>Create an account to claim games {"&"} sync.</p><Btn primary onClick={()=>dispatch({type:"LOGOUT"})}>Create Account</Btn></div>}{state.user&&!state.user.guest&&(state.user.families && state.user.families.length)>0&&<div style={{marginBottom:20}}><h3 style={{...secHead,color:C.card}}>Your Families</h3>{state.user.families.map(f=><div key={f} style={{...S.card,padding:"12px 16px",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between",background:f===state.family?C.lime:C.card}}><div onClick={()=>{if(f!==state.family&&!state.current)dispatch({type:"SWITCH_FAMILY",family:f})}} style={{cursor:f!==state.family?"pointer":"default",flex:1}}><span style={{fontWeight:700}}>{f}</span>{f===state.family&&<span style={{fontSize:11,color:C.muted,marginLeft:8}}>· active</span>}</div><span onClick={()=>{if(window.confirm(`Leave "${f}"?`))dispatch({type:"LEAVE_FAMILY",family:f})}} style={{color:"#c0392b",fontSize:12,cursor:"pointer",fontWeight:700}}>Leave</span></div>)}{state.current&&<p style={{color:C.card,fontSize:11}}>Finish current game to switch.</p>}</div>}<div style={{marginBottom:20}}><h3 style={{...secHead,color:C.card}}>Join / Create Family</h3>{!sb&&<div style={{...S.limeCard,padding:14,marginBottom:12,fontSize:13,color:C.muted}}>⚠️ Supabase not configured.</div>}<input style={{...inp,marginBottom:12}} placeholder="Family password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&joinFamily()}/><Btn full primary onClick={joinFamily} disabled={loading||!pw.trim()||!sb}>{loading?"…":"Join / Create →"}</Btn>{msg&&<div style={{...S.card,marginTop:12,padding:14,fontSize:13,color:C.muted}}>{msg}</div>}</div>{state.family&&!(state.user && state.user.guest)&&claimable.length>0&&<div style={{marginBottom:20}}><h3 style={{...secHead,color:C.card}}>Unlinked Players from the Family History</h3><p style={{color:C.card,fontSize:12,marginBottom:12}}>⚠️ WARNING: Claiming a player name below links it to your account that you're logged in as. Be absolutely SURE you're claiming a game you played! Theft of points will be frowned upon. ⚠️ Tap to link games to your account.</p>{claimable.map(c=><div key={c.name} onClick={()=>startClaim(c)} style={{...S.card,padding:"12px 16px",marginBottom:8,cursor:"pointer",display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:700}}>{c.name}</span><span style={{fontSize:12,color:C.muted}}>{c.games.length}G</span></div>)}</div>}{myDupes.length>0&&<div style={{marginBottom:20}}><div style={{...S.card,padding:16,background:"#fff3e0",borderColor:"#f39c12"}}><div style={{fontWeight:900,fontSize:14,marginBottom:6}}>🔧 Your duplicate</div><p style={{color:C.muted,fontSize:12,marginBottom:12}}>{myDupes.length} game{myDupes.length!==1?"s":""} with "{myDname}" not linked.</p><Btn full primary onClick={fixMyDupes}>Merge into my account</Btn></div></div>}{dupeNames.length>0&&<div style={{marginBottom:20}}><div style={{...S.card,padding:16,background:"#fde8e8",borderColor:"#c0392b"}}><div style={{fontWeight:900,fontSize:14,marginBottom:6}}>⚠️ Duplicates</div><p style={{color:C.muted,fontSize:12,marginBottom:12}}>Same name, different identities:</p>{dupeNames.map(([nm,keys])=><div key={nm} style={{background:C.white,border:"2px solid "+C.ink,borderRadius:10,padding:12,marginBottom:10}}><div style={{fontWeight:900,fontSize:15,marginBottom:8}}>"{nm}"</div>{keys.map(k=>{const d=diagPlayers[k];return<div key={k} style={{fontSize:12,color:C.muted,marginBottom:4,paddingLeft:8,borderLeft:"3px solid "+(d.userId?C.tomato:C.muted)}}><span style={{fontWeight:700,color:C.ink}}>{[...d.names].join(", ")}</span> · {d.userId?`@${d.userId}`:"no account"} · {d.games}G</div>})}<button onClick={()=>mergeDupe(nm,keys)} style={{marginTop:8,width:"100%",padding:"10px",fontSize:13,fontWeight:700,borderRadius:8,border:"2px solid "+C.ink,background:C.tomato,color:C.white,cursor:"pointer"}}>🔗 Merge</button></div>)}</div></div>}<div style={{marginBottom:20}}><div onClick={()=>setShowDiag(d=>!d)} style={{color:C.card,fontSize:12,cursor:"pointer",fontWeight:700}}>{showDiag?"▼":"▶"} Debug info</div>{showDiag&&<div style={{...S.card,padding:12,marginTop:8,fontSize:11,maxHeight:300,overflow:"auto"}}>{Object.entries(diagPlayers).map(([k,v])=><div key={k} style={{marginBottom:8,paddingBottom:8,borderBottom:"1px solid "+C.ink+"20"}}><div style={{fontWeight:900}}>{[...v.names].join(", ")}</div><div style={{color:C.muted}}>Key: {k} · userId: {v.userId||"none"} · {v.games}G</div></div>)}</div>}</div>{claimTarget&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}} onClick={()=>setClaimTarget(null)}><div style={{...S.card,padding:24,maxWidth:380,width:"100%",maxHeight:"80vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}><h3 style={{fontFamily:"Georgia,serif",marginBottom:4,fontSize:18}}>Claim "{claimTarget.name}"?</h3><p style={{color:C.muted,fontSize:12,marginBottom:16}}>Select games to link as "{myDname||(state.user && state.user.userId)}".</p>{claimTarget.games.map(g=><div key={g.id} onClick={()=>setClaimSel(p=>({...p,[g.id]:!p[g.id]}))} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid "+C.ink+"20",cursor:"pointer"}}><div style={{width:24,height:24,borderRadius:6,border:"2px solid "+C.ink,background:claimSel[g.id]?C.tomato:C.white,display:"flex",alignItems:"center",justifyContent:"center",color:C.white,fontSize:14,fontWeight:700,flexShrink:0}}>{claimSel[g.id]?"✓":""}</div><div style={{flex:1}}><div style={{fontSize:13,fontWeight:700}}>{gameEmoji(g)} {gameName(g)}</div><div style={{fontSize:11,color:C.muted}}>{new Date(g.finishedAt||g.startedAt).toLocaleDateString()}</div></div></div>)}<div style={{display:"flex",gap:10,marginTop:20}}><Btn full onClick={()=>setClaimTarget(null)}>Cancel</Btn><Btn full primary onClick={doClaim} disabled={!Object.values(claimSel).some(v=>v)}>Claim</Btn></div></div></div>}</div>);}
function TierBadge({ tier }) {
  const label = (tier == null || tier === undefined) ? "?" : tier;
  return (
    <div style={{ width: 40, height: 46, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative" }}>
      <svg style={{ position: "absolute", top: 0, left: 0, width: 40, height: 46 }} viewBox="0 0 40 46" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 1L38 8V22C38 32 30 40 20 44C10 40 2 32 2 22V8L20 1Z" fill="#D4A017" stroke="#7a5400" strokeWidth="1.5"/>
        <path d="M20 5L33 11V22C33 30 27 37 20 41C13 37 7 30 7 22V11L20 5Z" fill="#F0C040" stroke="#D4A017" strokeWidth="0.5"/>
      </svg>
      <span style={{ position: "relative", zIndex: 1, fontSize: 16, fontWeight: 900, fontFamily: "Georgia,serif", color: "#7a5400", lineHeight: 1, marginTop: -8 }}>{label}</span>
    </div>
  );
}
/* ═══ Shared UI ═══ */
function TopBar({title,onBack}){return<div style={{display:"flex",alignItems:"center",marginBottom:24,gap:12}}><button onClick={onBack} style={{background:C.card,border:"2px solid "+C.ink,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontSize:18,fontWeight:900,boxShadow:"2px 2px 0 "+C.ink}}>←</button><h2 style={{margin:0,fontSize:20,fontFamily:"Georgia,serif",fontWeight:900}}>{title}</h2></div>}
function Btn({children,onClick,full,primary,disabled,style}){return<button onClick={onClick} disabled={disabled} style={{width:full?"100%":"auto",background:primary?C.tomato:C.card,color:disabled?C.muted:primary?C.white:C.ink,border:"2px solid "+(disabled?C.muted:C.ink),borderRadius:12,padding:"14px 20px",fontSize:15,cursor:disabled?"not-allowed":"pointer",fontWeight:700,boxShadow:disabled?"none":"3px 3px 0 "+C.ink,...style}}>{children}</button>}

// ═══ Mount ═══
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
