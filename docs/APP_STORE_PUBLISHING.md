# Publishing Harmonica Tabs to the Apple App Store

## Context

This document is a publishing roadmap for shipping the app on the **Apple App Store** (the iOS store on iPhone/iPad — Apple does not have a "web store"). It is tailored to the current state of `harmonica-tabs`:

- Expo SDK 54, React Native 0.81.5, new architecture enabled.
- Custom native Expo module (`modules/harmonica-audio/`, iOS 15.1+) using the microphone.
- Native iOS code already prebuilt at `harmonica-tabs/ios/`.
- `NSMicrophoneUsageDescription` is correctly set in `app.json`.
- `bundleIdentifier` is the placeholder `com.anonymous.harmonicatabs` — **must change**.
- No `eas.json` and no `ios.buildNumber` yet.
- App version is `1.0.0`; `supportsTablet: true`; portrait only.

Because the app has a custom native module and uses the microphone, it **cannot be published through Expo Go** — it must be built as a standalone iOS binary (`.ipa`) and uploaded to App Store Connect.

The plan recommends **EAS Build + EAS Submit** (Expo's cloud build/submit pipeline). It is dramatically simpler than the local Xcode/Transporter path for an Expo project, handles signing for you, and matches this project's didactic goals. The local Xcode alternative is noted briefly at the end.

---

## Step 0 — One-time accounts and prerequisites

Before any of the rest matters:

1. **Apple Developer Program membership** — $99/year, signed up at <https://developer.apple.com/programs/>. Apple requires an individual or organization seat to publish; a free Apple ID is not enough.
2. **App Store Connect access** — comes with the membership (<https://appstoreconnect.apple.com>).
3. **Expo account** — free, used by EAS Build (<https://expo.dev/signup>).
4. A Mac is *not* required for EAS Build (it runs in Expo's macOS cloud). It *is* required if you ever want to do the local Xcode path.

These are gating; nothing else proceeds until the Apple Developer Program enrollment finishes (sometimes 24–48 hrs of identity review).

---

## Step 1 — App-side changes that must happen before the first build

### 1a. `harmonica-tabs/app.json`
- Replace `ios.bundleIdentifier` from `com.anonymous.harmonicatabs` to something you actually own conceptually, e.g. `com.bendrasin.harmonicatabs`. This becomes permanent — it cannot be changed after the app is in App Store Connect.
- Add `ios.buildNumber: "1"`. App Store Connect requires the *build number* to increase with every upload for a given version; you'll bump this to `"2"`, `"3"`, … on resubmissions even if the user-facing `version` stays at `1.0.0`.
- Optional but recommended: set a friendly `expo.name` (e.g. `"Harmonica Tabs"`) — this is the name shown under the app icon. Right now it's `"harmonica-tabs"`.
- Optional: tighten `ios.infoPlist.NSMicrophoneUsageDescription` if you want a more polished sentence; the current one is acceptable.
- Optional: add `ios.config.usesNonExemptEncryption: false` under `ios` to suppress the export compliance question on every TestFlight upload (the app doesn't use custom crypto beyond HTTPS).

### 1b. Marketing icon
- App Store Connect requires a **1024×1024 PNG, no alpha, no rounded corners**. Confirm `assets/icon.png` meets this. If it has transparency, export a flat version.
- Expo will generate the rest of the iOS icon variants at build time from this single asset.

### 1c. Screenshots (gathered, not in the repo)
- Required: at least one set of **6.7" iPhone screenshots** (e.g. iPhone 15 Pro Max simulator, 1290×2796).
- Because `supportsTablet: true`, App Store Connect will also require **iPad Pro 12.9" / 13" screenshots** (2048×2732). If you do *not* want to support iPad on first release, the simpler option is to set `supportsTablet: false` in `app.json` for v1 and revisit later. (See Decision 1 below.)
- 3–10 screenshots per device size. You already have `Tablet-screenshots/` and `mobile-screenshots/` at repo root; verify those match the required dimensions.

### 1d. Privacy
- App Store Connect will ask you to fill in a **Privacy "Nutrition Label"**. For this app, the honest answer today is essentially: microphone audio is processed locally and not transmitted; saved tabs are local storage. Microphone access still has to be declared as a data type "collected" — but you can mark it as "not linked to user" and "not used for tracking", which it isn't.
- You will also be asked for a **Privacy Policy URL**. Apple requires one even for apps that don't transmit data. Simplest path: host a one-paragraph plain HTML page on GitHub Pages.

### 1e. Sign Mic permission text in Info.plist sanity-check
- The current string ("Harmonica Tabs uses the microphone to detect which note you are playing.") is fine. Apple sometimes rejects vague strings; this one is specific enough.

---

## Step 2 — Set up EAS Build

This is the work that, once done, replaces almost everything about Xcode signing/archiving for you.

1. Install the CLI globally: `npm install -g eas-cli`.
2. Log in: `eas login` (uses your Expo account).
3. From `harmonica-tabs/`, run `eas build:configure` — this creates `harmonica-tabs/eas.json` with default `development`, `preview`, and `production` profiles.
4. Edit `eas.json` to ensure the `production` profile builds for iOS (`"distribution": "store"`) and the `preview` profile builds an internal TestFlight-able binary.
5. First production build: `eas build --platform ios --profile production`. On the first run, EAS will offer to **create the App Store Connect app record and generate certificates / provisioning profiles for you**. Say yes — this is the big simplification vs. the Xcode path.
6. Build runs in Expo's cloud (~15–25 min for an SDK 54 + custom native module project). You'll get a download URL for the resulting `.ipa`.

Notes specific to this project:
- The custom Expo module under `modules/harmonica-audio/` is a *local* native module. EAS Build handles it via the standard Expo modules autolinking — no special config is needed beyond ensuring it's declared the same way it is for local builds today.
- `expo-sqlite` is in the `plugins` array, which is correct; EAS will configure it during prebuild.
- The `ios/` directory already exists, which means this is a **bare-ish** workflow. EAS will use the committed `ios/` directory rather than regenerating it from `app.json` *if* the `expo-build-properties` / prebuild settings indicate so. The safer behavior: let EAS prebuild, and either (a) keep `ios/` in `.gitignore`, or (b) make sure any hand-edits to `ios/` are reflected through the config plugin system, not just edited in place. (See Decision 2 below.)

---

## Step 3 — App Store Connect record

In <https://appstoreconnect.apple.com>:

1. **My Apps → New App**. Bundle ID dropdown should show the new identifier from Step 1a (EAS will have created it as part of the certs setup, or you can create it manually in the Developer Portal first).
2. Fill in: name (must be unique App-Store-wide; you may need a variant like "Harmonica Tabs by …"), primary language, SKU (any string, e.g. `harmonica-tabs-001`), and access level.
3. Under **App Information**: category (likely "Music"), age rating questionnaire (this app should rate 4+).
4. Under **Privacy**: complete the Privacy Nutrition Label per Step 1d, paste the Privacy Policy URL.
5. Under **Pricing and Availability**: free, all territories (or as you wish).
6. Under **App Store → 1.0 Prepare for Submission**:
   - Upload screenshots (Step 1c).
   - Description, keywords, support URL, marketing URL (optional).
   - "What's new in this version" (just "Initial release" for v1).
   - Build: this slot stays empty until your EAS build finishes processing.

---

## Step 4 — Submit the build with EAS Submit

After the production EAS Build completes:

1. `eas submit --platform ios --latest` — uploads the latest production build to App Store Connect.
2. Apple processes the binary (10–60 min). Once processed, it shows up in App Store Connect under TestFlight and is selectable as the build for your 1.0 submission.
3. **TestFlight Internal Testing first**: add yourself as an internal tester, install on your iPhone via the TestFlight app, and exercise the full app. Microphone permission flow is the most common review-time surprise — confirm it works on a real device, since the iOS simulator does not surface the same mic-permission UI.
4. Once you're satisfied, in App Store Connect, **assign the build to the 1.0 version** and click **Submit for Review**.

Apple review typically takes 24–72 hours for a first submission. Common rejection reasons for an app like this:
- Mic permission string is missing or vague (already OK here).
- Crashes on launch in their test environment (mitigated by your own TestFlight pass).
- Metadata mismatch between described features and what they observe.

---

## Step 5 — Verification

How to know each phase worked:

- **Build**: EAS dashboard shows a green "Finished" status, with an `.ipa` artifact.
- **Submit**: App Store Connect shows the build under TestFlight as "Processing" → "Ready to Test".
- **Install**: TestFlight app on your iPhone shows Harmonica Tabs as available; launching it presents the mic permission prompt with your custom string.
- **Submission**: App Store Connect shows the 1.0 version as "Waiting for Review", then "In Review", then "Pending Developer Release" or "Ready for Sale" depending on your release setting.

---

## Alternative: Local Xcode path (brief)

If you ever want to skip EAS:

1. Open `harmonica-tabs/ios/harmonicatabs.xcworkspace` in Xcode.
2. Set the bundle ID, signing team, and build number in the target's General tab.
3. Product → Archive (must run on a Mac, must run on a Real Device or Generic iOS Device target).
4. Organizer → Distribute App → App Store Connect → Upload.

This is materially more setup (provisioning profiles by hand, more chances for signing weirdness) and not recommended as a first path for an Expo project. Useful to know it exists, especially as a fallback if EAS Build is down.

---

## Open decisions (resolve before starting)

These shape Step 1 and Step 2 above:

1. **iPad support on v1?** Current `app.json` has `supportsTablet: true`, which means App Store Connect will require iPad screenshots. The simpler v1 path is to set `supportsTablet: false`, ship iPhone-only, and add iPad later. Keeping it true means more screenshot work but supports tablet users immediately.
2. **Native `ios/` directory: keep committed, or regenerate via EAS prebuild?** Right now `ios/` is checked in. The Expo-idiomatic path is to delete it from the repo and let EAS prebuild generate it from `app.json` + config plugins on every build (cleaner, but any hand-tweaks to `ios/` files must be expressed as config plugins). The "managed-bare" path is to keep `ios/` committed and edit it directly (more flexibility, but you own the upgrades).
3. **Bundle identifier choice** — concretely, what string? E.g. `com.bendrasin.harmonicatabs`.
4. **Apple Developer Program status** — already enrolled, or is Step 0 the first thing to do?
