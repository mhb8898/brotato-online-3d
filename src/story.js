// ---------------------------------------------------------------------------
// The story. Words only: the simulation never reads this file, so nothing
// here can change how a run plays out.
//
//   INTRO    the four panels shown on first launch (replayable from the menu)
//   LORE[id] per character: an epithet, a short bio, and what they say when a
//            run ends - `win` after a cleared run, `lose` after a wipe
// ---------------------------------------------------------------------------

export const INTRO = [
  {
    title: 'The Root Cellar',
    text: 'Under the old farm there was a cellar, and in the cellar there were potatoes. '
      + 'They were cool, dark and perfectly content. Nothing ever happened, and that was how they liked it.',
    art: 'cellar',
  },
  {
    title: 'The Hunger',
    text: 'Then the soil went sour. Something grew out of the rot: grunts, runners, great lumbering tanks, '
      + 'all mouth and no manners. They call it the Hunger, and it eats anything with a root.',
    art: 'hunger',
  },
  {
    title: 'The Pit',
    text: 'The Warden came next. It herded the whole cellar into a stone arena called the Pit and feeds '
      + 'the Hunger one wave at a time. Every twenty seconds or so, somebody gets mashed.',
    art: 'pit',
  },
  {
    title: 'Twenty waves',
    text: 'Eight potatoes decided they were done being dinner. Scrap materials from the fallen, arm up between waves, '
      + 'and last twenty rounds. At the bottom of the Pit waits the Devourer. Get past it and you go home.',
    art: 'squad',
  },
];

// Indexed like CHARACTERS in data.js.
export const LORE = [
  {
    epithet: 'Fell off the truck',
    bio: 'Rolled off the back of a market truck one bumpy morning and simply kept going. '
      + 'Has seen every field from here to the coast and trusts a plain pistol over anything fancy.',
    win: ['Good. Now, which way is home?', 'Twenty waves. I have walked further for less.', 'Another road behind me.'],
    lose: ['Just need a minute. Then I keep walking.', 'I have been knocked flat before. Mostly by trucks.', 'Well. That was a detour.'],
  },
  {
    epithet: 'Chip-shop bruiser',
    bio: 'Grew up behind the fryer at the chip shop and punched their way out of a stew pot at the age of two weeks. '
      + 'Does not understand guns. Does not want to.',
    win: ['Anyone else? No? Shame.', 'That is what knuckles are for.', 'Told you. Stews never hold me.'],
    lose: ['I was just warming up!', 'Next round is on me. And on them.', 'Mashed? Bruised, at most.'],
  },
  {
    epithet: 'Top-shelf scout',
    bio: 'Spent a whole season on the highest shelf in the pantry, watching everything. '
      + 'Sees the Hunger coming long before it arrives. Keep them out of arm\'s reach, though; they bruise.',
    win: ['Clear sightlines, clean finish.', 'I saw that ending from wave one.', 'Out of range, all the way.'],
    lose: ['Too close. Always too close.', 'I needed a taller shelf.', 'They got inside my reach. Noted.'],
  },
  {
    epithet: 'The cellar door',
    bio: 'The oldest potato in the cellar. Sat against the door so long that their skin turned to bark. '
      + 'Slow to move and slower to fall. When they plant their hammer, the line holds.',
    win: ['The door holds.', 'I have outlasted worse winters.', 'Hmph. Took them long enough.'],
    lose: ['Even doors come off their hinges.', 'I will be back. I am always back.', 'Heavy. Very heavy.'],
  },
  {
    epithet: 'Peeled and fast',
    bio: 'Lost their skin in a peeler accident and discovered they had nothing left to slow them down. '
      + 'One tap takes them out, so they make sure nothing gets that tap.',
    win: ['Did you blink? I did not.', 'Twenty waves, zero hugs.', 'Fastest spud in the Pit!'],
    lose: ['Ow. OW. That one landed.', 'Too slow. Me! Too slow!', 'Skin would have helped, honestly.'],
  },
  {
    epithet: 'County fair hustler',
    bio: 'Ran the ring toss at the county fair and never once lost a bet they had rigged. '
      + 'Brought a shotgun, a lucky coin and enormous confidence to the Pit.',
    win: ['House always wins, darling.', 'Double or nothing on the next one?', 'Luck is a skill. Ask anyone.'],
    lose: ['The dice owe me one.', 'Rigged. Obviously rigged.', 'Let it ride... next time.'],
  },
  {
    epithet: 'Came back from the fryer',
    bio: 'Went into the deep fryer by mistake and came out crispy, golden and absolutely furious. '
      + 'Carries the fryer\'s heat around in a tank on their back, and shares it generously.',
    win: ['Well done. Extra crispy.', 'The Pit is warm now. You are welcome.', 'Burned it all down. Good.'],
    lose: ['Still smoking. Still standing. Mostly.', 'The fire went out. Only for now.', 'Too hot to handle, apparently.'],
  },
  {
    epithet: 'The sprout that feeds',
    bio: 'A potato gone to sprout that learned to drink the strength out of anything it touches. '
      + 'Hits softly and heals constantly. Nobody sits next to it at dinner.',
    win: ['Delicious. Every one of them.', 'I am full. For now.', 'Roots run deep, Hunger. Deeper than yours.'],
    lose: ['I will sprout again.', 'Not enough to drink...', 'Plant me somewhere nice.'],
  },
];

/** One line for the end-of-run card. */
export function quip(charId, win) {
  const lore = LORE[charId] || LORE[0];
  const lines = win ? lore.win : lore.lose;
  return lines[Math.floor(Math.random() * lines.length)];
}

const SEEN_KEY = 'pr_intro_seen';
export function introSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}
export function markIntroSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: it will show again, harmless */ }
}
