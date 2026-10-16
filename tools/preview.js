(() => {
  'use strict';
  const model = JSON.parse(document.getElementById('dashboard-model').textContent);
  const images = JSON.parse(document.getElementById('dashboard-images').textContent);
  const dash = document.getElementById('dash');
  const viewport = document.getElementById('viewport');
  const gameControl = document.getElementById('game');
  const stateControl = document.getElementById('state');
  const vehicleControl = document.getElementById('vehicle');
  const tyreControl = document.getElementById('tyres');
  const animate = document.getElementById('animate');
  const entries = [];
  const tracks = [
    ['NIGHT DRIVE / DEMO TRACK', 'MangoDash Radio / Demo artist'],
    ['COASTAL RUN / DEMO TRACK', 'MangoDash Radio / Demo artist'],
    ['AFTER THE CORNER / DEMO TRACK', 'MangoDash Radio / Demo artist'],
  ];
  let trackIndex = 0;
  let musicPaused = false;
  let screenIndex = 0;
  const property = key => properties[key] ?? null;
  let properties = {};
  let demoDrivers = [];
  const argb = color => /^#[a-f\d]{8}$/i.test(color)
    ? '#' + color.slice(3) + color.slice(1, 3) : color;
  dash.style.width = model.BaseWidth + 'px';
  dash.style.height = model.BaseHeight + 'px';
  dash.style.background = argb(model.BackgroundColor);

  function build(items, parent, parentEntry) {
    for (const item of items) {
      const isButton = item.$type.includes('.ButtonItem,');
      const element = document.createElement(isButton ? 'button' : 'div');
      element.dataset.name = item.Name;
      if (item.Childrens) {
        element.className = 'layer';
      } else {
        element.className = 'item' + (item.IsTextItem ? ' text' : '');
        Object.assign(element.style, {
          left: item.Left + 'px', top: item.Top + 'px',
          width: item.Width + 'px', height: item.Height + 'px',
          background: argb(item.BackgroundColor),
        });
        if (item.$type.includes('.ImageItem,')) {
          if (!images[item.Image]) throw new Error('Missing dashboard image: ' + item.Image);
          element.style.backgroundImage = `url("${images[item.Image]}")`;
          element.style.backgroundSize = '100% 100%';
        }
        if (item.IsTextItem) {
          Object.assign(element.style, {
            fontFamily: `"${item.Font}", sans-serif`, fontSize: item.FontSize + 'px',
            color: argb(item.TextColor),
            justifyContent: ['flex-start', 'center', 'flex-end'][item.HorizontalAlignment],
          });
          element.textContent = item.Text;
        }
        if (isButton) {
          element.type = 'button';
          element.classList.add('media-button');
          element.setAttribute('aria-label', item.Name.replace('Music ', '').replace(' button', '') + ' (demo)');
          element.addEventListener('click', () => {
            if (item.TriggerAction === 'GraphicalDashPlugin.NextScreen') {
              screenIndex = (screenIndex + 1) % model.Screens.length;
              entries.length = 0;
              dash.replaceChildren();
              build(model.Screens[screenIndex].Items, dash);
              demo(performance.now());
              return;
            }
            if (stateControl.value === 'missing') {
              document.getElementById('notice').textContent = 'DEMO ONLY / No active media session. Open a compatible player in the real SimHub dashboard.';
              return;
            }
            if (item.TriggerAction === 'SystemInfosProvider.MediaNext') trackIndex = (trackIndex + 1) % tracks.length;
            else if (item.TriggerAction === 'SystemInfosProvider.MediaPrevious') trackIndex = (trackIndex + tracks.length - 1) % tracks.length;
            else if (item.TriggerAction === 'SystemInfosProvider.MediaPlayPause') musicPaused = !musicPaused;
            else throw new Error('Unknown demo media action: ' + item.TriggerAction);
            document.getElementById('notice').textContent =
              'DEMO ONLY / ' + (musicPaused ? 'PAUSED' : 'PLAYING') + ' / ' + tracks[trackIndex][0] + ' / No real player is controlled.';
            demo(performance.now());
          });
        }
      }
      const bindings = Object.entries(item.Bindings || {}).map(([key, b]) => {
        const evaluate = new Function('$prop', 'root', b.Formula.Expression), root = {};
        return [key, prop => evaluate(prop, root)];
      });
      const entry = { item, element, bindings, parent: parentEntry, visible: true, values: new Map() };
      entries.push(entry);
      parent.append(element);
      if (item.Childrens) build(item.Childrens, element, entry);
    }
  }
  build(model.Screens[0].Items, dash);

  function svgNode(tag, attrs = {}, content) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function point(cx, cy, radius, angle) {
    const radians = angle * Math.PI / 180;
    return [cx + Math.cos(radians) * radius, cy + Math.sin(radians) * radius];
  }
  function line(svg, a, b, color, width) {
    svg.append(svgNode('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: color, 'stroke-width': width }));
  }
  function drawDial(element, item) {
    const signature = JSON.stringify(item);
    if (element.dataset.renderSignature === signature) return;
    element.dataset.renderSignature = signature;
    const svg = svgNode('svg', { viewBox: `0 0 ${item.Width} ${item.Height}`, width: '100%', height: '100%', 'aria-label': item.Name });
    const cx = item.Width / 2, cy = item.Height / 2, radius = item.OuterRadius;
    const angle = value => item.StartAngle + item.SweepAngle * (value - item.Minimum) / (item.Maximum - item.Minimum);
    const step = item.MajorDivisionsCount;
    svg.append(svgNode('circle', { cx, cy, r: radius, fill: argb(item.DialBackgroundColor), stroke: argb(item.DialStrokeColor), 'stroke-width': 2 }));
    for (let value = item.Minimum, index = 0; value <= item.Maximum + 0.0001; value += step, index++) {
      const a = angle(value), r = item.MajorTickRadius;
      const warning = value > item.RangeOptimalEndValue;
      const color = warning ? argb(item.AboveOptimalStyle.ArcColor) : argb(item.MajorTickColor);
      line(svg, point(cx, cy, r - 13, a), point(cx, cy, r, a), color, 3);
      const labelPoint = point(cx, cy, item.ScaleLabelStyle.LabelRadius, a);
      svg.append(svgNode('text', { x: labelPoint[0], y: labelPoint[1], fill: color,
        'font-family': 'Segoe UI, sans-serif', 'font-size': item.ScaleLabelStyle.LabelFontSize,
        'text-anchor': 'middle', 'dominant-baseline': 'central' }, Number(value.toFixed(2))));
      if (value + step <= item.Maximum + 0.0001) {
        for (let minor = 1; minor < item.MinorDivisionsCount; minor++) {
          const minorAngle = angle(value + step * minor / item.MinorDivisionsCount);
          line(svg, point(cx, cy, r - 6, minorAngle), point(cx, cy, r, minorAngle), argb(item.MinorTickColor), 1);
        }
      }
    }
    if (item.ShowNeedle) {
      line(svg, [cx, cy], point(cx, cy, item.NeedleLength, angle(item.Value)), argb(item.MajorTickColor), item.NeedleThickness);
      svg.append(svgNode('circle', { cx, cy, r: item.CapRadius, fill: argb(item.MajorTickColor) }));
    }
    element.replaceChildren(svg);
    element.dataset.value = item.Value;
    element.dataset.maximum = item.Maximum;
    element.dataset.needle = item.ShowNeedle;
  }
  const circuit = [[0.10, 0.58], [0.16, 0.20], [0.40, 0.10], [0.50, 0.30],
    [0.80, 0.18], [0.92, 0.42], [0.78, 0.70], [0.56, 0.87], [0.38, 0.58], [0.22, 0.88]];
  function drawAwareness(element, item) {
    const signature = JSON.stringify([item, stateControl.value, demoDrivers]);
    if (element.dataset.renderSignature === signature) return;
    element.dataset.renderSignature = signature;
    const map = item.Name === 'Track minimap';
    const svg = svgNode('svg', { viewBox: map ? '0 0 400 220' : '0 0 208 208', width: '100%', height: '100%' });
    const state = stateControl.value;
    if (map && state === 'noMap') {
      svg.append(svgNode('text', { x: 200, y: 110, fill: '#b07840', 'text-anchor': 'middle', 'font-size': 17 }, 'NO RECORDED MAP / DEMO'));
    } else {
      if (map) {
        svg.append(svgNode('polygon', { points: circuit.map(([x, y]) => `${x * 400},${y * 220}`).join(' '),
          fill: 'none', stroke: argb(item.TrackColor), 'stroke-width': 5, 'stroke-linejoin': 'round' }));
      }
      for (const driver of demoDrivers.filter(d => d.player || state !== 'noOpponents')) {
        if (map && !Number.isInteger(driver.mapIndex)) continue;
        if (!map && !driver.nearby && !driver.player) continue;
        const index = driver.mapIndex;
        const x = map ? circuit[index][0] * 400 : 104 + driver.x * 6;
        const y = map ? circuit[index][1] * 220 : 104 - driver.y * 6;
        const color = driver.player ? '#ff8a1c' : driver.carClass === 'GT' ? '#ffb02e' : '#78a34d';
        svg.append(svgNode('circle', { cx: x, cy: y, r: driver.player ? 9 : 7, fill: color, stroke: '#070504', 'stroke-width': 2 }));
        if (map) svg.append(svgNode('text', { x, y: y - 13, fill: color, 'text-anchor': 'middle', 'font-size': 13 }, driver.player ? 'YOU' : driver.classPosition));
      }
      svg.append(svgNode('text', { x: map ? 200 : 104, y: map ? 216 : 204, fill: '#b07840',
        'text-anchor': 'middle', 'font-size': map ? 10 : 9 }, 'FICTIONAL PREVIEW DATA'));
    }
    element.replaceChildren(svg);
  }
  function demo(time) {
    const game = gameControl.value;
    const state = stateControl.value;
    const phase = animate.checked ? Math.sin(time / 2000) : 0;
    const data = {
      CarModel: game === 'AssettoCorsaRally' ? 'RALLY / GROUP A' : 'GT / ENDURANCE',
      TrackName: game === 'AssettoCorsaRally' ? 'MOUNTAIN STAGE' : 'MANGODASH DEMO CIRCUIT',
      SpeedKmh: 248 + phase * 34, Rpms: 7240 + phase * 800,
      Gear: 5, Fuel: 62, MaxFuel: 100,
      BrakeBias: 54.2, ABSLevel: 3, TCLevel: 4, TractionControlCut: 2, EngineMap: 1,
      AirTemperature: 22, TrackTemperature: 31.5,
      Position: 3, CurrentLap: 12,
      CurrentLapTime: '00:01:42.368', LastLapTime: '00:01:43.106', BestLapTime: '00:01:42.012',
      WaterTemperature: 88, OilTemperature: 104, Throttle: 82 + phase * 18, Brake: 0, Clutch: 0, Handbrake: 0,
      TyreTemperatureFrontLeft: 84, TyreTemperatureFrontRight: 88,
      TyreTemperatureRearLeft: 81, TyreTemperatureRearRight: 85,
      TyreWearFrontLeft: 92, TyreWearFrontRight: 89.5,
      TyreWearRearLeft: 94, TyreWearRearRight: 91,
      PitLimiterOn: state === 'pit', IsInPitLane: state === 'pit', GamePaused: state === 'paused',
      Flag_Green: !state.startsWith('flag'), Flag_Yellow: state === 'flagYellow',
      Flag_Blue: state === 'flagBlue', Flag_Checkered: state === 'flagCheckered',
      Flag_Name: state === 'flagRed' ? 'Red' : '',
      CarId: 'preview-car', CarClass: 'GT', PlayerClassOpponentsCount: 3, OpponentsCount: 5,
      MapAllowed: true, CarCoordinates01: 120, CarCoordinates03: 45,
    };
    for (const [index, corner] of ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight'].entries()) {
      if (tyreControl.value === 'fresh') data['TyreWear' + corner] = 100;
      if (tyreControl.value === 'worn') data['TyreWear' + corner] = [0, 12.5, 24, 8][index];
      if (['missingWear', 'missing'].includes(tyreControl.value)) delete data['TyreWear' + corner];
      if (tyreControl.value === 'missing') delete data['TyreTemperature' + corner];
    }
    demoDrivers = [
      { name: 'M. VIOLET / LMP', carClass: 'LMP', classPosition: 1, mapIndex: 3, nearby: true, x: -4, y: 9 },
      { name: 'A. RIVERS / GT', carClass: 'GT', classPosition: 1, gapToPlayer: -2.456, mapIndex: 4, nearby: true, x: 4, y: 14 },
      { name: 'YOU / GT', carClass: 'GT', classPosition: 2, player: true, mapIndex: 5, x: 0, y: 0 },
      { name: 'P. LILAC / LMP', carClass: 'LMP', classPosition: 2, mapIndex: 6, nearby: true, x: -4, y: -6 },
      { name: 'J. MEADOW / GT', carClass: 'GT', classPosition: 3, gapToPlayer: 1.234, mapIndex: 7, nearby: true, x: 5, y: -13 },
    ];
    if (state === 'fullGrid') {
      for (let i = 6; i <= 47; i++) demoDrivers.push({ name: `DEMO DRIVER ${i}`, carClass: i % 2 ? 'GT' : 'LMP' });
    }
    data.OpponentsCount = demoDrivers.length;
    if (state === 'leader') demoDrivers = demoDrivers.filter(d => d.name !== 'A. RIVERS / GT');
    if (state === 'last') demoDrivers = demoDrivers.filter(d => d.name !== 'J. MEADOW / GT');
    if (state === 'solo') demoDrivers = demoDrivers.filter(d => d.player || d.carClass !== 'GT');
    for (const driver of demoDrivers.filter(d => !d.player && d.carClass === 'GT')) {
      if (state === 'noGap') driver.gapToPlayer = null;
      if (state === 'zeroGap') driver.gapToPlayer = 0;
      if (state === 'lapped') {
        driver.lapsToPlayer = driver.gapToPlayer < 0 ? -1 : 1;
        driver.gapToPlayer = null;
      }
    }
    const classDrivers = demoDrivers.filter(d => d.carClass === 'GT');
    classDrivers.forEach((driver, index) => { driver.classPosition = index + 1; });
    data.PlayerClassOpponentsCount = classDrivers.length;
    data.Position = demoDrivers.findIndex(d => d.player) + 1;
    if (state === 'noClass') delete data.CarClass;
    if (state === 'noPosition') { data.MapAllowed = false; delete data.CarCoordinates01; delete data.CarCoordinates03; }
    if (state === 'shift') { data.Rpms = 7900; data.SpeedKmh = 272; data.Gear = 6; }
    if (state === 'low') data.Fuel = data.MaxFuel * 0.06;
    properties = {
      'DataCorePlugin.CurrentGame': game === 'idle' ? '' : game,
      'DataCorePlugin.GameRunning': game !== 'idle',
      'DataCorePlugin.GamePaused': state === 'paused',
      'DataCorePlugin.GameRawData.mWindSpeed': game === 'Automobilista2' ? 3.5 : null,
      MaxRpm: vehicleControl.value === 'fallback' ? null : vehicleControl.value === 'highrev' ? 16000 : 8000,
      'DataCorePlugin.Computed.DeltaBest': -0.356 + phase * 0.5,
      'SystemInfosProvider.Title': tracks[trackIndex][0],
      'SystemInfosProvider.Artist': tracks[trackIndex][1],
    };
    if (vehicleControl.value === 'highrev') data.Rpms = 13500 + phase * 2000;
    if (state !== 'missing') {
      for (const [key, value] of Object.entries(data)) properties['DataCorePlugin.GameData.NewData.' + key] = value;
      const demoDetails = {
        fuelLaps: 18.5, fuelToFinish: 70, fuelToAdd: 8, fuelPerLap: 3.35,
        sessionSeconds: 1800, sessionLaps: 21, sector1Seconds: 31.123, sector2Seconds: 35.456,
        sector3Seconds: 36.789, pitLimitKmh: 80, pitRequested: false, plannedService: 'FUEL + TYRES',
        pressureFL: 26.5, pressureFR: 26.8, pressureRL: 26.3, pressureRR: 26.4,
        compound: 'MEDIUM', absActive: false, tcActive: true, damage: 'NONE', damageActive: false,
        brakeFL: 460, brakeFR: 455, brakeRL: 360, brakeRR: 355, drsAvailable: true, drsActive: false,
        turboBar: 1.2, transmission: 'NORMAL', p2pAvailable: true, p2pCooldownSeconds: 12,
        p2pSeconds: 35, stintSeconds: 1200, tyreLaps: 12, fuelStintLaps: 12,
        virtualEnergyPercent: 65, virtualEnergyMj: 120, raceControl: 'GREEN',
        penalties: 'NONE', penaltyActive: false, stageSeconds: 204.812, stageProgressPercent: 42,
        stageDistanceKm: 5.8, stageSplitSeconds: -1.25, stageResult: 'P3 / +2.4 s',
      };
      for (const [key, value] of Object.entries(demoDetails)) properties['Demo.' + key] = value;
    } else {
      for (const key of Object.keys(properties)) {
        if (!['DataCorePlugin.CurrentGame', 'DataCorePlugin.GameRunning'].includes(key)) delete properties[key];
      }
    }
    for (const entry of entries) {
      const { item, element, bindings } = entry;
      if (entry.parent && !entry.parent.visible) {
        entry.visible = false;
        continue;
      }
      entry.visible = true;
      const resolved = { ...item };
      for (const [key, evaluate] of bindings) {
        const value = evaluate(property);
        resolved[key] = value;
        if (key === 'Visible') entry.visible = value;
        if (entry.values.has(key) && Object.is(entry.values.get(key), value)) continue;
        entry.values.set(key, value);
        if (key === 'Visible') element.style.display = value ? '' : 'none';
        else if (key === 'Text') element.textContent = value;
        else if (key === 'TextColor') element.style.color = argb(value);
        else if (key === 'Width') element.style.width = value + 'px';
        else if (key === 'Height') element.style.height = value + 'px';
        else if (key === 'Top') element.style.top = value + 'px';
        else if (key === 'Opacity') element.style.opacity = value / 100;
        else if (['Value', 'Maximum', 'MajorDivisionsCount', 'ShowNeedle', 'RangeOptimalEndValue', 'MajorTickColor', 'DialStrokeColor', 'LeaderboardPosition'].includes(key)) { /* Drawn below. */ }
        else throw new Error(`Preview does not implement ${key} on ${item.Name}`);
      }
      if (!entry.visible) continue;
      if (item.$type.includes('.DialGaugeItem,')) drawDial(element, resolved);
      if (item.$type.includes('.LeaderboardOpponentNameText,') || item.$type.includes('.LeaderboardOpponentGap,')) {
        const ownClass = demoDrivers.filter(d => d.carClass === data.CarClass);
        const player = ownClass.findIndex(d => d.player);
        const rival = !resolved.LeaderboardPositionRelativeToPlayer ? demoDrivers[resolved.LeaderboardPosition - 1] :
          player < 0 ? null : ownClass[player + resolved.LeaderboardPosition - 1];
        if (!resolved.LeaderboardPositionRelativeToPlayer) {
          if (element.style.overflow !== 'hidden') element.style.overflow = 'hidden';
          if (element.style.whiteSpace !== 'nowrap') element.style.whiteSpace = 'nowrap';
          const color = rival?.player ? item.PlayerStyle.TextColor : item.OpponentStyle.TextColor;
          if (element.dataset.driverColor !== color) {
            element.style.color = argb(color);
            element.dataset.driverColor = color;
          }
        }
        let content;
        if (item.$type.includes('.LeaderboardOpponentGap,')) {
          content = !rival ? item.NoDataText :
            Number.isFinite(rival.gapToPlayer) ? (rival.gapToPlayer > 0 ? '+' : '') + rival.gapToPlayer.toFixed(3) + item.TextAfterValue :
              rival.lapsToPlayer ? (rival.lapsToPlayer > 0 ? '+' : '') + rival.lapsToPlayer + ' lap' +
                (Math.abs(rival.lapsToPlayer) > 1 ? 's' : '') : item.EmptyValueText;
        } else content = rival ? rival.name : item.NoDataText;
        if (element.textContent !== content) element.textContent = content;
      }
      if (item.Name === 'Track minimap' || item.Name === 'Nearby radar') drawAwareness(element, resolved);
    }
  }
  function fit() {
    const scale = Math.min(viewport.clientWidth / model.BaseWidth, viewport.clientHeight / model.BaseHeight);
    dash.style.transform = `scale(${scale})`;
  }
  document.getElementById('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewport.requestFullscreen();
    } catch (error) {
      document.getElementById('notice').textContent = 'Fullscreen failed: ' + error.message;
    }
  });
  gameControl.addEventListener('change', () => demo(performance.now()));
  stateControl.addEventListener('change', () => demo(performance.now()));
  vehicleControl.addEventListener('change', () => demo(performance.now()));
  tyreControl.addEventListener('change', () => demo(performance.now()));
  new ResizeObserver(fit).observe(viewport);
  let last = 0;
  function frame(time) {
    if (time - last >= 50) { demo(time); last = time; }
    requestAnimationFrame(frame);
  }
  demo(0);
  fit();
  requestAnimationFrame(frame);
})();
