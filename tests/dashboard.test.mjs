import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDashboard, mediaActions } from '../tools/generate.mjs';
import { formula, helpers, profiles, validateProfiles, boostChannels } from '../tools/telemetry.mjs';
import { standbyImages, standbyResources } from '../tools/standby.mjs';
import { inflateSync } from 'node:zlib';
import { detailPages, detailFields } from '../tools/details.mjs';

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
    const full = 'var gaugeProfiles = ' + JSON.stringify(profiles) + ';\n' + helpers + '\n' + body;
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
    Automobilista2: 'race', 'Automobilista 2': 'race', AMS2: 'race',
    LeMansUltimate: 'race', 'Le Mans Ultimate': 'race', LMU: 'race',
    ETS2: 'unsupported', EuroTruckSimulator2: 'unsupported',
    ATS: 'unsupported', AmericanTruckSimulator: 'unsupported', UnknownGame: 'unsupported',
  };
  for (const [game, mode] of Object.entries(cases)) {
    assert.equal(evaluate('return mode();', props(game)), mode, game);
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
  for (const image of standbyImages) {
    assert.equal(archive.readUInt32LE(offset), 0x04034b50);
    const size = archive.readUInt32LE(offset + 18), nameLength = archive.readUInt16LE(offset + 26);
    assert.equal(archive.subarray(offset + 30, offset + 30 + nameLength).toString(), image.name + '.png');
    const png = archive.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    assert.deepEqual(png, image.bytes);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1024);
    assert.equal(png.readUInt32BE(20), 256);
    assert.equal(png[25], 6, 'RGBA artwork');
    const raw = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
    assert.equal(raw.length, (1024 * 4 + 1) * 256);
    assert.equal(raw[4], 0, 'Artwork has transparent edges');
    assert.ok(raw.some((v, i) => i % 4097 > 0 && (i % 4097 - 1) % 4 === 3 && v > 100), 'Ribbon is visible');
    offset += 30 + nameLength + size;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.equal(archive.readUInt16LE(archive.length - 12), 2);
  assert.deepEqual(archive, standbyResources());
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    for (const image of items.filter(i => i.$type.includes('.ImageItem,'))) {
      assert.ok(standbyImages.some(resource => resource.name === image.Image));
      assert.equal(image.MinimumRefreshIntervalMS, 50);
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
      'Rally timing panel', 'Rally vehicle panel', 'Music panel']) {
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
    assert.match(entries.find(i => i.Name === 'RPM dial').Bindings.DialStrokeColor.Formula.Expression, /return redlineAccentColor\(\)/);
    assert.match(entries.find(i => i.Name === 'Gear').Bindings.TextColor.Formula.Expression, /return gearHighlightColor\(\)/);
  }
});

