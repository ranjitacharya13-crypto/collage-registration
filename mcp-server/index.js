#!/usr/bin/env node
import readline from 'node:readline';
import { execute } from './tools/index.js';

const tools = [
  ['chat', 'Ask the configured local Ollama model a question.', { prompt: { type: 'string' } }],
  ['list_registrations', 'View the registration list with optional search and pagination.', { query: { type: 'string' }, page: { type: 'number' }, pageSize: { type: 'number' } }],
  ['export_excel', 'Write the full registration list to an Excel (.xlsx) or CSV file and return its path.', { format: { type: 'string', enum: ['xlsx', 'csv'] } }],
  ['database_query', 'Read registrations and registration statistics.', { query: { type: 'string', enum: ['registrations', 'statistics'] } }],
  ['event_management', 'Return the symposium schedule and event catalogue.', {}],
  ['registration_validation', 'Validate registration data without saving it.', { registration: { type: 'object' } }],
  ['analytics', 'Return registration analytics.', {}],
  ['live_dashboard', 'Return current live dashboard data.', {}],
  ['admin_commands', 'Execute a safe read-only admin command.', { command: { type: 'string', enum: ['health', 'report'] } }],
  ['report_generation', 'Generate a live registration report.', {}],
  ['search', 'Search registrations by name, email, phone, team or event.', { query: { type: 'string' } }],
  ['image_understanding', 'Future-ready image analysis placeholder.', { image: { type: 'string', description: 'Base64 image or local path' } }]
].map(([name, description, properties]) => ({ name, description, inputSchema: { type: 'object', properties, additionalProperties: false } }));
const reply = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async line => {
  try {
    const request = JSON.parse(line); let result;
    if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'aura-local-mcp', version: '1.0.0' } };
    else if (request.method === 'tools/list') result = { tools };
    else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify(await execute(request.params?.name, request.params?.arguments || {}), null, 2) }] };
    else throw new Error('Method not found');
    reply({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) { reply({ jsonrpc: '2.0', id: null, error: { code: -32000, message: error.message } }); }
});
