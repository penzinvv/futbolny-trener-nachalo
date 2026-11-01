# Cloud career snapshot recovery status

Last verified: 2026-11-01

## Server-side status

- Supabase table `public.career_state_snapshots` exists.
- Row-level security is enabled. No direct client policies are intentionally added.
- Edge Function `career-save` is active at version 3 with JWT verification enabled.
- GET returns only the snapshot belonging to the authenticated user.
- POST validates the state object and a 2 MiB payload limit.
- Writes use the database RPC `save_career_state_snapshot`, which checks an expected revision atomically. A stale writer receives HTTP 409 rather than silently overwriting a newer snapshot.
- The RPC is executable by `service_role` only; `anon` and `authenticated` cannot execute it directly.
- At the time of this check, the snapshot table contains 0 rows.

## Client integration status

- The currently published GitHub branch `ui-redesign-home` does **not yet contain** the client integration described below.
- A local draft based on the user's 2.8.1 archive now contains delayed cloud autosave after local `saveState()`, authenticated snapshot loading, explicit local/cloud conflict choices, a separate local backup before cloud restore, and HTTP 409 conflict blocking.
- Local saves continue to use `localStorage`; cloud failures do not remove the local save.
- The local draft passed JavaScript syntax checks. A headless browser smoke test did not complete, and no live authenticated end-to-end save/restore test has passed.
- No local career has yet been uploaded to this table by the game.

## Required before release

1. Synchronize the complete, correct 2.8.1 source tree to GitHub. Do not combine the local draft with the older 2.7.x branch files.
2. Test authenticated first save, repeat save, restore into a clean browser, local-vs-cloud conflict, and stale-revision HTTP 409.
3. Test persistence of user roster, NPC rosters, reserve players, in-game events, transfer history, and season history across reloads.
4. Confirm that existing local saves remain unchanged unless the user explicitly chooses a restore or replacement.
5. Do not claim cloud backup or recovery is complete until source synchronization and end-to-end testing pass.

Anonymous Supabase sessions are tied to the browser's persisted session. Cross-device recovery requires a durable account/sign-in flow; a browser-only anonymous session alone does not guarantee recovery on another device.
