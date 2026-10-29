---
title: Zhenshui
summary: "Designed the spatial structure, flow and pacing of a 512 m sandbox level. Stealth performance decides the final route, and a boss fight with four entrances gives a different opening advantage for each. Built the UE5 white-box greybox and guidance lighting, and set up a \"map data → validation → greybox\" iteration pipeline."
engine: Unreal Engine 5
tags: [Third-person Sandbox, Multi-route Stealth, Greybox]
cover: works/zhenshui/shot-04.jpg
gallery:
  - src: works/zhenshui/shot-05.jpg
    caption: "Hall forecourt · night greybox and guidance lighting"
    wide: true
  - src: works/zhenshui/shot-01.jpg
    caption: "Optional goal: climb the stupa scaffold and read the water routes — central axis plus north and south canals"
  - src: works/zhenshui/shot-02.jpg
    caption: "Stealing the Jin army silver token: campfire light and patrol sightlines"
  - src: works/zhenshui/shot-03.jpg
    caption: "Walking through the Huixian Bridge checkpoint with the token"
  - src: works/zhenshui/shot-04.jpg
    caption: "Hall of the Holy Mother & Fish Pond Bridge · night aerial view"

notes:
  - src: works/zhenshui/map-full-3d.png
    caption: "Jinci full map · 3D block-out (2.5D): 13 elevation levels at true height"
    wide: true
  - src: works/zhenshui/map-full-flow.png
    caption: "Jinci full map · flow: main route and the three final routes (north canal / central axis / south canal)"
  - src: works/zhenshui/map-full-plan.png
    caption: "Jinci full map · architectural plan"
  - src: works/zhenshui/map-full-pacing.png
    caption: "Jinci full map · main-route pressure curve"
    wide: true
  - src: works/zhenshui/map-poi-3d.png
    caption: "Hall of the Holy Mother & Fish Pond Bridge · 3D block-out (2.5D): canal, hall, hidden loft and eaves"
    wide: true
  - src: works/zhenshui/map-poi-flow.png
    caption: "Hall of the Holy Mother & Fish Pond Bridge · routes for the four entrances"
  - src: works/zhenshui/map-poi-plan.png
    caption: "Hall of the Holy Mother & Fish Pond Bridge · architectural plan"
  - src: works/zhenshui/map-poi-pacing.png
    caption: "Hall of the Holy Mother & Fish Pond Bridge · main-route pressure curve"
    wide: true
links:
  - type: download
    url: release:zhenshui-demo-v1/Zhenshui_Greybox_Demo_Win64.zip
    label: Download playable demo (Windows · 341 MB)
order: 3
---

### Space and flow

A 512 × 512 m map with 14 areas looping around Mount Xuanweng, about 1150 m of main route. The first half climbs from the ferry and Wang Qiong Shrine up the cliff path and Reading Terrace to the Tang Shuyu Shrine; the second half turns back through the Guandi Temple, the Jin garrison and the town gate to the Water Mirror Stage, where the route splits into three finales — the Huixian Bridge centre line, the north canal and the south canal — that meet again at the Hall of the Holy Mother.

### Stealth decides the final route

- Steal the Jin silver token from the Tang Shuyu forecourt: while it is valid you can walk the centre line through the Huixian Bridge checkpoint, under disguise rules — drawing a weapon or running gives you away.
- Get spotted and the shrine sounds the gong: the token is void, the Guandi Temple sends pursuers who search for about 40 s, and only the two canals remain.
- The spring at Nanlao covers footsteps — the one place you can sprint safely. Lure stones (Q) pull sentries off their posts and smoke bombs (G) break sightlines; both have to be found in the level.

### Secondary points of interest

- **Jin garrison**: fenced into a front and rear camp, with two watchtowers, the command tent, armoury, granary and stables — 13 guards. Setting the granary alight sends the whole camp to the fire and pulls two patrols off the centre line, easing the finale.
- **Town gate**: gatehouse sentries and two cages — one holds lure stones, the other an old story.
- **Tang Shuyu Shrine / Guandi Temple**: the gong and the pursuers form a chain of consequences for mistakes; during the lockdown an exit lamp lights up to show the way out.

### Boss fight: four ways into the hall

The Hall of the Holy Mother and the Fish Pond Bridge are the core point of interest (128 m, with a hidden loft as a second floor). Each of the four entrances gives a different opening:

- **E1 Front · flying bridge**: no advantage — one against three, head on.
- **E2 Underwater · pillar grove**: in from the south canal through the culvert; backstab a bodyguard and it becomes one against two.
- **E3 Hidden loft · north vent**: pull the sluice bolt first and the timed second phase is easier.
- **E4 Roof · cliff drop**: climb the cliff from the plank path and drop onto the upper eaves; the opening strike takes about a quarter of the boss's health.

The boss, Han Shouqu, fights in two phases; the second is timed — drop the sluice before he opens it.

### How it was iterated

The level is written as map data first and reviewed in my own level workbench — plan, flow, 3D block-out and pressure curve — then generated into the UE5 greybox; hand edits in the level are written back to the data so drawings and greybox never drift apart. The Hall of the Holy Mother and the Fish Pond Bridge with its offering hall have already been refined into detailed architecture.