test('night palette is warm across native layouts, dynamic colours and original ribbon artwork', () => {
  const oldColors = /#(?:FF)?(?:090F17|111C29|0C1520|233447|F3F7FC|8496AA|55DDE6|42E6B0|FFBF69|FF6B78)/i;
  for (const width of [1920, 2560]) {
    const dashboard = createDashboard(width), items = flatten(dashboard.Screens[0].Items);
    assert.equal(dashboard.BackgroundColor, '#FF050505');
    assert.ok(!oldColors.test(JSON.stringify(dashboard)), 'No old cool palette remains in generated native output');
    for (const name of ['Speed dial', 'RPM dial', 'Fuel dial']) {
      const dial = items.find(i => i.Name === name);
      assert.match(dial.MajorTickColor, /^#(?:FFE2DFD5|FFFFB02E)$/);
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
    const cx = rpm.Left + rpm.Width / 2, cy = rpm.Top + rpm.Height / 2;
    for (const x of [limiter.Left, limiter.Left + limiter.Width]) {
      for (const y of [limiter.Top, limiter.Top + limiter.Height]) assert.ok(Math.hypot(x - cx, y - cy) < rpm.OuterRadius);
    }
    const flag = items.find(i => i.Name === 'Track flag'), heading = items.find(i => i.Name === 'Drive mode');
    assert.ok(heading.Left + heading.Width <= flag.Left);
    assert.equal(flag.MinimumRefreshIntervalMS, 100);
    assert.equal(limiter.MinimumRefreshIntervalMS, 100);
  }
});

test('auxiliary temperatures and mapped battery values preserve unavailable data and charge zero', () => {
  for (const key of ['OilTemperature', 'WaterTemperature']) {
    for (const [value, expected] of [[95, 95], [0, null], [-1, null], [null, null], [true, null], ['', null]]) {
      assert.equal(evaluate(`return engineTemperature('${key}');`, props('AC', { [key]: value })), expected);
    }
  }
  const config = structuredClone(profiles);
  config.cars.push({ game: 'AC', carId: 'test', batteryVoltageProperty: 'Demo.Voltage',
    batteryChargePercentProperty: 'Demo.SOC' });
  validateProfiles(config);
  for (const [key, percent] of [['batteryVoltageProperty', false], ['batteryChargePercentProperty', true]]) {
    const run = (v, extra = {}) => new Function('$prop', formula(`return batteryReading('${key}', ${percent});`, config).Expression)(
      name => props('AC', { CarId: 'test', 'Demo.Voltage': v, 'Demo.SOC': v, ...extra })[name] ?? null);
    assert.equal(run(14), 14);
    assert.equal(run(0), percent ? 0 : null);
    for (const value of [null, '', true, -1, 'bad']) assert.equal(run(value), null);
    if (percent) assert.equal(run(101), null);
    assert.equal(run(14, { CarId: 'different' }), null);
    assert.equal(run(14, { 'DataCorePlugin.GameRunning': false }), null);
    const invalid = structuredClone(config);
    invalid.cars[0][key] = '';
    assert.throws(() => validateProfiles(invalid), new RegExp(key));
  }
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    for (const name of ['Oil', 'Coolant']) {
      const dial = items.find(i => i.Name === `${name} temperature dial`);
      assert.equal(dial.Width, 100);
      assert.equal(new Function('$prop', dial.Bindings.ShowNeedle.Formula.Expression)(() => null), false);
    }
  }
});

test('circuit boost channels use independent explicit units and never substitute battery SOC', () => {
  const config = structuredClone(profiles);
  config.cars.push({ game: 'AC', carId: 'boost-car',
    ...Object.fromEntries(boostChannels.map(([key]) => [key, `Demo.${key}`])) });
  validateProfiles(config);
  for (const [key, , kind] of boostChannels) {
    const run = (value, extra = {}) => new Function('$prop', formula(`return boostReading('${key}', '${kind}');`, config).Expression)(
      prop => props('AC', { CarId: 'boost-car', [`Demo.${key}`]: value, ...extra })[prop] ?? null);
    assert.equal(run(null), '--');
    assert.equal(run(''), '--');
    assert.equal(run(1, { CarId: 'unmapped' }), '--');
    assert.equal(run(1, { 'DataCorePlugin.GameRunning': false }), '--');
    if (kind === 'switch') {
      assert.equal(run(true), 'ON');
      assert.equal(run(false), 'OFF');
      assert.equal(run(0), 'OFF');
      assert.equal(run(2), '--');
    } else if (kind === 'mode') {
      assert.equal(run('BALANCED'), 'BALANCED');
      assert.equal(run(0), '0');
      assert.equal(run(true), '--');
    } else {
      assert.equal(run(true), '--');
      assert.equal(run(-1), '--');
      assert.equal(run(0), kind === 'count' ? '0' : kind === 'percent' ? '0.0%' : kind === 'power' ? '0.0 kW' : '0.0 MJ');
      assert.equal(run(5), kind === 'count' ? '5' : kind === 'percent' ? '5.0%' : kind === 'power' ? '5.0 kW' : '5.0 MJ');
      if (kind === 'percent') assert.equal(run(101), '--');
      if (kind === 'count') assert.equal(run(1.5), '--');
    }
    const invalid = structuredClone(config);
    invalid.cars[0][key] = ' ';
    assert.throws(() => validateProfiles(invalid), new RegExp(key));
  }
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const driving = items.find(i => i.Name === 'Live driving');
    const section = driving.Childrens.find(i => i.Name === 'Circuit boost');
    const panel = items.find(i => i.Name === 'Driving panel'), music = items.find(i => i.Name === 'Music panel');
    assert.equal(section.Childrens.filter(i => !i.Name.endsWith(' label')).length, 7);
    assert.ok(music.Top + music.Height < panel.Top, 'AC music is in the header');
    for (const entry of section.Childrens) {
      assert.ok(entry.Left >= panel.Left && entry.Left + entry.Width <= panel.Left + panel.Width);
      assert.ok(entry.Top > items.find(i => i.Name === 'Cluster scale source').Top + 24);
      assert.ok(entry.Top + entry.Height <= panel.Top + panel.Height);
    }
    for (const game of ['AC', 'AMS2', 'LMU', 'ACRally']) {
      assert.equal(new Function('$prop', section.Bindings.Visible.Formula.Expression)(
        key => props(game)[key] ?? null), game !== 'ACRally');
    }
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
    for (const item of items.filter(i => i.Name.startsWith('Music ') && i.Name !== 'Music controls')) {
      assert.ok(item.Left >= music.Left && item.Left + item.Width <= music.Left + music.Width, item.Name);
      assert.ok(item.Top >= music.Top && item.Top + item.Height <= music.Top + music.Height, item.Name);
    }
    const driving = get('Driving panel'), circuit = get('Timing panel'), rally = get('Rally timing panel');
    assert.equal(circuit.Left, rally.Left);
    assert.equal(circuit.Top, rally.Top);
    assert.equal(circuit.Height, rally.Height);
    assert.equal(driving.Top + driving.Height, circuit.Top + circuit.Height);
    assert.equal(get('Map panel').Left, get('Rally vehicle panel').Left);
    assert.equal(get('Map panel').Height, get('Rally vehicle panel').Height);
    assert.ok(get('Tyre summary panel').Top > get('Map panel').Top + get('Map panel').Height);
  }
});

