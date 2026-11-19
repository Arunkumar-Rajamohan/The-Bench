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
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    buddy: '<circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="8" r="3"/><path d="M2.5 19.5c0-3.1 2.4-5.5 5.5-5.5s5.5 2.4 5.5 5.5"/><path d="M13.6 14.6a5.5 5.5 0 0 1 8.4 4.9"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    download: '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 7.5h7"/>',
    logout: '<path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5"/><path d="M10 16.5 5.5 12 10 7.5"/><path d="M5.5 12H16"/>',
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
  var jobs = { tab: 'employers', list: [], total: 0, page: 1, what: '', where: '', remote: false, field: '', fields: [], nontech: 0, all: 0, partial: false, retry: null,
    companies: 0, loaded: false, loading: false, error: '',
    leads: null, leadsError: '' };

  var STAGES = ['Wishlist', 'Applied', 'Interview', 'Offer', 'Rejected'];
  var TAGS = ['Win', 'Rant', 'Question', 'Tip'];
  var REACTS = ['🙌', '💪', '😂'];
  var MOODS = ['😞', '😕', '😐', '🙂', '🤩'];

  // ---------- interview practice: question packs ----------
  // Each question: q = the question, tip = what a good answer does, star = a "tell me about a time" question (use STAR).
  // Ids are pack + position, so add new questions at the END of a pack to keep saved notes attached to the right question.
  var PACKS = [
    { id: 'general', name: 'Everyone', qs: [
      { q: 'Tell me about yourself.', tip: 'Two minutes, three parts: who you are now, one or two things you have done that fit this job, and why you want this role. Not your life story.' },
      { q: 'What are you looking for in your next role?', tip: 'Describe what this job actually offers. Talk about the work and the learning, not only salary or location.' },
      { q: 'What is your biggest strength, and where has it shown up?', tip: 'Pick one strength that matters for this job and prove it with a short, real example and a result.' },
      { q: 'What is something you are working on getting better at?', tip: 'A real but not job-breaking weakness, plus what you are doing about it right now.' },
      { q: 'Why did you leave your last job?', tip: 'Short, honest and calm. Never criticise your old employer. Turn quickly to what you want next.' },
      { q: 'What have you been doing since your last role?', tip: 'Show you kept moving: courses, projects, freelance work, family duties handled well. Gaps are normal; drifting is what worries them.' },
      { q: 'I see a gap on your resume. Can you walk me through it?', tip: 'One or two sentences of reason, one sentence on what you did or learned, then say you are ready and why this role fits.' },
      { q: 'Tell me about a time you disagreed with a teammate.', tip: 'Show you listened, used facts, and kept the relationship. End with the outcome and what you learned.', star: true },
      { q: 'Describe a project you are proud of. What was your part?', tip: 'Be clear about what YOU did, not the team. Give a number for the result if you can.', star: true },
      { q: 'Tell me about a time you failed. What did you change after?', tip: 'Pick a real, small-to-medium failure. Spend most of the answer on what you changed afterwards.', star: true },
      { q: 'Describe a time you had to learn something fast.', tip: 'Show your method: where you learned from, how you practised, and how quickly you were useful.', star: true },
      { q: 'Tell me about a time you handled a difficult customer or stakeholder.', tip: 'Stay calm in the story. Show empathy first, then the fix, then the result.', star: true },
      { q: 'Why do you want to work here?', tip: 'Mention something specific about the company (product, customers, values), then connect it to your skills.' },
      { q: 'What do you know about what we do?', tip: 'Spend 15 minutes on their website and recent news. Mention what they sell, who to, and one recent update.' },
      { q: 'If you joined tomorrow, what would you do in your first 30 days?', tip: 'Learn first: meet the team, understand the tools and customers, then pick one early win.' },
      { q: 'Teach me something in two minutes.', tip: 'Choose something simple you know well. Structure it: what it is, why it matters, one example.' },
      { q: 'Do you have any questions for us?', tip: 'Always ask one or two: what success looks like in 90 days, the team, or the biggest challenge in the role.' }
    ] },
    { id: 'freshers', name: 'Freshers', qs: [
      { q: 'You have no work experience. Why should we hire you?', tip: 'Point to proof: projects, internships, college roles, part-time work. Show you learn fast and want this specific job.' },
      { q: 'Tell me about your final-year project.', tip: 'Problem, your part, tools used, result. Be ready for follow-up questions on anything you mention.', star: true },
      { q: 'Why did you choose your degree, and why this field now?', tip: 'Honest is fine, even if the degree is different. Show a clear reason you are choosing this field now.' },
      { q: 'Tell me about a time you worked in a team at college.', tip: 'Fests, group projects, sports, clubs all count. Show what you did and how the team did better.', star: true },
      { q: 'Where do you see yourself in three years?', tip: 'Growing in this field and this company: more skills, more responsibility. Avoid "doing an MBA abroad".' },
      { q: 'Are you open to relocation, shifts or a bond period?', tip: 'Know your real answer before the interview. If yes, say it clearly. If not, explain briefly and politely.' },
      { q: 'What did you learn outside your syllabus?', tip: 'Online courses, certificates, YouTube learning, side projects. Show curiosity and self-learning.' },
      { q: 'How do you handle pressure, like exams or deadlines?', tip: 'Give a real example and your method: plan, break it down, ask for help early.', star: true }
    ] },
    { id: 'hr', name: 'HR round', qs: [
      { q: 'What is your current CTC, and what are you expecting?', tip: 'Know your numbers: fixed and variable pay. Give a researched range, and say you are flexible for the right role.' },
      { q: 'What is your notice period? Can you join early?', tip: 'Be exact. If you are available now, say so; that is a plus. Do not promise what your current employer will not allow.' },
      { q: 'Why are you looking for a change?', tip: 'Growth, learning, a better fit for your skills. Keep it positive and future-focused.' },
      { q: 'Are you comfortable with night shifts or working weekends?', tip: 'Answer honestly. If yes, say so clearly. If not, give your availability without apologising.' },
      { q: 'Do you have any other offers?', tip: 'Be truthful. If you have one, mention it briefly without bluffing. It can help, but never invent one.' },
      { q: 'Why have you changed jobs so often?', tip: 'Give a clear reason for each move (contract ended, company closed, growth) and show you want to stay longer now.' },
      { q: 'How do you handle criticism from a manager?', tip: 'Show you listen, ask questions, and act on it. A short real example helps.', star: true },
      { q: 'Is there anything that would stop you from joining if we made an offer?', tip: 'Raise real concerns now (location, shift, joining date) rather than after the offer.' }
    ] },
    { id: 'support', name: 'Customer support', qs: [
      { q: 'How would you calm down an angry customer?', tip: 'Listen fully, apologise for the experience, restate the problem, give a clear next step and a time. Then follow up.' },
      { q: 'Tell me about a time you turned an unhappy customer into a happy one.', tip: 'Show empathy, ownership and a fix. End with how the customer responded or a CSAT score.', star: true },
      { q: 'A customer asks for something against company policy. What do you do?', tip: 'Explain the policy kindly, offer the closest alternative, and escalate if there is a real case for an exception.' },
      { q: 'How do you handle many chats or calls at the same time?', tip: 'Talk about prioritising urgent issues, using saved replies and notes, and keeping each customer updated.' },
      { q: 'What does good customer service mean to you?', tip: 'Fast, friendly, accurate and owned: solve it the first time, or tell the customer exactly what happens next.' },
      { q: 'Which support tools have you used?', tip: 'Name real tools: Zendesk, Freshdesk, Salesforce, CRMs, ticketing, Excel. If none, say how quickly you learn tools.' },
      { q: 'How would you explain a technical problem to a customer who is not technical?', tip: 'Plain words, short steps, a simple comparison, and check they understood. Show a quick example.' },
      { q: 'What metrics matter in a support role?', tip: 'First response time, resolution time, CSAT, first contact resolution, and quality scores. Mention your own numbers if you have them.' }
    ] },
    { id: 'sales', name: 'Sales', qs: [
      { q: 'Sell me this pen.', tip: 'Do not list features first. Ask questions about the buyer\'s needs, then connect the pen to what they said, then ask for the sale.' },
      { q: 'Tell me about a deal you closed that you are proud of.', tip: 'Size of the deal, the challenge, what you did, and the result. Numbers make it real.', star: true },
      { q: 'How do you handle rejection?', tip: 'Show resilience: you learn from each no, keep your pipeline full, and keep going. Give one example.' },
      { q: 'How do you find new leads?', tip: 'LinkedIn, referrals, cold calls, events, CRM data. Show a repeatable routine, not luck.' },
      { q: 'A customer says the price is too high. What do you say?', tip: 'Understand what they compare against, show the value and savings, and offer options before discounting.' },
      { q: 'Tell me about a time you missed a target. What did you do?', tip: 'Own it, explain what you changed, and show the result in the next period.', star: true },
      { q: 'What does your typical day look like in sales?', tip: 'Prospecting, calls, follow-ups, meetings, CRM updates. Show discipline and planning.' },
      { q: 'Why do you want to sell our product?', tip: 'Show you understand who buys it and why. Being excited about the product is a real advantage in sales.' }
    ] },
    { id: 'data', name: 'Data & analytics', qs: [
      { q: 'Walk me through a data project from start to finish.', tip: 'Question, data source, cleaning, analysis, chart, recommendation, and what changed because of it.', star: true },
      { q: 'How do you handle missing or messy data?', tip: 'Find out why it is missing, then remove, fill or flag it based on the impact. Always document what you did.' },
      { q: 'Explain the difference between a JOIN and a UNION in SQL.', tip: 'A JOIN combines columns from tables on a key; a UNION stacks rows from similar queries. Give a tiny example.' },
      { q: 'How would you explain your findings to a manager who does not like numbers?', tip: 'Lead with the answer, use one clear chart, and say what to do next. Keep details for the questions.' },
      { q: 'Which tools are you most comfortable with?', tip: 'Be honest about levels: Excel, SQL, Power BI or Tableau, Python. Give an example of each in use.' },
      { q: 'What would you look at if sales dropped 20% last month?', tip: 'Break it down: by region, product, channel, customer type. Check data issues first, then seasonality and recent changes.' },
      { q: 'What is the difference between correlation and causation?', tip: 'Two things moving together does not mean one causes the other. Give an everyday example, like ice cream and sunburn.' },
      { q: 'Tell me about a time your analysis changed a decision.', tip: 'The decision before, what you found, and the decision after. Numbers help.', star: true }
    ] },
    { id: 'tech', name: 'Software & IT', qs: [
      { q: 'Tell me about a bug that was hard to find. How did you fix it?', tip: 'Show your debugging method: reproduce, narrow down, test a hypothesis, fix, and prevent it happening again.', star: true },
      { q: 'Explain a project on your resume in detail.', tip: 'The problem, the architecture, your part, a hard decision you made, and what you would do differently.' },
      { q: 'How do you keep your skills up to date?', tip: 'Name specific things: courses, docs, side projects, communities. Mention something you learned recently.' },
      { q: 'What happens when you type a website address and press Enter?', tip: 'DNS lookup, TCP and TLS connection, HTTP request, server response, browser renders. Go as deep as they want.' },
      { q: 'How would you explain an API to someone who is not technical?', tip: 'Use a simple comparison like a waiter taking an order to the kitchen and bringing the food back.' },
      { q: 'Tell me about a time you disagreed with a technical decision.', tip: 'Show you raised it with evidence, listened, and supported the final decision.', star: true },
      { q: 'How do you approach a task you have never done before?', tip: 'Break it down, research, build a small version first, and ask for help early instead of getting stuck.' },
      { q: 'What does good code mean to you?', tip: 'Readable, tested, simple, and easy to change. Mention code reviews and naming.' }
    ] },
    { id: 'marketing', name: 'Marketing', qs: [
      { q: 'Tell me about a campaign you ran. How did it perform?', tip: 'Goal, audience, channel, budget, and results with numbers: reach, clicks, leads, cost per lead.', star: true },
      { q: 'How would you market our product with a small budget?', tip: 'Pick one clear audience, use low-cost channels (content, SEO, communities, referrals), and measure everything.' },
      { q: 'Which marketing metrics do you track?', tip: 'Match metrics to the goal: reach and engagement for awareness, CTR and conversions for leads, CAC and ROI for business.' },
      { q: 'How do you come up with content ideas?', tip: 'Customer questions, search data, competitors, trends, and what performed well before.' },
      { q: 'A campaign is not working. What do you do?', tip: 'Check the data, find the weak step (audience, message, landing page), test one change at a time.' },
      { q: 'What brand do you think markets really well, and why?', tip: 'Pick one you genuinely follow. Explain the specific thing they do well and what you would borrow.' },
      { q: 'Which tools have you used?', tip: 'Google Analytics, Meta Ads, Google Ads, Canva, HubSpot, SEO tools. Be honest about your level.' }
    ] },
    { id: 'ops', name: 'Operations & admin', qs: [
      { q: 'How do you organise your day when everything feels urgent?', tip: 'Show your method: list, sort by deadline and impact, communicate about what will slip.' },
      { q: 'Tell me about a process you improved.', tip: 'What was slow or broken, what you changed, and the result in time or money saved.', star: true },
      { q: 'How do you make sure you do not make mistakes in data entry or reports?', tip: 'Checklists, double-checking key numbers, templates, and Excel checks like totals and filters.' },
      { q: 'Tell me about a time you handled several deadlines at once.', tip: 'Show planning, clear communication, and getting everything done or managing expectations early.', star: true },
      { q: 'How comfortable are you with Excel?', tip: 'Be specific: VLOOKUP or XLOOKUP, PivotTables, filters, charts. Offer to show it in a test.' },
      { q: 'A vendor delivers late and it affects your team. What do you do?', tip: 'Inform the team, find a short-term fix, discuss with the vendor calmly, and record it for future decisions.' },
      { q: 'How do you handle confidential information?', tip: 'Share only on a need-to-know basis, follow company rules, lock files and screens. Give an example if you can.' }
    ] }
  ];
  var STAR_STEPS = [['S', 'Situation', 'Where and when. One or two lines.'], ['T', 'Task', 'What you had to do, or the problem.'],
    ['A', 'Action', 'What YOU did. Most of the answer goes here.'], ['R', 'Result', 'What happened. Use a number if you can.']];
  var RATINGS = [['Nailed', 'Nailed it'], ['Okay', 'Okay'], ['Rough', 'Rough']];

  function allQs() {
    var out = [];
    PACKS.forEach(function (p) { p.qs.forEach(function (q, i) { out.push({ id: p.id + '-' + i, pack: p.id, packName: p.name, q: q.q, tip: q.tip, star: !!q.star }); }); });
    return out;
  }
  var ALL_QS = allQs();
  function qById(id) { for (var i = 0; i < ALL_QS.length; i++) if (ALL_QS[i].id === id) return ALL_QS[i]; return null; }
  var iv = { pack: 'general', cur: null, seen: {}, secs: null };
  // Questions whose most recent rating was Rough.
  function roughIds() {
    var last = {};
    S.practice.forEach(function (p) { if (p.id) last[p.id] = p.r; });
    return Object.keys(last).filter(function (k) { return last[k] === 'Rough' && qById(k); });
  }
  function packPool(pack) {
    if (pack === 'mix') return ALL_QS;
    if (pack === 'rough') return roughIds().map(qById);
    return ALL_QS.filter(function (q) { return q.pack === pack; });
  }
  // A random question from the pack, not repeating until you have seen them all.
  function pickQ() {
    var pool = packPool(iv.pack);
    if (!pool.length) { iv.cur = null; return; }
    var seen = iv.seen[iv.pack] || (iv.seen[iv.pack] = {});
    var fresh = pool.filter(function (q) { return !seen[q.id] && q.id !== iv.cur; });
    if (!fresh.length) { iv.seen[iv.pack] = {}; seen = iv.seen[iv.pack]; fresh = pool.filter(function (q) { return q.id !== iv.cur; }); if (!fresh.length) fresh = pool; }
    var q = fresh[Math.floor(Math.random() * fresh.length)];
    seen[q.id] = 1;
    iv.cur = q.id;
    iv.secs = null;
    stopTimer();
  }
  function cleanNotes(raw) {
    var b = {};
    if (isObj(raw)) Object.keys(raw).slice(0, 400).forEach(function (k) { if (typeof raw[k] === 'string' && raw[k].trim()) b[k] = raw[k].slice(0, 1500); });
    return b;
  }
  function fmtSecs(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function ivStats() {
    var weekAgo = Date.now() - 7 * 864e5, week = 0, nailed = 0, timed = 0, total = 0;
    S.practice.forEach(function (p) {
      if (p.t > weekAgo) week++;
      if (p.r === 'Nailed') nailed++;
      if (typeof p.secs === 'number') { timed++; total += p.secs; }
    });
    return '<div class="stats"><div class="stat hot"><b>' + S.practice.length + '</b><span>' + ico('prep') + 'practiced</span></div>' +
      '<div class="stat"><b>' + week + '</b><span>this week</span></div>' +
      '<div class="stat"><b>' + (S.practice.length ? Math.round(nailed / S.practice.length * 100) + '%' : '–') + '</b><span>nailed</span></div>' +
      '<div class="stat"><b>' + (timed ? fmtSecs(Math.round(total / timed)) : '–') + '</b><span>average answer</span></div></div>';
  }
  function ivPacks() {
    var rough = roughIds().length;
    var chip = function (id, label, n) {
      return '<button type="button" class="chip' + (iv.pack === id ? ' on' : '') + '" data-act="iv-pack" data-p="' + id + '" aria-pressed="' + (iv.pack === id) + '">' + label + (n !== undefined ? ' <span>' + n + '</span>' : '') + '</button>';
    };
    return '<div class="chips" role="group" aria-label="Question pack">' + PACKS.map(function (p) { return chip(p.id, p.name, p.qs.length); }).join('') +
      chip('mix', 'Mix of all') + (rough ? chip('rough', 'Retry my rough ones', rough) : '') + '</div>';
  }
  function ivQuestion() {
    var q = qById(iv.cur);
    if (!q) return '<section class="card"><p class="muted">No questions here yet. Rate a question "Rough" and it will come back in this pack.</p></section>';
    var note = S.qnotes[q.id] || '';
    return '<section class="card stack iv-card"><div class="row between"><span class="pill">' + esc(q.packName) + '</span>' +
      (q.star ? '<span class="muted small">Use STAR</span>' : '') + '</div>' +
      '<p class="question">' + esc(q.q) + '</p>' +
      '<details class="iv-tip"><summary>Show a tip</summary><p class="small">' + esc(q.tip) + '</p></details>' +
      (q.star ? '<div class="star-grid">' + STAR_STEPS.map(function (s) { return '<div><b>' + s[0] + '</b><span><strong>' + s[1] + '</strong> ' + s[2] + '</span></div>'; }).join('') + '</div>' : '') +
      '<div class="iv-timer"><div class="row between"><span class="timer" id="timer">' + (iv.secs != null ? fmtSecs(iv.secs) : '0:00') + '</span>' +
      '<span class="muted small">Aim for under 2:00</span></div><div class="tbar"><i id="timerbar" style="width:' + (iv.secs != null ? Math.min(100, iv.secs / 120 * 100) : 0) + '%"></i></div></div>' +
      '<div class="row"><button class="btn" data-act="timer" id="timerbtn">' + (iv.secs != null ? 'Restart timer' : 'Start timer') + '</button>' +
      '<button class="btn ghost" data-act="next-q">Skip question</button></div>' +
      '<div><p class="small"><b>How did that go?</b></p><div class="row" style="margin-top:6px">' +
      RATINGS.map(function (r) { return '<button class="btn ghost" data-act="rate" data-r="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div></div>' +
      '<label class="stack small"><b>Your notes for this question</b><textarea id="ivnote" rows="4" maxlength="1500" placeholder="Key points, a story to use, numbers to mention. Only you can see this.">' + esc(note) + '</textarea></label></section>';
  }
  function ivHistory() {
    var recent = S.practice.slice(-15).reverse();
    if (!recent.length) return '<p class="muted small">Your practice history shows here after you rate your first answer.</p>';
    return '<ul class="iv-hist">' + recent.map(function (p) {
      var d = new Date(p.t);
      return '<li><span class="iv-r ' + esc(p.r) + '">' + esc(p.r) + '</span><span class="grow">' + esc(p.q) + '</span>' +
        '<span class="muted small">' + (typeof p.secs === 'number' ? fmtSecs(p.secs) + ' · ' : '') + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '</span></li>';
    }).join('') + '</ul>';
  }

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
      qnotes: {}, // interview practice notes, by question id
      bingo: null, // made the first time the Fun tab opens
      cv: null, // resume builder, made the first time it opens
      cl: null, // cover letter helper, made the first time it opens
      learn: {} // free learning library: course id -> 'doing' | 'done'
    };
  }
  // Turn whatever the server (or old local storage) holds into a safe, complete shape.
  function adopt(raw) {
    var b = blank();
    if (!isObj(raw)) return b;
    if (Array.isArray(raw.apps)) b.apps = raw.apps.filter(isObj);
    if (Array.isArray(raw.practice)) b.practice = raw.practice.filter(isObj).slice(-500);
    b.qnotes = cleanNotes(raw.qnotes);
    if (typeof raw.resume === 'string') b.resume = raw.resume;
    b.bingo = cleanBingo(raw.bingo);
    b.cv = cleanCv(raw.cv);
    b.cl = cleanCl(raw.cl);
    b.learn = cleanLearn(raw.learn);
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
    alerts.list = null; alerts.totalNew = 0; alerts.notified = null; updateJobsBadge();
    buddy.state = null; buddy.suggestions = null; buddy.editing = false;
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

  // ---------- tracker follow-ups ----------
  // Each tracked job can hold: applied, interview (+ itime), followUp (all 'YYYY-MM-DD'), followed (count), contact, note.
  // Moving a job to Applied starts a 7-day follow-up clock; Offer or Rejected stops it.
  var FOLLOW_DAYS = 7, AFTER_INTERVIEW_DAYS = 3, MAX_FOLLOWS = 2;
  function isDay(k) { return typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k); }
  function isTime(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
  function dayDate(k) { var p = k.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function addDays(k, n) { var d = dayDate(k); d.setDate(d.getDate() + n); return dkey(d); }
  function dayDiff(a, b) { return Math.round((dayDate(b) - dayDate(a)) / 864e5); } // b - a, in days
  function fmtDay(k) { return dayDate(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtTime(t) { var p = t.split(':'); var d = new Date(); d.setHours(Number(p[0]), Number(p[1]), 0, 0); return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function relDay(k) {
    var n = dayDiff(today(), k);
    return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 1 ? 'in ' + n + ' days' : -n + ' days ago';
  }
  function activeStage(a) { return a.stage === 'Applied' || a.stage === 'Interview'; }
  // What changes when a job moves to a new stage.
  function onStage(a) {
    if (a.stage === 'Applied') {
      if (!isDay(a.applied)) a.applied = today();
      if (!isDay(a.followUp)) a.followUp = addDays(a.applied, FOLLOW_DAYS);
    } else if (a.stage === 'Offer' || a.stage === 'Rejected') {
      a.followUp = '';
    }
  }
  function followDue(a) { return activeStage(a) && isDay(a.followUp) && a.followUp <= today(); }
  function interviewSoon(a, days) { return a.stage !== 'Rejected' && a.stage !== 'Offer' && isDay(a.interview) && a.interview >= today() && a.interview <= addDays(today(), days); }
  // Things that need you: follow-ups due or overdue, interviews today or tomorrow.
  function trackerDue() {
    var out = [];
    S.apps.forEach(function (a) {
      if (interviewSoon(a, 1)) out.push({ kind: 'interview', a: a, key: a.interview + (isTime(a.itime) ? a.itime : '') });
      if (followDue(a)) out.push({ kind: 'follow', a: a, key: a.followUp });
    });
    return out.sort(function (x, y) { return x.key < y.key ? -1 : x.key > y.key ? 1 : 0; });
  }
  function updateTrackerBadge() {
    var el = document.getElementById('trackerbadge');
    if (!el) return;
    var n = me ? trackerDue().length : 0;
    el.textContent = n ? String(n) : '';
    el.hidden = !n;
  }
  function interviewText(a) { return fmtDay(a.interview) + (isTime(a.itime) ? ', ' + fmtTime(a.itime) : ''); }
  function dueRow(item, withActions) {
    var a = item.a, id = esc(a.id), who = '<b>' + esc(a.title) + '</b> <span class="muted">at ' + esc(a.company) + '</span>';
    if (item.kind === 'interview') {
      return '<li class="due-row"><span class="due-ico iv">' + ico('prep') + '</span><span class="grow">Interview ' + relDay(a.interview) + ': ' + who +
        '<br><span class="muted small">' + esc(interviewText(a)) + '</span></span>' +
        (withActions ? '<span class="row due-acts"><button type="button" class="btn tiny ghost" data-act="app-ics" data-id="' + id + '">' + ico('download') + 'Add to calendar</button>' +
          '<a class="btn tiny ghost" href="#/interview">Practise</a></span>' : '') + '</li>';
    }
    var late = dayDiff(a.followUp, today());
    return '<li class="due-row"><span class="due-ico fu">' + ico('mail') + '</span><span class="grow">Follow up: ' + who +
      '<br><span class="muted small">' + (late > 0 ? 'Due ' + late + (late === 1 ? ' day' : ' days') + ' ago' : 'Due today') +
      (a.followed ? ' · followed up ' + a.followed + (a.followed === 1 ? ' time' : ' times') + ' so far' : '') + '</span></span>' +
      (withActions ? '<span class="row due-acts"><button type="button" class="btn tiny primary" data-act="app-draft" data-id="' + id + '">Draft message</button>' +
        '<button type="button" class="btn tiny ghost" data-act="app-followed" data-id="' + id + '">' + ico('check') + 'I followed up</button>' +
        '<button type="button" class="link small" data-act="app-snooze" data-id="' + id + '">Snooze 3 days</button></span>' : '') + '</li>';
  }
  function trackerUpcoming() {
    var due = trackerDue();
    var later = S.apps.filter(function (a) { return interviewSoon(a, 14) && !interviewSoon(a, 1); })
      .sort(function (x, y) { return x.interview < y.interview ? -1 : 1; });
    if (!due.length && !later.length) return '';
    return '<section class="card due-card"><h2>Coming up</h2><ul class="due-list">' + due.map(function (d) { return dueRow(d, true); }).join('') +
      later.map(function (a) { return dueRow({ kind: 'interview', a: a }, true); }).join('') + '</ul></section>';
  }
  function homeDueHtml() {
    var due = trackerDue();
    if (!due.length) return '';
    return '<section class="card due-card"><div class="row between"><h2>' + ico('bell') + ' Due today</h2><a class="btn tiny ghost" href="#/tracker">Open tracker</a></div>' +
      '<ul class="due-list">' + due.slice(0, 4).map(function (d) { return dueRow(d, false); }).join('') + '</ul>' +
      (due.length > 4 ? '<p class="muted small">and ' + (due.length - 4) + ' more in your tracker.</p>' : '') + '</section>';
  }
  // The little date lines on each tracker card.
  function appDates(a) {
    var out = [];
    if (isDay(a.interview) && a.stage !== 'Rejected') {
      var past = a.interview < today();
      out.push('<span class="adate' + (past ? '' : ' iv') + '">' + ico('prep') + (past ? 'Interviewed ' : 'Interview ') + esc(fmtDay(a.interview)) + (isTime(a.itime) && !past ? ', ' + esc(fmtTime(a.itime)) : '') + '</span>');
    } else if (a.stage === 'Interview') {
      out.push('<button type="button" class="adate add" data-act="app-edit" data-id="' + esc(a.id) + '">+ Add interview date</button>');
    }
    if (isDay(a.applied)) out.push('<span class="adate">Applied ' + esc(fmtDay(a.applied)) + ' · ' + dayDiff(a.applied, today()) + 'd</span>');
    if (activeStage(a) && isDay(a.followUp)) {
      var n = dayDiff(today(), a.followUp);
      out.push('<span class="adate fu' + (n < 0 ? ' late' : n === 0 ? ' now' : '') + '">' + ico('mail') +
        (n < 0 ? 'Follow-up ' + -n + 'd overdue' : n === 0 ? 'Follow up today' : 'Follow up ' + relDay(a.followUp)) + '</span>');
    }
    return out.length ? '<div class="adates">' + out.join('') + '</div>' : '';
  }

  // ----- dialogs: edit dates, draft a follow-up -----
  function sheet(id, html) {
    var d = document.getElementById(id);
    if (d) d.remove();
    document.body.insertAdjacentHTML('beforeend', '<dialog id="' + id + '" class="sheet wide">' + html + '</dialog>');
    d = document.getElementById(id);
    d.addEventListener('close', function () { d.remove(); });
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    return d;
  }
  function openAppEditor(a) {
    var v = function (k) { return esc(typeof a[k] === 'string' ? a[k] : ''); };
    sheet('appedit', '<h2>' + esc(a.title) + ' <span class="muted">at ' + esc(a.company) + '</span></h2>' +
      '<form class="stack" data-form="appedit" data-id="' + esc(a.id) + '">' +
      '<div class="grid2 tight"><label>Applied on<input type="date" name="applied" value="' + v('applied') + '"></label>' +
      '<label>Follow up on<input type="date" name="followUp" value="' + v('followUp') + '"></label></div>' +
      '<div class="grid2 tight"><label>Interview on<input type="date" name="interview" value="' + v('interview') + '"></label>' +
      '<label>Interview time <span class="muted">(optional)</span><input type="time" name="itime" value="' + v('itime') + '"></label></div>' +
      '<label>Recruiter or contact <span class="muted">(optional)</span><input type="text" name="contact" maxlength="100" value="' + v('contact') + '" placeholder="e.g. Ms. Priya Raman"></label>' +
      '<label>Notes <span class="muted">(optional)</span><textarea name="note" rows="3" maxlength="500" placeholder="Salary discussed, who you spoke to, next steps">' + v('note') + '</textarea></label>' +
      '<p class="muted small">Leave "Follow up on" empty for no reminder. Saving an interview date sets a check-in ' + AFTER_INTERVIEW_DAYS + ' days after it.</p>' +
      '<div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-act="sheet-close">Cancel</button></div></form>');
  }
  function followDraft(a) {
    var hi = 'Hi ' + (a.contact && a.contact.trim() ? a.contact.trim() : 'there') + ',';
    var role = 'the ' + a.title + ' role at ' + a.company;
    var after = isDay(a.interview) && a.interview < today();
    var subject, body;
    if (after) {
      subject = 'Thank you, and following up on ' + a.title;
      body = 'Thank you again for speaking with me on ' + fmtDay(a.interview) + ' about ' + role + '. I enjoyed learning more about the team, and I am even more interested in the role.\n\n' +
        'I wanted to check whether there is any update on the next steps, or anything else I can share.';
    } else if (a.followed) {
      subject = 'Checking in on my ' + a.title + ' application';
      body = 'I wanted to check in once more about my application for ' + role + '. I am still very interested and would be glad to share anything else you need.';
    } else {
      subject = 'Following up on my ' + a.title + ' application';
      body = 'I applied for ' + role + (isDay(a.applied) ? ' on ' + fmtDay(a.applied) : '') + ' and wanted to follow up. I am very interested in the role, and I believe my experience is a good match.\n\n' +
        'Please let me know if there is anything else I can share.';
    }
    return 'Subject: ' + subject + '\n\n' + hi + '\n\n' + body + '\n\nThank you for your time,\n' + me.name;
  }
  function openDraft(a) {
    sheet('appdraft', '<h2>' + ico('mail') + ' Follow-up message</h2>' +
      '<p class="muted small">Edit it to sound like you, then copy it into an email or LinkedIn message.</p>' +
      '<textarea id="draftbox" rows="12">' + esc(followDraft(a)) + '</textarea>' +
      '<div class="row" style="margin-top:12px"><button type="button" class="btn primary" data-act="draft-copy">Copy</button>' +
      '<button type="button" class="btn ghost" data-act="app-followed" data-id="' + esc(a.id) + '">' + ico('check') + 'Sent it</button>' +
      '<button type="button" class="btn ghost" data-act="sheet-close">Close</button></div>');
  }
  // A calendar file for the interview (works with Google Calendar, Outlook and phone calendars).
  function icsText(a) {
    var esc2 = function (s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); };
    var d = a.interview.replace(/-/g, '');
    var start, end;
    if (isTime(a.itime)) {
      var t = a.itime.replace(':', '') + '00';
      var e = new Date(dayDate(a.interview).getTime()); var p = a.itime.split(':'); e.setHours(Number(p[0]) + 1, Number(p[1]), 0, 0);
      start = 'DTSTART:' + d + 'T' + t;
      end = 'DTEND:' + dkey(e).replace(/-/g, '') + 'T' + String(e.getHours()).padStart(2, '0') + String(e.getMinutes()).padStart(2, '0') + '00';
    } else {
      start = 'DTSTART;VALUE=DATE:' + d;
      end = 'DTEND;VALUE=DATE:' + addDays(a.interview, 1).replace(/-/g, '');
    }
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Bench//Tracker//EN', 'BEGIN:VEVENT',
      'UID:' + a.id + '-' + d + '@the-bench', 'DTSTAMP:' + stamp, start, end,
      'SUMMARY:' + esc2('Interview: ' + a.title + ' at ' + a.company),
      'DESCRIPTION:' + esc2((a.note ? a.note + '\n\n' : '') + 'Practise first: open The Bench, Prep, Start practising.'),
      'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc2('Interview with ' + a.company + ' in 1 hour'), 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
  }
  function downloadIcs(a) {
    var blob = new Blob([icsText(a)], { type: 'text/calendar' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'interview-' + String(a.company).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.ics';
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
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
        installBanner() +
        homeDueHtml() +
        homeBuddyHtml() +
        alertBanner() +
        '<p class="banner">' + ico('fun') + '<span>Today\'s puzzle and question of the day are up. <a href="#/fun">Play now</a></span></p>' +
        '<div class="grid2"><section class="card"><div class="row between"><h2>Today\'s routine</h2><a class="btn tiny ghost" href="#/routine">Open</a></div>' + taskList() + '</section>' +
        '<section class="stack"><div class="row between"><h2>Fresh from the feed</h2><a class="btn tiny ghost" href="#/feed">See all</a></div>' + latest + '</section></div>' +
        accountBar() + '</div>';
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

    resume: function () {
      return head('Resume builder', 'Fill it in once, pick a look, and download a clean PDF. It saves privately to your account as you type.') +
        '<div class="row cv-actions"><button class="btn primary" data-act="cv-print">' + ico('download') + 'Download PDF</button>' +
        '<button class="btn ghost" data-act="cv-check">Check it with the resume checker</button>' +
        '<a class="btn ghost" href="#/cover">' + ico('mail') + 'Write a cover letter</a>' +
        '<span class="muted small">In the print window, choose “Save as PDF”.</span></div>' +
        '<div class="cv-layout"><div id="cveditor">' + (S.cv ? cvEditor() : '<p class="muted">Getting your details…</p>') + '</div>' +
        '<div class="cv-preview-wrap"><p class="muted small cv-preview-label">Live preview</p><div id="cvpreview">' + (S.cv ? cvPreview() : '') + '</div></div></div>';
    },

    cover: function () {
      var ready = S.cl && S.cv;
      return head('Cover letter helper', 'Answer a few questions and get a letter built from your resume. Paste the job post to see which key words to mention.') +
        '<div class="row cv-actions"><button class="btn primary" data-act="cl-print">' + ico('download') + 'Download PDF</button>' +
        '<button class="btn ghost" data-act="cl-copy">Copy the text</button>' +
        '<span class="muted small">In the print window, choose “Save as PDF”.</span></div>' +
        '<div class="cv-layout"><div id="cleditor">' + (ready ? clEditor() : '<p class="muted">Getting your details…</p>') + '</div>' +
        '<div class="cv-preview-wrap"><p class="muted small cv-preview-label">Live preview</p><div id="clpreview">' + (ready ? clPreview() : '') + '</div></div></div>';
    },

    interview: function () {
      if (!iv.cur) pickQ();
      return head('Interview practice', 'Pick a pack, answer out loud against the clock, then rate yourself. Your notes and history stay private.') +
        ivStats() + ivPacks() +
        '<div class="grid2 iv-grid"><div id="ivq">' + ivQuestion() + '</div>' +
        '<section class="card stack"><h2>Recent practice</h2>' + ivHistory() + '</section></div>';
    },

    learn: function () {
      return head('Free learning library', 'Hand-picked courses that are free to learn. Mark what you are doing, and add finished ones to your resume.') +
        '<div id="learnsum">' + learnSummary() + '</div>' +
        '<div id="learnctl">' + learnControls() + '</div>' +
        '<div id="learnlist">' + learnListHtml() + '</div>' +
        '<p class="muted small" style="margin-top:16px">Links go to each provider’s own site. Course details change, so check the certificate terms there before you start.</p>';
    },

    buddy: function () {
      return head('Accountability buddy', 'Pair up with one person, share a one-line plan each day, and keep each other going.') +
        '<div id="buddybody">' + buddyHtml() + '</div>';
    },

    people: function () {
      return head('People', 'Everyone on The Bench. Find someone hunting for the same kind of role, or just say hello.') +
        '<div class="stack"><input type="search" id="peopleq" placeholder="Search by name, role, skill or city" aria-label="Search people" value="' + esc(prof.query) + '">' +
        '<div class="chips"><button type="button" class="chip' + (prof.buddyOnly ? ' on' : '') + '" data-act="people-buddy" aria-pressed="' + !!prof.buddyOnly + '">' + ico('users') + ' Looking for a buddy</button></div>' +
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
      var tab = function (t, label) {
        var on = jobs.tab === t;
        return '<button type="button" data-act="jobs-tab" data-t="' + t + '" aria-pressed="' + on + '"' + (on ? ' class="on"' : '') + '>' + label + '</button>';
      };
      return head('Jobs', 'Real openings in India, straight from the companies hiring, plus leads and referrals from members. No middlemen, no ads.') +
        '<div class="seg big" role="group" aria-label="Which jobs">' + tab('employers', 'From employers') + tab('leads', 'Shared by members') + tab('refs', 'Referrals') + '</div>' +
        '<div id="jobpane">' + (jobs.tab === 'leads' ? leadsPane() : jobs.tab === 'refs' ? refsPane() : employersPane()) + '</div>';
    },

    tracker: function () {
      var cols = STAGES.map(function (s, i) {
        var items = S.apps.filter(function (a) { return a.stage === s; });
        return '<section class="col"><h3><span>' + s + '</span><span class="muted">' + items.length + '</span></h3>' +
          items.map(function (a) {
            var id = esc(a.id);
            var title = typeof a.url === 'string' && /^https?:\/\//.test(a.url)
              ? '<a class="plain-link" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' : esc(a.title);
            return '<div class="app' + (followDue(a) ? ' due' : '') + '"><b>' + title + '</b><span class="muted small">' + esc(a.company) + '</span>' +
              appDates(a) +
              '<div class="row between"><div class="row">' +
              '<button class="btn tiny ghost" data-act="move-app" data-id="' + id + '" data-dir="-1" aria-label="Move back"' + (i === 0 ? ' disabled' : '') + '>←</button>' +
              '<button class="btn tiny ghost" data-act="move-app" data-id="' + id + '" data-dir="1" aria-label="Move forward"' + (i === STAGES.length - 1 ? ' disabled' : '') + '>→</button></div>' +
              '<span class="row"><button class="link" data-act="app-edit" data-id="' + id + '">dates</button>' +
              '<button class="link" data-act="del-app" data-id="' + id + '">remove</button></span></div></div>';
          }).join('') + '</section>';
      }).join('');
      return head('Tracker', 'Every application in one place, so nothing gets lost in your inbox.') +
        '<div class="stack"><form class="card row" data-form="app">' +
        '<input class="grow" type="text" name="title" placeholder="Job title" aria-label="Job title" maxlength="80" required>' +
        '<input class="grow" type="text" name="company" placeholder="Company" aria-label="Company" maxlength="60" required>' +
        '<select class="auto" name="stage" aria-label="Stage">' + STAGES.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>' +
        '<button class="btn primary">Add</button></form>' +
        trackerUpcoming() +
        '<div class="board">' + cols + '</div>' +
        '<p class="muted small">Moving a job to Applied sets a follow-up reminder for ' + FOLLOW_DAYS + ' days later. Tap “dates” on a card to add interview dates or change reminders.</p></div>';
    },

    prep: function () {
      var tally = { Nailed: 0, Okay: 0, Rough: 0 };
      S.practice.forEach(function (p) { if (tally[p.r] !== undefined) tally[p.r]++; });
      return head('Interview prep', 'Check your resume and practice answers out loud before the real thing.') +
        '<p class="banner">' + ico('feed') + '<span><b>New: Resume builder and cover letters.</b> Fill in a simple form, pick a look, and download a clean PDF. <a href="#/resume">Build your resume</a> · <a href="#/cover">Write a cover letter</a> · <a href="#/learn">Free courses</a></span></p>' +
        '<div class="grid2"><section class="card stack"><h2>Resume checkup</h2>' +
        '<form class="stack" data-form="resume"><textarea id="resume" name="text" style="min-height:220px" maxlength="20000" placeholder="Paste your resume text here" aria-label="Resume text">' + esc(S.resume) + '</textarea>' +
        '<div class="row between"><span class="muted small">Saved privately to your account.</span><button class="btn primary">Check it</button></div></form>' +
        '<div id="report">' + reportHtml() + '</div></section>' +
        '<section class="card stack"><h2>Mock interview</h2>' +
        '<p>' + PACKS.length + ' question packs: freshers, HR round, customer support, sales, data, software, marketing and operations. Answer out loud against a 2-minute clock, with tips and a STAR guide.</p>' +
        '<p class="banner">Practiced ' + S.practice.length + ' so far: ' + tally.Nailed + ' nailed, ' + tally.Okay + ' okay, ' + tally.Rough + ' rough.</p>' +
        '<div><a class="btn primary" href="#/interview">' + ico('prep') + 'Start practising</a></div>' +
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
        '<p class="banner">' + ico('users') + '<span>Keep each other going: check in with an <a href="#/buddy">accountability buddy</a>.</span></p>' +
        '<p class="banner">' + ico('book') + '<span>Need something for your learning time? Browse the <a href="#/learn">free learning library</a>.</span></p>' +
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
  // ----- job alerts (saved searches) -----
  var alerts = { list: null, totalNew: 0, notified: null };
  function notifyOn() { try { return localStorage.getItem('bench:notify') === '1' && window.Notification && Notification.permission === 'granted'; } catch (e) { return false; } }
  function sameSearch(a) { return a.what === jobs.what.toLowerCase() && a.where === jobs.where.toLowerCase() && a.remote === jobs.remote && a.field === jobs.field; }
  function updateJobsBadge() {
    var el = document.getElementById('jobsbadge');
    if (el) { el.textContent = alerts.totalNew ? String(alerts.totalNew > 99 ? '99+' : alerts.totalNew) : ''; el.hidden = !alerts.totalNew; }
  }
  function alertsStrip() {
    if (!alerts.list || !alerts.list.length) return '';
    var notifyBtn = window.Notification
      ? '<button type="button" class="link" data-act="alert-notify">' + (notifyOn() ? 'Desktop notifications: on' : 'Turn on desktop notifications') + '</button>' : '';
    return '<section class="card alerts-card"><div class="row between"><h3>' + ico('bell') + 'Your job alerts</h3>' + notifyBtn + '</div><div class="chips">' +
      alerts.list.map(function (a) {
        var on = jobs.activeAlert === a.id;
        return '<span class="alert-chip' + (on ? ' on' : '') + '"><button type="button" data-act="alert-open" data-id="' + Number(a.id) + '">' + esc(a.name) +
          (a.newCount ? ' <b class="new-count">' + a.newCount + ' new</b>' : ' <span class="muted">' + a.total + '</span>') + '</button>' +
          '<button type="button" class="x" data-act="alert-del" data-id="' + Number(a.id) + '" aria-label="Delete alert ' + esc(a.name) + '">' + ico('x') + '</button></span>';
      }).join('') + '</div></section>';
  }
  function renderAlertsStrip() {
    var el = document.getElementById('alertstrip');
    if (el && currentView() === 'jobs' && jobs.tab === 'employers') el.innerHTML = alertsStrip();
  }
  function loadAlerts() {
    if (!me) return;
    api('GET', '/api/alerts').then(function (j) {
      alerts.list = Array.isArray(j.alerts) ? j.alerts : [];
      alerts.totalNew = Number(j.totalNew) || 0;
      // Desktop notification, only for matches that arrived after the page was opened, and only when not looking.
      if (alerts.notified === null) alerts.notified = alerts.totalNew;
      if (alerts.totalNew > alerts.notified && notifyOn() && document.visibilityState !== 'visible') {
        try {
          var note = new Notification('The Bench', { body: alerts.totalNew + ' new job' + (alerts.totalNew === 1 ? '' : 's') + ' match your alerts', icon: 'favicon.svg', tag: 'bench-alerts' });
          note.onclick = function () { window.focus(); location.hash = '#/jobs'; note.close(); };
        } catch (e) { /* notifications blocked */ }
      }
      alerts.notified = Math.max(alerts.notified, alerts.totalNew);
      updateJobsBadge();
      renderAlertsStrip();
      var saveBox = document.getElementById('savealert');
      if (saveBox) saveBox.innerHTML = saveAlertHtml();
      if (currentView() === 'home') { var b = document.getElementById('alertbanner'); if (b) b.outerHTML = alertBanner(); }
    }).catch(function (e) { if (e.status === 401) fail(e); });
  }
  function alertBanner() {
    return alerts.totalNew
      ? '<p class="banner" id="alertbanner">' + ico('bell') + '<span><b>' + alerts.totalNew + ' new job' + (alerts.totalNew === 1 ? '' : 's') + '</b> match your alerts. <a href="#/jobs">See them</a></span></p>'
      : '<span id="alertbanner" hidden></span>';
  }
  function saveAlertHtml() {
    var filtered = jobs.what || jobs.where || jobs.remote || jobs.field;
    if (!filtered || !alerts.list) return '';
    if (alerts.list.some(sameSearch)) return '<span class="muted small">' + ico('bell') + ' Saved as an alert</span>';
    return '<button type="button" class="btn tiny ghost" data-act="save-alert">' + ico('bell') + 'Alert me about new jobs like these</button>';
  }

  function employersPane() {
    return '<div id="alertstrip">' + alertsStrip() + '</div>' +
      '<form class="card job-search" data-form="jobsearch">' +
      '<label class="grow">Role, team or company<input type="search" name="what" maxlength="60" placeholder="e.g. support, finance, Stripe" value="' + esc(jobs.what) + '"></label>' +
      '<label class="grow">City <span class="muted">(optional)</span><input type="search" name="where" maxlength="60" placeholder="e.g. Bengaluru" value="' + esc(jobs.where) + '"></label>' +
      '<label class="check remote-check"><input type="checkbox" name="remote" value="1"' + (jobs.remote ? ' checked' : '') + '> Remote only</label>' +
      '<button class="btn primary">Search</button></form>' +
      '<div id="joblist">' + jobsHtml() + '</div>';
  }
  function jobHtml(j) {
    var tags = [j.remote ? 'Remote' : '', j.type, j.team].filter(Boolean).map(function (t) { return '<span class="pill">' + esc(t) + '</span>'; }).join('');
    var fresh = jobs.newSince && j.posted && j.posted > jobs.newSince;
    return '<article class="card job' + (fresh ? ' fresh' : '') + '"><div class="row between job-top"><h3>' + (fresh ? '<span class="new-tag">New</span>' : '') + esc(j.title) + '</h3>' +
      (j.posted ? '<span class="muted small nowrap">' + ago(j.posted) + '</span>' : '') + '</div>' +
      '<p class="meta"><b class="company">' + esc(j.company) + '</b>' + (j.location ? ' · ' + esc(j.location) : '') + '</p>' +
      '<div class="row between job-foot"><div class="row">' + tags + '</div>' +
      '<div class="row">' + trackBtn(j.id) +
      '<a class="btn tiny primary" href="' + esc(j.url) + '" target="_blank" rel="noopener">Apply on ' + esc(j.company) + '\'s site</a></div></div></article>';
  }
  function fieldChips() {
    if (!jobs.loaded || !jobs.all) return '';
    var chip = function (key, label, count) {
      var on = jobs.field === key;
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-act="jobs-field" data-f="' + esc(key) + '" aria-pressed="' + on + '">' +
        esc(label) + ' <span>' + Number(count).toLocaleString() + '</span></button>';
    };
    return '<div class="chips" role="group" aria-label="Field of work">' + chip('', 'All', jobs.all) + chip('nontech', 'All non-tech', jobs.nontech) +
      jobs.fields.filter(function (f) { return f.key !== 'other'; }).sort(function (a, b) { return b.count - a.count; })
        .map(function (f) { return chip(f.key, f.label, f.count); }).join('') +
      (jobs.fields.some(function (f) { return f.key === 'other'; }) ? chip('other', 'Other', jobs.fields.filter(function (f) { return f.key === 'other'; })[0].count) : '') +
      '</div>';
  }
  function jobsHtml() {
    if (jobs.error && !jobs.list.length) return '<p class="card muted">' + esc(jobs.error) + '</p>';
    if (!jobs.loaded) return '<p class="muted">Gathering openings from ' + (jobs.companies || 'the') + ' companies… the first load can take a few seconds.</p>';
    var partial = jobs.partial ? '<p class="banner small">' + ico('jobs') + '<span>Still gathering listings from a few companies. More will appear here in a moment.</span></p>' : '';
    if (!jobs.list.length) return fieldChips() + partial + '<p class="card muted">No openings match that right now. Try a broader word, another city, or check <a href="#" data-act="jobs-tab" data-t="leads">Shared by members</a>.</p>';
    var shown = jobs.list.length, more = shown < jobs.total;
    var fieldName = jobs.field === 'nontech' ? 'non-tech' : jobs.field ? ((jobs.fields.filter(function (f) { return f.key === jobs.field; })[0] || {}).label || '').toLowerCase() : '';
    var filters = [fieldName && esc(fieldName), jobs.what && '“' + esc(jobs.what) + '”', jobs.where && 'in ' + esc(jobs.where), jobs.remote && 'remote'].filter(Boolean).join(' ');
    return fieldChips() + partial + '<p class="muted small results-count">' + jobs.total.toLocaleString() + ' opening' + (jobs.total === 1 ? '' : 's') + (filters ? ' for ' + filters : '') +
      ' from the careers pages of ' + jobs.companies + ' companies hiring in India. Newest first.</p>' +
      '<div id="savealert" class="save-alert">' + saveAlertHtml() + '</div>' +
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
      (jobs.where ? '&where=' + encodeURIComponent(jobs.where) : '') + (jobs.remote ? '&remote=1' : '') +
      (jobs.field ? '&field=' + encodeURIComponent(jobs.field) : '');
    clearTimeout(jobs.retry);
    api('GET', '/api/jobs' + qs).then(function (j) {
      var seen = {};
      jobs.list.forEach(function (x) { seen[x.id] = true; });
      jobs.list = jobs.list.concat((j.jobs || []).filter(function (x) { return !seen[x.id]; }));
      jobs.total = Number(j.total) || 0;
      jobs.companies = Number(j.companies) || 0;
      jobs.fields = Array.isArray(j.fields) ? j.fields : [];
      jobs.all = jobs.fields.reduce(function (sum, f) { return sum + f.count; }, 0);
      jobs.nontech = Number(j.nontech) || 0;
      jobs.partial = !!j.partial;
      jobs.page = page;
      jobs.loaded = true;
      // Cold start on the server: check back shortly for the slower feeds (first page only).
      if (jobs.partial && page === 1) jobs.retry = setTimeout(function () { if (currentView() === 'jobs' && jobs.tab === 'employers') loadJobs(false); }, 8000);
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

  // ----- referral board -----
  // Members list companies where they can refer people (or know people). Asking sends them a private message.
  var refs = { list: null, error: '', q: '', kind: 'all', asking: null, askDays: 30, maxOffers: 8 };
  var REF_KIND = { refer: 'Can refer', contact: 'Knows people there' };
  function loadRefs() {
    return api('GET', '/api/referrals').then(function (j) {
      refs.list = Array.isArray(j.offers) ? j.offers : [];
      refs.askDays = j.askDays || 30;
      refs.maxOffers = j.maxOffers || 8;
      refs.error = '';
    }, function (e) {
      if (e.status === 401) return fail(e);
      refs.error = e.message;
    }).then(function () {
      if (currentView() !== 'jobs' || jobs.tab !== 'refs') return;
      var mine = document.getElementById('refmine'); if (mine) mine.innerHTML = refMineHtml();
      var el = document.getElementById('reflist'); if (el) el.innerHTML = refsHtml();
    });
  }
  function refAskedRecently(o) { return o.myAsk && o.myAsk > Date.now() - refs.askDays * 864e5; }
  function refMessage(o) {
    var first = String(o.name || '').split(' ')[0] || 'there';
    var hl = S.cv && S.cv.headline ? S.cv.headline.trim() : '';
    var who = hl ? (/^[aeiou]/i.test(hl) ? 'an ' : 'a ') + hl.charAt(0).toLowerCase() + hl.slice(1) : 'looking for my next role';
    return 'Hi ' + first + ', I saw on The Bench that you can help with referrals at ' + o.company + '. I am ' + who +
      ', and I think I would be a good fit because [one line about why]. Would you be open to referring me? I can send my resume. Thank you!';
  }
  function refAskForm(o) {
    return '<form class="stack ref-ask" data-form="refask" data-id="' + Number(o.id) + '">' +
      '<div class="grid2 tight"><label>Role you want<input type="text" name="role" maxlength="100" required placeholder="e.g. Customer success associate"></label>' +
      '<label>Link to the job post <span class="muted">(optional)</span><input type="url" name="url" maxlength="300" placeholder="https://"></label></div>' +
      '<label>Message<textarea name="message" rows="5" maxlength="700" required>' + esc(refMessage(o)) + '</textarea></label>' +
      '<p class="muted small">This goes to ' + esc(o.name) + ' as a private message. Keep it short, fill in the part in [brackets], and share your resume if they say yes.</p>' +
      '<div class="row"><button class="btn primary">Send request</button><button type="button" class="btn ghost" data-act="ref-cancel">Cancel</button></div></form>';
  }
  function refCard(o) {
    var id = Number(o.id), u = esc(o.username);
    var opts = [];
    if (!o.own) opts.push('<button type="button" data-act="ref-report" data-id="' + id + '">Report</button>');
    if (o.own || me.isAdmin) opts.push('<button type="button" data-act="ref-del" data-id="' + id + '">Remove' + (o.own ? '' : ' (moderator)') + '</button>');
    var action;
    if (o.own) action = '<span class="muted small">Your offer' + (o.open ? '' : ' · paused') + '</span>';
    else if (!o.open) action = '<span class="muted small">Paused for now</span>';
    else if (refAskedRecently(o)) action = '<span class="muted small">' + ico('check') + ' Asked ' + new Date(o.myAsk).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' · <a href="#/dm/' + u + '">Open chat</a></span>';
    else action = '<button class="btn tiny primary" data-act="ref-ask" data-id="' + id + '"' + (refs.asking === id ? ' aria-expanded="true"' : '') + '>' + ico('chat') + 'Ask for a referral</button>';
    return '<article class="card job ref' + (o.open ? '' : ' paused') + '"><div class="row between job-top"><h3>' + esc(o.company) + '</h3>' +
      (opts.length ? '<details class="msg-menu"><summary aria-label="Offer options">' + ico('more') + '</summary><div class="menu">' + opts.join('') + '</div></details>' : '') + '</div>' +
      '<p class="meta"><span class="ref-kind ' + esc(o.kind) + '">' + (REF_KIND[o.kind] || '') + '</span>' + (o.roles ? ' · ' + esc(o.roles) : '') + '</p>' +
      (o.note ? '<p class="snippet">“' + esc(o.note) + '”</p>' : '') +
      '<div class="row between job-foot"><span class="muted small">Listed by <a class="plain-link" href="#/u/' + u + '"><b>' + esc(o.name) + '</b></a> · ' + ago(o.t) +
      (o.asks ? ' · asked ' + o.asks + (o.asks === 1 ? ' time' : ' times') + ' this month' : '') + '</span>' + action + '</div>' +
      (refs.asking === id && !o.own && o.open && !refAskedRecently(o) ? refAskForm(o) : '') + '</article>';
  }
  function refMatches() {
    var q = refs.q.trim().toLowerCase();
    return (refs.list || []).filter(function (o) {
      if (o.own) return false;
      if (refs.kind !== 'all' && o.kind !== refs.kind) return false;
      return !q || (o.company + ' ' + o.roles + ' ' + o.note).toLowerCase().indexOf(q) > -1;
    });
  }
  function refsHtml() {
    if (refs.error && !refs.list) return '<p class="card muted">' + esc(refs.error) + '</p>';
    if (!refs.list) return '<p class="muted">Loading the referral board…</p>';
    var list = refMatches();
    if (!list.length) {
      return '<p class="card muted">' + (refs.list.some(function (o) { return !o.own; })
        ? 'No offers match that. Try another company or clear the search.'
        : 'No offers yet. If you work somewhere, or still know people at an old company, be the first to offer help.') + '</p>';
    }
    return '<div class="jobs-list">' + list.map(refCard).join('') + '</div>';
  }
  function refMineHtml() {
    var mine = (refs.list || []).filter(function (o) { return o.own; });
    if (!mine.length) return '';
    return '<section class="card stack ref-mine"><h3>Your offers</h3><ul class="ref-mine-list">' + mine.map(function (o) {
      var id = Number(o.id);
      return '<li><span class="grow"><b>' + esc(o.company) + '</b> <span class="muted small">' + (REF_KIND[o.kind] || '') + (o.open ? '' : ' · paused') +
        (o.asks ? ' · ' + o.asks + ' asked this month' : '') + '</span></span>' +
        '<button type="button" class="btn tiny ghost" data-act="ref-open" data-id="' + id + '" data-open="' + (o.open ? 0 : 1) + '">' + (o.open ? 'Pause' : 'Resume') + '</button>' +
        '<button type="button" class="link" data-act="ref-del" data-id="' + id + '">Remove</button></li>';
    }).join('') + '</ul><p class="muted small">Requests arrive in your Chat messages. Pause an offer any time you need a break.</p></section>';
  }
  function refControls() {
    var chip = function (k, label) {
      return '<button type="button" class="chip' + (refs.kind === k ? ' on' : '') + '" data-act="ref-kind" data-k="' + k + '" aria-pressed="' + (refs.kind === k) + '">' + label + '</button>';
    };
    return '<div class="row ref-tools"><input class="grow" type="search" id="refq" placeholder="Search a company or role" aria-label="Search referral offers" value="' + esc(refs.q) + '">' +
      '<div class="chips" role="group" aria-label="Kind of help">' + chip('all', 'All') + chip('refer', 'Can refer') + chip('contact', 'Knows people') + '</div></div>';
  }
  function refsPane() {
    return '<p class="banner">' + ico('users') + '<span><b>Referral board.</b> Members list companies where they can refer you or know people. Ask for one company at a time, only for roles you fit, and say thank you either way.</span></p>' +
      '<details class="card share-lead share-ref"><summary><b>Offer to refer</b> <span class="muted small">Work somewhere, or know people at a company? Help someone get noticed.</span></summary>' +
      '<form class="stack lead-form" data-form="refoffer">' +
      '<div class="grid2 tight"><label>Company<input type="text" name="company" maxlength="60" required placeholder="e.g. Freshworks"></label>' +
      '<label>Roles or teams <span class="muted">(optional)</span><input type="text" name="roles" maxlength="120" placeholder="e.g. Support and sales roles in Chennai"></label></div>' +
      '<fieldset class="ref-kinds"><legend class="small"><b>How can you help?</b></legend>' +
      '<label class="row small"><input type="radio" name="kind" value="refer" checked> I work there and can refer people</label>' +
      '<label class="row small"><input type="radio" name="kind" value="contact"> I know people there and can share tips or connect people</label></fieldset>' +
      '<label>Note <span class="muted">(optional)</span><input type="text" name="note" maxlength="280" placeholder="e.g. Send the job link and your resume. Freshers welcome."></label>' +
      '<p class="muted small">You choose who to refer. Requests come to your messages, and you can pause or remove your offer any time.</p>' +
      '<div class="row"><button class="btn primary">List my offer</button></div></form></details>' +
      '<div id="refmine">' + refMineHtml() + '</div>' +
      refControls() +
      '<p class="scam">' + ico('shield') + '<span>Referrals on The Bench are always free. Nobody should ask you for money, OTPs or bank details for a referral. Report anyone who does.</span></p>' +
      '<div id="reflist">' + refsHtml() + '</div>';
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
  function nextQ() { pickQ(); }
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
    loadAlerts();
    loadBuddy();
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
    'install-app': function () {
      if (install.prompt) {
        var p = install.prompt;
        p.prompt();
        p.userChoice.then(function (c) { if (c && c.outcome === 'accepted') toast('Installing…'); install.prompt = null; updateInstallUi(); }).catch(function () {});
      } else if (install.ios) {
        showIosInstallHelp();
      }
      return false;
    },
    'install-dismiss': function () {
      try { localStorage.setItem('bench:install-dismissed', '1'); } catch (e) { /* storage blocked */ }
      updateInstallUi();
      return false;
    },
    'cv-template': function (d) { S.cv.template = d.t; save(); refreshCv(true); return false; },
    'cv-add': function (d) {
      var blank = {};
      CV_ITEM[d.k].forEach(function (f) { blank[f] = ''; });
      S.cv[d.k].push(blank);
      save();
      refreshCv(true);
      var first = document.getElementById('cv-' + d.k + '-' + (S.cv[d.k].length - 1) + '-' + CV_ITEM[d.k][0]);
      if (first) first.focus();
      return false;
    },
    'cv-del': function (d) {
      var i = Number(d.i), item = S.cv[d.k][i];
      var filled = item && Object.keys(item).some(function (k) { return item[k]; });
      if (filled && !window.confirm('Remove this entry?')) return false;
      S.cv[d.k].splice(i, 1);
      save();
      refreshCv(true);
      return false;
    },
    'cv-move': function (d) {
      var i = Number(d.i), list = S.cv[d.k];
      if (i < 1) return false;
      var t = list[i - 1]; list[i - 1] = list[i]; list[i] = t;
      save();
      refreshCv(true);
      return false;
    },
    'cv-print': function () { window.print(); return false; },
    'learn-field': function (d) { learn.field = d.f; refreshLearn(true); return false; },
    'learn-set': function (d) {
      if (S.learn[d.id] === d.s) delete S.learn[d.id]; else S.learn[d.id] = d.s;
      save();
      refreshLearn(true);
      if (d.s === 'done' && S.learn[d.id] === 'done') toast('Nice one. That is something real to put on your resume.');
      return false;
    },
    'learn-to-cv': function () {
      (S.cv ? Promise.resolve() : ensureCv()).then(function () {
        var have = cvLines(S.cv.certs).map(function (x) { return x.toLowerCase(); });
        var add = COURSES.filter(function (c) { return S.learn[c.id] === 'done'; }).map(function (c) { return c.title + ' (' + c.by + ')'; })
          .filter(function (line) { return have.indexOf(line.toLowerCase()) === -1; });
        if (!add.length) { toast('Your finished courses are already on your resume.'); return; }
        S.cv.certs = cvLines(S.cv.certs).concat(add).join('\n');
        save();
        toast('Added ' + add.length + ' course' + (add.length > 1 ? 's' : '') + ' to Certifications on your resume.');
      });
      return false;
    },
    'cl-tone': function (d) { S.cl.tone = d.t; save(); refreshCl(true); return false; },
    'cl-edit': function () {
      S.cl.custom = clGenerated();
      save();
      refreshCl(true);
      var box = document.getElementById('cl-custom');
      if (box) box.focus();
      return false;
    },
    'cl-reset': function () {
      if (!window.confirm('Go back to the letter built from the form? Your own edits to the wording will be lost.')) return false;
      S.cl.custom = '';
      save();
      refreshCl(true);
      return false;
    },
    'cl-print': function () { window.print(); return false; },
    'cl-copy': function () {
      var text = clText();
      var done = function () { toast('Letter copied. Paste it into the application or an email.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { toast('Could not copy. Select the text in the preview instead.'); });
      } else {
        toast('Copying is blocked here. Select the text in the preview instead.');
      }
      return false;
    },
    'cv-check': function () {
      S.resume = cvText();
      ui.report = analyze(S.resume);
      save();
      location.hash = '#/prep';
      toast('Your resume is in the checker. Scroll down for the score and tips.');
      return false;
    },
    'people-buddy': function () {
      prof.buddyOnly = !prof.buddyOnly;
      render();
      return false;
    },
    'buddy-ask': function (d) {
      var note = window.prompt('Ask ' + d.n + ' to be your accountability buddy.\nAdd a short note? (optional, e.g. what you are working towards)', '');
      if (note === null) return false;
      buddyCall('POST', '/api/buddy/requests', { username: d.u, note: note }, 'Request sent to ' + d.n + '.').then(function () {
        if (currentView() === 'profile') loadProfile();
      });
      return false;
    },
    'buddy-accept': function (d) { buddyCall('POST', '/api/buddy/requests/' + Number(d.id) + '/accept', {}, 'You are buddies now! Check in below. 🎉'); return false; },
    'buddy-decline': function (d) { buddyCall('POST', '/api/buddy/requests/' + Number(d.id) + '/decline', {}, 'Request declined.'); return false; },
    'buddy-cancel': function (d) { buddyCall('DELETE', '/api/buddy/requests/' + Number(d.id), null, 'Request cancelled.').then(loadSuggestions); return false; },
    'buddy-done': function () {
      var p = buddy.state && buddy.state.pair;
      if (!p) return false;
      buddyCall('PUT', '/api/buddy/checkin', { done: !p.me.done }, p.me.done ? '' : 'Nice work! Your buddy will see it. 🎉').then(function () { if (!p.me.done) confetti(); });
      return false;
    },
    'buddy-edit': function () { buddy.editing = !buddy.editing; renderBuddy(); return false; },
    'buddy-cheer': function (d) { buddyCall('POST', '/api/buddy/cheer', { emoji: d.e }, 'Cheer sent ' + d.e); return false; },
    'buddy-nudge': function () { buddyCall('POST', '/api/buddy/nudge', {}, 'Nudge sent 👋'); return false; },
    'buddy-end': function (d) {
      var p = buddy.state && buddy.state.pair;
      if (!p || !window.confirm('End your buddy pairing with ' + p.buddy.name + '?\n\nThey will be told the pairing ended. You can find a new buddy straight after.')) return false;
      buddyCall('POST', '/api/buddy/end', {}, 'Pairing ended.').then(function () {
        if (d.find) buddyCall('PUT', '/api/buddy/prefs', { seeking: true, goal: (buddy.state && buddy.state.prefs.goal) || '' });
        loadSuggestions();
      });
      return false;
    },
    'save-alert': function () {
      api('POST', '/api/alerts', { what: jobs.what, where: jobs.where, remote: jobs.remote, field: jobs.field }).then(function (j) {
        toast('Alert saved: ' + j.alert.name + '. New matches will show up here and on Home.');
        loadAlerts();
      }).catch(function (e) { if (e.status === 401) fail(e); else toast(e.message); });
      return false;
    },
    'alert-open': function (d) {
      var a = find(alerts.list || [], Number(d.id));
      if (!a) return false;
      jobs.what = a.what; jobs.where = a.where; jobs.remote = a.remote; jobs.field = a.field;
      jobs.newSince = a.lastSeen; jobs.activeAlert = a.id; // mark jobs that arrived since the last look
      alerts.totalNew = Math.max(0, alerts.totalNew - a.newCount);
      a.newCount = 0; a.lastSeen = Date.now();
      jobs.tab = 'employers';
      updateJobsBadge();
      render();
      loadJobs(false);
      api('POST', '/api/alerts/' + a.id + '/seen', {}).catch(function () { /* counts catch up on the next load */ });
      return false;
    },
    'alert-del': function (d) {
      var a = find(alerts.list || [], Number(d.id));
      if (!a || !window.confirm('Delete the alert "' + a.name + '"?')) return false;
      api('DELETE', '/api/alerts/' + a.id).then(function () {
        if (jobs.activeAlert === a.id) { jobs.activeAlert = null; jobs.newSince = 0; }
        toast('Alert deleted.');
        loadAlerts();
      }).catch(fail);
      return false;
    },
    'alert-notify': function () {
      if (notifyOn()) {
        try { localStorage.removeItem('bench:notify'); } catch (e) { /* storage blocked */ }
        toast('Desktop notifications are off.');
        renderAlertsStrip();
        return false;
      }
      if (!window.Notification) { toast('This browser does not support notifications.'); return false; }
      Notification.requestPermission().then(function (p) {
        if (p === 'granted') {
          try { localStorage.setItem('bench:notify', '1'); } catch (e) { /* storage blocked */ }
          toast('Done. You will get a desktop notification when new matches arrive while The Bench is open.');
        } else {
          toast('Notifications are blocked for this site. You can allow them in your browser settings.');
        }
        renderAlertsStrip();
      });
      return false;
    },
    'jobs-field': function (d) {
      jobs.field = d.f || '';
      jobs.newSince = 0; jobs.activeAlert = null;
      loadJobs(false);
      return false;
    },
    'jobs-tab': function (d) {
      jobs.tab = d.t === 'leads' || d.t === 'refs' ? d.t : 'employers';
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
    'ref-ask': function (d) {
      var id = Number(d.id);
      refs.asking = refs.asking === id ? null : id;
      var el = document.getElementById('reflist'); if (el) el.innerHTML = refsHtml();
      var box = document.querySelector('form.ref-ask input[name="role"]');
      if (box) box.focus();
      return false;
    },
    'ref-cancel': function () {
      refs.asking = null;
      var el = document.getElementById('reflist'); if (el) el.innerHTML = refsHtml();
      return false;
    },
    'ref-kind': function (d) {
      refs.kind = d.k;
      document.querySelectorAll('[data-act="ref-kind"]').forEach(function (b) { var on = b.dataset.k === d.k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      var el = document.getElementById('reflist'); if (el) el.innerHTML = refsHtml();
      return false;
    },
    'ref-open': function (d) {
      api('POST', '/api/referrals/' + Number(d.id) + '/open', { open: d.open === '1' })
        .then(function () { toast(d.open === '1' ? 'Your offer is open again.' : 'Paused. Nobody can ask until you resume.'); return loadRefs(); }).catch(fail);
      return false;
    },
    'ref-del': function (d) {
      closeMenus();
      if (!window.confirm('Remove this referral offer?')) return false;
      api('DELETE', '/api/referrals/' + Number(d.id)).then(function () { toast('Offer removed.'); return loadRefs(); }).catch(fail);
      return false;
    },
    'ref-report': function (d) {
      closeMenus();
      var reason = window.prompt('Report this referral offer to the moderators.\nWhat is wrong with it? (optional)', '');
      if (reason === null) return false;
      api('POST', '/api/referrals/' + Number(d.id) + '/report', { reason: reason })
        .then(function () { toast('Reported. Thanks for looking out for everyone.'); }).catch(fail);
      return false;
    },
    'open-refs': function (d) {
      jobs.tab = 'refs';
      refs.q = d.q || '';
      if (currentView() === 'jobs') render(); else location.hash = '#/jobs';
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
      if (i >= 0 && i < STAGES.length) {
        a.stage = STAGES[i];
        onStage(a);
        if (a.stage === 'Interview' && !isDay(a.interview)) setTimeout(function () { openAppEditor(a); }, 0);
      }
    },
    'app-edit': function (d) { var a = find(S.apps, d.id); if (a) openAppEditor(a); return false; },
    'app-draft': function (d) { var a = find(S.apps, d.id); if (a) openDraft(a); return false; },
    'app-ics': function (d) { var a = find(S.apps, d.id); if (a && isDay(a.interview)) downloadIcs(a); return false; },
    'app-followed': function (d) {
      var a = find(S.apps, d.id); if (!a) return false;
      a.followed = (Number(a.followed) || 0) + 1;
      a.lastFollow = today();
      var sheetEl = document.getElementById('appdraft'); if (sheetEl) sheetEl.close();
      if (a.followed >= MAX_FOLLOWS + (isDay(a.interview) ? 1 : 0)) {
        a.followUp = '';
        toast('Logged. That is ' + a.followed + ' follow-ups, so no more reminders for this one. If there is still no reply, it may be time to move on.');
      } else {
        a.followUp = addDays(today(), FOLLOW_DAYS);
        toast('Logged. We will remind you again on ' + fmtDay(a.followUp) + ' if you have not heard back.');
      }
    },
    'app-snooze': function (d) {
      var a = find(S.apps, d.id); if (!a) return false;
      a.followUp = addDays(today(), 3);
      toast('Snoozed until ' + fmtDay(a.followUp) + '.');
    },
    'sheet-close': function (d, btn) { var dl = btn.closest('dialog'); if (dl) dl.close(); return false; },
    'draft-copy': function () {
      var box = document.getElementById('draftbox');
      if (!box) return false;
      var done = function () { toast('Copied. Paste it into your email or LinkedIn.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(box.value).then(done, function () { box.select(); toast('Select the text and copy it.'); });
      else { box.select(); toast('Select the text and copy it.'); }
      return false;
    },
    'del-app': function (d) {
      S.apps = S.apps.filter(function (a) { return a.id !== d.id; });
    },
    'next-q': function () { nextQ(); render(); return false; },
    'iv-pack': function (d) { iv.pack = d.p; iv.cur = null; pickQ(); render(); return false; },
    rate: function (d) {
      var q = qById(iv.cur);
      if (!q) return false;
      var secs = ui.timerId ? Math.floor((Date.now() - ui.timerStart) / 1000) : iv.secs;
      var entry = { id: q.id, pack: q.pack, q: q.q, r: d.r, t: Date.now() };
      if (typeof secs === 'number') entry.secs = secs;
      S.practice.push(entry);
      if (S.practice.length > 500) S.practice = S.practice.slice(-500);
      // Leaving "Retry my rough ones" empty sends you back to the full list.
      var wasRough = iv.pack === 'rough';
      nextQ();
      if (wasRough && !iv.cur) { iv.pack = 'general'; pickQ(); toast('No rough ones left. Nice work.'); }
      else toast(d.r === 'Rough' ? 'Saved. It will come back in "Retry my rough ones".' : 'Saved. Next question.');
    },
    timer: function (d, btn) {
      var out = document.getElementById('timer');
      var bar = document.getElementById('timerbar');
      if (ui.timerId) { iv.secs = Math.floor((Date.now() - ui.timerStart) / 1000); stopTimer(); btn.textContent = 'Restart timer'; return false; }
      ui.timerStart = Date.now();
      iv.secs = null;
      out.textContent = '0:00';
      out.className = 'timer';
      btn.textContent = 'Stop timer';
      ui.timerId = setInterval(function () {
        var s = Math.floor((Date.now() - ui.timerStart) / 1000);
        out.textContent = fmtSecs(s);
        // Amber from 1:30, red past 2:00.
        out.className = 'timer' + (s >= 120 ? ' over' : s >= 90 ? ' near' : '');
        if (bar) { bar.style.width = Math.min(100, s / 120 * 100) + '%'; bar.className = s >= 120 ? 'over' : s >= 90 ? 'near' : ''; }
      }, 250);
      return false;
    }
  };

  var forms = {
    buddyprefs: function (f) {
      buddyCall('PUT', '/api/buddy/prefs', { seeking: f.get('seeking') === '1', goal: f.get('goal') },
        f.get('seeking') === '1' ? 'Saved. Others looking for a buddy can now find you.' : 'Saved.').then(loadSuggestions);
      return false;
    },
    checkin: function (f, form) {
      var plan = String(f.get('plan') || '').trim();
      if (!plan) return false;
      form.querySelector('button').disabled = true;
      buddy.editing = false;
      buddyCall('PUT', '/api/buddy/checkin', { plan: plan }, 'Checked in. Your buddy can see your plan.');
      return false;
    },
    jobsearch: function (f) {
      jobs.what = String(f.get('what') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      jobs.where = String(f.get('where') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      jobs.remote = f.get('remote') === '1';
      jobs.newSince = 0; jobs.activeAlert = null;
      loadJobs(false);
      return false;
    },
    refoffer: function (f, form) {
      var btn = form.querySelector('button.primary');
      btn.disabled = true;
      api('POST', '/api/referrals', { company: f.get('company'), kind: f.get('kind'), roles: f.get('roles'), note: f.get('note') })
        .then(function () {
          form.reset();
          form.closest('details').open = false;
          toast('Thank you! Your offer is on the board.');
          return loadRefs();
        }).catch(function (e) { if (e.status === 401) fail(e); else toast(e.message); })
        .then(function () { btn.disabled = false; });
      return false;
    },
    refask: function (f, form) {
      var message = String(f.get('message') || '');
      if (/\[[^\]]*\]/.test(message)) { toast('Fill in the part in [brackets] first, in your own words.'); return false; }
      var btn = form.querySelector('button.primary');
      btn.disabled = true;
      api('POST', '/api/referrals/' + Number(form.dataset.id) + '/ask', { role: f.get('role'), url: String(f.get('url') || '').trim(), message: message })
        .then(function (j) {
          refs.asking = null;
          toast('Sent! Your request is in your messages.');
          location.hash = '#/dm/' + encodeURIComponent(j.username);
        }).catch(function (e) { if (e.status === 401) fail(e); else { toast(e.message); btn.disabled = false; } });
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
        me.color = j.profile.color;
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
    appedit: function (f, form) {
      var a = find(S.apps, form.dataset.id); if (!a) return false;
      var day = function (k) { var v = String(f.get(k) || ''); return isDay(v) ? v : ''; };
      var oldInterview = a.interview;
      a.applied = day('applied');
      a.interview = day('interview');
      a.itime = isTime(String(f.get('itime') || '')) ? String(f.get('itime')) : '';
      a.followUp = day('followUp');
      a.contact = String(f.get('contact') || '').trim().slice(0, 100);
      a.note = String(f.get('note') || '').trim().slice(0, 500);
      // A new interview date: check in a few days after it, unless a later reminder is already set.
      if (a.interview && a.interview !== oldInterview && activeStage(a) && (!a.followUp || a.followUp <= a.interview)) a.followUp = addDays(a.interview, AFTER_INTERVIEW_DAYS);
      if (a.interview && a.stage !== 'Interview' && (a.stage === 'Wishlist' || a.stage === 'Applied')) a.stage = 'Interview';
      var dl = form.closest('dialog'); if (dl) dl.close();
      toast('Saved.');
    },
    app: function (f) {
      var title = String(f.get('title')).trim(), company = String(f.get('company')).trim();
      if (!title || !company) return false;
      var stage = STAGES.indexOf(f.get('stage')) > -1 ? f.get('stage') : 'Wishlist';
      var added = { id: uid(), title: title, company: company, stage: stage, t: Date.now() };
      onStage(added);
      S.apps.push(added);
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
    es.onmessage = function (e) {
      var ev;
      try { ev = JSON.parse(e.data); } catch (err) { return; /* ignore a bad event */ }
      if (ev && ev.type === 'jobs-updated') return loadAlerts();
      if (ev && ev.type === 'buddy') return onBuddyEvent(ev);
      onChatEvent(ev);
    };
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
    var canAsk = !j.me && j.buddy && j.buddy.seeking && !j.buddy.paired && !j.blockedByMe;
    if (j.buddy && j.buddy.seeking && !j.buddy.paired) meta.push('<span class="buddy-tag">' + ico('users') + ' Looking for a buddy</span>');
    var actions = j.me
      ? '<a class="btn primary" href="#/edit-profile">Edit profile</a>'
      : (canAsk ? '<button class="btn" data-act="buddy-ask" data-u="' + u + '" data-n="' + esc(j.name) + '">' + ico('users') + 'Ask to be buddies</button>' : '') +
        '<a class="btn primary" href="#/dm/' + u + '">' + ico('chat') + 'Message</a>' +
        '<button class="btn ghost" data-act="' + (j.blockedByMe ? 'unblock' : 'block') + '" data-u="' + u + '">' + (j.blockedByMe ? 'Unblock' : 'Block') + '</button>';
    var about = p.bio
      ? '<p class="bio">' + esc(p.bio) + '</p>'
      : '<p class="muted">' + (j.me ? 'Nothing here yet. <a href="#/edit-profile">Write a line or two about yourself.</a>' : 'Nothing here yet.') + '</p>';
    var skills = p.skills.length ? '<div class="row skills">' + p.skills.map(function (s) { return '<span class="pill">' + esc(s) + '</span>'; }).join('') + '</div>' : '';
    var refHelp = j.referrals && j.referrals.length
      ? '<div class="stack ref-profile"><p class="small"><b>' + ico('users') + ' Can help with referrals at</b></p><div class="row skills">' + j.referrals.map(function (r) {
        return '<button type="button" class="pill ref-pill" data-act="open-refs" data-q="' + esc(r.company) + '">' + esc(r.company) + (r.kind === 'contact' ? ' <span class="muted">(knows people)</span>' : '') + '</button>';
      }).join('') + '</div></div>' : '';
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
      '<div class="grid2"><section class="card stack"><h3>About</h3>' + about + skills + link + refHelp + '</section>' +
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
      if (prof.buddyOnly && !p.seeking) return false;
      return !q || [p.name, p.username, p.headline, p.location, p.skills.join(' ')].join(' ').toLowerCase().indexOf(q) > -1;
    });
    if (!list.length) return '<p class="muted">Nobody matches that yet.</p>';
    return list.map(function (p) {
      return '<a class="person card" href="#/u/' + esc(p.username) + '">' + avatarHtml(p.name, p.color, 'lg') +
        '<span class="person-text"><b>' + esc(p.name) + (p.me ? ' <span class="muted">(you)</span>' : '') + '</b>' +
        '<span class="muted small">@' + esc(p.username) + (p.location ? ' · ' + esc(p.location) : '') + '</span>' +
        (p.headline ? '<span class="person-role">' + esc(p.headline) + '</span>' : '') +
        statusLabel(p.status) + (p.seeking ? '<span class="buddy-tag">' + ico('users') + ' Looking for a buddy</span>' : '') + '</span></a>';
    }).join('');
  }

  // ---------- accountability buddy ----------
  var BUDDY_CHEERS = ['🙌', '💪', '🔥', '👏'];
  var QUIET_DAYS = 5;
  var buddy = { state: null, suggestions: null, editing: false };

  function loadBuddy() {
    if (!me) return Promise.resolve();
    return api('GET', '/api/buddy').then(function (j) {
      buddy.state = j;
      if (j.pair && j.pair.me.plan) buddy.editing = false;
      renderBuddy();
      updateHomeBuddy();
    }).catch(function (e) { if (e.status === 401) fail(e); });
  }
  function loadSuggestions() {
    api('GET', '/api/buddy/suggestions').then(function (j) {
      buddy.suggestions = Array.isArray(j.suggestions) ? j.suggestions : [];
      renderBuddy();
    }).catch(fail);
  }
  function renderBuddy() { if (currentView() === 'buddy') renderSection('buddybody', buddyHtml()); }
  function buddyCall(method, url, body, okMsg) {
    return api(method, url, body).then(function (j) {
      if (j && j.today) { buddy.state = j; renderBuddy(); updateHomeBuddy(); }
      if (okMsg) toast(okMsg);
      return j;
    }).catch(function (e) { if (e.status === 401) fail(e); else toast(e.message); });
  }
  function dayLetter(day) { return new Date(day + 'T12:00:00').toLocaleDateString([], { weekday: 'narrow' }); }
  function weekRow(label, days) {
    return '<div class="bweek"><span class="bweek-label">' + esc(label) + '</span>' + days.map(function (d) {
      var cls = d.done ? 'done' : d.planned ? 'planned' : '';
      return '<span class="bday ' + cls + '" title="' + esc(d.day) + (d.done ? ': done' : d.planned ? ': checked in' : ': no check-in') + '"><i></i>' + esc(dayLetter(d.day)) + '</span>';
    }).join('') + '</div>';
  }

  function buddyHtml() {
    var st = buddy.state;
    if (!st) return '<p class="muted">Loading…</p>';
    return st.pair ? pairedHtml(st) : soloHtml(st);
  }

  function soloHtml(st) {
    var prefs = '<form class="card stack narrow" data-form="buddyprefs">' +
      '<label class="check big-check"><input type="checkbox" name="seeking" value="1"' + (st.prefs.seeking ? ' checked' : '') + '> I\'m looking for an accountability buddy</label>' +
      '<label class="field-label">What are you working towards? <span class="muted">(optional)</span>' +
      '<input type="text" id="bgoal" name="goal" maxlength="120" placeholder="e.g. 2 applications a day, landing a support role in Chennai" value="' + esc(st.prefs.goal) + '"></label>' +
      '<p class="muted small">When this is on, other members can find you and send you a request. You can only have one buddy at a time.</p>' +
      '<div class="row"><button class="btn primary">Save</button></div></form>';
    var incoming = st.incoming.length ? '<section class="stack"><h3>Buddy requests for you</h3>' + st.incoming.map(function (r) {
      return '<article class="card buddy-req"><div class="row between"><span><a class="plain-link" href="#/u/' + esc(r.username) + '"><b>' + esc(r.name) + '</b></a> <span class="muted small">@' + esc(r.username) + ' · ' + ago(r.t) + '</span></span>' +
        '<span class="row"><button class="btn tiny ghost" data-act="buddy-decline" data-id="' + Number(r.id) + '">Not now</button>' +
        '<button class="btn tiny primary" data-act="buddy-accept" data-id="' + Number(r.id) + '">Accept</button></span></div>' +
        (r.note ? '<p class="snippet">“' + esc(r.note) + '”</p>' : '') + '</article>';
    }).join('') + '</section>' : '';
    var outgoing = st.outgoing.length ? '<section class="stack"><h3>Waiting to hear back</h3>' + st.outgoing.map(function (r) {
      return '<div class="row between card buddy-req"><span>You asked <a class="plain-link" href="#/u/' + esc(r.username) + '"><b>' + esc(r.name) + '</b></a> <span class="muted small">' + ago(r.t) + '</span></span>' +
        '<button class="link" data-act="buddy-cancel" data-id="' + Number(r.id) + '">Cancel request</button></div>';
    }).join('') + '</section>' : '';
    var sugg = buddy.suggestions === null ? '<p class="muted">Finding people…</p>'
      : buddy.suggestions.length ? '<div class="people-grid">' + buddy.suggestions.map(function (p) {
          var asked = st.outgoing.some(function (r) { return r.username === p.username; });
          return '<article class="card person buddy-person">' + avatarHtml(p.name, p.color, 'lg') + '<span class="person-text">' +
            '<a class="plain-link" href="#/u/' + esc(p.username) + '"><b>' + esc(p.name) + '</b></a>' +
            '<span class="muted small">@' + esc(p.username) + (p.location ? ' · ' + esc(p.location) : '') + '</span>' +
            (p.headline ? '<span class="person-role">' + esc(p.headline) + '</span>' : '') +
            (p.goal ? '<span class="small">Working towards: ' + esc(p.goal) + '</span>' : '') +
            '<span class="row" style="margin-top:8px">' + (asked ? '<span class="muted small">Request sent</span>'
              : '<button class="btn tiny primary" data-act="buddy-ask" data-u="' + esc(p.username) + '" data-n="' + esc(p.name) + '">Ask to be buddies</button>') +
            '</span></span></article>';
        }).join('') + '</div>'
      : '<p class="card muted">Nobody else is looking for a buddy right now. Turn on “I\'m looking” above so others can find you, and check back soon.</p>';
    return '<section class="card buddy-intro"><h2>' + ico('users') + ' How it works</h2><ol class="steps">' +
      '<li><b>Pair up</b> with one person who is also job hunting.</li>' +
      '<li><b>Each morning</b>, write one line about today\'s plan. Tick it off when it is done.</li>' +
      '<li><b>See each other\'s day</b>, cheer each other on, and nudge if someone goes quiet.</li></ol>' +
      '<p class="muted small">Your plans are only visible to your buddy. Either of you can end the pairing at any time.</p></section>' +
      incoming + prefs + outgoing +
      '<section class="stack"><h3>People looking for a buddy</h3>' + sugg + '</section>';
  }

  function pairedHtml(st) {
    var p = st.pair, b = p.buddy, u = esc(b.username);
    var quiet = p.silentDays >= QUIET_DAYS
      ? '<p class="banner">' + ico('bell') + '<span><b>' + esc(b.name) + ' has not checked in for ' + p.silentDays + ' days.</b> Life happens. Send a nudge, or <button class="link big" data-act="buddy-end" data-find="1">find a new buddy</button>.</span></p>' : '';
    var mine = p.me.plan && !buddy.editing
      ? '<p class="plan">' + esc(p.me.plan) + '</p>' +
        '<div class="row"><button class="btn ' + (p.me.done ? 'ghost done-btn' : 'primary') + '" data-act="buddy-done">' + (p.me.done ? ico('check') + 'Done. Nice work!' : 'Mark as done') + '</button>' +
        '<button class="link" data-act="buddy-edit">Edit plan</button></div>'
      : '<form class="stack" data-form="checkin"><input type="text" id="bplan" name="plan" maxlength="140" required placeholder="e.g. Apply to 2 jobs and finish SQL chapter 4" value="' + esc(p.me.plan) + '">' +
        '<div class="row"><button class="btn primary">' + (p.me.plan ? 'Save plan' : 'Check in') + '</button>' + (p.me.plan ? '<button type="button" class="link" data-act="buddy-edit">Cancel</button>' : '') + '</div></form>';
    var gotCheer = p.me.cheer ? '<p class="cheer-note">' + esc(b.name) + ' cheered you on ' + esc(p.me.cheer) + '</p>' : '';
    var gotNudge = p.nudgedMe && !p.me.plan ? '<p class="cheer-note">' + esc(b.name) + ' nudged you to check in 👋</p>' : '';
    var theirs = p.them.plan
      ? '<p class="plan">' + esc(p.them.plan) + '</p><p class="small ' + (p.them.done ? 'win-text' : 'muted') + '">' + (p.them.done ? ico('check') + ' Done for today' : 'In progress') + '</p>' +
        '<div class="row cheers">' + BUDDY_CHEERS.map(function (e) {
          return '<button class="react' + (p.them.cheer === e ? ' on' : '') + '" data-act="buddy-cheer" data-e="' + e + '" aria-label="Cheer with ' + e + '">' + e + '</button>';
        }).join('') + '</div>'
      : '<p class="muted">Has not checked in yet today.</p>' +
        (p.nudgedThem ? '<p class="muted small">' + ico('check') + ' Nudged</p>' : '<button class="btn ghost" data-act="buddy-nudge">👋 Nudge ' + esc(b.name) + '</button>');
    return '<header class="buddy-head">' + avatarHtml(b.name, b.color, 'xl') +
      '<div class="grow"><p class="muted small">Your accountability buddy</p><h2 class="buddy-name"><a class="plain-link" href="#/u/' + u + '">' + esc(b.name) + '</a></h2>' +
      (b.headline ? '<p class="person-role">' + esc(b.headline) + '</p>' : '') +
      (b.goal ? '<p class="small">Working towards: ' + esc(b.goal) + '</p>' : '') +
      '<p class="muted small">Buddies since ' + new Date(p.since).toLocaleDateString([], { day: 'numeric', month: 'long' }) + '</p></div>' +
      '<div class="streak-box"><b>' + p.streak + '</b><span>' + ico('flame') + 'day streak <br>together</span></div></header>' +
      quiet +
      '<div class="grid2"><section class="card stack"><h3>Your day</h3>' + gotNudge + mine + gotCheer + '</section>' +
      '<section class="card stack"><h3>' + esc(b.name) + '\'s day</h3>' + theirs + '</section></div>' +
      '<section class="card stack"><h3>This week</h3>' + weekRow('You', p.myWeek) + weekRow(b.name, p.theirWeek) +
      '<p class="muted small"><span class="bday planned inline"><i></i></span> checked in &nbsp; <span class="bday done inline"><i></i></span> done. The streak grows on days you both check in.</p></section>' +
      '<p class="small muted buddy-foot"><a href="#/dm/' + u + '">Message ' + esc(b.name) + '</a> · <button class="link" data-act="buddy-end">End buddy pairing</button></p>';
  }

  // Home: a small card or nudge, depending on where you are.
  function homeBuddyHtml() {
    var st = buddy.state;
    if (!st) return '<div id="homebuddy"></div>';
    if (st.pair) {
      var p = st.pair;
      return '<section class="card home-buddy" id="homebuddy"><div class="row between"><h3>' + ico('users') + ' You &amp; ' + esc(p.buddy.name) + '</h3><a class="btn tiny ghost" href="#/buddy">Open</a></div>' +
        '<div class="row between hb-row"><span>' + (p.me.plan ? (p.me.done ? ico('check') + ' You finished today\'s plan' : 'Your plan: ' + esc(p.me.plan)) : '<b>You have not checked in today.</b> <a href="#/buddy">Check in</a>') + '</span></div>' +
        '<div class="row between hb-row"><span class="muted">' + esc(p.buddy.name) + ': ' + (p.them.plan ? (p.them.done ? 'done for today' : 'checked in') : 'not checked in yet') + '</span>' +
        '<span class="small"><b>' + p.streak + '</b> day streak</span></div></section>';
    }
    if (st.incoming.length) {
      var r = st.incoming[0];
      return '<p class="banner" id="homebuddy">' + ico('users') + '<span><b>' + esc(r.name) + '</b> wants to be your accountability buddy. <a href="#/buddy">See request</a></span></p>';
    }
    if (!st.prefs.seeking && !st.outgoing.length) {
      return '<p class="banner" id="homebuddy">' + ico('users') + '<span>Stay on track with an <b>accountability buddy</b>: one person, one line a day. <a href="#/buddy">Find one</a></span></p>';
    }
    return '<div id="homebuddy"></div>';
  }
  function updateHomeBuddy() {
    if (currentView() !== 'home') return;
    var el = document.getElementById('homebuddy');
    if (el) el.outerHTML = homeBuddyHtml();
  }

  var BUDDY_TOASTS = {
    request: function (n) { return n + ' wants to be your accountability buddy.'; },
    accepted: function (n) { return n + ' accepted. You are buddies now! 🎉'; },
    declined: function (n) { return n + ' cannot be your buddy right now. Try someone else.'; },
    done: function (n) { return n + ' finished today\'s plan 🎉'; },
    cheer: function (n) { return n + ' cheered you on!'; },
    nudge: function (n) { return n + ' nudged you to check in 👋'; },
    ended: function () { return 'Your buddy pairing has ended.'; }
  };
  function onBuddyEvent(ev) {
    if (BUDDY_TOASTS[ev.kind]) toast(BUDDY_TOASTS[ev.kind](ev.from || 'Your buddy'));
    loadBuddy();
    if (currentView() === 'buddy' && (ev.kind === 'ended' || ev.kind === 'declined')) loadSuggestions();
  }

  // ---------- you: account bar (Home) and sidebar chip ----------
  function accountBar() {
    var u = esc(me.username);
    var link = function (href, icon, label) { return '<a class="ql" href="' + href + '">' + ico(icon) + '<span>' + label + '</span></a>'; };
    return '<nav class="account-bar card" aria-label="You">' +
      '<a class="ab-me" href="#/u/' + u + '">' + avatarHtml(me.name, me.color, 'lg') +
      '<span><b>' + esc(me.name) + '</b><small>@' + u + ' · View your profile</small></span></a>' +
      '<div class="ab-links">' + link('#/people', 'users', 'People') + link('#/buddy', 'buddy', 'Buddy') + link('#/account', 'settings', 'Account') +
      (canInstall() ? '<button type="button" class="ql" data-act="install-app">' + ico('phone') + '<span>Install app</span></button>' : '') +
      '<a class="ql" href="#/resume">' + ico('feed') + '<span>Resume</span></a>' +
      '<a class="ql" href="#/cover">' + ico('mail') + '<span>Cover letter</span></a>' +
      '<a class="ql" href="#/learn">' + ico('book') + '<span>Learn</span></a>' +
      '<button type="button" class="ql ql-out" data-act="logout">' + ico('logout') + '<span>Log out</span></button></div></nav>';
  }
  function updateMeChip() {
    var el = document.getElementById('mechip');
    if (!el) return;
    if (!me || ui.newCode) { el.hidden = true; return; }
    el.hidden = false;
    el.href = '#/u/' + me.username;
    el.classList.toggle('on', currentView() === 'profile' && profileRoute() === me.username);
    el.innerHTML = avatarHtml(me.name, me.color, '') + '<span class="mc-text"><b>' + esc(me.name) + '</b><small>@' + esc(me.username) + '</small></span>' + ico('settings');
  }

  // ---------- install as an app ----------
  var install = { prompt: null, standalone: false, ios: false };
  try {
    install.standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    install.ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch (e) { /* old browser */ }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () { /* not essential */ }); });
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); install.prompt = e; updateInstallUi(); });
  window.addEventListener('appinstalled', function () {
    install.prompt = null; install.standalone = true;
    toast('Installed! Open The Bench from your home screen.');
    updateInstallUi();
  });
  function canInstall() { return !install.standalone && (!!install.prompt || install.ios); }
  function installDismissed() { try { return localStorage.getItem('bench:install-dismissed') === '1'; } catch (e) { return false; } }
  function installBanner() {
    if (!canInstall() || installDismissed()) return '<span id="installbanner" hidden></span>';
    return '<p class="banner" id="installbanner">' + ico('phone') + '<span><b>Get The Bench on your phone.</b> Install it like an app: its own icon, full screen and quicker to open. ' +
      '<button class="link big" data-act="install-app">Install</button> · <button class="link" data-act="install-dismiss">Not now</button></span></p>';
  }
  function updateInstallUi() {
    if (currentView() !== 'home') return;
    var b = document.getElementById('installbanner');
    if (b) b.outerHTML = installBanner();
    var bar = document.querySelector('.account-bar');
    if (bar) bar.outerHTML = accountBar();
  }
  function showIosInstallHelp() {
    var d = document.getElementById('iosinstall');
    if (!d) {
      document.body.insertAdjacentHTML('beforeend', '<dialog id="iosinstall" class="sheet"><h2>' + ico('phone') + ' Add to your Home Screen</h2>' +
        '<ol class="steps"><li>Open The Bench in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow pointing up).</li>' +
        '<li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>' +
        '<p class="muted small">The Bench then opens full screen from its own icon, like any other app.</p>' +
        '<form method="dialog"><button class="btn primary">Got it</button></form></dialog>');
      d = document.getElementById('iosinstall');
    }
    if (d.showModal) d.showModal(); else toast('In Safari: tap Share, then "Add to Home Screen".');
  }

  // ---------- resume builder ----------
  // Stored privately with the rest of your data (S.cv). The preview is plain HTML; "Download PDF" uses the
  // browser's print dialog ("Save as PDF"), with print styles that show only the resume page.
  var CV_TEMPLATES = [['classic', 'Classic'], ['modern', 'Modern'], ['compact', 'Compact']];
  var CV_ITEM = { experience: ['role', 'company', 'place', 'start', 'end', 'bullets'], education: ['degree', 'school', 'year', 'details'], projects: ['name', 'link', 'description'] };
  function blankCv() {
    return { template: 'classic', name: '', headline: '', email: '', phone: '', city: '', links: '', summary: '', experience: [], education: [], skills: '', projects: [], certs: '', languages: '' };
  }
  function cleanCv(raw) {
    if (!isObj(raw)) return null;
    var b = blankCv();
    Object.keys(b).forEach(function (k) {
      if (CV_ITEM[k]) {
        b[k] = (Array.isArray(raw[k]) ? raw[k] : []).filter(isObj).slice(0, 15).map(function (it) {
          var o = {};
          CV_ITEM[k].forEach(function (f) { o[f] = typeof it[f] === 'string' ? it[f].slice(0, 2000) : ''; });
          return o;
        });
      } else if (typeof raw[k] === 'string') b[k] = raw[k].slice(0, 3000);
    });
    if (!CV_TEMPLATES.some(function (t) { return t[0] === b.template; })) b.template = 'classic';
    return b;
  }
  // First visit: start from your profile so there is less to type.
  function ensureCv() {
    if (S.cv) return Promise.resolve();
    S.cv = blankCv();
    S.cv.name = me.name;
    return api('GET', '/api/profile/' + encodeURIComponent(me.username)).then(function (j) {
      var p = j.profile;
      S.cv.headline = p.headline; S.cv.city = p.location; S.cv.skills = p.skills.join(', '); S.cv.links = p.link; S.cv.summary = p.bio;
    }).catch(function () { /* start blank */ }).then(save);
  }
  function getPath(p) {
    var parts = p.split('.'), o = S.cv;
    for (var i = 0; i < parts.length; i++) { if (o == null) return ''; o = o[parts[i]]; }
    return o == null ? '' : String(o);
  }
  function setPath(p, v) {
    var parts = p.split('.'), o = S.cv;
    for (var i = 0; i < parts.length - 1; i++) { o = o[parts[i]]; if (!o) return; }
    o[parts[parts.length - 1]] = v;
  }
  function cvField(path, label, opts) {
    opts = opts || {};
    var v = getPath(path), id = 'cv-' + path.replace(/\./g, '-');
    var attrs = ' id="' + id + '" data-cv="' + path + '" maxlength="' + (opts.max || 200) + '" placeholder="' + esc(opts.ph || '') + '"';
    return '<label class="cvf' + (opts.wide ? ' wide' : '') + '"><span>' + label + (opts.hint ? ' <span class="muted">' + opts.hint + '</span>' : '') + '</span>' +
      (opts.area ? '<textarea' + attrs + ' rows="' + (opts.rows || 3) + '">' + esc(v) + '</textarea>' : '<input type="text"' + attrs + ' value="' + esc(v) + '">') + '</label>';
  }
  function cvEditor() {
    var c = S.cv;
    var tpl = '<div class="chips">' + CV_TEMPLATES.map(function (t) {
      return '<button type="button" class="chip' + (c.template === t[0] ? ' on' : '') + '" data-act="cv-template" data-t="' + t[0] + '" aria-pressed="' + (c.template === t[0]) + '">' + t[1] + '</button>';
    }).join('') + '</div>';
    var list = function (key, title, one, addLabel, fields) {
      return '<section class="cv-sec"><h3>' + title + '</h3>' + c[key].map(function (it, i) {
        return '<div class="cv-item"><div class="row between"><b class="small">' + one + ' ' + (i + 1) + '</b><span class="row">' +
          (i > 0 ? '<button type="button" class="link" data-act="cv-move" data-k="' + key + '" data-i="' + i + '">Move up</button>' : '') +
          '<button type="button" class="link" data-act="cv-del" data-k="' + key + '" data-i="' + i + '">Remove</button></span></div>' +
          '<div class="cv-grid">' + fields(key + '.' + i) + '</div></div>';
      }).join('') + '<button type="button" class="btn tiny ghost" data-act="cv-add" data-k="' + key + '">+ ' + addLabel + '</button></section>';
    };
    return '<div class="card stack cv-editor">' +
      '<section class="cv-sec"><h3>Look</h3>' + tpl + '</section>' +
      '<section class="cv-sec"><h3>About you</h3><div class="cv-grid">' +
        cvField('name', 'Full name', { ph: 'Your name' }) + cvField('headline', 'Headline', { ph: 'e.g. Customer support specialist' }) +
        cvField('email', 'Email', { ph: 'you@example.com' }) + cvField('phone', 'Phone', { ph: '+91 …' }) +
        cvField('city', 'City', { ph: 'e.g. Chennai' }) + cvField('links', 'Links', { ph: 'LinkedIn, portfolio…', hint: '(commas)' }) +
        cvField('summary', 'Summary', { area: 1, wide: 1, rows: 3, max: 600, ph: '2–3 lines: who you are, what you are good at, and the role you want.' }) + '</div></section>' +
      list('experience', 'Experience', 'Job', 'Add a job', function (p) {
        return cvField(p + '.role', 'Job title', { ph: 'e.g. Senior associate' }) + cvField(p + '.company', 'Company') + cvField(p + '.place', 'City') +
          cvField(p + '.start', 'From', { ph: 'e.g. Jun 2022' }) + cvField(p + '.end', 'To', { ph: 'e.g. Aug 2026 or Present' }) +
          cvField(p + '.bullets', 'What you did', { area: 1, wide: 1, rows: 4, max: 1500, hint: '(one point per line; start with a verb, add numbers)', ph: 'Handled 60+ customer chats a day with a 95% satisfaction score' });
      }) +
      list('education', 'Education', 'Course', 'Add education', function (p) {
        return cvField(p + '.degree', 'Degree or course', { ph: 'e.g. B.Com' }) + cvField(p + '.school', 'College or school') +
          cvField(p + '.year', 'Year', { ph: 'e.g. 2021' }) + cvField(p + '.details', 'Details', { ph: 'e.g. 78%, class representative' });
      }) +
      '<section class="cv-sec"><h3>Skills</h3><div class="cv-grid">' + cvField('skills', 'Skills', { area: 1, wide: 1, rows: 2, max: 600, hint: '(separate with commas)', ph: 'Excel, Customer support, Tamil, English' }) + '</div></section>' +
      list('projects', 'Projects', 'Project', 'Add a project', function (p) {
        return cvField(p + '.name', 'Project') + cvField(p + '.link', 'Link', { ph: 'https://…' }) + cvField(p + '.description', 'What it is', { area: 1, wide: 1, rows: 2, max: 600 });
      }) +
      '<section class="cv-sec"><h3>More</h3><div class="cv-grid">' + cvField('certs', 'Certifications', { area: 1, wide: 1, rows: 2, max: 800, hint: '(one per line)' }) +
        cvField('languages', 'Languages', { ph: 'English, Hindi, Tamil', wide: 1 }) + '</div></section></div>';
  }
  function cvLines(s) { return String(s || '').split('\n').map(function (x) { return x.replace(/^[-•*\s]+/, '').trim(); }).filter(Boolean); }
  function cvList(s) { return String(s || '').split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function cvPreview() {
    var c = S.cv;
    var sec = function (title, body) { return body ? '<section class="cvp-sec"><h2>' + title + '</h2>' + body + '</section>' : ''; };
    var bullets = function (lines) { return lines.length ? '<ul>' + lines.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' : ''; };
    var contact = [c.email, c.phone, c.city].concat(cvList(c.links)).filter(Boolean).map(esc).join(' <span class="cvp-dot">·</span> ');
    var exp = c.experience.filter(function (e) { return e.role || e.company; }).map(function (e) {
      var dates = [e.start, e.end].filter(Boolean).join(' – ');
      return '<div class="cvp-item"><div class="cvp-row"><b>' + esc(e.role) + '</b>' + (dates ? '<span>' + esc(dates) + '</span>' : '') + '</div>' +
        '<div class="cvp-sub">' + esc([e.company, e.place].filter(Boolean).join(', ')) + '</div>' + bullets(cvLines(e.bullets)) + '</div>';
    }).join('');
    var edu = c.education.filter(function (e) { return e.degree || e.school; }).map(function (e) {
      return '<div class="cvp-item"><div class="cvp-row"><b>' + esc(e.degree) + '</b>' + (e.year ? '<span>' + esc(e.year) + '</span>' : '') + '</div>' +
        '<div class="cvp-sub">' + esc(e.school) + (e.details ? ' · ' + esc(e.details) : '') + '</div></div>';
    }).join('');
    var proj = c.projects.filter(function (p) { return p.name; }).map(function (p) {
      return '<div class="cvp-item"><div class="cvp-row"><b>' + esc(p.name) + '</b>' + (p.link ? '<span>' + esc(p.link) + '</span>' : '') + '</div>' +
        (p.description ? '<p>' + esc(p.description) + '</p>' : '') + '</div>';
    }).join('');
    var skills = cvList(c.skills).length ? '<p class="cvp-skills">' + cvList(c.skills).map(esc).join(' <span class="cvp-dot">·</span> ') + '</p>' : '';
    var certs = bullets(cvLines(c.certs));
    var langs = c.languages ? '<p>' + esc(c.languages) + '</p>' : '';
    var head = '<header class="cvp-head"><h1>' + esc(c.name || 'Your name') + '</h1>' + (c.headline ? '<p class="cvp-headline">' + esc(c.headline) + '</p>' : '') +
      (contact ? '<p class="cvp-contact">' + contact + '</p>' : '') + '</header>';
    var main = sec('Summary', c.summary ? '<p>' + esc(c.summary) + '</p>' : '') + sec('Experience', exp) + sec('Projects', proj) + sec('Education', edu);
    var side = sec('Skills', skills) + sec('Certifications', certs) + sec('Languages', langs);
    var body = c.template === 'compact' ? '<div class="cvp-cols"><div>' + main + '</div><aside>' + side + '</aside></div>' : main + side;
    var empty = !(c.summary || exp || edu || skills) ? '<p class="cvp-empty">Start filling in the form. Your resume appears here as you type.</p>' : '';
    return '<article class="cv cv-' + c.template + '" id="cvpaper">' + head + body + empty + '</article>';
  }
  // Plain-text version, for the resume checker on the Prep page.
  function cvText() {
    var c = S.cv, out = [c.name, c.headline, [c.email, c.phone, c.city].concat(cvList(c.links)).filter(Boolean).join(' | '), ''];
    if (c.summary) out.push('Summary', c.summary, '');
    if (c.experience.length) {
      out.push('Experience');
      c.experience.forEach(function (e) {
        out.push([e.role, e.company, e.place].filter(Boolean).join(', ') + ([e.start, e.end].filter(Boolean).length ? ' (' + [e.start, e.end].filter(Boolean).join(' – ') + ')' : ''));
        cvLines(e.bullets).forEach(function (b) { out.push('- ' + b); });
      });
      out.push('');
    }
    if (c.projects.length) { out.push('Projects'); c.projects.forEach(function (p) { out.push([p.name, p.link].filter(Boolean).join(' – '), p.description || ''); }); out.push(''); }
    if (c.education.length) { out.push('Education'); c.education.forEach(function (e) { out.push([e.degree, e.school, e.year, e.details].filter(Boolean).join(', ')); }); out.push(''); }
    if (c.skills) out.push('Skills', cvList(c.skills).join(', '), '');
    if (c.certs) out.push('Certifications', cvLines(c.certs).join('\n'), '');
    if (c.languages) out.push('Languages', c.languages);
    return out.filter(function (l, i, a) { return l !== '' || a[i - 1] !== ''; }).join('\n').trim();
  }
  function refreshCv(editorToo) {
    if (editorToo) renderSection('cveditor', cvEditor());
    var pv = document.getElementById('cvpreview');
    if (pv) pv.innerHTML = cvPreview();
  }

  // ---------- cover letter helper ----------
  // Stored privately as S.cl. The letter is built from a few answers plus your resume (S.cv); you can then take over
  // the wording yourself (S.cl.custom). "Download PDF" uses the same print trick as the resume builder.
  var CL_TONES = [['warm', 'Friendly'], ['formal', 'Formal'], ['short', 'Short']];
  var CL_FIELDS = ['company', 'role', 'manager', 'source', 'why', 'highlight', 'post', 'custom'];
  var CL_STOP = {};
  ('the and for with you your our ours are will have has had that this these those from they them their what who whom how all any can able about into such ' +
    'more most other also than then its it\'s we us as an at by of on or to in is be been being if not but do does did should would could must may might ' +
    'year years experience experienced role roles team teams work working company companies candidate candidates job jobs position positions looking ' +
    'strong good great excellent ability abilities skills skill knowledge including include includes etc well new across within responsibilities ' +
    'responsibility requirements requirement required preferred qualifications qualification plus like help join day days time based using use make ensure ' +
    'related relevant opportunity opportunities per one two three four five every each both where when while which without minimum least high highly level ' +
    'equal employer apply applicants application applications please environment provide providing location full part fast paced proven demonstrated ' +
    'understanding way ways get got want need needs needed through over under out who\'s you\'ll we\'re you\'re we\'ll there here very just only own same ' +
    'some many much who what why want looking seeking hiring hire run ideal ideally key core around along among upon via end per day-to-day hands-on 100 able')
    .split(' ').forEach(function (w) { CL_STOP[w] = 1; });

  function blankCl() { return { tone: 'warm', company: '', role: '', manager: '', source: '', why: '', highlight: '', post: '', custom: '' }; }
  function cleanCl(raw) {
    if (!isObj(raw)) return null;
    var b = blankCl();
    if (typeof raw.tone === 'string') b.tone = raw.tone;
    CL_FIELDS.forEach(function (k) { if (typeof raw[k] === 'string') b[k] = raw[k].slice(0, k === 'post' ? 8000 : k === 'custom' ? 6000 : 1000); });
    if (!CL_TONES.some(function (t) { return t[0] === b.tone; })) b.tone = 'warm';
    return b;
  }
  function trimDot(s) { return String(s || '').trim().replace(/[.!\s]+$/, ''); }
  // "Resolved 60+ queries" -> "resolved 60+ queries", but leave "SQL" or "iOS" alone.
  function lowerFirst(s) { s = String(s || ''); return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  // For titles and skills: "Customer support" -> "customer support", but keep "Senior Data Analyst" or "Zendesk" as typed.
  function lowerPhrase(s, single) {
    s = trimDot(s);
    var w = s.split(/\s+/);
    if (w.length > 1 ? /^[a-z]/.test(w[1]) : single) return lowerFirst(s);
    return s;
  }
  function joinAnd(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function hasWord(hay, needle) {
    var n = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + n + '($|[^a-z0-9])').test(hay);
  }
  // Resume skills the job post asks for (or your top three, when there is no post yet).
  function clSkills() {
    var all = cvList(S.cv.skills), low = S.cl.post.toLowerCase();
    var hit = low.trim() ? all.filter(function (s) { return hasWord(low, s.toLowerCase()); }) : [];
    return hit.length ? { list: hit.slice(0, 4), matched: true } : { list: all.slice(0, 3), matched: false };
  }
  function clName() { return S.cv.name || me.name; }
  // The generated letter, as plain text. Gaps you still need to fill show as [square brackets].
  function clGenerated() {
    var c = S.cl, cv = S.cv, t = c.tone;
    var gap = function (v, label) { return trimDot(v) || '[' + label + ']'; };
    var company = gap(c.company, 'company'), role = gap(c.role, 'job title'), src = trimDot(c.source);
    var paras = [];

    var open = t === 'formal' ? 'I am writing to apply for the position of ' + role + ' at ' + company + (src ? ', which I learned about via ' + src : '') + '.'
      : t === 'short' ? 'I\'d like to apply for the ' + role + ' role at ' + company + (src ? ' (found via ' + src + ')' : '') + '.'
      : 'I\'m excited to apply for the ' + role + ' role at ' + company + (src ? ', which I came across via ' + src : '') + '.';
    var hl = trimDot(cv.headline);
    if (hl && t !== 'short') {
      var who = (/^[aeiou]/i.test(hl) ? 'an ' : 'a ') + lowerPhrase(hl, true) + (cv.city ? ' based in ' + trimDot(cv.city) : '');
      open += t === 'formal' ? ' I am ' + who + ', and I believe my background is a strong match for this role.'
        : ' I\'m ' + who + ', and this role feels like a great fit.';
    }
    paras.push(open);

    var exp = cv.experience.filter(function (e) { return e.role || e.company; })[0];
    var edu = cv.education.filter(function (e) { return e.degree || e.school; })[0];
    var story;
    if (exp) {
      var current = !exp.end || /present|now|current|till date|ongoing/i.test(exp.end);
      var as = (exp.role ? (/^[aeiou]/i.test(exp.role) ? 'an ' : 'a ') + lowerPhrase(exp.role, true) : 'part of the team') + (exp.company ? ' at ' + trimDot(exp.company) : '');
      var b = cvLines(exp.bullets).slice(0, 2).map(function (x) { return lowerFirst(trimDot(x)); });
      story = b.length ? (current ? 'In my current role as ' : 'Most recently, as ') + as + ', I ' + b[0] + '.' + (b[1] ? ' I also ' + b[1] + '.' : '')
        : (current ? 'I currently work as ' : 'Most recently, I worked as ') + as + '.';
    } else if (edu) {
      story = 'I recently completed ' + (edu.degree ? 'my ' + trimDot(edu.degree) : 'my studies') + (edu.school ? ' at ' + trimDot(edu.school) : '') + '.';
    } else {
      story = '[One or two lines about your most relevant experience]';
    }
    if (trimDot(c.highlight)) {
      var h = trimDot(c.highlight);
      story += t === 'formal' ? ' One achievement I am particularly proud of: ' + lowerFirst(h) + '.'
        : t === 'short' ? ' ' + h.charAt(0).toUpperCase() + h.slice(1) + '.'
        : ' One thing I\'m especially proud of: ' + lowerFirst(h) + '.';
    }
    var sk = clSkills(), skills = '', skl = sk.list.map(function (x) { return lowerPhrase(x, false); });
    if (sk.list.length) {
      skills = t === 'formal' ? 'I would bring strong skills in ' + joinAnd(skl) + (sk.matched ? ', each of which your job description highlights' : '') + '.'
        : t === 'short' ? (sk.matched ? 'Skills you asked for that I have: ' : 'Key skills: ') + joinAnd(sk.list) + '.'
        : 'I\'d bring hands-on experience with ' + joinAnd(skl) + (sk.matched ? ', all of which your posting asks for' : '') + '.';
    }
    if (t === 'short') paras.push(story + (skills ? ' ' + skills : ''));
    else { paras.push(story); if (skills) paras.push(skills); }

    var why = trimDot(c.why) ? lowerFirst(trimDot(c.why)) : '[your reason, in one line]';
    var whyLine = t === 'formal' ? 'I am keen to join ' + company + ' because ' + why + '.'
      : t === 'short' ? 'I want to join ' + company + ' because ' + why + '.'
      : 'I\'d love to join ' + company + ' because ' + why + '.';
    if (t === 'short') paras[paras.length - 1] += ' ' + whyLine; else paras.push(whyLine);

    paras.push(t === 'formal' ? 'Thank you for considering my application. I would welcome the opportunity to discuss how my experience can contribute to ' + company + '.'
      : t === 'short' ? 'Thanks for reading. I\'d be glad to talk whenever it suits you.'
      : 'I\'d love to chat about how I can help ' + company + '. Thank you for your time, and I look forward to hearing from you.');

    var greet = 'Dear ' + (trimDot(c.manager) || (t === 'formal' ? 'Hiring Manager' : 'Hiring Team')) + ',';
    var sign = t === 'formal' ? 'Yours sincerely,' : t === 'short' ? 'Best,' : 'Warm regards,';
    return greet + '\n\n' + paras.join('\n\n') + '\n\n' + sign + '\n' + clName();
  }
  function clText() { return S.cl.custom.trim() ? S.cl.custom : clGenerated(); }

  // Key words from the pasted job post, and whether your resume or letter already uses them.
  function clKeywords() {
    var low = S.cl.post.toLowerCase();
    if (!low.trim()) return [];
    var counts = {}, order = [];
    (low.match(/[a-z][a-z0-9+#.'’-]*/g) || []).forEach(function (w) {
      w = w.replace(/[.'’-]+$/, '').replace(/['’]s$/, '');
      if (w.length < 3 || CL_STOP[w]) return;
      if (!counts[w]) { counts[w] = 0; order.push(w); }
      counts[w]++;
    });
    var firm = S.cl.company.toLowerCase();
    var words = order.filter(function (w) { return !hasWord(firm, w); }).sort(function (a, b) { return counts[b] - counts[a]; });
    var phrases = cvList(S.cv.skills).map(function (s) { return s.toLowerCase(); }).filter(function (s) { return s.length > 1 && hasWord(low, s); });
    var out = [];
    phrases.concat(words).forEach(function (w) {
      if (out.length < 14 && out.indexOf(w) === -1 && !out.some(function (p) { return p.indexOf(' ') > -1 && hasWord(p, w); })) out.push(w);
    });
    var mine = (cvText() + '\n' + clText()).toLowerCase();
    return out.map(function (w) { return { w: w, ok: hasWord(mine, w) }; });
  }
  function clKeywordsHtml() {
    var k = clKeywords();
    if (!k.length) return '<p class="muted small">Paste the job post above and the key words it repeats will show here.</p>';
    var got = k.filter(function (x) { return x.ok; }).length;
    return '<p class="small"><b>' + got + ' of ' + k.length + '</b> key words from the post appear in your resume or letter.' +
      (got < k.length ? ' Work the grey ones in where they are true for you.' : ' Nicely matched.') + '</p>' +
      '<div class="kw-list">' + k.map(function (x) {
        return '<span class="kw' + (x.ok ? ' yes' : '') + '">' + (x.ok ? ico('check') : '') + esc(x.w) + '</span>';
      }).join('') + '</div>';
  }

  function clField(key, label, opts) {
    opts = opts || {};
    var v = S.cl[key] || '';
    var attrs = ' id="cl-' + key + '" data-cl="' + key + '" maxlength="' + (opts.max || 200) + '" placeholder="' + esc(opts.ph || '') + '"';
    return '<label class="cvf' + (opts.wide ? ' wide' : '') + '"><span>' + label + (opts.hint ? ' <span class="muted">' + opts.hint + '</span>' : '') + '</span>' +
      (opts.area ? '<textarea' + attrs + ' rows="' + (opts.rows || 3) + '">' + esc(v) + '</textarea>' : '<input type="text"' + attrs + ' value="' + esc(v) + '">') + '</label>';
  }
  function clEditor() {
    var c = S.cl;
    var tones = '<div class="chips">' + CL_TONES.map(function (t) {
      return '<button type="button" class="chip' + (c.tone === t[0] ? ' on' : '') + '" data-act="cl-tone" data-t="' + t[0] + '" aria-pressed="' + (c.tone === t[0]) + '">' + t[1] + '</button>';
    }).join('') + '</div>';
    var apps = S.apps.filter(function (a) { return a.company || a.title; });
    var pick = apps.length ? '<label class="cvf wide"><span>Fill in from your tracker</span><select id="cl-pick"><option value="">Choose a job you saved…</option>' +
      apps.slice().reverse().map(function (a) { return '<option value="' + esc(a.id) + '">' + esc([a.company, a.title].filter(Boolean).join(' · ')) + '</option>'; }).join('') +
      '</select></label>' : '';
    var custom = c.custom.trim();
    return '<div class="card stack cv-editor">' +
      '<section class="cv-sec"><h3>Tone</h3>' + tones + (custom ? '<p class="muted small">Tone only changes the letter built from the form. You are editing the wording yourself right now.</p>' : '') + '</section>' +
      '<section class="cv-sec"><h3>The job</h3><div class="cv-grid">' + pick +
        clField('company', 'Company', { ph: 'e.g. Freshworks' }) + clField('role', 'Job title', { ph: 'e.g. Customer success associate' }) +
        clField('manager', 'Hiring manager', { hint: '(if you know the name)', ph: 'e.g. Ms. Priya Raman' }) + clField('source', 'Where you saw it', { ph: 'e.g. LinkedIn, a friend' }) + '</div></section>' +
      '<section class="cv-sec"><h3>The job post</h3>' + clField('post', 'Paste the job post', { area: 1, wide: 1, rows: 6, max: 8000, hint: '(optional, stays private)', ph: 'Paste the full job description here to match your skills against it.' }) +
        '<div id="clkeys" class="cl-keys">' + clKeywordsHtml() + '</div></section>' +
      '<section class="cv-sec"><h3>Your pitch</h3><div class="cv-grid">' +
        clField('highlight', 'Something you are proud of', { area: 1, wide: 1, rows: 2, max: 400, hint: '(one result, with a number if you can)', ph: 'e.g. Cut average resolution time by 30% by writing a shared answer library' }) +
        clField('why', 'Why this company?', { area: 1, wide: 1, rows: 2, max: 400, hint: '(finish the line “I want to join because…”)', ph: 'e.g. your product helps small shops grow, and I want to support those customers' }) + '</div>' +
        '<p class="muted small">Your name, contact details, experience and skills come from your resume. <a href="#/resume">Edit your resume</a></p></section>' +
      '<section class="cv-sec"><h3>Wording</h3>' + (custom
        ? clField('custom', 'Your letter', { area: 1, wide: 1, rows: 18, max: 6000 }) +
          '<div class="row"><button type="button" class="btn tiny ghost" data-act="cl-reset">Go back to the letter built from the form</button></div>'
        : '<p class="muted small">Happy with the draft? Copy or download it. Want to change a sentence? Take over the wording.</p>' +
          '<div class="row"><button type="button" class="btn tiny ghost" data-act="cl-edit">Edit the wording myself</button></div>') + '</section></div>';
  }
  function clPreview() {
    var cv = S.cv, c = S.cl;
    var fmt = function (s) { return esc(s).replace(/\[[^\]\n]{1,80}\]/g, function (m) { return '<mark class="clp-gap">' + m + '</mark>'; }).replace(/\n/g, '<br>'); };
    var contact = [cv.email, cv.phone, cv.city].concat(cvList(cv.links)).filter(Boolean).map(esc).join(' <span class="cvp-dot">·</span> ');
    var date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    var to = [trimDot(c.manager), trimDot(c.company)].filter(Boolean).map(esc).join('<br>');
    var body = clText().split(/\n\s*\n/).map(function (p) { return p.trim() ? '<p>' + fmt(p.trim()) + '</p>' : ''; }).join('');
    return '<article class="cv cv-letter" id="clpaper"><header class="cvp-head"><h1>' + esc(clName() || 'Your name') + '</h1>' +
      (contact ? '<p class="cvp-contact">' + contact + '</p>' : '') + '</header>' +
      '<p class="clp-date">' + esc(date) + '</p>' + (to ? '<p class="clp-to">' + to + '</p>' : '') +
      '<div class="clp-body">' + body + '</div></article>';
  }
  function refreshCl(editorToo) {
    if (editorToo) renderSection('cleditor', clEditor());
    var pv = document.getElementById('clpreview');
    if (pv) pv.innerHTML = clPreview();
    var kw = document.getElementById('clkeys');
    if (kw) kw.innerHTML = clKeywordsHtml();
  }

  // ---------- free learning library ----------
  // A hand-picked list. Every course here is free to learn; "cert" says what the certificate costs:
  // free = free certificate or badge, paid = free to learn but the certificate or exam costs money, some = some courses have free certificates, none = no certificate.
  var LEARN_FIELDS = [['all', 'All'], ['office', 'Office & Excel'], ['data', 'Data'], ['tech', 'Software & IT'], ['marketing', 'Marketing'], ['sales', 'Sales & support'],
    ['design', 'Design'], ['finance', 'Finance'], ['pm', 'Project management'], ['soft', 'English & soft skills'], ['general', 'Big libraries']];
  var CERT_LABEL = { free: 'Free certificate', paid: 'Certificate costs extra', some: 'Some free certificates', none: 'No certificate' };
  var COURSES = [
    { id: 'gcf-excel', field: 'office', title: 'Excel tutorials', by: 'GCFGlobal', cert: 'none', url: 'https://edu.gcfglobal.org/en/excel/', note: 'Step-by-step lessons from the very basics up to formulas, charts and PivotTables.' },
    { id: 'ms-excel', field: 'office', title: 'Excel video training', by: 'Microsoft', cert: 'none', url: 'https://support.microsoft.com/en-us/office/excel-video-training-9bc05390-e94c-46af-a5b3-d7c22f6990bb', note: 'Short official videos on tables, formulas, charts and PivotTables.' },
    { id: 'kaggle', field: 'data', title: 'Python, Pandas and SQL mini-courses', by: 'Kaggle Learn', cert: 'free', url: 'https://www.kaggle.com/learn', note: 'Hands-on lessons that run in your browser, with a certificate for each course you finish.' },
    { id: 'fcc-data', field: 'data', title: 'Data Analysis with Python', by: 'freeCodeCamp', cert: 'free', url: 'https://www.freecodecamp.org/learn/data-analysis-with-python/', note: 'NumPy, Pandas and charts. Build five projects to earn the certificate.' },
    { id: 'ms-powerbi', field: 'data', title: 'Power BI training', by: 'Microsoft Learn', cert: 'paid', url: 'https://learn.microsoft.com/en-us/training/powerplatform/power-bi', note: 'Build reports and dashboards. Prepares you for the PL-300 exam, which is paid.' },
    { id: 'google-da', field: 'data', title: 'Google Data Analytics Certificate', by: 'Google on Coursera', cert: 'paid', url: 'https://www.coursera.org/professional-certificates/google-data-analytics', note: 'Spreadsheets, SQL and dashboards. Audit the courses for free; Coursera offers financial aid for the certificate.' },
    { id: 'cs50x', field: 'tech', title: 'CS50x: Introduction to Computer Science', by: 'Harvard University', cert: 'free', url: 'https://cs50.harvard.edu/x/', note: 'The famous beginner course. Finish the problem sets for a free certificate from CS50.' },
    { id: 'fcc-web', field: 'tech', title: 'Responsive Web Design', by: 'freeCodeCamp', cert: 'free', url: 'https://www.freecodecamp.org/learn/2022/responsive-web-design/', note: 'HTML and CSS from zero, with projects to build for the certificate.' },
    { id: 'odin', field: 'tech', title: 'The Odin Project', by: 'The Odin Project', cert: 'none', url: 'https://www.theodinproject.com/', note: 'A complete web development path, free and open source, with a friendly community.' },
    { id: 'khan-code', field: 'tech', title: 'Computer programming', by: 'Khan Academy', cert: 'none', url: 'https://www.khanacademy.org/computing/computer-programming', note: 'A gentle first taste of coding, with instant visual results.' },
    { id: 'az900', field: 'tech', title: 'Azure Fundamentals (AZ-900) learning path', by: 'Microsoft Learn', cert: 'paid', url: 'https://learn.microsoft.com/en-us/training/paths/microsoft-azure-fundamentals-describe-cloud-concepts/', note: 'Cloud basics in plain language. The training is free; the exam is paid.' },
    { id: 'aws-cp', field: 'tech', title: 'AWS Cloud Practitioner Essentials', by: 'AWS Skill Builder', cert: 'paid', url: 'https://skillbuilder.aws/', note: 'Search for "Cloud Practitioner Essentials" after signing in. The course is free; the exam is paid.' },
    { id: 'cisco-cyber', field: 'tech', title: 'Introduction to Cybersecurity', by: 'Cisco Networking Academy', cert: 'free', url: 'https://www.netacad.com/courses/introduction-to-cybersecurity', note: 'How attacks work and how to stay safe online. Free badge when you finish.' },
    { id: 'hs-inbound', field: 'marketing', title: 'Inbound Marketing', by: 'HubSpot Academy', cert: 'free', url: 'https://academy.hubspot.com/courses/inbound-marketing', note: 'Content, social and lead nurturing basics, with a free certification.' },
    { id: 'skillshop', field: 'marketing', title: 'Google Ads certifications', by: 'Google Skillshop', cert: 'free', url: 'https://skillshop.withgoogle.com/', note: 'Official Google Ads and Analytics training with free certifications.' },
    { id: 'semrush', field: 'marketing', title: 'SEO and digital marketing courses', by: 'Semrush Academy', cert: 'free', url: 'https://www.semrush.com/academy/', note: 'Short courses on SEO, content and ads, most with a free certificate.' },
    { id: 'meta', field: 'marketing', title: 'Meta Blueprint courses', by: 'Meta', cert: 'paid', url: 'https://www.facebook.com/business/learn', note: 'Facebook and Instagram marketing. Courses are free; certification exams are paid.' },
    { id: 'hs-sales', field: 'sales', title: 'Inbound Sales', by: 'HubSpot Academy', cert: 'free', url: 'https://academy.hubspot.com/courses/inbound-sales', note: 'Modern selling: finding leads, calls and closing, with a free certification.' },
    { id: 'hs-service', field: 'sales', title: 'Customer Service', by: 'HubSpot Academy', cert: 'free', url: 'https://academy.hubspot.com/courses/customer-service', note: 'Support basics: tickets, customer happiness and keeping customers.' },
    { id: 'canva', field: 'design', title: 'Canva Design School', by: 'Canva', cert: 'none', url: 'https://www.canva.com/designschool/', note: 'Bite-size lessons on layout, colour and type, plus social media design.' },
    { id: 'google-ux', field: 'design', title: 'Google UX Design Certificate', by: 'Google on Coursera', cert: 'paid', url: 'https://www.coursera.org/professional-certificates/google-ux-design', note: 'Research, wireframes and Figma prototypes. Free to audit; financial aid available.' },
    { id: 'varsity', field: 'finance', title: 'Zerodha Varsity', by: 'Zerodha', cert: 'none', url: 'https://zerodha.com/varsity/', note: 'Stock markets, financial statements and personal finance, explained simply for India.' },
    { id: 'khan-fin', field: 'finance', title: 'Economics, finance and accounting', by: 'Khan Academy', cert: 'none', url: 'https://www.khanacademy.org/economics-finance-domain', note: 'Clear videos on accounting, interest, banking and the economy.' },
    { id: 'google-pm', field: 'pm', title: 'Google Project Management Certificate', by: 'Google on Coursera', cert: 'paid', url: 'https://www.coursera.org/professional-certificates/google-project-management', note: 'Planning, Agile and stakeholder skills. Free to audit; financial aid available.' },
    { id: 'scrum', field: 'pm', title: 'Scrum open assessments', by: 'Scrum.org', cert: 'none', url: 'https://www.scrum.org/open-assessments', note: 'Free practice tests to check your Scrum basics before an interview.' },
    { id: 'tcs-edge', field: 'soft', title: 'Career Edge – Young Professional', by: 'TCS iON', cert: 'free', url: 'https://learning.tcsionhub.in/courses/career-edge-young-professional/', note: 'Communication, resume writing, interviews and office basics, with a free certificate.' },
    { id: 'bc-english', field: 'soft', title: 'LearnEnglish', by: 'British Council', cert: 'none', url: 'https://learnenglish.britishcouncil.org/', note: 'Free lessons, listening and grammar practice for workplace English.' },
    { id: 'lhtl', field: 'soft', title: 'Learning How to Learn', by: 'Coursera', cert: 'paid', url: 'https://www.coursera.org/learn/learning-how-to-learn', note: 'One of the most popular courses anywhere: study smarter and beat procrastination. Free to audit.' },
    { id: 'elements-ai', field: 'soft', title: 'Elements of AI', by: 'University of Helsinki', cert: 'free', url: 'https://www.elementsofai.com/', note: 'What AI is and is not, with no maths or coding needed. Free certificate.' },
    { id: 'swayam', field: 'general', title: 'SWAYAM', by: 'Government of India', cert: 'paid', url: 'https://swayam.gov.in/', note: 'Free university courses. You pay only if you sit the proctored certificate exam.' },
    { id: 'nptel', field: 'general', title: 'NPTEL', by: 'IITs and IISc', cert: 'paid', url: 'https://nptel.ac.in/', note: 'Engineering, management and humanities courses from IIT faculty. Certificate exams have a small fee.' },
    { id: 'skill-india', field: 'general', title: 'Skill India Digital Hub', by: 'Government of India', cert: 'some', url: 'https://www.skillindiadigital.gov.in/', note: 'Government skilling courses in many fields and Indian languages.' },
    { id: 'infy', field: 'general', title: 'Infosys Springboard', by: 'Infosys', cert: 'free', url: 'https://infyspringboard.onwingspan.com/', note: 'Thousands of courses, from soft skills to coding, with free certificates.' },
    { id: 'ibm', field: 'general', title: 'IBM SkillsBuild', by: 'IBM', cert: 'free', url: 'https://skillsbuild.org/', note: 'AI, data, cloud and workplace skills, with free digital badges.' },
    { id: 'edx', field: 'general', title: 'edX', by: 'edX', cert: 'paid', url: 'https://www.edx.org/', note: 'Courses from top universities. Most are free to audit; certificates cost extra.' },
    { id: 'alison', field: 'general', title: 'Alison', by: 'Alison', cert: 'paid', url: 'https://alison.com/', note: 'Short courses in almost everything. Free to learn; certificates cost extra.' }
  ];
  var learn = { field: 'all', freeOnly: false, q: '' };
  function cleanLearn(raw) {
    var b = {};
    if (isObj(raw)) Object.keys(raw).forEach(function (k) { if (raw[k] === 'doing' || raw[k] === 'done') b[k] = raw[k]; });
    return b;
  }
  function learnMatches() {
    var q = learn.q.trim().toLowerCase();
    return COURSES.filter(function (c) {
      if (learn.field !== 'all' && c.field !== learn.field) return false;
      if (learn.freeOnly && c.cert !== 'free') return false;
      return !q || (c.title + ' ' + c.by + ' ' + c.note).toLowerCase().indexOf(q) > -1;
    });
  }
  function fieldLabel(f) { for (var i = 0; i < LEARN_FIELDS.length; i++) if (LEARN_FIELDS[i][0] === f) return LEARN_FIELDS[i][1]; return ''; }
  function learnCard(c) {
    var st = S.learn[c.id];
    var btn = function (s, label) {
      return '<button type="button" class="btn tiny' + (st === s ? ' primary' : ' ghost') + '" data-act="learn-set" data-id="' + c.id + '" data-s="' + s + '" aria-pressed="' + (st === s) + '">' +
        (st === s && s === 'done' ? ico('check') : '') + label + '</button>';
    };
    return '<article class="card lcard' + (st ? ' ' + st : '') + '"><div class="row between"><span class="pill">' + fieldLabel(c.field) + '</span>' +
      '<span class="lc-cert ' + c.cert + '">' + CERT_LABEL[c.cert] + '</span></div>' +
      '<h3><a class="plain-link" href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.title) + ' ' + ico('link') + '</a></h3>' +
      '<p class="muted small">by ' + esc(c.by) + '</p><p class="small">' + esc(c.note) + '</p>' +
      '<div class="row">' + btn('doing', st === 'doing' ? 'Doing it' : 'Start') + btn('done', 'Done') + '</div></article>';
  }
  function learnListHtml() {
    var list = learnMatches();
    if (!list.length) return '<p class="muted">Nothing matches. Try another field or clear the search.</p>';
    // What you are doing first, then new ones, then finished ones.
    var rank = function (c) { return S.learn[c.id] === 'doing' ? 0 : S.learn[c.id] === 'done' ? 2 : 1; };
    return '<div class="lgrid">' + list.slice().sort(function (a, b) { return rank(a) - rank(b); }).map(learnCard).join('') + '</div>';
  }
  function learnSummary() {
    var done = 0, doing = 0;
    Object.keys(S.learn).forEach(function (k) { if (S.learn[k] === 'done') done++; else doing++; });
    return '<div class="stats"><div class="stat"><b>' + doing + '</b><span>in progress</span></div>' +
      '<div class="stat hot"><b>' + done + '</b><span>' + ico('trophy') + 'finished</span></div></div>' +
      (done ? '<p class="row"><button type="button" class="btn ghost" data-act="learn-to-cv">' + ico('feed') + 'Add finished courses to my resume</button></p>' : '');
  }
  function learnControls() {
    return '<div class="chips" role="group" aria-label="Field">' + LEARN_FIELDS.map(function (f) {
      return '<button type="button" class="chip' + (learn.field === f[0] ? ' on' : '') + '" data-act="learn-field" data-f="' + f[0] + '" aria-pressed="' + (learn.field === f[0]) + '">' + f[1] + '</button>';
    }).join('') + '</div>' +
      '<div class="row learn-tools"><input class="grow" type="search" id="learnq" placeholder="Search, e.g. Excel, SQL, English" aria-label="Search courses" value="' + esc(learn.q) + '">' +
      '<label class="row small"><input type="checkbox" id="learnfree"' + (learn.freeOnly ? ' checked' : '') + '> Free certificate only</label></div>';
  }
  function refreshLearn(all) {
    if (all) {
      var c = document.getElementById('learnctl'); if (c) c.innerHTML = learnControls();
      var s = document.getElementById('learnsum'); if (s) s.innerHTML = learnSummary();
    }
    var l = document.getElementById('learnlist'); if (l) l.innerHTML = learnListHtml();
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
      else if (jobs.tab === 'refs') loadRefs();
      else if (!jobs.loaded && !jobs.loading) loadJobs(false);
    },
    'edit-profile': loadEditor,
    people: loadPeople,
    buddy: function () { loadBuddy(); loadSuggestions(); },
    resume: function () { if (!S.cv) ensureCv().then(function () { if (currentView() === 'resume') render(); }); },
    cover: function () {
      var fresh = !S.cl;
      if (fresh) { S.cl = blankCl(); save(); }
      (S.cv ? Promise.resolve() : ensureCv()).then(function () {
        if (currentView() === 'cover' && !document.getElementById('clpaper')) render();
      });
    }
  };

  // ---------- splash ----------
  // The splash is in index.html so it shows the instant the page arrives. Here we rotate its message and fade it out.
  var SPLASH_LINES = ['Pulling up a chair…', 'Putting the chai on…', 'Saving you a good seat…', 'Dusting off the bench…', 'Gathering the crew…'];
  var splashStart = Date.now();
  // Let the full drawing play on the first visit of a session; after that, get out of the way quickly.
  var splashMin = (function () {
    try { if (sessionStorage.getItem('bench:splash')) return 350; sessionStorage.setItem('bench:splash', '1'); } catch (e) { /* storage blocked */ }
    return 1500;
  })();
  var splashTimer = setInterval(function () {
    var el = document.getElementById('splash-msg');
    if (!el) return clearInterval(splashTimer);
    var i = (SPLASH_LINES.indexOf(el.textContent) + 1) % SPLASH_LINES.length;
    el.classList.remove('swap');
    void el.offsetWidth; // restart the animation
    el.textContent = SPLASH_LINES[i];
    el.classList.add('swap');
  }, 1800);
  function hideSplash() {
    var el = document.getElementById('splash');
    if (!el || el.classList.contains('done')) return;
    setTimeout(function () {
      el.classList.add('done');
      clearInterval(splashTimer);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 600);
    }, Math.max(0, splashMin - (Date.now() - splashStart)));
  }
  var lastView = '';

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
    if (ui.booting) { main.innerHTML = ''; return; } // the splash screen covers this moment
    if (!me) { main.innerHTML = authView(); return; }
    document.body.classList.toggle('anon', !!ui.newCode); // hide the nav until the code is saved
    if (ui.newCode) { main.innerHTML = codeView(); return; }
    var v = currentView();
    main.innerHTML = views[v]();
    main.classList.toggle('chat-mode', v === 'chat');
    document.body.setAttribute('data-view', v);
    updateTrackerBadge();
    // A gentle fade only when moving to a different page, not on every small update.
    if (v !== lastView) {
      main.classList.remove('enter');
      void main.offsetWidth;
      main.classList.add('enter');
      lastView = v;
    }
    document.querySelectorAll('#nav a').forEach(function (a) {
      var on = a.dataset.view === v;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    updateBadge();
    updateMeChip();
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
    if (e.target.id === 'learnfree') { learn.freeOnly = e.target.checked; refreshLearn(false); return; }
    if (e.target.id === 'cl-pick' && e.target.value && S.cl) {
      var app = find(S.apps, e.target.value);
      if (app) {
        S.cl.company = app.company || ''; S.cl.role = app.title || ''; save(); refreshCl(true);
        // renderSection keeps what was typed in the boxes, so put the picked job in them directly.
        ['company', 'role'].forEach(function (k) { var el = document.getElementById('cl-' + k); if (el) el.value = S.cl[k]; });
      }
      return;
    }
    if (e.target.id === 'saved') document.getElementById('codedone').disabled = !e.target.checked;
    if (e.target.name === 'color' && document.getElementById('avprev')) {
      var nm = document.getElementById('pf-name');
      document.getElementById('avprev').innerHTML = avatarHtml(nm ? nm.value : me.name, e.target.value, 'lg');
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'resume') {
      S.resume = e.target.value; save();
    } else if (e.target.dataset && e.target.dataset.cv && S.cv) {
      setPath(e.target.dataset.cv, e.target.value);
      save();
      var pv = document.getElementById('cvpreview');
      if (pv) pv.innerHTML = cvPreview();
    } else if (e.target.dataset && e.target.dataset.cl && S.cl && S.cv) {
      S.cl[e.target.dataset.cl] = e.target.value;
      save();
      refreshCl(false);
    } else if (e.target.id === 'ivnote' && iv.cur) {
      if (e.target.value.trim()) S.qnotes[iv.cur] = e.target.value; else delete S.qnotes[iv.cur];
      save();
    } else if (e.target.id === 'refq') {
      refs.q = e.target.value;
      var rl = document.getElementById('reflist'); if (rl) rl.innerHTML = refsHtml();
    } else if (e.target.id === 'learnq') {
      learn.q = e.target.value;
      refreshLearn(false);
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
    .then(function () { ui.booting = false; render(); hideSplash(); });
})();
