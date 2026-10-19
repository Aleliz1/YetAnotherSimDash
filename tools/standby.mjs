import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name, bytes) {
  const type = Buffer.from(name);
  const header = Buffer.alloc(4), crc = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([header, type, bytes, crc]);
}

function ribbon(phase) {
  const width = 1024, height = 256;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const center = 128 + 46 * Math.sin(u * Math.PI * 2 + phase) + 19 * Math.sin(u * Math.PI * 3);
      const distance = y - center;
      const edge = Math.pow(Math.sin(Math.PI * u), 0.7);
      const glow = 38 * Math.exp(-distance * distance / 600);
      const core = 105 * Math.exp(-distance * distance / 5);
      const veil = distance > 0 ? 22 * Math.exp(-distance / 28) : 0;
      const index = y * (width * 4 + 1) + 1 + x * 4;
      pixels[index] = 255;
      pixels[index + 1] = phase ? 112 : 156;
      pixels[index + 2] = phase ? 20 : 40;
      pixels[index + 3] = Math.round((glow + core + veil) * edge);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return {
    width, height,
    bytes: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]),
  };
}

function led(color, dim = false) {
  const width = 64, height = 64, center = (width - 1) / 2, radius = 20;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x - center, y - center);
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance));
      const glow = Math.exp(-Math.pow(Math.max(0, distance - radius), 2) / 32);
      const alpha = dim ? coverage * 90 : coverage * 255 + glow * 54;
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = Math.round(Math.min(255, alpha));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return {
    width, height,
    bytes: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]),
  };
}

function gaugeHub() {
  const width = 64, height = 64, center = (width - 1) / 2;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x - center, y - center);
      const outer = Math.max(0, Math.min(1, 25 - distance));
      const inner = Math.max(0, Math.min(1, 22 - distance));
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      if (distance <= 22) {
        const highlight = Math.max(0, 1 - Math.hypot(x - 25, y - 22) / 26);
        pixels[offset] = Math.round(15 + highlight * 18);
        pixels[offset + 1] = Math.round(20 + highlight * 20);
        pixels[offset + 2] = Math.round(22 + highlight * 21);
        pixels[offset + 3] = Math.round(inner * 255);
      } else {
        pixels[offset] = 185;
        pixels[offset + 1] = 189;
        pixels[offset + 2] = 180;
        pixels[offset + 3] = Math.round(outer * 220);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  const name = 'Y.A.S.S RPM center hub';
  return { name, bytes, metadata: { Name: name, Extension: '.png', Width: width, Height: height,
    Length: bytes.length, MD5: createHash('md5').update(bytes).digest('hex'), Modified: false, Optimized: true } };
}

export const standbyImages = [0, 1.8].map((phase, index) => {
  const { bytes, width, height } = ribbon(phase);
  const name = `Y.A.S.S ribbon ${index + 1}`;
  return {
    name, bytes,
    metadata: { Name: name, Extension: '.png', Width: width, Height: height,
      Length: bytes.length, MD5: createHash('md5').update(bytes).digest('hex'), Modified: false, Optimized: true },
  };
});

export const shiftLightImages = [
  ['Y.A.S.S RPM LED off', [110, 49, 9], true],
  ['Y.A.S.S RPM LED amber', [255, 176, 46], false],
  ['Y.A.S.S RPM LED red', [255, 59, 36], false],
].map(([name, color, dim]) => {
  const { bytes, width, height } = led(color, dim);
  return {
    name, bytes,
    metadata: { Name: name, Extension: '.png', Width: width, Height: height,
      Length: bytes.length, MD5: createHash('md5').update(bytes).digest('hex'), Modified: false, Optimized: true },
  };
});

export const gaugeHubImage = gaugeHub();
export const dashboardImages = [...standbyImages, ...shiftLightImages, gaugeHubImage];

// SimHub stores named PNG resources in a ZIP sidecar with the .ressources suffix.
export function standbyResources() {
  const local = [], central = [];
  let offset = 0;
  for (const image of dashboardImages) {
    const name = Buffer.from(image.name + '.png'), bytes = image.bytes, crc = crc32(bytes);
    const entry = Buffer.alloc(30);
    entry.writeUInt32LE(0x04034b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(33, 12);
    entry.writeUInt32LE(crc, 14);
    entry.writeUInt32LE(bytes.length, 18);
    entry.writeUInt32LE(bytes.length, 22);
    entry.writeUInt16LE(name.length, 26);
    local.push(entry, name, bytes);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(bytes.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += entry.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(dashboardImages.length, 8);
  end.writeUInt16LE(dashboardImages.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
