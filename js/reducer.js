// ═══════════════════════════════════════════════════
// REDUCER — State management
// Uses variables from config.js and helpers.js
// ═══════════════════════════════════════════════════

var INIT = {
  screen: "welcome",
  user: null,
  family: null,
  familyUsers: {},
  history: [],
  templates: {},
  current: null,
  detailId: null,
};

function reducer(state, action) {
  switch (action.type) {

    case "HYDRATE": {
      var p = action.payload;
      return Object.assign({}, state, p, { screen: p.user ? "home" : "welcome" });
    }

    case "GO":
      return Object.assign({}, state, { screen: action.screen, detailId: action.id != null ? action.id : state.detailId });

    case "SET_USER":
      return Object.assign({}, state, { user: action.user, screen: "family" });

    case "GUEST":
      return Object.assign({}, state, { user: { guest: true }, screen: "home" });

    case "LOGOUT":
      return Object.assign({}, state, { user: null, family: null, familyUsers: {}, history: [], templates: {}, current: null, screen: "welcome" });

    case "JOIN_FAMILY": {
      var fams = (state.user.families || []).filter(function(f) { return f !== action.family; });
      var u = Object.assign({}, state.user, { families: fams.concat([action.family]) });
      return Object.assign({}, state, { user: u, family: action.family, familyUsers: {}, history: [], templates: {} });
    }

    case "LEAVE_FAMILY": {
      var fams = (state.user.families || []).filter(function(f) { return f !== action.family; });
      var u = Object.assign({}, state.user, { families: fams });
      var nf = state.family === action.family ? (fams[0] || null) : state.family;
      return Object.assign({}, state, {
        user: u, family: nf,
        familyUsers: state.family === action.family ? {} : state.familyUsers,
        history: state.family === action.family ? [] : state.history,
        templates: state.family === action.family ? {} : state.templates,
      });
    }

    case "SWITCH_FAMILY":
      return Object.assign({}, state, { family: action.family, familyUsers: {}, history: [], templates: {}, current: null });

    case "SET_FAMILY_USERS":
      return Object.assign({}, state, { familyUsers: action.familyUsers });

    case "CLAIM_GAMES": {
      var h = state.history.map(function(g) {
        if (!action.gameIds.includes(g.id)) return g;
        return Object.assign({}, g, {
          players: g.players.map(function(p) {
            return p.name === action.oldName ? Object.assign({}, p, { userId: action.userId, name: action.newName }) : p;
          })
        });
      });
      return Object.assign({}, state, { history: h });
    }

    case "RENAME_USER": {
      var u = Object.assign({}, state.user, { displayName: action.newName });
      var fu = Object.assign({}, state.familyUsers);
      fu[action.userId] = Object.assign({}, fu[action.userId], { displayName: action.newName });
      var h = state.history.map(function(g) {
        return Object.assign({}, g, {
          players: g.players.map(function(p) {
            return p.userId === action.userId ? Object.assign({}, p, { name: action.newName }) : p;
          })
        });
      });
      return Object.assign({}, state, { user: u, familyUsers: fu, history: h });
    }

    case "START_GAME": {
      var g = newGame(action.gameKey, action.players, action.cats, action.customName, action.customEmoji, action.teamMode, action.teams, action.scoringType, action.maxScore, state.user, state.familyUsers, action.lowWins);
      var templates = Object.assign({}, state.templates);
      var tKey = action.gameKey === "custom" ? (action.customName || "Custom Game") : action.gameKey;
      if (!templates[tKey]) {
        templates[tKey] = {
          gameKey: action.gameKey, name: g.gameName, gameName: g.gameName, emoji: g.emoji,
          categories: g.categories, scoringType: g.scoringType, maxScore: g.maxScore,
          lowWins: g.lowWins, tier: g.tier,
        };
      }
      return Object.assign({}, state, { screen: "game", current: g, templates: templates });
    }

    case "SET_SCORE": {
      var c = Object.assign({}, state.current);
      c.players = c.players.map(function(p, pi) {
        if (pi !== action.pi) return p;
        var scores = Object.assign({}, p.scores);
        scores[action.cat] = action.val;
        return Object.assign({}, p, { scores: scores });
      });
      return Object.assign({}, state, { current: c });
    }

    case "ADD_CATEGORY": {
      var c = Object.assign({}, state.current);
      c.categories = c.categories.concat([action.cat]);
      c.players = c.players.map(function(p) {
        var scores = Object.assign({}, p.scores);
        scores[action.cat] = "";
        return Object.assign({}, p, { scores: scores });
      });
      return Object.assign({}, state, { current: c });
    }

    case "FINISH": {
      var fin = Object.assign({}, state.current, { finished: true, finishedAt: new Date().toISOString() });
      var tKey = fin.gameKey === "custom" ? fin.gameName : fin.gameKey;
      var templates = Object.assign({}, state.templates);
      if (!templates[tKey]) {
        templates[tKey] = {
          gameKey: fin.gameKey, name: fin.gameName, gameName: fin.gameName, emoji: fin.emoji,
          categories: fin.categories, scoringType: fin.scoringType, maxScore: fin.maxScore,
          lowWins: fin.lowWins, tier: fin.tier,
        };
      }
      return Object.assign({}, state, { screen: "home", current: null, history: [fin].concat(state.history), templates: templates });
    }

    case "DELETE_HISTORY": {
      var gameToDelete = state.history.find(function(g) { return g.id === action.id; });
      var currentUserId = state.user && state.user.userId;
      var wasPlayer = gameToDelete && currentUserId && gameToDelete.players.some(function(p) { return p.userId === currentUserId; });
      if (!wasPlayer) return state;
      var u = state.history.filter(function(g) { return g.id !== action.id; });
      if (state.family && sb) {
        if (USE_NEW_DB) {
          db2.getFamilyByCode(state.family).then(function(fam) {
            if (fam) db2.deleteGame(fam.id, action.id);
          });
        } else {
          dbSave(state.family, u).catch(function() {});
        }
      }
      return Object.assign({}, state, { history: u, screen: "history", detailId: null });
    }

    case "DELETE_TEMPLATE": {
      var t = Object.assign({}, state.templates);
      delete t[action.key];
      if (state.family && sb && USE_NEW_DB) {
        db2.getFamilyByCode(state.family).then(function(fam) {
          if (fam) db2.deleteTemplate(fam.id, action.key);
        });
      }
      return Object.assign({}, state, { templates: t });
    }

    case "SYNC_HISTORY":
      return Object.assign({}, state, { history: action.history });

    case "SYNC_TEMPLATES":
  return Object.assign({}, state, { templates: action.replace ? action.templates : Object.assign({}, state.templates, action.templates) });
    default:
      return state;
  }
}
