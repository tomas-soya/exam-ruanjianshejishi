'use strict';

// ZIP STORE records need no dependencies or temporary files. UTF-8 names work in
// Explorer and common unzip tools; limits deliberately stay well below ZIP64.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function createTaskZip(files) {
  const chunks = [], directory = [];
  let offset = 0;
  for (const [name, value] of files) {
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('不安全的任务包文件名');
    const filename = Buffer.from(name, 'utf8');
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    if (filename.length > 65535 || files.size > 65535 || offset + bytes.length > 64 * 1024 * 1024) {
      throw Object.assign(new Error('任务包超过 64 MB，请缩小练习范围'), { statusCode: 413 });
    }
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    chunks.push(header, filename, bytes); directory.push(central, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.reduce((n, b) => n + b.length, 0), 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...directory, end]);
}
module.exports = { createTaskZip };
