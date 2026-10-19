import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDashboard, mediaActions } from '../tools/generate.mjs';
import { formula, helpers } from '../tools/telemetry.mjs';
import { dashboardImages, gaugeHubImage, shiftLightImages, standbyImages, standbyResources } from '../tools/standby.mjs';
import { inflateSync } from 'node:zlib';
import { detailFields } from '../tools/details.mjs';

function evaluate(expression, props = {}) {
  return new Function('$prop', formula(expression).Expression)(key => props[key] ?? null);
}
function flatten(items) {
  return items.flatMap(item => [item, ...flatten(item.Childrens || [])]);
}
function props(game = 'AssettoCorsa', values = {}) {
  return {
    'DataCorePlugin.CurrentGame': game,
    'DataCorePlugin.GameRunning': true,
    'DataCorePlugin.GameData.SpeedKmh': 160,
    'DataCorePlugin.GameData.Rpms': 6000,
    'DataCorePlugin.GameData.Gear': 4,
    'DataCorePlugin.GameData.Fuel': 60,
    'DataCorePlugin.GameData.MaxFuel': 100,
    MaxRpm: 8000,
    ...values,
  };
}

test('lean formulas preserve full-helper behavior and cut embedded source by at least half', () => {
  const items = flatten(createDashboard(1920).Screens[0].Items);
  const expressions = items.flatMap(i => Object.values(i.Bindings || {}).map(b => b.Formula.Expression));
  let originalBytes = 0, optimizedBytes = 0;
  const FixedDate = class extends Date { constructor() { super(12345); } };
  for (const expression of expressions) {
    const body = expression.slice(expression.lastIndexOf('\n') + 1);
    const full = helpers + '\n' + body;
    originalBytes += full.length;
    optimizedBytes += expression.length;
    for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'Automobilista2', 'LeMansUltimate', 'Unknown']) {
      for (const data of [props(game), {}, props(game, { Fuel: 0, OpponentsCount: 47 })]) {
        const prop = key => data[key] ?? null;
        assert.deepEqual(new Function('$prop', 'Date', 'root', expression)(prop, FixedDate, {}),
          new Function('$prop', 'Date', 'root', full)(prop, FixedDate, {}));
      }
    }
  }
  assert.ok(optimizedBytes < originalBytes * 0.5, `${optimizedBytes} vs ${originalBytes} source characters`);
  for (const width of [1920, 2560]) {
    const entries = flatten(createDashboard(width).Screens[0].Items);
    const interval = name => entries.find(i => i.Name === name).MinimumRefreshIntervalMS;
    assert.equal(interval('RPM dial'), 50);
    assert.equal(interval('Throttle bar'), 50);
    assert.equal(interval('Grid driver 0'), 500);
    assert.equal(interval('Map Air'), 500);
    assert.equal(interval('Fuel state'), 100);
  }
});

test('all requested games and common game IDs route to exactly one driving mode', () => {
  const cases = {
    AssettoCorsa: 'race', 'Assetto Corsa': 'race', AC: 'race',
    AssettoCorsaRally: 'rally', ACRally: 'rally', 'Assetto Corsa Rally': 'rally',
    RichardBurnsRally: 'rally', 'Richard Burns Rally': 'rally', RBR: 'rally', RBRRSF: 'rally',
    RichardBurnsRallyRSF: 'rally', RallySimFansRBR: 'rally',
    Automobilista2: 'race', 'Automobilista 2': 'race', AMS2: 'race',
    LeMansUltimate: 'race', 'Le Mans Ultimate': 'race', LMU: 'race',
    ETS2: 'unsupported', EuroTruckSimulator2: 'unsupported',
    ATS: 'unsupported', AmericanTruckSimulator: 'unsupported', UnknownGame: 'unsupported',
  };
  for (const [game, mode] of Object.entries(cases)) {
    assert.equal(evaluate('return mode();', props(game)), mode, game);
    if (/^(RichardBurnsRally|Richard Burns Rally|RBR|RBRRSF|RichardBurnsRallyRSF|RallySimFansRBR)$/.test(game)) {
      assert.equal(evaluate('return gameName();', props(game)), 'RICHARD BURNS RALLY', game);
    }
    const dashboard = createDashboard(1920);
    const visibleLayouts = dashboard.Screens[0].Items.filter(item =>
      /layout$/.test(item.Name) && new Function('$prop', 'root', item.Bindings.Visible.Formula.Expression)(key => props(game)[key] ?? null, {}));
    assert.equal(visibleLayouts.length, 1, game);
    assert.equal(visibleLayouts[0].Name, { race: 'Circuit layout', rally: 'Rally layout', unsupported: 'Standby layout' }[mode]);
  }
});

test('welcome fades once on supported-game transitions, rearms on exit, and never delays an already-running game', () => {
  const expression = formula('return welcomeOpacity();').Expression;
  const root = {};
  const at = (game, running, time, state = root) => new Function('$prop', 'root', 'Date', expression)(
    key => props(game, { 'DataCorePlugin.GameRunning': running })[key] ?? null, state,
    class extends Date { constructor() { super(time); } });
  assert.equal(at('AssettoCorsa', true, 0, {}), 0, 'Opening an active dash does not obscure driving');
  assert.equal(at('', false, 0), 100);
  assert.equal(at('AssettoCorsa', true, 100), 100);
  assert.equal(at('AssettoCorsa', true, 350), 100, 'Welcome holds briefly');
  assert.equal(at('AssettoCorsa', true, 800), 50, '900ms smooth fade reaches half opacity');
  assert.equal(at('AssettoCorsa', true, 1250), 0);
  assert.equal(at('AssettoCorsa', true, 5000), 0, 'No looping welcome');
  assert.equal(at('Unknown', true, 5100), 100);
  assert.equal(at('AMS2', true, 5200), 100);
  assert.equal(at('AMS2', true, 6350), 0);
  assert.equal(at('LMU', true, 6400), 100, 'Direct game changes welcome the new game');
  assert.equal(at('LMU', false, 6500), 100, 'Exit during fade restores standby immediately');
  assert.equal(at('LMU', true, 6600), 100);
  for (let time = 6600; time < 9000; time += 25) {
    const alpha = at('LMU', true, time);
    assert.ok(alpha >= 0 && alpha <= 100);
  }
});

test('original ribbons are transparent PNGs in a deterministic named-resource ZIP', () => {
  const archive = standbyResources();
  let offset = 0;
  for (const image of dashboardImages) {
    assert.equal(archive.readUInt32LE(offset), 0x04034b50);
    const size = archive.readUInt32LE(offset + 18), nameLength = archive.readUInt16LE(offset + 26);
    assert.equal(archive.subarray(offset + 30, offset + 30 + nameLength).toString(), image.name + '.png');
    const png = archive.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    assert.deepEqual(png, image.bytes);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), image.metadata.Width);
    assert.equal(png.readUInt32BE(20), image.metadata.Height);
    assert.equal(png[25], 6, 'RGBA artwork');
    const width = image.metadata.Width, height = image.metadata.Height;
    const raw = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
    assert.equal(raw.length, (width * 4 + 1) * height);
    assert.equal(raw[4], 0, 'Artwork has transparent edges');
    if (standbyImages.includes(image)) {
      assert.equal(width, 1024);
      assert.equal(height, 256);
      assert.ok(raw.some((value, index) => index % (width * 4 + 1) > 0 &&
        (index % (width * 4 + 1) - 1) % 4 === 3 && value > 100), 'Ribbon is visible');
    } else {
      assert.equal(width, 64);
      const centerAlpha = raw[Math.floor(height / 2) * (width * 4 + 1) + 1 + Math.floor(width / 2) * 4 + 3];
      assert.ok(centerAlpha > 0, 'Circular LED has an opaque center');
    }
    offset += 30 + nameLength + size;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.equal(archive.readUInt16LE(archive.length - 12), dashboardImages.length);
  assert.deepEqual(archive, standbyResources());
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    for (const [index, image] of items.filter(i => i.Name.startsWith('Standby ribbon ')).entries()) {
      assert.ok(standbyImages.some(resource => resource.name === image.Image));
      assert.equal(image.MinimumRefreshIntervalMS, 50);
      assert.match(image.Bindings.Top.Formula.Expression, new RegExp(`/ ${2800 + index * 800}`));
      assert.equal(image.AutoSize, false);
      const root = {};
      const topAt = (active, time) => new Function('$prop', 'root', 'Date', image.Bindings.Top.Formula.Expression)(
        key => props('AC', { 'DataCorePlugin.GameRunning': active })[key] ?? null, root,
        class extends Date { constructor() { super(time); } });
      const position = topAt(false, 12000);
      assert.ok(Math.abs(position - image.Top) <= 24);
      assert.equal(topAt(true, 13000), position, 'Ribbons freeze without jumping during the welcome');
    }
    const idle = items.find(i => i.Name === 'Standby layout');
    assert.equal(createDashboard(width).Screens[0].Items.at(-1).Name, idle.Name, 'Welcome draws over the driving layout');
    for (const child of idle.Childrens) assert.ok(child.Bindings.Opacity);
  }
});

test('panel backgrounds enter after welcome without hiding live telemetry and rearm between games', () => {
  for (const width of [1920, 2560]) {
    const dashboard = createDashboard(width), entries = flatten(dashboard.Screens[0].Items);
    const panel = entries.find(i => i.Name === 'Driving panel'), root = {};
    const run = (time, game = 'AC', active = true) =>
      new Function('$prop', 'root', 'Date', panel.Bindings.Opacity.Formula.Expression)(
        key => props(game, { 'DataCorePlugin.GameRunning': active })[key] ?? null, root,
        class extends Date { constructor() { super(time); } });
    assert.equal(run(0, 'AC', false), 0);
    assert.equal(run(100), 0);
    assert.equal(run(1250), 0, 'Entrance begins after welcome');
    assert.equal(run(1425), 50);
    assert.equal(run(1600), 100);
    assert.equal(run(1650, 'Unknown'), 0);
    assert.equal(run(1700, 'LMU'), 0);
    assert.equal(run(3200, 'LMU'), 100);
    assert.equal(run(3250, 'LMU', false), 0);
    assert.equal(run(3300, 'ACRally'), 0);
    assert.equal(run(4800, 'ACRally'), 100);
    const fresh = new Function('$prop', 'root', panel.Bindings.Opacity.Formula.Expression)(key => props()[key] ?? null, {});
    assert.equal(fresh, 100);
    for (const name of ['Driving panel', 'Timing panel', 'Map panel', 'Tyre summary panel',
      'Rally timing panel', 'Rally stage panel', 'Music panel']) {
      const background = dashboard.Screens[0].Items.find(i => i.Name === name);
      assert.ok(background, `${name} clock is always evaluated`);
      assert.equal(background.MinimumRefreshIntervalMS, 50);
      assert.equal(background.$type.includes('.RectangleItem,'), true);
      assert.ok(!background.Bindings.Visible, 'Clock is not gated by visibility');
    }
    for (const name of ['Gear', 'Speed', 'RPM dial', 'Nearby radar', 'Track minimap', 'Throttle bar']) {
      assert.equal(entries.find(i => i.Name === name).Bindings.Opacity, undefined, name);
    }
    for (const game of ['AC', 'AMS2', 'LMU', 'ACRally', 'Unknown']) {
      for (const background of dashboard.Screens[0].Items.filter(i => i.Bindings?.Opacity)) {
        const opacity = new Function('$prop', 'root', background.Bindings.Opacity.Formula.Expression)(
          key => props(game)[key] ?? null, {});
        const expected = background.Name.startsWith('Rally') ? game === 'ACRally' :
          ['Timing panel', 'Map panel'].includes(background.Name) ? ['AC', 'AMS2', 'LMU'].includes(game) :
            background.Name === 'Music panel' ? game === 'AC' : game !== 'Unknown';
        assert.equal(opacity, expected ? 100 : 0, `${game}: ${background.Name}`);
      }
    }
  }
});

