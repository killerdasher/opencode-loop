/**
 * Transcript and git-diff evidence extraction for the LOOP behavioral harness.
 *
 * Kept separate from run-case.mjs so the free self-test can exercise these
 * parsers directly with synthetic input (regression tests for every parsing
 * defect found during the Case A pilot).
 *
 * Event shapes are taken from observed `opencode run --format json` output
 * (OpenCode v2.2.5), not from assumption:
 *   {type:'text',        part:{type:'text', text, messageID}}
 *   {type:'tool_use',    part:{type:'tool', toolName, state:{status, input}}}
 *   {type:'step_start' | 'step_finish', part:{type:'step-start'|'step-finish'}}
 *
 * Timeline event kinds:
 *   'bash'  a shell command was executed
 *   'write' a file-modifying tool ran (edit/write/patch/...)
 *   'text'  an assistant text block
 *   'obs'   a non-mutating observation (read/glob/skill/unknown tool)
 *
 * Defensive rules:
 *   - unknown event shapes are counted and surfaced, never silently dropped
 *   - a tool is only a 'write' when its NAME says so; a file argument alone
 *     does not prove mutation (reads carry `path` too)
 *   - tool events still in 'running'/'pending' state are skipped so a
 *     running+completed pair cannot double-count one execution
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const STEP_TYPES = new Set(['step_start', 'step_finish', 'step_streamed']);
const RUNNING_STATUS = /running|pending|progress/i;

const WRITE_NAME = /write|edit|patch|create|str_replace|apply_patch|delete|remove|move/i;
const BASH_NAME = /bash|shell|exec|run_command|terminal|powershell|cmd/i;
const OBSERVATION_NAME = /^(read|glob|grep|list|ls|skill|task|webfetch|websearch|question|todoread|todowrite|view|search|find|think)$/i;

/**
 * Parse the NDJSON transcript of an `opencode run --format json` invocation.
 * @param {string} ndjson
 * @returns {{timeline: Array<{kind:string,value:string}>, bashCommands: string[],
 *           fileWrites: string[], allText: string, finalText: string,
 *           firstWriteIndex: number, iterationBanners: number,
 *           skillLoadObserved: boolean, sessionID: string|null,
 *           eventCount: number, unknownEventTypes: string[]}}
 */
export function parseTranscript(ndjson) {
  const timeline = [];
  const texts = []; // {messageID, text}
  const unknownTypes = new Set();
  let sessionID = null;
  let eventCount = 0;

  for (const line of String(ndjson).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let e;
    try { e = JSON.parse(trimmed); } catch { continue; }
    eventCount += 1;
    if (!sessionID && e.sessionID) sessionID = e.sessionID;
    const type = String(e.type || '');
    const part = e.part && typeof e.part === 'object' ? e.part : {};
    const partType = String(part.type || '');

    if (type === 'text' || partType === 'text') {
      if (typeof part.text === 'string' && part.text.length > 0) {
        timeline.push({ kind: 'text', value: part.text });
        texts.push({ messageID: part.messageID || '', text: part.text });
      }
      continue;
    }

    const looksTool = type.includes('tool') || partType.includes('tool');
    if (looksTool) {
      const toolName = String(part.toolName || part.name || part.tool || partType || type);
      const status = part.state && part.state.status ? String(part.state.status) : '';
      if (RUNNING_STATUS.test(status)) continue; // completed event will follow

      const input = part.input || (part.state && part.state.input) || part.arguments || {};
      const command = input && typeof input.command === 'string' ? input.command : null;
      const file = input && typeof input === 'object'
        ? (input.filePath || input.path || input.file || input.filename || input.notebookPath || null)
        : null;

      if (BASH_NAME.test(toolName) || (command && !OBSERVATION_NAME.test(toolName))) {
        timeline.push({ kind: 'bash', value: command || toolName });
      } else if (WRITE_NAME.test(toolName) && file) {
        timeline.push({ kind: 'write', value: String(file) });
      } else if (OBSERVATION_NAME.test(toolName) || (!command && !file)) {
        timeline.push({ kind: 'obs', value: toolName });
      } else {
        // Unknown tool carrying a file: mutation status is unknowable from
        // the name - record it as an observation and surface it for review
        // rather than guessing (a guessed write would corrupt ordering).
        timeline.push({ kind: 'obs', value: toolName });
        unknownTypes.add(`tool:${toolName}`);
      }
      continue;
    }

    if (type && !STEP_TYPES.has(type)) unknownTypes.add(type);
  }

  // Final report = the text blocks of the last message that produced text.
  let finalText = '';
  if (texts.length > 0) {
    const lastMessageID = texts[texts.length - 1].messageID;
    finalText = texts
      .filter((t) => !lastMessageID || t.messageID === lastMessageID)
      .map((t) => t.text)
      .join('\n');
    if (!finalText) finalText = texts[texts.length - 1].text;
  }
  const allText = texts.map((t) => t.text).join('\n');
  const full = String(ndjson);

  return {
    timeline,
    bashCommands: timeline.filter((e) => e.kind === 'bash').map((e) => e.value),
    fileWrites: timeline.filter((e) => e.kind === 'write').map((e) => e.value),
    allText,
    finalText,
    firstWriteIndex: timeline.findIndex((e) => e.kind === 'write'),
    iterationBanners: (full.match(/LOOP \| ITERATION/g) || []).length,
    skillLoadObserved: /loop-engine|STAGE [0-8]/.test(allText),
    sessionID,
    eventCount,
    unknownEventTypes: [...unknownTypes],
  };
}

/**
 * List files changed relative to the fixture baseline (modified + untracked).
 *
 * Reads `git status --porcelain` WITHOUT trimming: trimming the whole output
 * destroys the leading space of the first line (" M path" -> "M path"), which
 * shifts the fixed 3-character status prefix and fabricates paths like
 * "rc/range.mjs" from "src/range.mjs" (Case A pilot defect).
 *
 * @param {string} fixtureDir
 * @returns {string[]} sorted relative paths
 */
export function collectDiffFiles(fixtureDir) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', 'status', '--porcelain'], {
    cwd: fixtureDir,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error) throw new Error(`git status failed: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git status exited ${r.status}: ${(r.stderr || '').trim()}`);

  const files = new Set();
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    // "XY path" (2 status chars + space) or "?? path";
    // rename lines carry "-> new"; keep the new name for scope checks.
    let p = line.slice(3);
    const arrow = p.indexOf(' -> ');
    if (arrow !== -1) p = p.slice(arrow + 4);
    p = p.trim().replace(/^"|"$/g, '');
    if (p) files.add(p);
  }
  return [...files].sort();
}
