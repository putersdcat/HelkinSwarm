// docformat skill handlers — Markdown → DOCX conversion and upload to OneDrive.
// Spec ref: docs/0z-Living-Mind-Architecture.md §document-handoff
// Issue: #239
//
// Dependencies (both MIT, pure Node, no system binaries required):
//   marked@18  — Markdown tokenizer (TypeScript-first)
//   docx@9     — TypeScript DOCX builder
//
// Scope requirements:
//   docformat_to_docx: Files.ReadWrite (already in GraphOAuth consent)
//
// Auth: user-delegated Graph token via GraphOAuth Bot Framework connection.
// Output: file uploaded to OneDrive /HelkinSwarm/{filename}.docx, returns webUrl.

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { getGraphTokenForUser } from '../../src/auth/graphTokenHelper.js';
import { isPlaceholderScopedToken } from '../../src/auth/scopedTokenMinter.js';
import { z } from 'zod';
import { Lexer, type Token, type Tokens } from 'marked';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from 'docx';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const ONEDRIVE_FOLDER = 'HelkinSwarm';

// ---------------------------------------------------------------------------
// Token resolution — same pattern as Outlook / Entra skills
// ---------------------------------------------------------------------------

async function resolveToken(args: Record<string, unknown>): Promise<string> {
  const userId = typeof args['userId'] === 'string' ? args['userId'] : undefined;
  const scopedToken = typeof args['_scopedToken'] === 'string' ? args['_scopedToken'] : undefined;

  if (scopedToken && !isPlaceholderScopedToken(scopedToken)) {
    return scopedToken;
  }

  if (!userId) {
    throw new Error(
      'Document Converter requires a linked Microsoft account. ' +
      'Please type "/link" to connect your account first.',
    );
  }

  const token = await getGraphTokenForUser(userId);
  if (!token) {
    throw new Error(
      'Microsoft account not linked or token expired. ' +
      'Please type "/link" to connect your account.',
    );
  }
  return token;
}

// ---------------------------------------------------------------------------
// Markdown → DOCX conversion helpers
// ---------------------------------------------------------------------------

/** Extract plain text from an inline token list (for list items and fallback). */
function extractInlineText(tokens: Token[]): string {
  return tokens.map((tok) => {
    if ('text' in tok && typeof (tok as { text: unknown }).text === 'string') {
      return (tok as { text: string }).text;
    }
    return '';
  }).join('');
}

/** Convert inline tokens to docx TextRun array. */
function inlineToRuns(tokens: Token[]): TextRun[] {
  const runs: TextRun[] = [];

  for (const tok of tokens) {
    switch (tok.type) {
      case 'text':
        runs.push(new TextRun({ text: (tok as Tokens.Text).text }));
        break;
      case 'escape':
        runs.push(new TextRun({ text: (tok as Tokens.Escape).text }));
        break;
      case 'strong': {
        const boldText = extractInlineText(tok.tokens ?? []);
        runs.push(new TextRun({
          text: boldText || (tok as Tokens.Strong).text,
          bold: true,
        }));
        break;
      }
      case 'em': {
        const italicText = extractInlineText(tok.tokens ?? []);
        runs.push(new TextRun({
          text: italicText || (tok as Tokens.Em).text,
          italics: true,
        }));
        break;
      }
      case 'codespan':
        runs.push(new TextRun({
          text: (tok as Tokens.Codespan).text,
          font: 'Courier New',
          size: 18,
        }));
        break;
      case 'link':
        runs.push(new TextRun({
          text: (tok as Tokens.Link).text,
          color: '1155CC',
        }));
        break;
      case 'br':
        runs.push(new TextRun({ break: 1 }));
        break;
      default:
        if ('text' in tok && typeof (tok as Record<string, unknown>)['text'] === 'string') {
          runs.push(new TextRun({ text: (tok as { text: string }).text }));
        }
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text: '' })];
}

function depthToHeadingLevel(depth: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (depth) {
    case 1: return HeadingLevel.HEADING_1;
    case 2: return HeadingLevel.HEADING_2;
    case 3: return HeadingLevel.HEADING_3;
    case 4: return HeadingLevel.HEADING_4;
    case 5: return HeadingLevel.HEADING_5;
    default: return HeadingLevel.HEADING_6;
  }
}

