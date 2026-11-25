# Floor is lava: Weimar

A 3D game on the real buildings of central Weimar, between the Bauhaus main building and Weimar Hbf. Lava rises from the ground, and you pick a roof, check your odds and look for a way to jump higher.

Live: https://paradigmacy.github.io/ai-in-design/

## What it does

- **The city.** All 4,316 buildings of the city kit, raised from their footprints to their measured height. Drag to orbit, right-drag to pan, scroll to zoom, and click a building to see its use, floors and floor area.
- **The walk.** The shortest walking route from the Bauhaus main building to the station along the pedestrian network: 2,072 m, about 26 minutes at 4.8 km/h. Buildings within 250 m of the route are coloured by use or by height. The rest are grey.
- **The camera.** Buttons for the whole area, the Bauhaus, the station, and a top-down plan with north at the top.
- **The game.** Orange lava rises from the ground. Play, pause, speed (1×, 2×, 5×) and new game; at 1× it rises 0.1 m per second. Click a roof to stand on it. The panel shows your odds of staying alive, and the map shows the taller roofs you can jump to (teal) and the escape path to the highest roof you can reach (gold). Height colours stay locked until you pick a roof, so you can't read the heights off the colours.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

Every push to `main` publishes the site to GitHub Pages, through `.github/workflows/deploy.yml`.

## The rules and their limits

- **Where the lava stops.** Each game picks a secret stop height, and every height from 0 to 37 m is equally likely. 37 m is just above the tallest roof in the kit (36 m). When the lava reaches it, it stops, and the panel says whether your roof stayed dry.
- **Your odds.** The chance the lava stops below your roof: (roof height − lava height) ÷ (37 m − lava height), and 0 % once the lava is at or above the roof.
- **Jumps.** You can jump a gap of up to 4 m between two footprints, land at most 3 m higher (about one floor), and drop down any height. Every roof you land on must be above the lava. The escape path leads to the highest roof you can reach this way, with the fewest jumps.
- **Limits.**
  - A building's height is its highest roof point, so a sloped roof counts as flat at its top.
  - Gaps are measured between footprints on the plan; walls, balconies and courtyards are not taken into account.
  - The odds and the jump limits are rules of the game, not real safety advice.
  - The route starts and ends at the street junctions nearest each building: 6 m from the main building and 23 m from the station hall.
  - The 250 m strip along the route is measured to each building's centre.

## What's in here

| Path | What it is |
| --- | --- |
| `src/App.jsx` | the page: loads the data, runs the game, and draws the panel with all its buttons |
| `src/City.jsx` | the 3D city: ground, streets, buildings, route, landmarks and game highlights |
| `src/Lava.jsx` | the lava layer and the clock that makes it rise |
| `src/CameraRig.jsx` | moves the camera smoothly to each view |
| `src/geo.js` | turns longitude and latitude into metres; the two landmarks |
| `src/route.js` | finds the shortest walking route through the street network |
| `src/jumps.js` | the jump rules, the odds and the escape path |
| `public/data/` | the city kit: central Weimar, about 1.3 × 2 km. `SOURCES.md` there lists every file, its source, licence and fields |
| `CLAUDE.md` | what the agent reads first every time it starts |

## Data and credit

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with Claude Opus 5.5 (claude-opus-5-5).
2. I decided: you can jump at most 4 m across and 3 m up between roofs, like a real person.
3. The agent did: built the 3D map, the walking route and the lava game from the city kit data, tested the route and the jump rules with check scripts, and published the site to GitHub Pages.
4. I checked: tall buildings near the Bauhaus show higher survival odds than low ones, and the escape path never lands under the lava.
