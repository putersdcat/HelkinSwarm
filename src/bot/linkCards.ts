import { CardFactory, type Attachment } from 'botbuilder';

export function buildSkillLinkSigninCard(
  displayName: string,
  description: string,
  signInUrl: string,
): Attachment {
  return CardFactory.signinCard(`🔗 Link ${displayName}`, signInUrl, description);
}

export function buildSkillRelinkSigninCard(
  displayName: string,
  description: string,
  signInUrl: string,
): Attachment {
  return CardFactory.signinCard(`🔗 Relink ${displayName}`, signInUrl, description);
}