const encoder = new TextEncoder();
const crcTable = new Uint32Array(256);

for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

const crc32 = (bytes) => {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
};

const write16 = (view, offset, value) => view.setUint16(offset, value, true);
const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);

const safeZipName = (name, index) => {
  const safeParts = String(name || `file-${index + 1}.txt`)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..' && !part.includes('\0'));
  return safeParts.length ? safeParts.join('/') : `file-${index + 1}.txt`;
};

export const createRoomZip = (files) => {
  if (!Array.isArray(files) || files.length === 0) throw new Error('There are no room files to export.');
  if (files.length > 0xffff) throw new Error('This room contains too many files to export.');

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralSize = 0;

  files.forEach((file, index) => {
    const nameBytes = encoder.encode(safeZipName(file?.name, index));
    const dataBytes = encoder.encode(typeof file?.code === 'string' ? file.code : '');
    if (nameBytes.length > 0xffff || dataBytes.length > 0xffffffff) {
      throw new Error(`"${file?.name || `file ${index + 1}`}" is too large to export.`);
    }
    const checksum = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, 0x0021);
    write32(localView, 14, checksum);
    write32(localView, 18, dataBytes.length);
    write32(localView, 22, dataBytes.length);
    write16(localView, 26, nameBytes.length);
    write16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write16(centralView, 12, 0);
    write16(centralView, 14, 0x0021);
    write32(centralView, 16, checksum);
    write32(centralView, 20, dataBytes.length);
    write32(centralView, 24, dataBytes.length);
    write16(centralView, 28, nameBytes.length);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + dataBytes.length;
    centralSize += centralHeader.length;
  });

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, localOffset);
  write16(endView, 20, 0);

  return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' });
};

export const downloadRoomZip = (files, roomId) => {
  const blob = createRoomZip(files);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `codecollab-${String(roomId || 'room').replace(/[^a-z0-9_-]/gi, '-')}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
