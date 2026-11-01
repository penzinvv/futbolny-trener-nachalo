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

## Not yet complete

- The game client has **not** been connected to `career-save`.
- No local career has yet been uploaded to this table by the game.
- Automatic restore/merge UI has not been implemented or tested.
- Existing browser saves remain in localStorage and must not be overwritten automatically when a cloud snapshot also exists.
- Live authenticated save/restore testing is pending.

## Required integration safeguards

1. Keep localStorage saving as a fallback.
2. Never silently replace an existing local career with a cloud snapshot.
3. When local and cloud careers both exist and differ, stop automatic writes and offer an explicit recovery choice.
4. Update the local expected revision only after a successful server response; handle HTTP 409 as a conflict.
5. Test persistence of user roster, NPC rosters, reserve players, in-game events, transfer history, and season history across reloads.
6. Do not claim cloud backup or recovery is complete until the client integration and authenticated end-to-end test pass.

Anonymous Supabase sessions are tied to the browser's persisted session. Cross-device recovery requires a durable account/sign-in flow; a browser-only anonymous session alone does not guarantee recovery on another device.
