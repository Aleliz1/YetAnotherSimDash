import { readFileSync } from 'node:fs';
import { detailFields } from './details.mjs';

export const boostChannels = [
  ['kersChargePercentProperty', 'KERS CHARGE', 'percent'],
  ['pushToPassActiveProperty', 'P2P ACTIVE', 'switch'],
  ['pushToPassRemainingProperty', 'P2P USES LEFT', 'count'],
  ['mguModeProperty', 'MGU MODE', 'mode'],
  ['mguDeployKwProperty', 'MGU DEPLOY', 'power'],
  ['mguRecoverKwProperty', 'MGU RECOVER', 'power'],
  ['hybridEnergyMjProperty', 'ENERGY LEFT', 'energy'],
];

export function validateProfiles(config) {
  if (!config || !config.defaults || !Array.isArray(config.cars)) throw new Error('Profiles require defaults and a cars array');
  for (const key of Object.keys(config)) if (!['defaults', 'cars'].includes(key)) throw new Error(`Unknown profiles section: ${key}`);
  for (const key of Object.keys(config.defaults)) if (!['race', 'rally'].includes(key)) throw new Error(`Unknown default category: ${key}`);
  const limits = { speedKmh: [20, 1000], rpmFallback: [500, 30000], rpmMax: [500, 30000],
    oilWarningC: [1, 300], coolantWarningC: [1, 300] };
  function check(entry, required = []) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Each vehicle profile must be an object');
    for (const key of required) if (!(key in entry)) throw new Error(`Missing profile field: ${key}`);
    for (const [key, bounds] of Object.entries(limits)) {
      if (key in entry && (!Number.isFinite(entry[key]) || entry[key] < bounds[0] || entry[key] > bounds[1])) {
        throw new Error(`Invalid profile ${key}: expected ${bounds[0]}..${bounds[1]}`);
      }
    }
    for (const key of Object.keys(entry)) {
      if (!(key in limits) && !['game', 'carId', 'detailProperties', 'tcCutProperty', 'windSpeedMsProperty', 'windFromDegreesProperty', 'headingDegreesProperty', 'batteryVoltageProperty', 'batteryChargePercentProperty', ...boostChannels.map(channel => channel[0])].includes(key)) throw new Error(`Unknown profile field: ${key}`);
    }
    if ('detailProperties' in entry) {
      if (!entry.detailProperties || typeof entry.detailProperties !== 'object' || Array.isArray(entry.detailProperties)) throw new Error('detailProperties must be an object');
      for (const [key, value] of Object.entries(entry.detailProperties)) {
        if (!detailFields.some(field => field[0] === key)) throw new Error(`Unknown detail property: ${key}`);
        if (typeof value !== 'string' || !value.trim()) throw new Error(`detailProperties.${key} must be a non-empty property name`);
      }
    }
    if ('tcCutProperty' in entry && (typeof entry.tcCutProperty !== 'string' || !entry.tcCutProperty.trim())) {
      throw new Error('tcCutProperty must be a non-empty SimHub property name');
    }
    if ('windSpeedMsProperty' in entry && (typeof entry.windSpeedMsProperty !== 'string' || !entry.windSpeedMsProperty.trim())) {
      throw new Error('windSpeedMsProperty must be a non-empty SimHub property name');
    }
    for (const key of ['windFromDegreesProperty', 'headingDegreesProperty', 'batteryVoltageProperty', 'batteryChargePercentProperty', ...boostChannels.map(channel => channel[0])]) {
      if (key in entry && (typeof entry[key] !== 'string' || !entry[key].trim())) throw new Error(`${key} must be a non-empty SimHub property name`);
    }
  }
  for (const mode of ['race', 'rally']) {
    check(config.defaults[mode], ['speedKmh', 'rpmFallback']);
    for (const key of Object.keys(config.defaults[mode])) {
      if (!['speedKmh', 'rpmFallback'].includes(key)) throw new Error(`Invalid default field: ${key}`);
    }
  }
  const seen = new Set();
  for (const entry of config.cars) {
    check(entry, ['game', 'carId']);
    if (typeof entry.game !== 'string' || !entry.game.trim() || typeof entry.carId !== 'string' || !entry.carId.trim()) {
      throw new Error('Car overrides need non-empty game and carId strings');
    }
    const key = entry.game.toLowerCase().replace(/[^a-z0-9]/g, '') + ':' + entry.carId.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate vehicle profile: ${key}`);
    seen.add(key);
  }
  return config;
}

export const profiles = validateProfiles(JSON.parse(readFileSync(new URL('../vehicle-profiles.json', import.meta.url), 'utf8')));

// Kept ES5-compatible for SimHub's JavaScript formula interpreter.
export const helpers = `
function read(key) { return $prop(key); }
function data(key) {
  var value = read('DataCorePlugin.GameData.' + key);
  if (value === null || value === undefined) value = read('DataCorePlugin.GameData.NewData.' + key);
  if (value === null || value === undefined) value = read(key);
  return value;
}
function number(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  var n = Number(value);
  return isFinite(n) ? n : null;
}
function flag(value) { return value === true || value === 1 || value === 'True' || value === 'true' || value === '1'; }
function game() { return String(read('DataCorePlugin.CurrentGame') || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function mode() {
  var g = game();
  if (g === 'assettocorsarally' || g === 'acrally') return 'rally';
  if (g === 'assettocorsa' || g === 'ac' || g === 'automobilista2' || g === 'ams2' || g === 'lemansultimate' || g === 'lmu') return 'race';
  return 'unsupported';
}
function gameName() {
  var g = game();
  if (mode() === 'rally') return 'ASSETTO CORSA RALLY';
  if (g === 'assettocorsa' || g === 'ac') return 'ASSETTO CORSA';
  if (g === 'automobilista2' || g === 'ams2') return 'AUTOMOBILISTA 2';
  if (g === 'lemansultimate' || g === 'lmu') return 'LE MANS ULTIMATE';
  return running() ? text(read('DataCorePlugin.CurrentGame')).toUpperCase() : 'STANDBY';
}
function running() { return flag(read('DataCorePlugin.GameRunning')); }
function live() { return running() && mode() !== 'unsupported'; }
function welcomeOpacity() {
  var now = new Date().getTime(), active = live(), id = active ? game() : '';
  var state = root.mangoWelcome;
  if (!state) state = root.mangoWelcome = { game: id, start: null };
  if (state.game !== id) {
    state.game = id;
    state.start = active ? now : null;
  }
  if (!active) return 100;
  if (state.start === null) return 0;
  var progress = Math.max(0, Math.min(1, (now - state.start - 250) / 900));
  return 100 * (1 - progress * progress * (3 - 2 * progress));
}
function drivingPanelOpacity() {
  welcomeOpacity();
  if (!live()) return 0;
  var start = root.mangoWelcome.start;
  if (start === null) return 100;
  var progress = Math.max(0, Math.min(1, (new Date().getTime() - start - 1150) / 350));
  return 100 * progress * progress * (3 - 2 * progress);
}
function blendColor(from, to, amount) {
  var color = '#FF';
  for (var i = 3; i < 9; i += 2) {
    var a = parseInt(from.slice(i, i + 2), 16), b = parseInt(to.slice(i, i + 2), 16);
    color += ('0' + Math.round(a + (b - a) * amount).toString(16)).slice(-2).toUpperCase();
  }
  return color;
}
function gearHighlightColor() {
  var now = new Date().getTime(), value = gear(), id = game() + ':' + text(data('CarId'));
  var state = root.mangoGear;
  if (!live() || !/^(N|R|[1-9][0-9]*)$/.test(value)) {
    root.mangoGear = null;
    return '#FFFFAD32';
  }
  if (!state || state.id !== id || now - state.last > 500 || now < state.last) {
    state = root.mangoGear = { id: id, value: value, start: null, last: now };
  }
  if (value !== state.value) {
    state.value = value;
    state.start = now;
  }
  state.last = now;
  var strength = state.start === null ? 0 : Math.max(0, 1 - (now - state.start) / 300);
  return blendColor('#FFFFAD32', '#FFFFD06A', strength);
}
function redlineAccentColor() {
  var ratio = live() ? rpmRatio() : null;
  var strength = ratio === null ? 0 : Math.max(0, Math.min(1, (ratio - 0.90) / 0.05));
  return blendColor('#FF303030', '#FFFF3B24', strength);
}
function engineTemperature(key) {
  var value = live() ? number(data(key)) : null;
  return value === null || value <= 0 ? null : value;
}
function batteryReading(key, percent) {
  if (!live()) return null;
  var source = profile()[key], value = source ? number(read(source)) : null;
  return value === null || value < 0 || (!percent && value === 0) || (percent && value > 100) ? null : value;
}
function boostReading(key, kind) {
  if (!live()) return '--';
  var source = profile()[key], value = source ? read(source) : null;
  if (kind === 'switch') {
    var enabled = telemetrySwitch(value);
    return enabled === null ? '--' : enabled ? 'ON' : 'OFF';
  }
  if (kind === 'mode') {
    if (typeof value === 'string' && value.replace(/^\\s+|\\s+$/g, '') !== '') return value;
    return typeof value === 'number' && isFinite(value) && value >= 0 ? String(value) : '--';
  }
  var n = number(value);
  if (n === null || n < 0 || (kind === 'percent' && n > 100) || (kind === 'count' && n % 1 !== 0)) return '--';
  return metric(n, kind === 'count' ? 0 : 1,
    kind === 'percent' ? '%' : kind === 'power' ? ' kW' : kind === 'energy' ? ' MJ' : '');
}
function detailValue(key, normalized) {
    if (!live()) return null;
    var mappings = profile().detailProperties || {};
    return mappings[key] ? read(mappings[key]) : normalized ? data(normalized) : null;
  }
function detailNumber(key) { return number(detailValue(key)); }
function detailReading(key, kind, normalized) {
    var value = detailValue(key, normalized);
    var estimate = false;
    if (value === null || value === undefined) {
      var fuel = live() ? number(data('Fuel')) : null;
      if (key === 'fuelLaps') {
        var consumption = detailNumber('fuelPerLap');
        if (fuel !== null && fuel >= 0 && consumption !== null && consumption > 0) {
          value = fuel / consumption;
          estimate = true;
        }
      }
      if (key === 'fuelToAdd') {
        var required = detailNumber('fuelToFinish');
        if (fuel !== null && fuel >= 0 && required !== null && required >= 0) {
          value = Math.max(0, required - fuel);
          estimate = true;
        }
      }
    }
    if (kind === 'text') {
      return typeof value === 'string' && value.replace(/^\\s+|\\s+$/g, '') ? value : '--';
    }
    if (kind === 'switch') {
      var enabled = telemetrySwitch(value);
      return enabled === null ? '--' : enabled ? 'YES' : 'NO';
    }
    var n = number(value);
    if (n === null || (n < 0 && kind !== 'delta') || (kind === 'percent' && n > 100) ||
        (kind === 'count' && n % 1 !== 0) || (kind === 'pressure' && n <= 0)) return '--';
    if (kind === 'seconds') {
      var seconds = Math.floor(n);
      return Math.floor(seconds / 60) + ':' + ('0' + seconds % 60).slice(-2) + '.' + ('000' + Math.floor(n * 1000) % 1000).slice(-3);
    }
    var suffix = kind === 'litres' ? ' L' : kind === 'laps' ? ' laps' :
      kind === 'speed' ? ' km/h' : kind === 'pressure' ? ' psi' : kind === 'temperature' ? ' C' :
      kind === 'bar' ? ' bar' : kind === 'energy' ? ' MJ' : kind === 'percent' ? '%' : kind === 'distance' ? ' km' : kind === 'delta' ? ' s' : '';
    return (estimate ? 'EST ' : '') + (kind === 'delta' && n >= 0 ? '+' : '') + metric(n, kind === 'count' ? 0 : kind === 'delta' ? 3 : 1, suffix);
  }
function raceWarnings() {
    if (!live()) return '--';
    var warnings = [];
    if (lowFuel()) warnings.push('LOW FUEL');
    var oil = engineTemperature('OilTemperature'), coolant = engineTemperature('WaterTemperature'), p = profile();
    if (p.oilWarningC && oil !== null && oil >= p.oilWarningC) warnings.push('OIL TEMP');
    if (p.coolantWarningC && coolant !== null && coolant >= p.coolantWarningC) warnings.push('COOLANT TEMP');
    var limit = detailNumber('pitLimitKmh'), speed = speedValue();
    if (telemetrySwitch(data('IsInPitLane')) === true && limit !== null && limit > 0 && speed !== null && speed > limit) warnings.push('PIT OVERSPEED');
    var penalty = detailValue('penalties'), damage = detailValue('damage');
    if (telemetrySwitch(detailValue('penaltyActive')) === true) warnings.push('PENALTY: ' + text(penalty));
    if (telemetrySwitch(detailValue('damageActive')) === true) warnings.push('DAMAGE: ' + text(damage));
    return warnings.length ? warnings.join(' / ') : 'WARNINGS / CHECK GAME';
  }
function profile() {
  var defaults = gaugeProfiles.defaults[mode()] || gaugeProfiles.defaults.race;
  var id = String(data('CarId') || '').toLowerCase();
  var selected = {};
  for (var key in defaults) selected[key] = defaults[key];
  for (var i = 0; i < gaugeProfiles.cars.length; i++) {
    var entry = gaugeProfiles.cars[i];
    if (entry.game.toLowerCase().replace(/[^a-z0-9]/g, '') === game() && entry.carId.toLowerCase() === id) {
      for (var field in entry) selected[field] = entry[field];
      break;
    }
  }
  return selected;
}
function reportedRpmMax() {
  var values = [data('MaxRpm'), data('CarSettings_MaxRPM')];
  for (var i = 0; i < values.length; i++) {
    var n = number(values[i]);
    if (n !== null && n >= 500 && n <= 30000) return n;
  }
  return null;
}
function rpmMax() { return profile().rpmMax || reportedRpmMax() || profile().rpmFallback; }
function rpmScale() {
  var step = rpmMax() <= 4000 ? 500 : 1000;
  return Math.ceil(rpmMax() / step) * step / 1000;
}
function rpmSource() { return profile().rpmMax ? 'OVERRIDE' : reportedRpmMax() === null ? 'PROFILE' : 'LIVE LIMIT'; }
function speedMaximum() { return profile().speedKmh; }
function speedStep() {
  var max = speedMaximum();
  return max <= 120 ? 10 : max <= 240 ? 20 : max <= 400 ? 40 : 50;
}
function speedValue() {
  var n = number(data('SpeedKmh'));
  return n === null || n < 0 ? null : n;
}
function needleValue(n, max) { n = number(n); return n === null ? 0 : Math.max(0, Math.min(max, n)); }
function coordinatesAvailable() {
  return live() && flag(data('MapAllowed')) && number(data('CarCoordinates01')) !== null && number(data('CarCoordinates03')) !== null;
}
function classAvailable() {
  var name = String(data('CarClass') || '').replace(/^\\s+|\\s+$/g, '');
  var count = number(data('PlayerClassOpponentsCount'));
  return live() && name !== '' && !/^(unknown(?:\\s+class)?|undefined|null|n\\/?a|--)$/i.test(name) && count !== null && count > 0;
}
function gridCount() {
  var n = number(data('OpponentsCount'));
  return live() && n !== null && n > 0 ? Math.floor(n) : 0;
}
function gridPage() { return Math.floor(new Date().getTime() / 10000) % Math.max(1, Math.ceil(gridCount() / 20)); }
function gridPosition(slot) { return gridPage() * 20 + slot + 1; }
function gridHeading() {
  return gridCount() ? 'OVERALL / ' + (gridPage() + 1) + ' OF ' + Math.ceil(gridCount() / 20) + ' / AUTO 10s' : 'OVERALL / NO STANDINGS DATA';
}
function awarenessStatus() {
  if (!coordinatesAvailable()) return 'POSITION DATA UNAVAILABLE';
  return 'NO DOTS? CHECK DATA / MAP - NOT ALL-CLEAR';
}
function musicPage() {
  var g = game();
  return live() && (g === 'assettocorsa' || g === 'ac');
}
function media(field) {
  var value = read('SystemInfosProvider.' + field);
  return value === null || value === undefined ? '' : String(value).replace(/^\\s+|\\s+$/g, '');
}
function mediaTitle() { return media('Title') || 'NO ACTIVE MEDIA'; }
function mediaArtist() { return media('Title') ? (media('Artist') || 'Windows media session') : 'Open Spotify or a compatible player on this PC'; }
function metric(value, decimals, suffix) {
  var n = number(value);
  return n === null ? '--' : n.toFixed(decimals || 0) + (suffix || '');
}
function positive(value, decimals, suffix) {
  var n = number(value);
  return n === null || n <= 0 ? '--' : metric(n, decimals, suffix);
}
function tyreLife(key) {
  var n = number(data('TyreWear' + key));
  return n === null || n < 0 || n > 100 ? '--' : metric(n, 1, '%');
}
function carSetting(key) {
  if (!live()) return '--';
  var source = key === 'TractionControlCut' ? profile().tcCutProperty : null;
  var n = number(source ? read(source) : data(key));
  if (n === null || n < 0) return '--';
  if (key === 'BrakeBias') return n > 100 ? '--' : metric(n, 1, '%');
  return Math.floor(n) !== n ? '--' : metric(n);
}
function weatherTemperature(key) {
  return live() ? metric(data(key), 1, ' C') : '--';
}
function windSpeedMs() {
  if (!live()) return null;
  var source = profile().windSpeedMsProperty;
  var value = source ? read(source) :
    (game() === 'ams2' || game() === 'automobilista2') ? read('DataCorePlugin.GameRawData.mWindSpeed') : null;
  var n = number(value);
  return n === null || n < 0 ? null : n;
}
function windSpeed() {
  var n = windSpeedMs();
  return n === null ? '--' : metric(n * 3.6, 1, ' km/h');
}
function mappedBearing(key) {
  if (!live()) return null;
  var source = profile()[key], n = source ? number(read(source)) : null;
  return n === null || n < 0 || n > 360 ? null : n % 360;
}
function windCompass() {
  if (windSpeedMs() === 0) return 'CALM';
  var bearing = mappedBearing('windFromDegreesProperty');
  if (bearing === null) return 'FROM --';
  var compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return 'FROM ' + compass[Math.floor((bearing + 22.5) / 45) % 8] + ' ' + (Math.round(bearing) % 360) + ' deg';
}
function windRelative() {
  if (windSpeedMs() === 0) return 'CALM';
  var bearing = mappedBearing('windFromDegreesProperty'), heading = mappedBearing('headingDegreesProperty');
  if (bearing === null || heading === null) return 'CAR --';
  var angle = (bearing - heading + 360) % 360;
  var sectors = ['HEADWIND', 'HEAD / RIGHT', 'RIGHT CROSS', 'TAIL / RIGHT',
    'TAILWIND', 'TAIL / LEFT', 'LEFT CROSS', 'HEAD / LEFT'];
  return sectors[Math.floor((angle + 22.5) / 45) % 8];
}
function text(value) { return value === null || value === undefined || value === '' ? '--' : String(value); }
function gear() {
  var v = data('Gear');
  if (v === null || v === undefined || v === '') return '--';
  if (String(v) === '0') return 'N';
  if (String(v) === '-1') return 'R';
  return String(v).toUpperCase();
}
function lapTime(value) {
  if (value === null || value === undefined || value === '') return '--:--.---';
  var s = String(value);
  var m = /^(?:(\\d+)\\.)?(\\d+):(\\d{2}):(\\d{2})(?:\\.(\\d+))?$/.exec(s);
  if (!m) return '--:--.---';
  var minutes = Number(m[1] || 0) * 1440 + Number(m[2]) * 60 + Number(m[3]);
  var seconds = Number(m[4]);
  if (seconds > 59 || Number(m[3]) > 59) return '--:--.---';
  var fraction = ((m[5] || '') + '000').slice(0, 3);
  if (minutes === 0 && seconds === 0 && Number(fraction) === 0) return '--:--.---';
  return minutes + ':' + ('0' + seconds).slice(-2) + '.' + fraction;
}
function delta() {
  var n = number(read('DataCorePlugin.Computed.DeltaBest'));
  return n === null ? '--.---' : (n >= 0 ? '+' : '') + n.toFixed(3);
}
function deltaColor() {
  var n = number(read('DataCorePlugin.Computed.DeltaBest'));
  return n === null ? '#FFB07840' : n <= 0 ? '#FF78A34D' : '#FFFF3B24';
}
function rpmRatio() {
  var rpm = number(data('Rpms'));
  return rpm === null || rpm < 0 ? null : Math.max(0, Math.min(1, rpm / rpmMax()));
}
function fuelPercent() {
  var fuel = number(data('Fuel')), max = number(data('MaxFuel'));
  return fuel === null || fuel < 0 || max === null || max <= 0 ? null : Math.max(0, Math.min(100, fuel / max * 100));
}
function lowFuel() {
  var fuel = fuelPercent();
  return live() && fuel !== null && fuel < 10;
}
function fuelColor() {
  return lowFuel() && new Date().getTime() % 1000 < 500 ? '#FFFF0000' : '#FFFFB02E';
}
function speedUnit() { return 'KM/H'; }
function telemetrySwitch(value) {
  if (flag(value)) return true;
  if (value === false || value === 0 || value === 'False' || value === 'false' || value === '0') return false;
  return null;
}
function pitLimiterText() {
  var enabled = live() ? telemetrySwitch(data('PitLimiterOn')) : null;
  return 'PIT LIMITER / ' + (enabled === null ? '--' : enabled ? 'ON' : 'OFF');
}
function pitLimiterColor() {
  return live() && telemetrySwitch(data('PitLimiterOn')) === true ? '#FFFFB02E' : '#FFB07840';
}
function trackFlags() {
  if (!live() || mode() !== 'race') return [];
  var result = [], name = String(data('Flag_Name') || '').toUpperCase().replace(/^\\s+|\\s+$/g, '');
  if (name === 'RED') result.push('RED');
  var names = ['Black', 'Orange', 'Checkered', 'Yellow', 'Blue', 'White', 'Green'];
  for (var i = 0; i < names.length; i++) {
    if (telemetrySwitch(data('Flag_' + names[i])) === true) result.push(names[i].toUpperCase());
  }
  return result;
}
function trackFlagText() {
  var flags = trackFlags();
  return flags.length ? 'FLAG / ' + flags[0] + (flags.length > 1 ? ' +' + (flags.length - 1) : '') : 'FLAG / --';
}
function trackFlagColor() {
  var name = trackFlags()[0];
  return name === 'RED' || name === 'BLACK' ? '#FFFF3B24' :
    name === 'YELLOW' ? '#FFFFCC32' : name === 'BLUE' ? '#FF639BDD' :
    name === 'GREEN' ? '#FF78A34D' : name === 'WHITE' || name === 'CHECKERED' ? '#FFD6C9AE' :
    name === 'ORANGE' ? '#FFFF8A1C' : '#FFB07840';
}
function status() {
  if (!running()) return 'WAITING FOR GAME';
  if (mode() === 'unsupported') return 'UNSUPPORTED GAME';
  if (flag(read('DataCorePlugin.GamePaused'))) return 'PAUSED';
  if (flag(data('IsInPitLane'))) return 'PIT LANE';
  if (lowFuel()) return 'LOW FUEL';
  var r = rpmRatio();
  if (r !== null && r >= 0.95) return 'SHIFT';
  return mode() === 'rally' ? 'RALLY TELEMETRY' : 'LIVE TELEMETRY';
}
function statusColor() {
  var s = status();
  return s === 'SHIFT' || s === 'LOW FUEL' ? '#FFFF3B24' :
    s === 'PIT LIMITER' || s === 'PIT LANE' || s === 'PAUSED' ? '#FFFFB02E' : '#FFFF8A1C';
}
`;

const helperFunctions = new Map([...helpers.matchAll(/^function (\w+)\(/gm)].map((match, index, matches) =>
  [match[1], helpers.slice(match.index, matches[index + 1]?.index ?? helpers.length).trim()]));

export function formula(expression, config = profiles) {
  const required = new Set();
  function include(source) {
    for (const [name, body] of helperFunctions) {
      if (!required.has(name) && new RegExp(`\\b${name}\\s*\\(`).test(source)) {
        required.add(name);
        include(body);
      }
    }
  }
  include(expression);
  const definitions = [...helperFunctions].filter(([name]) => required.has(name)).map(([, body]) => body).join('\n');
  const configSource = required.has('profile') ? 'var gaugeProfiles = ' + JSON.stringify(config) + ';\n' : '';
  return { JSExt: 0, Interpreter: 1, Expression: configSource + definitions + '\n' + expression };
}

export function binding(expression) {
  return { Formula: formula(expression), Mode: 2 };
}