test('gear changes highlight immediately for 300ms and preserve neutral, reverse and multi-digit gears', () => {
  const root = {};
  const run = (value, time, extra = {}) =>
    new Function('$prop', 'root', 'Date', formula('return gearHighlightColor();').Expression)(
      key => props('AC', { Gear: value, 'DataCorePlugin.GameData.Gear': value, CarId: 'test', ...extra })[key] ?? null,
      root, class extends Date { constructor() { super(time); } });
  assert.equal(run(1, 0), '#FFFFAD32');
  assert.equal(run(2, 50), '#FFFFD06A');
  assert.equal(run(2, 200), '#FFFFBF4E');
  assert.equal(run(2, 350), '#FFFFAD32');
  assert.equal(run(2, 400), '#FFFFAD32');
  for (const [value, time] of [[0, 450], [-1, 500], [10, 550], ['N', 600], ['R', 650]]) {
    assert.equal(run(value, time), '#FFFFD06A');
  }
  for (const value of [null, '', true, false, 'bad', -2]) {
    assert.equal(run(value, 700), '#FFFFAD32');
    assert.equal(run(1, 750), '#FFFFAD32', 'Recovery is not a shift');
  }
  assert.equal(run(2, 800, { CarId: 'new-car' }), '#FFFFAD32');
  assert.equal(run(3, 1500, { CarId: 'new-car' }), '#FFFFAD32', 'Resume does not flash');
  assert.equal(run(4, 1550, { 'DataCorePlugin.GameRunning': false }), '#FFFFAD32');
  assert.equal(run(4, 1600), '#FFFFAD32');
  assert.equal(evaluate('return gear();', props('AC', { 'DataCorePlugin.GameData.Gear': 10 })), '10');
});

test('redline rim intensity uses adaptive limits at exact 90/95 percent thresholds without pulsing', () => {
  for (const limit of [2000, 8000, 16000]) {
    const at = rpm => evaluate('return redlineAccentColor();', props('AC', {
      'DataCorePlugin.GameData.MaxRpm': limit, 'DataCorePlugin.GameData.Rpms': rpm,
    }));
    assert.equal(at(limit * 0.9), '#FF303030');
    assert.equal(at(limit * 0.925), '#FF98362A');
    assert.equal(at(limit * 0.95), '#FFFF3B24');
    assert.equal(at(limit * 1.1), '#FFFF3B24');
    for (const bad of [null, '', true, 'bad', -1, 0]) assert.equal(at(bad), '#FF303030');
  }
  assert.equal(evaluate('return redlineAccentColor();', props('AC', {
    'DataCorePlugin.GameRunning': false, 'DataCorePlugin.GameData.Rpms': 9000,
  })), '#FF303030');
  for (const width of [1920, 2560]) {
    const entries = flatten(createDashboard(width).Screens[0].Items);
    const rpm = entries.find(i => i.Name === 'RPM dial');
    assert.match(rpm.Bindings.DialStrokeColor.Formula.Expression, /return rpmBezelColor\(\)/);
    assert.equal(rpm.MajorTickColor, '#FFEBCBB4');
    assert.equal(rpm.ScaleLabelStyle.LabelColor, '#FFEBCBB4');
    assert.equal(rpm.NeedleColor, '#FFFF7748');
    assert.equal(rpm.NeedleThickness, 3);
    assert.equal(rpm.CapRadius, 12);
    for (const name of ['Fuel dial', 'Oil temperature dial', 'Coolant temperature dial']) {
      const dial = entries.find(i => i.Name === name);
      assert.equal(dial.NeedleColor, rpm.NeedleColor, `${name} needle color matches RPM`);
      assert.equal(dial.NeedleThickness, rpm.NeedleThickness, `${name} needle thickness matches RPM`);
      assert.ok(Math.abs(dial.CapRadius / dial.OuterRadius - rpm.CapRadius / rpm.OuterRadius) < 0.001,
        `${name} hub scales with RPM`);
      assert.ok(Math.abs(dial.NeedleLength / dial.OuterRadius - rpm.NeedleLength / rpm.OuterRadius) < 0.001,
        `${name} needle proportion matches RPM`);
    }
    const hub = entries.find(i => i.Name === 'RPM center hub');
    assert.equal(hub.Image, gaugeHubImage.name);
    assert.match(hub.$type, /\.ImageItem,/);
    assert.equal(hub.Left + hub.Width / 2, rpm.Left + rpm.Width / 2);
    assert.equal(hub.Top + hub.Height / 2, rpm.Top + rpm.Height / 2);
    assert.equal(entries.some(item => item.Name.startsWith('RPM shift light ')), false);
    const diffuser = entries.find(item => item.Name === 'RPM bezel diffuser glow');
    assert.ok(entries.indexOf(diffuser) < entries.indexOf(rpm), 'Glow sits behind the gauge face');
    assert.deepEqual([diffuser.Left, diffuser.Top, diffuser.Width, diffuser.Height],
      [rpm.Left, rpm.Top, rpm.Width, rpm.Height]);
    assert.equal(diffuser.ShowNeedle, false);
    assert.equal(diffuser.DialBackgroundColor, '#00000000');
    assert.equal(diffuser.OuterRadius, rpm.OuterRadius + 2);
    assert.equal(diffuser.OuterStrokeThickness, 12);
    assert.equal(rpm.OuterStrokeThickness, 5);
    assert.ok(diffuser.OuterRadius + diffuser.OuterStrokeThickness / 2 <= diffuser.Width / 2);
    assert.match(entries.find(i => i.Name === 'Gear').Bindings.TextColor.Formula.Expression, /return gearHighlightColor\(\)/);
  }
});

test('RPM diffuser uses the actual rev limit independently of rounded dial scales', () => {
  const at = (limit, rpm, running = true) => evaluate('return rpmDiffuserColor();', props('AC', {
    'DataCorePlugin.GameData.MaxRpm': limit, MaxRpm: limit,
    'DataCorePlugin.GameData.Rpms': rpm, 'DataCorePlugin.GameRunning': running,
  }));
  for (const ratio of [0, 0.25, 0.7, 0.85, 0.9, 0.95, 1, 1.1]) {
    const expected = at(8000, 8000 * ratio);
    for (const limit of [2750, 8500, 15500, 16000]) {
      assert.equal(at(limit, limit * ratio), expected);
      if (ratio >= 0.95) assert.equal(expected, '#FFFF3B24');
    }
  }
  assert.equal(at(8000, 5600), '#FFFFB02E');
  for (const invalid of [null, '', true, 'bad', -1]) {
    assert.equal(at(8000, invalid), '#FF303030');
    assert.equal(at(invalid, 7000), '#FF303030');
  }
  assert.equal(at(8000, 8000, false), '#FF303030');
  assert.equal(at(16000, 13500), at(8000, 6750));
});

test('RPM bezel and glow flash together at 95 percent of the live limit', () => {
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    for (const name of ['RPM dial', 'RPM bezel diffuser glow']) {
      const expression = items.find(item => item.Name === name).Bindings.DialStrokeColor.Formula.Expression;
      const expected = color => name === 'RPM dial' ? color : '#40' + color.slice(3);
      const at = (limit, rpm, time, running = true) => {
        const input = props('AC', {
          'DataCorePlugin.GameData.MaxRpm': limit, MaxRpm: limit,
          'DataCorePlugin.GameData.Rpms': rpm, 'DataCorePlugin.GameRunning': running,
        });
        const FixedDate = class extends Date { constructor() { super(time); } };
        return new Function('$prop', 'Date', expression)(key => input[key] ?? null, FixedDate);
      };
      for (const limit of [2750, 8000, 15500, 16000]) {
        for (const rpm of [limit * 0.95, limit, limit * 1.1]) {
          for (const time of [0, 249, 500]) assert.equal(at(limit, rpm, time), expected('#FFFF3B24'));
          for (const time of [250, 499, 750]) assert.equal(at(limit, rpm, time), expected('#FF50302B'));
        }
        assert.equal(at(limit, limit * 0.95 - 1, 0), at(limit, limit * 0.95 - 1, 250));
        assert.equal(at(limit, limit, 250, false), expected('#FF303030'));
        for (const invalid of [null, '', true, 'bad', -1]) {
          assert.equal(at(limit, invalid, 250), expected('#FF303030'));
          assert.equal(at(invalid, limit, 250), expected('#FF303030'));
        }
      }
    }
  }
});

test('KERS and DRS use independent direct telemetry and hide when unavailable', () => {
  for (const prefix of ['DataCorePlugin.GameData.', 'DataCorePlugin.GameData.NewData.', '']) {
    const input = props('AC', { [prefix + 'KERSPercent']: 65,
      [prefix + 'DRSAvailable']: true, [prefix + 'DRSEnabled']: false });
    assert.equal(evaluate('return kersPercent();', input), 65);
    assert.equal(evaluate('return drsState();', input), 'READY');
  }
  for (const game of ['AC', 'AMS2', 'LMU']) {
    for (const value of [0, 1, 65, 100]) {
      assert.equal(evaluate('return kersPercent();', props(game, { KERSPercent: value })), value);
    }
    for (const value of [null, '', true, -1, 101, 'bad']) {
      assert.equal(evaluate('return kersPercent();', props(game, { KERSPercent: value })), null);
    }
    assert.equal(evaluate('return drsState();', props(game)), null);
    if (game === 'LMU') {
      assert.equal(evaluate('return drsState();', props(game, { DRSAvailable: true, DRSEnabled: true })), null);
      continue;
    }
    assert.equal(evaluate('return drsState();', props(game, { DRSAvailable: false, DRSEnabled: false })), 'OFF');
    assert.equal(evaluate('return drsState();', props(game, { DRSAvailable: true })), 'READY');
    assert.equal(evaluate('return drsState();', props(game, { DRSAvailable: true, DRSEnabled: true })), 'ACTIVE');
  }
  for (const game of ['RichardBurnsRally', 'AssettoCorsaRally', 'unsupported']) {
    const input = props(game, { KERSPercent: 80, DRSAvailable: true, DRSEnabled: true });
    assert.equal(evaluate('return kersPercent();', input), null);
    assert.equal(evaluate('return drsState();', input), null);
  }
  const disconnected = props('AC', { KERSPercent: 80, DRSEnabled: true, 'DataCorePlugin.GameRunning': false });
  assert.equal(evaluate('return kersPercent();', disconnected), null);
  assert.equal(evaluate('return drsState();', disconnected), null);
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const rpm = items.find(item => item.Name === 'RPM dial');
    const limit = items.find(item => item.Name === 'Cluster scale source');
    for (const name of ['KERS indicator', 'DRS indicator']) {
      const indicator = items.find(item => item.Name === name);
      const visible = input => new Function('$prop', indicator.Bindings.Visible.Formula.Expression)(key => input[key] ?? null);
      assert.equal(visible(props('AC')), false);
      assert.equal(visible(props('AC', { KERSPercent: 0 })), name === 'KERS indicator');
      assert.equal(visible(props('AC', { DRSEnabled: false })), name === 'DRS indicator');
      for (const child of indicator.Childrens) {
        assert.ok(child.Top >= rpm.Top + rpm.Height + 12);
        assert.ok(child.Top + child.Height <= limit.Top);
        assert.ok(child.Left >= rpm.Left && child.Left + child.Width <= rpm.Left + rpm.Width);
      }
    }
  }
});

