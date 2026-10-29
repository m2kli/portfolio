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
    caption: "Jinci full map · 3D block-out (2.5D): 11 elevation levels at true height"
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

### Playable demo

Windows 64-bit. Unzip and run `JinciGreybox.exe`. Starts fullscreen; Alt+F4 quits; Space skips the opening shot.

- **WASD / mouse**: move / look
- **Space**: auto step-up, vault, climb or jump-grab based on the obstacle; hold on yellow strips to climb to the top
- **Left Ctrl**: crouch; **Left Shift**: sprint; **F**: interact / pick up
- **Left mouse**: attack when close to an enemy
- **V**: show / hide enemy vision cones

> Design notes to be added: greybox iterations.
