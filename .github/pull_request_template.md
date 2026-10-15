## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Which part

- [ ] Behaviour engine (`assets/whale-pet.js`)
- [ ] Shared actions (`assets/pet-actions.js`) — affects **both** hosts
- [ ] Sprite layer (`assets/art-musume.js`)
- [ ] In-window overlay (`assets/whale-pet-overlay.js`, `lib/client.js`)
- [ ] Host half (`lib/index.js`, `lib/status.js`)
- [ ] Desktop window (`desktop/`)
- [ ] Docs / tests only

## Checklist

- [ ] `npm test` passes (95 unit tests)
- [ ] The three headless-browser pages in `tools/` still pass (layout safety, render cleanliness,
      end-to-end integration) — see the README for the exact commands
- [ ] If I touched a shared action, I checked **both** hosts call it (this project has already been
      bitten once by the two hosts drifting apart)
- [ ] If I touched the overlay's DOM, I did not depend on the stylesheet for geometry
- [ ] If I touched the canvas renderer, it still clears every frame
- [ ] No new network requests, no reading of chat message bodies
- [ ] New behaviour has a test — and for "must not happen" claims, a **control experiment** showing
      the assertion can fail

## How I verified it

<!-- Paste commands, screenshots, logs. Please don't include personal desktop content in screenshots. -->