test('night palette is warm across native layouts, dynamic colours and original ribbon artwork', () => {
  const oldColors = /#(?:FF)?(?:090F17|111C29|0C1520|233447|F3F7FC|8496AA|55DDE6|42E6B0|FFBF69|FF6B78)/i;
  for (const width of [1920, 2560]) {
    const dashboard = createDashboard(width), items = flatten(dashboard.Screens[0].Items);
    assert.equal(dashboard.BackgroundColor, '#FF050505');
    assert.ok(!oldColors.test(JSON.stringify(dashboard)), 'No old cool palette remains in generated native output');
    for (const name of ['RPM dial', 'Fuel dial']) {
      const dial = items.find(i => i.Name === name);
      assert.match(dial.MajorTickColor, /^#(?:FFE2DFD5|FFFFB02E|FFEBCBB4)$/);
    }
    assert.equal(items.find(i => i.Name === 'Gear').TextColor, '#FFFFB02E');
    assert.equal(items.find(i => i.Name === 'Map panel').BackgroundColor, '#FF101010');
    assert.equal(items.find(i => i.Name === 'Track minimap').OverrideColorsWithCarClassColors, true);
  }
  assert.ok(!oldColors.test(helpers));
  for (const image of standbyImages) {
    const raw = inflateSync(image.bytes.subarray(41, 41 + image.bytes.readUInt32BE(33)));
    assert.equal(raw[1], 255);
    assert.ok(raw[2] > raw[3] && raw[2] < raw[1], 'Ribbon RGB is warm orange');
  }
});

test('track flags show reported states without inventing green and limiter distinguishes OFF from missing', () => {
  for (const game of ['AC', 'AMS2', 'LMU']) {
    for (const name of ['Black', 'Orange', 'Checkered', 'Yellow', 'Blue', 'White', 'Green']) {
      for (const active of [true, 1, 'True', 'true', '1']) {
        assert.equal(evaluate('return trackFlagText();', props(game, { ['Flag_' + name]: active })),
          'FLAG / ' + name.toUpperCase());
      }
    }
    assert.equal(evaluate('return trackFlagText();', props(game, { Flag_Name: 'Red' })), 'FLAG / RED');
    assert.equal(evaluate('return trackFlagText();', props(game, { Flag_Name: 'Red', Flag_Yellow: 1 })), 'FLAG / RED +1');
    assert.equal(evaluate('return trackFlagText();', props(game, { Flag_Yellow: 1, Flag_Blue: 1 })), 'FLAG / YELLOW +1');
    assert.equal(evaluate("return trackFlagActive('YELLOW');", props(game, { Flag_Yellow: 1 })), true);
    assert.equal(evaluate("return trackFlagActive('BLUE');", props(game, { Flag_Yellow: 1 })), false);
    for (const bad of [null, false, 0, '', 'bad', 2]) {
      assert.equal(evaluate('return trackFlagText();', props(game, { Flag_Green: bad })), 'FLAG / --');
    }
    for (const [state, expected] of [[true, 'ON'], [1, 'ON'], ['True', 'ON'], [false, 'OFF'],
      [0, 'OFF'], ['false', 'OFF'], [null, '--'], ['', '--'], ['bad', '--'], [2, '--']]) {
      assert.equal(evaluate('return pitLimiterText();', props(game, { PitLimiterOn: state })), 'PIT LIMITER / ' + expected);
    }
    const stopped = props(game, { 'DataCorePlugin.GameRunning': false, Flag_Yellow: true, PitLimiterOn: true });
    assert.equal(evaluate('return trackFlagText();', stopped), 'FLAG / --');
    assert.equal(evaluate('return pitLimiterText();', stopped), 'PIT LIMITER / --');
  }
  assert.equal(evaluate('return trackFlagText();', props('ACRally', { Flag_Yellow: true })), 'FLAG / --');
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const limiter = items.find(i => i.Name === 'Pit limiter'), rpm = items.find(i => i.Name === 'RPM dial');
    assert.equal(limiter.Text, 'PIT');
    const pitLedFrame = items.find(i => i.Name === 'Pit limiter LED frame');
    const pitLedOff = items.find(i => i.Name === 'Pit limiter LED off');
    const pitLedOn = items.find(i => i.Name === 'Pit limiter LED on');
    assert.match(pitLedFrame.$type, /\.RectangleItem,/);
    assert.match(pitLedOff.$type, /\.RectangleItem,/);
    assert.match(pitLedOn.$type, /\.RectangleItem,/);
    assert.equal(pitLedFrame.Width, 48);
    assert.equal(pitLedFrame.Height, 48);
    assert.equal(pitLedOff.BackgroundColor, '#FF50321C');
    assert.equal(pitLedOn.BackgroundColor, '#FFFF8A1C');
    assert.deepEqual([pitLedFrame.RadiusTopLeft, pitLedFrame.RadiusTopRight,
      pitLedFrame.RadiusBottomRight, pitLedFrame.RadiusBottomLeft], [6, 6, 6, 6]);
    for (const led of [pitLedOff, pitLedOn]) {
      assert.deepEqual([led.RadiusTopLeft, led.RadiusTopRight, led.RadiusBottomRight, led.RadiusBottomLeft], [4, 4, 4, 4]);
    }
    const ledVisible = (item, state) => new Function('$prop', item.Bindings.Visible.Formula.Expression)(
      key => props('AC', state === undefined ? {} : { PitLimiterOn: state })[key] ?? null);
    assert.equal(ledVisible(pitLedFrame, true), true);
    assert.equal(ledVisible(pitLedFrame, false), true);
    assert.equal(ledVisible(pitLedFrame), false);
    assert.equal(ledVisible(pitLedOff, true), false);
    assert.equal(ledVisible(pitLedOn, true), true);
    assert.equal(ledVisible(pitLedOff, false), true);
    assert.equal(ledVisible(pitLedOn, false), false);
    assert.equal(ledVisible(pitLedOff), false);
    assert.equal(ledVisible(pitLedOn), false);
    for (const led of [pitLedFrame, pitLedOff, pitLedOn]) {
      assert.ok(led.Left >= rpm.Left && led.Left + led.Width <= rpm.Left + rpm.Width);
      assert.ok(led.Top >= rpm.Top && led.Top + led.Height <= rpm.Top + rpm.Height);
    }
    const cx = rpm.Left + rpm.Width / 2, cy = rpm.Top + rpm.Height / 2;
    for (const x of [limiter.Left, limiter.Left + limiter.Width]) {
      for (const y of [limiter.Top, limiter.Top + limiter.Height]) assert.ok(Math.hypot(x - cx, y - cy) < rpm.OuterRadius);
    }
    const flagLayer = items.find(i => i.Name === 'Track flag indicators'), heading = items.find(i => i.Name === 'Drive mode');
    const drivingPanel = items.find(i => i.Name === 'Driving panel');
    const flagTiles = items.filter(i => /^Track flag (BLACK|ORANGE|CHECKERED|YELLOW|BLUE|WHITE|GREEN|RED)$/.test(i.Name));
    assert.equal(flagTiles.length, 8);
    assert.equal(items.some(i => i.Name === 'Track flag'), false, 'Text flag label is replaced by visual flags');
    assert.equal(flagLayer.Childrens.length, 18, 'All flag tiles and checkered squares are present');
    const activeFlagNames = flags => flagTiles.filter(tile => {
      const visible = new Function('$prop', tile.Bindings.Visible.Formula.Expression);
      return visible(key => props('AC', flags)[key] ?? null);
    }).map(tile => tile.Name).sort();
    assert.deepEqual(activeFlagNames({ Flag_Yellow: true }), ['Track flag YELLOW']);
    assert.deepEqual(activeFlagNames({ Flag_Yellow: true, Flag_Blue: true }), ['Track flag BLUE', 'Track flag YELLOW']);
    assert.deepEqual(activeFlagNames({}), [], 'Missing flag data shows no invented flag');
    for (const tile of flagTiles) {
      assert.ok(tile.Left >= heading.Left + heading.Width);
      assert.ok(tile.Left + tile.Width <= drivingPanel.Left + drivingPanel.Width - 24);
      assert.equal(tile.Width, 36);
      assert.equal(tile.Height, 30);
      assert.equal(tile.MinimumRefreshIntervalMS, 100);
      assert.ok(tile.Bindings.Visible);
    }
    for (const name of ['Class divider', 'Leaderboard divider']) {
      assert.equal(items.find(i => i.Name === name).BackgroundColor, '#FF68523A');
    }
    assert.equal(items.find(i => i.Name === 'Ahead caption').FontSize, 13);
    assert.equal(items.find(i => i.Name === 'Ahead caption').TextColor, '#FFC5B39A');
    assert.equal(limiter.MinimumRefreshIntervalMS, 100);
  }
});

test('auxiliary temperatures use only normalized SimHub readings', () => {
  for (const key of ['OilTemperature', 'WaterTemperature']) {
    for (const [value, expected] of [[95, 95], [0, null], [-1, null], [null, null], [true, null], ['', null]]) {
      assert.equal(evaluate(`return engineTemperature('${key}');`, props('AC', { [key]: value })), expected);
    }
  }
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    for (const name of ['Oil', 'Coolant']) {
      const dial = items.find(i => i.Name === `${name} temperature dial`);
      assert.equal(dial.Width, 112);
      assert.equal(new Function('$prop', dial.Bindings.ShowNeedle.Formula.Expression)(() => null), false);
    }
  }
});

test('optional boost placeholders are not generated without direct SimHub channels', () => {
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    assert.equal(items.some(i => i.Name === 'Circuit boost'), false);
    assert.equal(items.some(i => i.Name.startsWith('Boost ')), false);
  }
});

