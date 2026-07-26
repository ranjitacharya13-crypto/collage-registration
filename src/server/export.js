// Spreadsheet exports for organisers.
//
// buildXlsx writes a real .xlsx file with no third-party dependency: an xlsx
// is a ZIP of XML parts, and we emit a minimal valid workbook. Excel, LibreOffice
//, Numbers and Google Sheets all open it, and unlike CSV it keeps phone numbers
// as text (so 09... does not lose its leading zero) and needs no import dialog.

import { deflateRawSync, crc32 } from 'node:zlib';

export const COLUMNS = [
  ['#', row => row.index],
  ['Event', row => row.event],
  ['Option', row => row.choice || ''],
  ['Team name', row => row.teamName || ''],
  ['Participant 1', row => row.name],
  ['P1 department', row => row.department],
  ['P1 year', row => row.year],
  ['Participant 2', row => row.partnerName || ''],
  ['P2 department', row => row.partnerDepartment || ''],
  ['P2 year', row => row.partnerYear || ''],
  ['Phone', row => row.phone],
  ['Email', row => row.email],
  ['Registered at', row => new Date(row.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
];

const escapeCsv = value => `"${String(value ?? '').replaceAll('"', '""')}"`;

export function buildCsv(rows) {
  const header = COLUMNS.map(([title]) => escapeCsv(title)).join(',');
  const body = rows.map((row, index) =>
    COLUMNS.map(([, read]) => escapeCsv(read({ ...row, index: index + 1 }))).join(','));
  // BOM so Excel opens UTF-8 names correctly on Windows.
  return `\uFEFF${[header, ...body].join('\r\n')}`;
}

const xmlEscape = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;')
  // Strip control characters that would make the XML invalid.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function columnName(index) {
  let name = '';
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(rows) {
  const headerCells = COLUMNS.map(([title], i) =>
    `<c r="${columnName(i + 1)}1" t="inlineStr" s="1"><is><t>${xmlEscape(title)}</t></is></c>`).join('');

  const bodyRows = rows.map((row, rowIndex) => {
    const cells = COLUMNS.map(([, read], colIndex) => {
      const raw = read({ ...row, index: rowIndex + 1 });
      const ref = `${columnName(colIndex + 1)}${rowIndex + 2}`;
      // Keep everything except the row number as text: phone numbers and years
      // must not be reformatted by the spreadsheet.
      if (colIndex === 0) return `<c r="${ref}"><v>${rowIndex + 1}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(raw)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 2}">${cells}</row>`;
  }).join('');

  const lastColumn = columnName(COLUMNS.length);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${COLUMNS.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 5 : 20}" customWidth="1"/>`).join('')}</cols>
<sheetData><row r="1">${headerCells}</row>${bodyRows}</sheetData>
<autoFilter ref="A1:${lastColumn}${rows.length + 1}"/>
</worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Registrations" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF12283F"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`;

/** Minimal ZIP writer (deflate + central directory) so xlsx needs no dependency. */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);           // deflate
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    chunks.push(local, nameBuffer, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuffer.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

export function buildXlsx(rows) {
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', WORKBOOK],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheetXml(rows)],
  ]);
}

export const exportFilename = extension =>
  `aura-2026-registrations-${new Date().toISOString().slice(0, 10)}.${extension}`;