test('detail mappings validate units, estimates and warning thresholds without guessing race rules', () => {
  const config = structuredClone(profiles);
  config.cars.push({ game: 'AC', carId: 'details', oilWarningC: 120, coolantWarningC: 100,
    detailProperties: Object.fromEntries(detailFields.map(([key]) => [key, 'Demo.' + key])) });
  validateProfiles(config);
  const run = (expression, values = {}) => new Function('$prop', formula(expression, config).Expression)(
    key => props('AC', { CarId: 'details', ...values })[key] ?? null);
  for (const [key, , kind, normalized] of detailFields) {
    const expression = `return detailReading('${key}', '${kind}', ${normalized ? `'${normalized}'` : 'null'});`;
    assert.equal(run(expression), '--', key);
    assert.equal(run(expression, { ['Demo.' + key]: true }), kind === 'switch' ? 'YES' : '--');
    assert.equal(run(expression, { ['Demo.' + key]: false }), kind === 'switch' ? 'NO' : '--');
    assert.equal(run(expression, { ['Demo.' + key]: '' }), '--');
    assert.equal(run(expression, { ['Demo.' + key]: 5, 'DataCorePlugin.GameRunning': false }), '--');
    const expected = kind === 'text' ? '--' : kind === 'switch' ? 'NO' : kind === 'pressure' ? '--' :
      kind === 'seconds' ? '0:00.000' : kind === 'count' ? '0' : kind === 'delta' ? '+0.000 s' :
      '0.0' + ({litres:' L',laps:' laps',speed:' km/h',temperature:' C',bar:' bar',energy:' MJ',percent:'%',distance:' km'}[kind] || '');
    assert.equal(run(expression, { ['Demo.' + key]: 0 }), expected, key);
  }
  assert.equal(run("return detailReading('fuelLaps','laps');", { 'Demo.fuelPerLap': 3 }), 'EST 20.0 laps');
  assert.equal(run("return detailReading('fuelLaps','laps');", { 'Demo.fuelPerLap': 0 }), '--');
  assert.equal(run("return detailReading('fuelToAdd','litres');", { 'Demo.fuelToFinish': 70 }), 'EST 10.0 L');
  assert.equal(run("return detailReading('fuelToAdd','litres');", { 'Demo.fuelToFinish': 50 }), 'EST 0.0 L');
  assert.equal(run("return detailReading('fuelToFinish','litres');", { 'Demo.sessionSeconds': 3600, 'Demo.fuelPerLap': 3 }), '--');
  assert.equal(run("return detailReading('stageSplitSeconds','delta');", { 'Demo.stageSplitSeconds': -1.25 }), '-1.250 s');
  assert.equal(run("return detailReading('sessionSeconds','seconds');", { 'Demo.sessionSeconds': 3661.5 }), '61:01.500');
  assert.equal(run('return raceWarnings();'), 'WARNINGS / CHECK GAME');
  assert.equal(run('return raceWarnings();', { OilTemperature: 119.9, WaterTemperature: 99.9 }), 'WARNINGS / CHECK GAME');
  assert.equal(run('return raceWarnings();', { OilTemperature: 120, WaterTemperature: 100 }), 'OIL TEMP / COOLANT TEMP');
  assert.equal(run('return raceWarnings();', { IsInPitLane: true, 'Demo.pitLimitKmh': 160 }), 'WARNINGS / CHECK GAME');
  assert.equal(run('return raceWarnings();', { IsInPitLane: true, 'Demo.pitLimitKmh': 159.9 }), 'PIT OVERSPEED');
  assert.equal(run('return raceWarnings();', { 'Demo.penalties': 'NONE' }), 'WARNINGS / CHECK GAME');
  assert.equal(run('return raceWarnings();', { 'Demo.penaltyActive': true, 'Demo.penalties': 'DRIVE THROUGH' }), 'PENALTY: DRIVE THROUGH');
  for (const invalidMap of [null, [], { typo: 'X' }, { fuelLaps: '' }]) {
    const invalid = structuredClone(config);
    invalid.cars[0].detailProperties = invalidMap;
    assert.throws(() => validateProfiles(invalid));
  }
});