test('header media and fixed panel structure are consistent across games and resolutions', () => {
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const get = name => items.find(i => i.Name === name);
    const music = get('Music panel'), status = get('Status'), car = get('Car and track');
    assert.ok(car.Left + car.Width < music.Left);
    assert.ok(music.Left + music.Width < status.Left);
    assert.ok(music.Top + music.Height < get('Header divider').Top);
    assert.equal(get('Header divider').Top, 84);
    assert.equal(get('Timing panel').Top, get('Header divider').Top + 20);
    assert.ok(get('Game name').Left + get('Game name').Width < car.Left, 'Game and car identity share one row');
    for (const item of items.filter(i => i.Name.startsWith('Music ') && i.Name !== 'Music controls')) {
      assert.ok(item.Left >= music.Left && item.Left + item.Width <= music.Left + music.Width, item.Name);
      assert.ok(item.Top >= music.Top && item.Top + item.Height <= music.Top + music.Height, item.Name);
    }
    const driving = get('Driving panel'), circuit = get('Timing panel'), rally = get('Rally timing panel');
    assert.equal(circuit.Left, rally.Left);
    assert.equal(circuit.Top, rally.Top);
    assert.equal(circuit.Height, rally.Height);
    const tyres = get('Tyre summary panel');
    assert.equal(tyres.Left, circuit.Left, 'Tyres sit below session timing in the left column');
    assert.equal(tyres.Top, circuit.Top + circuit.Height);
    assert.notEqual(get('Current lap time').Left, get('Last lap time').Left, 'Timing values use two columns');
    const stagePanel = get('Rally stage panel');
    assert.equal(get('Map panel').Left, stagePanel.Left);
    assert.equal(get('Map panel').Height, stagePanel.Height);
    assert.equal(get('Map panel').Top, circuit.Top);
    assert.equal(get('Map panel').Top + get('Map panel').Height, driving.Top + driving.Height);
    const stageMap = get('Rally stage map'), mapStatus = get('Rally map status');
    assert.match(stageMap.$type, /\.GeneratedStaticMapItem,/);
    assert.equal(stageMap.Bindings.Visible.Formula.Expression.includes('coordinatesAvailable()'), true);
    assert.equal(mapStatus.Bindings.Visible.Formula.Expression.includes('!coordinatesAvailable()'), true);
    assert.equal(evaluate('return coordinatesAvailable();', props('RBR')), false);
    assert.equal(evaluate('return coordinatesAvailable();', props('RBR', {
      MapAllowed: true, CarCoordinates01: 0, CarCoordinates03: 0,
    })), true);
    for (const name of ['Rally stage map', 'Rally map status', 'Rally stage progress', 'Rally stage distance',
      'Rally stage split', 'Rally damage', 'Rally transmission', 'Rally ABS', 'Rally TC']) {
      const element = get(name);
      assert.ok(element.Left >= stagePanel.Left && element.Left + element.Width <= stagePanel.Left + stagePanel.Width, name);
      assert.ok(element.Top >= stagePanel.Top && element.Top + element.Height <= stagePanel.Top + stagePanel.Height, name);
    }
    for (const corner of ['FL', 'FR', 'RL', 'RR']) {
      assert.equal(get(`Rally brake ${corner}`), undefined);
      assert.ok(get(`Tyre ${corner} brake temperature`), `Tyre ${corner} brake temperature remains in tyre summary`);
    }
    assert.equal(get('Rally stage progress').FontSize, 27);
    assert.equal(get('Rally stage distance').FontSize, 27);
    assert.equal(get('Rally stage split').FontSize, 27);
    assert.ok(items.find(i => i.Name === 'Strategy summary').Bindings.Visible);
    for (const name of ['Rally info one', 'Rally info two', 'Rally info three', 'Rally vehicle title',
      'Rally focus title', 'Rally focus note', 'Rally timing note', 'Rally water', 'Rally oil', 'Rally fuel']) {
      assert.equal(get(name), undefined, name);
    }
  }
});

test('detail readings use direct SimHub data and preserve units without guessed warnings', () => {
  const run = (expression, values = {}) => new Function('$prop', formula(expression).Expression)(
    key => props('AC', values)[key] ?? null);
  for (const [key, , kind, normalized] of detailFields) {
    const expression = `return detailReading('${key}', '${kind}', ${normalized ? `'${normalized}'` : 'null'});`;
    assert.equal(run(expression), '--', key);
    assert.equal(run(expression, { [normalized || key]: true }), kind === 'switch' ? 'YES' : '--');
    assert.equal(run(expression, { [normalized || key]: false }), kind === 'switch' ? 'NO' : '--');
    assert.equal(run(expression, { [normalized || key]: '' }), '--');
    assert.equal(run(expression, { [normalized || key]: 5, 'DataCorePlugin.GameRunning': false }), '--');
    const expected = kind === 'text' ? '--' : kind === 'switch' ? 'NO' : kind === 'pressure' ? '--' :
      kind === 'seconds' ? '0:00.000' : kind === 'count' ? '0' : kind === 'delta' ? '+0.000 s' :
      '0.0' + ({litres:' L',laps:' laps',speed:' km/h',temperature:' C',bar:' bar',energy:' MJ',percent:'%',distance:' km'}[kind] || '');
    assert.equal(run(expression, { [normalized || key]: 0 }), expected, key);
  }
  assert.equal(run("return detailReading('fuelLaps','laps');", { Fuel: 60, fuelPerLap: 3 }), 'EST 20.0 laps');
  assert.equal(run("return detailReading('fuelLaps','laps');", { Fuel: 60, fuelPerLap: 0 }), '--');
  assert.equal(run("return detailReading('fuelToAdd','litres');", { Fuel: 60, fuelToFinish: 70 }), 'EST 10.0 L');
  assert.equal(run("return detailReading('fuelToAdd','litres');", { Fuel: 60, fuelToFinish: 50 }), 'EST 0.0 L');
  assert.equal(run("return detailReading('fuelToFinish','litres');", { sessionSeconds: 3600, fuelPerLap: 3 }), '--');
  assert.equal(run("return detailReading('stageSplitSeconds','delta');", { stageSplitSeconds: -1.25 }), '-1.250 s');
  assert.equal(run("return detailReading('sessionSeconds','seconds');", { sessionSeconds: 3661.5 }), '61:01.500');
  assert.equal(run('return raceWarnings();'), 'WARNINGS / CHECK GAME');
  assert.equal(run('return raceWarnings();', { OilTemperature: 119.9, WaterTemperature: 99.9 }), 'WARNINGS / CHECK GAME');
  assert.equal(run('return raceWarnings();', { OilTemperature: 140, WaterTemperature: 120 }), 'WARNINGS / CHECK GAME');
  assert.equal(run('return raceWarnings();', { IsInPitLane: true, pitLimitKmh: 160 }), 'WARNINGS / CHECK GAME');
  assert.equal(run('return raceWarnings();', { IsInPitLane: true, pitLimitKmh: 159.9 }), 'PIT OVERSPEED');
  assert.equal(run('return raceWarnings();', { penalties: 'NONE' }), 'WARNINGS / CHECK GAME');
  assert.equal(run('return raceWarnings();', { penaltyActive: true, penalties: 'DRIVE THROUGH' }), 'PENALTY: DRIVE THROUGH');
});

test('dashboard has one overview screen and no page navigation button', () => {
  for (const width of [1920, 2560]) {
    const dash = createDashboard(width), screen = dash.Screens[0], items = flatten(screen.Items), names = new Set();
    assert.deepEqual(dash.Screens.map(s => s.Name), ['Y.A.S.S / Overview']);
    assert.equal(dash.Metadata.ScreenCount, 1);
    assert.deepEqual(dash.Metadata.InGameScreensIndexs, [0]);
    assert.deepEqual(dash.Metadata.IdleScreensIndexs, [0]);
    assert.deepEqual(dash.Metadata.PitScreensIndexs, [0]);
    assert.equal(items.some(item => item.Name.startsWith('Detail ')), false);
    assert.equal(items.some(item => item.TriggerAction === 'GraphicalDashPlugin.NextScreen'), false);
    const screenText = items.filter(item => item.IsTextItem).map(item => item.Text).join('\n');
    assert.doesNotMatch(screenText, /ONE DASH\. FOUR SIMULATORS\.|LIVE VALUES ONLY - UNAVAILABLE DATA:/);
    assert.ok(!items.some(item => item.Name === 'Footer'));
    for (const item of items) {
      assert.ok(!names.has(item.Name), `Duplicate item: ${item.Name}`);
      names.add(item.Name);
      if (item.Childrens) continue;
      assert.ok(item.Left >= 0 && item.Top >= 0 && item.Left + item.Width <= width && item.Top + item.Height <= 1080, item.Name);
      for (const binding of Object.values(item.Bindings || {})) {
        for (const data of [{}, props('AC'), props('ACRally'), props('Unknown')]) {
          assert.doesNotThrow(() => new Function('$prop','root',binding.Formula.Expression)(key => data[key] ?? null, {}), item.Name);
        }
      }
    }
  }
});

test('disconnected state hides stale telemetry and selects standby', () => {
  const p = props('AssettoCorsa', { 'DataCorePlugin.GameRunning': false });
  assert.equal(evaluate('return live();', p), false);
  assert.equal(evaluate('return status();', p), 'WAITING FOR GAME');
});

test('normalized full, NewData and short properties are supported without treating zero as missing', () => {
  assert.equal(evaluate("return data('Fuel');", { Fuel: 14 }), 14);
  assert.equal(evaluate("return data('Fuel');", { 'DataCorePlugin.GameData.NewData.Fuel': 12 }), 12);
  assert.equal(evaluate("return data('Fuel');", { 'DataCorePlugin.GameData.Fuel': 0, Fuel: 14 }), 0);
});

test('music is enabled only for Assetto Corsa, while connected', () => {
  for (const game of ['AssettoCorsa', 'Assetto Corsa', 'AC']) {
    assert.equal(evaluate('return musicPage();', props(game)), true, game);
    assert.equal(evaluate('return musicPage();', props(game, { 'DataCorePlugin.GameRunning': false })), false, game);
  }
  for (const game of ['AssettoCorsaRally', 'ACRally', 'RichardBurnsRally', 'RBR', 'RBRRSF', 'Automobilista2', 'AMS2', 'LeMansUltimate', 'LMU', 'Unknown', 'ETS2', 'EuroTruckSimulator2', 'ATS', 'AmericanTruckSimulator']) {
    assert.equal(evaluate('return musicPage();', props(game)), false, game);
  }
});

test('music shows real Windows provider metadata and an explicit empty-session state', () => {
  assert.equal(evaluate('return mediaTitle();'), 'NO ACTIVE MEDIA');
  assert.match(evaluate('return mediaArtist();'), /Open Spotify/);
  const p = { 'SystemInfosProvider.Title': '  Local track  ', 'SystemInfosProvider.Artist': '  Local artist  ' };
  assert.equal(evaluate('return mediaTitle();', p), 'Local track');
  assert.equal(evaluate('return mediaArtist();', p), 'Local artist');
  assert.equal(evaluate('return mediaArtist();', { 'SystemInfosProvider.Title': 'Track' }), 'Windows media session');
  assert.equal(evaluate('return mediaTitle();', { 'SystemInfosProvider.Title': '   ' }), 'NO ACTIVE MEDIA');
});

test('missing readings are not displayed as fabricated zeroes', () => {
  for (const value of [null, undefined, '', true, NaN, Infinity, 'not telemetry']) {
    assert.equal(evaluate('return metric(read("value"));', { value }), '--');
  }
  assert.equal(evaluate('return metric(0);'), '0');
  assert.equal(evaluate('return gear();'), '--');
  assert.equal(evaluate('return fuelPercent();'), null);
  assert.equal(evaluate('return rpmRatio();'), null);
  assert.equal(evaluate('return delta();'), '--.---');
  assert.equal(evaluate("return positive(0, 0, ' C');"), '--');
});

test('neutral, reverse, multi-digit and string gears are preserved', () => {
  for (const [input, expected] of [[0, 'N'], [-1, 'R'], ['N', 'N'], ['r', 'R'], [12, '12']]) {
    assert.equal(evaluate('return gear();', props('AssettoCorsa', { 'DataCorePlugin.GameData.Gear': input })), expected);
  }
});

