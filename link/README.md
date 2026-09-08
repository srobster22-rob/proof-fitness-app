# The link path

The strongest acquisition mechanism this product has, and the one the spec missed until v8.

On a TikTok FYP a burned-in watermark is all you get, and watermarks convert close to
nobody. In a group chat — the destination PROMPT.md §5 says to design for — the message can
carry a **real URL** next to the video. That is a tappable install path instead of a brand
impression, and it is free.

## Architecture: the payload rides in the fragment

`https://example.app/r?r=<send-token>#<base64url-workout>`

Everything after `#` is **never transmitted to a server**. Consequences, all of them
deliberate:

- **No backend.** The landing page re-renders the recap client-side from the URL, using the
  same `recap.js` the app renders with. Free static hosting, nothing to run, nothing to breach.
- **No training data leaves the phone.** Consistent with §11 and with what the page claims in
  its own footer. It has to stay true.
- **The card can ride in a URL; the clip cannot.** Footage is far too large, so the video
  travels as the message attachment and the link renders the *card* view of the same session.
  That asymmetry is a property of the medium — do not try to engineer it away.

### What this costs

**The chat unfurl preview cannot be personalised.** Most chat clients fetch OG tags
server-side, and the server never sees the fragment — so the preview is generic. A
server-rendered unfurl showing *their actual PR* would convert better.

That trade is taken knowingly, because in the group-chat case **the video attachment is the
preview** — it renders inline in every major client, and it is far more compelling than any
unfurl card. Revisit only if the data says the link is being ignored in favour of the file.

## Deep linking

`build.cjs` emits `.well-known/apple-app-site-association` and `.well-known/assetlinks.json`.
Both are templates — fill in the real team ID, bundle ID, and signing fingerprint.

Two rules that break Universal Links silently if violated:

1. **AASA must be served as `application/json`, with no file extension, over HTTPS.**
2. **No redirects on the AASA path or the link path.** iOS refuses to follow one when
   matching a URL to an app, and you get a browser instead of the app with no error.

`_redirects` uses a `200` rewrite rather than a `301` for exactly this reason.

Expo side:

```json
{
  "expo": {
    "ios": { "associatedDomains": ["applinks:example.app"] },
    "android": {
      "intentFilters": [{
        "action": "VIEW",
        "autoVerify": true,
        "data": [{ "scheme": "https", "host": "example.app", "pathPrefix": "/r" }],
        "category": ["BROWSABLE", "DEFAULT"]
      }]
    }
  }
}
```

## Attribution — and its honest ceiling

**If the app is installed**, the Universal Link opens it directly with both the workout and
the send token. Attribution is exact and requires nothing.

**If it is not**, the user goes to the App Store and *the trail breaks*. This is the deferred
deep link problem and it has no clean first-party solution. The options:

| Approach | Gets you | Cost |
|---|---|---|
| **App Store campaign tokens** (`ct=`) | Aggregate installs per campaign in App Store Connect | None. No SDK, no vendor, no per-user tracking |
| Branch / AppsFlyer | Per-user deferred deep linking | A tracking SDK and a vendor — banned by §9, and contradicts the page's own promise |
| Clipboard or fingerprint matching | Fragile per-user matching | Privacy-hostile, unreliable on modern iOS. No |

**v1 uses campaign tokens only.** What you learn is "N installs came from share links this
week" — aggregate, no individuals. That is precisely the resolution needed to answer whether
the channel works, and deliberately not one step more.

This also closes the gap the kill test leaves open. That test measures **sending**; ten sends
prove the artifact travels but say nothing about whether recipients install. The campaign
token is how the second, harder question gets answered — and it only starts returning data
once something is actually in the App Store.

## Build and deploy

```bash
node build.cjs
```

Outputs `dist/`. Deploy to any static host. Before shipping, replace: `APP_ID`,
`PROVIDER_TOKEN`, and `APPNAME` in `index.html`; `TEAMID.com.example.appname` in the AASA;
the package name and fingerprint in `assetlinks.json`; and the `og:image` URL.

Verify with Apple's validator and by tapping a real link on a real device — the simulator
does not exercise Universal Links faithfully.
