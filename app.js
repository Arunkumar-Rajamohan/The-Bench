/* The Bench — browser app. Accounts, posts and personal data live on the server (see server.js). */
(function () {
  'use strict';

  var OLD_KEY = 'bench:v1'; // data from the no-accounts prototype, imported once at sign-up

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function dkey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function today() { return dkey(new Date()); }
  function ago(t) {
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    if (m < 60 * 24) return Math.floor(m / 60) + 'h ago';
    return Math.floor(m / 1440) + 'd ago';
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function api(method, url, body, keepalive) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      keepalive: !!keepalive,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Something went wrong.'); e.status = r.status; throw e; }
        return j;
      });
    }, function () { throw new Error('Cannot reach the server. Is it running?'); });
  }

  // ---------- fixed content ----------
  var JOBS = [
    { id: 'j1', title: 'Junior Frontend Developer', company: 'Papaya Labs', loc: 'Bengaluru', mode: 'Hybrid', pay: '₹5–8 LPA', tags: ['React', 'CSS'] },
    { id: 'j2', title: 'Customer Support Associate', company: 'Kettle & Co', loc: 'Anywhere', mode: 'Remote', pay: '₹3–4.5 LPA', tags: ['Chat support', 'English'] },
    { id: 'j3', title: 'Data Analyst (Fresher)', company: 'Northwind Metrics', loc: 'Chennai', mode: 'On-site', pay: '₹4–6 LPA', tags: ['SQL', 'Excel'] },
    { id: 'j4', title: 'Content Writer', company: 'Lantern Media', loc: 'Anywhere', mode: 'Remote', pay: '₹25k–40k / month', tags: ['Writing', 'SEO'] },
    { id: 'j5', title: 'Flutter Developer', company: 'Pocket Garden', loc: 'Hyderabad', mode: 'Hybrid', pay: '₹6–10 LPA', tags: ['Flutter', 'Dart'] },
    { id: 'j6', title: 'Video Editor', company: 'Blink Studio', loc: 'Mumbai', mode: 'On-site', pay: '₹30k–50k / month', tags: ['Premiere', 'Shorts'] },
    { id: 'j7', title: 'QA Tester', company: 'Bugnet', loc: 'Pune', mode: 'Hybrid', pay: '₹3.5–5.5 LPA', tags: ['Manual testing', 'Jira'] },
    { id: 'j8', title: 'Sales Development Rep', company: 'Tallyhop', loc: 'Anywhere', mode: 'Remote', pay: '₹4 LPA + incentives', tags: ['Outbound', 'CRM'] },
    { id: 'j9', title: 'Python Backend Intern', company: 'Quietbyte', loc: 'Coimbatore', mode: 'On-site', pay: '₹15k / month', tags: ['Python', 'APIs'] },
    { id: 'j10', title: 'UI/UX Designer', company: 'Mango Tree Apps', loc: 'Anywhere', mode: 'Remote', pay: '₹5–9 LPA', tags: ['Figma', 'Research'] }
  ];

  var STAGES = ['Wishlist', 'Applied', 'Interview', 'Offer', 'Rejected'];
  var TAGS = ['Win', 'Rant', 'Question', 'Tip'];
  var REACTS = ['🙌', '💪', '😂'];
  var MOODS = ['😞', '😕', '😐', '🙂', '🤩'];

  var QUESTIONS = [
    { c: 'About you', q: 'Tell me about yourself.' },
    { c: 'About you', q: 'What are you looking for in your next role?' },
    { c: 'About you', q: 'What is your biggest strength, and where has it shown up?' },
    { c: 'About you', q: 'What is something you are working on getting better at?' },
    { c: 'The gap', q: 'Why did you leave your last job?' },
    { c: 'The gap', q: 'What have you been doing since your last role?' },
    { c: 'The gap', q: 'I see a gap on your resume. Can you walk me through it?' },
    { c: 'Behavioral', q: 'Tell me about a time you disagreed with a teammate.' },
    { c: 'Behavioral', q: 'Describe a project you are proud of. What was your part?' },
    { c: 'Behavioral', q: 'Tell me about a time you failed. What did you change after?' },
    { c: 'Behavioral', q: 'Describe a time you had to learn something fast.' },
    { c: 'Behavioral', q: 'Tell me about a time you handled a difficult customer or stakeholder.' },
    { c: 'Company', q: 'Why do you want to work here?' },
    { c: 'Company', q: 'What do you know about what we do?' },
    { c: 'Money', q: 'What are your salary expectations?' },
    { c: 'Curveball', q: 'If you joined tomorrow, what would you do in your first 30 days?' },
    { c: 'Curveball', q: 'Teach me something in two minutes.' },
    { c: 'Closing', q: 'Do you have any questions for us?' }
  ];

  var QUIPS = [
    'Professional status: between meetings. Very long meetings.',
    'Your commute today is bed to chair. Elite.',
    'Rejection emails are just companies with bad taste.',
    'One application today beats ten "tomorrow".',
    'You are not behind. You are buffering.',
    'Somewhere, a hiring manager is about to get lucky.'
  ];

  // ---------- state ----------
  function blank() {
    return {
      apps: [],
      routine: {
        tasks: [
          { id: 't1', text: 'Apply to 2 jobs' },
          { id: 't2', text: 'Learn something for 30 minutes' },
          { id: 't3', text: 'Step outside for 15 minutes' },
          { id: 't4', text: 'Message one person (friend or contact)' }
        ],
        log: {},
        moods: {}
      },
      resume: '',
      practice: []
    };
  }
  // Turn whatever the server (or old local storage) holds into a safe, complete shape.
  function adopt(raw) {
    var b = blank();
    if (!isObj(raw)) return b;
    if (Array.isArray(raw.apps)) b.apps = raw.apps.filter(isObj);
    if (Array.isArray(raw.practice)) b.practice = raw.practice.filter(isObj);
    if (typeof raw.resume === 'string') b.resume = raw.resume;
    if (isObj(raw.routine)) {
      if (Array.isArray(raw.routine.tasks)) b.routine.tasks = raw.routine.tasks.filter(isObj);
      if (isObj(raw.routine.log)) b.routine.log = raw.routine.log;
      if (isObj(raw.routine.moods)) b.routine.moods = raw.routine.moods;
    }
    return b;
  }

  var me = null;       // { username, name } once signed in
  var S = blank();     // this user's private data
  var posts = [];      // shared feed, from the server
  var ui = {
    booting: true, authMode: 'login', authError: '', authUser: '', authName: '', newCode: '', acctMsg: null,
    jobQuery: '', jobMode: 'All', q: Math.floor(Math.random() * QUESTIONS.length),
    timerId: null, timerStart: 0, report: null
  };

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  function flush(keepalive) {
    if (!saveTimer || !me) return Promise.resolve();
    clearTimeout(saveTimer); saveTimer = null;
    return api('PUT', '/api/me/data', S, keepalive).catch(fail);
  }

  function loadPosts() {
    return api('GET', '/api/posts').then(function (j) { posts = Array.isArray(j.posts) ? j.posts : []; });
  }
  function fail(e) {
    if (e.status === 401 && me) { signedOut(); ui.authError = 'Please log in again.'; render(); return; }
    toast(e.message);
  }
  function signedOut() {
    clearTimeout(saveTimer); saveTimer = null;
    stopTimer();
    me = null; S = blank(); posts = []; ui.report = null; ui.newCode = ''; ui.acctMsg = null;
    stopStream(); chat = freshChat(); updateBadge();
  }
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
  }

  // ---------- derived ----------
  function doneOn(k) {
    var log = S.routine.log[k];
    return (Array.isArray(log) ? log : []).filter(function (id) {
      return S.routine.tasks.some(function (t) { return t.id === id; });
    });
  }
  function hit(k) { var l = S.routine.log[k]; return Array.isArray(l) && l.length > 0; }
  function streak() {
    var n = 0, d = new Date();
    if (!hit(dkey(d))) d.setDate(d.getDate() - 1);
    while (hit(dkey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function countStage(s) { return S.apps.filter(function (a) { return a.stage === s; }).length; }

  // ---------- views ----------
  function head(title, sub) {
    return '<header class="head"><h1>' + title + '</h1><p class="sub">' + sub + '</p></header>';
  }

  function authView() {
    var mode = ui.authMode, signup = mode === 'signup', reset = mode === 'reset';
    var title = signup ? 'Grab a seat' : reset ? 'Reset your password' : 'Welcome back';
    var button = signup ? 'Create account' : reset ? 'Set new password' : 'Log in';
    var userField = '<label>Username<input type="text" name="username" maxlength="20" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(ui.authUser) + '" required></label>';
    var fields = signup
      ? '<label>What should we call you?<input type="text" name="name" maxlength="24" autocomplete="nickname" value="' + esc(ui.authName) + '" required></label>' +
        userField +
        '<label>Password<input type="password" name="password" minlength="8" maxlength="200" autocomplete="new-password" required></label>' +
        '<p class="muted small">Username: 3–20 letters, numbers or underscores. Password: at least 8 characters. No email needed: you will get a recovery code instead.</p>'
      : reset
      ? userField +
        '<label>Recovery code<input type="text" name="code" maxlength="40" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" required></label>' +
        '<label>New password<input type="password" name="password" minlength="8" maxlength="200" autocomplete="new-password" required></label>' +
        '<p class="muted small">This is the code you saved when you signed up. Each code works once; you will get a new one after resetting.</p>'
      : userField +
        '<label>Password<input type="password" name="password" maxlength="200" autocomplete="current-password" required></label>';
    var links = signup
      ? '<p class="small">Already have a seat? ' + modeLink('login', 'Log in') + '</p>'
      : reset
      ? '<p class="small">Remembered it? ' + modeLink('login', 'Back to log in') + '</p>'
      : '<p class="small">New here? ' + modeLink('signup', 'Create an account') + '</p>' +
        '<p class="small">' + modeLink('reset', 'Forgot password?') + '</p>';
    return '<div class="auth"><div class="auth-brand"><span class="brand-mark" aria-hidden="true">🪑</span>' +
      '<h1>The Bench</h1><p class="sub">A clubhouse for the between-jobs crowd. Everyone sits here sometimes.</p></div>' +
      '<form class="card stack" data-form="auth"><h2>' + title + '</h2>' + fields +
      (ui.authError ? '<p class="err" role="alert">' + esc(ui.authError) + '</p>' : '') +
      '<button class="btn primary">' + button + '</button>' + links + '</form></div>';
  }
  function modeLink(mode, label) {
    return '<button type="button" class="link big" data-act="auth-mode" data-mode="' + mode + '">' + label + '</button>';
  }

  // Shown once, right after a recovery code is made (sign-up, reset, or from the Account page).
  function codeView() {
    return '<div class="auth"><div class="card stack">' +
      '<h2>🔑 Save your recovery code</h2>' +
      '<p>If you ever forget your password, this code lets you set a new one. <b>It is shown only this once.</b></p>' +
      '<p class="code" id="rcode">' + esc(ui.newCode) + '</p>' +
      '<div class="row"><button class="btn" data-act="copy-code">Copy code</button><span class="muted small" id="copied" role="status"></span></div>' +
      '<p class="muted small">Write it down, or keep it in a notes app or password manager. Anyone with your username and this code can reset your password, so keep it private.</p>' +
      '<label class="row small"><input type="checkbox" id="saved"> I have saved my recovery code</label>' +
      '<button class="btn primary" data-act="code-done" id="codedone" disabled>Continue</button>' +
      '</div></div>';
  }

  function taskList() {
    var done = doneOn(today());
    return S.routine.tasks.map(function (t) {
      var on = done.indexOf(t.id) > -1;
      return '<div class="taskrow"><button class="task' + (on ? ' done' : '') + '" data-act="toggle-task" data-id="' + esc(t.id) + '" aria-pressed="' + on + '">' +
        '<span class="box">' + (on ? '✓' : '') + '</span><span class="txt">' + esc(t.text) + '</span></button>' +
        '<button class="link" data-act="del-task" data-id="' + esc(t.id) + '" aria-label="Remove task">remove</button></div>';
    }).join('') || '<p class="muted small">No tasks yet. Add one below.</p>';
  }

  function postHtml(p, compact) {
    var id = Number(p.id);
    var tag = TAGS.indexOf(p.tag) > -1 ? p.tag : 'Win';
    var reacts = REACTS.map(function (r) {
      var n = Number(p.reacts[r]) || 0;
      return '<button class="react' + (p.mine[r] ? ' on' : '') + '" data-act="react" data-id="' + id + '" data-r="' + r + '"' + (compact ? ' disabled' : '') + '>' + r + (n ? ' ' + n : '') + '</button>';
    }).join('');
    var replies = compact ? '' :
      (p.replies.length ? '<div class="replies">' + p.replies.map(function (r) {
        return '<p><b>' + esc(r.name) + '</b> <span class="muted small">' + ago(r.t) + '</span><br>' + esc(r.text) + '</p>';
      }).join('') + '</div>' : '') +
      '<form class="row" data-form="reply" style="margin-top:12px"><input type="hidden" name="id" value="' + id + '">' +
      '<input class="grow" type="text" name="text" placeholder="Say something nice…" maxlength="300" aria-label="Reply" required>' +
      '<button class="btn ghost">Reply</button></form>';
    var who = p.own
      ? '<span class="who">' + esc(p.name) + '</span>'
      : '<a class="who" href="#/dm/' + esc(p.username) + '" title="Message @' + esc(p.username) + ' privately">' + esc(p.name) + '</a>';
    return '<article class="card post"><div class="row between"><div class="row">' + who +
      '<span class="muted small">@' + esc(p.username) + '</span>' +
      '<span class="pill ' + tag + '">' + tag + '</span><span class="muted small">' + ago(p.t) + '</span></div>' +
      ((p.own || me.isAdmin) && !compact ? '<button class="link" data-act="del-post" data-id="' + id + '">delete</button>' : '') + '</div>' +
      '<p class="body">' + esc(p.text) + '</p><div class="row">' + reacts + '</div>' + replies + '</article>';
  }

  var views = {
    home: function () {
      var done = doneOn(today()).length, total = S.routine.tasks.length;
      var latest = posts.slice(0, 2).map(function (p) { return postHtml(p, true); }).join('') ||
        '<p class="card muted">Nobody has posted yet. Be the first to say hi.</p>';
      return head('Hey ' + esc(me.name) + ' 👋', esc(pick(QUIPS))) +
        '<div class="stats">' +
        '<div class="stat hot"><b>🔥 ' + streak() + '</b><span>day streak</span></div>' +
        '<div class="stat"><b>' + done + '/' + total + '</b><span>tasks done today</span></div>' +
        '<div class="stat"><b>' + S.apps.length + '</b><span>jobs tracked</span></div>' +
        '<div class="stat"><b>' + countStage('Interview') + '</b><span>interviews</span></div>' +
        '<div class="stat"><b>' + S.practice.length + '</b><span>questions practiced</span></div>' +
        '</div><div class="stack">' +
        (me.hasRecovery ? '' : '<p class="banner">🔑 <b>Protect your account:</b> get a recovery code so you can reset a forgotten password. <a href="#/account">Set it up</a></p>') +
        '<div class="grid2"><section class="card"><div class="row between"><h2>Today\'s routine</h2><a class="btn tiny ghost" href="#/routine">Open</a></div>' + taskList() + '</section>' +
        '<section class="stack"><div class="row between"><h2>Fresh from the feed</h2><a class="btn tiny ghost" href="#/feed">See all</a></div>' + latest + '</section></div>' +
        '<p class="small muted">Signed in as @' + esc(me.username) + ' · <a href="#/account">Account</a> · <button class="link" data-act="logout">Log out</button></p></div>';
    },

    account: function () {
      var msg = ui.acctMsg ? '<p class="' + (ui.acctMsg.ok ? 'ok-msg' : 'err') + '" role="status">' + esc(ui.acctMsg.text) + '</p>' : '';
      return head('Account ⚙️', 'Signed in as @' + esc(me.username) + '.') + msg +
        '<div class="grid2"><form class="card stack" data-form="recovery"><h2>Recovery code</h2>' +
        '<p class="small">' + (me.hasRecovery
          ? 'You have a recovery code. Lost it? Make a new one; the old code stops working.'
          : '<b>You do not have a recovery code yet.</b> Without one, a forgotten password cannot be reset.') + '</p>' +
        '<label>Current password<input type="password" name="password" maxlength="200" autocomplete="current-password" required></label>' +
        '<button class="btn primary">' + (me.hasRecovery ? 'Make a new code' : 'Get my recovery code') + '</button></form>' +
        '<form class="card stack" data-form="password"><h2>Change password</h2>' +
        '<label>Current password<input type="password" name="password" maxlength="200" autocomplete="current-password" required></label>' +
        '<label>New password<input type="password" name="newPassword" minlength="8" maxlength="200" autocomplete="new-password" required></label>' +
        '<p class="muted small">This signs you out on every other device.</p>' +
        '<button class="btn">Change password</button></form>' +
        '<section class="card stack"><h2>Blocked people</h2><p class="muted small">Blocked people cannot message you, and you do not see their messages in rooms.</p>' +
        '<div id="blocklist"><p class="muted small">Loading…</p></div></section>' +
        (me.isAdmin ? '<section class="card stack"><h2>Moderation 🛡️</h2><p class="small">You are a moderator.</p><a class="btn" href="#/admin">Open reports</a></section>' : '') +
        '</div>' +
        '<p class="small muted" style="margin-top:16px"><a href="#/home">← Back home</a> · <button class="link" data-act="logout">Log out</button></p>';
    },

    chat: function () {
      var ch = activeChannel();
      return '<div class="chat' + (ch ? ' has-ch' : '') + '"><aside class="chat-list card" id="chatlist">' + chatListHtml(ch) + '</aside>' +
        '<section class="chat-pane card" id="chatpane">' +
        (ch ? paneHtml(ch) : '<div class="pane-empty"><p>Pick a room or a person to chat with.</p></div>') + '</section></div>';
    },

    admin: function () {
      if (!me.isAdmin) return head('Moderators only 🛡️', 'This page is for moderators.');
      return head('Moderation 🛡️', 'Reports from members. A private message only shows up here when one of the two people in it reports it.') +
        '<div id="adminbody"><p class="muted">Loading reports…</p></div>';
    },

    feed: function () {
      return head('The Feed 💬', 'Wins, rants, questions and tips. No LinkedIn voice allowed.') +
        '<div class="stack"><form class="card stack" data-form="post">' +
        '<textarea name="text" maxlength="600" placeholder="What happened today?" aria-label="Write a post" required></textarea>' +
        '<div class="row between"><select class="auto" name="tag" aria-label="Post type">' +
        TAGS.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select>' +
        '<button class="btn primary">Post as ' + esc(me.name) + '</button></div></form>' +
        (posts.map(function (p) { return postHtml(p, false); }).join('') ||
          '<p class="card muted">It is quiet in here. Post the first win, rant, question or tip.</p>') + '</div>';
    },

    jobs: function () {
      return head('Jobs 🔎', 'Find something, hit Track, and it lands on your board.') +
        '<div class="stack"><div class="row"><input class="grow" type="search" id="jobq" placeholder="Search title, company or skill" aria-label="Search jobs" value="' + esc(ui.jobQuery) + '">' +
        '<select class="auto" id="jobmode" aria-label="Work mode">' + ['All', 'Remote', 'Hybrid', 'On-site'].map(function (m) {
          return '<option' + (m === ui.jobMode ? ' selected' : '') + '>' + m + '</option>';
        }).join('') + '</select></div>' +
        '<p class="banner">These are sample listings with made-up companies. Real listings arrive once a jobs source is connected.</p>' +
        '<div class="grid2" id="joblist">' + jobList() + '</div></div>';
    },

    tracker: function () {
      var cols = STAGES.map(function (s, i) {
        var items = S.apps.filter(function (a) { return a.stage === s; });
        return '<section class="col"><h3><span>' + s + '</span><span class="muted">' + items.length + '</span></h3>' +
          items.map(function (a) {
            var id = esc(a.id);
            return '<div class="app"><b>' + esc(a.title) + '</b><span class="muted small">' + esc(a.company) + '</span>' +
              '<div class="row between"><div class="row">' +
              '<button class="btn tiny ghost" data-act="move-app" data-id="' + id + '" data-dir="-1" aria-label="Move back"' + (i === 0 ? ' disabled' : '') + '>←</button>' +
              '<button class="btn tiny ghost" data-act="move-app" data-id="' + id + '" data-dir="1" aria-label="Move forward"' + (i === STAGES.length - 1 ? ' disabled' : '') + '>→</button></div>' +
              '<button class="link" data-act="del-app" data-id="' + id + '">remove</button></div></div>';
          }).join('') + '</section>';
      }).join('');
      return head('Tracker 📋', 'Every application in one place, so nothing gets lost in your inbox.') +
        '<div class="stack"><form class="card row" data-form="app">' +
        '<input class="grow" type="text" name="title" placeholder="Job title" aria-label="Job title" maxlength="80" required>' +
        '<input class="grow" type="text" name="company" placeholder="Company" aria-label="Company" maxlength="60" required>' +
        '<select class="auto" name="stage" aria-label="Stage">' + STAGES.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>' +
        '<button class="btn primary">Add</button></form>' +
        '<div class="board">' + cols + '</div></div>';
    },

    prep: function () {
      var q = QUESTIONS[ui.q];
      var tally = { Nailed: 0, Okay: 0, Rough: 0 };
      S.practice.forEach(function (p) { if (tally[p.r] !== undefined) tally[p.r]++; });
      return head('Prep 🎤', 'Check your resume and practice answers out loud before the real thing.') +
        '<div class="grid2"><section class="card stack"><h2>Resume checkup</h2>' +
        '<form class="stack" data-form="resume"><textarea id="resume" name="text" style="min-height:220px" maxlength="20000" placeholder="Paste your resume text here" aria-label="Resume text">' + esc(S.resume) + '</textarea>' +
        '<div class="row between"><span class="muted small">Saved privately to your account.</span><button class="btn primary">Check it</button></div></form>' +
        '<div id="report">' + reportHtml() + '</div></section>' +
        '<section class="card stack"><h2>Mock interview</h2>' +
        '<div><span class="pill">' + q.c + '</span><p class="question">' + esc(q.q) + '</p>' +
        '<p class="muted small">Answer out loud. Try STAR: Situation, Task, Action, Result. Aim for under 2 minutes.</p></div>' +
        '<div class="row"><span class="timer" id="timer">0:00</span>' +
        '<button class="btn" data-act="timer" id="timerbtn">Start timer</button>' +
        '<button class="btn ghost" data-act="next-q">Skip question</button></div>' +
        '<div><p class="small"><b>How did that go?</b></p><div class="row" style="margin-top:6px">' +
        '<button class="btn ghost" data-act="rate" data-r="Nailed">😎 Nailed it</button>' +
        '<button class="btn ghost" data-act="rate" data-r="Okay">🙂 Okay</button>' +
        '<button class="btn ghost" data-act="rate" data-r="Rough">😬 Rough</button></div></div>' +
        '<p class="banner">Practiced ' + S.practice.length + ' so far: ' + tally.Nailed + ' nailed, ' + tally.Okay + ' okay, ' + tally.Rough + ' rough.</p>' +
        '</section></div>';
    },

    routine: function () {
      var mood = S.routine.moods[today()];
      var days = [];
      for (var i = 6; i >= 0; i--) {
        var d = new Date(); d.setDate(d.getDate() - i);
        var k = dkey(d), m = MOODS[S.routine.moods[k]];
        days.push('<div class="day' + (hit(k) ? ' hit' : '') + '"><i>' + (m || (hit(k) ? '✓' : '·')) + '</i>' +
          d.toLocaleDateString(undefined, { weekday: 'short' }) + '</div>');
      }
      return head('Routine 🔥', 'Job hunting is a job. Tick at least one thing a day to keep the streak alive.') +
        '<div class="stats"><div class="stat hot"><b>🔥 ' + streak() + '</b><span>day streak</span></div>' +
        '<div class="stat"><b>' + doneOn(today()).length + '/' + S.routine.tasks.length + '</b><span>done today</span></div></div>' +
        '<div class="grid2"><section class="card"><h2>Today</h2>' + taskList() +
        '<form class="row" data-form="task" style="margin-top:12px"><input class="grow" type="text" name="text" placeholder="Add your own task" aria-label="New task" maxlength="80" required>' +
        '<button class="btn">Add</button></form></section>' +
        '<div class="stack"><section class="card"><h2>How are you feeling today?</h2><div class="moods">' +
        MOODS.map(function (mo, i) {
          return '<button class="mood' + (mood === i ? ' on' : '') + '" data-act="mood" data-v="' + i + '" aria-label="Mood ' + (i + 1) + ' of 5" aria-pressed="' + (mood === i) + '">' + mo + '</button>';
        }).join('') + '</div>' +
        (mood !== undefined && mood <= 1 ? '<p class="small muted" style="margin-top:10px">Rough days are part of this. Do one tiny task, then go easy on yourself.</p>' : '') +
        '</section><section class="card"><h2>Last 7 days</h2><div class="week">' + days.join('') + '</div></section></div></div>';
    }
  };

  function jobList() {
    var q = ui.jobQuery.trim().toLowerCase();
    var list = JOBS.filter(function (j) {
      if (ui.jobMode !== 'All' && j.mode !== ui.jobMode) return false;
      return !q || (j.title + ' ' + j.company + ' ' + j.loc + ' ' + j.tags.join(' ')).toLowerCase().indexOf(q) > -1;
    });
    if (!list.length) return '<p class="muted">Nothing matches that. Try a different word.</p>';
    return list.map(function (j) {
      var tracked = S.apps.some(function (a) { return a.jobId === j.id; });
      return '<article class="card job"><h3>' + esc(j.title) + '</h3><p class="meta">' + esc(j.company) + ' · ' + esc(j.loc) + ' · ' + esc(j.pay) + '</p>' +
        '<div class="row between"><div class="row"><span class="pill">' + j.mode + '</span>' +
        j.tags.map(function (t) { return '<span class="pill">' + esc(t) + '</span>'; }).join('') + '</div>' +
        '<button class="btn tiny' + (tracked ? ' ghost' : ' primary') + '" data-act="track-job" data-id="' + j.id + '"' + (tracked ? ' disabled' : '') + '>' + (tracked ? 'Tracked ✓' : 'Track') + '</button></div></article>';
    }).join('');
  }

  // ---------- resume checker (simple rules, runs in the browser) ----------
  var VERBS = ['built', 'led', 'designed', 'launched', 'improved', 'increased', 'reduced', 'created', 'managed', 'developed', 'delivered', 'automated', 'analyzed', 'organized', 'trained', 'shipped', 'implemented', 'optimized', 'grew', 'saved', 'mentored', 'negotiated', 'resolved', 'streamlined', 'tested', 'wrote', 'handled'];
  var CLICHES = ['hard-working', 'hardworking', 'team player', 'detail-oriented', 'go-getter', 'think outside the box', 'synergy', 'results-driven', 'self-motivated', 'passionate', 'dynamic'];

  function analyze(text) {
    var low = text.toLowerCase();
    var words = low.match(/[a-z0-9'’-]+/g) || [];
    var checks = [];
    function add(ok, w, good, tip) { checks.push({ ok: ok, w: w, msg: ok ? good : tip }); }

    var wc = words.length;
    add(wc >= 200 && wc <= 800, 15, 'Length looks right (' + wc + ' words).',
      wc < 200 ? 'Only ' + wc + ' words. Add detail on what you did and what came of it.' : wc + ' words is long. Aim for one page, about 400–700 words.');
    add(/[\w.+-]+@[\w-]+\.[\w.]+/.test(text), 10, 'Email address found.', 'Add an email address at the top.');
    add(/\+?\d[\d\s().-]{8,}\d/.test(text), 5, 'Phone number found.', 'Add a phone number so recruiters can call.');
    add(/linkedin|github|behance|portfolio|https?:\/\//.test(low), 5, 'Has a profile or portfolio link.', 'Add a LinkedIn, GitHub or portfolio link.');

    var missing = ['experience', 'education', 'skills'].filter(function (s) { return low.indexOf(s) === -1; });
    if (missing.indexOf('experience') > -1 && /projects|internship/.test(low)) missing.splice(missing.indexOf('experience'), 1);
    add(!missing.length, 15, 'Has the main sections.', 'Missing section: ' + missing.join(', ') + '.');

    var verbs = VERBS.filter(function (v) { return words.indexOf(v) > -1; });
    add(verbs.length >= 5, 15, 'Strong action verbs (' + verbs.length + ' different ones).',
      'Only ' + verbs.length + ' action verbs. Start bullets with words like built, led, improved, reduced.');

    var nums = (text.match(/(?:[$₹€£]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:%|percent|x\b|k\b|\+|lakh|users|customers|clients|people|hours|days|weeks|months|projects|tickets))/gi) || []).length;
    add(nums >= 3, 15, 'Good use of numbers (' + nums + ' results with figures).',
      'Only ' + nums + ' results with numbers. Add figures: "cut load time by 30%", "handled 50 tickets a day".');

    var cl = CLICHES.filter(function (c) { return low.indexOf(c) > -1; });
    add(cl.length <= 1, 10, 'Light on buzzwords.', 'Swap buzzwords for proof: ' + cl.join(', ') + '.');

    var pron = words.filter(function (w) { return w === 'i' || w === 'my' || w === 'me'; }).length;
    add(pron <= 3, 10, 'Bullets are not full of "I" and "my".', '"I / my / me" appears ' + pron + ' times. Drop them: "Built X" instead of "I built X".');

    var total = 0, got = 0;
    checks.forEach(function (c) { total += c.w; if (c.ok) got += c.w; });
    return { score: Math.round(got / total * 100), checks: checks };
  }

  function reportHtml() {
    var r = ui.report;
    if (!r) return '<p class="muted small">Paste your resume and hit Check it for a quick score and fixes.</p>';
    var verdict = r.score >= 85 ? 'Send it. 🚀' : r.score >= 60 ? 'Close. A few fixes and it is ready.' : 'Good start. Work through the list below.';
    return '<div class="row"><span class="score">' + r.score + '</span><span><b>out of 100</b><br><span class="muted small">' + verdict + '</span></span></div>' +
      '<ul class="checks">' + r.checks.map(function (c) {
        return '<li><span class="' + (c.ok ? 'ok' : 'no') + '">' + (c.ok ? '✓' : '✗') + '</span><span>' + esc(c.msg) + '</span></li>';
      }).join('') + '</ul><p class="muted small" style="margin-top:10px">This is a simple rule check, not an AI review.</p>';
  }

  // ---------- actions ----------
  // Handlers that change private data return nothing (the caller saves + re-renders).
  // Handlers that talk to the server, or only touch the screen, return false and render themselves.
  function find(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }
  function stopTimer() { if (ui.timerId) { clearInterval(ui.timerId); ui.timerId = null; } }
  function nextQ() {
    var n = ui.q;
    while (n === ui.q) n = Math.floor(Math.random() * QUESTIONS.length);
    ui.q = n; stopTimer();
  }
  function feedCall(promise) {
    promise.then(loadPosts).then(render).catch(fail);
    return false;
  }
  function enter(j, importOld) {
    me = j.user; S = adopt(j.data); ui.authError = '';
    if (j.recoveryCode) ui.newCode = j.recoveryCode;
    if (importOld) {
      var old = oldLocal();
      if (old) { S = old; saveTimer = setTimeout(flush, 0); }
      try { localStorage.removeItem(OLD_KEY); } catch (e) { /* storage blocked */ }
    }
    loadSeen(); startStream(); loadSummary().catch(function () { /* the chat page retries */ });
    return loadPosts().catch(fail);
  }
  function oldLocal() {
    try {
      var raw = JSON.parse(localStorage.getItem(OLD_KEY));
      if (!isObj(raw)) return null;
      var a = adopt(raw);
      var used = a.apps.length || a.practice.length || a.resume || Object.keys(a.routine.log).length;
      return used ? a : null;
    } catch (e) { return null; }
  }

  var actions = {
    'auth-mode': function (d) {
      ui.authMode = d.mode || 'login'; ui.authError = '';
      render(); return false;
    },
    'copy-code': function () {
      var note = document.getElementById('copied');
      var done = function (ok) { note.textContent = ok ? 'Copied ✓' : 'Copy failed. Select the code and copy it by hand.'; };
      try { navigator.clipboard.writeText(ui.newCode).then(function () { done(true); }, function () { done(false); }); }
      catch (e) { done(false); }
      return false;
    },
    older: function () {
      var ch = activeChannel(), el = msgsEl();
      if (!ch || !el) return false;
      var fromBottom = el.scrollHeight - el.scrollTop;
      loadChannel(ch, true).then(function () {
        var now = msgsEl();
        if (!now || activeChannel() !== ch) return;
        now.innerHTML = msgsHtml(ch);
        now.scrollTop = now.scrollHeight - fromBottom; // keep the reader's place
      }).catch(fail);
      return false;
    },
    report: function (d) {
      closeMenus();
      var reason = window.prompt('Report this message to the moderators.\nWhat is wrong with it? (optional)', '');
      if (reason === null) return false;
      api('POST', '/api/chat/msg/' + Number(d.id) + '/report', { reason: reason })
        .then(function () { toast('Reported. Thanks for looking out for everyone.'); }).catch(fail);
      return false;
    },
    block: function (d) {
      closeMenus();
      if (!window.confirm('Block @' + d.u + '?\n\nThey will not be able to message you, and you will not see their messages in rooms. You can unblock them from your Account page.')) return false;
      api('POST', '/api/blocks/' + encodeURIComponent(d.u))
        .then(function () { toast('Blocked @' + d.u + '.'); chatBlocked(d.u, true); }).catch(fail);
      return false;
    },
    unblock: function (d) {
      api('DELETE', '/api/blocks/' + encodeURIComponent(d.u)).then(function () {
        toast('Unblocked @' + d.u + '.');
        chatBlocked(d.u, false);
        if (currentView() === 'account') loadBlocks();
      }).catch(fail);
      return false;
    },
    'del-msg': function (d) {
      closeMenus();
      if (!window.confirm('Delete this message?')) return false;
      var ch = activeChannel();
      api('DELETE', '/api/chat/msg/' + Number(d.id))
        .then(function () { onChatEvent({ type: 'del', channel: ch, id: Number(d.id) }); }).catch(fail);
      return false;
    },
    mod: function (d) {
      if (d.a === 'ban' && !window.confirm('Delete this message and ban @' + d.u + '?\n\nThey are signed out and cannot log in. Their posts and messages are hidden. You can unban them later.')) return false;
      api('POST', '/api/admin/reports/' + Number(d.id), { action: d.a }).then(function () {
        toast(d.a === 'dismiss' ? 'Report dismissed.' : d.a === 'ban' ? 'Message deleted and @' + d.u + ' banned.' : 'Message deleted.');
        loadAdmin();
        if (d.a === 'ban') { chat.msgs = {}; loadSummary().catch(function () { /* refreshed on next visit */ }); }
      }).catch(fail);
      return false;
    },
    unban: function (d) {
      if (!window.confirm('Unban @' + d.u + '? They will be able to log in again.')) return false;
      api('POST', '/api/admin/unban/' + encodeURIComponent(d.u)).then(function () { toast('@' + d.u + ' unbanned.'); loadAdmin(); }).catch(fail);
      return false;
    },
    'code-done': function () {
      ui.newCode = '';
      render(); window.scrollTo(0, 0); return false;
    },
    logout: function () {
      flush().then(function () { return api('POST', '/api/logout'); }).catch(function () {}).then(function () {
        signedOut(); ui.authMode = 'login'; location.hash = '#/home'; render();
      });
      return false;
    },
    'toggle-task': function (d) {
      var k = today(), log = Array.isArray(S.routine.log[k]) ? S.routine.log[k] : [], i = log.indexOf(d.id);
      if (i > -1) log.splice(i, 1); else log.push(d.id);
      if (log.length) S.routine.log[k] = log; else delete S.routine.log[k];
    },
    'del-task': function (d) {
      S.routine.tasks = S.routine.tasks.filter(function (t) { return t.id !== d.id; });
    },
    mood: function (d) {
      var v = Number(d.v), k = today();
      if (S.routine.moods[k] === v) delete S.routine.moods[k]; else S.routine.moods[k] = v;
    },
    react: function (d) {
      return feedCall(api('POST', '/api/posts/' + Number(d.id) + '/react', { r: d.r }));
    },
    'del-post': function (d) {
      if (!confirm('Delete this post?')) return false;
      return feedCall(api('DELETE', '/api/posts/' + Number(d.id)));
    },
    'track-job': function (d) {
      var j = find(JOBS, d.id);
      if (!j || S.apps.some(function (a) { return a.jobId === j.id; })) return false;
      S.apps.push({ id: uid(), jobId: j.id, title: j.title, company: j.company, stage: 'Wishlist', t: Date.now() });
    },
    'move-app': function (d) {
      var a = find(S.apps, d.id); if (!a) return;
      var i = STAGES.indexOf(a.stage) + Number(d.dir);
      if (i >= 0 && i < STAGES.length) a.stage = STAGES[i];
    },
    'del-app': function (d) {
      S.apps = S.apps.filter(function (a) { return a.id !== d.id; });
    },
    'next-q': function () { nextQ(); render(); return false; },
    rate: function (d) {
      S.practice.push({ q: QUESTIONS[ui.q].q, r: d.r, t: Date.now() });
      nextQ();
    },
    timer: function (d, btn) {
      var out = document.getElementById('timer');
      if (ui.timerId) { stopTimer(); btn.textContent = 'Restart timer'; return false; }
      ui.timerStart = Date.now();
      out.textContent = '0:00';
      btn.textContent = 'Stop timer';
      ui.timerId = setInterval(function () {
        var s = Math.floor((Date.now() - ui.timerStart) / 1000);
        out.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      }, 250);
      return false;
    }
  };

  var forms = {
    chat: function (f, form) {
      var ch = activeChannel(), body = String(f.get('text') || '').trim();
      if (!ch || !body || chat.sending) return false;
      var box = form.querySelector('textarea'), btn = form.querySelector('button');
      chat.sending = true; btn.disabled = true;
      api('POST', channelUrl(ch), { text: body }).then(function (j) {
        if (box.value.trim() === body) { box.value = ''; autosize(box); }
        onChatEvent({ type: 'msg', channel: ch, msg: j.msg, peer: chat.peers[ch] });
      }).catch(function (e) { if (e.status === 401) fail(e); else toast(e.message); })
        .then(function () { chat.sending = false; btn.disabled = false; if (document.body.contains(box)) box.focus(); });
      return false;
    },
    auth: function (f, form) {
      var mode = ui.authMode;
      var body = { username: String(f.get('username')).trim(), password: String(f.get('password')) };
      if (mode === 'signup') body.name = String(f.get('name')).trim();
      if (mode === 'reset') body.code = String(f.get('code')).trim();
      ui.authUser = body.username; ui.authName = body.name || '';
      var btn = form.querySelector('button.primary');
      btn.disabled = true;
      api('POST', '/api/' + mode, body)
        .then(function (j) { ui.authMode = 'login'; return enter(j, mode === 'signup'); })
        .catch(function (e) { ui.authError = e.message; })
        .then(render);
      return false;
    },
    recovery: function (f, form) {
      form.querySelector('button').disabled = true;
      api('POST', '/api/me/recovery', { password: String(f.get('password')) })
        .then(function (j) { me.hasRecovery = true; ui.newCode = j.recoveryCode; ui.acctMsg = { ok: true, text: 'New recovery code made. Your old one no longer works.' }; })
        .catch(function (e) { if (e.status === 429 || e.status === 401 || e.status === 400) ui.acctMsg = { ok: false, text: e.message }; else fail(e); })
        .then(render);
      return false;
    },
    password: function (f, form) {
      form.querySelector('button').disabled = true;
      api('POST', '/api/me/password', { password: String(f.get('password')), newPassword: String(f.get('newPassword')) })
        .then(function () { ui.acctMsg = { ok: true, text: 'Password changed. Other devices have been signed out.' }; })
        .catch(function (e) { if (e.status === 429 || e.status === 401 || e.status === 400) ui.acctMsg = { ok: false, text: e.message }; else fail(e); })
        .then(render);
      return false;
    },
    post: function (f) {
      var text = String(f.get('text')).trim(); if (!text) return false;
      return feedCall(api('POST', '/api/posts', { text: text, tag: f.get('tag') }));
    },
    reply: function (f) {
      var text = String(f.get('text')).trim(); if (!text) return false;
      return feedCall(api('POST', '/api/posts/' + Number(f.get('id')) + '/replies', { text: text }));
    },
    app: function (f) {
      var title = String(f.get('title')).trim(), company = String(f.get('company')).trim();
      if (!title || !company) return false;
      var stage = STAGES.indexOf(f.get('stage')) > -1 ? f.get('stage') : 'Wishlist';
      S.apps.push({ id: uid(), title: title, company: company, stage: stage, t: Date.now() });
    },
    task: function (f) {
      var text = String(f.get('text')).trim(); if (!text) return false;
      S.routine.tasks.push({ id: uid(), text: text });
    },
    resume: function (f) {
      S.resume = String(f.get('text'));
      ui.report = S.resume.trim() ? analyze(S.resume) : null;
    }
  };

  // ---------- chat ----------
  // Rooms and DMs. Live updates arrive over one EventSource; history loads per channel.
  // Client-side channel names: 'room:<slug>' and 'dm:<other person's username>'.
  var ROOM_EMOJI = { lobby: '👋', 'job-leads': '💼', 'interview-prep': '🎤', vent: '🌧️' };
  var BASE_TITLE = document.title;
  var chat = freshChat();
  function freshChat() {
    return { summary: null, msgs: {}, more: {}, peers: {}, errors: {}, seen: {}, seedSeen: false, es: null, retryTimer: null, down: false, sending: false };
  }

  function isChatView() { return !!me && !ui.newCode && currentView() === 'chat'; }
  function wideScreen() { return window.matchMedia('(min-width: 861px)').matches; }
  function chatChannel() {
    var p = location.hash.replace(/^#\/?/, '').split('/');
    if (p[0] === 'dm' && /^[a-z0-9_]{3,20}$/i.test(p[1] || '')) return 'dm:' + p[1].toLowerCase();
    if (p[0] === 'chat' && /^[a-z-]{1,30}$/.test(p[1] || '')) return 'room:' + p[1];
    return '';
  }
  // On a wide screen an empty #/chat opens #lobby; on a phone it shows the list of chats.
  function activeChannel() { return chatChannel() || (wideScreen() ? 'room:lobby' : ''); }
  function isDm(ch) { return ch.indexOf('dm:') === 0; }
  function channelUrl(ch) {
    return isDm(ch) ? '/api/chat/dm/' + encodeURIComponent(ch.slice(3)) : '/api/chat/room/' + encodeURIComponent(ch.slice(5));
  }
  function roomBySlug(slug) {
    var s = chat.summary;
    return s ? s.rooms.filter(function (r) { return r.slug === slug; })[0] : null;
  }
  function dmByUser(u) {
    var s = chat.summary;
    return s ? s.dms.filter(function (d) { return d.username === u; })[0] : null;
  }
  function initial(name) { return (Array.from(String(name || '?'))[0] || '?').toUpperCase(); }
  function clock(t) {
    var d = new Date(t), time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return dkey(d) === today() ? time : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + time;
  }

  // ----- unread tracking (per device, in localStorage) -----
  function seenKey() { return 'bench:seen:' + me.username; }
  function loadSeen() {
    chat.seen = {}; chat.seedSeen = true;
    try {
      var raw = localStorage.getItem(seenKey());
      if (raw !== null) { var v = JSON.parse(raw); if (isObj(v)) chat.seen = v; chat.seedSeen = false; }
    } catch (e) { /* storage blocked: everything just counts as read on load */ }
  }
  function markSeen(ch, id) {
    if (!id || (chat.seen[ch] || 0) >= id) return;
    chat.seen[ch] = id;
    try { localStorage.setItem(seenKey(), JSON.stringify(chat.seen)); } catch (e) { /* storage blocked */ }
  }
  function lastIdOf(ch) {
    var x = isDm(ch) ? dmByUser(ch.slice(3)) : roomBySlug(ch.slice(5));
    return x ? x.lastId || 0 : 0;
  }
  function isUnread(ch) {
    if (isDm(ch)) { var d = dmByUser(ch.slice(3)); if (!d || d.lastFromMe) return false; }
    return lastIdOf(ch) > (chat.seen[ch] || 0);
  }
  function markLatest(ch) {
    var list = chat.msgs[ch] || [];
    markSeen(ch, Math.max(list.length ? list[list.length - 1].id : 0, lastIdOf(ch)));
  }
  function updateBadge() {
    var n = chat.summary ? chat.summary.dms.filter(function (d) { return isUnread('dm:' + d.username); }).length : 0;
    var el = document.getElementById('chatbadge');
    if (el) { el.textContent = n ? String(n) : ''; el.hidden = !n; }
    document.title = (n ? '(' + n + ') ' : '') + BASE_TITLE;
  }

  // ----- HTML -----
  function chatListHtml(active) {
    var s = chat.summary;
    if (!s) return '<p class="muted small pad">Loading chats…</p>';
    var rooms = s.rooms.map(function (r) {
      var ch = 'room:' + r.slug, un = ch !== active && isUnread(ch);
      return '<a class="ch' + (ch === active ? ' on' : '') + (un ? ' unread' : '') + '" href="#/chat/' + esc(r.slug) + '"' + (ch === active ? ' aria-current="page"' : '') + '>' +
        '<span class="ch-icon" aria-hidden="true">' + (ROOM_EMOJI[r.slug] || '#') + '</span><span class="ch-text"><b># ' + esc(r.slug) + '</b></span>' +
        (un ? '<i class="dot" aria-label="new messages"></i>' : '') + '</a>';
    }).join('');
    var dms = s.dms.map(function (d) {
      var ch = 'dm:' + d.username, un = ch !== active && isUnread(ch);
      return '<a class="ch' + (ch === active ? ' on' : '') + (un ? ' unread' : '') + '" href="#/dm/' + esc(d.username) + '"' + (ch === active ? ' aria-current="page"' : '') + '>' +
        '<span class="avatar" aria-hidden="true">' + esc(initial(d.name)) + '</span>' +
        '<span class="ch-text"><b>' + esc(d.name) + '</b><small>' + esc((d.lastFromMe ? 'You: ' : '') + (d.lastText || '')) + '</small></span>' +
        (un ? '<i class="dot" aria-label="unread"></i>' : '') + '</a>';
    }).join('') || '<p class="muted small pad">No private chats yet. Tap someone\'s name in a room or on the feed to message them.</p>';
    return '<h3>Rooms</h3><nav class="chs" aria-label="Rooms">' + rooms + '</nav><h3>Direct messages</h3><nav class="chs" aria-label="Direct messages">' + dms + '</nav>';
  }

  function composerHtml(label) {
    return '<form class="composer" data-form="chat"><textarea id="chatbox" name="text" rows="1" maxlength="1000" placeholder="' + esc(label) + '" aria-label="' + esc(label) + '" required></textarea>' +
      '<button class="btn primary">Send</button></form>';
  }

  function paneHtml(ch) {
    var back = '<a class="back" href="#/chat" aria-label="All chats">←</a>';
    if (chat.errors[ch]) {
      return '<header class="pane-head">' + back + '<div><h2>Hmm</h2></div></header><div class="pane-empty"><p>' + esc(chat.errors[ch]) + '</p><a href="#/chat/lobby">Go to #lobby</a></div>';
    }
    var head, notice = '', composer;
    if (isDm(ch)) {
      var u = ch.slice(3), peer = chat.peers[ch];
      var name = peer ? peer.name : (dmByUser(u) || {}).name || '@' + u;
      head = '<div class="grow"><h2>' + esc(name) + '</h2><p class="muted small">@' + esc(u) + ' · private chat</p></div>' +
        (peer ? '<button class="btn tiny ghost" data-act="' + (peer.blockedByMe ? 'unblock' : 'block') + '" data-u="' + esc(u) + '">' + (peer.blockedByMe ? 'Unblock' : 'Block') + '</button>' : '');
      notice = '<p class="scam">🛡️ Real employers never ask you to pay for a job, training or "registration". Never share OTPs, bank details or ID documents in chat. Report anyone who asks.</p>';
      composer = peer && peer.blockedByMe
        ? '<p class="composer-note muted small">You blocked this person. Unblock them to send messages.</p>'
        : composerHtml('Message ' + name);
    } else {
      var slug = ch.slice(5), room = roomBySlug(slug) || (chat.summary ? null : { slug: slug, desc: '' });
      if (!room) return '<header class="pane-head">' + back + '<div><h2>No such room</h2></div></header><div class="pane-empty"><p>That room does not exist.</p><a href="#/chat/lobby">Go to #lobby</a></div>';
      head = '<div class="grow"><h2># ' + esc(room.slug) + '</h2><p class="muted small">' + esc(room.desc) + '</p></div>';
      composer = composerHtml('Message #' + room.slug);
    }
    return '<header class="pane-head">' + back + head + '</header>' + notice +
      '<div class="msgs" id="msgs" role="log" aria-label="Messages">' + msgsHtml(ch) + '</div>' + composer;
  }

  function msgsHtml(ch) {
    var list = chat.msgs[ch];
    if (!list) return '<p class="muted small pad">Loading messages…</p>';
    var older = chat.more[ch] ? '<button class="btn tiny ghost older" data-act="older">Load older messages</button>' : '';
    if (!list.length) return older + '<p class="muted pad empty">' + (isDm(ch) ? 'Say hi 👋' : 'No messages yet. Start the conversation!') + '</p>';
    return older + list.map(function (m) { return msgHtml(m, ch); }).join('');
  }

  function msgHtml(m, ch) {
    var own = m.username === me.username, room = !isDm(ch), u = esc(m.username), id = Number(m.id);
    var opts = [];
    if (!own && room) opts.push('<a href="#/dm/' + u + '">Message privately</a>');
    if (!own) opts.push('<button type="button" data-act="report" data-id="' + id + '">Report</button>');
    if (!own && room) opts.push('<button type="button" data-act="block" data-u="' + u + '">Block @' + u + '</button>');
    if (own || me.isAdmin) opts.push('<button type="button" data-act="del-msg" data-id="' + id + '">Delete' + (own ? '' : ' (moderator)') + '</button>');
    var who = own || !room
      ? '<b class="who">' + esc(m.name) + '</b>'
      : '<a class="who" href="#/dm/' + u + '" title="Message @' + u + ' privately">' + esc(m.name) + '</a>';
    return '<div class="msg' + (own ? ' own' : '') + '" data-id="' + id + '"><div class="msg-head">' + who +
      '<time class="muted small">' + clock(m.t) + '</time>' +
      (opts.length ? '<details class="msg-menu"><summary aria-label="Message options">⋯</summary><div class="menu">' + opts.join('') + '</div></details>' : '') +
      '</div><p class="msg-text">' + esc(m.text) + '</p></div>';
  }

  // ----- DOM updates that keep the half-typed message in the box -----
  function msgsEl() { return document.getElementById('msgs'); }
  function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 80; }
  function scrollMsgs() { var el = msgsEl(); if (el) el.scrollTop = el.scrollHeight; }
  function refreshChatList() {
    var el = document.getElementById('chatlist');
    if (el && isChatView()) el.innerHTML = chatListHtml(activeChannel());
  }
  function renderPane(ch) {
    var pane = document.getElementById('chatpane');
    if (!pane || !isChatView() || activeChannel() !== ch) return;
    var box = document.getElementById('chatbox'), draft = box ? box.value : '', focused = !!box && document.activeElement === box;
    pane.innerHTML = paneHtml(ch);
    var nb = document.getElementById('chatbox');
    if (nb) { nb.value = draft; autosize(nb); if (focused) nb.focus(); }
    scrollMsgs();
  }
  function appendMsg(m, ch) {
    var el = msgsEl();
    if (!el || !isChatView() || activeChannel() !== ch) return;
    var stick = nearBottom(el) || m.username === me.username;
    var empty = el.querySelector('.empty');
    if (empty) empty.remove();
    el.insertAdjacentHTML('beforeend', msgHtml(m, ch));
    if (stick) scrollMsgs();
  }
  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight + 4, 160) + 'px';
    el.style.overflowY = el.scrollHeight + 4 > 160 ? 'auto' : 'hidden';
  }
  function closeMenus(except) {
    document.querySelectorAll('details.msg-menu[open]').forEach(function (d) { if (d !== except) d.open = false; });
  }

  // ----- data -----
  function loadSummary() {
    return api('GET', '/api/chat/summary').then(function (s) {
      chat.summary = { rooms: Array.isArray(s.rooms) ? s.rooms : [], dms: Array.isArray(s.dms) ? s.dms : [] };
      if (chat.seedSeen) { // first visit on this device: count what is already there as read
        chat.seedSeen = false;
        chat.summary.rooms.forEach(function (r) { markSeen('room:' + r.slug, r.lastId); });
        chat.summary.dms.forEach(function (d) { markSeen('dm:' + d.username, d.lastId); });
      }
      if (isChatView()) { var ch = activeChannel(); if (ch) { markLatest(ch); renderPane(ch); } refreshChatList(); }
      updateBadge();
    });
  }

  function loadChannel(ch, older) {
    var list = chat.msgs[ch], before = older && list && list.length ? list[0].id : 0;
    return api('GET', channelUrl(ch) + (before ? '?before=' + before : '')).then(function (j) {
      var got = Array.isArray(j.messages) ? j.messages : [];
      chat.msgs[ch] = older && chat.msgs[ch] ? got.concat(chat.msgs[ch]) : got;
      chat.more[ch] = !!j.more;
      delete chat.errors[ch];
      if (j.peer) chat.peers[ch] = { username: j.peer.username, name: j.peer.name, blockedByMe: !!j.blockedByMe };
    }, function (e) {
      if (e.status === 404 || e.status === 400) { chat.errors[ch] = e.message; return; }
      throw e;
    });
  }

  function openChannel(ch) {
    var ready = chat.msgs[ch] && !chat.errors[ch];
    if (ready) { markLatest(ch); refreshChatList(); updateBadge(); }
    if (ready && chat.es) return; // the live stream keeps an open channel's cache current
    loadChannel(ch).then(function () {
      renderPane(ch);
      if (isChatView() && activeChannel() === ch) { markLatest(ch); refreshChatList(); updateBadge(); }
    }).catch(fail);
  }

  function bumpSummary(ch, m, peer) {
    var s = chat.summary;
    if (!s) return;
    if (!isDm(ch)) { var r = roomBySlug(ch.slice(5)); if (r && m.id > (r.lastId || 0)) r.lastId = m.id; return; }
    var u = ch.slice(3), d = dmByUser(u);
    if (!d) d = { username: u, name: peer && peer.name ? peer.name : u };
    s.dms = [d].concat(s.dms.filter(function (x) { return x !== d; }));
    d.lastId = m.id; d.lastText = m.text; d.lastFromMe = m.username === me.username;
  }

  function onChatEvent(ev) {
    if (!isObj(ev) || typeof ev.channel !== 'string') return;
    var ch = ev.channel, open = isChatView() && activeChannel() === ch;
    if (ev.type === 'msg' && isObj(ev.msg)) {
      var m = ev.msg;
      if (chat.msgs[ch] && !chat.msgs[ch].some(function (x) { return x.id === m.id; })) {
        chat.msgs[ch].push(m);
        appendMsg(m, ch);
      }
      if (isDm(ch) && ev.peer && !chat.peers[ch]) chat.peers[ch] = { username: ev.peer.username, name: ev.peer.name, blockedByMe: false };
      bumpSummary(ch, m, ev.peer);
      if ((open && document.visibilityState === 'visible') || m.username === me.username) markSeen(ch, m.id);
      refreshChatList(); updateBadge();
    } else if (ev.type === 'del') {
      var id = Number(ev.id);
      if (chat.msgs[ch]) chat.msgs[ch] = chat.msgs[ch].filter(function (x) { return x.id !== id; });
      if (open) { var el = document.querySelector('#msgs .msg[data-id="' + id + '"]'); if (el) el.remove(); }
    }
  }

  // ----- live stream -----
  function startStream() {
    stopStream();
    if (!window.EventSource || !me) return;
    var es = new EventSource('/api/stream');
    chat.es = es;
    es.onopen = function () { if (chat.down) { chat.down = false; resync(); } };
    es.onmessage = function (e) { try { onChatEvent(JSON.parse(e.data)); } catch (err) { /* ignore a bad event */ } };
    es.onerror = function () {
      chat.down = true;
      // The browser retries by itself after a dropped connection. It gives up when the server
      // refuses (for example after logging out elsewhere), so check the session and try again.
      if (es.readyState === 2) {
        chat.es = null;
        clearTimeout(chat.retryTimer);
        chat.retryTimer = setTimeout(function () {
          api('GET', '/api/me').then(function () { if (me) startStream(); }).catch(fail);
        }, 5000);
      }
    };
  }
  function stopStream() {
    clearTimeout(chat.retryTimer);
    if (chat.es) { chat.es.close(); chat.es = null; }
  }
  // After a gap in the stream, refetch what might have been missed.
  function resync() {
    var ch = isChatView() ? activeChannel() : '';
    Object.keys(chat.msgs).forEach(function (k) { if (k !== ch) delete chat.msgs[k]; });
    loadSummary().catch(function () { /* next reconnect tries again */ });
    if (ch) loadChannel(ch).then(function () { renderPane(ch); }).catch(function () { /* same */ });
  }

  function chatBlocked(u, blocked) {
    var p = chat.peers['dm:' + u];
    if (p) p.blockedByMe = blocked;
    // Room history is filtered on the server, so drop cached rooms and let them reload.
    Object.keys(chat.msgs).forEach(function (k) { if (!isDm(k)) delete chat.msgs[k]; });
    if (isChatView()) { var ch = activeChannel(); if (ch) { renderPane(ch); openChannel(ch); } }
  }

  // ----- account: blocked people -----
  function loadBlocks() {
    api('GET', '/api/blocks').then(function (j) {
      var el = document.getElementById('blocklist');
      if (!el) return;
      var list = Array.isArray(j.blocks) ? j.blocks : [];
      el.innerHTML = list.length
        ? '<ul class="plain">' + list.map(function (u) {
            return '<li class="row between"><span>' + esc(u.name) + ' <span class="muted small">@' + esc(u.username) + '</span></span>' +
              '<button class="btn tiny ghost" data-act="unblock" data-u="' + esc(u.username) + '">Unblock</button></li>';
          }).join('') + '</ul>'
        : '<p class="muted small">You have not blocked anyone.</p>';
    }).catch(fail);
  }

  // ----- moderators -----
  function loadAdmin() {
    api('GET', '/api/admin/reports').then(function (j) {
      var el = document.getElementById('adminbody');
      if (el) el.innerHTML = adminHtml(j);
    }).catch(fail);
  }
  function adminHtml(j) {
    var reports = (j.reports || []).map(function (r) {
      var id = Number(r.id), a = esc(r.author);
      return '<article class="card stack report"><div class="row between"><span><b>' + esc(r.authorName) + '</b> <span class="muted small">@' + a +
        (r.authorBanned ? ' · banned' : '') + '</span></span><span class="muted small">in ' + esc(r.where) + '</span></div>' +
        '<p class="quote">' + (r.text ? esc(r.text) : '<i class="muted">(text removed)</i>') + '</p>' +
        (r.deleted ? '<p class="muted small">The author has already deleted this message.</p>' : '') +
        '<p class="small">Reported by @' + esc(r.reporter) + ', ' + ago(r.t) + (r.reason ? ': “' + esc(r.reason) + '”' : '') + '</p>' +
        '<div class="row"><button class="btn tiny ghost" data-act="mod" data-id="' + id + '" data-a="dismiss">Dismiss</button>' +
        '<button class="btn tiny" data-act="mod" data-id="' + id + '" data-a="delete">Delete message</button>' +
        (r.authorBanned ? '' : '<button class="btn tiny primary" data-act="mod" data-id="' + id + '" data-a="ban" data-u="' + a + '">Delete and ban @' + a + '</button>') +
        '</div></article>';
    }).join('') || '<p class="card muted">No open reports. 🎉</p>';
    var banned = (j.banned || []).map(function (u) {
      return '<li class="row between"><span>' + esc(u.name) + ' <span class="muted small">@' + esc(u.username) + '</span></span>' +
        '<button class="btn tiny ghost" data-act="unban" data-u="' + esc(u.username) + '">Unban</button></li>';
    }).join('') || '<li class="muted small">Nobody is banned.</li>';
    return '<div class="stack"><h2>Open reports (' + (j.reports || []).length + ')</h2>' + reports +
      '<section class="card"><h2>Banned accounts</h2><ul class="plain">' + banned + '</ul></section></div>';
  }

  var afterRender = {
    chat: function () {
      if (!chat.summary) loadSummary().catch(fail);
      var ch = activeChannel();
      if (!ch) return;
      scrollMsgs();
      openChannel(ch);
      var box = document.getElementById('chatbox');
      if (box && wideScreen()) box.focus();
    },
    account: loadBlocks,
    admin: function () { if (me.isAdmin) loadAdmin(); }
  };

  // ---------- wiring ----------
  var main = document.getElementById('main');

  function currentView() {
    var v = location.hash.replace(/^#\/?/, '').split('/')[0];
    if (v === 'dm') return 'chat';
    return views[v] ? v : 'home';
  }
  function render() {
    document.body.classList.toggle('anon', !me);
    main.classList.remove('chat-mode');
    if (ui.booting) { main.innerHTML = '<p class="muted">Pulling up a chair…</p>'; return; }
    if (!me) { main.innerHTML = authView(); return; }
    document.body.classList.toggle('anon', !!ui.newCode); // hide the nav until the code is saved
    if (ui.newCode) { main.innerHTML = codeView(); return; }
    var v = currentView();
    main.innerHTML = views[v]();
    main.classList.toggle('chat-mode', v === 'chat');
    document.querySelectorAll('#nav a').forEach(function (a) {
      var on = a.dataset.view === v;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    updateBadge();
    if (afterRender[v]) afterRender[v]();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var fn = actions[b.dataset.act];
    if (fn && fn(b.dataset, b) !== false) { save(); render(); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    var fn = forms[f.dataset.form];
    if (fn && fn(new FormData(f), f) !== false) { save(); render(); }
  });
  // Enter sends a chat message; Shift+Enter makes a new line.
  document.addEventListener('keydown', function (e) {
    if (e.target.id !== 'chatbox' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    var f = e.target.form;
    if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  // Close any open message menu when clicking elsewhere.
  document.addEventListener('click', function (e) {
    closeMenus(e.target.closest ? e.target.closest('details.msg-menu') : null);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !isChatView()) return;
    var ch = activeChannel();
    if (ch) { markLatest(ch); refreshChatList(); updateBadge(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'saved') document.getElementById('codedone').disabled = !e.target.checked;
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'jobq' || e.target.id === 'jobmode') {
      ui.jobQuery = document.getElementById('jobq').value;
      ui.jobMode = document.getElementById('jobmode').value;
      document.getElementById('joblist').innerHTML = jobList();
    } else if (e.target.id === 'resume') {
      S.resume = e.target.value; save();
    } else if (e.target.id === 'chatbox') {
      autosize(e.target);
    }
  });
  window.addEventListener('hashchange', function () {
    stopTimer(); render(); window.scrollTo(0, 0);
    var v = currentView();
    if (me && (v === 'feed' || v === 'home')) loadPosts().then(render).catch(fail);
  });
  window.addEventListener('pagehide', function () { flush(true); });

  render();
  api('GET', '/api/me')
    .then(function (j) { return enter(j, false); })
    .catch(function (e) { if (e.status !== 401) ui.authError = e.message; })
    .then(function () { ui.booting = false; render(); });
})();