test('car settings preserve independent levels, percentage bias and unavailable telemetry', () => {
  const channels = ['BrakeBias', 'ABSLevel', 'TCLevel', 'TractionControlCut', 'EngineMap'];
  for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'RichardBurnsRally', 'Automobilista2', 'LeMansUltimate']) {
    for (const key of channels) {
      const run = value => evaluate(`return carSetting('${key}');`, props(game, { [`DataCorePlugin.GameData.${key}`]: value }));
      assert.equal(run(0), key === 'BrakeBias' ? '0.0%' : '0');
      assert.equal(run(key === 'BrakeBias' ? 54.2 : 3), key === 'BrakeBias' ? '54.2%' : '3');
      for (const value of [null, '', true, -1, 'invalid', Infinity]) assert.equal(run(value), '--');
      assert.equal(evaluate(`return carSetting('${key}');`, props(game, {
        [`DataCorePlugin.GameData.NewData.${key}`]: 2,
      })), key === 'BrakeBias' ? '2.0%' : '2');
      assert.equal(evaluate(`return carSetting('${key}');`, props(game, {
        'DataCorePlugin.GameRunning': false, [`DataCorePlugin.GameData.${key}`]: 2,
      })), '--');
    }
  }
  assert.equal(evaluate("return carSetting('BrakeBias');", props('AssettoCorsa', { BrakeBias: 100.1 })), '--');
  assert.equal(evaluate("return carSetting('BrakeBias');", props('AssettoCorsa', { BrakeBias: 0.5 })), '0.5%');
  assert.equal(evaluate("return carSetting('TCLevel');", props('AssettoCorsa', { TCLevel: 1.5 })), '--');
  assert.equal(evaluate("return carSetting('TractionControlCut');", props('AssettoCorsa', { TCLevel: 5, TCActive: 1 })), '--');
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const panel = items.find(i => i.Name === 'Car settings');
    const liveLimit = items.find(i => i.Name === 'Cluster scale source');
    assert.equal(panel.Childrens.length, 10);
    assert.equal(items.some(i => i.Name.startsWith('Boost ')), false);
    for (const key of channels) {
      const item = panel.Childrens.find(i => i.Name === `${key} setting`);
      assert.ok(item.Top > liveLimit.Top + liveLimit.Height);
      assert.ok(item.Top + item.Height <= liveLimit.Top + 150);
      assert.equal(new Function('$prop', item.Bindings.Text.Formula.Expression)(p => props()[p] ?? null), '--');
    }
  }
});

test('all supported games retain speed in KM/H', () => {
  for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'Automobilista2', 'LeMansUltimate']) {
    assert.equal(evaluate('return speedValue();', props(game, { 'DataCorePlugin.GameData.SpeedKmh': 160.9344 })), 160.9344);
    assert.equal(evaluate('return speedUnit();', props(game)), 'KM/H');
  }
});

test('map weather preserves valid temperatures and calm wind without inventing missing channels', () => {
  for (const game of ['AssettoCorsa', 'Automobilista2', 'LeMansUltimate']) {
    for (const key of ['AirTemperature', 'TrackTemperature']) {
      for (const [value, expected] of [[22.5, '22.5 C'], [0, '0.0 C'], [-5, '-5.0 C'], [null, '--'], ['', '--'], [true, '--'], ['bad', '--']]) {
        assert.equal(evaluate(`return weatherTemperature('${key}');`, props(game, { [key]: value })), expected);
      }
    }
    assert.equal(evaluate('return windSpeed();', props(game)), '--');
    const wind = props(game, { 'DataCorePlugin.GameRawData.mWindSpeed': 3.5 });
    assert.equal(evaluate('return windSpeed();', wind), game === 'Automobilista2' ? '12.6 km/h' : '--');
  }
  for (const [value, expected] of [[0, '0.0 km/h'], [-1, '--'], [null, '--'], [true, '--'], ['invalid', '--']]) {
    assert.equal(evaluate('return windSpeed();', props('AMS2', { 'DataCorePlugin.GameRawData.mWindSpeed': value })), expected);
  }
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const panel = items.find(i => i.Name === 'Map panel');
    for (const name of ['Air', 'Track', 'Wind']) {
      const reading = items.find(i => i.Name === `Map ${name}`);
      assert.ok(reading.Top >= panel.Top && reading.Top + reading.Height <= panel.Top + panel.Height);
      assert.ok(reading.Left >= panel.Left && reading.Left + reading.Width < panel.Left + panel.Width);
    }
  }
});

test('overall leaderboard pages the full grid in two columns without losing or repeating entries', () => {
  const at = (expression, count, time) => new Function('$prop', 'Date', formula(expression).Expression)(
    key => props('AssettoCorsa', { OpponentsCount: count })[key] ?? null,
    class extends Date { constructor() { super(time); } });
  for (const count of [1, 20, 21, 40, 47, 60, 103]) {
    const seen = [];
    for (let page = 0; page < Math.ceil(count / 20); page++) {
      for (let slot = 0; slot < 20; slot++) {
        const rank = at(`return gridPosition(${slot});`, count, page * 10000);
        if (rank <= count) seen.push(rank);
      }
    }
    assert.deepEqual(seen, Array.from({ length: count }, (_, i) => i + 1));
    assert.equal(at('return gridPosition(0);', count, Math.ceil(count / 20) * 10000), 1);
  }
  assert.equal(at('return gridPage();', 47, 9999), 0);
  assert.equal(at('return gridPage();', 47, 10000), 1);
  assert.equal(at('return gridCount();', null, 0), 0);
  assert.match(at('return gridHeading();', null, 0), /NO STANDINGS/);
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const rows = items.filter(i => /^Grid driver /.test(i.Name));
    assert.equal(rows.length, 20);
    assert.equal(new Set(rows.map(i => i.Left)).size, 2);
    for (const row of rows) {
      assert.equal(row.LeaderboardMode, 1);
      assert.equal(row.LeaderboardPositionRelativeToPlayer, false);
      assert.equal(row.PlayerStyleEnabled, true);
      assert.ok(row.Top > items.find(i => i.Name === 'Class behind').Top + 30);
      assert.ok(row.Top + row.Height < 1014);
    }
  }
});

test('wind direction uses explicit FROM bearings and forward headings without reversing head/tailwind', () => {
  const run = (expression, wind, heading, extra = {}) => new Function('$prop', formula(expression).Expression)(
    key => props('AMS2', {
      'DataCorePlugin.GameData.WindFromDegrees': wind,
      'DataCorePlugin.GameData.HeadingDegrees': heading,
      'DataCorePlugin.GameRawData.mWindSpeed': 5, ...extra,
    })[key] ?? null);
  for (const [bearing, expected] of [[0, 'N 0'], [45, 'NE 45'], [90, 'E 90'], [135, 'SE 135'],
    [180, 'S 180'], [225, 'SW 225'], [270, 'W 270'], [315, 'NW 315'], [360, 'N 0'], [359.9, 'N 0']]) {
    assert.equal(run('return windCompass();', bearing, 0), 'FROM ' + expected + ' deg');
  }
  for (const heading of [0, 90, 180, 270]) {
    for (const [offset, expected] of [[0, 'HEADWIND'], [45, 'HEAD / RIGHT'], [90, 'RIGHT CROSS'],
      [135, 'TAIL / RIGHT'], [180, 'TAILWIND'], [225, 'TAIL / LEFT'], [270, 'LEFT CROSS'], [315, 'HEAD / LEFT']]) {
      assert.equal(run('return windRelative();', (heading + offset) % 360, heading), expected);
    }
  }
  for (const bad of [null, '', true, -1, 361, Infinity, 'bad']) {
    assert.equal(run('return windCompass();', bad, 0), 'FROM --');
    assert.equal(run('return windRelative();', 0, bad), 'CAR --');
  }
  assert.equal(run('return windRelative();', 315, null), 'CAR --');
  assert.equal(run('return windCompass();', 315, null), 'FROM NW 315 deg');
  assert.equal(run('return windCompass();', 315, 0, { 'DataCorePlugin.GameRunning': false }), 'FROM --');
  for (const expression of ['return windCompass();', 'return windRelative();']) {
    assert.equal(run(expression, null, null, { 'DataCorePlugin.GameRawData.mWindSpeed': 0 }), 'CALM');
  }
});

test('TimeSpan values format correctly, including hours and days; invalid times stay unavailable', () => {
  const cases = [
    ['00:01:42.368', '1:42.368'], ['00:01:42.3', '1:42.300'],
    ['01:02:03.1234567', '62:03.123'], ['1.01:02:03', '1502:03.000'],
    ['00:00:00', '--:--.---'], ['00:99:00', '--:--.---'],
    ['not a timespan', '--:--.---'], [null, '--:--.---'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(evaluate('return lapTime(read("value"));', { value }), expected);
  }
});

test('warning thresholds are tested at their exact boundaries', () => {
  const normal = props();
  const withFuel = n => ({ ...normal, 'DataCorePlugin.GameData.Fuel': n });
  assert.equal(evaluate('return status();', withFuel(10)), 'LIVE TELEMETRY');
  assert.equal(evaluate('return status();', withFuel(9.999)), 'LOW FUEL');
  const withRpm = n => ({ ...normal, 'DataCorePlugin.GameData.Rpms': n });
  assert.equal(evaluate('return status();', withRpm(7599)), 'LIVE TELEMETRY');
  assert.equal(evaluate('return status();', withRpm(7600)), 'SHIFT');
  assert.equal(evaluate('return status();', { ...withRpm(8000), 'DataCorePlugin.CurrentGame': 'AssettoCorsaRally' }), 'SHIFT');
  assert.equal(evaluate('return status();', { ...normal, 'DataCorePlugin.GamePaused': true }), 'PAUSED');
  assert.equal(evaluate('return status();', { ...normal, 'DataCorePlugin.GameData.PitLimiterOn': 1 }), 'LIVE TELEMETRY');
  assert.equal(evaluate('return deltaColor();', { 'DataCorePlugin.Computed.DeltaBest': -0.001 }), '#FF78A34D');
  assert.equal(evaluate('return deltaColor();', { 'DataCorePlugin.Computed.DeltaBest': 0.001 }), '#FFFF3B24');
});

test('fuel flashing uses the exact low-fuel threshold and excludes unavailable or disconnected readings', () => {
  for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'Automobilista2', 'LeMansUltimate']) {
    for (const [fuel, expected] of [[0, true], [6, true], [9.999, true], [10, false], [100, false],
      [null, false], [-1, false], ['bad', false]]) {
      const p = props(game, { 'DataCorePlugin.GameData.Fuel': fuel });
      assert.equal(evaluate('return lowFuel();', p), expected);
    }
    for (const extra of [
      { 'DataCorePlugin.GameData.MaxFuel': null }, { 'DataCorePlugin.GameData.MaxFuel': 0 },
      { 'DataCorePlugin.GameRunning': false },
    ]) assert.equal(evaluate('return lowFuel();', props(game, { 'DataCorePlugin.GameData.Fuel': 0, ...extra })), false);
  }
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    for (const name of ['Fuel dial', 'Fuel state']) {
      const item = items.find(i => i.Name === name);
      assert.equal(item.BlinkEnabled, undefined);
      assert.equal(item.Bindings.BlinkEnabled, undefined);
      const targets = name === 'Fuel dial' ? ['MajorTickColor', 'DialStrokeColor'] : ['TextColor'];
      const normalColor = name === 'Fuel dial' ? '#FFEBCBB4' : '#FFFFB02E';
      for (const target of targets) {
        const run = (p, time) => new Function('$prop', 'Date', item.Bindings[target].Formula.Expression)(
          key => p[key] ?? null, class extends Date { constructor() { super(time); } });
        for (const [time, color] of [[0, '#FFFF0000'], [499, '#FFFF0000'], [500, normalColor],
          [999, normalColor], [1000, '#FFFF0000']]) {
          for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'Automobilista2', 'LeMansUltimate']) {
            assert.equal(run(props(game, { 'DataCorePlugin.GameData.Fuel': 6 }), time), color);
            assert.equal(run(props(game, { 'DataCorePlugin.GameData.Fuel': 10 }), time), normalColor);
          }
          assert.equal(run({}, time), normalColor);
        }
      }
    }
  }
});

