/*
 * Dota 2 draft predictor -- on-device port of predictor.py.
 *
 * The maths is deliberately identical to MatchupModel.predict(): Dotabuff's
 * "Disadvantage" is one-sided, so a hero's own page and its opponent's page
 * disagree about the same matchup. We total each direction separately and
 * blend them, exactly as the Python version does.
 */

(function () {
  "use strict";

  var DATA = window.DOTA_DATA;
  var NAMES = DATA.heroes;
  var DIS = DATA.dis;
  var WDIFF = DATA.wdiff;
  var TEAM_SIZE = 5;
  var STORAGE_KEY = "dota-draft-v1";
  var PICKS_KEY = "dota-picks-v1";
  var SUGGESTION_COUNTS = [10, 20, 30, 40, 50];  // same as app.py; first is the default
  var ROLES = DATA.role_names || [];
  var HERO_ROLES = DATA.roles || NAMES.map(function () { return []; });

  // Matchups Dotabuff has too few games for, as a "i,j" lookup.
  var LOW = Object.create(null);
  DATA.low.forEach(function (pair) { LOW[pair[0] + "," + pair[1]] = true; });

  // Hero index per slot, or null when the slot is empty.
  var teams = {
    a: [null, null, null, null, null],
    b: [null, null, null, null, null]
  };

  // ---------------------------------------------------------------- maths

  function disadvantage(i, j) {
    var v = DIS[i][j];
    return v === null ? 0 : v;
  }

  function round(value, places) {
    var f = Math.pow(10, places);
    return Math.round(value * f) / f;
  }

  function heroSummary(hero, opponents) {
    var vs = opponents.map(function (opp) {
      return {
        opponent: opp,
        disadvantage: round(disadvantage(hero, opp), 4),
        // Display-only cross-check, as in predictor.win_rate_diff(); never
        // part of the total. null when the opponent has no saved page.
        wDiff: WDIFF[hero][opp],
        lowConfidence: LOW[hero + "," + opp] === true
      };
    });
    var total = vs.reduce(function (sum, v) { return sum + v.disadvantage; }, 0);
    return {
      hero: hero,
      vs: vs,
      total: round(total, 4),
      avg: vs.length ? round(total / vs.length, 4) : 0
    };
  }

  function predict(teamA, teamB) {
    var totalFromA = 0;
    var totalFromB = 0;
    var i, j;

    for (i = 0; i < teamA.length; i++) {
      for (j = 0; j < teamB.length; j++) totalFromA += disadvantage(teamA[i], teamB[j]);
    }
    for (i = 0; i < teamB.length; i++) {
      for (j = 0; j < teamA.length; j++) totalFromB += disadvantage(teamB[i], teamA[j]);
    }

    var total = (totalFromA - totalFromB) / 2;
    var winner = total > 0 ? "Team B" : (total < 0 ? "Team A" : "Toss-up");

    return {
      total: round(total, 2),
      winner: winner,
      teamASummary: teamA.map(function (h) { return heroSummary(h, teamB); }),
      teamBSummary: teamB.map(function (h) { return heroSummary(h, teamA); })
    };
  }

  // Port of MatchupModel.suggest_picks(): a candidate's score is exactly how
  // much adding it moves predict()'s total from `team`'s side, best first.
  // Missing data counts as 0.0 and flags the candidate as low-sample.
  // `roles` (empty = all) keeps heroes playing any of them, before the cut.
  function suggestPicks(team, enemy, n, roles) {
    var suggestions = [];
    for (var c = 0; c < NAMES.length; c++) {
      if (team.indexOf(c) !== -1 || enemy.indexOf(c) !== -1) continue;
      if (roles.length && !roles.some(function (r) { return HERO_ROLES[c].indexOf(r) !== -1; })) continue;
      var total = 0;
      var lowSample = false;
      for (var k = 0; k < enemy.length; k++) {
        var e = enemy[k];
        total += disadvantage(c, e) - disadvantage(e, c);
        lowSample = lowSample || DIS[c][e] === null || DIS[e][c] === null ||
          LOW[c + "," + e] === true || LOW[e + "," + c] === true;
      }
      suggestions.push({ hero: c, score: round(total / 2, 2), lowSample: lowSample });
    }
    // NAMES is alphabetical, so index order breaks ties by name like Python.
    suggestions.sort(function (x, y) { return x.score - y.score || x.hero - y.hero; });
    return suggestions.slice(0, n);
  }

  // ------------------------------------------------------------- elements

  var slotContainers = { a: document.getElementById("slots-a"), b: document.getElementById("slots-b") };
  var output = document.getElementById("output");
  var miniVerdict = document.getElementById("mini-verdict");
  var clearBtn = document.getElementById("clear");
  var sheet = document.getElementById("sheet");
  var sheetTitle = document.getElementById("sheet-title");
  var search = document.getElementById("search");
  var heroList = document.getElementById("hero-list");
  var picksBtn = document.getElementById("picks-btn");
  var picksPanel = document.getElementById("picks");
  var picksList = document.getElementById("picks-list");
  var countToggle = document.getElementById("count-toggle");
  var teamSwitch = document.getElementById("team-switch");
  var roleFilter = document.getElementById("role-filter");

  document.getElementById("patch").textContent = DATA.patch ? "patch " + DATA.patch : "";

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function picked(team) {
    return teams[team].filter(function (h) { return h !== null; });
  }

  function whereIs(hero) {
    if (teams.a.indexOf(hero) !== -1) return "a";
    if (teams.b.indexOf(hero) !== -1) return "b";
    return null;
  }

  // --------------------------------------------------------------- slots

  function renderSlots() {
    ["a", "b"].forEach(function (team) {
      var html = "";
      for (var i = 0; i < TEAM_SIZE; i++) {
        var hero = teams[team][i];
        if (hero === null) {
          html += '<button type="button" class="slot empty" data-team="' + team +
            '" data-slot="' + i + '"><span class="label">Add hero</span></button>';
        } else {
          html += '<button type="button" class="slot filled" data-team="' + team +
            '" data-slot="' + i + '"><span class="label">' + escapeHtml(NAMES[hero]) +
            '</span><span class="remove" data-remove="1" role="button" ' +
            'aria-label="Remove ' + escapeHtml(NAMES[hero]) + '">&times;</span></button>';
        }
      }
      slotContainers[team].innerHTML = html;
    });
    clearBtn.disabled = picked("a").length === 0 && picked("b").length === 0;
  }

  ["a", "b"].forEach(function (team) {
    slotContainers[team].addEventListener("click", function (event) {
      var slot = event.target.closest(".slot");
      if (!slot) return;
      var index = Number(slot.dataset.slot);
      if (event.target.dataset.remove) {
        teams[team][index] = null;
        update();
      } else {
        openSheet(team, index);
      }
    });
  });

  clearBtn.addEventListener("click", function () {
    teams.a = [null, null, null, null, null];
    teams.b = [null, null, null, null, null];
    update();
  });

  // --------------------------------------------------------- hero picker

  var sheetTarget = null;

  function openSheet(team, slot) {
    sheetTarget = { team: team, slot: slot };
    sheetTitle.textContent = (teams[team][slot] === null ? "Add to " : "Replace in ") +
      (team === "a" ? "Team A" : "Team B");
    search.value = "";
    renderHeroList("");
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    heroList.scrollTop = 0;
  }

  function closeSheet() {
    sheet.hidden = true;
    sheetTarget = null;
    document.body.style.overflow = "";
  }

  function renderHeroList(query) {
    var needle = query.trim().toLowerCase();
    var html = "";
    var shown = 0;

    for (var i = 0; i < NAMES.length; i++) {
      if (needle && NAMES[i].toLowerCase().indexOf(needle) === -1) continue;
      shown++;
      var on = whereIs(i);
      // A hero already on this exact slot is still selectable (no-op); one used
      // elsewhere is shown but marked, and tapping it moves it to this slot.
      var tag = on && !(sheetTarget && teams[sheetTarget.team][sheetTarget.slot] === i)
        ? '<span class="taken-tag ' + on + '">Team ' + on.toUpperCase() + "</span>"
        : "";
      html += '<button type="button" class="hero-option' + (on ? " taken" : "") +
        '" data-hero="' + i + '"><span>' + escapeHtml(NAMES[i]) + "</span>" + tag + "</button>";
    }

    heroList.innerHTML = shown ? html : '<div class="empty-msg">No hero matches that.</div>';
  }

  search.addEventListener("input", function () { renderHeroList(search.value); });
  document.getElementById("sheet-cancel").addEventListener("click", closeSheet);

  heroList.addEventListener("click", function (event) {
    var option = event.target.closest(".hero-option");
    if (!option || !sheetTarget) return;
    var hero = Number(option.dataset.hero);

    // A hero can only appear once in a draft, so picking one that is already
    // placed moves it here rather than duplicating it.
    ["a", "b"].forEach(function (team) {
      var at = teams[team].indexOf(hero);
      if (at !== -1) teams[team][at] = null;
    });
    teams[sheetTarget.team][sheetTarget.slot] = hero;

    closeSheet();
    update();
  });

  // --------------------------------------------------------------- output

  function barHtml(value, maxAbs) {
    // Bars grow out from a centre line: left/green is a favourable matchup,
    // right/red an unfavourable one.
    var half = maxAbs ? (Math.abs(value) / maxAbs) * 50 : 0;
    var good = value < 0;
    var left = good ? 50 - half : 50;
    return '<div class="bar-track"><div class="bar-fill ' + (good ? "good" : "bad") +
      '" style="left:' + left + "%;width:" + half + '%"></div></div>';
  }

  function summaryHtml(title, dotClass, summaries, maxAbs) {
    var rows = summaries.map(function (h) {
      var cls = h.total > 0 ? "bad" : (h.total < 0 ? "good" : "flat");
      return '<div class="hero-row"><div><div class="name">' + escapeHtml(NAMES[h.hero]) +
        "</div>" + barHtml(h.total, maxAbs) + '</div><div class="value ' + cls +
        '"><div class="total">' + h.total.toFixed(2) + '</div><div class="avg">avg ' +
        h.avg.toFixed(2) + "</div></div></div>";
    }).join("");

    return '<div class="bars"><h2 style="font-size:.8rem;text-transform:uppercase;' +
      'letter-spacing:.06em;color:var(--muted);margin:0 0 6px;display:flex;' +
      'align-items:center;gap:8px"><span class="dot ' + dotClass + '"></span>' +
      title + "</h2>" + rows + "</div>";
  }

  function tableHtml(label, otherLabel, summaries) {
    var rows = summaries.map(function (h) {
      return h.vs.map(function (v) {
        var cls = v.disadvantage > 0 ? "bad" : (v.disadvantage < 0 ? "good" : "flat");
        var wCls = v.wDiff === null ? "" : (v.wDiff > 0 ? " bad" : " good");
        return "<tr><td>" + escapeHtml(NAMES[h.hero]) + "</td><td>" +
          escapeHtml(NAMES[v.opponent]) + (v.lowConfidence ? " *" : "") +
          '</td><td class="' + cls + '">' + v.disadvantage.toFixed(2) +
          '</td><td class="w-diff' + wCls + '">' +
          (v.wDiff === null ? "&mdash;" : v.wDiff.toFixed(2)) + "</td></tr>";
      }).join("");
    }).join("");

    return "<details><summary>" + label + " breakdown</summary><table><thead><tr><th>" +
      label + "</th><th>vs " + otherLabel + '</th><th>Disadv.</th><th class="w-diff">w_diff</th>' +
      "</tr></thead><tbody>" +
      rows + "</tbody></table></details>";
  }

  function render(result) {
    var totals = result.teamASummary.concat(result.teamBSummary).map(function (h) {
      return Math.abs(h.total);
    });
    var maxAbs = Math.max.apply(null, totals.concat([0])) || 1;

    var winnerClass = { "Team A": "team-a", "Team B": "team-b", "Toss-up": "toss-up" }[result.winner];
    var headline = result.winner === "Toss-up" ? "Too close to call" : result.winner + " favored";

    var anyLow = result.teamASummary.concat(result.teamBSummary).some(function (h) {
      return h.vs.some(function (v) { return v.lowConfidence; });
    });

    output.innerHTML =
      '<div class="verdict" id="verdict"><div class="winner ' + winnerClass + '">' +
      headline + '</div><div class="total">Team A net disadvantage ' +
      result.total.toFixed(2) + "</div>" +
      (anyLow ? '<div class="note">* some matchups have very few recorded games</div>' : "") +
      "</div>" +
      summaryHtml("Team A", "dot-a", result.teamASummary, maxAbs) +
      summaryHtml("Team B", "dot-b", result.teamBSummary, maxAbs) +
      tableHtml("Team A", "Team B", result.teamASummary) +
      tableHtml("Team B", "Team A", result.teamBSummary);

    miniVerdict.innerHTML = '<span class="' + winnerClass + '">' + headline +
      '</span><span class="num">' + result.total.toFixed(2) + "</span>";
    verdictNode = document.getElementById("verdict");
    updateMiniVerdict();
  }

  function renderPrompt() {
    var a = picked("a").length;
    var b = picked("b").length;
    var message = !a && !b
      ? "Pick at least one hero for each team."
      : "Add a hero to Team " + (a ? "B" : "A") + " to see a prediction.";
    output.innerHTML = '<div class="verdict"><div class="hint">' + message + "</div></div>";
    verdictNode = null;
    updateMiniVerdict();
  }

  // The pinned summary bar only earns its space once the real verdict has
  // scrolled up out of view.
  var verdictNode = null;

  function updateMiniVerdict() {
    var show = verdictNode !== null && verdictNode.getBoundingClientRect().bottom < 48;
    miniVerdict.classList.toggle("show", show);
  }

  window.addEventListener("scroll", updateMiniVerdict, { passive: true });

  // ----------------------------------------------------------- best picks

  // Panel state, kept across refreshes alongside the draft.
  // roles: each team's role filter, empty = All.
  var picks = { open: false, team: "a", count: SUGGESTION_COUNTS[0], roles: { a: [], b: [] } };

  function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

  function renderPicks() {
    picksBtn.setAttribute("aria-pressed", picks.open ? "true" : "false");
    picksPanel.hidden = !picks.open;
    if (!picks.open) return;

    countToggle.innerHTML = SUGGESTION_COUNTS.map(function (n) {
      var on = n === picks.count;
      return '<button type="button" data-count="' + n + '"' + (on ? ' class="active"' : "") +
        ' aria-pressed="' + on + '">' + n + "</button>";
    }).join("");
    Array.prototype.forEach.call(teamSwitch.children, function (b) {
      b.classList.toggle("active", b.dataset.team === picks.team);
    });
    var roles = picks.roles[picks.team];
    roleFilter.innerHTML = [""].concat(ROLES).map(function (r) {
      var on = r ? roles.indexOf(r) !== -1 : !roles.length;
      return '<button type="button" data-role="' + r + '"' + (on ? ' class="active"' : "") +
        ' aria-pressed="' + on + '">' + (r ? capitalize(r) : "All") + "</button>";
    }).join("");

    var team = picked(picks.team);
    var enemy = picked(picks.team === "a" ? "b" : "a");
    if (!enemy.length) {
      picksList.innerHTML = '<div class="empty-msg">Add at least one enemy hero to get suggestions.</div>';
      return;
    }

    var list = suggestPicks(team, enemy, picks.count, roles);
    if (!list.length) {
      picksList.innerHTML = '<div class="empty-msg">No undrafted heroes play ' + roles.join(" or ") + ".</div>";
      return;
    }
    var full = team.length >= TEAM_SIZE;
    var maxAbs = Math.max.apply(null, list.map(function (p) { return Math.abs(p.score); }).concat([0])) || 1;

    picksList.innerHTML =
      (full ? '<p class="picks-note">Team is full &mdash; shown for comparison only.</p>' : "") +
      list.map(function (p, i) {
        var cls = p.score > 0 ? "bad" : (p.score < 0 ? "good" : "flat");
        return '<button type="button" class="pick-row" data-hero="' + p.hero + '"' +
          (full ? " disabled" : "") + '><span class="rank">' + (i + 1) +
          '</span><div><div class="name">' + escapeHtml(NAMES[p.hero]) +
          (p.lowSample ? '<span class="low-sample">low data</span>' : "") + "</div>" +
          (HERO_ROLES[p.hero].length ? '<div class="role-tags">' + HERO_ROLES[p.hero].map(function (r) {
            return '<span class="role-tag' + (roles.indexOf(r) !== -1 ? " match" : "") + '">' + r + "</span>";
          }).join("") + "</div>" : "") +
          barHtml(p.score, maxAbs) + '</div><span class="score ' + cls + '">' +
          (p.score > 0 ? "+" : "") + p.score.toFixed(2) + "</span></button>";
      }).join("");
  }

  picksBtn.addEventListener("click", function () {
    picks.open = !picks.open;
    update();
  });

  countToggle.addEventListener("click", function (event) {
    var b = event.target.closest("button");
    if (!b) return;
    picks.count = Number(b.dataset.count);
    update();
  });

  teamSwitch.addEventListener("click", function (event) {
    var b = event.target.closest("button");
    if (!b) return;
    picks.team = b.dataset.team;
    update();
  });

  roleFilter.addEventListener("click", function (event) {
    var b = event.target.closest("button");
    if (!b) return;
    var role = b.dataset.role;
    var current = picks.roles[picks.team];
    var at = current.indexOf(role);
    if (!role) picks.roles[picks.team] = [];
    else if (at === -1) current.push(role);
    else current.splice(at, 1);
    update();
  });

  // Tapping a suggestion drops it into that team's first empty slot.
  picksList.addEventListener("click", function (event) {
    var row = event.target.closest(".pick-row");
    if (!row || row.disabled) return;
    var slot = teams[picks.team].indexOf(null);
    if (slot === -1) return;
    teams[picks.team][slot] = Number(row.dataset.hero);
    update();
  });

  // --------------------------------------------------------------- state

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
      localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
    } catch (err) {
      /* Private mode or blocked storage -- the draft just won't persist. */
    }
  }

  function restore() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      var savedPicks = JSON.parse(localStorage.getItem(PICKS_KEY) || "null");
      if (savedPicks) {
        picks.open = savedPicks.open === true;
        if (savedPicks.team === "b") picks.team = "b";
        if (SUGGESTION_COUNTS.indexOf(savedPicks.count) !== -1) picks.count = savedPicks.count;
        ["a", "b"].forEach(function (t) {
          var saved = savedPicks.roles && savedPicks.roles[t];
          if (Array.isArray(saved)) {
            picks.roles[t] = ROLES.filter(function (r) { return saved.indexOf(r) !== -1; });
          }
        });
      }
    } catch (err) {
      return;
    }
    if (!raw) {
      // Very first open: show a worked example rather than ten empty slots.
      // Clear wipes it and the empty draft is what gets saved from then on.
      seedExample();
      return;
    }

    try {
      var saved = JSON.parse(raw);
      ["a", "b"].forEach(function (team) {
        var list = saved && saved[team];
        if (!Array.isArray(list)) return;
        for (var i = 0; i < TEAM_SIZE; i++) {
          var hero = list[i];
          // Guard against a stale draft saved before the hero list changed.
          teams[team][i] = (typeof hero === "number" && hero >= 0 && hero < NAMES.length)
            ? hero
            : null;
        }
      });
    } catch (err) {
      /* Unreadable saved draft -- start empty. */
    }
  }

  function seedExample() {
    var sample = {
      a: ["Pudge", "Juggernaut", "Crystal Maiden", "Anti-Mage", "Rubick"],
      b: ["Invoker", "Faceless Void", "Lion", "Terrorblade", "Tidehunter"]
    };
    ["a", "b"].forEach(function (team) {
      sample[team].forEach(function (name, i) {
        var index = NAMES.indexOf(name);
        teams[team][i] = index === -1 ? null : index;
      });
    });
  }

  function update() {
    renderSlots();
    var a = picked("a");
    var b = picked("b");
    if (a.length && b.length) render(predict(a, b));
    else renderPrompt();
    renderPicks();
    save();
  }

  restore();
  update();
})();
