# Samarkand — Privacy Policy

*Effective: September 27, 2026*

Canonical, hosted copy: <https://onyx-systems.ch/privacy/samarkand>. This file is
the source of truth version-controlled alongside the game; the hosted page should
match it. Update both together when the game's data handling changes.

## The short version

Samarkand has no account system and no server of its own. Your progress — souls
collected, unlocked mutations, settings — is saved locally, in your browser or on
your device. Two things can leave your device, and only by your choice: anonymous
gameplay statistics, if you allow them when the game asks, and, on Android, the
data an optional rewarded ad hands to Google. Both are described below.

## What Samarkand stores, and where

- **Run and meta-progression** (souls, unlocked mutations, best runs) — saved
  in your browser's `localStorage` on Web, or in local app storage on Android.
- **Settings** — language, volume, your statistics choice, and other
  preferences — stored the same way.

## Anonymous gameplay statistics

To find out where the game is too hard, too easy, or broken, Samarkand can send
anonymous gameplay events to [GameAnalytics](https://gameanalytics.com), an
analytics service for games — **only if you allow it.** On first launch the game
asks, with "Allow" and "Don't send" as equal choices; until you answer, and for
as long as you choose "Don't send", nothing is sent and the statistics service is
not even started. What is sent once you allow it:

- **Progress events** — a run or room started, cleared, or failed; which biome
  and room; how much health was left; how long a run lasted and how it ended.
- **Choices** — which skill cards, mutations and curses were picked, what was
  bought in the in-game market and the lair, and the id of the enemy type that
  ended a run.
- **Rewarded ads** — whether one was offered, shown and completed (never what
  the ad was).
- **Technical data** — how long a frame takes to draw, and the text of an error
  if the game hits one.
- **What GameAnalytics adds itself** — a random identifier created on first
  launch, the session length, the device model, operating system and browser
  version, and a country derived from your IP address.

### What is never sent

There is no name, email, account, advertising identifier, or anything you type.
The data is processed by GameAnalytics under [its own privacy
policy](https://gameanalytics.com/privacy/).

### Changing your mind

Settings → Privacy → Anonymous statistics, on or off, at any time. Turning it off stops sending immediately; the choice is saved with your
settings. Builds made without GameAnalytics keys (for example, local development
builds) send nothing at all and do not ask.

Samarkand has no account or sign-in system.

## Ads on Android

On Android, dying offers a choice: watch a short rewarded video ad to revive at
half health, once per run, or decline and accept the death. The in-game market
also offers one free card reroll per purchased card draft in exchange for an ad.
Both are entirely optional and never play unless you choose to see them.

The ad itself is served by Google's AdMob. Showing it involves your device
talking to Google — an advertising identifier, general device information, and
approximate location may be shared with Google and its ad partners for ad
delivery and measurement, under [Google's own privacy
policy](https://policies.google.com/privacy) and, for the ad-consent flow
specifically, its
[UMP terms](https://developers.google.com/admob/ump/android/quick-start).
Where required (the EEA, UK, and similar), the app asks for your consent to
this before any ad loads. Declining the offer, or declining consent, changes
nothing else about the game — the run continues, you just don't get the
revive.

The Web build has no ads, no AdMob, and no ad-consent prompt; the exception above
is Android-only.

## In-game statistics

The live combat statistics and end-of-run summary (damage dealt, DPS, rooms
cleared, and similar figures) are calculated and shown on your own device, for
your own reference. The detailed report itself is not transmitted; only the
summary events listed under "Anonymous gameplay statistics" are, and only if you
have allowed them.

## Deleting your data

Clearing your browser's site data for Samarkand (Web) or uninstalling the app
(Android) removes all locally-stored progress, and with it the random
identifier used for statistics. This is permanent and cannot be undone, since
there is no server copy to restore from. The statistics already sent cannot be
linked back to you by the game; to ask GameAnalytics about them, use the contact
in its privacy policy.

## Children's privacy

Samarkand is not directed at children and does not knowingly collect personal
information from anyone. The gameplay statistics above are anonymous and only
sent with your permission; the
Android build's ads are explicitly configured as not child-directed and rated for a
general/teen audience, and are never shown to satisfy a legal requirement —
they are always the player's own choice.

## Changes to this policy

If this policy changes, the effective date above will change with it.

Questions about this policy: konstantin.hordx@gmail.com