test('temperature displays use direct SimHub readings without invented warning thresholds', () => {
  for (const [key, colorFunction, expected] of [
    ['OilTemperature', 'temperatureGaugeColor', '#FFEBCBB4'],
    ['WaterTemperature', 'temperatureGaugeColor', '#FFEBCBB4'],
    ['OilTemperature', 'temperatureValueColor', '#FFFFB02E'],
    ['WaterTemperature', 'temperatureValueColor', '#FFFFB02E'],
    ['OilTemperature', 'temperatureLabelColor', '#FFC5B39A'],
    ['WaterTemperature', 'temperatureLabelColor', '#FFC5B39A'],
  ]) {
    const run = value => new Function('$prop', formula(`return ${colorFunction}('${key}');`).Expression)(
      name => props('AC', { [key]: value })[name] ?? null);
    assert.equal(run(95), expected);
    assert.equal(run(300), expected);
  }
  assert.equal(evaluate('return raceWarnings();', props('AC', { OilTemperature: 300, WaterTemperature: 300 })),
    'WARNINGS / CHECK GAME');
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    for (const [name, key] of [['Oil', 'OilTemperature'], ['Coolant', 'WaterTemperature']]) {
      const dial = items.find(i => i.Name === `${name} temperature dial`);
      assert.ok(dial.Bindings.MajorTickColor && dial.Bindings.DialStrokeColor);
      assert.ok(items.find(i => i.Name === `${name} temperature label`).Bindings.TextColor);
      assert.ok(items.find(i => i.Name === `${name} temperature`).Bindings.TextColor);
      assert.match(dial.Bindings.MajorTickColor.Formula.Expression, new RegExp(`temperatureGaugeColor\\('${key}'\\)`));
    }
  }
});

test('RPM scale uses only a SimHub-reported maximum and marks a missing limit unavailable', () => {
  for (const [limit, max] of [[2500, 2.5], [2750, 3], [8500, 9], [16000, 16]]) {
    const p = props('AssettoCorsa', { MaxRpm: limit });
    assert.equal(evaluate('return rpmScale();', p), max);
    assert.equal(evaluate('return rpmSource();', p), 'LIVE LIMIT');
  }
  const p = props('AssettoCorsa', { MaxRpm: null, 'DataCorePlugin.GameData.CarSettings_MaxRPM': 2400 });
  assert.equal(evaluate('return rpmMax();', p), 2400);
  for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'RichardBurnsRally']) {
    const missing = props(game, { MaxRpm: null, 'DataCorePlugin.GameData.CarSettings_MaxRPM': null });
    assert.equal(evaluate('return rpmMax();', missing), null);
    assert.equal(evaluate('return rpmScale();', missing), 8, '8k is only the display scale when SimHub gives no limit');
    assert.equal(evaluate('return rpmSource();', missing), 'UNAVAILABLE');
    assert.equal(evaluate('return rpmRatio();', { ...missing, 'DataCorePlugin.GameData.Rpms': 7000 }), null);
  }
  assert.equal(evaluate('return speedValue();', props('AC', { 'DataCorePlugin.GameData.SpeedKmh': 321 })), 321);
  assert.equal(createDashboard(1920).Screens[0].Items.some(item => item.Name === 'Speed dial'), false);
});

test('position and class capability checks are explicit and never promise an all-clear', () => {
  const p = props('LeMansUltimate', {
    'DataCorePlugin.GameData.MapAllowed': true,
    'DataCorePlugin.GameData.CarCoordinates01': 0, 'DataCorePlugin.GameData.CarCoordinates03': 0,
    'DataCorePlugin.GameData.CarClass': 'GT3', 'DataCorePlugin.GameData.PlayerClassOpponentsCount': 1,
  });
  assert.equal(evaluate('return coordinatesAvailable();', p), true);
  assert.equal(evaluate('return classAvailable();', p), true);
  assert.match(evaluate('return awarenessStatus();', p), /NOT ALL-CLEAR/);
  for (const [key, value] of [['MapAllowed', false], ['CarCoordinates01', null], ['CarCoordinates03', 'bad']]) {
    const missing = { ...p, ['DataCorePlugin.GameData.' + key]: value };
    assert.equal(evaluate('return coordinatesAvailable();', missing), false);
    assert.equal(evaluate('return awarenessStatus();', missing), 'POSITION DATA UNAVAILABLE');
  }
  for (const cls of [null, '', ' ', 'Unknown', 'Unknown Class', 'undefined', 'N/A', '--']) {
    assert.equal(evaluate('return classAvailable();', { ...p, 'DataCorePlugin.GameData.CarClass': cls }), false);
  }
  assert.equal(evaluate('return classAvailable();', { ...p, 'DataCorePlugin.GameData.PlayerClassOpponentsCount': null }), false);
});

