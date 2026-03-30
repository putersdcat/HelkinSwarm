import { toolRegistry } from '../tools/toolRegistry.js';

type SkillSearchCommandKind = 'help' | 'search' | 'describe_skill' | 'describe_tool' | 'list_domains' | 'error';

interface SkillSearchCommandRequest {
  kind: SkillSearchCommandKind;
  query?: string;
  skillId?: string;
  toolName?: string;
  message?: string;
}

export function parseSkillSearchCommand(messageText: string): SkillSearchCommandRequest {
  const trimmed = messageText.trim();
  const args = trimmed.replace(/^\/skillsearch\b/i, '').trim();

  if (!args || args.toLowerCase() === 'help') {
    return { kind: 'help' };
  }

  const tokens = args.split(/\s+/).filter(Boolean);
  const first = tokens[0]?.toLowerCase();
  const second = tokens[1]?.toLowerCase();

  if (first === 'domains' || (first === 'list' && (!second || second === 'domains'))) {
    return { kind: 'list_domains' };
  }

  if ((first === 'skill' || (first === 'describe' && second === 'skill'))) {
    const skillId = first === 'skill' ? tokens[1] : tokens[2];
    return skillId
      ? { kind: 'describe_skill', skillId }
      : { kind: 'error', message: 'Usage: `/skillSearch skill <domain>`' };
  }

  if ((first === 'tool' || (first === 'describe' && second === 'tool'))) {
    const toolName = first === 'tool' ? tokens[1] : tokens[2];
    return toolName
      ? { kind: 'describe_tool', toolName }
      : { kind: 'error', message: 'Usage: `/skillSearch tool <tool_name>`' };
  }

  if (first === 'search') {
    const query = tokens.slice(1).join(' ').trim();
    return query
      ? { kind: 'search', query }
      : { kind: 'error', message: 'Usage: `/skillSearch search <terms>`' };
  }

  return { kind: 'search', query: args };
}

