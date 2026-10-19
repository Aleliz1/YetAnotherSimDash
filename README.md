# YetAnotherSimDash (Y.A.S.S)

An original, high-contrast **native SimHub Dash Studio dashboard** for a second
monitor. The dashboard uses native SimHub controls and bundled original ribbon
artwork and Bahnschrift typography; it needs no subscriptions or internet services.
Bahnschrift must be available to Windows/SimHub on the display machine. Rich opponent/position data,
particularly in LMU, may require a game-specific telemetry integration.

## Choose a resolution

| Folder | Native dashboard | Offline design preview |
| --- | --- | --- |
| [2560x1080](./2560x1080/) | [Y.A.S.S 2560x1080.djson](./2560x1080/Y.A.S.S%202560x1080.djson) | [Open preview](./2560x1080/preview.html) |
| [1920x1080](./1920x1080/) | [Y.A.S.S 1920x1080.djson](./1920x1080/Y.A.S.S%201920x1080.djson) | [Open preview](./1920x1080/preview.html) |

Both versions use the full native resolution; the ultrawide version expands
the panels rather than stretching the Full HD dashboard. Segoe UI is supplied
with Windows.

### M3 E46-inspired night colours

Both resolutions use near-black neutral backgrounds, warm-white main instrument markings
and headings, amber digital readings, orange accents and higher-contrast secondary labels.
Three small blue/dark-blue/red accents evoke the M-style cluster. The standby
ribbons and offline preview controls use the same warm palette. Gear-change
highlights are warm gold rather than cyan; redline and warning accents stay red.
Green remains for faster lap deltas and throttle, with distinct labelled pedal
colours. Native map class colours remain controlled by SimHub/game class data
to preserve multiclass identification. This is an original palette inspired
by a night-time cluster, not an exact colour calibration or a guarantee of
reduced eye strain; set your monitor brightness appropriately for the room.

Two small 100px gauges in the upper-left of the cluster show **OIL** and
**COOLANT** temperature using normalized `OilTemperature` and `WaterTemperature`
in Celsius. Coolant is the engine-temperature reading, not cylinder-head metal
temperature. Zero/missing/nonpositive readings show `--` with no needle. Fixed
0-170 C oil and 0-130 C coolant scales are display ranges, not vehicle-specific
safe limits; hotter valid readings retain their numeric value with a capped needle.

The dashboard has no 12V or hybrid-SOC gauges; it does not add manually mapped
channels that SimHub does not expose through its normalized game data.

## Install and run

