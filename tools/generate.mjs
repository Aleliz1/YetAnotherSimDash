import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { binding } from './telemetry.mjs';
import { dashboardImages, gaugeHubImage, standbyImages, standbyResources } from './standby.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const colors = {
  bg: '#FF050505', panel: '#FF101010', inset: '#FF080808',
  gaugeFace: '#FF30383A', gaugeInk: '#FFEBCBB4', needle: '#FFFF7748',
  line: '#FF303030', sectionDivider: '#FF68523A', white: '#FFE2DFD5', muted: '#FFC5B39A',
  gaugeMinor: '#FFD3B69F',
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
  const fontSize = size <= 12 && h >= Math.ceil((size + 1) * 1.25) ? size + 1 : size;
  return item('TextItem', name, x, y, w, h, {
    IsTextItem: true, Font: 'Bahnschrift', FontSize: fontSize, Text: value,
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
    OuterRadius: radius, InnerRadius: 0, OuterStrokeThickness: 3, InnerStrokeThickness: 0,
    DialStrokeColor: colors.gaugeInk, DialBackgroundColor: colors.gaugeFace, ShowDialGlassEffect: true,
    HorizontalAlignment: 1, VerticalAlignment: 1, ShowNeedle: true,
    NeedleImage: 'None', NeedleLength: radius * 0.78, NeedleOffset: 0, NeedleThickness: 3, NeedleColor: colors.needle, CapRadius: 10,
    ShowRadialGauge: false, RadialGaugeStartOffset: 0,
    RadialGaugeRadius: radius * 0.96, RadialGaugeThickness: 4, RadialGaugeColor: color,
    RangeIndicatorRadius: radius * 0.98, RangeIndicatorThickness: 4,
    RangeOptimalStartValue: 0, RangeOptimalEndValue: maximum,
    BelowOptimalStyle: { ArcColor: '#00000000' }, OptimalStyle: { ArcColor: '#00000000' },
    AboveOptimalStyle: { ArcColor: colors.red, EnableMajorColor: true, MajorColor: colors.red },
    ScaleGlowRadius: 3, ScaleGlowColor: color, LabelCircleRotation: false, LabelAngleOffset: 0,
    ScaleLabelStyle: {
      LabelFont: 'Bahnschrift', LabelFontSize: 20, LabelFontWeight: 'Normal', LabelFontStyle: 'Normal',
      LabelColor: color, LabelRadius: radius * 0.80, LabelSize: '70,30',
    },
    CustomScaleLabels: '', TicksPerLabel: 1, MajorTickRadius: radius * 0.94,
    MajorDivisionsCount: maximum / 8, MajorTickColor: color, MajorTickSize: '12,3',
    MinorTickColor: colors.gaugeMinor, MinorTickRadius: radius * 0.94, MinorTickSize: '6,2',
    MinorDivisionsCount: 4,
    Bindings: { Value: binding(expression) }, ...options,
  });
}

function opponentStyle(color, radius, font = 13) {
  return { LabelFont: 'Bahnschrift', LabelFontSize: font, LabelColor: colors.white,
    DotColor: color, DotRadius: radius, DotBorderThickness: 2, DotBordercolor: colors.bg };
}

