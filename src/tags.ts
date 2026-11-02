/**
 * Shared vocabulary for why tarpit ideas fail. Each entry's `tag` in content/*.json must
 * be one of these keys. The question is what the idea checker asks a founder whose idea
 * matches a tarpit with that failure mode.
 */
export const TAGS = {
  'cold-start': {
    label: 'Cold start',
    question: 'What do your first 100 users get on day one, before anyone else is on it?',
  },
  frequency: {
    label: 'Used too rarely',
    question: 'How often does the problem actually come up, and what brings people back in between?',
  },
  retention: {
    label: 'Users drift away',
    question: 'Why would someone still be using this in month three, after the novelty wears off?',
  },
  monetisation: {
    label: 'Hard to charge for',
    question: 'Who pays, how much, and have any of them already said yes?',
  },
  'unit-economics': {
    label: 'Loses money per order',
    question: 'What does one order or one customer cost you, and what does it earn, without discounts?',
  },
  incumbents: {
    label: 'Incumbents copy it',
    question: 'If the biggest player ships this as a feature next quarter, what do you still have?',
  },
  licensing: {
    label: 'Licensing costs',
    question: 'Who owns the content or rights you depend on, and what will they charge once you grow?',
  },
  hardware: {
    label: 'Waits on hardware',
    question: 'How many people own the device this needs today, and how fast is that growing?',
  },
  coordination: {
    label: 'Rivals must cooperate',
    question: 'Why would competitors join something that benefits all of them, including each other?',
  },
  'data-input': {
    label: 'Garbage in',
    question: 'Where does the data come from, and who checks it is true before it goes in?',
  },
  moderation: {
    label: 'Moderation burden',
    question: 'How will you keep it safe and pleasant once strangers start using it?',
  },
  timing: {
    label: 'Too early',
    question: 'What has changed since the last serious attempt that makes now different?',
  },
  regulation: {
    label: 'Regulation',
    question: 'Which rules apply, and what happens if a regulator looks closely?',
  },
} as const;

export type Tag = keyof typeof TAGS;

export function isTag(value: string): value is Tag {
  return Object.hasOwn(TAGS, value);
}

export function tagLabel(tag: string): string {
  return isTag(tag) ? TAGS[tag].label : tag;
}
