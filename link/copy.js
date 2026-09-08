/*
 * copy.js — landing page copy variants.
 *
 * The page is the second-most-assumed thing in this project after "people will
 * send these." Its headline, its promises, and the decision to lead with the
 * recap instead of a pitch were all reasoned and none were tested. So they are
 * variants, selected by ?v= , and the kill test carries them across its ten
 * subjects. The variant id also feeds the App Store campaign token, so an
 * install can be traced to the copy that earned it — aggregate, no per-user
 * tracking (PROMPT.md §13b).
 *
 * Each variant answers a DIFFERENT question, which is the actual thing under
 * test — not word choice:
 *
 *   a  "who sent me this"        social proof; the sender is the endorsement
 *   b  "what is this app"        product utility; the differentiator up front
 *   c  "how did they make that"  the recipient's real question after watching
 *   d  "why not the one I have"  aimed at the documented complaint about rivals
 *
 * Prediction, recorded before the data (c): the recipient has just watched a
 * good-looking clip of someone they know. The question in their head is how it
 * was made, not whether they need a workout tracker. b and d answer questions
 * nobody asked; a makes it about a sender they already know.
 */
(function (root) {
  'use strict';

  var NAME = 'PROOF';

  var VARIANTS = {
    a: {
      id: 'a',
      note: 'social proof',
      withPR: function (d) {
        return {
          h: 'They just hit a PR.',
          s: d.pr.weight + ' × ' + d.pr.reps + ' on ' + String(d.pr.lift).toLowerCase() +
             '. Logged in ' + NAME + '.'
        };
      },
      withWorkout: function () {
        return { h: 'Someone sent you their session.', s: 'This is what a workout looks like in ' + NAME + '.' };
      },
      bare: { h: 'A lifting log that gets out of the way.', s: 'Log a set in one tap. Every session turns into something worth sending.' },
      cta: 'Get ' + NAME + ' — free'
    },

    b: {
      id: 'b',
      note: 'product utility',
      withPR: function () {
        return { h: 'Log a set in one tap.', s: 'No account. No trial. Your data never leaves your phone.' };
      },
      withWorkout: function () {
        return { h: 'Log a set in one tap.', s: 'No account. No trial. Your data never leaves your phone.' };
      },
      bare: { h: 'Log a set in one tap.', s: 'No account. No trial. Your data never leaves your phone.' },
      cta: 'Get ' + NAME + ' — free'
    },

    c: {
      id: 'c',
      note: 'how did they make that',
      withPR: function () {
        return { h: 'This took four seconds to make.', s: NAME + ' turns your set into something worth sending. That is the whole app.' };
      },
      withWorkout: function () {
        return { h: 'This took four seconds to make.', s: NAME + ' turns your set into something worth sending. That is the whole app.' };
      },
      bare: { h: 'Your set, worth sending.', s: NAME + ' turns a logged lift into something you would actually post. That is the whole app.' },
      cta: 'Try it — free, no account'
    },

    d: {
      id: 'd',
      note: 'against the incumbents',
      withPR: function () {
        return { h: 'A lifting app with nothing to sign up for.', s: 'No email, no trial, no paywall. Open it and log.' };
      },
      withWorkout: function () {
        return { h: 'A lifting app with nothing to sign up for.', s: 'No email, no trial, no paywall. Open it and log.' };
      },
      bare: { h: 'A lifting app with nothing to sign up for.', s: 'No email, no trial, no paywall. Open it and log.' },
      cta: 'Get ' + NAME + ' — free'
    }
  };

  /** Read ?v= from a url. Falls back to the predicted-best variant. */
  function pick(href) {
    var m = (href || (typeof location !== 'undefined' ? location.href : '')).match(/[?&]v=([a-d])\b/);
    return VARIANTS[m ? m[1] : 'c'];
  }

  /** Resolve the right headline/sub for the payload we actually have. */
  function resolve(variant, workout) {
    if (!workout) return variant.bare;
    if (workout.pr && workout.pr.lift) return variant.withPR(workout);
    return variant.withWorkout(workout);
  }

  var api = { NAME: NAME, VARIANTS: VARIANTS, pick: pick, resolve: resolve, ids: ['a', 'b', 'c', 'd'] };
  root.Copy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
