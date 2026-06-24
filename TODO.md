# TODO - BlackboxAI optimization & bugfix pass

## Phase 1: Preparation
- [ ] Confirm required changes scope (performance only vs performance+bugfix)
- [ ] Create optimization/bugfix branch name: blackboxai/<short-name>

## Phase 2: Fix hard bugs / crashes
- [ ] Remove zombie loader typo `zombie.scale.set(10, 10, 10);s`
- [ ] Fix `hideGUI()` display toggling (currently sets `display = '1'`)
- [ ] Ensure any referenced variables are declared before use (eg `wallBoundingBoxes` timing)

## Phase 3: Zombie system de-duplication
- [ ] Remove one of the two zombie movement systems (choose state-machine or follow-player)
- [ ] Ensure single authoritative update loop updates zombie position + sounds + attack triggers

## Phase 4: Audio sanity + performance
- [ ] Replace repeated `new Audio()` usage with a simple audio manager (preload + reuse)
- [ ] Avoid creating ambient loop sounds until user gesture
- [ ] Ensure zombie/attack sounds don’t start multiple times concurrently

## Phase 5: Rendering performance
- [ ] Reduce shadow cost (shadow map resolution + which objects cast shadows)
- [ ] Reduce water shader/geometry cost (lower segments or update frequency)
- [ ] Disable `DoubleSide` where not required for major meshes

## Phase 6: Collisions
- [ ] Make collision boxes immutable after load (compute once, don’t repeatedly rebuild)
- [ ] Move collision checks to a single place; avoid per-frame Box3 construction in hot paths

## Phase 7: Testing
- [ ] Run `npm run dev` and check for console errors
- [ ] Verify: pointer lock, movement, door/key/password, zombie AI, game over
- [ ] Profile FPS before/after (Chrome performance)

