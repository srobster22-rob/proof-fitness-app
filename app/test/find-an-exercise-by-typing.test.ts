import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from '../src/data/repo.ts';
import { NowModel } from '../src/ui/now-model.ts';
import { BUILTIN } from '../src/domain/coldstart.ts';
import { findExercises, exactExercise, MATCHES_SHOWN } from '../src/domain/find-exercise.ts';
import { nowScreenSource } from './helpers/now-screen.ts';

const T0 = Date.UTC(2026, 8, 23, 18);
const LIBRARY = BUILTIN.map(e => ({ id: e.id, name: e.name }));
const names = (q: string) => findExercises(q, LIBRARY).map(e => e.name);

/*
 * R683. Below three sessions the picker offers twelve movements of the sixty,
 * and the add field matched a built-in only by its exact name. PT1's critic
 * typed "Tricep Push", got ADD, and made a duplicate lift; the veteran had to
 * guess names; all three personas asked for search.
 */
describe('typing part of a name finds the movement (R683)', () => {
  test('what PT1 typed, and what lifters call things', () => {
    assert.equal(names('Tricep Push')[0], 'Tricep Pushdown');
    assert.equal(names('triceps push')[0], 'Tricep Pushdown', 'a plural mid-name stopped matching');
    assert.equal(names('rdl')[0], 'Romanian Deadlift');
    assert.equal(names('RDLs')[0], 'Romanian Deadlift');
    assert.equal(names('front squats')[0], 'Front Squat');
    assert.equal(names('dumbbell row')[0], 'DB Row');
    assert.equal(names('skullcrushers')[0], 'Skull Crusher');
    assert.equal(names('pull ups')[0], 'Pull-up');
    assert.equal(names('chin ups')[0], 'Chin-up');
    assert.equal(names('military press')[0], 'Overhead Press');
    assert.equal(names('leg presses')[0], 'Leg Press', 'an "-es" plural matched nothing');
    assert.equal(names('cable crunches')[0], 'Cable Crunch');
    // "Flyes" could be any of four, so all four are offered and none is assumed.
    assert.deepEqual([...names('flyes')].sort(), ['Cable Fly', 'Chest Fly', 'DB Fly', 'Reverse Fly']);
    assert.deepEqual([...names('flies')].sort(), ['Cable Fly', 'Chest Fly', 'DB Fly', 'Reverse Fly']);
  });

  test('every movement in the library finds itself first', () => {
    for (const e of LIBRARY) assert.equal(findExercises(e.name, LIBRARY)[0]?.id, e.id, e.name);
  });

  test('the closest names lead, and no more than fit at a glance', () => {
    assert.deepEqual(names('squat').slice(0, 2), ['Squat', 'Hack Squat'], 'the exact name did not lead');
    assert.equal(names('press').length, MATCHES_SHOWN);
    assert.deepEqual(names('x'), [], 'a single letter matched whatever contains it');
    assert.deepEqual(names('bb'), [], 'two letters matched the inside of a name');
    assert.ok(!names('abs').includes('Cable Fly'), '"abs" found the "ab" inside "cable"');
    assert.deepEqual(names('zercher squat'), [], 'a movement the library lacks matched something');
  });

  test('the name exactly as typed wins over another spelling of it', () => {
    // A lifter's own "Pullups", made before R683 and holding their history,
    // is the same spelling as the built-in Pull-up; what they typed decides.
    const own = [...LIBRARY, { id: 'my-pullups', name: 'Pullups' }];
    assert.equal(exactExercise('Pullups', own)?.id, 'my-pullups');
    assert.equal(exactExercise('pullups ', own)?.id, 'my-pullups', 'case and spacing count against the lifter');
    assert.equal(exactExercise('Pull-up', own)?.id, 'pullup');
    assert.equal(findExercises('Pullups', own)[0].id, 'my-pullups');
  });

  test('a name in any script is a name', () => {
    const own = [...LIBRARY, { id: 'zhim', name: 'Жим лёжа' }, { id: 'zhim-db', name: 'Жим DB' }];
    assert.equal(exactExercise('Жим лёжа', own)?.id, 'zhim', 'the same name twice made two lifts');
    assert.equal(exactExercise('Тяга DB', own), null, 'a row was merged into a press');
    assert.equal(findExercises('жим', own)[0]?.id, 'zhim-db');
    // A mark that changes a letter changes the name: "bu" is not "pu".
    assert.equal(exactExercise('ブルアップ', [...LIBRARY, { id: 'pu', name: 'プルアップ' }]), null, 'a Japanese voicing mark was dropped');
    assert.equal(exactExercise('पश अप', [...LIBRARY, { id: 'hi', name: 'पुश अप' }]), null, 'a Hindi vowel sign was dropped');
    // And a number is not run into the next one.
    assert.equal(exactExercise('Press 12', [...LIBRARY, { id: 'half', name: 'Press 1/2' }]), null, '1/2 was read as 12');
  });

  test('a lift the lifter made is found like any other, and its own name beats an alias', () => {
    const own = [...LIBRARY, { id: 'my-rdl', name: 'RDL' }];
    assert.equal(findExercises('rdl', own)[0].id, 'my-rdl');
    assert.equal(exactExercise('rdl', own)?.id, 'my-rdl');
    // Their own spelling of it beats the alias too, not only the same letters.
    const dotted = [...LIBRARY, { id: 'my-rdl', name: 'R.D.L.' }];
    assert.equal(exactExercise('rdl', dotted)?.id, 'my-rdl', 'the alias took their lift\'s place');
    assert.equal(findExercises('zerch', [...LIBRARY, { id: 'z', name: 'Zercher Squat' }])[0]?.id, 'z');
  });

  test('ADD only picks an existing movement when the name means that one movement', () => {
    assert.equal(exactExercise('RDL', LIBRARY)?.id, 'rdl');
    assert.equal(exactExercise('Front Squats', LIBRARY)?.id, 'front-squat');
    assert.equal(exactExercise('Tricep Push', LIBRARY), null, 'a partial name was taken as the movement');
    assert.equal(exactExercise('Shoulder Press', LIBRARY), null, 'an ambiguous name was taken as one movement');
    assert.equal(exactExercise('Flyes', LIBRARY), null, 'four flies were taken as one');
    assert.equal(exactExercise('Stiff Leg Deadlift', LIBRARY), null, 'a stiff-leg deadlift was taken for a Romanian one');
  });
});

