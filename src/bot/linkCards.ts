import { CardFactory, type Attachment } from 'botbuilder';

function buildSkillLinkCard(
  buttonTitle: string,
  description: string,
  signInUrl: string,
): Attachment {
  return CardFactory.heroCard(
    '',
    description,
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