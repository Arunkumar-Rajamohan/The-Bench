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

  var ICONS = {
    bench: '<path d="M5 8h14"/><path d="M4 12.5h16"/><path d="M7 8V5.5M17 8V5.5"/><path d="M6 12.5V19M18 12.5V19M6 16h12"/>',
    home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.2V20h13V9.2"/><path d="M10 20v-5.5h4V20"/>',
    feed: '<path d="M4 5.5h12.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M16.5 9H20v9a2 2 0 0 1-2 2"/><path d="M7.5 9h5.5M7.5 12.5h5.5M7.5 16h3.5"/>',
    chat: '<path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L3.5 20l1.4-5A8 8 0 1 1 20.5 11.5z"/>',
    fun: '<path d="M11 3.5l1.6 4.6 4.6 1.6-4.6 1.6L11 16l-1.6-4.7L4.8 9.7l4.6-1.6z"/><path d="M18 14l.8 2.2 2.2.8-2.2.8L18 20l-.8-2.2-2.2-.8 2.2-.8z"/>',
    jobs: '<rect x="3.5" y="7" width="17" height="12.5" rx="2"/><path d="M8.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M3.5 12.5h17"/>',
    tracker: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M9.2 4v16M14.8 4v16"/><path d="M5.8 8h1.4M11.3 8h1.4"/>',
    prep: '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v3M9 20.5h6"/>',
    routine: '<path d="M12 20.5a6 6 0 0 0 6-6c0-4.2-3.2-6-4.2-10-2 1.8-3.2 4.2-3.2 6.4-1-.9-1.6-2.1-1.7-3.4C7.4 9.6 6 12 6 14.5a6 6 0 0 0 6 6z"/>',
    flame: '<path d="M12 20.5a6 6 0 0 0 6-6c0-4.2-3.2-6-4.2-10-2 1.8-3.2 4.2-3.2 6.4-1-.9-1.6-2.1-1.7-3.4C7.4 9.6 6 12 6 14.5a6 6 0 0 0 6 6z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.9 12.1 20 3"/><path d="M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>',
    shield: '<path d="M12 3.5l7.5 2.8V12c0 4.6-3.2 7.6-7.5 8.5-4.3-.9-7.5-3.9-7.5-8.5V6.3z"/><path d="M9 12l2 2 4-4"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    shuffle: '<path d="M3.5 7.5h3c1.8 0 2.9.9 3.9 2.5l2.4 4.2c.9 1.5 2 2.3 3.8 2.3h3.9"/><path d="M3.5 16.5h3c1.2 0 2.1-.4 2.8-1.2M14.3 8.7c.8-.8 1.7-1.2 2.9-1.2h3.3"/><path d="M18 4.5l2.5 3-2.5 3M18 13.5l2.5 3-2.5 3"/>',
    trophy: '<path d="M8 4h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 6H5.5a2.5 2.5 0 0 0 2.6 3.5M16 6h2.5a2.5 2.5 0 0 1-2.6 3.5"/><path d="M12 13.5v3.5M8.5 20.5h7M10 17h4"/>',
    'arrow-left': '<path d="M19 12H5.5M11 6l-6 6 6 6"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3a6.5 6.5 0 0 1 3.5 5.7"/>'
  };
  function ico(name) {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
  }
  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

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
  // Jobs come straight from employers' careers feeds (/api/jobs); leads are shared by members (/api/leads).
  var jobs = { tab: 'employers', list: [], total: 0, page: 1, what: '', where: '', remote: false, companies: 0, loaded: false, loading: false, error: '',
    leads: null, leadsError: '' };

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
      practice: [],
      bingo: null // made the first time the Fun tab opens
    };
  }
  // Turn whatever the server (or old local storage) holds into a safe, complete shape.
  function adopt(raw) {
    var b = blank();
    if (!isObj(raw)) return b;
    if (Array.isArray(raw.apps)) b.apps = raw.apps.filter(isObj);
    if (Array.isArray(raw.practice)) b.practice = raw.practice.filter(isObj);
    if (typeof raw.resume === 'string') b.resume = raw.resume;
    b.bingo = cleanBingo(raw.bingo);
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
    q: Math.floor(Math.random() * QUESTIONS.length),
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
    return '<div class="auth"><div class="auth-brand"><span class="brand-mark" aria-hidden="true">' + ico('bench') + '</span>' +
      '<h1>The <em>Bench</em></h1><p class="sub">A clubhouse for the between-jobs crowd. Everyone sits here sometimes.</p></div>' +
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
      '<h2>' + ico('key') + ' Save your recovery code</h2>' +
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
        '<span class="box">' + (on ? ico('check') : '') + '</span><span class="txt">' + esc(t.text) + '</span></button>' +
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
    var who = '<a class="who" href="#/u/' + esc(p.username) + '">' + esc(p.name) + '</a>';
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
      return head(greeting() + ', ' + esc(me.name) + '.', esc(pick(QUIPS))) +
        '<div class="stats">' +
        '<div class="stat hot"><b>' + streak() + '</b><span>' + ico('flame') + 'Day streak</span></div>' +
        '<div class="stat"><b>' + done + '/' + total + '</b><span>tasks done today</span></div>' +
        '<div class="stat"><b>' + S.apps.length + '</b><span>jobs tracked</span></div>' +
        '<div class="stat"><b>' + countStage('Interview') + '</b><span>interviews</span></div>' +
        '<div class="stat"><b>' + S.practice.length + '</b><span>questions practiced</span></div>' +
        '</div><div class="stack">' +
        (me.hasRecovery ? '' : '<p class="banner">' + ico('key') + '<span><b>Protect your account.</b> Get a recovery code so you can reset a forgotten password. <a href="#/account">Set it up</a></span></p>') +
        (me.profileDone ? '' : '<p class="banner">' + ico('users') + '<span><b>Say who you are.</b> Add the role you want and a line about yourself, so people know who they are chatting with. <a href="#/edit-profile">Set up your profile</a></span></p>') +
        '<p class="banner">' + ico('fun') + '<span>Today\'s puzzle and question of the day are up. <a href="#/fun">Play now</a></span></p>' +
        '<div class="grid2"><section class="card"><div class="row between"><h2>Today\'s routine</h2><a class="btn tiny ghost" href="#/routine">Open</a></div>' + taskList() + '</section>' +
        '<section class="stack"><div class="row between"><h2>Fresh from the feed</h2><a class="btn tiny ghost" href="#/feed">See all</a></div>' + latest + '</section></div>' +
        '<p class="small muted">Signed in as @' + esc(me.username) + ' · <a href="#/u/' + esc(me.username) + '">Your profile</a> · <a href="#/people">People</a> · <a href="#/account">Account</a> · <button class="link" data-act="logout">Log out</button></p></div>';
    },

    account: function () {
      var msg = ui.acctMsg ? '<p class="' + (ui.acctMsg.ok ? 'ok-msg' : 'err') + '" role="status">' + esc(ui.acctMsg.text) + '</p>' : '';
      return head('Account', 'Signed in as @' + esc(me.username) + '.') + msg +
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
        (me.isAdmin ? '<section class="card stack"><h2>' + ico('shield') + ' Moderation</h2><p class="small">You are a moderator.</p><a class="btn" href="#/admin">Open reports</a></section>' : '') +
        '</div>' +
        '<p class="small muted" style="margin-top:16px"><a href="#/home">← Back home</a> · <button class="link" data-act="logout">Log out</button></p>';
    },

    chat: function () {
      var ch = activeChannel();
      return '<div class="chat' + (ch ? ' has-ch' : '') + '"><aside class="chat-list card" id="chatlist">' + chatListHtml(ch) + '</aside>' +
        '<section class="chat-pane card" id="chatpane">' +
        (ch ? paneHtml(ch) : '<div class="pane-empty"><p>Pick a room or a person to chat with.</p></div>') + '</section></div>';
    },

    profile: function () { return '<div id="profilebody"><p class="muted">Loading profile…</p></div>'; },

    'edit-profile': function () {
      return head('Edit your profile', 'Members see this when they tap your name. Only your name is required.') +
        '<div id="editbody"><p class="muted">Loading…</p></div>';
    },

    people: function () {
      return head('People', 'Everyone on The Bench. Find someone hunting for the same kind of role, or just say hello.') +
        '<div class="stack"><input type="search" id="peopleq" placeholder="Search by name, role, skill or city" aria-label="Search people" value="' + esc(prof.query) + '">' +
        '<div class="people-grid" id="peoplelist">' + peopleHtml() + '</div></div>';
    },

    fun: function () {
      return head('Fun &amp; games', 'A new question and puzzle every day at midnight (India time), plus bingo for the bad days.') +
        '<div class="fun-grid"><section class="card stack" id="puzzle">' + puzzleHtml() + '</section>' +
        '<section class="card stack" id="qotd">' + qotdHtml() + '</section>' +
        '<section class="card stack fun-wide" id="bingo">' + bingoHtml() + '</section></div>';
    },

    admin: function () {
      if (!me.isAdmin) return head('Moderators only', 'This page is for moderators.');
      return head('Moderation', 'Reports from members. A private message only shows up here when one of the two people in it reports it.') +
        '<div id="adminbody"><p class="muted">Loading reports…</p></div>';
    },

    feed: function () {
      return head('The Feed', 'Wins, rants, questions and tips. No LinkedIn voice allowed.') +
        '<div class="stack narrow"><form class="card stack" data-form="post">' +
        '<textarea name="text" maxlength="600" placeholder="What happened today?" aria-label="Write a post" required></textarea>' +
        '<div class="row between"><select class="auto" name="tag" aria-label="Post type">' +
        TAGS.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select>' +
        '<button class="btn primary">Post as ' + esc(me.name) + '</button></div></form>' +
        (posts.map(function (p) { return postHtml(p, false); }).join('') ||
          '<p class="card muted">It is quiet in here. Post the first win, rant, question or tip.</p>') + '</div>';
    },

    jobs: function () {
      var emp = jobs.tab === 'employers';
      return head('Jobs', 'Real openings in India, straight from the companies hiring, plus leads members have spotted. No middlemen, no ads.') +
        '<div class="seg big" role="group" aria-label="Which jobs">' +
        '<button type="button" data-act="jobs-tab" data-t="employers" aria-pressed="' + emp + '"' + (emp ? ' class="on"' : '') + '>From employers</button>' +
        '<button type="button" data-act="jobs-tab" data-t="leads" aria-pressed="' + !emp + '"' + (!emp ? ' class="on"' : '') + '>Shared by members</button></div>' +
        '<div id="jobpane">' + (emp ? employersPane() : leadsPane()) + '</div>';
    },

    tracker: function () {
      var cols = STAGES.map(function (s, i) {
        var items = S.apps.filter(function (a) { return a.stage === s; });
        return '<section class="col"><h3><span>' + s + '</span><span class="muted">' + items.length + '</span></h3>' +
          items.map(function (a) {
            var id = esc(a.id);
            var title = typeof a.url === 'string' && /^https?:\/\//.test(a.url)
              ? '<a class="plain-link" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' : esc(a.title);
            return '<div class="app"><b>' + title + '</b><span class="muted small">' + esc(a.company) + '</span>' +
              '<div class="row between"><div class="row">' +
              '<button class="btn tiny ghost" data-act="move-app" data-id="' + id + '" data-dir="-1" aria-label="Move back"' + (i === 0 ? ' disabled' : '') + '>←</button>' +
              '<button class="btn tiny ghost" data-act="move-app" data-id="' + id + '" data-dir="1" aria-label="Move forward"' + (i === STAGES.length - 1 ? ' disabled' : '') + '>→</button></div>' +
              '<button class="link" data-act="del-app" data-id="' + id + '">remove</button></div></div>';
          }).join('') + '</section>';
      }).join('');
      return head('Tracker', 'Every application in one place, so nothing gets lost in your inbox.') +
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
      return head('Interview prep', 'Check your resume and practice answers out loud before the real thing.') +
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
        '<button class="btn ghost" data-act="rate" data-r="Nailed">Nailed it</button>' +
        '<button class="btn ghost" data-act="rate" data-r="Okay">Okay</button>' +
        '<button class="btn ghost" data-act="rate" data-r="Rough">Rough</button></div></div>' +
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
      return head('Routine', 'Job hunting is a job. Tick at least one thing a day to keep the streak alive.') +
        '<div class="stats"><div class="stat hot"><b>' + streak() + '</b><span>' + ico('flame') + 'Day streak</span></div>' +
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

  function trackBtn(id) {
    var tracked = S.apps.some(function (a) { return a.jobId === id; });
    return '<button class="btn tiny' + (tracked ? ' ghost' : '') + '" data-act="track-job" data-id="' + esc(id) + '"' + (tracked ? ' disabled' : '') + '>' + (tracked ? 'Tracked' : 'Track') + '</button>';
  }

  // ----- from employers -----
  function employersPane() {
    return '<form class="card job-search" data-form="jobsearch">' +
      '<label class="grow">Role, team or company<input type="search" name="what" maxlength="60" placeholder="e.g. support, finance, Stripe" value="' + esc(jobs.what) + '"></label>' +
      '<label class="grow">City <span class="muted">(optional)</span><input type="search" name="where" maxlength="60" placeholder="e.g. Bengaluru" value="' + esc(jobs.where) + '"></label>' +
      '<label class="check remote-check"><input type="checkbox" name="remote" value="1"' + (jobs.remote ? ' checked' : '') + '> Remote only</label>' +
      '<button class="btn primary">Search</button></form>' +
      '<div id="joblist">' + jobsHtml() + '</div>';
  }
  function jobHtml(j) {
    var tags = [j.remote ? 'Remote' : '', j.type, j.team].filter(Boolean).map(function (t) { return '<span class="pill">' + esc(t) + '</span>'; }).join('');
    return '<article class="card job"><div class="row between job-top"><h3>' + esc(j.title) + '</h3>' +
      (j.posted ? '<span class="muted small nowrap">' + ago(j.posted) + '</span>' : '') + '</div>' +
      '<p class="meta"><b class="company">' + esc(j.company) + '</b>' + (j.location ? ' · ' + esc(j.location) : '') + '</p>' +
      '<div class="row between job-foot"><div class="row">' + tags + '</div>' +
      '<div class="row">' + trackBtn(j.id) +
      '<a class="btn tiny primary" href="' + esc(j.url) + '" target="_blank" rel="noopener">Apply on ' + esc(j.company) + '\'s site</a></div></div></article>';
  }
  function jobsHtml() {
    if (jobs.error && !jobs.list.length) return '<p class="card muted">' + esc(jobs.error) + '</p>';
    if (!jobs.loaded) return '<p class="muted">Gathering openings from ' + (jobs.companies || 'the') + ' companies… the first load can take a few seconds.</p>';
    if (!jobs.list.length) return '<p class="card muted">No openings match that right now. Try a broader word, another city, or check <a href="#" data-act="jobs-tab" data-t="leads">Shared by members</a>.</p>';
    var shown = jobs.list.length, more = shown < jobs.total;
    var filters = [jobs.what && '“' + esc(jobs.what) + '”', jobs.where && 'in ' + esc(jobs.where), jobs.remote && 'remote'].filter(Boolean).join(' ');
    return '<p class="muted small results-count">' + jobs.total.toLocaleString() + ' opening' + (jobs.total === 1 ? '' : 's') + (filters ? ' for ' + filters : '') +
      ' from the careers pages of ' + jobs.companies + ' companies hiring in India. Newest first.</p>' +
      '<div class="jobs-list">' + jobs.list.map(jobHtml).join('') + '</div>' +
      (more ? '<div class="row center"><button class="btn" data-act="jobs-more"' + (jobs.loading ? ' disabled' : '') + '>' + (jobs.loading ? 'Loading…' : 'Show more') + '</button></div>' : '') +
      (jobs.error ? '<p class="err">' + esc(jobs.error) + '</p>' : '');
  }
  function renderJobs() {
    var el = document.getElementById('joblist');
    if (el && currentView() === 'jobs' && jobs.tab === 'employers') el.innerHTML = jobsHtml();
  }
  function loadJobs(more) {
    if (jobs.loading) return;
    jobs.loading = true; jobs.error = '';
    var page = more ? jobs.page + 1 : 1;
    if (!more) { jobs.list = []; jobs.total = 0; jobs.loaded = false; }
    renderJobs();
    var qs = '?page=' + page + (jobs.what ? '&what=' + encodeURIComponent(jobs.what) : '') +
      (jobs.where ? '&where=' + encodeURIComponent(jobs.where) : '') + (jobs.remote ? '&remote=1' : '');
    api('GET', '/api/jobs' + qs).then(function (j) {
      var seen = {};
      jobs.list.forEach(function (x) { seen[x.id] = true; });
      jobs.list = jobs.list.concat((j.jobs || []).filter(function (x) { return !seen[x.id]; }));
      jobs.total = Number(j.total) || 0;
      jobs.companies = Number(j.companies) || 0;
      jobs.page = page;
      jobs.loaded = true;
    }, function (e) {
      if (e.status === 401) return fail(e);
      jobs.error = e.message;
    }).then(function () { jobs.loading = false; renderJobs(); });
  }

  // ----- shared by members -----
  function leadsPane() {
    return '<details class="card share-lead"' + (jobs.leads && !jobs.leads.length ? ' open' : '') + '><summary><b>Share a job lead</b> <span class="muted small">Spotted an opening? Post the link so others can apply.</span></summary>' +
      '<form class="stack lead-form" data-form="lead">' +
      '<div class="grid2 tight"><label>Job title<input type="text" name="title" maxlength="100" required placeholder="e.g. Customer support executive"></label>' +
      '<label>Company<input type="text" name="company" maxlength="80" required placeholder="e.g. Kettle &amp; Co"></label></div>' +
      '<div class="grid2 tight"><label>City or Remote <span class="muted">(optional)</span><input type="text" name="location" maxlength="60" placeholder="e.g. Chennai"></label>' +
      '<label>Link to the job post<input type="url" name="url" maxlength="300" required placeholder="https://"></label></div>' +
      '<label>Note <span class="muted">(optional)</span><input type="text" name="note" maxlength="280" placeholder="e.g. I can refer you, or: freshers welcome, closes Friday"></label>' +
      '<p class="muted small">Only share real openings with a link to the employer or a trusted job site. Never post anything that asks people to pay.</p>' +
      '<div class="row"><button class="btn primary">Share lead</button></div></form></details>' +
      '<p class="scam">' + ico('shield') + '<span>Leads are shared by members, not checked by The Bench. Real employers never charge to apply. Report anything that asks for money, OTPs or bank details.</span></p>' +
      '<div id="leadlist">' + leadsHtml() + '</div>';
  }
  function leadHtml(l) {
    var id = Number(l.id), u = esc(l.username);
    var opts = [];
    if (!l.own) opts.push('<button type="button" data-act="lead-report" data-id="' + id + '">Report</button>');
    if (l.own || me.isAdmin) opts.push('<button type="button" data-act="lead-del" data-id="' + id + '">Delete' + (l.own ? '' : ' (moderator)') + '</button>');
    return '<article class="card job lead"><div class="row between job-top"><h3>' + esc(l.title) + '</h3>' +
      (opts.length ? '<details class="msg-menu"><summary aria-label="Lead options">' + ico('more') + '</summary><div class="menu">' + opts.join('') + '</div></details>' : '') + '</div>' +
      '<p class="meta"><b class="company">' + esc(l.company) + '</b>' + (l.location ? ' · ' + esc(l.location) : '') + '</p>' +
      (l.note ? '<p class="snippet">“' + esc(l.note) + '”</p>' : '') +
      '<div class="row between job-foot"><span class="muted small">Shared by <a class="plain-link" href="#/u/' + u + '"><b>' + esc(l.name) + '</b></a> · ' + ago(l.t) + '</span>' +
      '<div class="row"><button class="react' + (l.mine ? ' on' : '') + '" data-act="lead-vote" data-id="' + id + '" aria-pressed="' + !!l.mine + '" title="Mark as useful">👍 ' + (l.votes ? l.votes : 'Useful') + '</button>' +
      trackBtn('lead:' + id) +
      '<a class="btn tiny primary" href="' + esc(l.url) + '" target="_blank" rel="noopener nofollow ugc">Open job post</a></div></div></article>';
  }
  function leadsHtml() {
    if (jobs.leadsError && !jobs.leads) return '<p class="card muted">' + esc(jobs.leadsError) + '</p>';
    if (!jobs.leads) return '<p class="muted">Loading leads…</p>';
    if (!jobs.leads.length) return '<p class="card muted">No leads yet. Be the first to share an opening you found.</p>';
    return '<div class="jobs-list">' + jobs.leads.map(leadHtml).join('') + '</div><p class="muted small center-text">Leads disappear after 45 days.</p>';
  }
  function loadLeads() {
    api('GET', '/api/leads').then(function (j) {
      jobs.leads = Array.isArray(j.leads) ? j.leads : [];
      jobs.leadsError = '';
    }, function (e) {
      if (e.status === 401) return fail(e);
      jobs.leadsError = e.message;
    }).then(function () {
      var el = document.getElementById('leadlist');
      if (el && currentView() === 'jobs' && jobs.tab === 'leads') el.innerHTML = leadsHtml();
      var form = document.querySelector('details.share-lead');
      if (form && jobs.leads && !jobs.leads.length) form.open = true; // nothing to read yet, so invite a share
    });
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
    var verdict = r.score >= 85 ? 'Ready to send.' : r.score >= 60 ? 'Close. A few fixes and it is ready.' : 'Good start. Work through the list below.';
    return '<div class="row"><span class="score">' + r.score + '</span><span><b>out of 100</b><br><span class="muted small">' + verdict + '</span></span></div>' +
      '<ul class="checks">' + r.checks.map(function (c) {
        return '<li><span class="' + (c.ok ? 'ok' : 'no') + '">' + ico(c.ok ? 'check' : 'x') + '</span><span>' + esc(c.msg) + '</span></li>';
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
    'report-profile': function (d) {
      var reason = window.prompt('Report this profile to the moderators.\nWhat is wrong with it? (optional)', '');
      if (reason === null) return false;
      api('POST', '/api/profile/' + encodeURIComponent(d.u) + '/report', { reason: reason })
        .then(function () { toast('Reported. Thanks for looking out for everyone.'); }).catch(fail);
      return false;
    },
    shuffle: function () {
      var p = fun.data && fun.data.puzzle;
      if (!p) return false;
      var a = (fun.order || p.scrambled).split('');
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
      fun.order = a.join('');
      renderSection('puzzle', puzzleHtml());
      return false;
    },
    'share-puzzle': function () {
      var p = fun.data && fun.data.puzzle;
      if (!p || !p.done) return false;
      var last = p.guesses.length - 1;
      var squares = p.guesses.map(function (g, i) { return p.solved && i === last ? '🟩' : '🟥'; }).join('');
      shareToRoom('lobby', '🧩 The Bench puzzle #' + p.number + ': ' + squares + ' ' +
        (p.solved ? 'solved in ' + p.guesses.length + '/' + p.maxTries + '!' : 'not today!') + ' Play it in the Fun tab.');
      return false;
    },
    qday: function (d) {
      fun.qDay = d.d === 'yesterday' ? 'yesterday' : 'today';
      renderSection('qotd', qotdHtml());
      if (fun.qDay === 'yesterday' && !fun.yesterday) reloadQotd();
      return false;
    },
    qreact: function (d) {
      api('POST', '/api/fun/answers/' + Number(d.id) + '/react', { r: d.r }).then(reloadQotd).catch(fail);
      return false;
    },
    qdel: function (d) {
      closeMenus();
      if (!window.confirm('Delete this answer?')) return false;
      api('DELETE', '/api/chat/msg/' + Number(d.id)).then(reloadQotd).catch(fail);
      return false;
    },
    bingo: function (d) {
      var b = S.bingo, i = Number(d.i);
      if (!b || !(i >= 0 && i < 25) || i === FREE) return false;
      var at = b.ticks.indexOf(i);
      if (at > -1) b.ticks.splice(at, 1); else b.ticks.push(i);
      var fresh = fullLines(b).filter(function (n) { return b.celebrated.indexOf(n) === -1; });
      if (fresh.length) {
        b.celebrated = b.celebrated.concat(fresh);
        b.total += fresh.length;
        confetti();
        toast('Bingo! That is ' + b.total + ' all time. Laugh it off, you are doing great.');
      }
      save();
      renderSection('bingo', bingoHtml());
      return false;
    },
    'share-bingo': function () {
      var b = S.bingo, lines = b ? fullLines(b) : [];
      if (!lines.length) return false;
      var line = BINGO_LINES[lines[lines.length - 1]].filter(function (i) { return i !== FREE; });
      shareToRoom('vent', '🎯 Rejection Bingo! I got a line on The Bench:\n' +
        line.map(function (i) { return '• ' + cellText(b, i); }).join('\n'));
      return false;
    },
    'new-bingo': function () {
      if (!window.confirm('Start a new bingo card?\n\nThe ticks on this card are cleared. Your all-time bingo count stays.')) return false;
      S.bingo = newBingo(S.bingo ? S.bingo.total : 0);
      save();
      renderSection('bingo', bingoHtml());
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
        .then(function () { toast('Blocked @' + d.u + '.'); chatBlocked(d.u, true); if (currentView() === 'profile') loadProfile(); }).catch(fail);
      return false;
    },
    unblock: function (d) {
      api('DELETE', '/api/blocks/' + encodeURIComponent(d.u)).then(function () {
        toast('Unblocked @' + d.u + '.');
        chatBlocked(d.u, false);
        if (currentView() === 'account') loadBlocks();
        if (currentView() === 'profile') loadProfile();
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
      var j = d.id.indexOf('lead:') === 0
        ? (function (l) { return l && { id: d.id, title: l.title, company: l.company, url: l.url }; })(find(jobs.leads || [], Number(d.id.slice(5))))
        : find(jobs.list, d.id);
      if (!j || S.apps.some(function (a) { return a.jobId === j.id; })) return false;
      S.apps.push({ id: uid(), jobId: j.id, title: j.title, company: j.company || 'Unknown company', url: j.url, stage: 'Wishlist', t: Date.now() });
      save();
      document.querySelectorAll('[data-act="track-job"][data-id="' + j.id.replace(/"/g, '') + '"]').forEach(function (b) { b.disabled = true; b.textContent = 'Tracked'; b.classList.add('ghost'); });
      toast('Added to your tracker under Wishlist.');
      return false;
    },
    'jobs-more': function () { loadJobs(true); return false; },
    'jobs-tab': function (d) {
      jobs.tab = d.t === 'leads' ? 'leads' : 'employers';
      render();
      return false;
    },
    'lead-vote': function (d) {
      api('POST', '/api/leads/' + Number(d.id) + '/vote', {}).then(loadLeads).catch(fail);
      return false;
    },
    'lead-del': function (d) {
      closeMenus();
      if (!window.confirm('Delete this job lead?')) return false;
      api('DELETE', '/api/leads/' + Number(d.id)).then(function () { toast('Lead deleted.'); loadLeads(); }).catch(fail);
      return false;
    },
    'lead-report': function (d) {
      closeMenus();
      var reason = window.prompt('Report this job lead to the moderators.\nWhat is wrong with it? (optional)', '');
      if (reason === null) return false;
      api('POST', '/api/leads/' + Number(d.id) + '/report', { reason: reason })
        .then(function () { toast('Reported. Thanks for looking out for everyone.'); }).catch(fail);
      return false;
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
    jobsearch: function (f) {
      jobs.what = String(f.get('what') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      jobs.where = String(f.get('where') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      jobs.remote = f.get('remote') === '1';
      loadJobs(false);
      return false;
    },
    lead: function (f, form) {
      var btn = form.querySelector('button.primary');
      btn.disabled = true;
      api('POST', '/api/leads', {
        title: f.get('title'), company: f.get('company'), location: f.get('location'),
        url: String(f.get('url') || '').trim(), note: f.get('note')
      }).then(function () {
        form.reset();
        form.closest('details').open = false;
        toast('Thanks! Your lead is up.');
        loadLeads();
      }).catch(function (e) { if (e.status === 401) fail(e); else toast(e.message); })
        .then(function () { btn.disabled = false; });
      return false;
    },
    profile: function (f, form) {
      var btn = form.querySelector('button.primary');
      btn.disabled = true;
      var body = {
        name: String(f.get('name') || ''), status: f.get('status'), headline: f.get('headline'), since: f.get('since'),
        location: f.get('location'), openTo: f.getAll('openTo'), skills: String(f.get('skills') || ''),
        bio: f.get('bio'), link: String(f.get('link') || '').trim(), color: f.get('color')
      };
      api('PUT', '/api/profile', body).then(function (j) {
        me.name = j.name;
        me.profileDone = !!(j.profile.headline || j.profile.bio || j.profile.location || j.profile.skills.length || j.profile.link);
        prof.people = null;
        toast('Profile saved.');
        location.hash = '#/u/' + me.username;
      }).catch(function (e) { if (e.status === 401) fail(e); else toast(e.message); btn.disabled = false; });
      return false;
    },
    puzzle: function (f, form) {
      var guess = String(f.get('guess') || '').trim();
      if (!guess || fun.busy) return false;
      fun.busy = true;
      form.querySelector('button').disabled = true;
      api('POST', '/api/fun/puzzle', { guess: guess }).then(function (p) {
        fun.data.puzzle = p;
        var box = document.getElementById('pguess');
        if (box) box.value = '';
        renderSection('puzzle', puzzleHtml());
        if (p.solved) { confetti(); toast('Solved. Come back tomorrow for a new one.'); }
        else if (p.done) toast('Out of tries. The word was ' + p.answer + '.');
        else { toast('Not quite. One more letter revealed.'); var nb = document.getElementById('pguess'); if (nb) nb.focus(); }
      }).catch(function (e) {
        if (e.status === 400) toast(e.message); else fail(e);
        var b = document.querySelector('form[data-form="puzzle"] button');
        if (b) b.disabled = false;
      }).then(function () { fun.busy = false; });
      return false;
    },
    qotd: function (f, form) {
      var body = String(f.get('text') || '').trim();
      if (!body) return false;
      form.querySelector('button').disabled = true;
      api('POST', '/api/fun/qotd', { text: body }).then(function (j) {
        if (fun.data) fun.data.qotd = j;
        fun.qDay = 'today';
        var box = document.getElementById('qanswer');
        if (box) box.value = '';
        renderSection('qotd', qotdHtml());
      }).catch(function (e) {
        toast(e.message);
        var b = document.querySelector('form[data-form="qotd"] button');
        if (b) b.disabled = false;
      });
      return false;
    },
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
        '<span class="ch-icon" aria-hidden="true">#</span><span class="ch-text"><b>' + esc(r.slug) + '</b></span>' +
        (un ? '<i class="dot" aria-label="new messages"></i>' : '') + '</a>';
    }).join('');
    var dms = s.dms.map(function (d) {
      var ch = 'dm:' + d.username, un = ch !== active && isUnread(ch);
      return '<a class="ch' + (ch === active ? ' on' : '') + (un ? ' unread' : '') + '" href="#/dm/' + esc(d.username) + '"' + (ch === active ? ' aria-current="page"' : '') + '>' +
        '<span class="avatar" aria-hidden="true">' + esc(initial(d.name)) + '</span>' +
        '<span class="ch-text"><b>' + esc(d.name) + '</b><small>' + esc((d.lastFromMe ? 'You: ' : '') + (d.lastText || '')) + '</small></span>' +
        (un ? '<i class="dot" aria-label="unread"></i>' : '') + '</a>';
    }).join('') || '<p class="muted small pad">No private chats yet. Tap someone\'s name in a room or on the feed to message them.</p>';
    return '<h3>Rooms</h3><nav class="chs" aria-label="Rooms">' + rooms + '</nav><h3 class="between">Direct messages <a class="h3-link" href="#/people">Find people</a></h3><nav class="chs" aria-label="Direct messages">' + dms + '</nav>';
  }

  function composerHtml(label) {
    return '<form class="composer" data-form="chat"><textarea id="chatbox" name="text" rows="1" maxlength="1000" placeholder="' + esc(label) + '" aria-label="' + esc(label) + '" required></textarea>' +
      '<button class="btn primary">Send</button></form>';
  }

  function paneHtml(ch) {
    var back = '<a class="back" href="#/chat" aria-label="All chats">' + ico('arrow-left') + '</a>';
    if (chat.errors[ch]) {
      return '<header class="pane-head">' + back + '<div><h2>Hmm</h2></div></header><div class="pane-empty"><p>' + esc(chat.errors[ch]) + '</p><a href="#/chat/lobby">Go to #lobby</a></div>';
    }
    var head, notice = '', composer;
    if (isDm(ch)) {
      var u = ch.slice(3), peer = chat.peers[ch];
      var name = peer ? peer.name : (dmByUser(u) || {}).name || '@' + u;
      head = '<div class="grow"><h2><a class="plain-link" href="#/u/' + esc(u) + '">' + esc(name) + '</a></h2><p class="muted small">@' + esc(u) + ' · private chat</p></div>' +
        (peer ? '<button class="btn tiny ghost" data-act="' + (peer.blockedByMe ? 'unblock' : 'block') + '" data-u="' + esc(u) + '">' + (peer.blockedByMe ? 'Unblock' : 'Block') + '</button>' : '');
      notice = '<p class="scam">' + ico('shield') + '<span>Real employers never ask you to pay for a job, training or "registration". Never share OTPs, bank details or ID documents in chat. Report anyone who asks.</span></p>';
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
    if (!list.length) return older + '<p class="muted pad empty">' + (isDm(ch) ? 'Say hello to start the conversation.' : 'No messages yet. Start the conversation.') + '</p>';
    return older + list.map(function (m) { return msgHtml(m, ch); }).join('');
  }

  function msgHtml(m, ch) {
    var own = m.username === me.username, room = !isDm(ch), u = esc(m.username), id = Number(m.id);
    var opts = [];
    if (!own) opts.push('<a href="#/u/' + u + '">View profile</a>');
    if (!own && room) opts.push('<a href="#/dm/' + u + '">Message privately</a>');
    if (!own) opts.push('<button type="button" data-act="report" data-id="' + id + '">Report</button>');
    if (!own && room) opts.push('<button type="button" data-act="block" data-u="' + u + '">Block @' + u + '</button>');
    if (own || me.isAdmin) opts.push('<button type="button" data-act="del-msg" data-id="' + id + '">Delete' + (own ? '' : ' (moderator)') + '</button>');
    var who = own ? '<b class="who">' + esc(m.name) + '</b>' : '<a class="who" href="#/u/' + u + '">' + esc(m.name) + '</a>';
    return '<div class="msg' + (own ? ' own' : '') + '" data-id="' + id + '"><div class="msg-head">' + who +
      '<time class="muted small">' + clock(m.t) + '</time>' +
      (opts.length ? '<details class="msg-menu"><summary aria-label="Message options">' + ico('more') + '</summary><div class="menu">' + opts.join('') + '</div></details>' : '') +
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
        '<button class="btn tiny" data-act="mod" data-id="' + id + '" data-a="delete">' + (r.where === 'a profile' ? 'Clear profile' : r.where === 'a job lead' ? 'Delete lead' : 'Delete message') + '</button>' +
        (r.authorBanned ? '' : '<button class="btn tiny primary" data-act="mod" data-id="' + id + '" data-a="ban" data-u="' + a + '">Delete and ban @' + a + '</button>') +
        '</div></article>';
    }).join('') || '<p class="card muted">No open reports. All quiet.</p>';
    var banned = (j.banned || []).map(function (u) {
      return '<li class="row between"><span>' + esc(u.name) + ' <span class="muted small">@' + esc(u.username) + '</span></span>' +
        '<button class="btn tiny ghost" data-act="unban" data-u="' + esc(u.username) + '">Unban</button></li>';
    }).join('') || '<li class="muted small">Nobody is banned.</li>';
    return '<div class="stack"><h2>Open reports (' + (j.reports || []).length + ')</h2>' + reports +
      '<section class="card"><h2>Banned accounts</h2><ul class="plain">' + banned + '</ul></section></div>';
  }

  // ---------- fun tab ----------
  // Puzzle and question come from the server (same for everyone each day). Bingo is personal and saved in S.
  var BINGO = [
    'Ghosted after the final round',
    '"We went with someone more senior"',
    'Entry-level job wants 5 years of experience',
    'Auto-rejection email at 2am',
    '"We\'ll keep your resume on file"',
    'Interview rescheduled three times',
    'Asked my salary expectation in the first minute',
    'Take-home task longer than a weekend',
    '"So, tell me about yourself" (again)',
    'Job post closed the day I applied',
    'Recruiter called me by the wrong name',
    '"You\'re overqualified"',
    'Offered an unpaid "trial day"',
    'Interviewer forgot to unmute',
    'Five interview rounds for one job',
    'Rejected for a job I never applied to',
    '"What is your biggest weakness?"',
    'Had to retype my whole resume into a form',
    '"Competitive salary" (no number given)',
    'Interviewer was 20 minutes late',
    'Rejection email with someone else\'s name',
    'Job changed halfway through the interview',
    '"We\'re like a family here"',
    'Asked to do a free sample project',
    'Offer taken back',
    'Heard back three months later',
    '"I\'ll call you tomorrow" (they did not)',
    '"Where do you see yourself in 5 years?"',
    'Made an account just to apply',
    'Same job reposted a week after I applied',
    'Asked about the gap in my resume',
    '"Fast-paced environment" in the job post',
    'Interview in a cafe with loud music',
    'Asked for references before the first interview',
    'Someone viewed my profile, then silence',
    'Rejected in under an hour',
    'Group interview with ten other people',
    '"Rockstar" or "ninja" in the job title',
    'Internet died during the online interview',
    'Asked "Why should we hire you?" with a straight face'
  ];
  var BINGO_LINES = (function () {
    var lines = [], i, k;
    for (i = 0; i < 5; i++) {
      var row = [], col = [];
      for (k = 0; k < 5; k++) { row.push(i * 5 + k); col.push(k * 5 + i); }
      lines.push(row, col);
    }
    lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
    return lines;
  })();
  var FREE = 12;
  var fun = { data: null, qDay: 'today', yesterday: null, order: null, busy: false };

  function cleanBingo(raw) {
    if (!isObj(raw) || !Array.isArray(raw.card) || raw.card.length !== 24) return null;
    var seen = {}, ok = raw.card.every(function (n) {
      var good = Number.isInteger(n) && n >= 0 && n < BINGO.length && !seen[n];
      seen[n] = true;
      return good;
    });
    if (!ok) return null;
    var cells = function (list, max) {
      return (Array.isArray(list) ? list : []).filter(function (i, at, all) {
        return Number.isInteger(i) && i >= 0 && i < max && all.indexOf(i) === at;
      });
    };
    return {
      card: raw.card.slice(),
      ticks: cells(raw.ticks, 25).filter(function (i) { return i !== FREE; }),
      celebrated: cells(raw.celebrated, BINGO_LINES.length),
      total: Number.isInteger(raw.total) && raw.total >= 0 ? raw.total : 0
    };
  }
  function newBingo(total) {
    var ids = BINGO.map(function (_, i) { return i; });
    for (var i = ids.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = ids[i]; ids[i] = ids[j]; ids[j] = t;
    }
    return { card: ids.slice(0, 24), ticks: [], celebrated: [], total: total || 0 };
  }
  function cellText(b, i) { return i === FREE ? 'FREE: you showed up!' : BINGO[b.card[i < FREE ? i : i - 1]]; }
  function ticked(b, i) { return i === FREE || b.ticks.indexOf(i) > -1; }
  function fullLines(b) {
    return BINGO_LINES.map(function (line, n) { return line.every(function (i) { return ticked(b, i); }) ? n : -1; })
      .filter(function (n) { return n > -1; });
  }

  function confetti() {
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) { /* old browser */ }
    var box = document.createElement('div'), colors = ['#c4432b', '#1d1a16', '#b0832a', '#2e6b4b', '#e9b49f', '#f0e1c4'];
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 90; i++) {
      var s = document.createElement('i');
      s.style.left = (Math.random() * 100) + 'vw';
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = (Math.random() * 0.6) + 's';
      s.style.animationDuration = (1.8 + Math.random() * 1.4) + 's';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 4000);
  }

  // Re-draw one section without losing what the person was typing in it.
  function renderSection(id, html) {
    var el = document.getElementById(id);
    if (!el) return;
    var kept = {}, focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : '';
    el.querySelectorAll('input[id], textarea[id]').forEach(function (f) { kept[f.id] = f.value; });
    el.innerHTML = html;
    Object.keys(kept).forEach(function (k) { var f = document.getElementById(k); if (f) f.value = kept[k]; });
    if (focus) { var f = document.getElementById(focus); if (f) f.focus(); }
  }

  // ----- puzzle -----
  function puzzleHtml() {
    var p = fun.data && fun.data.puzzle;
    if (!p) return '<h2>Daily puzzle</h2><p class="muted">Loading today\'s puzzle…</p>';
    var last = p.guesses.length - 1;
    var tiles = (fun.order || p.scrambled).split('').map(function (c) { return '<span class="tile">' + esc(c) + '</span>'; }).join('');
    var slots = p.reveal.split('').map(function (c) {
      return '<span class="slot' + (c === '_' ? '' : ' on') + '">' + (c === '_' ? '' : esc(c)) + '</span>';
    }).join('');
    var tries = p.guesses.map(function (g, i) {
      var right = p.solved && i === last;
      return '<li class="' + (right ? 'ok' : 'no') + '">' + ico(right ? 'check' : 'x') + '<span>' + esc(g) + '</span></li>';
    }).join('');
    var board = p.leaderboard.length
      ? '<ol class="board-list">' + p.leaderboard.map(function (r) {
          return '<li class="' + (r.me ? 'me' : '') + '"><a class="plain-link" href="#/u/' + esc(r.username) + '">' + esc(r.name) + (r.me ? ' (you)' : '') + '</a><b>' + Number(r.points) + ' pts</b></li>';
        }).join('') + '</ol>'
      : '<p class="muted small">Nobody has solved one this week yet. Be the first!</p>';

    var play = p.done ? '' :
      '<p class="small">Unscramble the word. Each wrong guess reveals one more letter. <b>' + p.triesLeft + ' of ' + p.maxTries + ' tries left.</b></p>' +
      '<form class="row" data-form="puzzle"><input id="pguess" class="grow" type="text" name="guess" maxlength="' + p.length + '" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Your guess (' + p.length + ' letters)" aria-label="Your guess" required>' +
      '<button class="btn primary">Guess</button><button type="button" class="btn ghost" data-act="shuffle" aria-label="Shuffle the letters">' + ico('shuffle') + '</button></form>';
    var result = !p.done ? '' : p.solved
      ? '<p class="win">Solved in ' + p.guesses.length + '/' + p.maxTries + '! The word was <b>' + esc(p.answer) + '</b>.</p>'
      : '<p class="lose">The word was <b>' + esc(p.answer) + '</b>. So close. A new puzzle arrives at midnight.</p>';
    var share = p.done ? '<button class="btn ghost tiny" data-act="share-puzzle">Share my result in #lobby</button>' : '';

    return '<div class="row between"><h2>Puzzle <span class="muted">No. ' + Number(p.number) + '</span></h2><span class="pill">' + ico('flame') + Number(p.streak) + ' day streak</span></div>' +
      '<p class="small"><b>Hint:</b> ' + esc(p.hint) + '</p>' +
      '<div class="tiles" aria-label="Scrambled letters: ' + esc((fun.order || p.scrambled).split('').join(' ')) + '">' + tiles + '</div>' +
      '<div class="slots" aria-label="' + (p.done ? 'Answer' : 'Letters revealed so far') + '">' + slots + '</div>' +
      play + (tries ? '<ul class="guesses">' + tries + '</ul>' : '') + result + share +
      '<div class="lboard"><h3>' + ico('trophy') + 'This week</h3>' + board + '<p class="muted small">5 points for a first-try solve, down to 1 for the fifth. Resets every Monday.</p></div>';
  }

  // ----- question of the day -----
  function qotdHtml() {
    var today = fun.qDay === 'today', d = today ? fun.data && fun.data.qotd : fun.yesterday;
    var tabs = '<div class="seg" role="group" aria-label="Which day">' +
      '<button type="button" data-act="qday" data-d="today" aria-pressed="' + today + '"' + (today ? ' class="on"' : '') + '>Today</button>' +
      '<button type="button" data-act="qday" data-d="yesterday" aria-pressed="' + !today + '"' + (!today ? ' class="on"' : '') + '>Yesterday</button></div>';
    var top = '<div class="row between"><h2>Question of the day</h2>' + tabs + '</div>';
    if (!d) return top + '<p class="muted">Loading…</p>';
    var form = !today ? '' : d.answered
      ? '<p class="muted small">You answered today. Come back tomorrow for a new question.</p>'
      : '<form class="stack" data-form="qotd"><textarea id="qanswer" name="text" maxlength="300" placeholder="Your answer…" aria-label="Your answer" required></textarea>' +
        '<div class="row between"><span class="muted small">Everyone on The Bench can see answers.</span><button class="btn primary">Answer</button></div></form>';
    var list = d.answers.slice().reverse().map(answerHtml).join('') ||
      '<p class="muted small">' + (today ? 'No answers yet. Be the first!' : 'Nobody answered yesterday.') + '</p>';
    return top + '<p class="question">' + esc(d.question) + '</p>' + form +
      '<p class="small muted">' + d.answers.length + ' answer' + (d.answers.length === 1 ? '' : 's') + '</p><div class="answers">' + list + '</div>';
  }
  function answerHtml(a) {
    var id = Number(a.id), u = esc(a.username);
    var who = a.own ? '<b class="who">' + esc(a.name) + '</b>' : '<a class="who" href="#/u/' + u + '">' + esc(a.name) + '</a>';
    var reacts = REACTS.map(function (r) {
      var n = Number(a.reacts[r]) || 0;
      return '<button class="react' + (a.mine[r] ? ' on' : '') + '" data-act="qreact" data-id="' + id + '" data-r="' + r + '">' + r + (n ? ' ' + n : '') + '</button>';
    }).join('');
    var opts = [];
    if (!a.own) opts.push('<button type="button" data-act="report" data-id="' + id + '">Report</button>');
    if (a.own || me.isAdmin) opts.push('<button type="button" data-act="qdel" data-id="' + id + '">Delete' + (a.own ? '' : ' (moderator)') + '</button>');
    return '<div class="answer"><div class="msg-head">' + who + '<span class="muted small">' + ago(a.t) + '</span>' +
      (opts.length ? '<details class="msg-menu"><summary aria-label="Answer options">' + ico('more') + '</summary><div class="menu">' + opts.join('') + '</div></details>' : '') +
      '</div><p class="msg-text">' + esc(a.text) + '</p><div class="row">' + reacts + '</div></div>';
  }

  // ----- rejection bingo -----
  function bingoHtml() {
    var b = S.bingo;
    if (!b) return '<h2>Rejection Bingo</h2><p class="muted">Shuffling your card…</p>';
    var lines = fullLines(b), inLine = {};
    lines.forEach(function (n) { BINGO_LINES[n].forEach(function (i) { inLine[i] = true; }); });
    var cells = '';
    for (var i = 0; i < 25; i++) {
      var on = ticked(b, i);
      cells += i === FREE
        ? '<div class="cell on free' + (inLine[i] ? ' line' : '') + '">' + esc(cellText(b, i)) + '</div>'
        : '<button type="button" class="cell' + (on ? ' on' : '') + (inLine[i] ? ' line' : '') + '" data-act="bingo" data-i="' + i + '" aria-pressed="' + on + '">' + esc(cellText(b, i)) + '</button>';
    }
    return '<div class="row between"><h2>Rejection Bingo</h2><span class="pill">' + ico('trophy') + b.total + ' bingo' + (b.total === 1 ? '' : 's') + ' all time</span></div>' +
      '<p class="small muted">Tick a square when it happens to you. Five in a row (across, down or corner to corner) is a bingo. Your card is private.</p>' +
      '<div class="bingo">' + cells + '</div>' +
      '<div class="row between"><span class="small">' + (lines.length ? '<b>' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + ' on this card!</b>' : b.ticks.length + ' squares ticked') + '</span>' +
      '<span class="row">' + (lines.length ? '<button class="btn tiny ghost" data-act="share-bingo">Share in #vent</button>' : '') +
      '<button class="btn tiny ghost" data-act="new-bingo">New card</button></span></div>';
  }

  // ----- loading -----
  function loadFun() {
    return api('GET', '/api/fun/today').then(function (j) {
      if (fun.data && fun.data.day !== j.day) fun.yesterday = null; // the day rolled over
      fun.data = j; fun.order = null;
      renderSection('puzzle', puzzleHtml());
      renderSection('qotd', qotdHtml());
    }).catch(fail);
  }
  function reloadQotd() {
    return api('GET', '/api/fun/qotd' + (fun.qDay === 'yesterday' ? '?day=yesterday' : '')).then(function (j) {
      if (fun.qDay === 'yesterday') fun.yesterday = j; else if (fun.data) fun.data.qotd = j;
      renderSection('qotd', qotdHtml());
    }).catch(fail);
  }
  function shareToRoom(room, text) {
    return api('POST', '/api/chat/room/' + room, { text: text })
      .then(function () { toast('Shared in #' + room + '.'); }).catch(fail);
  }

  // ---------- profiles + people ----------
  var STATUS_LABEL = { looking: 'Looking for work', interviewing: 'Interviewing', hired: 'Got a job!', break: 'Taking a break' };
  var OPEN_TO = ['Remote', 'Hybrid', 'On-site'];
  var COLORS = ['tomato', 'ink', 'gold', 'sage', 'blue', 'plum'];
  var prof = { people: null, query: '' };

  function profileRoute() {
    var p = location.hash.replace(/^#\/?/, '').split('/');
    return p[0] === 'u' && /^[a-z0-9_]{3,20}$/i.test(p[1] || '') ? p[1].toLowerCase() : '';
  }
  function avatarHtml(name, color, size) {
    return '<span class="avatar' + (size ? ' ' + size : '') + ' c-' + (COLORS.indexOf(color) > -1 ? color : 'tomato') + '" aria-hidden="true">' + esc(initial(name)) + '</span>';
  }
  function monthsSince(ym) {
    var p = ym.split('-'), now = new Date();
    return (now.getFullYear() - Number(p[0])) * 12 + (now.getMonth() + 1 - Number(p[1]));
  }
  function monthName(ym) {
    var p = ym.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  }
  function howLong(ym) {
    var n = monthsSince(ym);
    return n <= 0 ? 'started this month' : n === 1 ? '1 month' : n < 24 ? n + ' months' : Math.floor(n / 12) + ' years';
  }
  function statusLabel(s) { return '<span class="status s-' + (STATUS_LABEL[s] ? s : 'looking') + '">' + esc(STATUS_LABEL[s] || STATUS_LABEL.looking) + '</span>'; }
  function linkLabel(href) {
    try { var u = new URL(href); return (u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : '')).slice(0, 44); }
    catch (e) { return 'Link'; }
  }
  function thisMonth() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  // ----- one profile -----
  function loadProfile() {
    var u = profileRoute();
    if (!u) return;
    api('GET', '/api/profile/' + encodeURIComponent(u)).then(function (j) {
      var el = document.getElementById('profilebody');
      if (el && profileRoute() === u) el.innerHTML = profileHtml(j);
    }, function (e) {
      var el = document.getElementById('profilebody');
      if (e.status === 404 && el) el.innerHTML = head('Not here', esc(e.message)) + '<a class="btn" href="#/people">See everyone</a>';
      else fail(e);
    });
  }

  function profileHtml(j) {
    var p = j.profile, u = esc(j.username);
    var meta = [statusLabel(p.status)];
    if (p.location) meta.push('<span class="meta-item">' + ico('pin') + esc(p.location) + '</span>');
    if (p.openTo.length) meta.push('<span class="meta-item">' + ico('jobs') + esc(p.openTo.join(' · ')) + '</span>');
    var role = p.headline
      ? '<p class="headline">' + (p.status === 'hired' ? 'Now working as ' : 'Looking for ') + '<b>' + esc(p.headline) + '</b></p>'
      : j.me ? '<p class="headline muted"><a href="#/edit-profile">Add the role you are looking for</a></p>' : '';
    var actions = j.me
      ? '<a class="btn primary" href="#/edit-profile">Edit profile</a>'
      : '<a class="btn primary" href="#/dm/' + u + '">' + ico('chat') + 'Message</a>' +
        '<button class="btn ghost" data-act="' + (j.blockedByMe ? 'unblock' : 'block') + '" data-u="' + u + '">' + (j.blockedByMe ? 'Unblock' : 'Block') + '</button>';
    var about = p.bio
      ? '<p class="bio">' + esc(p.bio) + '</p>'
      : '<p class="muted">' + (j.me ? 'Nothing here yet. <a href="#/edit-profile">Write a line or two about yourself.</a>' : 'Nothing here yet.') + '</p>';
    var skills = p.skills.length ? '<div class="row skills">' + p.skills.map(function (s) { return '<span class="pill">' + esc(s) + '</span>'; }).join('') + '</div>' : '';
    var link = p.link ? '<p><a class="ext" href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer nofollow ugc">' + ico('link') + '<span>' + esc(linkLabel(p.link)) + '</span></a></p>' : '';
    var fact = function (label, value) { return '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>'; };
    var facts = '<dl class="facts">' +
      (p.since ? fact('Looking since', esc(monthName(p.since)) + ' <span class="muted">· ' + esc(howLong(p.since)) + '</span>') : '') +
      fact('Member since', esc(new Date(j.joined).toLocaleDateString([], { month: 'long', year: 'numeric' }))) +
      fact('Feed posts', Number(j.stats.posts)) +
      fact('Daily answers', Number(j.stats.answers)) +
      fact('Puzzles solved', Number(j.stats.solved)) + '</dl>';
    return '<header class="profile-head">' + avatarHtml(j.name, p.color, 'xl') +
      '<div class="grow"><h1>' + esc(j.name) + '</h1><p class="muted handle">@' + u + '</p>' + role +
      '<div class="row meta">' + meta.join('') + '</div></div>' +
      '<div class="row actions">' + actions + '</div></header>' +
      '<div class="grid2"><section class="card stack"><h3>About</h3>' + about + skills + link + '</section>' +
      '<section class="card stack"><h3>On The Bench</h3>' + facts + '</section></div>' +
      (j.me ? '' : '<p class="small muted profile-foot"><button class="link" data-act="report-profile" data-u="' + u + '">Report this profile</button></p>');
  }

  // ----- edit -----
  function loadEditor() {
    api('GET', '/api/profile/' + encodeURIComponent(me.username)).then(function (j) {
      var el = document.getElementById('editbody');
      if (el) el.innerHTML = editorHtml(j);
    }).catch(fail);
  }
  function editorHtml(j) {
    var p = j.profile;
    var swatches = COLORS.map(function (c) {
      return '<label class="swatch c-' + c + '"><input type="radio" name="color" value="' + c + '"' + (p.color === c ? ' checked' : '') + '><span class="sr">' + c + '</span></label>';
    }).join('');
    var statuses = Object.keys(STATUS_LABEL).map(function (s) {
      return '<option value="' + s + '"' + (p.status === s ? ' selected' : '') + '>' + STATUS_LABEL[s] + '</option>';
    }).join('');
    var open = OPEN_TO.map(function (o) {
      return '<label class="check"><input type="checkbox" name="openTo" value="' + o + '"' + (p.openTo.indexOf(o) > -1 ? ' checked' : '') + '> ' + o + '</label>';
    }).join('');
    return '<form class="card stack narrow editor" data-form="profile">' +
      '<div class="row avatar-row"><span id="avprev">' + avatarHtml(j.name, p.color, 'lg') + '</span>' +
      '<fieldset class="swatches"><legend>Avatar colour</legend>' + swatches + '</fieldset></div>' +
      '<label>Display name<input id="pf-name" type="text" name="name" maxlength="24" value="' + esc(j.name) + '" required></label>' +
      '<div class="grid2 tight"><label>Status<select name="status">' + statuses + '</select></label>' +
      '<label>Looking since <span class="muted">(optional)</span><input type="month" name="since" min="1990-01" max="' + thisMonth() + '" value="' + esc(p.since) + '"></label></div>' +
      '<label>The role you want<input type="text" name="headline" maxlength="60" placeholder="e.g. Junior frontend developer" value="' + esc(p.headline) + '"></label>' +
      '<div class="grid2 tight"><label>City or area<input type="text" name="location" maxlength="40" placeholder="e.g. Chennai" value="' + esc(p.location) + '"></label>' +
      '<fieldset><legend>Open to</legend><div class="row">' + open + '</div></fieldset></div>' +
      '<label>Skills <span class="muted">(separate with commas, up to 8)</span><input type="text" name="skills" maxlength="230" placeholder="e.g. Excel, Customer support, React" value="' + esc(p.skills.join(', ')) + '"></label>' +
      '<label>About you <span class="muted" id="biocount">' + p.bio.length + '/280</span><textarea id="pf-bio" name="bio" maxlength="280" placeholder="A line or two: what you did before, what you are learning, what you are hoping for.">' + esc(p.bio) + '</textarea></label>' +
      '<label>One link <span class="muted">(LinkedIn, portfolio, GitHub…)</span><input type="url" name="link" maxlength="200" placeholder="https://" value="' + esc(p.link) + '"></label>' +
      '<p class="muted small">Every member can see your profile. Keep your phone number, email and address out of it. Share those privately, and only with people you trust.</p>' +
      '<div class="row"><button class="btn primary">Save profile</button><a class="btn ghost" href="#/u/' + esc(me.username) + '">Cancel</a></div></form>';
  }

  // ----- people -----
  function loadPeople() {
    api('GET', '/api/people').then(function (j) {
      prof.people = Array.isArray(j.people) ? j.people : [];
      var el = document.getElementById('peoplelist');
      if (el) el.innerHTML = peopleHtml();
    }).catch(fail);
  }
  function peopleHtml() {
    if (!prof.people) return '<p class="muted">Loading…</p>';
    var q = prof.query.trim().toLowerCase();
    var list = prof.people.filter(function (p) {
      return !q || [p.name, p.username, p.headline, p.location, p.skills.join(' ')].join(' ').toLowerCase().indexOf(q) > -1;
    });
    if (!list.length) return '<p class="muted">Nobody matches that yet.</p>';
    return list.map(function (p) {
      return '<a class="person card" href="#/u/' + esc(p.username) + '">' + avatarHtml(p.name, p.color, 'lg') +
        '<span class="person-text"><b>' + esc(p.name) + (p.me ? ' <span class="muted">(you)</span>' : '') + '</b>' +
        '<span class="muted small">@' + esc(p.username) + (p.location ? ' · ' + esc(p.location) : '') + '</span>' +
        (p.headline ? '<span class="person-role">' + esc(p.headline) + '</span>' : '') +
        statusLabel(p.status) + '</span></a>';
    }).join('');
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
    admin: function () { if (me.isAdmin) loadAdmin(); },
    fun: function () {
      if (!S.bingo) { S.bingo = newBingo(0); save(); renderSection('bingo', bingoHtml()); }
      loadFun();
    },
    profile: loadProfile,
    jobs: function () {
      if (jobs.tab === 'leads') loadLeads();
      else if (!jobs.loaded && !jobs.loading) loadJobs(false);
    },
    'edit-profile': loadEditor,
    people: loadPeople
  };

  // ---------- wiring ----------
  var main = document.getElementById('main');

  function currentView() {
    var v = location.hash.replace(/^#\/?/, '').split('/')[0];
    if (v === 'dm') return 'chat';
    if (v === 'u') return 'profile';
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
    if (e.target.name === 'color' && document.getElementById('avprev')) {
      var nm = document.getElementById('pf-name');
      document.getElementById('avprev').innerHTML = avatarHtml(nm ? nm.value : me.name, e.target.value, 'lg');
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'resume') {
      S.resume = e.target.value; save();
    } else if (e.target.id === 'peopleq') {
      prof.query = e.target.value;
      document.getElementById('peoplelist').innerHTML = peopleHtml();
    } else if (e.target.id === 'pf-bio') {
      document.getElementById('biocount').textContent = e.target.value.length + '/280';
    } else if (e.target.id === 'pf-name') {
      var c = document.querySelector('input[name="color"]:checked');
      document.getElementById('avprev').innerHTML = avatarHtml(e.target.value || '?', c ? c.value : 'tomato', 'lg');
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

  document.querySelectorAll('[data-icon]').forEach(function (el) { el.innerHTML = ico(el.getAttribute('data-icon')); });
  render();
  api('GET', '/api/me')
    .then(function (j) { return enter(j, false); })
    .catch(function (e) { if (e.status !== 401) ui.authError = e.message; })
    .then(function () { ui.booting = false; render(); });
})();