function classNeighbour(name, x, y, w, position) {
  return item('BuiltIn.LeaderboardOpponentNameText', name, x, y, w, 42, {
    IsTextItem: true, Font: 'Bahnschrift', FontSize: 27, FontWeight: 'Normal', FontStyle: 'Normal',
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

function generatedMap(name, x, y, width, height) {
  return item('GeneratedStaticMapItem', name, x, y, width, height, {
    BackgroundColor: '#00000000', MapShadow: false, TrackColor: colors.muted, TrackWidth: 8,
    TrackBorderColor: colors.inset, TrackBorderWidth: 3, MinimumTrackWidth: 3, MinimumTrackBorderWidth: 2,
    DisplayPerClassPosition: true, OverrideColorsWithCarClassColors: true,
    KeepMapDefinedClassColorsInSingleClass: true, ForcePlayerDotBorderContrastWhenUsingCarClassColors: true,
    PlayerStyle: opponentStyle(colors.cyan, 9), OpponentStyle: opponentStyle(colors.amber, 7),
    Bindings: { Visible: binding('return coordinatesAvailable();') },
  });
}

export function createDashboard(width) {
  const height = 1080;
  const margin = 32, gap = 20, usable = width - margin * 2;
  const leftW = Math.round((usable - gap * 2) * 0.29);
  const centerW = usable - gap * 2 - leftW * 2;
  const leftX = margin, centerX = leftX + leftW + gap, rightX = centerX + centerW + gap;
  const top = 104, bottom = 840, bottomH = 174;
  const mainH = bottom - top, fullPanelH = bottom + bottomH - top;
  const identityW = Math.round(usable * 0.46), statusW = 280;
  const musicX = margin + identityW + gap, musicW = width - margin - statusW - gap - musicX;
  const items = [];
  items.push(rect('Top accent', margin, 11, 64, 4, colors.cyan));
  items.push(label('Game name', 'ASSETTO CORSA', margin, 24, 280, 28, 21, colors.white,
    'return gameName();'));
  const carTrackX = margin + 300, carTrackW = identityW - 300;
  items.push(label('Car and track', 'CAR / TRACK', carTrackX, 27, carTrackW, 22, 14, colors.muted,
    `var s = live() ? text(data('CarModel')) + ' / ' + text(data('TrackName')) : 'SECOND MONITOR / NATIVE SIMHUB'; return s.length > ${Math.floor(carTrackW / 9)} ? s.slice(0, ${Math.floor(carTrackW / 9) - 3}) + '...' : s;`));
  const status = label('Status', 'LIVE TELEMETRY', width - margin - statusW, 23, statusW, 34, 18, colors.cyan, 'return status();', 2);
  status.Bindings.TextColor = binding('return statusColor();');
  items.push(status);
  items.push(rect('Header divider', margin, 84, usable, 1, colors.line));
  const driving = [];
  panel(driving, 'Driving panel', centerX, top, centerW, bottom + bottomH - top);
  driving.push(rect('Driving accent', centerX, top, centerW, 3, colors.cyan));
  driving.push(label('Drive mode', 'CIRCUIT / LIVE', centerX + 24, top + 24, (centerW - 48) / 2, 34, 20, colors.cyan,
    "return mode() === 'rally' ? 'STAGE / LIVE' : 'CIRCUIT / LIVE';"));
  const trackFlagOptions = [
    ['Black', 'BLACK', '#FF171717'], ['Orange', 'ORANGE', colors.cyan],
    ['Checkered', 'CHECKERED', '#FFF2F0E8'], ['Yellow', 'YELLOW', '#FFFFCC32'],
    ['Blue', 'BLUE', '#FF639BDD'], ['White', 'WHITE', '#FFF2F0E8'],
    ['Green', 'GREEN', '#FF78A34D'], ['Red', 'RED', '#FFFF3B24'],
  ];
  const flagWidth = 40, flagHeight = 34, flagGap = 4;
  const flagRowWidth = trackFlagOptions.length * flagWidth + (trackFlagOptions.length - 1) * flagGap;
  const flagStartX = centerX + centerW - 24 - flagRowWidth, flagY = top + 27;
  const flagIndicators = [];
  trackFlagOptions.forEach(([name, code, color], index) => {
    const x = flagStartX + index * (flagWidth + flagGap);
    const active = { Visible: binding(`return trackFlagActive('${code}');`) };
    const frame = rect(`Track flag ${code} frame`, x, flagY, flagWidth, flagHeight, colors.muted, active);
    frame.MinimumRefreshIntervalMS = 100;
    flagIndicators.push(frame);
    const tile = rect(`Track flag ${code}`, x + 2, flagY + 2, flagWidth - 4, flagHeight - 4, color,
      active);
    tile.MinimumRefreshIntervalMS = 100;
    flagIndicators.push(tile);
    if (name === 'Checkered') {
      [[0, 0], [1, 1]].forEach(([column, row]) => {
        const checkerSizeX = (flagWidth - 4) / 2, checkerSizeY = (flagHeight - 4) / 2;
        const checker = rect(`Track flag CHECKERED square ${column}${row}`,
          x + 2 + column * checkerSizeX, flagY + 2 + row * checkerSizeY,
          checkerSizeX, checkerSizeY, '#FF171717',
          active);
        checker.MinimumRefreshIntervalMS = 100;
        flagIndicators.push(checker);
      });
    }
  });
  driving.push(layer('Track flag indicators', flagIndicators, "return mode() === 'race';"));
  const miniGaugeSize = 112, miniGaugeX = centerX + centerW - miniGaugeSize - 8;
  const diameter = Math.min(centerW * 0.70, centerW - miniGaugeSize - 60, 560), radius = diameter / 2 - 8;
  const cx = centerX + centerW * 0.40, cy = top + diameter / 2 + 60;
  const miniGaugeRows = [top + 64, top + 224, top + 384];
  driving.push(dial('RPM bezel diffuser glow', cx - diameter / 2, cy - diameter / 2, diameter,
    radius + 2, '#00000000', 8, 'return 0;', {
      ShowNeedle: false, CapRadius: 0, ShowDialGlassEffect: false,
      DialBackgroundColor: '#00000000', OuterStrokeThickness: 12,
      MinorTickColor: '#00000000', ScaleGlowRadius: 0,
      AboveOptimalStyle: { ArcColor: '#00000000' },
      Bindings: { DialStrokeColor: binding("return '#40' + rpmBezelColor().slice(3);") },
    }));
  driving.push(dial('RPM dial', cx - diameter / 2, cy - diameter / 2, diameter, radius, colors.gaugeInk, 9,
    'return needleValue(number(data("Rpms")) === null ? null : number(data("Rpms")) / 1000, rpmScale());', {
      NeedleThickness: 3, NeedleLength: radius * 0.82, CapRadius: 12,
      ShowRadialGauge: true, DialBackgroundColor: colors.gaugeFace, OuterStrokeThickness: 5,
      Bindings: {
        Value: binding('return needleValue(number(data("Rpms")) === null ? null : number(data("Rpms")) / 1000, rpmScale());'),
        Maximum: binding('return rpmScale();'),
        MajorDivisionsCount: binding('return rpmScale() <= 4 ? 0.5 : 1;'),
        RangeOptimalEndValue: binding('return rpmMax() * 0.95 / 1000;'),
        ShowNeedle: binding('var v = number(data("Rpms")); return v !== null && v >= 0;'),
        DialStrokeColor: binding('return rpmBezelColor();'),
      },
    }));
  const hubSize = diameter * 0.12;
  driving.push(item('ImageItem', 'RPM center hub', cx - hubSize / 2, cy - hubSize / 2, hubSize, hubSize, {
    Image: gaugeHubImage.name, AutoSize: false, AutoSizeScale: 1, BackgroundColor: '#00000000',
  }));
  const miniHubSize = miniGaugeSize * 0.12;
  const miniHub = (name, centerX, centerY) => driving.push(item('ImageItem', name,
    centerX - miniHubSize / 2, centerY - miniHubSize / 2, miniHubSize, miniHubSize, {
      Image: gaugeHubImage.name, AutoSize: false, AutoSizeScale: 1, BackgroundColor: '#00000000',
    }));
  driving.push(label('Speed label', 'SPEED', cx - 120, cy + 67, 110, 18, 12, colors.muted, undefined, 1));
  driving.push(label('Speed', '248', cx - 120, cy + 87, 110, 60, 48, colors.amber,
    'return metric(speedValue());', 1));
  driving.push(label('Speed unit', 'KM/H', cx - 107, cy + 148, 84, 16, 12, colors.muted,
    'return speedUnit();', 1));
  driving.push(label('RPM label', 'RPM x1000', cx - 100, cy + 36, 200, 22, 16, colors.gaugeInk,
    'return number(data("Rpms")) === null || number(data("Rpms")) < 0 ? "RPM UNAVAILABLE" : "RPM x1000";', 1));
  const pitLedSize = 48, pitLedInset = 3, pitLedLeft = cx - pitLedSize / 2, pitLedTop = cy + 174;
  const pitLedFrame = rect('Pit limiter LED frame', pitLedLeft, pitLedTop, pitLedSize, pitLedSize,
    colors.muted, { Visible: binding('return pitLimiterState() !== null;') });
  Object.assign(pitLedFrame, { RadiusTopLeft: 6, RadiusTopRight: 6, RadiusBottomLeft: 6, RadiusBottomRight: 6 });
  pitLedFrame.MinimumRefreshIntervalMS = 100;
  driving.push(pitLedFrame);
  const pitLedOff = rect('Pit limiter LED off', pitLedLeft + pitLedInset, pitLedTop + pitLedInset,
    pitLedSize - pitLedInset * 2, pitLedSize - pitLedInset * 2, '#FF50321C',
    { Visible: binding('return pitLimiterState() === false;') });
  Object.assign(pitLedOff, { RadiusTopLeft: 4, RadiusTopRight: 4, RadiusBottomLeft: 4, RadiusBottomRight: 4 });
  pitLedOff.MinimumRefreshIntervalMS = 100;
  driving.push(pitLedOff);
  const pitLedOn = rect('Pit limiter LED on', pitLedLeft + pitLedInset, pitLedTop + pitLedInset,
    pitLedSize - pitLedInset * 2, pitLedSize - pitLedInset * 2, colors.cyan,
    { Visible: binding('return pitLimiterState() === true;') });
  Object.assign(pitLedOn, { RadiusTopLeft: 4, RadiusTopRight: 4, RadiusBottomLeft: 4, RadiusBottomRight: 4 });
  pitLedOn.MinimumRefreshIntervalMS = 100;
  driving.push(pitLedOn);
  const limiter = label('Pit limiter', 'PIT', pitLedLeft, pitLedTop, pitLedSize, pitLedSize, 12, colors.white, undefined, 1);
  limiter.FontWeight = 'Bold';
  limiter.Bindings = { TextColor: binding('return pitLimiterColor();') };
  driving.push(limiter);
  driving.push(label('Gear label', 'GEAR', cx + 10, cy + 67, 100, 18, 12, colors.muted, undefined, 1));
  driving.push(label('Gear', '5', cx + 10, cy + 87, 100, 60, 48, colors.amber, 'return gear();', 1));
  driving.find(i => i.Name === 'Gear').Bindings.TextColor = binding('return gearHighlightColor();');
  const fuelD = miniGaugeSize, fuelRadius = 51, fuelX = miniGaugeX + miniGaugeSize / 2, fuelY = miniGaugeRows[2];
  driving.push(dial('Fuel dial', fuelX - fuelD / 2, fuelY, fuelD, fuelRadius, colors.gaugeInk, 100,
    'return needleValue(fuelPercent(), 100);', {
      NeedleLength: fuelRadius * 0.82, CapRadius: 12 * fuelRadius / radius,
      NeedleThickness: 3, NeedleColor: colors.needle,
      MajorDivisionsCount: 50, MinorDivisionsCount: 4,
      ScaleLabelStyle: { LabelFont: 'Bahnschrift', LabelFontSize: 12, LabelFontWeight: 'Normal', LabelColor: colors.gaugeInk, LabelRadius: 29, LabelSize: '30,18' },
      Bindings: {
        Value: binding('return needleValue(fuelPercent(), 100);'),
        ShowNeedle: binding('return fuelPercent() !== null;'),
        MajorTickColor: binding('return fuelGaugeColor();'),
        DialStrokeColor: binding('return fuelGaugeColor();'),
      },
    }));
  miniHub('Fuel center hub', fuelX, fuelY + fuelD / 2);
  driving.push(label('Fuel state', 'FUEL', fuelX - 56, fuelY + fuelD + 4, 112, 14, 11, colors.muted,
    "return fuelPercent() === null ? 'FUEL UNAVAILABLE' : lowFuel() ? 'LOW FUEL' : 'FUEL / E - F';", 1));
  const fuelLabel = driving.find(i => i.Name === 'Fuel state');
  fuelLabel.Bindings.TextColor = binding('return fuelColor();');
  driving.push(label('Fuel value', '--', fuelX - 56, fuelY + fuelD + 20, 112, 23, 18, colors.amber,
    'return metric(fuelPercent(), 0, "%");', 1));
  driving.find(i => i.Name === 'Fuel value').Bindings.TextColor = binding('return fuelColor();');
  [['Oil', 'OilTemperature', 170], ['Coolant', 'WaterTemperature', 130]].forEach(([name, key, maximum], index) => {
    const x = miniGaugeX, y = miniGaugeRows[index];
    const miniRadius = miniGaugeSize / 2 - 4;
    driving.push(dial(`${name} temperature dial`, x, y, miniGaugeSize, miniRadius, colors.gaugeInk, maximum,
      `return needleValue(engineTemperature('${key}'), ${maximum});`, {
        MajorDivisionsCount: maximum / 2, MinorDivisionsCount: 2, NeedleThickness: 3,
        NeedleLength: miniRadius * 0.82, CapRadius: 12 * miniRadius / radius, NeedleColor: colors.needle,
        MajorTickSize: '9,3', MinorTickSize: '5,2',
        ScaleLabelStyle: { LabelFont: 'Bahnschrift', LabelFontSize: 10, LabelFontWeight: 'Normal', LabelColor: colors.gaugeInk,
          LabelRadius: 25, LabelSize: '28,14' },
        Bindings: {
          Value: binding(`return needleValue(engineTemperature('${key}'), ${maximum});`),
          ShowNeedle: binding(`return engineTemperature('${key}') !== null;`),
          MajorTickColor: binding(`return temperatureGaugeColor('${key}');`),
          DialStrokeColor: binding(`return temperatureGaugeColor('${key}');`),
        },
      }));
    miniHub(`${name} temperature center hub`, x + miniGaugeSize / 2, y + miniGaugeSize / 2);
    const title = label(`${name} temperature label`, name.toUpperCase(), x, y + miniGaugeSize + 4,
      miniGaugeSize, 14, 11, colors.muted, undefined, 1);
    title.Bindings = { TextColor: binding(`return temperatureLabelColor('${key}');`) };
    driving.push(title);
    const reading = label(`${name} temperature`, '--', x, y + miniGaugeSize + 20, miniGaugeSize, 23, 18, colors.amber,
      `return metric(engineTemperature('${key}'), 0, ' C');`, 1);
    reading.Bindings.TextColor = binding(`return temperatureValueColor('${key}');`);
    driving.push(reading);
  });
  const energyWidth = Math.min(180, (diameter - 24) / 2), energyY = cy + diameter / 2 + 12;
  const kers = [
    label('KERS label', 'KERS', cx - energyWidth - 8, energyY, 52, 28, 13, colors.muted),
    label('KERS charge', '--', cx - energyWidth + 48, energyY, energyWidth - 56, 28, 22, colors.amber,
      "return metric(kersPercent(), 0, '%');", 1),
  ];
  const drs = [
    label('DRS label', 'DRS', cx + 8, energyY, 44, 28, 13, colors.muted),
    label('DRS status', '--', cx + 56, energyY, energyWidth - 48, 28, 22, colors.muted,
      "return drsState() || '--';", 1),
  ];
  drs[1].Bindings.TextColor = binding("var state = drsState(); return state === 'ACTIVE' ? '#FF78A34D' : state === 'READY' ? '#FFFFB02E' : '#FFC5B39A';");
  driving.push(layer('KERS indicator', kers, 'return kersPercent() !== null;'));
  driving.push(layer('DRS indicator', drs, 'return drsState() !== null;'));
  driving.push(label('Cluster scale source', 'RPM LIMIT', centerX + 24, top + 660, centerW - 48, 24, 14, colors.muted,
    "return 'RPM LIMIT: ' + rpmSource() + ' ' + metric(rpmMax());", 1));
  const settings = [];
  const settingW = (centerW - 48) / 5;
  [['BrakeBias', 'BRAKE BIAS'], ['ABSLevel', 'ABS'], ['TCLevel', 'TC'],
    ['TractionControlCut', 'TC2 / CUT'], ['EngineMap', 'ENGINE MAP']].forEach(([key, title], index) => {
    const x = centerX + 24 + index * settingW, titleW = Math.min(86, settingW * 0.64);
    settings.push(label(`${key} setting label`, title, x, top + 700, titleW, 24, 12, colors.muted));
    settings.push(label(`${key} setting`, '--', x + titleW + 4, top + 700, settingW - titleW - 4, 24, 15, colors.cyan,
      `return carSetting('${key}');`));
  });
  driving.push(layer('Car settings', settings, 'return live();'));
  const pedalW = Math.min(160, centerW * 0.22), pedalX = centerX + centerW - pedalW - 12;
  [['Throttle', colors.green], ['Brake', colors.red], ['Clutch', colors.cyan], ['Handbrake', colors.amber]].forEach(([key, color], index) => {
    const segment = pedalW / 4, w = Math.min(32, segment - 8), x = pedalX + index * segment + (segment - w) / 2;
    const y = top + 545, h = 84;
    bar(driving, `${key} bar`, x, y, w, h, `data('${key}')`, color);
    driving.push(label(key, '0%', x, y + 30, w, 24, 12, colors.white,
      `return metric(data('${key}'), 0, '%');`, 1));
    driving.push(label(`${key} label`, ['THR', 'BRK', 'CLT', 'HB'][index], x, y + h + 4, w, 20, 13, color, undefined, 1));
  });
  items.push(layer('Live driving', driving, 'return live();'));

  const race = [];
  panel(race, 'Timing panel', leftX, top, leftW, mainH);
  const timingColumnW = (leftW - 60) / 2;
  const timingLeftX = leftX + 24, timingRightX = timingLeftX + timingColumnW + 12;
  race.push(label('Timing title', '01  /  SESSION TIMING', leftX + 24, top + 12, leftW - 48, 28, 20, colors.cyan));
  race.push(label('Position and lap', 'P 3 / LAP 12', leftX + 24, top + 44, leftW - 48, 32, 23, colors.white,
    "return 'P ' + positive(data('Position')) + ' / LAP ' + positive(data('CurrentLap'));"));
  race.push(label('Current lap time label', 'CURRENT LAP', timingLeftX, top + 84, timingColumnW, 20, 13, colors.muted));
  race.push(label('Current lap time', '1:42.368', timingLeftX, top + 106, timingColumnW, 44, 32, colors.white,
    "return lapTime(data('CurrentLapTime'));"));
  race.push(label('Last lap time', 'LAST / 1:43.106', timingRightX, top + 106, timingColumnW, 28, 17, colors.muted,
    "return 'LAST / ' + lapTime(data('LastLapTime'));"));
  race.push(label('Best lap time', 'BEST / 1:42.012', timingRightX, top + 142, timingColumnW, 28, 17, colors.green,
    "return 'BEST / ' + lapTime(data('BestLapTime'));"));
  race.push(label('Delta', '-0.356', timingLeftX, top + 158, timingColumnW, 44, 34, colors.green, 'return delta();'));
  race.find(i => i.Name === 'Delta').Bindings.TextColor = binding('return deltaColor();');
  race.push(label('Delta explanation', 'DELTA TO BEST', timingLeftX, top + 204, timingColumnW, 18, 11, colors.muted));
  race.push(rect('Class divider', leftX + 24, top + 230, leftW - 48, 1, colors.sectionDivider));
  race.push(label('Class heading', 'CLASS STANDINGS', leftX + 24, top + 238, leftW - 48, 24, 16, colors.cyan,
    "return classAvailable() ? 'CLASS / ' + text(data('CarClass')).slice(0, 28) : 'CLASS DATA UNAVAILABLE';"));
  const classContentW = leftW - 48, classGapW = 120, classNameW = classContentW - classGapW - 12;
  const classGapX = timingLeftX + classNameW + 12;
  race.push(label('Ahead caption', 'AHEAD / IN CLASS', timingLeftX, top + 266, classNameW, 18, 12, colors.muted));
  race.push(label('Ahead gap caption', 'GAP', classGapX, top + 266, classGapW, 18, 12, colors.muted, undefined, 2));
  race.push(label('Behind caption', 'BEHIND / IN CLASS', timingLeftX, top + 326, classNameW, 18, 12, colors.muted));
  race.push(label('Behind gap caption', 'GAP', classGapX, top + 326, classGapW, 18, 12, colors.muted, undefined, 2));
  const ahead = classNeighbour('Class ahead', timingLeftX, top + 288, classNameW, 0);
  Object.assign(ahead, { Height: 30, FontSize: 18, OpponentStyle: { ...ahead.OpponentStyle, FontSize: 18 } });
  race.push(ahead);
  const aheadGap = classGap('Class ahead gap', classGapX, top + 288, classGapW, 0);
  Object.assign(aheadGap, { Height: 30, FontSize: 18, OpponentStyle: { ...aheadGap.OpponentStyle, FontSize: 18 } });
  race.push(aheadGap);
  const behind = classNeighbour('Class behind', timingLeftX, top + 348, classNameW, 2);
  Object.assign(behind, { Height: 30, FontSize: 18, OpponentStyle: { ...behind.OpponentStyle, FontSize: 18 } });
  race.push(behind);
  const behindGap = classGap('Class behind gap', classGapX, top + 348, classGapW, 2);
  Object.assign(behindGap, { Height: 30, FontSize: 18, OpponentStyle: { ...behindGap.OpponentStyle, FontSize: 18 } });
  race.push(behindGap);
  race.push(rect('Leaderboard divider', leftX + 24, top + 388, leftW - 48, 1, colors.sectionDivider));
  race.push(label('Leaderboard heading', 'OVERALL', leftX + 24, top + 396, leftW - 48, 20, 14, colors.cyan,
    'return gridHeading();'));
  const columnW = (leftW - 48) / 2;
  for (let slot = 0; slot < 20; slot++) {
    const x = leftX + 24 + Math.floor(slot / 10) * columnW;
    const y = top + 420 + slot % 10 * 25;
    race.push(label(`Grid rank ${slot}`, '--', x, y, 26, 22, 14, colors.muted,
      `return gridPosition(${slot}) <= gridCount() ? String(gridPosition(${slot})) : '';`));
    const name = classNeighbour(`Grid driver ${slot}`, x + 28, y, columnW - 32, slot + 1);
    Object.assign(name, { Height: 22, FontSize: 14, LeaderboardMode: 1,
      LeaderboardPositionRelativeToPlayer: false, PlayerStyleEnabled: true,
      PlayerStyle: { FontSize: 14, TextColor: colors.cyan, FontWeight: 'Bold', FontStyle: 'Normal' },
      OpponentStyle: { FontSize: 14, TextColor: colors.white, FontWeight: 'Normal', FontStyle: 'Normal' },
      NoDataText: '', Bindings: {
        Visible: binding(`return gridPosition(${slot}) <= gridCount();`),
        LeaderboardPosition: binding(`return gridPosition(${slot});`),
      } });
    race.push(name);
  }

  panel(race, 'Map panel', rightX, top, leftW, fullPanelH);
  race.push(label('Map title', '02 / TRACK MAP + RADAR', rightX + 24, top + 12, leftW - 48, 32, 20, colors.cyan));
  const mapStatusY = top + 616, mapStatusHeight = 22;
  const radarTitleY = mapStatusY + mapStatusHeight;
  const radarSize = Math.min(250, leftW - 48), radarX = rightX + (leftW - radarSize) / 2;
  const radarY = radarTitleY + 22;
  race.push(label('Radar title', 'RADAR', rightX + 24, radarTitleY, leftW - 48, 22, 14, colors.cyan, undefined, 1));
  race.push(rect('Radar cross vertical', radarX + radarSize / 2, radarY, 1, radarSize, colors.line));
  race.push(rect('Radar cross horizontal', radarX, radarY + radarSize / 2, radarSize, 1, colors.line));
  race.push(item('RadarItem', 'Nearby radar', radarX, radarY, radarSize, radarSize, {
    BackgroundColor: '#00000000', Scale: 0.3, UseSmoothedPlayerAngle: false,
    PlayerStyle: opponentStyle(colors.cyan, 10), OpponentStyle: opponentStyle(colors.amber, 8),
    Bindings: { Visible: binding('return coordinatesAvailable();') },
  }));
  const radarBorder = 2;
  race.push(rect('Radar border top', radarX, radarY, radarSize, radarBorder, colors.muted));
  race.push(rect('Radar border bottom', radarX, radarY + radarSize - radarBorder, radarSize, radarBorder, colors.muted));
  race.push(rect('Radar border left', radarX, radarY, radarBorder, radarSize, colors.muted));
  race.push(rect('Radar border right', radarX + radarSize - radarBorder, radarY, radarBorder, radarSize, colors.muted));
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
  const mapX = rightX + 16, mapY = top + 134, mapW = leftW - 32, mapH = 480, mapBorder = 2;
  race.push(generatedMap('Track minimap', mapX, mapY, mapW, mapH));
  race.push(rect('Map viewport border top', mapX, mapY, mapW, mapBorder, colors.muted));
  race.push(rect('Map viewport border bottom', mapX, mapY + mapH - mapBorder, mapW, mapBorder, colors.muted));
  race.push(rect('Map viewport border left', mapX, mapY, mapBorder, mapH, colors.muted));
  race.push(rect('Map viewport border right', mapX + mapW - mapBorder, mapY, mapBorder, mapH, colors.muted));
  race.push(label('Map status', 'POSITION DATA UNAVAILABLE', rightX + 24, mapStatusY, leftW - 48, mapStatusHeight, 11, colors.muted,
    "return coordinatesAvailable() ? 'NO MAP? DRIVE A CLEAN LAP TO RECORD IT' : 'POSITION DATA UNAVAILABLE';", 1));
  items.push(layer('Circuit layout', race, "return live() && mode() === 'race';"));

  const tyres = [];
  panel(tyres, 'Tyre summary panel', leftX, bottom, leftW, bottomH);
  tyres.push(label('Tyre summary heading', 'TYRES / PRESSURE / BRAKES', leftX + 16, bottom + 5, leftW - 32, 22, 15, colors.cyan));
  const tyreContentX = leftX + 16, tyreColumnW = (leftW - 44) / 2, wheelWidth = 36, wheelHeight = 48;
  [['FL', 'FrontLeft'], ['FR', 'FrontRight'], ['RL', 'RearLeft'], ['RR', 'RearRight']].forEach(([short, key], index) => {
    const column = index % 2, row = Math.floor(index / 2);
    const x = tyreContentX + column * (tyreColumnW + 12), y = bottom + 29 + row * 74;
    const wheelX = x + (tyreColumnW - wheelWidth) / 2;
    const sideW = wheelX - x - 8, rightX = wheelX + wheelWidth + 8;
    tyres.push(rect(`Wheel ${short} casing`, wheelX, y, wheelWidth, wheelHeight, '#FF9CA6A6'));
    const fillX = wheelX + 4, fillY = y + 3, fillWidth = wheelWidth - 8, fillHeight = wheelHeight - 6;
    tyres.push(rect(`Wheel ${short} wear track`, fillX, fillY, fillWidth, fillHeight, colors.inset));
    tyres.push(rect(`Wheel ${short} life fill`, fillX, fillY + fillHeight, fillWidth, 0, '#FF25C94A', {
      Height: binding(`return ${fillHeight} * tyreLifeFill('${key}') / 100;`),
      Top: binding(`return ${fillY + fillHeight} - ${fillHeight} * tyreLifeFill('${key}') / 100;`),
    }));
    tyres.push(label(`Tyre ${short} pressure`, '-- psi', x, y + 4, sideW, 18, 12, colors.white,
      `return detailReading('pressure${short}', 'pressure', 'TyrePressure${key}');`, 2));
    tyres.push(label(`Tyre ${short} brake temperature`, 'B -- C', x, y + 26, sideW, 18, 11, colors.amber,
      `return 'B ' + detailReading('brake${short}', 'temperature', null);`, 2));
    tyres.push(label(`Tyre ${short}`, 'FL / -- C', rightX, y + 4, x + tyreColumnW - rightX, 18, 12, colors.cyan,
      `return '${short} / ' + positive(data('TyreTemperature${key}'), 0, ' C');`));
  });
  tyres.push(label('Tyre compound', 'TYRE / --', leftX + 88, bottom + 80, leftW - 176, 19, 13, colors.white,
    "return 'TYRE / ' + detailReading('compound', 'text', null);", 1));
  items.push(layer('Tyre summary', tyres, 'return live();'));

  const rally = [];
  panel(rally, 'Rally timing panel', leftX, top, leftW, mainH);
  rally.push(label('Rally title', '01  /  STAGE MONITOR', leftX + 24, top + 20, leftW - 48, 36, 21, colors.amber));
  value(rally, 'Rally elapsed', 'STAGE ELAPSED', '--', leftX + 24, top + 104, leftW - 48,
    "return detailReading('stageSeconds', 'seconds');", colors.white, 56);
  value(rally, 'Rally last', 'STAGE RESULT', '--', leftX + 24, top + 278, leftW - 48,
    "var s = detailReading('stageResult', 'text'); return s.length > 18 ? s.slice(0, 15) + '...' : s;", colors.muted, 30);
  panel(rally, 'Rally stage panel', rightX, top, leftW, fullPanelH);
  rally.push(label('Rally stage map title', '02  /  STAGE ROUTE', rightX + 24, top + 20, leftW - 48, 32, 19, colors.amber));
  const rallyMapSize = Math.min(leftW - 48, 440), rallyMapX = rightX + (leftW - rallyMapSize) / 2;
  const rallyMapY = top + 60, rallyMapHeight = 480, rallyMapBorder = 2;
  rally.push(generatedMap('Rally stage map', rallyMapX, rallyMapY, rallyMapSize, rallyMapHeight));
  rally.push(rect('Rally map border top', rallyMapX, rallyMapY, rallyMapSize, rallyMapBorder, colors.muted));
  rally.push(rect('Rally map border bottom', rallyMapX, rallyMapY + rallyMapHeight - rallyMapBorder,
    rallyMapSize, rallyMapBorder, colors.muted));
  rally.push(rect('Rally map border left', rallyMapX, rallyMapY, rallyMapBorder, rallyMapHeight, colors.muted));
  rally.push(rect('Rally map border right', rallyMapX + rallyMapSize - rallyMapBorder, rallyMapY,
    rallyMapBorder, rallyMapHeight, colors.muted));
  const rallyMapStatus = label('Rally map status', 'STAGE ROUTE / POSITION DATA UNAVAILABLE',
    rallyMapX, rallyMapY, rallyMapSize, rallyMapHeight, 14, colors.muted, undefined, 1);
  rallyMapStatus.Bindings = { Visible: binding('return !coordinatesAvailable();') };
  rally.push(rallyMapStatus);
  const rallyMetricW = (leftW - 48) / 3;
  [
    ['Rally stage progress', 'PROGRESS', "return detailReading('stageProgressPercent', 'percent');"],
    ['Rally stage distance', 'DISTANCE LEFT', "return detailReading('stageDistanceKm', 'distance');"],
    ['Rally stage split', 'CHECKPOINT DELTA', "return detailReading('stageSplitSeconds', 'delta');"],
  ].forEach(([name, title, expression], index) => {
    const x = rightX + 24 + index * rallyMetricW;
    rally.push(label(`${name} label`, title, x, top + 556, rallyMetricW - 6, 18, 12, colors.muted, undefined, 1));
    rally.push(label(name, '--', x, top + 576, rallyMetricW - 6, 40, 27, colors.amber, expression, 1));
  });
  rally.push(rect('Rally condition divider', rightX + 24, top + 628, leftW - 48, 1, colors.sectionDivider));
  rally.push(label('Rally condition title', '03  /  VEHICLE CONDITION', rightX + 24, top + 644,
    leftW - 48, 24, 16, colors.amber));
  const conditionW = (leftW - 56) / 2;
  [
    ['Rally damage', 'DAMAGE', "return detailReading('damage', 'text');"],
    ['Rally transmission', 'TRANSMISSION', "return detailReading('transmission', 'text');"],
    ['Rally ABS', 'ABS INTERVENTION', "return detailReading('absActive', 'switch');"],
    ['Rally TC', 'TC INTERVENTION', "return detailReading('tcActive', 'switch');"],
  ].forEach(([name, title, expression], index) => {
    const column = index % 2, row = Math.floor(index / 2);
    const x = rightX + 24 + column * (conditionW + 8), labelY = top + 674 + row * 68;
    rally.push(label(`${name} label`, title, x, labelY, conditionW, 18, 12, colors.muted));
    rally.push(label(name, '--', x, labelY + 20, conditionW, 32, 18, colors.white, expression));
  });
  items.push(layer('Rally layout', rally, "return live() && mode() === 'rally';"));

  const lower = [];
  const summary = [];
  summary.push(label('Strategy summary', '--', centerX + 24, top + 854, centerW - 48, 24, 15, colors.amber,
    `var s = 'FUEL ' + detailReading('fuelLaps', 'laps') + ' / SESSION ' + detailReading('sessionSeconds', 'seconds') + ' / LAPS ' + detailReading('sessionLaps', 'count'); return s.length > ${Math.floor((centerW - 48) / 10)} ? s.slice(0, ${Math.floor((centerW - 48) / 10) - 3}) + '...' : s;`));
  summary[0].Bindings.Visible = binding("return mode() === 'race';");
  summary.push(label('Warning summary', '--', centerX + 24, top + 886, centerW - 48, 24, 14, colors.red,
    `var s = raceWarnings(); return s.length > ${Math.floor((centerW - 48) / 9)} ? s.slice(0, ${Math.floor((centerW - 48) / 9) - 3}) + '...' : s;`));
  summary[1].Bindings.TextColor = binding("return raceWarnings() === 'WARNINGS / CHECK GAME' || !live() ? '#FFC5B39A' : '#FFFF3B24';");
  driving.push(...summary);
  const music = [];
  panel(music, 'Music panel', musicX, 10, musicW, 64);
  const controlsW = 220;
  const trackW = musicW - controlsW - 40;
  music.push(label('Music title', 'NIGHT DRIVE / DEMO TRACK', musicX + 12, 17, trackW, 21, 15, colors.cyan,
    `var s = mediaTitle(); return s.length > ${Math.floor(trackW / 15)} ? s.slice(0, ${Math.floor(trackW / 15) - 3}) + '...' : s;`));
  music.push(label('Music artist', 'Demo artist', musicX + 12, 41, trackW, 16, 11, colors.muted,
    `var s = mediaArtist(); return s.length > ${Math.floor(trackW / 11)} ? s.slice(0, ${Math.floor(trackW / 11) - 3}) + '...' : s;`));
  Object.entries(mediaActions).forEach(([title, action], index) => {
    const x = musicX + musicW - controlsW - 8 + index * 72;
    music.push(rect(`Music ${title} background`, x, 27, 68, 30, colors.line));
    music.push(label(`Music ${title} text`, title.toUpperCase(), x + 2, 27, 64, 30, 10, colors.white, undefined, 1));
    music.push(mediaButton(`Music ${title} button`, x, 27, 68, 30, action));
  });
  lower.push(layer('Music controls', music, 'return musicPage();'));
  items.push(layer('Live lower strip', lower, 'return live();'));

  const idle = [];
  panel(idle, 'Standby panel', 0, 0, width, height);
  standbyImages.forEach((image, index) => {
    idle.push(item('ImageItem', `Standby ribbon ${index + 1}`, margin, 490 + index * 48, usable, 360, {
      Image: image.name, AutoSize: false, AutoSizeScale: 1, BackgroundColor: '#00000000',
      Bindings: {
        Top: binding(`if (!live()) root.ribbonOffset = 24 * Math.sin(new Date().getTime() / ${2800 + index * 800} + ${index * 2}); return ${490 + index * 48} + (root.ribbonOffset || 0);`),
      },
    }));
  });
  idle.push(label('Standby heading', 'WAITING FOR GAME...', margin + 64, 430, usable - 128, 50, 30, colors.white,
    "return live() ? 'WELCOME / ' + gameName() : running() ? 'GAME NOT RECOGNIZED.' : 'WAITING FOR GAME...';", 1));
  idle.push(label('Standby hint', '', margin + 64, 860, usable - 128, 40, 22, colors.muted,
    "return live() ? 'YOUR DASH IS READY.' : running() ? 'Current game ID: ' + text(read('DataCorePlugin.CurrentGame')) : 'Launch your game and let SimHub connect.';", 1));
  idle.push(label('Standby games', 'ASSETTO CORSA / AC RALLY / AUTOMOBILISTA 2 / LE MANS ULTIMATE / RICHARD BURNS RALLY (RSF)',
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
    'Rally stage panel': "live() && mode() === 'rally'", 'Music panel': 'musicPage()',
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
        /^Standby |^RPM shift light |^Wheel .* life fill$/.test(entry.Name) || panelModes[entry.Name] ? 50 :
        entry.$type.includes('.DialGaugeItem,') || /^(Throttle|Brake|Clutch|Handbrake)( |$)|^(Speed|Gear)$|^Nearby radar$/.test(entry.Name) ? 50 :
        ['Fuel state', 'Status', 'Pit limiter'].includes(entry.Name) || /^Track flag /.test(entry.Name) ? 100 :
        /^Grid |^Leaderboard heading$|^Tyre |^Map (Air|Track|Wind)|^Music (title|artist)$/.test(entry.Name) ? 500 :
        entry.Bindings && Object.keys(entry.Bindings).length ? 250 : 1000;
    }
  }
  setRefreshRates(items);
  const screen = {
    RenderingSkip: 0, Name: 'Y.A.S.D / Overview', InGameScreen: true, IdleScreen: true, PitScreen: true,
    ScreenId: id.replace(/1$/, '2'), BackgroundLayerScreenId: '00000000-0000-0000-0000-000000000000',
    AllowOverlays: false, IsForegroundLayer: false, IsOverlayLayer: false,
    OverlayTriggerExpression: { Expression: '' }, ScreenEnabledExpression: { Expression: '' },
    OverlayMaxDuration: 0, OverlayMinDuration: 0, IsBackgroundLayer: false,
    BackgroundColor: colors.bg, Items: items, MinimumRefreshIntervalMS: 50,
  };
  const screens = [screen];
  return {
    Variables: { DashboardVariables: [] }, DashboardDebugManager: {},
    Version: 2, Id: id, BaseHeight: height, BaseWidth: width, BackgroundColor: colors.bg,
    Screens: screens,
    SnapToGrid: false, HideLabels: false, ShowForeground: true, ForegroundOpacity: 100,
    ShowBackground: true, BackgroundOpacity: 100, ShowBoundingRectangles: false, GridSize: 10,
    Images: dashboardImages.map(image => image.metadata),
    Metadata: {
      ScreenCount: 1, InGameScreensIndexs: [0], IdleScreensIndexs: [0], PitScreensIndexs: [0],
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
    const name = `Y.A.S.D ${width}x1080.djson`;
    const dashboard = createDashboard(width);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, name), JSON.stringify(dashboard, null, 2) + '\n');
    await writeFile(path.join(folder, name + '.metadata'), JSON.stringify(dashboard.Metadata, null, 2) + '\n');
    await writeFile(path.join(folder, name + '.ressources'), standbyResources());
    const previewModel = structuredClone(dashboard);
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Y.A.S.D / ${width} x 1080 preview</title><style>${css}</style></head>
<body><nav aria-label="Preview controls"><strong>Y.A.S.D <span>/ DESIGN PREVIEW</span></strong>
<label>Simulator <select id="game">
<option value="AssettoCorsa">Assetto Corsa / Content Manager</option>
<option value="AssettoCorsaRally">Assetto Corsa Rally</option>
<option value="RichardBurnsRally">Richard Burns Rally / RSF</option>
<option value="Automobilista2">Automobilista 2</option>
<option value="LeMansUltimate">Le Mans Ultimate</option>
<option value="idle">Standby</option></select></label>
<label>State <select id="state"><option value="normal">Driving</option><option value="shift">Shift / overspeed</option>
<option value="pit">Pit limiter</option><option value="low">Low fuel</option><option value="missing">Missing telemetry</option>
<option value="energyReady">KERS / DRS ready</option><option value="energyActive">KERS / DRS active</option>
<option value="energyEmpty">KERS empty / DRS off</option>
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
<script id="dashboard-images" type="application/json">${JSON.stringify(Object.fromEntries(dashboardImages.map(image =>
  [image.name, 'data:image/png;base64,' + image.bytes.toString('base64')])) )}</script>
<script>${js}</script></body></html>`;
    await writeFile(path.join(folder, 'preview.html'), html);
    console.log(`Generated ${width}x1080: native dashboard, metadata, offline preview`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generate();
}
