import { deflateRawSync } from "node:zlib";

export interface SpreadsheetSheet { name: string; headers: readonly string[]; rows: ReadonlyArray<ReadonlyArray<string | number | null>>; moneyColumns?: readonly number[] }
const MAX_ROWS = 5_000, MAX_BYTES = 16 * 1024 * 1024;
function xml(value: string): string {
  const clean = Array.from(value.slice(0, 32767)).filter(ch => { const n = ch.codePointAt(0)!; return n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff); }).join("");
  return clean.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!);
}
function column(index: number): string { let name = "", n = index + 1; while (n) { name = String.fromCharCode(65 + (n - 1) % 26) + name; n = Math.floor((n - 1) / 26); } return name; }
/** Text stays an inline string, including strings beginning with spreadsheet formula characters. */
function worksheet(sheet: SpreadsheetSheet): string {
  if (!sheet.headers.length || sheet.headers.length > 50 || sheet.rows.length > MAX_ROWS || sheet.rows.some(row => row.length !== sheet.headers.length)) throw new Error("Spreadsheet row or column limit exceeded. Export one Melbourne day instead.");
  const rows = [sheet.headers, ...sheet.rows].map((row, i) => `<row r="${i + 1}">${row.map((value, j) => {
    const ref = `${column(j)}${i + 1}`;
    if (typeof value === "number") { if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error("Invalid spreadsheet amount."); return `<c r="${ref}" s="${sheet.moneyColumns?.includes(j) ? 2 : 0}"><v>${value}</v></c>`; }
    return `<c r="${ref}" s="${i === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value ?? "")}</t></is></c>`;
  }).join("")}</row>`).join("");
  const last = `${column(sheet.headers.length - 1)}${sheet.rows.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${sheet.headers.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 29 : 24}" customWidth="1"/>`).join("")}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let value = n; for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
function crc32(bytes: Buffer) { let value = 0xffffffff; for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255]! ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
/** Fixed OOXML paths only. This ZIP writer accepts no caller-supplied filesystem paths. */
function archive(files: Record<string, string>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0, total = 0;
  const entries = Object.entries(files);
  if (entries.length < 6 || entries.length > 9) throw new Error("Invalid workbook manifest.");
  for (const [path, content] of entries) {
    if (!/^(?:\[Content_Types\]\.xml|_rels\/\.rels|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/styles\.xml|xl\/worksheets\/sheet[1-3]\.xml)$/.test(path)) throw new Error("Invalid workbook manifest.");
    const name = Buffer.from(path), bytes = Buffer.from(content); total += bytes.length;
    if (bytes.length > 8 * 1024 * 1024 || total > MAX_BYTES) throw new Error("Spreadsheet exceeds the export limit. Export one Melbourne day instead.");
    const compressed = deflateRawSync(bytes), crc = crc32(bytes), header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10); dir.writeUInt16LE(33, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(compressed.length, 20); dir.writeUInt32LE(bytes.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name); offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function createPricingWorkbook(sheets: readonly SpreadsheetSheet[]): Buffer {
  if (sheets.length < 2 || sheets.length > 3 || sheets.some(s => !/^[A-Za-z ]{1,31}$/.test(s.name))) throw new Error("Invalid workbook sheets.");
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;A$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  };
  sheets.forEach((sheet, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = worksheet(sheet); });
  return archive(files);
}
export function createPricingCsv(sheet: SpreadsheetSheet): string {
  if (sheet.rows.length > MAX_ROWS) throw new Error("Spreadsheet row limit exceeded. Export one Melbourne day instead.");
  const escape = (value: string | number | null) => {
    let text = value === null ? "" : String(value);
    if (typeof value !== "number" && /^[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff]*[=+\-@]/u.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const result = "\ufeff" + [sheet.headers, ...sheet.rows].map(row => row.map(escape).join(",")).join("\r\n") + "\r\n";
  if (Buffer.byteLength(result) > MAX_BYTES) throw new Error("Spreadsheet exceeds the export limit. Export one Melbourne day instead.");
  return result;
}
