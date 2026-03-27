import { CardFactory, type Attachment } from 'botbuilder';

function buildLinkCardText(description: string): string {
  return [
    description,
    'If sign-in shows a code instead of finishing automatically, paste the code directly in the chat.',
  ].join('\n\n');
}

function buildSkillLinkCard(
  buttonTitle: string,
  description: string,
  signInUrl: string,
): Attachment {
  return CardFactory.heroCard(
    '',
    buildLinkCardText(description),
    undefined,
    CardFactory.actions([
      {
        type: 'openUrl',
        title: buttonTitle,
        value: signInUrl,
      },
    ]),
  );
}

export function buildSkillLinkSigninCard(
  displayName: string,
  description: string,
  signInUrl: string,
): Attachment {
  return buildSkillLinkCard(`🔗 Link ${displayName}`, description, signInUrl);
}

export function buildSkillRelinkSigninCard(
  displayName: string,
  description: string,
  signInUrl: string,
): Attachment {
  return buildSkillLinkCard(`🔗 Relink ${displayName}`, description, signInUrl);
}