// Mapping units are explicit: no cross-game enum, ratio or energy-budget guessing.
export const detailPages = [
  { name: 'Strategy', fields: [
    ['fuelLaps', 'FUEL LAPS LEFT', 'laps'], ['fuelToFinish', 'FUEL TO FINISH', 'litres'],
    ['fuelToAdd', 'FUEL TO ADD', 'litres'], ['fuelPerLap', 'CONSUMPTION / LAP', 'litres'],
    ['sessionSeconds', 'SESSION LEFT', 'seconds'], ['sessionLaps', 'LAPS LEFT', 'count'],
    ['sector1Seconds', 'SECTOR 1', 'seconds'], ['sector2Seconds', 'SECTOR 2', 'seconds'],
    ['sector3Seconds', 'SECTOR 3', 'seconds'], ['pitLimitKmh', 'PIT LIMIT', 'speed'],
    ['pitRequested', 'PIT REQUEST', 'switch'], ['plannedService', 'PLANNED SERVICE', 'text'],
  ] },
  { name: 'Vehicle', fields: [
    ['pressureFL', 'FL PRESSURE', 'pressure', 'TyrePressureFrontLeft'],
    ['pressureFR', 'FR PRESSURE', 'pressure', 'TyrePressureFrontRight'],
    ['pressureRL', 'RL PRESSURE', 'pressure', 'TyrePressureRearLeft'],
    ['pressureRR', 'RR PRESSURE', 'pressure', 'TyrePressureRearRight'],
    ['compound', 'TYRE COMPOUND', 'text'], ['absActive', 'ABS INTERVENTION', 'switch'],
    ['tcActive', 'TC INTERVENTION', 'switch'], ['damage', 'DAMAGE STATUS', 'text'],
    ['brakeFL', 'FL BRAKE TEMP', 'temperature'], ['brakeFR', 'FR BRAKE TEMP', 'temperature'],
    ['brakeRL', 'RL BRAKE TEMP', 'temperature'], ['brakeRR', 'RR BRAKE TEMP', 'temperature'],
    ['drsAvailable', 'DRS AVAILABLE', 'switch'], ['drsActive', 'DRS ACTIVE', 'switch'],
    ['turboBar', 'TURBO BOOST', 'bar'], ['transmission', 'TRANSMISSION', 'text'],
    ['damageActive', 'DAMAGE WARNING', 'switch'],
  ] },
  { name: 'Game', fields: [
    ['p2pAvailable', 'P2P AVAILABLE', 'switch'], ['p2pCooldownSeconds', 'P2P COOLDOWN', 'seconds'],
    ['p2pSeconds', 'P2P TIME LEFT', 'seconds'], ['stintSeconds', 'STINT ELAPSED', 'seconds'],
    ['tyreLaps', 'LAPS ON TYRES', 'count'], ['fuelStintLaps', 'FUEL STINT LAPS', 'count'],
    ['virtualEnergyPercent', 'VIRTUAL ENERGY', 'percent'], ['virtualEnergyMj', 'STINT ENERGY LEFT', 'energy'],
    ['raceControl', 'FCY / SAFETY CAR', 'text'], ['penalties', 'PENALTIES', 'text'],
    ['stageSeconds', 'STAGE ELAPSED', 'seconds'], ['stageProgressPercent', 'STAGE PROGRESS', 'percent'],
    ['stageDistanceKm', 'STAGE DISTANCE LEFT', 'distance'], ['stageSplitSeconds', 'CHECKPOINT DELTA', 'delta'],
    ['stageResult', 'STAGE RESULT', 'text'], ['penaltyActive', 'PENALTY ACTIVE', 'switch'],
  ] },
];

export const detailFields = detailPages.flatMap(page => page.fields);