export async function renderSkillSearchCommandResponse(messageText: string): Promise<string> {
  const request = parseSkillSearchCommand(messageText);
  const {
    getDiscoverySkill,
    getDiscoveryTool,
    getSkillDiscoveryIndex,
    searchSkillDiscoveryIndex,
  } = await import('../capabilities/skillDiscoveryIndex.js');

  if (request.kind === 'error') {
    return `${request.message}\n\nUse \`/skillSearch help\` for examples.`;
  }

  if (request.kind === 'help') {
    return [
      '🔎 **/skillSearch** — read-only skill and tool discovery',
      '',
      'Try:',
      '- `/skillSearch email calendar`',
      '- `/skillSearch search github issues`',
      '- `/skillSearch skill outlook`',
      '- `/skillSearch tool outlook_search_emails`',
      '- `/skillSearch domains`',
      '',
      'Notes:',
      '- discovery only — this command never executes tools',
      '- use a normal request after discovery if you want HelkinSwarm to act',
    ].join('\n');
  }

  if (request.kind === 'list_domains') {
    const domains = [...getSkillDiscoveryIndex().skills]
      .sort((left, right) => left.domain.localeCompare(right.domain));

    if (domains.length === 0) {
      return '📚 No skill domains are currently loaded.';
    }

    return [
      '📚 **Available skill domains**',
      '',
      ...domains.map((skill) =>
        `- \`${skill.domain}\` — **${skill.displayName}** (${skill.toolCount} tool${skill.toolCount === 1 ? '' : 's'}) — ${skill.shortDescription}`,
      ),
      '',
      'Use `/skillSearch <terms>` to search, `/skillSearch skill <domain>` for more detail, or `/skillSearch tool <tool_name>` to inspect one tool.',
    ].join('\n');
  }

  if (request.kind === 'describe_skill') {
    const skill = getDiscoverySkill(request.skillId!);
    if (!skill) {
      return `🔎 No skill found for \`${request.skillId}\`. Try \`/skillSearch domains\` or a broader search.`;
    }

    return [
      `🧭 **Skill:** ${skill.displayName} (\`${skill.domain}\`)`,
      '',
      skill.shortDescription,
      '',
      `- recommended entry tools: ${formatInlineCodeList(skill.recommendedEntryTools)}`,
      `- tool count: ${skill.toolCount}`,
      skill.orchestratorUseCases.length > 0
        ? `- common use cases: ${skill.orchestratorUseCases.join('; ')}`
        : '- common use cases: none declared',
      skill.discoveryHints.length > 0
        ? `- discovery hints: ${skill.discoveryHints.join(', ')}`
        : '- discovery hints: none declared',
      `- tools: ${formatInlineCodeList(skill.toolNames)}`,
      skill.modelAffinity ? `- model affinity: ${skill.modelAffinity}` : '- model affinity: none declared',
      '',
      'This is a read-only description. Use a normal request if you want HelkinSwarm to actually use this skill.',
    ].join('\n');
  }

  if (request.kind === 'describe_tool') {
    const tool = getDiscoveryTool(request.toolName!);
    if (!tool) {
      return `🔎 No tool found for \`${request.toolName}\`. Try \`/skillSearch <terms>\` first.`;
    }

    return [
      `🛠️ **Tool:** \`${tool.name}\``,
      '',
      tool.description,
      '',
      `- domain: \`${tool.domain}\``,
      `- risk: ${tool.risk}`,
      `- data sensitivity: ${tool.dataSensitivity}`,
      `- allowed model lane: ${tool.allowedModelLane}`,
      `- available in current safety mode: ${toolRegistry.isAllowedBySafetyMode(tool.name) ? 'yes' : 'no'}`,
      `- requires confirmation: ${tool.requiresConfirmation ? 'yes' : 'no'}`,
      `- requires executor: ${tool.requiresExecutor ? 'yes' : 'no'}`,
      `- requires sub-agent: ${tool.requiresSubAgent ? 'yes' : 'no'}`,
      `- privilege class: ${tool.privilegeClass}`,
      tool.aliases.length > 0 ? `- aliases: ${tool.aliases.join(', ')}` : '- aliases: none',
      tool.useWhen.length > 0 ? `- use when: ${tool.useWhen.join('; ')}` : '- use when: none declared',
      tool.avoidWhen.length > 0 ? `- avoid when: ${tool.avoidWhen.join('; ')}` : '- avoid when: none declared',
      tool.typicalInputs.length > 0 ? `- typical inputs: ${tool.typicalInputs.join('; ')}` : '- typical inputs: none declared',
      '',
      'This command is discovery-only and does not invoke the tool.',
    ].join('\n');
  }

  const result = searchSkillDiscoveryIndex(request.query!, { skillLimit: 4, toolLimit: 6 });
  if (result.skills.length === 0 && result.tools.length === 0) {
    return [
      `🔎 No matching skills or tools found for \`${request.query}\`.`,
      '',
      'Try broader terms, `/skillSearch domains`, or `/skillSearch help`.',
    ].join('\n');
  }

  return [
    `🔎 **Skill search:** \`${request.query}\``,
    '',
    result.skills.length > 0
      ? [
          '**Skills**',
          ...result.skills.map((hit) => {
            const skill = getDiscoverySkill(hit.id);
            return `- \`${hit.domain}\` — **${skill?.displayName ?? hit.id}** — ${skill?.shortDescription ?? ''} ${formatMatchReasons(hit.matchReasons)}${formatEntryTools(skill?.recommendedEntryTools ?? [])}`.trim();
          }),
        ].join('\n')
      : '**Skills**\n- none matched strongly enough',
    '',
    result.tools.length > 0
      ? [
          '**Tools**',
          ...result.tools.map((hit) => {
            const tool = getDiscoveryTool(hit.id);
            return `- \`${hit.id}\` (${tool?.domain ?? hit.domain}, risk: ${tool?.risk ?? 'unknown'}) — ${tool?.description ?? ''} ${formatMatchReasons(hit.matchReasons)}`.trim();
          }),
        ].join('\n')
      : '**Tools**\n- none matched strongly enough',
    '',
    'Use `/skillSearch skill <domain>` or `/skillSearch tool <tool_name>` for drilldown. This command stays read-only.',
  ].join('\n');
}

function formatInlineCodeList(values: string[]): string {
  if (values.length === 0) {
    return 'none';
  }

  return values.map((value) => `\`${value}\``).join(', ');
}

function formatEntryTools(values: string[]): string {
  return values.length > 0
    ? ` — entry tools: ${formatInlineCodeList(values)}`
    : '';
}

function formatMatchReasons(values: string[]): string {
  return values.length > 0
    ? `_(matches: ${values.join(', ')})_`
    : '';
}