test('four manually selectable pages retain fixed instruments, valid bounds and game routing', () => {
  for (const width of [1920, 2560]) {
    const dash = createDashboard(width), overview = flatten(dash.Screens[0].Items);
    assert.deepEqual(dash.Screens.map(s => s.Name), ['MangoDash / Overview', ...detailPages.map(p => `MangoDash / ${p.name}`)]);
    assert.equal(new Set(dash.Screens.map(s => s.ScreenId)).size, 4);
    assert.equal(dash.Metadata.ScreenCount, 4);
    for (const [index, screen] of dash.Screens.entries()) {
      const items = flatten(screen.Items), names = new Set();
      for (const item of items) {
        assert.ok(!names.has(item.Name), `${screen.Name}: duplicate ${item.Name}`);
        names.add(item.Name);
        if (item.Childrens) continue;
        assert.ok(item.Left >= 0 && item.Top >= 0 && item.Left + item.Width <= width && item.Top + item.Height <= 1080, item.Name);
        if (item.Name.startsWith('Detail ') && !item.Name.startsWith('Detail navigation') && item.Name !== 'Detail next page') {
          assert.ok(item.Top + item.Height < 178 + 606, item.Name);
        }
        for (const binding of Object.values(item.Bindings || {})) {
          for (const data of [{}, props('AC'), props('ACRally'), props('Unknown')]) {
            assert.doesNotThrow(() => new Function('$prop','root',binding.Formula.Expression)(key => data[key] ?? null, {}), item.Name);
          }
        }
      }
      for (const name of ['Gear','RPM dial','Speed dial','Pit limiter','Throttle bar','Warning summary']) {
        assert.deepEqual(items.find(i=>i.Name===name), overview.find(i=>i.Name===name));
      }
      const next = items.find(i=>i.Name==='Detail next page');
      assert.equal(next.TriggerAction, 'GraphicalDashPlugin.NextScreen');
      if (index) {
        assert.equal(items.filter(i=>i.Name.startsWith('Detail ') && !i.Name.endsWith(' label') && !i.Name.startsWith('Detail navigation') && !['Detail heading','Detail availability','Detail next page'].includes(i.Name)).length,
          detailPages[index-1].fields.length);
        assert.equal(items.some(i=>i.Name==='Track minimap'), false);
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
  for (const game of ['AssettoCorsaRally', 'ACRally', 'Automobilista2', 'AMS2', 'LeMansUltimate', 'LMU', 'Unknown', 'ETS2', 'EuroTruckSimulator2', 'ATS', 'AmericanTruckSimulator']) {
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
  for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'Automobilista2', 'LeMansUltimate']) {
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
  const config = structuredClone(profiles);
  config.cars.push({ game: 'AssettoCorsa', carId: 'test-car', tcCutProperty: 'ExamplePlugin.CutLevel' });
  validateProfiles(config);
  const mapped = p => new Function('$prop', formula("return carSetting('TractionControlCut');", config).Expression)(key => p[key] ?? null);
  const p = props('AssettoCorsa', { CarId: 'test-car', TractionControlCut: 9, 'ExamplePlugin.CutLevel': 0 });
  assert.equal(mapped(p), '0');
  assert.equal(mapped({ ...p, 'ExamplePlugin.CutLevel': null }), '--');
  assert.equal(mapped({ ...p, CarId: 'another-car' }), '9');
  assert.equal(mapped({ ...p, 'DataCorePlugin.CurrentGame': 'LeMansUltimate' }), '9');
  for (const tcCutProperty of ['', ' ', null, 1, true]) {
    const invalid = structuredClone(config);
    invalid.cars[0].tcCutProperty = tcCutProperty;
    assert.throws(() => validateProfiles(invalid), /tcCutProperty/);
  }
  for (const width of [1920, 2560]) {
    const panel = createDashboard(width).Screens[0].Items.find(i => i.Name === 'Car settings');
    assert.equal(panel.Childrens.length, 10);
    for (const key of channels) {
      const item = panel.Childrens.find(i => i.Name === `${key} setting`);
      assert.ok(item.Top > 140 && item.Top + item.Height < 178);
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
  const config = structuredClone(profiles);
  config.cars.push({ game: 'LeMansUltimate', carId: 'test-car', windSpeedMsProperty: 'ExamplePlugin.WindMs' });
  validateProfiles(config);
  const run = p => new Function('$prop', formula('return windSpeed();', config).Expression)(key => p[key] ?? null);
  const p = props('LeMansUltimate', { CarId: 'test-car', 'ExamplePlugin.WindMs': 5 });
  assert.equal(run(p), '18.0 km/h');
  assert.equal(run({ ...p, 'ExamplePlugin.WindMs': null }), '--');
  assert.equal(run({ ...p, CarId: 'another-car' }), '--');
  assert.equal(run({ ...p, 'DataCorePlugin.GameRunning': false }), '--');
  for (const windSpeedMsProperty of ['', ' ', null, 1]) {
    const invalid = structuredClone(config);
    invalid.cars[0].windSpeedMsProperty = windSpeedMsProperty;
    assert.throws(() => validateProfiles(invalid), /windSpeedMsProperty/);
  }
  for (const width of [1920, 2560]) {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const panel = items.find(i => i.Name === 'Map panel');
    const map = items.find(i => i.Name === 'Track minimap');
    for (const name of ['Air', 'Track', 'Wind']) {
      const reading = items.find(i => i.Name === `Map ${name}`);
      assert.ok(reading.Top >= panel.Top && reading.Top + reading.Height < map.Top);
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
  const config = structuredClone(profiles);
  config.cars.push({ game: 'AMS2', carId: 'test-car',
    windFromDegreesProperty: 'Example.WindFrom', headingDegreesProperty: 'Example.Heading' });
  validateProfiles(config);
  const run = (expression, wind, heading, extra = {}) => new Function('$prop', formula(expression, config).Expression)(
    key => props('AMS2', { CarId: 'test-car', 'Example.WindFrom': wind, 'Example.Heading': heading,
      'DataCorePlugin.GameRawData.mWindSpeed': 5, ...extra })[key] ?? null);
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
  assert.equal(run('return windCompass();', 315, 0, { CarId: 'different-car' }), 'FROM --');
  assert.equal(run('return windCompass();', 315, 0, { 'DataCorePlugin.GameRunning': false }), 'FROM --');
  for (const expression of ['return windCompass();', 'return windRelative();']) {
    assert.equal(run(expression, null, null, { 'DataCorePlugin.GameRawData.mWindSpeed': 0 }), 'CALM');
  }
  for (const key of ['windFromDegreesProperty', 'headingDegreesProperty']) {
    for (const value of ['', ' ', null, 1]) {
      const invalid = structuredClone(config);
      invalid.cars[0][key] = value;
      assert.throws(() => validateProfiles(invalid), new RegExp(key));
    }
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
      for (const target of targets) {
        const run = (p, time) => new Function('$prop', 'Date', item.Bindings[target].Formula.Expression)(
          key => p[key] ?? null, class extends Date { constructor() { super(time); } });
        for (const [time, color] of [[0, '#FFFF0000'], [499, '#FFFF0000'], [500, '#FFFFB02E'], [999, '#FFFFB02E'], [1000, '#FFFF0000']]) {
          for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'Automobilista2', 'LeMansUltimate']) {
            assert.equal(run(props(game, { 'DataCorePlugin.GameData.Fuel': 6 }), time), color);
            assert.equal(run(props(game, { 'DataCorePlugin.GameData.Fuel': 10 }), time), '#FFFFB02E');
          }
          assert.equal(run({}, time), '#FFFFB02E');
        }
      }
    }
  }
});

test('vehicle configuration rejects malformed, ambiguous and out-of-range profiles', () => {
  const copy = () => structuredClone(profiles);
  assert.equal(validateProfiles(copy()).defaults.race.speedKmh, 360);
  const bad = [
    {}, { ...copy(), cars: {} }, { ...copy(), tyres: true },
    { ...copy(), defaults: { ...copy().defaults, racing: {} } },
  ];
  for (const [field, value] of [['speedKmh', 0], ['speedKmh', '100'], ['rpmFallback', Infinity], ['rpmFallback', 400]]) {
    const c = copy(); c.defaults.rally[field] = value; bad.push(c);
  }
  for (const entry of [
    { game: 'AC' }, { game: ' ', carId: 'test' }, { game: 'AC', carId: 1 },
    { game: 'AC', carId: 'test', rpmMax: -1 }, { game: 'AC', carId: 'test', speed: 300 },
  ]) bad.push({ ...copy(), cars: [entry] });
  bad.push({ ...copy(), cars: [{ game: 'Assetto Corsa', carId: 'GT' }, { game: 'assettocorsa', carId: 'gt' }] });
  const defaultOverride = copy(); defaultOverride.defaults.race.rpmMax = 10000; bad.push(defaultOverride);
  for (const c of bad) assert.throws(() => validateProfiles(c));
});

test('speed scales are stable profiles, not observed speed', () => {
  for (const [game, expected] of [['AssettoCorsa', 360], ['Automobilista2', 360], ['LeMansUltimate', 360], ['AssettoCorsaRally', 240]]) {
    for (const speed of [0, 50, 999, null]) {
      const p = props(game, { 'DataCorePlugin.GameData.SpeedKmh': speed });
      assert.equal(evaluate('return speedMaximum();', p), expected);
    }
  }
});

test('RPM scale follows changing vehicles, rounds up, and labels explicit fallbacks', () => {
  for (const [limit, max] of [[2500, 2.5], [2750, 3], [8500, 9], [16000, 16]]) {
    const p = props('AssettoCorsa', { MaxRpm: limit });
    assert.equal(evaluate('return rpmScale();', p), max);
    assert.equal(evaluate('return rpmSource();', p), 'LIVE LIMIT');
  }
  const p = props('AssettoCorsa', { MaxRpm: null, 'DataCorePlugin.GameData.CarSettings_MaxRPM': 2400 });
  assert.equal(evaluate('return rpmMax();', p), 2400);
  for (const [game, expected] of [['AssettoCorsa', 9000], ['AssettoCorsaRally', 8000]]) {
    const missing = props(game, { MaxRpm: null });
    assert.equal(evaluate('return rpmMax();', missing), expected);
    assert.equal(evaluate('return rpmSource();', missing), 'PROFILE');
  }
});

test('exact game/car profiles override ranges without leaking into another car or game', () => {
  const config = validateProfiles({
    ...structuredClone(profiles),
    cars: [{ game: 'Assetto Corsa', carId: 'sample_formulacar', rpmMax: 15000, speedKmh: 400 }],
  });
  const run = p => new Function('$prop', formula('return [rpmMax(), rpmScale(), speedMaximum(), rpmSource()];', config).Expression)(key => p[key] ?? null);
  assert.deepEqual(run(props('AssettoCorsa', { 'DataCorePlugin.GameData.CarId': 'SAMPLE_FORMULACAR' })), [15000, 15, 400, 'OVERRIDE']);
  assert.deepEqual(run(props('AssettoCorsa', { 'DataCorePlugin.GameData.CarId': 'another-car' })), [8000, 8, 360, 'LIVE LIMIT']);
  assert.deepEqual(run(props('Automobilista2', { 'DataCorePlugin.GameData.CarId': 'sample_formulacar' })), [8000, 8, 360, 'LIVE LIMIT']);
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
  test(`${width}x1080 uses three native dials with bounded values and unavailable needles`, () => {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const dials = items.filter(i => ['Speed dial', 'RPM dial', 'Fuel dial'].includes(i.Name));
    assert.deepEqual(dials.map(i => i.Name), ['Speed dial', 'RPM dial', 'Fuel dial']);
    const run = (item, key, p) => new Function('$prop', item.Bindings[key].Formula.Expression)(k => p[k] ?? null);
    for (const dial of dials) {
      assert.equal(run(dial, 'ShowNeedle', {}), false);
      assert.equal(run(dial, 'ShowNeedle', props()), true);
      const zero = props('AssettoCorsa', { 'DataCorePlugin.GameData.SpeedKmh': 0, 'DataCorePlugin.GameData.Rpms': 0, 'DataCorePlugin.GameData.Fuel': 0 });
      assert.equal(run(dial, 'ShowNeedle', zero), true);
      assert.equal(run(dial, 'Value', zero), 0);
      const high = props('AssettoCorsa', { 'DataCorePlugin.GameData.SpeedKmh': 999, 'DataCorePlugin.GameData.Rpms': 99999, 'DataCorePlugin.GameData.Fuel': 999 });
      assert.equal(run(dial, 'Value', high), dial.Name === 'Speed dial' ? 360 : dial.Name === 'RPM dial' ? 8 : 100);
    }
    const fuel = dials[2];
    const [speed, rpm] = dials;
    const center = item => ({ x: item.Left + item.Width / 2, y: item.Top + item.Height / 2 });
    const speedCenter = center(speed), rpmCenter = center(rpm), fuelCenter = center(fuel);
    assert.ok(rpm.Width >= speed.Width * 1.4, 'RPM must remain the dominant instrument');
    assert.ok(speedCenter.x < rpmCenter.x && speedCenter.y > rpmCenter.y, 'Speedometer is staggered down and left');
    const overlap = rpm.OuterRadius + speed.OuterRadius -
      Math.hypot(speedCenter.x - rpmCenter.x, speedCenter.y - rpmCenter.y);
    assert.ok(overlap > 0 && overlap < speed.Width * 0.25, 'Speedometer slightly underlaps RPM');
    assert.ok(Math.abs(overlap - 10) < 0.001, 'Only 10 pixels of rim underlap keeps speed markings readable');
    assert.ok(items.indexOf(speed) < items.indexOf(rpm), 'RPM is drawn in front of speed');
    assert.equal(rpm.DialBackgroundColor, '#FF101010', 'Opaque RPM face masks the underlap');
    assert.ok(Math.hypot(fuelCenter.x - rpmCenter.x, fuelCenter.y - rpmCenter.y) +
      fuel.OuterRadius < rpm.OuterRadius, 'Fuel fits inside the RPM instrument');
    for (const name of ['Gear', 'Speed', 'Fuel state']) {
      const text = items.find(i => i.Name === name);
      assert.ok(!text.Text.includes('OUTER') && !text.Text.includes('INNER'));
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
    const radar = items.find(i => i.Name === 'Nearby radar'), map = items.find(i => i.Name === 'Track minimap');
    assert.match(radar.$type, /\.RadarItem,/);
    assert.match(map.$type, /\.GeneratedStaticMapItem,/);
    assert.equal(map.OverrideColorsWithCarClassColors, true);
    assert.equal(map.DisplayPerClassPosition, true);
    const panel = items.find(i => i.Name === 'Map panel');
    assert.equal(items.some(i => i.Name === 'Radar panel'), false, 'Map and radar share one panel');
    assert.equal(radar.Width, 104, 'Radar is half its previous width');
    assert.equal(radar.Height, 104, 'Radar is half its previous height');
    assert.equal(radar.Scale, 0.3);
    assert.equal(radar.Left, panel.Left + 24, 'Radar stays bottom-left');
    assert.ok(radar.Top > panel.Top + panel.Height / 2);
    assert.equal(map.Height, 320, 'Map gains space from the former radar panel');
    assert.ok(map.Width * map.Height > 10 * radar.Width * radar.Height, 'Map remains the focus');
    assert.ok(map.Top + map.Height < radar.Top, 'Radar does not cover the map');
    for (const component of [radar, map, ...items.filter(i => /^(Map |Radar )/.test(i.Name))]) {
      assert.ok(component.Left >= panel.Left && component.Left + component.Width <= panel.Left + panel.Width);
      assert.ok(component.Top >= panel.Top && component.Top + component.Height <= panel.Top + panel.Height);
    }
    for (const component of [radar, map]) {
      assert.equal('Opponents' in component, false);
      assert.equal('MapReady' in component, false);
      assert.equal('LeaderboardMode' in component, false);
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
    }
    for (const name of ['Music title', 'Music artist']) {
      const item = items.find(i => i.Name === name);
      const p = { 'SystemInfosProvider.Title': 'W'.repeat(500), 'SystemInfosProvider.Artist': 'W'.repeat(500) };
      const result = new Function('$prop', item.Bindings.Text.Formula.Expression)(key => p[key] ?? null);
      assert.ok(result.endsWith('...'));
      assert.ok(result.length <= Math.floor(item.Width / (name === 'Music title' ? 18 : 14)));
    }
  });
  test(`${width}x1080 native output is persistent, deterministic, correctly sized and self-contained`, async () => {
    const dashboard = createDashboard(width);
    const file = new URL(`../${width}x1080/MangoDash%20MultiSim%20${width}x1080.djson`, import.meta.url);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), dashboard);
    assert.equal(dashboard.BaseWidth, width);
    assert.equal(dashboard.BaseHeight, 1080);
    assert.equal(dashboard.Screens.length, 4);
    assert.deepEqual(dashboard.Images, standbyImages.map(image => image.metadata));
    assert.deepEqual(await readFile(new URL(file.href + '.ressources')), standbyResources());
    assert.equal(flatten(dashboard.Screens[0].Items).find(i => i.Name === 'Brand').Text, 'MangoDash');
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
      assert.ok(item.Width > 0 && item.Height > 0, item.Name);
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
  assert.deepEqual(Object.keys(profiles.defaults), ['race', 'rally']);
  for (const width of [1920, 2560]) {
    const dashboard = createDashboard(width);
    const items = flatten(dashboard.Screens[0].Items);
    assert.match(items.find(i => i.Name === 'Standby games').Text, /ASSETTO CORSA \/ AC RALLY \/ AUTOMOBILISTA 2 \/ LE MANS ULTIMATE/);
    assert.ok(!/ETS2|ATS|Truck|HAUL|GameRawData\.TruckValues|SIX SIMULATORS/.test(JSON.stringify(dashboard)));
    const html = await readFile(new URL(`../${width}x1080/preview.html`, import.meta.url), 'utf8');
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

for (const width of [1920, 2560]) {
  test(`${width}x1080 shares a compact independent temperature/life panel across all four games`, () => {
    const items = flatten(createDashboard(width).Screens[0].Items);
    const panel = items.find(i => i.Name === 'Tyre summary');
    const run = (expression, p) => new Function('$prop', expression)(key => p[key] ?? null);
    for (const game of ['AssettoCorsa', 'AssettoCorsaRally', 'Automobilista2', 'LeMansUltimate']) {
      assert.equal(run(panel.Bindings.Visible.Formula.Expression, props(game)), true);
      assert.equal(run(panel.Bindings.Visible.Formula.Expression, props(game, { 'DataCorePlugin.GameRunning': false })), false);
    }
    assert.equal(items.some(i => i.Name === 'Non circuit fluids'), false);
    assert.ok(items.some(i => i.Name === 'Rally oil'));
    for (const [short, corner] of [['FL', 'FrontLeft'], ['FR', 'FrontRight'], ['RL', 'RearLeft'], ['RR', 'RearRight']]) {
      const temperature = items.find(i => i.Name === `Tyre ${short}`);
      const life = items.find(i => i.Name === `Tyre ${short} life`);
      const t = p => run(temperature.Bindings.Text.Formula.Expression, p);
      const w = p => run(life.Bindings.Text.Formula.Expression, p);
      const p = { ['DataCorePlugin.GameData.TyreTemperature' + corner]: 84, ['DataCorePlugin.GameData.TyreWear' + corner]: 0 };
      assert.equal(t(p), `${short} / 84 C`);
      assert.equal(w(p), 'LIFE LEFT / 0.0%');
      assert.equal(t({}), `${short} / --`);
      assert.equal(w({}), 'LIFE LEFT / --');
      assert.equal(t({ ['DataCorePlugin.GameData.TyreTemperature' + corner]: 84 }), `${short} / 84 C`);
      assert.equal(w({ ['DataCorePlugin.GameData.TyreTemperature' + corner]: 84 }), 'LIFE LEFT / --');
      assert.ok(temperature.Top + temperature.Height <= life.Top);
    }
  });
}
