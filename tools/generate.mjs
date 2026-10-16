import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { binding, boostChannels, profiles } from './telemetry.mjs';
import { standbyImages, standbyResources } from './standby.mjs';
import { detailPages, detailFields } from './details.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const colors = {
  bg: '#FF050505', panel: '#FF101010', inset: '#FF080808',
  line: '#FF303030', white: '#FFE2DFD5', muted: '#FFA18D73',
  cyan: '#FFFF8A1C', green: '#FF78A34D', amber: '#FFFFB02E', red: '#FFFF3B24',
};
const type = name => `SimHub.Plugins.OutputPlugins.GraphicalDash.Models.${name}, SimHub.Plugins`;

function item(kind, name, x, y, w, h, extra = {}) {
  return {
    $type: type(kind), Name: name, Left: x, Top: y, Width: w, Height: h,
    Visible: true, BlinkPhasisInverted: false, RenderingSkip: 0,
    MinimumRefreshIntervalMS: 50, ...extra,
  };
}
function rect(name, x, y, w, h, color, bindings = {}) {
  return item('RectangleItem', name, x, y, w, h, {
    IsRectangleItem: true, BackgroundColor: color, Bindings: bindings,
  });
}
function label(name, value, x, y, w, h, size = 24, color = colors.white, expression, align = 0) {
  return item('TextItem', name, x, y, w, h, {
    IsTextItem: true, Font: 'Segoe UI', FontSize: size, Text: value,
    TextColor: color, HorizontalAlignment: align, VerticalAlignment: 1,
    BackgroundColor: '#00000000',
    ...(expression ? { Bindings: { Text: binding(expression) } } : {}),
  });
}
function layer(name, children, visible) {
  return {
    $type: type('Layer'), Name: name, Group: true, Repetitions: 0,
    Childrens: children, Visible: true, BlinkPhasisInverted: false,
    RenderingSkip: 0, MinimumRefreshIntervalMS: 50,
    Bindings: { Visible: binding(visible) },
  };
}
function value(items, name, title, sample, x, y, w, expression, color = colors.white, size = 46) {
  items.push(label(`${name} label`, title, x, y, w, 32, 19, colors.muted));
  items.push(label(name, sample, x, y + 36, w, Math.max(66, Math.ceil(size * 1.4)), size, color, expression));
}
function panel(items, name, x, y, w, h) {
  items.push(rect(name, x, y, w, h, colors.panel));
}
function bar(items, name, x, y, w, h, expression, color) {
  items.push(rect(`${name} track`, x, y, w, h, colors.line));
  items.push(rect(name, x, y, w, h, color, {
    Height: binding(`var v = number(${expression}); return v === null ? 0 : ${h} * Math.max(0, Math.min(100, v)) / 100;`),
    Top: binding(`var v = number(${expression}); return ${y + h} - (v === null ? 0 : ${h} * Math.max(0, Math.min(100, v)) / 100);`),
  }));
}
export const mediaActions = {
  Previous: 'SystemInfosProvider.MediaPrevious',
  'Play / Pause': 'SystemInfosProvider.MediaPlayPause',
  Next: 'SystemInfosProvider.MediaNext',
};
function mediaButton(name, x, y, w, h, action) {
  return item('ButtonItem', name, x, y, w, h, {
    SimulatedKey: 0,
    SimulatedKeyV2: { Win: false, Ctrl: false, Alt: false, Shift: false },
    SimulateKey: false, TriggerAction: action, TriggerSimHubInputName: '',
    IsEnabled: true, PressedImage: 'None', Image: 'None', AutoSize: false,
    DisabledOpacity: 50, PressedOpacity: 60, BackgroundColor: '#00000000',
  });
}

function dial(name, x, y, diameter, radius, color, maximum, expression, options = {}) {
  return item('DialGaugeItem', name, x, y, diameter, diameter, {
    BackgroundColor: '#00000000', Minimum: 0, Maximum: maximum, Value: 0,
    StartAngle: 135, SweepAngle: 270,
    OuterRadius: radius, InnerRadius: 0, OuterStrokeThickness: 2, InnerStrokeThickness: 0,
    DialStrokeColor: colors.line, DialBackgroundColor: '#00000000', ShowDialGlassEffect: false,
    HorizontalAlignment: 1, VerticalAlignment: 1, ShowNeedle: true,
    NeedleImage: 'None', NeedleLength: radius * 0.75, NeedleOffset: 0, NeedleThickness: 4, CapRadius: 8,
    ShowRadialGauge: false, RadialGaugeStartOffset: 0,
    RadialGaugeRadius: radius * 0.96, RadialGaugeThickness: 4, RadialGaugeColor: color,
    RangeIndicatorRadius: radius * 0.98, RangeIndicatorThickness: 4,
    RangeOptimalStartValue: 0, RangeOptimalEndValue: maximum,
    BelowOptimalStyle: { ArcColor: '#00000000' }, OptimalStyle: { ArcColor: '#00000000' },
    AboveOptimalStyle: { ArcColor: colors.red, EnableMajorColor: true, MajorColor: colors.red },
    ScaleGlowRadius: 0, ScaleGlowColor: color, LabelCircleRotation: false, LabelAngleOffset: 0,
    ScaleLabelStyle: {
      LabelFont: 'Segoe UI', LabelFontSize: 20, LabelFontWeight: 'Normal', LabelFontStyle: 'Normal',
      LabelColor: color, LabelRadius: radius * 0.80, LabelSize: '70,30',
    },
    CustomScaleLabels: '', TicksPerLabel: 1, MajorTickRadius: radius * 0.94,
    MajorDivisionsCount: maximum / 8, MajorTickColor: color, MajorTickSize: '15,3',
    MinorTickColor: colors.muted, MinorTickRadius: radius * 0.94, MinorTickSize: '7,1',
    MinorDivisionsCount: 4,
    Bindings: { Value: binding(expression) }, ...options,
  });
}

function opponentStyle(color, radius, font = 13) {
  return { LabelFont: 'Segoe UI', LabelFontSize: font, LabelColor: colors.white,
    DotColor: color, DotRadius: radius, DotBorderThickness: 2, DotBordercolor: colors.bg };
}