describe('the Now screen uses it', () => {
  const model = () => {
    const repo = new Repo(new DatabaseSync(':memory:') as never, () => T0);
    return { repo, m: new NowModel(repo, () => T0, 'en-US') };
  };

  test('adding "RDL" picks Romanian Deadlift and creates nothing', () => {
    const { repo, m } = model();
    const before = repo.exercises().size;
    assert.equal(m.addCustomExercise('RDL'), 'rdl');
    assert.equal(m.state().exercise.id, 'rdl');
    assert.equal(repo.exercises().size, before, 'a duplicate lift was made');
  });

  test('a movement the library lacks is still added', () => {
    const { repo, m } = model();
    const id = m.addCustomExercise('Zercher Squat')!;
    assert.equal(repo.exercises().get(id)?.name, 'Zercher Squat');
  });

  test('the add field searches the whole library, not only what the picker offers', () => {
    const { m } = model();
    assert.equal(m.searchExercises('rdl')[0]?.id, 'rdl');
    assert.equal(m.searchExercises('kb swing')[0]?.id, 'kettlebell-swing');
  });

  test('the picker shows the matches under what is typed, and a tap picks one', () => {
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const screen = nowScreenSource();
    assert.match(screen, /matches\.map\(ex =>/, 'the picker no longer lists matches');
    assert.match(screen, /const matches = adding \? search\(name\) : \[\]/, 'the matches are not what was typed');
    assert.match(screen, /matches\.map\(ex =>[\s\S]{0,400}onPress=\{\(\) => pick\(ex\.id\)\}/, 'a match does not pick its movement');
    // Labelled like the sheet's other groups, or the rows read as the end of OTHER DAYS.
    assert.match(screen, /\{matches\.length > 0 && <Text style=\{s\.groupLabel\}>\{T\('matchesHeading'\)\}<\/Text>\}\s*\{matches\.map/,
      'the matches lost their label');
  });
});
