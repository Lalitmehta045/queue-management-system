import { BadRequestException } from '@nestjs/common';

export const DEFAULT_ANNOUNCEMENT_TEMPLATE =
  'Token {token}, please proceed to {counter}.';

const ALLOWED_VARIABLES = new Set(['token', 'counter', 'service']);
const MAX_TEMPLATE_LENGTH = 300;
const UNSAFE_CHARACTERS = /[<>();`$]/;

export type AnnouncementVariables = {
  token: string;
  counter: string;
  service?: string;
};

/**
 * Validates a user-supplied announcement template. Only the variables
 * {token}, {counter}, and {service} are allowed; unknown variables and
 * characters that could enable HTML/code injection are rejected.
 */
export function validateAnnouncementTemplate(template: string): void {
  if (template.trim().length === 0) {
    throw new BadRequestException('Announcement template must not be empty');
  }
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new BadRequestException(
      `Announcement template must be at most ${MAX_TEMPLATE_LENGTH} characters`,
    );
  }
  if (UNSAFE_CHARACTERS.test(template)) {
    throw new BadRequestException(
      'Announcement template contains unsupported characters',
    );
  }
  const variables = template.match(/\{([a-z][a-z0-9]*)\}/gi) ?? [];
  for (const match of variables) {
    const name = match.slice(1, -1).toLowerCase();
    if (!ALLOWED_VARIABLES.has(name)) {
      throw new BadRequestException(
        `Unknown template variable "{${name}}". Allowed variables: {token}, {counter}, {service}.`,
      );
    }
  }
}

/**
 * Renders a validated template. Unknown variables are preserved literally;
 * callers must validate the template before rendering.
 */
export function renderAnnouncement(
  template: string,
  variables: AnnouncementVariables,
): string {
  return template.replace(/\{([a-z][a-z0-9]*)\}/gi, (match, name: string) => {
    switch (name.toLowerCase()) {
      case 'token':
        return variables.token;
      case 'counter':
        return variables.counter;
      case 'service':
        return variables.service ?? '';
      default:
        return match;
    }
  });
}
