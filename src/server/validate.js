// Server-side validation. The browser form is a convenience; this is the
// authority, because anyone can POST to the API directly.

// Registration is closed for 'Crack the Clue', 'Murder Mystery',
// 'Flush the Brain' and 'Debate', so they are not in the allow-list and the
// API rejects new entries for them. 'Bug Hunt' is the only open event.
export const ALLOWED_EVENTS = ['Bug Hunt'];
export const TEAM_EVENTS = new Set(['Flush the Brain', 'Crack the Clue', 'Debate']);
export const EVENT_CHOICES = { Debate: ['Android', 'iOS'] };
// Year 3 students are not eligible for these events.
export const YEAR_THREE_BLOCKED = new Set(['Flush the Brain', 'Crack the Clue']);
// Year 3 students may take part in these events, but only 15 places each.
// Counted per student, so a Debate team with two Year 3 members uses two.
export const YEAR_THREE_LIMIT = { 'Bug Hunt': 15, Debate: 15 };
/** How many Year 3 places a single registration would consume. */
export const yearThreeSeats = value =>
  (value.year === '3' ? 1 : 0) + (value.partnerYear === '3' ? 1 : 0);

const allowed = new Set(ALLOWED_EVENTS);
const text = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const between = (value, min, max) => value.length >= min && value.length <= max;

export function validateRegistration(input = {}) {
  const event = text(input.event);
  if (!allowed.has(event)) return { error: 'Select a valid event.' };

  const name = text(input.name);
  const department = text(input.department);
  const year = text(input.year);
  const phone = String(input.phone ?? '').replace(/[\s-]/g, '');
  const email = text(input.email).toLowerCase();

  if (!between(name, 2, 100)) return { error: 'Enter a full name between 2 and 100 characters.' };
  if (!between(department, 2, 100)) return { error: 'Enter a department between 2 and 100 characters.' };
  if (!['1', '2', '3'].includes(year)) return { error: 'Select a valid year.' };
  if (!/^\+?[0-9]{10,15}$/.test(phone)) return { error: 'Enter a valid phone number.' };
  if (!between(email, 5, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Enter a valid email address.' };
  if (year === '3' && YEAR_THREE_BLOCKED.has(event)) return { error: 'Year 3 students are not eligible for this event.' };

  const value = { event, name, department, year, phone, email, teamName: '' };

  if (TEAM_EVENTS.has(event)) {
    const teamName = text(input.teamName);
    const partnerName = text(input.partnerName);
    const partnerDepartment = text(input.partnerDepartment);
    const partnerYear = text(input.partnerYear);

    if (!between(teamName, 2, 80)) return { error: 'Enter a team name between 2 and 80 characters.' };
    if (!between(partnerName, 2, 100)) return { error: "Enter participant 2's full name." };
    if (!between(partnerDepartment, 2, 100)) return { error: "Enter participant 2's department." };
    if (!['1', '2', '3'].includes(partnerYear)) return { error: "Select participant 2's year." };
    if (partnerYear === '3' && YEAR_THREE_BLOCKED.has(event)) return { error: 'Year 3 students are not eligible for this event.' };
    if (partnerName.toLowerCase() === name.toLowerCase()) return { error: 'Participant 1 and participant 2 must be different people.' };

    Object.assign(value, { teamName, partnerName, partnerDepartment, partnerYear });
  }

  const options = EVENT_CHOICES[event];
  if (options) {
    const choice = text(input.choice);
    if (!options.includes(choice)) return { error: `Select one of: ${options.join(', ')}.` };
    value.choice = choice;
  }

  return { value };
}
