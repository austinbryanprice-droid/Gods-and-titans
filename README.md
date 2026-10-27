# Mythic War

A real-time strategy game in the style of Warcraft III, in low-poly 3D, that runs in the browser. Lead your Worshippers, grow a Village into a Town and a City, pray at Shrines and Temples for Faith, and summon the creatures, gods and titans of ten mythologies: Greek, Norse, Egyptian, Hindu, Japanese, Chinese, Aztec, Celtic, Mesopotamian and West African.

**Play:** https://austinbryanprice-droid.github.io/Gods-and-titans/

Up to 4 players per match, each a person or a computer opponent (Easy, Normal or Hard). Play co-op against the computer or against each other.

## Playing online with friends

1. One player picks **Host Online Game** and sets up the slots (people, computer players, teams).
2. Send your friends the invite link, or the 5-letter room code shown in the lobby.
3. Friends open the link, or pick **Join Online Game** and type the code.
4. The host starts the game when everyone is in.

The host's browser runs the game for everyone, so the host should have the steadiest connection. Players connect directly to each other (WebRTC, with the public PeerJS server for matchmaking). If a join fails on a strict network such as some work or school networks, try another network.

## How to win

Destroy every enemy building. Worshippers mine gold (two at a time per mine), chop wood and pray. Houses raise your population limit, the Barracks trains mortal soldiers (who earn ranks as they fight), a Shrine summons creatures, a Temple summons your gods (up to three, and they level up), and a City can raise a Titan Gate for your titan. Worshippers can also lay **walls**: pick Wooden Wall in the build menu and drag out a line, then upgrade it to stone; a Tower raised on a wall, or in line with one, becomes part of it. The in-game **How to Play** screen and the first-game checklist cover the rest.

Houses can grow, too: in a Town, select four Houses that stand together in a square and press **U** to combine them into a **Manor**. It shelters 48 people where the four Houses sheltered 32, so a big city needs less ground, and the Houses keep housing everyone while it is built.

The host can pick the **Decade of Peace** game mode in the lobby: for the first 30, 45 or 60 minutes no player can harm another and nobody can build near an enemy Town Center, so everyone can build up and mass armies for one great battle (neutral creatures still fight).

## Controls

| Input | Action |
|---|---|
| Left-click / drag | Select / box-select |
| Right-click | Move, attack, gather, pray or help build, depending on the target |
| Shift + right-click | Queue orders |
| A, M, S, H | Attack-move, move, stop, hold position |
| Delete | Destroy the selected units (press twice for a big group, a god or a Titan) |
| Q, W, E, R | Abilities (and units on a selected building) |
| B | Build menu for a Worshipper |
| Ctrl + 1–9, 1–9 | Assign / select a control group |
| Space, Backspace | Center on the selection or last alert / jump to your Town Center |
| Enter | Chat |
| Alt + click, middle-click | Ping your team at that spot on the map or the minimap (the buttons beside the minimap mark where to attack, defend, gather or get help) |
| F10 | Game menu (pauses a game against the computer) |
| Arrows, screen edge, mouse wheel | Move and zoom the camera |

## Running it yourself

There is no build step. Serve the folder with any static web server, for example:

```
npm install
npm run serve
```

then open http://localhost:8080/. Run the tests with `npm test`.

`DESIGN.md` is the full design spec. The game rules live in `src/sim/` (plain JavaScript that also runs in Node), rendering in `src/render/`, the interface in `src/ui/`, online play in `src/net/` and the computer players in `src/ai/`.