function classNeighbour(name, x, y, w, position) {
  return item('BuiltIn.LeaderboardOpponentNameText', name, x, y, w, 42, {
    IsTextItem: true, Font: 'Segoe UI', FontSize: 27, FontWeight: 'Normal', FontStyle: 'Normal',
    Text: '--', TextColor: colors.white, BackgroundColor: '#00000000',
    HorizontalAlignment: 0, VerticalAlignment: 1,
    LeaderboardMode: 2, LeaderboardPosition: position, LeaderboardPositionRelativeToPlayer: true,
    LeaderboardPositionRelativeToPlayerOnTrack: false, PlayerStyleEnabled: false, NameStyle: 0,
    NoDataText: '-- / no class rival',
    OpponentStyle: { FontSize: 27, TextColor: colors.white, FontWeight: 'Normal', FontStyle: 'Normal' },
    Bindings: { Visible: binding('return classAvailable();') },
  });
}

function classGap(name, x, y, w, position) {
  const neighbour = classNeighbour(name, x, y, w, position);
  return {
    ...neighbour, $type: type('BuiltIn.LeaderboardOpponentGap'),
    GapMode: 2, Format: '0.000',
    TextBeforeValue: '', TextAfterValue: ' s', NoDataText: '--', EmptyValueText: '--',
    HorizontalAlignment: 2, TextColor: colors.amber,
    OpponentStyle: { ...neighbour.OpponentStyle, TextColor: colors.amber },
  };
}

