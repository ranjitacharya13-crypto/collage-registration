#!/usr/bin/env node
// One-shot export from the command line:  npm run export -- [xlsx|csv]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { allRegistrations, closeDatabase, STORAGE } from '../src/server/store.js';
import { buildXlsx, buildCsv, exportFilename } from '../src/server/export.js';

const format = (process.argv[2] || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
const dir = process.env.EXPORT_DIR || join(process.cwd(), 'exports');
mkdirSync(dir, { recursive: true });

const rows = await allRegistrations();
const path = join(dir, exportFilename(format));
writeFileSync(path, format === 'csv' ? buildCsv(rows) : buildXlsx(rows));
console.log(`Exported ${rows.length} registration(s) from ${STORAGE} to ${path}`);
closeDatabase();
