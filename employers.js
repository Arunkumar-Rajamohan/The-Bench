/* The Bench — companies whose public careers feeds fill the Jobs page.
   Every listing links straight to the employer's own application page: no middlemen, no ads.

   To add a company, find its careers page:
     boards.greenhouse.io/<token>  or  job-boards.greenhouse.io/<token>  -> ats: 'greenhouse'
     jobs.lever.co/<token>                                              -> ats: 'lever'
     jobs.ashbyhq.com/<token>                                           -> ats: 'ashby'
   and add { name, ats, token } below. Only roles located in India (or remote within India) are shown.
   Checked 19 Nov 2026: each of these had open roles in India. */
'use strict';

module.exports = [
  // Greenhouse
  { name: 'Okta', ats: 'greenhouse', token: 'okta' },
  { name: 'Zscaler', ats: 'greenhouse', token: 'zscaler' },
  { name: 'Databricks', ats: 'greenhouse', token: 'databricks' },
  { name: 'MongoDB', ats: 'greenhouse', token: 'mongodb' },
  { name: 'InMobi', ats: 'greenhouse', token: 'inmobi' },
  { name: 'Stripe', ats: 'greenhouse', token: 'stripe' },
  { name: 'Sigmoid', ats: 'greenhouse', token: 'sigmoid' },
  { name: 'Rubrik', ats: 'greenhouse', token: 'rubrik' },
  { name: 'GitLab', ats: 'greenhouse', token: 'gitlab' },
  { name: 'Toast', ats: 'greenhouse', token: 'toast' },
  { name: 'Elastic', ats: 'greenhouse', token: 'elastic' },
  { name: 'Twilio', ats: 'greenhouse', token: 'twilio' },
  { name: 'Glance', ats: 'greenhouse', token: 'glance' },
  { name: 'Airbnb', ats: 'greenhouse', token: 'airbnb' },
  { name: 'Sumo Logic', ats: 'greenhouse', token: 'sumologic' },
  { name: 'Druva', ats: 'greenhouse', token: 'druva' },
  { name: 'Coinbase', ats: 'greenhouse', token: 'coinbase' },
  { name: 'Groww', ats: 'greenhouse', token: 'groww' },
  { name: 'Datadog', ats: 'greenhouse', token: 'datadog' },
  { name: 'Samsara', ats: 'greenhouse', token: 'samsara' },
  { name: 'Observe.AI', ats: 'greenhouse', token: 'observeai' },
  { name: 'New Relic', ats: 'greenhouse', token: 'newrelic' },
  { name: 'Figma', ats: 'greenhouse', token: 'figma' },

  // Lever
  { name: 'Hevo Data', ats: 'lever', token: 'hevodata' },
  { name: 'Zeta', ats: 'lever', token: 'zeta' },
  { name: 'Mindtickle', ats: 'lever', token: 'mindtickle' },
  { name: 'CRED', ats: 'lever', token: 'cred' },
  { name: 'Pocket FM', ats: 'lever', token: 'pocketfm' },
  { name: 'Spotify', ats: 'lever', token: 'spotify' },

  // Ashby
  { name: 'Sarvam AI', ats: 'ashby', token: 'sarvam' },
  { name: 'ElevenLabs', ats: 'ashby', token: 'elevenlabs' },
  { name: 'OpenAI', ats: 'ashby', token: 'openai' },
  { name: 'Cursor', ats: 'ashby', token: 'cursor' },
  { name: 'Atlan', ats: 'ashby', token: 'atlan' },
  { name: 'Notion', ats: 'ashby', token: 'notion' },
  { name: 'Temporal', ats: 'ashby', token: 'temporal' },
  { name: 'Zapier', ats: 'ashby', token: 'zapier' }
];