export function createDashboard(width) {
  const height = 1080;
  const margin = 32, gap = 20, usable = width - margin * 2;
  const leftW = Math.round((usable - gap * 2) * 0.29);
  const centerW = usable - gap * 2 - leftW * 2;
  const leftX = margin, centerX = leftX + leftW + gap, rightX = centerX + centerW + gap;
  const top = 178, mainH = 654, bottom = 852, bottomH = 162;
  const identityW = Math.round(usable * 0.46), statusW = 280;
  const musicX = margin + identityW + gap, musicW = width - margin - statusW - gap - musicX;
  const items = [];
  items.push(rect('Top accent', margin, 28, 64, 4, colors.cyan));
  items.push(label('Brand', 'MangoDash', margin, 44, 330, 74, 48));
  items.push(label('Edition', '/ MULTISIM', margin + 330, 68, 112, 30, 16, colors.muted));
  items.push(label('Game name', 'ASSETTO CORSA', margin + 450, 42, identityW - 450, 38, 24, colors.white,
    'return gameName();'));
  items.push(label('Car and track', 'CAR / TRACK', margin + 450, 84, identityW - 450, 34, 18, colors.muted,
    `var s = live() ? text(data('CarModel')) + ' / ' + text(data('TrackName')) : 'SECOND MONITOR / NATIVE SIMHUB'; return s.length > ${Math.floor((identityW - 450) / 11)} ? s.slice(0, ${Math.floor((identityW - 450) / 11) - 3}) + '...' : s;`));
  const status = label('Status', 'LIVE TELEMETRY', width - margin - statusW, 52, statusW, 46, 21, colors.cyan, 'return status();', 2);
  status.Bindings.TextColor = binding('return statusColor();');
  items.push(status);
  items.push(rect('Header divider', margin, 140, usable, 1, colors.line));
  const settings = [];
  const settingW = usable / 5;
  [['BrakeBias', 'BRAKE BIAS'], ['ABSLevel', 'ABS'], ['TCLevel', 'TC'],
    ['TractionControlCut', 'TC2 / CUT'], ['EngineMap', 'ENGINE MAP']].forEach(([key, title], index) => {
    const x = margin + index * settingW;
    const titleW = key === 'BrakeBias' || key === 'EngineMap' ? 132 : 108;
    settings.push(label(`${key} setting label`, title, x + 12, 146, titleW, 26, 17, colors.muted));
    settings.push(label(`${key} setting`, '--', x + titleW + 28, 146, settingW - titleW - 40, 26, 19, colors.cyan,
      `return carSetting('${key}');`));
  });
  items.push(layer('Car settings', settings, 'return live();'));
  items.push(label('Footer', 'MangoDash / MULTISIM     |     LIVE VALUES ONLY - UNAVAILABLE DATA: --', margin, 1030, usable, 26, 16, colors.muted));

  const driving = [];
  panel(driving, 'Driving panel', centerX, top, centerW, bottom + bottomH - top);
  driving.push(rect('Driving accent', centerX, top, centerW, 3, colors.cyan));
  ['#FF529CCB', '#FF344C97', '#FFCC3544'].forEach((color, index) =>
    driving.push(rect(`M accent ${index}`, centerX + 24 + index * 18, top + 65, 14, 4, color)));
  driving.push(label('Drive mode', 'CIRCUIT / LIVE', centerX + 24, top + 24, (centerW - 48) / 2, 34, 20, colors.cyan,
    "return mode() === 'rally' ? 'STAGE / LIVE' : 'CIRCUIT / LIVE';"));
  const trackFlag = label('Track flag', 'FLAG / --', centerX + centerW / 2, top + 24,
    (centerW - 48) / 2, 34, 20, colors.muted, 'return trackFlagText();', 2);
  trackFlag.Bindings.TextColor = binding('return trackFlagColor();');
  trackFlag.Bindings.Visible = binding("return mode() === 'race';");
  driving.push(trackFlag);
  const diameter = Math.min(centerW * 0.57, 480), radius = diameter / 2 - 8;
  const cx = centerX + centerW * 0.60, cy = top + 280;
  const speedD = Math.min(centerW * 0.35, 320);
  const speedY = top + 440;
  const rimDistance = radius + speedD / 2 - 8 - 10;
  const speedX = cx - Math.sqrt(rimDistance * rimDistance - (speedY - cy) * (speedY - cy));
  driving.push(dial('Speed dial', speedX - speedD / 2, speedY - speedD / 2, speedD, speedD / 2 - 8, colors.white, 360,
    'return needleValue(speedValue(), speedMaximum());', {
      ScaleLabelStyle: { LabelFont: 'Segoe UI', LabelFontSize: 16, LabelColor: colors.white,
        LabelRadius: speedD * 0.35, LabelSize: '48,22' },
      Bindings: {
        Value: binding('return needleValue(speedValue(), speedMaximum());'),
        Maximum: binding('return speedMaximum();'),
        MajorDivisionsCount: binding('return speedStep();'),
        RangeOptimalEndValue: binding('return speedMaximum();'),
        ShowNeedle: binding('return speedValue() !== null;'),
      },
    }));
  driving.push(dial('RPM dial', cx - diameter / 2, cy - diameter / 2, diameter, radius, colors.white, 9,
    'return needleValue(number(data("Rpms")) === null ? null : number(data("Rpms")) / 1000, rpmScale());', {
      NeedleThickness: 5, ShowRadialGauge: true, DialBackgroundColor: colors.panel,
      Bindings: {
        Value: binding('return needleValue(number(data("Rpms")) === null ? null : number(data("Rpms")) / 1000, rpmScale());'),
        Maximum: binding('return rpmScale();'),
        MajorDivisionsCount: binding('return rpmScale() <= 4 ? 0.5 : 1;'),
        RangeOptimalEndValue: binding('return rpmMax() * 0.95 / 1000;'),
        ShowNeedle: binding('var v = number(data("Rpms")); return v !== null && v >= 0;'),
        DialStrokeColor: binding('return redlineAccentColor();'),
      },
    }));
  driving.push(label('Speed', '248', speedX - 70, speedY + 28, 140, 50, 36, colors.amber,
    'return metric(speedValue());', 1));
  driving.push(label('Speed unit', 'KM/H', speedX - 80, speedY + 80, 160, 26, 16, colors.muted,
    'return speedUnit();', 1));
  driving.push(label('RPM label', 'RPM x1000', cx - 100, cy - 95, 200, 26, 18, colors.cyan, undefined, 1));
  const limiter = label('Pit limiter', 'PIT LIMITER / --', cx - 100, cy - 38, 200, 24, 15, colors.muted,
    'return pitLimiterText();', 1);
  limiter.Bindings.TextColor = binding('return pitLimiterColor();');
  driving.push(limiter);
  driving.push(label('Gear label', 'GEAR', cx - 104, cy + 46, 70, 26, 16, colors.muted, undefined, 1));
  driving.push(label('Gear', '5', cx - 114, cy + 72, 90, 70, 52, colors.amber, 'return gear();', 1));
  driving.find(i => i.Name === 'Gear').Bindings.TextColor = binding('return gearHighlightColor();');
  const fuelD = 112, fuelX = cx + 58, fuelY = cy + 40;
  driving.push(dial('Fuel dial', fuelX - fuelD / 2, fuelY, fuelD, 51, colors.amber, 100,
    'return needleValue(fuelPercent(), 100);', {
      StartAngle: 180, SweepAngle: 180, NeedleLength: 30, CapRadius: 4, NeedleThickness: 3,
      MajorDivisionsCount: 50, MinorDivisionsCount: 4,
      ScaleLabelStyle: { LabelFont: 'Segoe UI', LabelFontSize: 12, LabelColor: colors.amber, LabelRadius: 36, LabelSize: '30,18' },
      Bindings: {
        Value: binding('return needleValue(fuelPercent(), 100);'),
        ShowNeedle: binding('return fuelPercent() !== null;'),
        MajorTickColor: binding('return fuelColor();'),
        DialStrokeColor: binding('return fuelColor();'),
      },
    }));
  driving.push(label('Fuel state', 'FUEL', fuelX - 74, fuelY + 70, 148, 22, 13, colors.amber,
    "return fuelPercent() === null ? 'FUEL UNAVAILABLE' : lowFuel() ? 'LOW FUEL' : 'FUEL / E - F';", 1));
  const fuelLabel = driving.find(i => i.Name === 'Fuel state');
  fuelLabel.Bindings.TextColor = binding('return fuelColor();');
  [['Oil', 'OilTemperature', 170], ['Coolant', 'WaterTemperature', 130]].forEach(([name, key, maximum], index) => {
    const x = centerX + 24 + index * 112, y = top + 94;
    driving.push(dial(`${name} temperature dial`, x, y, 100, 46, colors.white, maximum,
      `return needleValue(engineTemperature('${key}'), ${maximum});`, {
        MajorDivisionsCount: maximum / 2, MinorDivisionsCount: 2, NeedleThickness: 2,
        NeedleLength: 32, CapRadius: 4, MajorTickSize: '8,2', MinorTickSize: '4,1',
        ScaleLabelStyle: { LabelFont: 'Segoe UI', LabelFontSize: 10, LabelColor: colors.white,
          LabelRadius: 31, LabelSize: '28,14' },
        Bindings: {
          Value: binding(`return needleValue(engineTemperature('${key}'), ${maximum});`),
          ShowNeedle: binding(`return engineTemperature('${key}') !== null;`),
        },
      }));
    driving.push(label(`${name} temperature label`, name.toUpperCase(), x, y + 102, 100, 20, 13, colors.muted, undefined, 1));
    driving.push(label(`${name} temperature`, '--', x, y + 124, 100, 24, 16, colors.amber,
      `return metric(engineTemperature('${key}'), 0, ' C');`, 1));
  });
  driving.push(label('Battery voltage', '12V / --', centerX + 24, top + 252, 220, 24, 16, colors.amber,
    "return '12V / ' + metric(batteryReading('batteryVoltageProperty', false), 1, ' V');"));
  driving.push(label('Battery charge', 'SOC / --', centerX + 24, top + 280, 220, 24, 16, colors.amber,
    "return 'SOC / ' + metric(batteryReading('batteryChargePercentProperty', true), 1, '%');"));
  driving.push(label('RPM unavailable', 'RPM UNAVAILABLE', cx - 110, cy - 65, 220, 26, 16, colors.muted,
    'return number(data("Rpms")) === null || number(data("Rpms")) < 0 ? "RPM UNAVAILABLE" : "";', 1));
  driving.push(label('Cluster scale source', 'LIVE LIMIT', centerX + 24, top + 622, centerW - 48, 24, 14, colors.muted,
    "return 'RPM: ' + rpmSource() + ' ' + metric(rpmMax()) + ' / SPEED: FIXED PROFILE';", 1));
  const pedalX = centerX + centerW * 0.56, pedalW = centerW * 0.44 - 24;
  [['Throttle', colors.green], ['Brake', colors.red], ['Clutch', colors.cyan], ['Handbrake', colors.amber]].forEach(([key, color], index) => {
    const segment = pedalW / 4, w = Math.min(56, segment - 12), x = pedalX + index * segment + (segment - w) / 2;
    const y = top + 510, h = 84;
    bar(driving, `${key} bar`, x, y, w, h, `data('${key}')`, color);
    driving.push(label(key, '0%', x, y + 30, w, 24, 16, colors.white,
      `return metric(data('${key}'), 0, '%');`, 1));
    driving.push(label(`${key} label`, ['THR', 'BRK', 'CLT', 'HB'][index], x, y + h + 4, w, 20, 13, color, undefined, 1));
  });
  items.push(layer('Live driving', driving, 'return live();'));

  const race = [];
  panel(race, 'Timing panel', leftX, top, leftW, bottom + bottomH - top);
  race.push(label('Timing title', '01  /  SESSION TIMING', leftX + 24, top + 20, leftW - 48, 36, 21, colors.cyan));
  race.push(label('Position and lap', 'P 3 / LAP 12', leftX + 24, top + 66, leftW - 48, 40, 27, colors.white,
    "return 'P ' + positive(data('Position')) + ' / LAP ' + positive(data('CurrentLap'));"));
  value(race, 'Current lap time', 'CURRENT LAP', '1:42.368', leftX + 24, top + 124, leftW - 48,
    "return lapTime(data('CurrentLapTime'));", colors.white, 42);
  race.push(label('Last lap time', 'LAST / 1:43.106', leftX + 24, top + 240, leftW - 48, 36, 24, colors.muted,
    "return 'LAST / ' + lapTime(data('LastLapTime'));"));
  race.push(label('Best lap time', 'BEST / 1:42.012', leftX + 24, top + 282, leftW - 48, 36, 24, colors.green,
    "return 'BEST / ' + lapTime(data('BestLapTime'));"));
  race.push(label('Delta', '-0.356', leftX + 24, top + 330, leftW - 48, 66, 46, colors.green, 'return delta();'));
  race.find(i => i.Name === 'Delta').Bindings.TextColor = binding('return deltaColor();');
  race.push(label('Delta explanation', 'DELTA TO BEST / GREEN = FASTER', leftX + 24, top + 398, leftW - 48, 26, 16, colors.muted));
  race.push(rect('Class divider', leftX + 24, top + 440, leftW - 48, 1, colors.line));
  race.push(label('Class heading', 'CLASS STANDINGS', leftX + 24, top + 452, leftW - 48, 28, 18, colors.cyan,
    "return classAvailable() ? 'CLASS / ' + text(data('CarClass')).slice(0, 28) : 'CLASS DATA UNAVAILABLE';"));
  const classGapW = 156;
  race.push(label('Ahead caption', 'AHEAD / IN CLASS', leftX + 24, top + 490, leftW - 48 - classGapW, 24, 16, colors.muted));
  race.push(label('Ahead gap caption', 'GAP', leftX + leftW - 24 - classGapW, top + 490, classGapW, 24, 16, colors.muted, undefined, 2));
  race.push(classNeighbour('Class ahead', leftX + 24, top + 516, leftW - 60 - classGapW, 0));
  race.push(classGap('Class ahead gap', leftX + leftW - 24 - classGapW, top + 516, classGapW, 0));
  race.push(label('Behind caption', 'BEHIND / IN CLASS', leftX + 24, top + 572, leftW - 48 - classGapW, 24, 16, colors.muted));
  race.push(label('Behind gap caption', 'GAP', leftX + leftW - 24 - classGapW, top + 572, classGapW, 24, 16, colors.muted, undefined, 2));
  race.push(classNeighbour('Class behind', leftX + 24, top + 600, leftW - 60 - classGapW, 2));
  race.push(classGap('Class behind gap', leftX + leftW - 24 - classGapW, top + 600, classGapW, 2));
  const compactTiming = {
    'Timing title': [12, 28, 20], 'Position and lap': [44, 30, 22],
    'Current lap time label': [80, 24, 16], 'Current lap time': [105, 48, 34],
    'Last lap time': [158, 28, 19], 'Best lap time': [190, 28, 19],
    Delta: [222, 48, 34], 'Delta explanation': [270, 22, 13],
    'Class divider': [300, 1], 'Class heading': [308, 24, 16],
    'Ahead caption': [338, 22, 14], 'Ahead gap caption': [338, 22, 14],
    'Class ahead': [362, 30, 20], 'Class ahead gap': [362, 30, 20],
    'Behind caption': [396, 22, 14], 'Behind gap caption': [396, 22, 14],
    'Class behind': [420, 30, 20], 'Class behind gap': [420, 30, 20],
  };
  for (const entry of race) {
    const layout = compactTiming[entry.Name];
    if (!layout) continue;
    [entry.Top, entry.Height] = [top + layout[0], layout[1]];
    if (layout[2]) {
      entry.FontSize = layout[2];
      if (entry.OpponentStyle) entry.OpponentStyle.FontSize = layout[2];
    }
  }
  race.push(label('Leaderboard heading', 'OVERALL', leftX + 24, top + 456, leftW - 48, 24, 15, colors.cyan,
    'return gridHeading();'));
  const columnW = (leftW - 48) / 2;
  for (let slot = 0; slot < 20; slot++) {
    const x = leftX + 24 + Math.floor(slot / 10) * columnW;
    const y = top + 494 + slot % 10 * 30;
    race.push(label(`Grid rank ${slot}`, '--', x, y, 32, 26, 18, colors.muted,
      `return gridPosition(${slot}) <= gridCount() ? String(gridPosition(${slot})) : '';`));
    const name = classNeighbour(`Grid driver ${slot}`, x + 34, y, columnW - 42, slot + 1);
    Object.assign(name, { Height: 26, FontSize: 18, LeaderboardMode: 1,
      LeaderboardPositionRelativeToPlayer: false, PlayerStyleEnabled: true,
      PlayerStyle: { FontSize: 18, TextColor: colors.cyan, FontWeight: 'Bold', FontStyle: 'Normal' },
      OpponentStyle: { FontSize: 18, TextColor: colors.white, FontWeight: 'Normal', FontStyle: 'Normal' },
      NoDataText: '', Bindings: {
        Visible: binding(`return gridPosition(${slot}) <= gridCount();`),
        LeaderboardPosition: binding(`return gridPosition(${slot});`),
      } });
    race.push(name);
  }

  panel(race, 'Map panel', rightX, top, leftW, 654);
  race.push(label('Map title', '02 / TRACK MAP + RADAR', rightX + 24, top + 12, leftW - 48, 32, 20, colors.cyan));
  const radarSize = 104, radarX = rightX + 24, radarY = top + 494;
  race.push(label('Radar title', 'RADAR', radarX, top + 466, radarSize, 22, 14, colors.cyan));
  race.push(rect('Radar cross vertical', radarX + radarSize / 2, radarY, 1, radarSize, colors.line));
  race.push(rect('Radar cross horizontal', radarX, radarY + radarSize / 2, radarSize, 1, colors.line));
  race.push(item('RadarItem', 'Nearby radar', radarX, radarY, radarSize, radarSize, {
    BackgroundColor: '#00000000', Scale: 0.3, UseSmoothedPlayerAngle: false,
    PlayerStyle: opponentStyle(colors.cyan, 10), OpponentStyle: opponentStyle(colors.amber, 8),
    Bindings: { Visible: binding('return coordinatesAvailable();') },
  }));
  race.push(label('Radar status', 'POSITION DATA UNAVAILABLE', rightX + 144, top + 510, leftW - 168, 24, 14, colors.muted,
    "return coordinatesAvailable() ? 'RADAR / ALL CLASSES' : 'POSITION DATA UNAVAILABLE';"));
  const weatherW = (leftW - 48) / 3;
  [['Air', 'AIR', "weatherTemperature('AirTemperature')"],
    ['Track', 'TRACK', "weatherTemperature('TrackTemperature')"],
    ['Wind', 'WIND', 'windSpeed()']].forEach(([name, title, expression], index) => {
    const x = rightX + 24 + index * weatherW;
    race.push(label(`Map ${name} label`, title, x, top + 52, weatherW - 8, 22, 14, colors.muted));
    race.push(label(`Map ${name}`, '--', x, top + 74, weatherW - 8, 26, 18, colors.white,
      `return ${expression};`));
  });
  race.push(label('Map Wind compass', 'FROM --', rightX + 24, top + 104, (leftW - 48) / 2, 22, 14, colors.muted,
    'return windCompass();'));
  race.push(label('Map Wind relative', 'CAR --', rightX + leftW / 2, top + 104, (leftW - 48) / 2, 22, 14, colors.cyan,
    'return windRelative();'));
  race.push(item('GeneratedStaticMapItem', 'Track minimap', rightX + 24, top + 134, leftW - 48, 320, {
    BackgroundColor: '#00000000', MapShadow: false, TrackColor: colors.muted, TrackWidth: 6,
    TrackBorderColor: colors.inset, TrackBorderWidth: 2, MinimumTrackWidth: 2, MinimumTrackBorderWidth: 1,
    DisplayPerClassPosition: true, OverrideColorsWithCarClassColors: true,
    KeepMapDefinedClassColorsInSingleClass: true, ForcePlayerDotBorderContrastWhenUsingCarClassColors: true,
    PlayerStyle: opponentStyle(colors.cyan, 9), OpponentStyle: opponentStyle(colors.amber, 7),
    Bindings: { Visible: binding('return coordinatesAvailable();') },
  }));
  race.push(label('Map status', 'POSITION DATA UNAVAILABLE', rightX + 144, top + 550, leftW - 168, 22, 11, colors.muted,
    "return coordinatesAvailable() ? 'NO MAP? DRIVE A CLEAN LAP TO RECORD IT' : 'POSITION DATA UNAVAILABLE';", 1));
  race.push(label('Map caution', 'NO DOTS IS NOT ALL-CLEAR', rightX + 144, top + 578, leftW - 168, 22, 11, colors.amber, undefined, 1));
  items.push(layer('Circuit layout', race, "return live() && mode() === 'race';"));

  const tyres = [];
  panel(tyres, 'Tyre summary panel', leftX, bottom, leftW, bottomH);
  tyres.push(label('Tyre summary heading', 'TYRES / TEMP + LIFE LEFT', leftX + 20, bottom + 8, leftW - 40, 28, 18, colors.cyan));
  [['FL', 'FrontLeft'], ['FR', 'FrontRight'], ['RL', 'RearLeft'], ['RR', 'RearRight']].forEach(([short, key], index) => {
    const x = leftX + 20 + (index % 2) * ((leftW - 40) / 2);
    const y = bottom + 42 + Math.floor(index / 2) * 54;
    tyres.push(label(`Tyre ${short}`, 'FL / 84 C', x, y, (leftW - 48) / 2, 28, 20, colors.white,
      `return '${short} / ' + positive(data('TyreTemperature${key}'), 0, ' C');`));
    tyres.push(label(`Tyre ${short} life`, 'LIFE LEFT / 92.0%', x, y + 28, (leftW - 48) / 2, 22, 15, colors.muted,
      `return 'LIFE LEFT / ' + tyreLife('${key}');`));
  });
  for (const entry of tyres) entry.Left += rightX - leftX;
  items.push(layer('Tyre summary', tyres, 'return live();'));

  const rally = [];
  panel(rally, 'Rally timing panel', leftX, top, leftW, bottom + bottomH - top);
  rally.push(label('Rally title', '01  /  STAGE MONITOR', leftX + 24, top + 20, leftW - 48, 36, 21, colors.amber));
  value(rally, 'Rally elapsed', 'STAGE ELAPSED', '--', leftX + 24, top + 104, leftW - 48,
    "return detailReading('stageSeconds', 'seconds');", colors.white, 56);
  value(rally, 'Rally last', 'STAGE RESULT', '--', leftX + 24, top + 278, leftW - 48,
    "var s = detailReading('stageResult', 'text'); return s.length > 18 ? s.slice(0, 15) + '...' : s;", colors.muted, 30);
  rally.push(label('Rally info one', 'FOCUS FORWARD.', leftX + 24, top + 480, leftW - 48, 46, 30, colors.amber));
  rally.push(label('Rally info two', 'NO GENERATED PACENOTES', leftX + 24, top + 534, leftW - 48, 32, 18, colors.muted));
  rally.push(label('Rally info three', 'TIMING DEPENDS ON GAME TELEMETRY', leftX + 24, top + 578, leftW - 48, 30, 16, colors.muted));
  panel(rally, 'Rally vehicle panel', rightX, top, leftW, mainH);
  rally.push(label('Rally vehicle title', '02  /  VEHICLE STATUS', rightX + 24, top + 20, leftW - 48, 36, 21, colors.amber));
  value(rally, 'Rally water', 'COOLANT TEMPERATURE', '88 C', rightX + 24, top + 104, leftW - 48,
    "return positive(data('WaterTemperature'), 0, ' C');");
  value(rally, 'Rally oil', 'OIL TEMPERATURE', '104 C', rightX + 24, top + 278, leftW - 48,
    "return positive(data('OilTemperature'), 0, ' C');");
  value(rally, 'Rally fuel', 'FUEL REMAINING', '34.6 L', rightX + 24, top + 452, leftW - 48,
    "var f = number(data('Fuel')); return f === null || f < 0 ? '--' : metric(f, 1, ' L');", colors.amber);
  items.push(layer('Rally layout', rally, "return live() && mode() === 'rally';"));

  const lower = [];
  const boost = [];
  boostChannels.forEach(([key, title, kind], index) => {
    const columnW = (centerW - 48) / 4;
    const x = centerX + 24 + (index % 4) * columnW, y = bottom - 6 + Math.floor(index / 4) * 44;
    boost.push(label(`Boost ${key} label`, title, x, y, columnW - 8, 18, 12, colors.muted));
    boost.push(label(`Boost ${key}`, '--', x, y + 18, columnW - 8, 24, 16, colors.amber,
      `var s = boostReading('${key}', '${kind}'); return s.length > ${Math.floor((columnW - 8) / 10)} ? s.slice(0, ${Math.floor((columnW - 8) / 10) - 3}) + '...' : s;`));
  });
  driving.push(layer('Circuit boost', boost, "return live() && mode() === 'race';"));
  const summary = [];
  summary.push(label('Strategy summary', '--', centerX + 24, 946, centerW - 48, 24, 15, colors.amber,
    `var s = mode() === 'rally' ? 'STAGE ' + detailReading('stageProgressPercent', 'percent') + ' / LEFT ' + detailReading('stageDistanceKm', 'distance') + ' / SPLIT ' + detailReading('stageSplitSeconds', 'delta') : 'FUEL ' + detailReading('fuelLaps', 'laps') + ' / SESSION ' + detailReading('sessionSeconds', 'seconds') + ' / LAPS ' + detailReading('sessionLaps', 'count'); return s.length > ${Math.floor((centerW - 48) / 10)} ? s.slice(0, ${Math.floor((centerW - 48) / 10) - 3}) + '...' : s;`));
  summary.push(label('Warning summary', '--', centerX + 24, 978, centerW - 48, 24, 14, colors.red,
    `var s = raceWarnings(); return s.length > ${Math.floor((centerW - 48) / 9)} ? s.slice(0, ${Math.floor((centerW - 48) / 9) - 3}) + '...' : s;`));
  summary[1].Bindings.TextColor = binding("return raceWarnings() === 'WARNINGS / CHECK GAME' || !live() ? '#FFA18D73' : '#FFFF3B24';");
  driving.push(...summary);
  const music = [];
  panel(music, 'Music panel', musicX, 36, musicW, 88);
  const controlsW = 260;
  const trackW = musicW - controlsW - 48;
  music.push(label('Music title', 'NIGHT DRIVE / DEMO TRACK', musicX + 16, 48, trackW, 26, 18, colors.cyan,
    `var s = mediaTitle(); return s.length > ${Math.floor(trackW / 18)} ? s.slice(0, ${Math.floor(trackW / 18) - 3}) + '...' : s;`));
  music.push(label('Music artist', 'MangoDash Radio / Demo artist', musicX + 16, 84, trackW, 22, 14, colors.muted,
    `var s = mediaArtist(); return s.length > ${Math.floor(trackW / 14)} ? s.slice(0, ${Math.floor(trackW / 14) - 3}) + '...' : s;`));
  Object.entries(mediaActions).forEach(([title, action], index) => {
    const x = musicX + musicW - controlsW - 12 + index * 88;
    music.push(rect(`Music ${title} background`, x, 61, 84, 38, colors.line));
    music.push(label(`Music ${title} text`, title.toUpperCase(), x + 2, 61, 80, 38, 12, colors.white, undefined, 1));
    music.push(mediaButton(`Music ${title} button`, x, 61, 84, 38, action));
  });
  lower.push(layer('Music controls', music, 'return musicPage();'));
  items.push(layer('Live lower strip', lower, 'return live();'));

  const idle = [];
  panel(idle, 'Standby panel', 0, 0, width, height);
  standbyImages.forEach((image, index) => {
    idle.push(item('ImageItem', `Standby ribbon ${index + 1}`, margin, 490 + index * 48, usable, 360, {
      Image: image.name, AutoSize: false, AutoSizeScale: 1, BackgroundColor: '#00000000',
      Bindings: {
        Top: binding(`if (!live()) root.ribbonOffset = 24 * Math.sin(new Date().getTime() / ${6500 + index * 1800} + ${index * 2}); return ${490 + index * 48} + (root.ribbonOffset || 0);`),
      },
    }));
  });
  idle.push(label('Standby brand', 'MangoDash', margin + 64, 250, usable - 128, 110, 80, colors.white, undefined, 1));
  idle.push(label('Standby eyebrow', 'ONE DASH. FOUR SIMULATORS.', margin + 64, 370, usable - 128, 36, 22, colors.cyan, undefined, 1));
  idle.push(label('Standby heading', 'WAITING FOR GAME...', margin + 64, 430, usable - 128, 50, 30, colors.white,
    "return live() ? 'WELCOME / ' + gameName() : running() ? 'GAME NOT RECOGNIZED.' : 'WAITING FOR GAME...';", 1));
  idle.push(label('Standby hint', '', margin + 64, 860, usable - 128, 40, 22, colors.muted,
    "return live() ? 'YOUR DASH IS READY.' : running() ? 'Current game ID: ' + text(read('DataCorePlugin.CurrentGame')) : 'Launch your game and let SimHub connect.';", 1));
  idle.push(label('Standby games', 'ASSETTO CORSA / AC RALLY / AUTOMOBILISTA 2 / LE MANS ULTIMATE',
    margin + 64, 930, usable - 128, 32, 19, colors.muted, undefined, 1));
  for (const entry of idle) {
    entry.Opacity = 100;
    entry.Bindings = { ...entry.Bindings, Opacity: binding('return welcomeOpacity();') };
  }
  // Keep the transition clock evaluated while transparent; hide individual artwork after the fade.
  items.push(layer('Standby layout', idle, 'return welcomeOpacity() > 0;'));

  // Background clocks stay outside conditional layers so they observe game exits and rearm.
  const panelModes = {
    'Driving panel': 'live()', 'Timing panel': "live() && mode() === 'race'",
    'Map panel': "live() && mode() === 'race'", 'Tyre summary panel': 'live()',
    'Rally timing panel': "live() && mode() === 'rally'",
    'Rally vehicle panel': "live() && mode() === 'rally'", 'Music panel': 'musicPage()',
  };
  const backgrounds = [];
  function extractBackgrounds(entries) {
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index], enabled = panelModes[entry.Name];
      if (enabled) {
        entry.Opacity = 100;
        entry.Bindings = { Opacity: binding(`var opacity = drivingPanelOpacity(); return ${enabled} ? opacity : 0;`) };
        backgrounds.push(entry);
        entries.splice(index--, 1);
      } else if (entry.Childrens) extractBackgrounds(entry.Childrens);
    }
  }
  extractBackgrounds(items);
  items.unshift(...backgrounds);

  const id = width === 2560 ? 'd4102560-1080-4000-8000-000000000001' : 'd4101920-1080-4000-8000-000000000001';
  function setRefreshRates(entries) {
    for (const entry of entries) {
      if (entry.Childrens) {
        setRefreshRates(entry.Childrens);
        continue;
      }
      entry.MinimumRefreshIntervalMS =
        /^Standby /.test(entry.Name) || panelModes[entry.Name] ? 50 :
        entry.$type.includes('.DialGaugeItem,') || /^(Throttle|Brake|Clutch|Handbrake)( |$)|^(Speed|Gear)$|^Nearby radar$/.test(entry.Name) ? 50 :
        ['Fuel state', 'Status', 'Track flag', 'Pit limiter'].includes(entry.Name) ? 100 :
        /^Grid |^Leaderboard heading$|^Tyre |^Map (Air|Track|Wind)|^Music (title|artist)$/.test(entry.Name) ? 500 :
        entry.Bindings && Object.keys(entry.Bindings).length ? 250 : 1000;
    }
  }
  setRefreshRates(items);
  const screen = {
    RenderingSkip: 0, Name: 'MangoDash / Overview', InGameScreen: true, IdleScreen: true, PitScreen: true,
    ScreenId: id.replace(/1$/, '2'), BackgroundLayerScreenId: '00000000-0000-0000-0000-000000000000',
    AllowOverlays: false, IsForegroundLayer: false, IsOverlayLayer: false,
    OverlayTriggerExpression: { Expression: '' }, ScreenEnabledExpression: { Expression: '' },
    OverlayMaxDuration: 0, OverlayMinDuration: 0, IsBackgroundLayer: false,
    BackgroundColor: colors.bg, Items: items, MinimumRefreshIntervalMS: 50,
  };
  const screens = [screen];
  for (const [index, page] of detailPages.entries()) {
    const copy = structuredClone(screen);
    copy.Name = `MangoDash / ${page.name}`;
    copy.ScreenId = id.replace(/1$/, String(index + 3));
    const circuit = copy.Items.find(i => i.Name === 'Circuit layout');
    circuit.Childrens = circuit.Childrens.filter(i => !/^(Map |Radar |Radar cross|Nearby radar$|Track minimap$)/.test(i.Name));
    const rallyLayout = copy.Items.find(i => i.Name === 'Rally layout');
    rallyLayout.Childrens = rallyLayout.Childrens.filter(i => !/^Rally (vehicle|water|oil|fuel)/.test(i.Name));
    const details = [];
    details.push(label('Detail heading', `${page.name.toUpperCase()} / ${index + 2} OF 4`, rightX + 24, top + 14, leftW - 48, 30, 20, colors.cyan));
    details.push(label('Detail availability', '--', rightX + 24, top + 42, leftW - 48, 16, 11, colors.muted,
      `var values = [${page.fields.map(([key, , kind, normalized]) =>
        `detailReading('${key}', '${kind}', ${normalized ? `'${normalized}'` : 'null'})`).join(',')}]; var count = 0; for (var i = 0; i < values.length; i++) if (values[i] !== '--') count++; return 'REPORTED ' + count + ' / ' + values.length + ' / MISSING: CHECK MAPPINGS';`));
    page.fields.forEach(([key, title, kind, normalized], slot) => {
      const w = (leftW - 48) / 2, x = rightX + 24 + (slot % 2) * w, y = top + 60 + Math.floor(slot / 2) * 60;
      details.push(label(`Detail ${key} label`, title, x, y, w - 10, 20, 12, colors.muted));
      details.push(label(`Detail ${key}`, '--', x, y + 24, w - 10, 30, 19, colors.amber,
        `var s = detailReading('${key}', '${kind}', ${normalized ? `'${normalized}'` : 'null'}); return s.length > ${Math.floor((w - 10) / 12)} ? s.slice(0, ${Math.floor((w - 10) / 12) - 3}) + '...' : s;`));
    });
    // Insert before standby so its welcome still covers the detail panel.
    copy.Items.splice(copy.Items.length - 1, 0, layer('Selected details', details, 'return live();'));
    setRefreshRates(copy.Items);
    screens.push(copy);
  }
  for (const [index, entry] of screens.entries()) {
    const navigation = [];
    navigation.push(rect('Detail navigation background', rightX + 24, top + 606, leftW - 48, 34, colors.inset));
    navigation.push(label('Detail navigation text', `${['OVERVIEW', ...detailPages.map(p => p.name.toUpperCase())][index]} / NEXT PAGE >`,
      rightX + 28, top + 606, leftW - 56, 34, 15, colors.amber, undefined, 1));
    navigation.push(mediaButton('Detail next page', rightX + 24, top + 606, leftW - 48, 34, 'GraphicalDashPlugin.NextScreen'));
    entry.Items.splice(entry.Items.length - 1, 0, layer('Detail navigation', navigation, 'return live();'));
  }
  return {
    Variables: { DashboardVariables: [] }, DashboardDebugManager: {},
    Version: 2, Id: id, BaseHeight: height, BaseWidth: width, BackgroundColor: colors.bg,
    Screens: screens,
    SnapToGrid: false, HideLabels: false, ShowForeground: true, ForegroundOpacity: 100,
    ShowBackground: true, BackgroundOpacity: 100, ShowBoundingRectangles: false, GridSize: 10,
    Images: standbyImages.map(image => image.metadata),
    Metadata: {
      ScreenCount: 4, InGameScreensIndexs: [0, 1, 2, 3], IdleScreensIndexs: [0, 1, 2, 3], PitScreensIndexs: [0, 1, 2, 3],
      MainPreviewIndex: 0, IsOverlay: false, OverlaySizeWarning: true, MetadataVersion: 2,
      EnableOnDashboardMessaging: false, Width: width, Height: height, DashboardVersion: '4.0.0',
    },
    ShowOnScreenControls: false, IsOverlay: false, EnableClickThroughOverlay: false,
    EnableOnDashboardMessaging: false, UseStrictJSIsolation: true, UseStrictJSIsolationWarning: false,
  };
}

