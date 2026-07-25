// Single source of truth for the AURA 2026 programme.
// The 3D journey, the schedule section and the registration cards all read from
// this file, so a time or venue only ever needs changing in one place.

export const SYMPOSIUM = {
  name: 'AURA 2026',
  college: 'Sankara Polytechnic College',
  dateRange: '30—31 JUL / 2026',
};

export const DAYS = [
  {
    id: 'day-1',
    label: 'Day 1',
    date: '30.07.2026',
    weekday: 'Thursday',
    dateLong: '30 July 2026',
    items: [
      { name: 'Opening Address', time: '10:20 AM — 10:50 AM', venue: 'Main Auditorium', kind: 'ceremony' },
      { name: 'Flush the Brain', time: '11:30 AM — 12:30 PM', venue: 'Visa Hall', kind: 'event',
        category: 'non-technical', team: '15 teams of 2', rules: '3-image clues · No phones allowed' },
      { name: 'Treasure Hunt', time: '11:30 AM — 12:30 PM', venue: 'Campus & Library', kind: 'event',
        category: 'non-technical', team: 'Team event', rules: 'R1: find 5 papers · R2: identify article numbers / names' },
      { name: 'Lunch Break', time: '1:20 PM — 1:50 PM', venue: 'Canteen', kind: 'break' },
      { name: 'Bug Hunt', time: '2:30 PM — 3:15 PM', venue: 'Main Lab', kind: 'event',
        category: 'technical', team: 'Single participant', rules: 'Theory (C / Python) + practical debugging' },
      { name: 'Singing & Dance', time: '2:15 PM — 4:00 PM', venue: 'Main Stage', kind: 'ceremony' },
    ],
  },
  {
    id: 'day-2',
    label: 'Day 2',
    date: '31.07.2026',
    weekday: 'Friday',
    dateLong: '31 July 2026',
    items: [
      { name: 'Murder Mystery', time: '11:30 AM — 12:45 PM', venue: 'Visa Hall', kind: 'event',
        category: 'non-technical', team: '15 teams', rules: 'Projector scenario clues · Find the murderer' },
      { name: 'Lunch Break', time: '1:20 PM — 1:50 PM', venue: 'Canteen', kind: 'break' },
      { name: 'Debate: Android vs iOS', time: '2:30 PM — 3:30 PM', venue: '3rd Class Room', kind: 'event',
        category: 'technical', team: 'Team of 2', rules: 'Android vs iOS · Moderated rounds' },
      { name: 'Valedictory & Prizes', time: '4:00 PM — 4:45 PM', venue: 'Main Auditorium', kind: 'ceremony' },
    ],
  },
];

// The value POSTed to /api/registrations must match the server's allow-list.
export const REGISTRATION_NAME = {
  'Flush the Brain': 'Flush the Brain',
  'Treasure Hunt': 'Treasure Hunt',
  'Bug Hunt': 'Bug Hunt',
  'Murder Mystery': 'Murder Mystery',
  'Debate: Android vs iOS': 'Debate',
};

/** Every competitive event, flattened, with its day and date attached. */
export const EVENTS = DAYS.flatMap(day =>
  day.items
    .filter(item => item.kind === 'event')
    .map(item => ({
      ...item,
      registrationName: REGISTRATION_NAME[item.name] || item.name,
      day: day.label,
      date: day.date,
      dateLong: day.dateLong,
      weekday: day.weekday,
    }))
);

export const eventByRegistrationName = Object.fromEntries(
  EVENTS.map(event => [event.registrationName, event])
);

/** "DAY 1 · 30.07.2026 · VISA HALL · 11:30 AM — 12:30 PM" */
export function whenAndWhere(event) {
  return `${event.day.toUpperCase()} · ${event.date} · ${event.venue.toUpperCase()} · ${event.time}`;
}
