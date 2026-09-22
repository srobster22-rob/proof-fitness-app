/**
 * PT1 — persona: first-timer. New user -> first workout -> week two, at phone size.
 *
 *   node tools/playtests/pt1-first-timer.mjs <out-dir>
 *
 * Built step by step against what the app actually showed, not against a guess of it.
 */
import { launch } from '../playtest.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node tools/playtests/pt1-first-timer.mjs <out-dir>'); process.exit(1); }

const s = await launch();
let taps = 0;
const tap = async (re, opts) => { const t = await s.tap(re, opts); taps++; console.log(`tap ${taps}: ${t.label || t.text}`); return t; };
const see = async name => {
  await s.shot(OUT, name);
  console.log(`=== ${name}: ${(await s.text()).replace(/\s+/g, ' ').slice(0, 420)}`);
};
const dump = async title => {
  console.log(`--- controls: ${title}`);
  for (const c of await s.controls()) {
    console.log(`  [${c.role}] ${c.label} | ${c.text} @y${Math.round(c.y)}${c.disabled ? ' (disabled)' : ''}`);
  }
};

try {
  const opened = await s.open();
  console.log(`app opened in ${opened} ms`);
  await see('new-user');
  await tap(/^PUSH \/ PULL \/ LEGS/);
  await see('after-choosing-split');
  await tap(/^PUSH$/);
  await see('push-day');
  await tap(/^LOG SET$/);
  console.log(`METRIC first set logged after ${taps} taps`);
  await see('first-set-logged');
  await tap(/^LOG SET$/);
  await tap(/^LOG SET$/);
  await tap(/^Increase weight$/);
  await tap(/^LOG SET$/);
  await see('four-sets');
  await new Promise(r => setTimeout(r, 4000));
  console.log(`METRIC rest line 4s later: ${(await s.text()).match(/RESTING [0-9:]+/)?.[0] ?? '(no rest line)'}`);

  await tap(/suggested next/);
  await see('second-lift');
  await tap(/^LOG SET$/);
  await tap(/^LOG SET$/);
  await tap(/^LOG SET$/);
  await tap(/^Overhead Press$/);
  await see('third-lift');
  await tap(/^LOG SET$/);
  await tap(/^LOG SET$/);
  await tap(/^LOG SET$/);
  await see('before-finish');
  await tap(/^Finish this workout$/);
  await see('after-finish');

  // From here a failure is a finding, not the end of the session.
  const step = async (name, fn) => {
    try { await fn(); } catch (e) {
      console.log(`FINDING ${name}: ${e.message.slice(0, 300)}`);
      await dump(`after failed step ${name}`);
    }
  };

  await step('share', async () => { await tap(/^SHARE$/); await see('share'); await dump('after share'); });
  await step('done', async () => { await tap(/^DONE$/); await see('after-done'); });
  // FINDING (first run): the day sheet for the NEXT workout covers the tab bar, so
  // Progress and Goals cannot be reached until it is answered. A user taps SKIP.
  const skipDaySheet = async () => {
    if ((await s.controls()).some(c => /^Skip\. Work it out as I go$/.test(c.label))) await tap(/^Skip\. Work it out as I go$/);
  };
  await step('progress', async () => { await skipDaySheet(); await tap(/^PROGRESS$/); await see('progress-day1'); });
  await step('goals', async () => { await tap(/^GOALS$/); await see('goals-day1'); await dump('goals day 1'); });

  // ---- week two: the same stored workout, seen seven days later
  await step('week-two', async () => {
    await s.offsetDays(7);
    await see('week2-open');
    await tap(/^PULL$/);
    await see('week2-pull-day');
    await tap(/^LOG SET$/);
    await tap(/^LOG SET$/);
    await tap(/^LOG SET$/);
    await tap(/suggested next/);
    await see('week2-second-lift');
    await tap(/^LOG SET$/);
    await tap(/^LOG SET$/);
    await tap(/^Finish this workout$/);
    await see('week2-recap');
    await tap(/^DONE$/);
    await skipDaySheet();
    await tap(/^PROGRESS$/);
    await see('week2-progress');
    await dump('week two progress');
    await tap(/^GOALS$/);
    await see('week2-goals');
    await dump('week two goals');
  });
  console.log(`METRIC total taps ${taps}`);
} finally {
  await s.close();
}