export async function generate() {
  const css = await readFile(path.join(root, 'tools', 'preview.css'), 'utf8');
  const js = await readFile(path.join(root, 'tools', 'preview.js'), 'utf8');
  for (const width of [2560, 1920]) {
    const folder = path.join(root, `${width}x1080`);
    const name = `MangoDash MultiSim ${width}x1080.djson`;
    const dashboard = createDashboard(width);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, name), JSON.stringify(dashboard, null, 2) + '\n');
    await writeFile(path.join(folder, name + '.metadata'), JSON.stringify(dashboard.Metadata, null, 2) + '\n');
    await writeFile(path.join(folder, name + '.ressources'), standbyResources());
    const previewModel = structuredClone(dashboard);
    const previewProfiles = structuredClone(profiles);
    for (const game of ['AssettoCorsa', 'Automobilista2', 'LeMansUltimate', 'AssettoCorsaRally']) {
      previewProfiles.cars.push({ game, carId: 'preview-car',
        detailProperties: Object.fromEntries(detailFields.map(([key]) => [key, 'Demo.' + key])) });
    }
    function demoBindings(entries) {
      for (const entry of entries) {
        for (const bound of Object.values(entry.Bindings || {})) {
          bound.Formula.Expression = bound.Formula.Expression.replace(
            'var gaugeProfiles = ' + JSON.stringify(profiles) + ';',
            'var gaugeProfiles = ' + JSON.stringify(previewProfiles) + ';');
        }
        if (entry.Childrens) demoBindings(entry.Childrens);
      }
    }
    for (const screen of previewModel.Screens) demoBindings(screen.Items);
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MangoDash MultiSim / ${width} x 1080 preview</title><style>${css}</style></head>
<body><nav aria-label="Preview controls"><strong>MangoDash <span>/ DESIGN PREVIEW</span></strong>
<label>Simulator <select id="game">
<option value="AssettoCorsa">Assetto Corsa / Content Manager</option>
<option value="AssettoCorsaRally">Assetto Corsa Rally</option>
<option value="Automobilista2">Automobilista 2</option>
<option value="LeMansUltimate">Le Mans Ultimate</option>
<option value="idle">Standby</option></select></label>
<label>State <select id="state"><option value="normal">Driving</option><option value="shift">Shift / overspeed</option>
<option value="pit">Pit limiter</option><option value="low">Low fuel</option><option value="missing">Missing telemetry</option>
<option value="flagYellow">Yellow flag</option><option value="flagBlue">Blue flag</option>
<option value="flagRed">Red flag</option><option value="flagCheckered">Checkered flag</option>
<option value="paused">Paused</option><option value="noPosition">No position data</option>
<option value="noClass">No class data</option><option value="noMap">No recorded map</option>
<option value="noOpponents">No opponent coordinates</option><option value="leader">Class leader</option>
<option value="last">Class last</option><option value="solo">Solo class</option>
<option value="noGap">Missing standings gaps</option><option value="zeroGap">Zero standings gaps</option>
<option value="fullGrid">Full grid / leaderboard paging</option>
<option value="lapped">Lap-separated rivals</option></select></label>
<label>Tyres <select id="tyres"><option value="normal">Normal</option>
<option value="worn">Worn</option><option value="fresh">Fresh</option>
<option value="missingWear">No wear data</option><option value="missing">No tyre data</option></select></label>
<label>Vehicle <select id="vehicle"><option value="default">GT / 8,000 RPM</option>
<option value="highrev">High-rev / 16,000 RPM</option><option value="fallback">Missing RPM limit</option></select></label>
<label class="animate"><input type="checkbox" id="animate">Animate demo</label>
<button id="fullscreen" type="button">Fullscreen</button></nav>
<main id="viewport"><div id="dash" role="img" aria-label="Simulated dashboard telemetry"></div></main>
<p id="notice">OFFLINE DESIGN PREVIEW / SAMPLE DATA ONLY / FICTIONAL TRACK + DRIVERS / ${width} x 1080 / Native rendering must be checked in SimHub.</p>
<script id="dashboard-model" type="application/json">${JSON.stringify(previewModel).replace(/</g, '\\u003c')}</script>
<script id="dashboard-images" type="application/json">${JSON.stringify(Object.fromEntries(standbyImages.map(image =>
  [image.name, 'data:image/png;base64,' + image.bytes.toString('base64')])) )}</script>
<script>${js}</script></body></html>`;
    await writeFile(path.join(folder, 'preview.html'), html);
    console.log(`Generated ${width}x1080: native dashboard, metadata, offline preview`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generate();
}
