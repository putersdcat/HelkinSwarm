const HEART_EYES_ROBOT_SHORTCODE = ':hearteyesrobot:';
const HEART_EYES_ROBOT_UNICODE = '🤖❤️👀';
const HEART_EYES_ROBOT_PHRASE_PATTERN = /heart[ -]?eyes[ -]?robot/i;
const HEART_EYES_ROBOT_ID_PATTERN = /hearteyesrobot/i;

const HIGHFIVE_PHRASE_PATTERN = /high[ -]?five/i;
const HIGHFIVE_ID_PATTERN = /(?:^|[^a-z])highfive(?:[^a-z]|$)/i;

const HIGHFIVE_HTML = '<p><emoji id="highfive" alt="✋" title="High five"></emoji></p>';
const ROBOT_LOVE_FALLBACK_TEXT = '🤖❤️👀 Robot love detected!';

export interface TeamsNativeEmojiEasterEggReply {
  text?: string;
  textFormat?: 'plain' | 'markdown' | 'xml';
  attachments?: Array<{
    contentType: string;
    contentUrl: string;
    name: string;
    thumbnailUrl?: string;
  }>;
}

export interface TeamsNativeEmojiEasterEggInput {
  messageText: string;
  activityText?: string;
  activityDetails?: string[];
}

function collectSignals(input: TeamsNativeEmojiEasterEggInput): string[] {
  return [input.messageText, input.activityText ?? '', ...(input.activityDetails ?? [])]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function hasHeartEyesRobotSignal(input: TeamsNativeEmojiEasterEggInput): boolean {
  const trimmed = input.messageText.trim();
  if (trimmed.toLowerCase() === HEART_EYES_ROBOT_SHORTCODE || trimmed === HEART_EYES_ROBOT_UNICODE) {
    return true;
  }

  const signals = collectSignals(input);
  return signals.some((value) => HEART_EYES_ROBOT_ID_PATTERN.test(value) || HEART_EYES_ROBOT_PHRASE_PATTERN.test(value));
}

export function hasHighFiveSignal(input: TeamsNativeEmojiEasterEggInput): boolean {
  const signals = collectSignals(input);
  return signals.some((value) => HIGHFIVE_ID_PATTERN.test(value) || HIGHFIVE_PHRASE_PATTERN.test(value));
}

let robotLoveDataUrlCache: string | undefined;

export function resetTeamsNativeEmojiEasterEggCache(): void {
  robotLoveDataUrlCache = undefined;
}

async function loadRobotLoveDataUrl(readFileImpl: (path: string) => Promise<Buffer>): Promise<string> {
  if (robotLoveDataUrlCache) {
    return robotLoveDataUrlCache;
  }

  const { resolve } = await import('node:path');
  const assetUrl = resolve(process.cwd(), 'visualAssets', 'EggsOfEaster', 'RobotLove.gif');
  const bytes = await readFileImpl(assetUrl);
  robotLoveDataUrlCache = `data:image/gif;base64,${Buffer.from(bytes).toString('base64')}`;
  return robotLoveDataUrlCache;
}

export async function buildTeamsNativeEmojiEasterEggReply(
  input: TeamsNativeEmojiEasterEggInput,
  options: {
    readFileImpl?: (path: string) => Promise<Buffer>;
  } = {},
): Promise<TeamsNativeEmojiEasterEggReply | undefined> {
  if (hasHeartEyesRobotSignal(input)) {
    try {
      const { readFile } = await import('node:fs/promises');
      const dataUrl = await loadRobotLoveDataUrl(options.readFileImpl ?? readFile);
      return {
        attachments: [
          {
            contentType: 'image/gif',
            contentUrl: dataUrl,
            name: 'RobotLove.gif',
            thumbnailUrl: dataUrl,
          },
        ],
      };
    } catch {
      return { text: ROBOT_LOVE_FALLBACK_TEXT };
    }
  }

  if (hasHighFiveSignal(input)) {
    return {
      text: HIGHFIVE_HTML,
      textFormat: 'xml',
    };
  }

  return undefined;
}