for (const width of [1920, 2560]) {
  test(`${width}x1080 keeps digital speed inside the RPM dial and removes the speedometer`, () => {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const dials = items.filter(i => ['RPM dial', 'Fuel dial'].includes(i.Name));
    assert.deepEqual(dials.map(i => i.Name), ['RPM dial', 'Fuel dial']);
    assert.equal(items.some(i => i.Name === 'Speed dial'), false);
    const run = (item, key, p) => new Function('$prop', item.Bindings[key].Formula.Expression)(k => p[k] ?? null);
    for (const dial of dials) {
      assert.equal(run(dial, 'ShowNeedle', {}), false);
      assert.equal(run(dial, 'ShowNeedle', props()), true);
      const zero = props('AssettoCorsa', { 'DataCorePlugin.GameData.SpeedKmh': 0, 'DataCorePlugin.GameData.Rpms': 0, 'DataCorePlugin.GameData.Fuel': 0 });
      assert.equal(run(dial, 'ShowNeedle', zero), true);
      assert.equal(run(dial, 'Value', zero), 0);
      const high = props('AssettoCorsa', { 'DataCorePlugin.GameData.SpeedKmh': 999, 'DataCorePlugin.GameData.Rpms': 99999, 'DataCorePlugin.GameData.Fuel': 999 });
      assert.equal(run(dial, 'Value', high), dial.Name === 'RPM dial' ? 8 : 100);
    }
    const [rpm, fuel] = dials;
    const oil = items.find(i => i.Name === 'Oil temperature dial');
    const coolant = items.find(i => i.Name === 'Coolant temperature dial');
    for (const dial of [fuel, oil, coolant]) {
      assert.deepEqual([dial.StartAngle, dial.SweepAngle], [135, 270], `${dial.Name} shares gauge endpoints`);
    }
    for (const dial of [rpm, fuel, oil, coolant]) {
      assert.equal(dial.ShowDialGlassEffect, true, `${dial.Name} uses the subtle glass effect`);
      assert.equal(dial.ScaleGlowRadius, 3, `${dial.Name} uses a small scale glow`);
      assert.equal(dial.OuterStrokeThickness, dial === rpm ? 5 : 3, `${dial.Name} has its intended bezel width`);
    }
    for (const [dial, hubName] of [[fuel, 'Fuel center hub'], [oil, 'Oil temperature center hub'],
      [coolant, 'Coolant temperature center hub']]) {
      const hub = items.find(i => i.Name === hubName);
      assert.equal(hub.Image, gaugeHubImage.name);
      assert.ok(Math.abs(hub.Width - dial.Width * 0.12) < 0.001);
      assert.ok(Math.abs(hub.Left + hub.Width / 2 - dial.Left - dial.Width / 2) < 0.001);
      assert.ok(Math.abs(hub.Top + hub.Height / 2 - dial.Top - dial.Height / 2) < 0.001);
      assert.ok(Math.abs(dial.CapRadius / dial.OuterRadius - rpm.CapRadius / rpm.OuterRadius) < 0.001);
    }
    assert.equal(fuel.ScaleLabelStyle.LabelRadius, 29);
    assert.equal(oil.ScaleLabelStyle.LabelRadius, 25);
    assert.equal(coolant.ScaleLabelStyle.LabelRadius, 25);
    assert.equal(rpm.MajorTickSize, '12,3');
    assert.equal(rpm.MinorTickSize, '6,2');
    assert.equal(rpm.MinorTickColor, '#FFD3B69F');
    const speedLabel = items.find(i => i.Name === 'Speed label');
    const speed = items.find(i => i.Name === 'Speed'), unit = items.find(i => i.Name === 'Speed unit');
    const rpmLabel = items.find(i => i.Name === 'RPM label');
    assert.equal(new Function('$prop', speed.Bindings.Text.Formula.Expression)(key =>
      props('AC', { 'DataCorePlugin.GameData.SpeedKmh': 161 })[key] ?? null), '161');
    assert.equal(new Function('$prop', unit.Bindings.Text.Formula.Expression)(key => props('AC')[key] ?? null), 'KM/H');
    for (const item of [speed, unit]) {
      assert.ok(item.Left >= rpm.Left && item.Left + item.Width <= rpm.Left + rpm.Width);
      assert.ok(item.Top >= rpm.Top && item.Top + item.Height <= rpm.Top + rpm.Height);
    }
    assert.equal(speedLabel.Text, 'SPEED');
    const gearLabel = items.find(i => i.Name === 'Gear label'), gear = items.find(i => i.Name === 'Gear');
    const limiter = items.find(i => i.Name === 'Pit limiter');
    assert.equal(speed.FontSize, gear.FontSize);
    assert.equal(speedLabel.Top, gearLabel.Top);
    assert.equal(speed.Top, gear.Top);
    assert.ok(gear.Left - (speed.Left + speed.Width) <= 20, 'Speed and gear readouts are close without overlapping');
    assert.ok(rpmLabel.Top < speedLabel.Top && speed.Top + speed.Height <= unit.Top);
    assert.ok(unit.Top + unit.Height <= limiter.Top);
    assert.ok(rpmLabel.Top > rpm.Top + rpm.Height / 2, 'RPM scale label sits below the needle hub');
    assert.ok(speed.Left + speed.Width < rpm.Left + rpm.Width / 2, 'Speed readout is lower-left');
    assert.ok(gear.Left > rpm.Left + rpm.Width / 2 && gearLabel.Left > rpm.Left + rpm.Width / 2, 'Gear is lower-right');
    assert.ok(gear.Top > rpm.Top + rpm.Height / 2 && limiter.Top > gear.Top + gear.Height, 'Limiter sits at the gauge bottom');
    assert.equal(limiter.FontWeight, 'Bold');
    assert.equal(rpm.DialBackgroundColor, '#FF30383A', 'Opaque RPM face contains the digital speed readout');
    const driving = items.find(i => i.Name === 'Driving panel');
    assert.ok(rpm.Left < driving.Left + driving.Width / 2, 'RPM dial is on the left side of the center panel');
    assert.ok(oil.Left >= rpm.Left + rpm.Width && coolant.Left >= rpm.Left + rpm.Width,
      'Oil and coolant gauges sit to the right of the RPM dial');
    assert.ok(oil.Top < coolant.Top && coolant.Top < fuel.Top, 'Small gauges form a vertical right-side column');
    assert.ok(oil.Top + oil.Height <= coolant.Top && coolant.Top + coolant.Height <= fuel.Top,
      'Right-side gauges do not overlap vertically');
    assert.ok(rpm.Width > oil.Width * 3, 'RPM dial remains the dominant gauge');
    const gaugeCenterX = oil.Left + oil.Width / 2;
    assert.equal(oil.Width, 112);
    assert.equal(coolant.Width, 112);
    assert.equal(fuel.Width, 112);
    assert.ok(Math.abs(coolant.Left + coolant.Width / 2 - gaugeCenterX) < 0.001);
    assert.ok(Math.abs(fuel.Left + fuel.Width / 2 - gaugeCenterX) < 0.001,
      'Oil, coolant, and fuel gauges share a right-column centerline');
    for (const [name, gauge] of [['Oil temperature label', oil], ['Oil temperature', oil],
      ['Coolant temperature label', coolant], ['Coolant temperature', coolant], ['Fuel state', fuel], ['Fuel value', fuel]]) {
      const text = items.find(i => i.Name === name);
      assert.equal(text.Left, gauge.Left, `${name} aligns under its gauge`);
      assert.ok(text.Top >= gauge.Top + gauge.Height, `${name} is below its gauge`);
    }
    assert.ok(items.find(i => i.Name === 'Oil temperature').FontSize > items.find(i => i.Name === 'Oil temperature label').FontSize);
    assert.ok(items.find(i => i.Name === 'Coolant temperature').FontSize > items.find(i => i.Name === 'Coolant temperature label').FontSize);
    for (const name of ['Gear', 'Speed', 'Speed unit', 'Fuel state']) {
      const text = items.find(i => i.Name === name);
      assert.ok(text);
    }
    for (const [key, value] of [['Fuel', -1], ['MaxFuel', 0], ['MaxFuel', null]]) {
      assert.equal(run(fuel, 'ShowNeedle', props('AssettoCorsa', { ['DataCorePlugin.GameData.' + key]: value })), false);
    }
  });
  test(`${width}x1080 race awareness uses native class standings offsets and unfiltered positional components`, () => {
    const items = flatten(createDashboard(width).Screens[0].Items);
    for (const [name, offset] of [['Class ahead', 0], ['Class behind', 2]]) {
      const rival = items.find(i => i.Name === name);
      assert.match(rival.$type, /\.BuiltIn\.LeaderboardOpponentNameText,/);
      assert.equal(rival.LeaderboardMode, 2);
      assert.equal(rival.LeaderboardPositionRelativeToPlayer, true);
      assert.equal(rival.LeaderboardPositionRelativeToPlayerOnTrack, false);
      assert.equal(rival.LeaderboardPosition, offset);
      assert.match(rival.NoDataText, /no class rival/);
    }
    const timingPanel = items.find(i => i.Name === 'Timing panel');
    const deltaExplanation = items.find(i => i.Name === 'Delta explanation');
    assert.equal(deltaExplanation.Text, 'DELTA TO BEST');
    for (const name of ['Class ahead gap', 'Class behind gap']) {
      const gap = items.find(i => i.Name === name);
      assert.equal(gap.Width, 120);
      assert.ok(gap.Left + gap.Width <= timingPanel.Left + timingPanel.Width - 24, name);
    }
    assert.ok(items.find(i => i.Name === 'Class behind').Top > items.find(i => i.Name === 'Class ahead').Top);
    const radar = items.find(i => i.Name === 'Nearby radar'), map = items.find(i => i.Name === 'Track minimap');
    assert.match(radar.$type, /\.RadarItem,/);
    assert.match(map.$type, /\.GeneratedStaticMapItem,/);
    assert.equal(map.OverrideColorsWithCarClassColors, true);
    assert.equal(map.DisplayPerClassPosition, true);
    const panel = items.find(i => i.Name === 'Map panel');
    assert.equal(items.some(i => i.Name === 'Radar panel'), false, 'Map and radar share one panel');
    assert.equal(radar.Width, 250);
    assert.equal(radar.Height, 250);
    assert.equal(radar.Scale, 0.3);
    assert.equal(radar.Left, panel.Left + (panel.Width - radar.Width) / 2);
    const radarTitle = items.find(i => i.Name === 'Radar title');
    const mapStatus = items.find(i => i.Name === 'Map status');
    assert.equal(radarTitle.Top, mapStatus.Top + mapStatus.Height);
    assert.equal(radar.Top, radarTitle.Top + radarTitle.Height);
    assert.equal(items.find(i => i.Name === 'Radar title').Left, items.find(i => i.Name === 'Map status').Left);
    assert.equal(items.find(i => i.Name === 'Radar title').Width, items.find(i => i.Name === 'Map status').Width);
    assert.ok(radar.Top > panel.Top + panel.Height / 2);
    assert.equal(map.Width, panel.Width - 32);
    assert.equal(map.Height, 480);
    assert.equal(map.TrackWidth, 8);
    assert.equal(map.TrackBorderWidth, 3);
    for (const name of ['Map viewport border top', 'Map viewport border bottom', 'Map viewport border left', 'Map viewport border right',
      'Radar border top', 'Radar border bottom', 'Radar border left', 'Radar border right']) {
      const border = items.find(i => i.Name === name);
      assert.ok(border.Left >= panel.Left && border.Left + border.Width <= panel.Left + panel.Width);
      assert.ok(border.Top >= panel.Top && border.Top + border.Height <= panel.Top + panel.Height);
    }
    assert.ok(map.Width * map.Height > 3.5 * radar.Width * radar.Height);
    assert.equal(items.some(i => ['Radar status', 'Radar caution', 'Map caution'].includes(i.Name)), false);
    assert.equal(items.some(i => i.IsTextItem && /RADAR \/ ALL CLASSES|NO DOTS IS NOT ALL-CLEAR/.test(i.Text)), false);
    assert.ok(map.Top + map.Height < radar.Top);
    for (const component of [radar, map, ...items.filter(i => /^(Map |Radar )/.test(i.Name))]) {
      assert.ok(component.Left >= panel.Left && component.Left + component.Width <= panel.Left + panel.Width);
      assert.ok(component.Top >= panel.Top && component.Top + component.Height <= panel.Top + panel.Height);
    }
    for (const component of [radar, map]) {
      assert.equal('Opponents' in component, false);
      assert.equal('MapReady' in component, false);
      assert.equal('LeaderboardMode' in component, false);
    }
    for (const name of ['Air', 'Track', 'Wind']) {
      const reading = items.find(i => i.Name === `Map ${name}`);
      assert.ok(reading.Top >= panel.Top && reading.Top + reading.Height < map.Top);
      assert.ok(reading.Left >= panel.Left && reading.Left + reading.Width < panel.Left + panel.Width);
    }
    const circuit = items.find(i => i.Name === 'Circuit layout');
    for (const game of ['AssettoCorsa', 'Automobilista2', 'LeMansUltimate', 'AssettoCorsaRally', 'ETS2', 'ATS']) {
      const p = props(game);
      assert.equal(new Function('$prop', circuit.Bindings.Visible.Formula.Expression)(k => p[k] ?? null),
        ['AssettoCorsa', 'Automobilista2', 'LeMansUltimate'].includes(game));
    }
  });
  test(`${width}x1080 class gaps select the same standings neighbour and use player gaps, not leader or track gaps`, () => {
    const items = flatten(createDashboard(width).Screens[0].Items);
    for (const side of ['ahead', 'behind']) {
      const name = items.find(i => i.Name === `Class ${side}`);
      const gap = items.find(i => i.Name === `Class ${side} gap`);
      assert.match(gap.$type, /\.BuiltIn\.LeaderboardOpponentGap,/);
      assert.equal(gap.GapMode, 2, 'Explicit FromPlayer, independent of global preferences');
      for (const key of ['LeaderboardMode', 'LeaderboardPosition', 'LeaderboardPositionRelativeToPlayer', 'LeaderboardPositionRelativeToPlayerOnTrack']) {
        assert.equal(gap[key], name[key], key);
      }
      assert.equal(gap.Format, '0.000');
      assert.equal(gap.TextAfterValue, ' s');
      assert.equal(gap.NoDataText, '--');
      assert.equal(gap.EmptyValueText, '--');
      assert.deepEqual(gap.Bindings.Visible, name.Bindings.Visible);
      assert.ok(name.Left + name.Width < gap.Left, 'Names and gaps must not overlap');
      assert.equal(name.Top, gap.Top);
      assert.equal(name.Height, gap.Height);
    }
  });
  test(`${width}x1080 music has three native transport buttons and preserves pedals on every game`, () => {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const buttons = items.filter(item => item.$type.includes('.ButtonItem,') && item.Name.startsWith('Music '));
    assert.deepEqual(buttons.map(item => item.TriggerAction), Object.values(mediaActions));
    for (const button of buttons) {
      assert.equal(button.IsEnabled, true);
      assert.equal(button.SimulateKey, false);
    }
    for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'Automobilista2', 'LeMansUltimate']) {
      const p = props(game);
      const visible = name => new Function('$prop', items.find(item => item.Name === name).Bindings.Visible.Formula.Expression)(key => p[key] ?? null);
      assert.equal(visible('Music controls'), game === 'AssettoCorsa');
      const panel = items.find(i => i.Name === 'Driving panel');
      for (const key of ['Throttle', 'Brake', 'Clutch', 'Handbrake']) {
        const pedal = items.find(i => i.Name === `${key} bar`);
        assert.equal(pedal.Width, 32);
        assert.ok(pedal.Left > panel.Left + panel.Width / 2);
        assert.ok(pedal.Top > panel.Top + (items.find(i => i.Name === 'Cluster scale source').Top - panel.Top) * 0.75,
          'Pedals remain in the bottom portion of the instrument area, above boost');
        assert.ok(pedal.Left + pedal.Width < panel.Left + panel.Width);
        assert.ok(pedal.Top + pedal.Height < panel.Top + panel.Height);
        assert.ok(pedal.Height > pedal.Width);
        const text = items.find(i => i.Name === key);
        assert.ok(text.Left >= pedal.Left && text.Left + text.Width <= pedal.Left + pedal.Width);
        assert.ok(text.Top >= pedal.Top && text.Top + text.Height <= pedal.Top + pedal.Height);
        const run = (target, v) => new Function('$prop', pedal.Bindings[target].Formula.Expression)(p =>
          props(game, { [`DataCorePlugin.GameData.${key}`]: v })[p] ?? null);
        for (const [v, fraction] of [[0, 0], [50, 0.5], [100, 1], [150, 1], [-5, 0], [null, 0]]) {
          assert.equal(run('Height', v), pedal.Height * fraction);
          assert.equal(run('Top', v) + run('Height', v), pedal.Top + pedal.Height);
        }
      }
      const pedalBars = ['Throttle', 'Brake', 'Clutch', 'Handbrake'].map(key => items.find(i => i.Name === `${key} bar`));
      assert.ok(pedalBars.every((pedal, index) => index === 0 || pedal.Left - pedalBars[index - 1].Left <= 48));
    }
    for (const name of ['Music title', 'Music artist']) {
      const item = items.find(i => i.Name === name);
      const p = { 'SystemInfosProvider.Title': 'W'.repeat(500), 'SystemInfosProvider.Artist': 'W'.repeat(500) };
      const result = new Function('$prop', item.Bindings.Text.Formula.Expression)(key => p[key] ?? null);
      assert.ok(result.endsWith('...'));
      assert.ok(result.length <= Math.floor(item.Width / (name === 'Music title' ? 15 : 11)));
    }
  });
  test(`${width}x1080 native output is persistent, deterministic, correctly sized and self-contained`, async () => {
    const dashboard = createDashboard(width);
    const file = new URL(`../${width}x1080/Y.A.S.S%20${width}x1080.djson`, import.meta.url);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), dashboard);
    assert.equal(dashboard.BaseWidth, width);
    assert.equal(dashboard.BaseHeight, 1080);
    assert.equal(dashboard.Screens.length, 1);
    assert.deepEqual(dashboard.Images, dashboardImages.map(image => image.metadata));
    assert.deepEqual(await readFile(new URL(file.href + '.ressources')), standbyResources());
    assert.equal(dashboard.Screens[0].IdleScreen, true);
    assert.equal(dashboard.Screens[0].PitScreen, true);
    const names = new Set();
    for (const item of flatten(dashboard.Screens[0].Items)) {
      assert.ok(!names.has(item.Name), `Duplicate item name: ${item.Name}`);
      names.add(item.Name);
      if (item.Childrens) continue;
      assert.ok(item.Left >= 0 && item.Top >= 0, item.Name);
      assert.ok(item.Left + item.Width <= width, `Horizontal bounds: ${item.Name}`);
      assert.ok(item.Top + item.Height <= 1080, `Vertical bounds: ${item.Name}`);
      assert.ok(item.Width > 0 && (item.Height > 0 || /^Wheel (FL|FR|RL|RR) life fill$/.test(item.Name)), item.Name);
      if (item.IsTextItem) assert.ok(item.Height >= item.FontSize * 1.25, `Font vertical clearance: ${item.Name}`);
      assert.match(item.BackgroundColor, /^#[A-F\d]{8}$/i);
    }
    const metadata = JSON.parse(await readFile(new URL(file.href + '.metadata'), 'utf8'));
    assert.deepEqual(metadata, dashboard.Metadata);
    const html = await readFile(new URL(`../${width}x1080/preview.html`, import.meta.url), 'utf8');
    assert.ok(html.includes('SAMPLE DATA ONLY'));
    assert.ok(html.includes('"BaseWidth":' + width));
    assert.ok(!/<script[^>]+src=|<link[^>]+href=/.test(html), 'Offline preview must not need a server or CDN');
  });

  test(`${width}x1080 every binding evaluates with normal, zero, missing, and invalid telemetry`, () => {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const keys = ['SpeedKmh', 'Rpms', 'Fuel', 'MaxFuel', 'Throttle', 'Brake', 'Clutch', 'Gear'];
    const scenarios = [
      {}, props(), props('AssettoCorsaRally'), props('ATS'), props('ETS2'),
      props('Unknown'), props('AssettoCorsa', { 'DataCorePlugin.GameRunning': false }),
      props('AssettoCorsa', Object.fromEntries(keys.map(key => ['DataCorePlugin.GameData.' + key, 0]))),
      props('AssettoCorsa', Object.fromEntries(keys.map(key => ['DataCorePlugin.GameData.' + key, 'invalid']))),
    ];
    for (const p of scenarios) {
      for (const item of items) {
        for (const [target, b] of Object.entries(item.Bindings || {})) {
          assert.equal(b.Mode, 2);
          assert.equal(b.Formula.Interpreter, 1);
          const value = new Function('$prop', 'root', b.Formula.Expression)(key => p[key] ?? null, {});
          if (target === 'Visible') assert.equal(typeof value, 'boolean', item.Name);
          if (target === 'Text') {
            assert.equal(typeof value, 'string', item.Name);
            assert.ok(!/NaN|undefined|null/.test(value), item.Name);
          }
          if (target === 'TextColor') assert.match(value, /^#[A-F\d]{8}$/i, item.Name);
          if (target === 'Opacity') assert.ok(Number.isFinite(value) && value >= 0 && value <= 100, item.Name);
          if (target === 'Width') assert.ok(Number.isFinite(value) && value >= 0 && value <= item.Width, item.Name);
          if (target === 'ShowNeedle' || target === 'BlinkEnabled') assert.equal(typeof value, 'boolean', item.Name);
          if (['Value', 'Maximum', 'MajorDivisionsCount', 'RangeOptimalEndValue'].includes(target)) {
            assert.ok(Number.isFinite(value) && value >= 0, `${item.Name}: ${target}`);
            if (target === 'Maximum' || target === 'MajorDivisionsCount') assert.ok(value > 0);
          }
        }
      }
    }
  });
}

