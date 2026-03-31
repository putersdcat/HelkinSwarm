import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const HEART_EYES_ROBOT_SHORTCODE = ':hearteyesrobot:';
const HEART_EYES_ROBOT_UNICODE = '🤖❤️👀';
const TEAMS_HEART_EYES_ROBOT_TAG_PATTERN = /<emoji\b[^>]*\bid=["']hearteyesrobot["'][^>]*>/i;
const TEAMS_HEART_EYES_ROBOT_JSON_PATTERN = /"(?:id|name|shortcode|type)"\s*:\s*"hearteyesrobot"/i;
const ROBOT_LOVE_FALLBACK_TEXT = '🤖❤️👀 Robot love detected!';

export interface EasterEggReply {
  text?: string;
  textFormat?: 'plain' | 'markdown' | 'xml';
  attachments?: Array<{
    contentType: string;
    contentUrl: string;
    name: string;
    thumbnailUrl?: string;
  }>;
}

export interface RobotLoveEasterEggInput {
  messageText: string;
  activityText?: string;
  activityDetails?: string[];
}

interface RobotLoveEasterEggOptions {
  readFileImpl?: typeof readFile;
}

let robotLoveDataUrlCache: string | undefined;

export function resetRobotLoveEasterEggCache(): void {
  robotLoveDataUrlCache = undefined;
}

function hasHeartEyesRobotMarkup(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return TEAMS_HEART_EYES_ROBOT_TAG_PATTERN.test(value)
    || TEAMS_HEART_EYES_ROBOT_JSON_PATTERN.test(value);
}

export function isHeartEyesRobotTrigger(input: RobotLoveEasterEggInput): boolean {
  const trimmed = input.messageText.trim();
  if (trimmed.toLowerCase() === HEART_EYES_ROBOT_SHORTCODE || trimmed === HEART_EYES_ROBOT_UNICODE) {
    return true;
  }

  if (trimmed.length > 0) {
    return false;
  }

  const activitySignals = [input.activityText, ...(input.activityDetails ?? [])];
  return activitySignals.some((value) => hasHeartEyesRobotMarkup(value));
}

async function loadRobotLoveDataUrl(options: RobotLoveEasterEggOptions = {}): Promise<string> {
  if (robotLoveDataUrlCache) {
    return robotLoveDataUrlCache;
  }

  const readFileImpl = options.readFileImpl ?? readFile;
  const assetUrl = resolve(process.cwd(), 'visualAssets', 'EggsOfEaster', 'RobotLove.gif');
  const bytes = await readFileImpl(assetUrl);
  robotLoveDataUrlCache = `data:image/gif;base64,${Buffer.from(bytes).toString('base64')}`;
  return robotLoveDataUrlCache;
}

export async function buildRobotLoveEasterEggReply(
  input: RobotLoveEasterEggInput,
  options: RobotLoveEasterEggOptions = {},
): Promise<EasterEggReply | undefined> {
  if (!isHeartEyesRobotTrigger(input)) {
    return undefined;
  }

  try {
    const dataUrl = await loadRobotLoveDataUrl(options);
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
    return {
      text: ROBOT_LOVE_FALLBACK_TEXT,
    };
  }
}