1. Install/update [SimHub](https://www.simhubdash.com/download-2/). Enable
  **Dash Studio** in SimHub's settings if necessary. For Richard Burns Rally,
  install and configure the RallySimFans (RSF) SimHub integration.
2. **Close SimHub.** Open your SimHub installation folder (usually
   `C:\Program Files (x86)\SimHub`) and locate `DashTemplates`.
3. From your chosen resolution folder, copy the `.djson`, matching
   `.djson.metadata` and **`.djson.ressources`** files into `DashTemplates`.
   The resource sidecar contains the two original transparent PNG ribbons;
   keep its name unchanged and copy it on updates too. The files may sit directly in
   that folder. Do not copy the HTML preview into SimHub. Administrator
   permission may be needed. You can install both resolutions; their names
   and dashboard IDs are different.
4. Restart SimHub. Find **Y.A.S.S 2560x1080** or **Y.A.S.S 1920x1080** in
  **Dash Studio > Dashboards**. When upgrading, replace older branded files
  rather than keeping duplicate dashboards; dashboard IDs are preserved.
5. Select **Run**, move the dashboard window to your second monitor, then
   **double-click the dashboard window to enter fullscreen**. Use the variant
   matching that monitor's resolution. Double-click again to leave fullscreen.
6. In SimHub, select your game, complete any **Game configuration** steps it
   offers, and enter a driving session.

These are native editable `.djson` templates, **not** double-click-importable
`.simhubdash` packages. Once loaded in SimHub, you can use its **More > Export
Dashboard** action to make a `.simhubdash` package yourself.

## Games and automatic layouts

The dashboard uses one Overview screen with automatic Circuit, Rally and
Standby layouts. There are no detail pages or Next Page button. Game detection
remains automatic; switching games does not require restarting the dashboard.

### Overview summary

The summary below the central instruments reads fuel/session data in Circuit
mode and stage progress, distance and split in Rally mode. Rally timing reads
`stageSeconds` and `stageResult` directly when SimHub provides them. The
dashboard does not generate pacenotes, infer stage progress, or remap custom
plugin properties.

### SimHub data only

Bindings read normalized SimHub `GameData`, `GameData.NewData` and supported
short properties directly. Optional channels appear only when those direct
properties are available; missing or invalid values remain unavailable rather
than being guessed, substituted or remapped. Check SimHub's Available properties
and the game's own HUD to verify channel availability and units.

Fuel laps and strategy values are not estimated from unverified properties.
Pit overspeed requires a directly available pit limit and pit-lane state.
Oil/coolant warning thresholds are not inferred; temperature gauges show their
readings without threshold-based flashing. The offline preview uses fictional
sample data only and does not add those values to the native SimHub dashboard.

### Animated standby and welcome

Standby features two original soft amber/orange ribbon images drifting slowly
behind Y.A.S.S branding. Native time-driven position bindings target 20
updates/second; there is no video, web view, Sony artwork or network dependency.
The five supported games are listed in one compact line.

When a supported game becomes running, a **WELCOME / game name** message holds
for 250ms, then the standby artwork and background fade out together over 900ms
to reveal the live dashboard. This is triggered by SimHub's game-running flag,
not cockpit entry. Unsupported games retain the unrecognized-game message.
Exiting restores standby and rearms the welcome; direct supported-game changes
also trigger it. Opening the dashboard with a game already running skips the
welcome so driving data is not obscured unnecessarily.

Each binding uses its own persistent SimHub `root` state; it does not depend on
cross-formula globals. The standby visibility binding stays evaluated to detect
the next game change. Movement calculations stop while live, but SimHub's
evaluation of hidden child bindings is renderer-dependent.

In Dash Studio, ribbon images, placement and text remain editable; the ribbon
shape itself is PNG artwork. To make a static standby, remove the **Top**
bindings on **Standby ribbon 1/2**, retaining their base positions.
The source artwork and deterministic resource archive are generated by
`tools/standby.mjs`. Browser preview and automated transition tests are provided,
but image resource loading, native opacity and smoothness must still be checked
on your SimHub installation. No measured SimHub CPU/FPS improvement is claimed.

### Driving animations

- After the welcome ends, panel **backgrounds** ease in over 350ms. Text, gauges,
  pedal inputs and radar/map data are never delayed, moved or faded by this
  entrance. Opening an already-running game skips the entrance.
- A gear change briefly turns the gear number warm gold, fading back to amber over
  300ms. The number updates immediately. Initial readings, missing/invalid
  gears, vehicle changes and long evaluation gaps do not trigger a flash.
- The RPM dial's outer rim progressively changes from its normal dark colour
  to red between 90% and 95% of the selected RPM limit, staying red above 95%.
  This follows the existing live/override/fallback RPM limit and never guesses
  a new limit from observed RPM. Missing RPM produces no accent.

These use native colour/opacity bindings at the existing 50ms fast refresh
target. No continuous decorative animation runs behind driving telemetry.
Panel background clocks remain evaluated even when transparent so they can
observe game exits and rearm; live performance and native appearance still
need validation in SimHub.
In the offline preview, switch from **Driving** to **Shift / overspeed** to
exercise both the gear-change highlight (5 to 6) and redline rim. Switch from
**Standby** to a supported game to see the welcome and panel entrance sequence.

| Game | Layout | Game setup |
| --- | --- | --- |
| Assetto Corsa, including Content Manager | Circuit | Select **Assetto Corsa** in SimHub, then launch your session from Content Manager normally. Content Manager is a launcher, not a separate telemetry game. |
| Assetto Corsa Rally | Rally | Select its dedicated game entry in a current SimHub release and follow that version's configuration instructions. Do not select original Assetto Corsa. |
| Richard Burns Rally (RallySimFans / RSF) | Rally | Install and configure RSF's SimHub integration. Confirm the RBR game entry and available telemetry properties in your installed SimHub version; unsupported or non-normalized fields remain unavailable. |
| Automobilista 2 | Circuit | Complete SimHub's game configuration. SimHub commonly requests **Project CARS 2** shared-memory mode in AMS2's System settings; follow the instructions displayed by your installed SimHub version. |
| Le Mans Ultimate | Circuit / endurance | Use SimHub's **Game configuration** action and follow its instructions for LMU telemetry. |

### Included readings

- **KERS / DRS:** independent readouts below the RPM gauge use direct SimHub
  `KERSPercent` (0..100), `DRSAvailable` and `DRSEnabled` properties. KERS shows
  remaining charge, including a valid 0%; DRS shows **ACTIVE** in green,
  **READY** in amber or **OFF** in muted text. Each is hidden when its readings
  are absent or invalid, and both are hidden in Rally and when disconnected.
  DRS is also hidden in LMU, which has no DRS system.
  Availability depends on the game/car integration. A reported false DRS state
  means OFF; it cannot distinguish an unsupported car if an integration supplies
  default false values. No custom aliases, battery-SOC substitutions or guessed
  energy values are used. AC music remains in the header.
- **Circuit flag status:** beside **CIRCUIT / LIVE**, active flags appear as
  colored flag tiles; inactive flags are hidden. Multiple reported flags appear
  together, and checkered uses a checker pattern. Normalized `Flag_Black`,
  `Flag_Orange`, `Flag_Checkered`, `Flag_Yellow`, `Flag_Blue`, `Flag_White`,
  and `Flag_Green` are supported; red uses `Flag_Name` explicitly reporting
  `Red`. If the game reports no active flag, no tile is shown; green is never
  assumed. Availability depends on the game's integration; flags are not
  derived from opponent positions or guessed raw enums.
- **Pit limiter:** a centered **PIT** LED inside the RPM dial reads `PitLimiterOn`.
  It glows amber for **ON**, dims for **OFF**, and is unlit when data is missing
  or invalid; missing is never presented as OFF. This replaces the limiter
  message in the top-right status area, leaving other warnings visible independently.
  Use the preview's flag scenarios and **Pit limiter** state to inspect these.
- **All five games:** the strip under the header shows **BRAKE BIAS** (%),
  **ABS**, **TC**, **TC2 / CUT** and **ENGINE MAP**. These are read-only current
  settings, not buttons and not ABS/TC intervention indicators. Values come
  from SimHub's `BrakeBias`, `ABSLevel`, `TCLevel`, `TractionControlCut` and
  `EngineMap` properties respectively. Brake bias uses the normalized percentage
  as supplied by SimHub, without guessing ratio conversions or reversing it.
  Levels retain the game's numbering; zero is displayed as `0`, not assumed to
  mean off. Missing, negative or invalid values show `--`.
  Availability depends on the car, game and integration. `TractionControlCut`
  shows only when SimHub publishes that direct channel; it never duplicates TC1
  or substitutes an assist-active flag. Integrations publishing default zeroes
  for unsupported settings cannot be distinguished from real zeroes.
- **All driving layouts:** a staggered instrument cluster: a dominant RPM dial,
  numeric speed value (no speedometer dial), inset fuel gauge and digital gear
  including neutral/reverse. Throttle, brake, clutch and handbrake remain visible.
- **All five games:** a compact FL/FR/RL/RR tyre panel shows temperature in
  Celsius and **LIFE LEFT** from SimHub's normalized `TyreWearFrontLeft`,
  `TyreWearFrontRight`, `TyreWearRearLeft` and `TyreWearRearRight` channels.
  These use remaining life: **100% = fresh, 0% = depleted**, not percent worn.
  Life is displayed to one decimal place. Missing/out-of-range wear shows `--`;
  missing/non-positive temperature shows `--`. Each channel is independent,
  so temperature can remain visible when wear is unavailable. Availability and
  accuracy depend on the game/integration, particularly Rally; this is not a
  tyre-life prediction. Some integrations publish a fixed/default value for
  unsupported wear, which cannot be distinguished from real telemetry here.
  The panel occupies the lower-right area on every game.
- **Circuit:** position, current lap, current/previous/best lap times, delta to
  best, four tyre temperatures, same-class standings neighbours, all-class
  proximity radar and a track minimap with cars in one shared panel.
  The enlarged map is the focus; a compact 104 x 104 radar sits at the
  bottom-left without covering it. The map panel includes **AIR** and **TRACK**
  temperature in Celsius, plus
  **WIND** speed in km/h. Temperatures use normalized `AirTemperature` and
  `TrackTemperature`; zero and sub-zero readings remain valid. Wind uses AMS2's
  raw `DataCorePlugin.GameRawData.mWindSpeed` (m/s, converted to km/h).
  Missing/invalid readings show `--` independently of map/position availability.
  Wind speed is read directly from AMS2's raw `DataCorePlugin.GameRawData.mWindSpeed`
  (m/s, converted to km/h); other games show `--` unless a normalized wind-speed
  field is supplied. Direction is read directly from normalized wind-bearing and
  heading fields when present; otherwise it remains unavailable. Vehicle speed
  is never substituted for wind.
- **Overall leaderboard:** below the same-class Ahead/Behind section, two columns
  display 20 overall standings entries per page (10 per column). The entire grid
  cycles every 10 seconds, with a page counter and the player highlighted orange.
  It uses native overall standings, not on-track proximity or the class-only
  neighbours. Timing is compacted to keep the names readable; long names may be
  clipped to their column. Missing standings show an explicit no-data heading.
- **Pedals:** vertical, bottom-filling throttle, brake, clutch and handbrake
  bars sit in the bottom-right of the gauge panel on all five games, labelled
  **THR / BRK / CLT / HB**. Each percentage appears directly inside its bar,
  without a background. Missing readings show `--` with no fill.
  AC music is in the header; tyres are below the map.
- **Rally:** the right-hand panel shows SimHub's generated stage route and car
  position when available, direct progress/distance/checkpoint-delta fields,
  and direct damage, transmission, and ABS/TC fields when published. Brake
  temperatures remain in the tyre summary. Missing telemetry stays unavailable.
  This does **not** generate pacenotes or co-driver guidance.
- **Status strip:** waiting, unsupported game, paused, pit limiter/pit lane,
  low fuel below **10%**, and a race/rally shift cue at **95% of the selected RPM
  limit**. This is a generic shift cue, not a car-specific optimal-shift strategy.

Below **10%** remaining fuel, the fuel gauge ticks/outline alternate red and
warm white, while its **LOW FUEL** label/value alternate red and amber (500 ms
each) on all five games. Nothing blinks
out or becomes hidden. At 10% or above the warning colour stays amber.
Missing/invalid fuel or tank capacity never triggers flashing; the
unavailable indication stays steady. The status-strip warning remains readable
while the gauge flashes. Select **Low fuel** in a preview to try it; flashing
does not require **Animate demo**.

Oil and coolant gauges show direct temperature readings with steady colors.
Y.A.S.S does not invent per-car warning thresholds.

## Instrument scales

### Performance

Generated JavaScript bindings include only their required helper functions.
Refresh intervals are tiered: gauges,
pedals and radar 50 ms; fuel/status labels 100 ms; ordinary dynamic readings
250 ms; leaderboard rows, temperatures and media metadata 500 ms. Static
decoration has a 1000 ms minimum refresh interval. Conditional layers retain
fast visibility checks. These are component minimum intervals, not a guarantee
of a particular frame rate.

The offline preview skips inactive layers, avoids unchanged binding writes, and
reuses unchanged dial, radar and map graphics instead of rebuilding their SVGs
every tick. Live SimHub CPU/GPU savings must be measured
on the target PC; no particular FPS gain is claimed.

The large warm-white **RPM x1000** dial is the main instrument. Speed is shown
as a numeric km/h value inside the RPM dial; there is no separate speedometer
dial. Fuel and digital gear share its lower area, with the smaller fuel gauge
showing **0 / 50 / 100 percent**. Fuel is **litres** and temperatures are
**Celsius**. Rally uses the same fuel gauge and numeric readout.

RPM uses SimHub's reported `MaxRpm`, then `CarSettings_MaxRPM`, when available.
The displayed scale rounds up to the next 500 RPM (limits up to 4,000) or next
1,000 RPM. If SimHub provides no limit, the dial uses an 8,000 RPM display-only
scale and labels the limit **UNAVAILABLE**; it does not claim that value is the
car's redline or calculate a shift cue from it. No per-car RPM or speed ranges
are configured by Y.A.S.S.

The RPM bezel has a continuous light diffuser instead of separate shift LEDs.
Its native dial strokes blend from dim amber to bright amber at 70% of the
reported rev limit, then to red at 95%. At 95% and above, the bezel and glow
flash together between bright and dim red every 250 ms (two cycles per second).
This uses the actual RPM/limit ratio,
not the rounded dial scale, so GT and high-revving cars share the same behaviour.
Without a valid live RPM reading and limit, the strip stays neutral. The custom
needle is unchanged. These colours are rev-range cues, not a claimed optimal
gear-change point for every engine.

Fuel percentage is read directly from `Fuel` and `MaxFuel`. Missing tank
capacity does **not** become an empty tank: its needle is hidden and **FUEL
UNAVAILABLE** appears. The speed value reads `SpeedKmh` directly.

## Race awareness: AC, AMS2 and LMU

- **AHEAD / BEHIND IN CLASS** uses vertically stacked, full-width rows with
  dedicated gap columns, using SimHub's native **player-class-only standings**
  filter independent of its global leaderboard preference.
  These are the adjacent classified drivers, **not** the cars physically nearest
  you and not necessarily the next cars you will encounter on track. At the
  class lead, class tail or in a solo class, the absent neighbour is shown as
  `-- / no class rival`. If class identification/count is missing,
  the panel explicitly says **CLASS DATA UNAVAILABLE**.
- **GAP** beside each name is the native standings time gap **to you**, not
  the gap to the overall/class leader or a relative-on-track estimate.
  Seconds use SimHub's signed player-gap convention to three decimal places:
  **-2.456 s** beside the driver ahead means you trail them by 2.456 seconds;
  **+1.234 s** beside the driver behind means you lead them by 1.234 seconds. Zero remains
  **0.000 s**. Missing gaps or absent neighbours show **--**, not a fabricated
  zero. If SimHub reports only a lap separation, its native signed **lap/laps**
  indication is retained instead of inventing a seconds value. Timing accuracy
  and update frequency depend on the game's telemetry integration.
- **Radar** uses SimHub's native world/relative-position radar and includes
  **all classes**, not only your class. It does not guess positions from
  lap-time gaps. All-class traffic is important when faster classes approach.
- **Minimap** uses SimHub's native generated static map with player/opponent
  markers, per-class positions and class colours where available. Its shape
  comes from SimHub's recorded track geometry, not a bundled generic circuit.

Both positional controls depend on the game's exported coordinates, permitted
map data and opponent telemetry. A track may need recording: enable SimHub's
track-map recording if necessary and complete a clean timed lap, then check
whether the outline loads. Relative-coordinate radar can also require a
recorded map. Recording a lap cannot fix absent opponent telemetry.

**An empty radar/map is never an all-clear signal.** The panel keeps a warning
even when player coordinates exist: those alone cannot prove that every rival
is transmitting positions. The dashboard cannot manufacture missing markers,
class information or map readiness, and does not mark a map as ready itself.
Use mirrors and the game's spotter as well.

### LMU telemetry setup

Core vehicle readings and rich race-awareness channels are different capabilities.
LMU updates can change which opponent/class/position data reaches SimHub.
If the built-in integration does not supply these channels, use an integration
compatible with your **current** game and SimHub versions. The community
[AIO dashboard LMU setup notes](https://github.com/thekingm249/AIO-DASHBOARD#for-lmu-)
describe the NeoRed/LMU shared-memory and session-data integrations and their
version-dependent requirements. Follow the maintained upstream instructions,
back up existing plugin configuration, and verify properties before driving.
Do not blindly replace an existing `CustomPluginVariables.JSON`.
No external DLLs or third-party dashboards are bundled or installed here.

## Music / Spotify controls (Assetto Corsa)

The compact media panel occupies the header between the game/car identity and
the right-aligned status, without moving the main panels. Title and artist
are truncated to fit; Previous, Play/Pause and Next remain available.
Other games keep the same fixed header spacing with media hidden.

Across all five games, timing stays left, instruments/inputs stay central,
and map/radar (circuit) or the stage route and vehicle condition (Rally) stays right above the tyre
panel. The left timing and central instrument backgrounds share a bottom
edge. Circuit-only energy/boost readouts remain inside the central panel;
they do not displace instruments when switching games.

Both resolutions include a compact **track title / artist** display and clickable
**Previous**, **Play / Pause**, and **Next** buttons on Assetto Corsa only.
The pedal readings remain in the gauge panel, independent of the player. Rally,
AMS2, LMU and standby do not display music controls.

This uses **SimHub's built-in System Info Windows media integration**, not the
Spotify Web API. No extra plugin, Spotify developer app, client ID or Spotify
account authorization is required by the dashboard.

1. Enable **System Info** (`SystemInfosProvider`) in SimHub's plugin settings.
2. In its **Media player information** settings, configure/select the Windows
   media information provider. Wording may differ between SimHub releases.
3. Open **Spotify desktop** (or another Windows media-session-compatible
   player) on the same Windows PC and start a track.
4. Verify `SystemInfosProvider.Title` and `SystemInfosProvider.Artist` in
   SimHub's Available properties. If no title is exposed, the dashboard shows
   **NO ACTIVE MEDIA** and a prompt to open a player.
5. Click the three dashboard controls. They invoke the built-in actions
   `SystemInfosProvider.MediaPrevious`, `SystemInfosProvider.MediaPlayPause`,
   and `SystemInfosProvider.MediaNext`. These can also be assigned to wheel
   buttons using SimHub's input/action mapping.

Controls target the Windows media player selected/handled by SimHub. Close or
pause competing browser/video players if the wrong app responds. Not all apps
or streams publish metadata or support every transport command. This does not
follow playback on another Spotify Connect device or provide Spotify playlist
browsing. There is no account connection.
The play/pause button deliberately shows both actions: the exposed title and
artist alone cannot reliably identify whether playback is currently paused.
Long metadata is shortened with `...` to fit the available panel.

The native property/action names were checked against SimHub's registered
metadata. Live media control still needs verification in your installed
SimHub; the offline preview simulates track changes and pause without
controlling real Spotify playback.

## Telemetry availability and limitations

- The dashboard consumes SimHub's normalized properties. Its native race-awareness controls consume
  SimHub opponent/map data directly; available channels depend on the game
  integration, as described above.
- A field not exported by a game or not resolved by your SimHub version displays
  `--` (timers: `--:--.---`); missing data does not become a fake zero. SimHub
  itself may report zero for an unavailable field, which cannot always be
  distinguished from a genuine zero. Zero temperatures/position/lap numbers
  are treated as unavailable; a genuine zero speed, pedal or fuel reading is
  retained.
- Assetto Corsa Rally support depends on the game's and SimHub's current
  telemetry implementation. The dashboard cannot enable channels the game
  does not transmit. Its timers are labelled as game lap timers deliberately,
  not guaranteed stage timing.
- Richard Burns Rally is routed to Rally when SimHub reports `RBR`,
  `RichardBurnsRally`, or a recognized RSF variant. Core readings expect
  SimHub's normalized GameData channels; verify RSF property names and units in
  Available properties. Stage details appear only when their normalized
  GameData fields are published by the integration.
- LMU uses the shared circuit layout, including same-class standings neighbours.
  This dashboard does **not** supply virtual energy, hybrid deployment, stint
  prediction, on-track time-gap relatives or race-control messages.
- RPM limits use SimHub's reported maximum or a display-only scale when absent.
  Tank percentage/low-fuel warnings need `MaxFuel` and remain unavailable
  without a valid capacity.
- Unknown game IDs show an explicit unsupported-game page. The current game ID
  is displayed there to help diagnose a future SimHub naming change.
- These files have structural, formula and visual-preview tests. **A live
  SimHub import and driving session in each game have not been tested here**
  because SimHub and the games are not installed in this workspace.

## Preview without SimHub

Double-click `preview.html` inside either resolution folder. It is self-contained
and works offline. Choose any of the four simulators or standby; try missing
telemetry, low fuel, shift/overspeed, pit limiter and paused states. Additional
states cover missing position/class data, an unrecorded map, no opponent
coordinates, class leader, last and solo, missing/zero standings gaps and
lap-separated rivals. **Vehicle** presets exercise a
16,000-RPM car and missing-limit fallbacks. **Animate demo** varies sample
speed/RPM/pedals; **Fullscreen** previews the display.
On Assetto Corsa, try the music buttons to cycle fictional demo
tracks and toggle demo playback. The preview notice reports the demo state.

The preview uses the generated native dashboard model and the same formulas,
but its browser rendering is only an approximation of SimHub's WPF rendering.
It contains **sample data only**, an explicitly **fictional circuit and drivers**,
and does not connect to SimHub or a running game. Browser class-neighbour and
marker simulations test the preview, not the actual native game integration.
The **Tyres** selector exercises fresh, worn, missing-wear and missing-tyre
states independently of the other preview controls.

## Troubleshooting / first-drive check

1. **Not listed:** confirm the files are in the `DashTemplates` folder of the
   SimHub instance you actually run, then restart SimHub. Check SimHub's log if
   it reports a template-loading error.
2. **Waiting for game:** select the correct game in SimHub and complete its
   telemetry configuration. Enter the cockpit; game menus may not send data.
3. **Only some fields work:** inspect **Available properties** in SimHub. Look
   for the normalized `DataCorePlugin.GameData` properties. Missing channels require game
   support, not a dashboard theme change.
4. **Black margins or small text:** use the matching native-resolution variant
   and verify Windows display resolution/scaling. SimHub/browser scaling is
   independent of the dashboard's native pixel dimensions.
5. **First-drive verification:** check zero speed while stopped, correct gear,
   plausible RPM and selected RPM limit, fuel needle against the game's tank
   gauge, pedal travel, and speed units. In a circuit race, verify the class neighbours against
   the official standings, map layout, player marker and passing cars on both
   sides of the radar, including another class. Stop the game and verify
   that standby appears. Do not rely on race-awareness panels until checked.
6. **Customise:** use SimHub's dashboard editor. The generator is the source of
   truth: regenerating will replace changes made directly to generated files,
   so export/copy your customised dashboard before regenerating.

## Rebuild / test (optional)

Node.js 20+ is needed only for development, not to use the dashboards.
No npm packages or install step are necessary.

```powershell
npm run generate
npm test
```

The generator writes both resolution folders. Tests check the persisted JSON
and metadata, native dimensions, element bounds, game routing, every formula,
unavailable values and needles, direct RPM-limit handling, class filter/offset
configuration, warnings, units and offline preview packaging.

## Format and setup references

- [Official Dash Studio guide: run, fullscreen, export](https://github.com/SHWotever/SimHub/wiki/Dash-Studio)
- [Official game configuration guide](https://github.com/SHWotever/SimHub/wiki/SimHub-Basics----Games-config-and-troubleshooting)
- [Official JavaScript formula engine documentation](https://github.com/SHWotever/SimHub/wiki/Javascript-Formula-Engine)
- [SimHub downloads](https://www.simhubdash.com/download-2/)

The design and generated dashboard content are original. Public dashboard
schema examples were consulted to identify the native serialization format;
no third-party graphics, layouts or formula libraries are bundled.
