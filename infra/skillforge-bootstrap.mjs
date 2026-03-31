#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_PROMPT_PATH = '/opt/skillforge/skillforge-prompt.md';

export function loadSkillForgePrompt(promptPath = DEFAULT_PROMPT_PATH) {
  const prompt = readFileSync(promptPath, 'utf8').trim();
  if (!prompt) {
    throw new Error(`SkillForge system prompt is empty at ${promptPath}`);
  }
  return prompt;
}

export function startSkillForgeBootstrap() {
  const promptPath = process.env['SKILLFORGE_SYSTEM_PROMPT_PATH'] ?? DEFAULT_PROMPT_PATH;
  const prompt = loadSkillForgePrompt(promptPath);

  console.log(`SkillForge container ready (system prompt loaded from ${promptPath}; ${prompt.length} chars)`);
  process.stdin.resume();

  return {
    promptPath,
    promptLength: prompt.length,
  };
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  startSkillForgeBootstrap();
}