test('truck pages, telemetry and preview choices are removed in both resolutions', async () => {
  for (const width of [1920, 2560]) {
    const dashboard = createDashboard(width);
    const items = flatten(dashboard.Screens[0].Items);
    assert.match(items.find(i => i.Name === 'Standby games').Text, /ASSETTO CORSA \/ AC RALLY \/ AUTOMOBILISTA 2 \/ LE MANS ULTIMATE \/ RICHARD BURNS RALLY \(RSF\)/);
    assert.ok(!/ETS2|ATS|Truck|HAUL|GameRawData\.TruckValues|SIX SIMULATORS/.test(JSON.stringify(dashboard)));
    const html = await readFile(new URL(`../${width}x1080/preview.html`, import.meta.url), 'utf8');
    assert.ok(html.includes('value="RichardBurnsRally"'));
    assert.ok(!/value="(?:ETS2|ATS)"|isTruck|TruckValues|Euro Truck|American Truck/.test(html));
    for (const game of ['ETS2', 'ATS', 'EuroTruckSimulator2', 'AmericanTruckSimulator']) {
      const p = props(game);
      assert.equal(evaluate('return live();', p), false);
      assert.equal(evaluate('return status();', p), 'UNSUPPORTED GAME');
      for (const name of ['Live driving', 'Live lower strip', 'Circuit layout', 'Tyre summary', 'Rally layout']) {
        assert.equal(new Function('$prop', items.find(i => i.Name === name).Bindings.Visible.Formula.Expression)(key => p[key] ?? null), false, name);
      }
    }
  }
});

test('tyre remaining life preserves zero and validates the normalized 0..100 percentage without guessing ratios', () => {
  for (const corner of ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight']) {
    for (const [input, expected] of [[100, '100.0%'], [92.45, '92.5%'], [0, '0.0%'], [0.5, '0.5%'], ['80', '80.0%'],
      [null, '--'], ['', '--'], [true, '--'], [-1, '--'], [100.01, '--'], [Infinity, '--'], ['bad', '--']]) {
      assert.equal(evaluate(`return tyreLife('${corner}');`, { ['DataCorePlugin.GameData.TyreWear' + corner]: input }), expected);
    }
  }
});

test('tyre wear fill animates smoothly from empty to full and back', () => {
  const items = flatten(createDashboard(1920).Screens[0].Items);
  const track = items.find(i => i.Name === 'Wheel FL wear track');
  const fill = items.find(i => i.Name === 'Wheel FL life fill');
  const expression = fill.Bindings.Height.Formula.Expression;
  const root = {};
  const heightAt = (wear, time, state = root) => {
    const input = props('AC', { 'DataCorePlugin.GameData.TyreWearFrontLeft': wear });
    return new Function('$prop', 'Date', 'root', expression)(key => input[key] ?? null,
      class extends Date { constructor() { super(time); } }, state);
  };
  assert.equal(heightAt(0, 0, {}), 0, 'Worn tyres are empty');
  assert.equal(heightAt(100, 0, {}), track.Height, 'New tyres fill the wheel');
  assert.equal(heightAt(100, 0), track.Height);
  assert.equal(heightAt(0, 100), track.Height, 'A wear change starts at the current fill');
  assert.ok(Math.abs(heightAt(0, 250) - track.Height / 2) < 0.001, 'Fill eases through halfway');
  assert.equal(heightAt(0, 400), 0);
  assert.equal(heightAt(100, 500), 0);
  assert.ok(Math.abs(heightAt(100, 650) - track.Height / 2) < 0.001);
  assert.equal(heightAt(100, 800), track.Height);
  assert.equal(heightAt(null, 0, {}), 0, 'Missing wear remains empty');
});

for (const width of [1920, 2560]) {
  test(`${width}x1080 shows four wheel graphics with per-corner tyre and brake data`, () => {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const panel = items.find(i => i.Name === 'Tyre summary');
    const panelBounds = items.find(i => i.Name === 'Tyre summary panel');
    const run = (expression, p) => new Function('$prop', expression)(key => p[key] ?? null);
    for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'Automobilista2', 'LeMansUltimate']) {
      assert.equal(run(panel.Bindings.Visible.Formula.Expression, props(game)), true);
      assert.equal(run(panel.Bindings.Visible.Formula.Expression, props(game, { 'DataCorePlugin.GameRunning': false })), false);
    }
    assert.equal(items.some(i => i.Name === 'Non circuit fluids'), false);
    assert.ok(items.some(i => i.Name === 'Rally stage panel'));
    for (const name of ['Rally vehicle title', 'Rally water', 'Rally oil', 'Rally fuel']) {
      assert.equal(items.some(i => i.Name === name), false, name);
    }
    assert.equal(items.filter(i => /^Wheel (FL|FR|RL|RR) casing$/.test(i.Name)).length, 4);
    assert.equal(items.filter(i => /^Wheel (FL|FR|RL|RR) life fill$/.test(i.Name)).length, 4);
    assert.equal(items.some(i => /tread|groove|shoulder/i.test(i.Name)), false);
    const compound = items.find(i => i.Name === 'Tyre compound');
    assert.match(compound.Bindings.Text.Formula.Expression, /detailReading\('compound', 'text', null\)/);
    assert.equal(items.some(i => /life left/i.test(i.Name) || (i.IsTextItem && /life left/i.test(i.Text))), false);
    for (const [short, corner] of [['FL', 'FrontLeft'], ['FR', 'FrontRight'], ['RL', 'RearLeft'], ['RR', 'RearRight']]) {
      const temperature = items.find(i => i.Name === `Tyre ${short}`);
      const pressure = items.find(i => i.Name === `Tyre ${short} pressure`);
      const brake = items.find(i => i.Name === `Tyre ${short} brake temperature`);
      const t = p => run(temperature.Bindings.Text.Formula.Expression, p);
      const pressureValue = p => run(pressure.Bindings.Text.Formula.Expression, p);
      const brakeValue = p => run(brake.Bindings.Text.Formula.Expression, p);
      const p = props('AC', {
        ['DataCorePlugin.GameData.TyreTemperature' + corner]: 84,
        ['DataCorePlugin.GameData.TyrePressure' + corner]: 26.5,
      });
      assert.equal(t(p), `${short} / 84 C`);
      assert.equal(pressureValue(p), '26.5 psi');
      assert.equal(brakeValue(p), 'B --');
      assert.equal(t({}), `${short} / --`);
      assert.equal(pressureValue({}), '--');
      assert.match(brake.Bindings.Text.Formula.Expression, new RegExp(`detailReading\\('brake${short}', 'temperature', null\\)`));
      assert.ok(temperature.Top >= panelBounds.Top && temperature.Top + temperature.Height <= panelBounds.Top + panelBounds.Height);
      assert.ok(pressure.Top >= panelBounds.Top && pressure.Left >= panelBounds.Left);
      assert.ok(brake.Top >= panelBounds.Top && brake.Left >= panelBounds.Left);
    }
  });
}