/** Convert a block-level token list to docx Paragraphs. */
function blocksToParagraphs(tokens: Token[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading': {
        const h = tok as Tokens.Heading;
        paragraphs.push(new Paragraph({
          heading: depthToHeadingLevel(h.depth),
          children: h.tokens ? inlineToRuns(h.tokens) : [new TextRun({ text: h.text })],
        }));
        break;
      }

      case 'paragraph': {
        const p = tok as Tokens.Paragraph;
        paragraphs.push(new Paragraph({
          children: p.tokens ? inlineToRuns(p.tokens) : [new TextRun({ text: p.text })],
        }));
        break;
      }

      case 'code': {
        const c = tok as Tokens.Code;
        const lines = c.text.split('\n');
        for (const line of lines) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({
              text: line,
              font: 'Courier New',
              size: 18,
            })],
            indent: { left: 720 },
          }));
        }
        break;
      }

      case 'blockquote': {
        const bq = tok as Tokens.Blockquote;
        for (const inner of blocksToParagraphs(bq.tokens ?? [])) {
          paragraphs.push(inner);
        }
        break;
      }

      case 'list': {
        const list = tok as Tokens.List;
        for (const item of list.items) {
          const textToken = item.tokens?.find(
            (t): t is Tokens.Text => t.type === 'text',
          );
          const runs = textToken?.tokens
            ? inlineToRuns(textToken.tokens)
            : [new TextRun({ text: extractInlineText(item.tokens ?? []) })];

          paragraphs.push(new Paragraph({
            children: runs,
            bullet: list.ordered ? undefined : { level: 0 },
            numbering: list.ordered
              ? { reference: 'default-numbering', level: 0 }
              : undefined,
          }));
        }
        break;
      }

      case 'hr':
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: '' })],
          border: {
            bottom: { color: 'AAAAAA', space: 1, style: 'single', size: 2 },
          },
        }));
        break;

      case 'space':
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
        break;

      case 'text': {
        const t = tok as Tokens.Text;
        paragraphs.push(new Paragraph({
          children: t.tokens ? inlineToRuns(t.tokens) : [new TextRun({ text: t.text })],
        }));
        break;
      }

      default:
        break;
    }
  }

  return paragraphs;
}

/** Convert Markdown string to a DOCX Buffer. */
async function markdownToDocxBuffer(markdown: string, title: string): Promise<Buffer> {
  const tokens = Lexer.lex(markdown);
  const children = blocksToParagraphs(Array.from(tokens));

  const doc = new Document({
    title,
    creator: 'HelkinSwarm',
    description: `Generated by HelkinSwarm from Markdown — ${new Date().toISOString()}`,
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: 'left',
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: children.length > 0
          ? children
          : [new Paragraph({ children: [new TextRun({ text: '' })] })],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// OneDrive upload helper
// ---------------------------------------------------------------------------

interface OneDriveItem {
  id: string;
  name: string;
  size: number;
  webUrl: string;
}

/** Upload buffer to OneDrive /HelkinSwarm/{filename} via simple PUT upload (≤4MB). */
async function uploadToOneDrive(
  token: string,
  filename: string,
  buffer: Buffer,
): Promise<OneDriveItem> {
  const encodedPath = `${encodeURIComponent(ONEDRIVE_FOLDER)}/${encodeURIComponent(filename)}`;
  const url = `${GRAPH_BASE}/me/drive/root:/${encodedPath}:/content`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    body: buffer,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const err = await response.json() as { error?: { message?: string } };
      detail = err.error?.message ?? '';
    } catch {
      // ignore
    }
    throw new Error(
      `OneDrive upload failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
    );
  }

  return response.json() as Promise<OneDriveItem>;
}

// ---------------------------------------------------------------------------
// Tool: docformat_to_docx
// ---------------------------------------------------------------------------

const DocformatToDocxArgsSchema = z.object({
  markdown: z.string().min(1).max(200_000),
  filename: z.string().min(1).max(200).optional(),
});

export const docformat_to_docx: ToolHandler = async (args) => {
  const { markdown, filename: rawFilename } = DocformatToDocxArgsSchema.parse(args);
  const token = await resolveToken(args);

  // Sanitize filename: strip unsafe chars, prevent path traversal
  const safeName = (rawFilename ?? 'document')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
    || 'document';

  const docFilename = `${safeName}.docx`;

  const buffer = await markdownToDocxBuffer(markdown, safeName);
  const item = await uploadToOneDrive(token, docFilename, buffer);

  const sizeKb = Math.ceil(item.size / 1024);

  return [
    `**Document saved to OneDrive** ✅`,
    `📄 **${item.name}** (${sizeKb} KB)`,
    `📁 Folder: OneDrive › HelkinSwarm`,
    `🔗 [Open in OneDrive](${item.webUrl})`,
    ``,
    `_Converted from Markdown · ${buffer.byteLength} bytes · ID: ${item.id}_`,
  ].join('\n');
};
