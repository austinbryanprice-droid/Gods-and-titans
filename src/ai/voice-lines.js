// What computer players say in chat (DESIGN 10.1), per pantheon and per moment of the match.
// `{unit}` is the god or Titan the line is about, `{enemy}` the other player's name; a line
// whose blanks cannot be filled is skipped. `greetAlly` is the greeting of a match with no enemy
// player (the Trial of the Titans: everyone together against the monsters). `ackAttack` and `ackDefend`
// answer a teammate's Attack marker and Defend / Help marker (said to the team only); `ackBusy` answers any marker while
// the AI's army defends its own base (it comes once the base is safe), `ackPeace` an Attack marker during a Decade of
// Peace (it waits for the truce to end). Keep each line short (one card in the message feed).

/** The moments an AI speaks, in the order DESIGN 10.1 lists them. */
export const VOICE_TRIGGERS = ['greet', 'greetAlly', 'contact', 'struck', 'peaceEnd', 'god', 'titan', 'godLost', 'beaten', 'defeat', 'victory', 'ackAttack', 'ackDefend', 'ackBusy', 'ackPeace'];

export const VOICE_LINES = {
  greek: {
    greet: ['May the Olympians judge us fairly. They rarely do.', 'Olympus is watching. Try not to embarrass yourself.'],
    greetAlly: ['Shoulder to shoulder, friends. Olympus fights with us.', 'Together, then. Let the monsters come and meet the bronze.'],
    contact: ['So, {enemy}, we meet at last. Olympus has noticed you.', 'Strangers on our borders. Sharpen the bronze.'],
    struck: ['You dare raise a hand against Olympus, {enemy}?', 'Hubris, {enemy}. The gods punish hubris.'],
    peaceEnd: ['The truce is over. Let the war of the gods begin!', 'Enough talk. Ares is hungry.'],
    god: ['{unit} descends from Olympus!', 'Kneel, mortals. {unit} walks among us.'],
    titan: ['{unit} breaks his chains! Run while you can.', 'The age of Titans returns. Behold {unit}!'],
    godLost: ['{unit} has fallen! The Fates will hear of this.', 'Even immortals bleed... {unit} is lost.'],
    beaten: ['Spare my temples! I have hymns still to sing.', 'The Fates have turned against me...'],
    defeat: ['Olympus falls. Remember our songs.', 'The gods have abandoned me. Well fought.'],
    victory: ['Glory to Olympus! Your names will be forgotten.', 'As the Fates foretold: victory is ours.'],
    ackAttack: ['Our spears go where you point.', 'As you command. The phalanx marches!'],
    ackDefend: ['Hold fast, friend. Our shields are coming.', 'Olympus heard you. We march to your side.'],
    ackBusy: ['Our own walls are under attack. We come once they hold.', 'First we save our city, friend. Then we are yours.'],
    ackPeace: ['The truce binds us still. When it ends, the phalanx marches there.', 'Patience, friend. Once the peace is over, we strike there.'],
  },
  norse: {
    greet: ['Skål! May your mead be strong and your walls weak.', 'The ravens are flying. Odin wants a good show.'],
    greetAlly: ['Skål, shield-siblings! Let the beasts come.', 'Stand with me, friends. The ravens want a good fight.'],
    contact: ['Ha! Fresh foes, {enemy}. The skalds will need new verses.', 'I smell strangers. Ready the longships.'],
    struck: ['You strike first, {enemy}? Bold. Foolish, but bold.', 'Blood for blood, {enemy}. That is the way of the North.'],
    peaceEnd: ['Ten years of peace is far too long. Axes up!', 'The horn sounds! Now the real fun begins.'],
    god: ['{unit} rides to war! Sharpen your excuses.', 'Hear the thunder? {unit} has come.'],
    titan: ['{unit} brings the fire of Muspelheim! Ragnarök is here.', 'The world tree trembles. {unit} walks.'],
    godLost: ['{unit} falls... save a seat in Valhalla.', '{unit} is slain! The ravens will remember this.'],
    beaten: ['Spare my mead halls! ...No? Then I fight to the last.', 'My halls burn. A good death, at least.'],
    defeat: ['Valhalla calls. I go to drink with heroes.', 'A fine battle. The skalds will sing of you, sadly.'],
    victory: ['To Hel with you all! The North stands.', 'Skål! Another saga for the halls.'],
    ackAttack: ['Point the way and the axes follow!', 'Ha! A fight. We\'re coming, shield-sibling.'],
    ackDefend: ['Hold the line! The longships are coming.', 'Stand fast, friend. The North rides to you.'],
    ackBusy: ['Busy at our own hall! We come when it is clear.', 'Raiders at our gate. Hold on, we come after.'],
    ackPeace: ['The truce holds for now. When it breaks, the axes go there.', 'Not yet, friend. When the peace ends, we sail there.'],
  },
  egyptian: {
    greet: ['Ra sees all from his sun boat. Build well, for he judges.', 'Greetings. My pyramids will outlast your whole people.'],
    greetAlly: ['Ra shines on all of us today, friends. Hold the walls.', 'Together we stand, as the pyramids stand.'],
    contact: ['Strangers in the desert, {enemy}? The sands swallow many.', 'Foreigners at the edge of the Black Land. Watch them.'],
    struck: ['You profane the land of Ra, {enemy}. Your heart will be weighed.', 'Anubis readies the scales for you, {enemy}.'],
    peaceEnd: ['The peace is ended. Let the chariots roll.', 'Set is restless. The time for war has come.'],
    god: ['{unit} rises in glory over the Nile!', 'Bow before {unit}, child of the sun.'],
    titan: ['{unit} uncoils from the darkness. The sun will not save you.', 'Chaos itself serves me now. Behold {unit}!'],
    godLost: ['{unit} has fallen! Prepare the embalmers.', '{unit} journeys to the Duat. This is not forgotten.'],
    beaten: ['Spare my temples! They took a thousand years to build!', 'The Nile runs red... my kingdom crumbles.'],
    defeat: ['My tomb awaits. Seal it well.', 'The sun sets on my dynasty.'],
    victory: ['Your names are struck from every monument. Ra is victorious.', 'Eternity belongs to Egypt.'],
    ackAttack: ['As you will it. The chariots ride.', 'Ra lights the way. We strike where you point.'],
    ackDefend: ['Hold on, friend. The armies of the Nile are coming.', 'We come to you, as the flood comes every year.'],
    ackBusy: ['Our own temples are attacked. We come when they are safe.', 'First the enemy at our gates, friend. Then we come.'],
    ackPeace: ['The truce of the gods holds. When it ends, the chariots ride there.', 'We wait for the peace to end. Then we strike there.'],
  },
  hindu: {
    greet: ['Namaste. May dharma guide this battle.', 'The wheel turns. Let us see where it stops for you.'],
    greetAlly: ['Namaste, friends. Together we hold back the dark.', 'Our dharma is one today. Let the monsters come.'],
    contact: ['{enemy} crosses our path. Karma brings us together.', 'Strangers on the horizon. Let them come.'],
    struck: ['You strike at us, {enemy}? Your karma darkens.', 'Violence answered with violence, {enemy}. So be it.'],
    peaceEnd: ['The age of peace passes. Now comes the age of war.', 'Shiva begins his dance. The peace is over.'],
    god: ['{unit} descends! The cosmos takes notice.', 'Behold {unit}, and despair.'],
    titan: ['{unit} trumpets across the heavens! The earth shakes.', 'The king of elephants marches. Make way for {unit}!'],
    godLost: ['{unit} has fallen... but every ending is a rebirth.', '{unit} is lost to this world. We will avenge them.'],
    beaten: ['Spare my temples! They hold a thousand prayers.', 'The wheel turns against me...'],
    defeat: ['I return to the great cycle. We will meet again.', 'This life ends. Another begins.'],
    victory: ['Dharma prevails. Your cycle ends here.', 'As it was written in the stars. Victory!'],
    ackAttack: ['Your will is our dharma. We march.', 'The war elephants turn where you point.'],
    ackDefend: ['Hold firm, friend. We come to your side.', 'The wheel turns your way. We are coming.'],
    ackBusy: ['Our own city is attacked. We come when it is safe.', 'First we defend our home, friend. Then we come.'],
    ackPeace: ['The truce is dharma for now. When it ends, we march there.', 'Patience. Once the peace ends, the elephants go there.'],
  },
  japanese: {
    greet: ['Honour to you, rivals. May the kami favour the worthy.', 'The cherry blossoms fall. So will your walls.'],
    greetAlly: ['Honour to you, my allies. May the kami guard us all.', 'Side by side, like the pines of the shrine. Let them come.'],
    contact: ['So, {enemy}, our blades finally meet.', 'Strangers beyond the torii. Prepare yourselves.'],
    struck: ['A dishonourable strike, {enemy}. It will be answered.', 'You wake the storm, {enemy}.'],
    peaceEnd: ['The peace was a fine dream. Now, the sword.', 'Draw your blades. The truce has ended.'],
    god: ['{unit} descends from the High Plain of Heaven!', 'The kami walk with us. {unit} is here.'],
    titan: ['{unit} rises from the deep! Your doom has eight heads.', 'The great serpent wakes. Behold {unit}!'],
    godLost: ['{unit} has fallen... the shrine bells ring for them.', '{unit} is lost. We fight on, with honour.'],
    beaten: ['Spare my shrines! The kami will not forgive you.', 'My castle burns... but my spirit does not break.'],
    defeat: ['I fall like the cherry blossom. Well fought.', 'There is no shame in falling to a worthy foe.'],
    victory: ['The way of the kami prevails. Bow.', 'Victory, as the sun goddess willed.'],
    ackAttack: ['Hai! Our blades go where you point.', 'As you command. The samurai advance.'],
    ackDefend: ['Hold, friend. We come with honour.', 'Stand firm. Our banners ride to you.'],
    ackBusy: ['Our own castle is attacked. We come when it is safe.', 'Forgive us, friend. First our gates, then your call.'],
    ackPeace: ['The truce holds with honour. When it ends, we strike there.', 'Not yet. When the peace is over, the samurai go there.'],
  },
  chinese: {
    greet: ['Greetings. Heaven granted its mandate to me, not you.', 'May your rice bowl stay full. Mine will be fuller.'],
    greetAlly: ['Greetings, allies. Heaven favours those who stand together.', 'Man the walls with me, friends. The beasts are coming.'],
    contact: ['Ah, {enemy}. The Middle Kingdom has noticed you.', 'Barbarians on the frontier. Man the walls.'],
    struck: ['Striking first, {enemy}? Sun Tzu would disapprove.', 'You have lost the Mandate of Heaven, {enemy}.'],
    peaceEnd: ['The years of peace are over. Raise the banners!', 'Even a long peace must end. To war.'],
    god: ['{unit} answers the call of Heaven!', '{unit} joins the battle. Tremble.'],
    titan: ['{unit} shoulders the sky itself! Run.', 'The maker of worlds marches. Behold {unit}!'],
    godLost: ['{unit} has fallen! The heavens weep.', '{unit} is lost. Light the incense.'],
    beaten: ['Spare my temples! I will pay tribute! ...Generous tribute!', 'The Mandate slips from my hands...'],
    defeat: ['My dynasty ends. The histories will be kind to you.', 'Heaven has chosen another.'],
    victory: ['The Mandate of Heaven is mine. Ten thousand years!', 'All under Heaven bows to us.'],
    ackAttack: ['The order is given. The legions march.', 'Heaven wills it: we strike where you point.'],
    ackDefend: ['Hold the wall, ally. Our troops are coming.', 'Stand firm. The Mandate sends you aid.'],
    ackBusy: ['Our own walls are attacked. We come when they hold.', 'First we secure our city, ally. Then we come.'],
    ackPeace: ['The truce holds. When it ends, the legions march there.', 'Heaven asks patience. After the peace, we strike there.'],
  },
  aztec: {
    greet: ['The Fifth Sun shines on us. It must be fed.', 'Welcome, friends. The sun is hungry today.'],
    greetAlly: ['Welcome, friends. Today the sun feeds on monsters.', 'Together we stand. Ready the obsidian for the beasts.'],
    contact: ['{enemy}! The sun will be glad to meet you.', 'Captives for the sun approach. Ready the obsidian.'],
    struck: ['You bring war to us, {enemy}? A flower war it is!', 'Your blood will feed the sun, {enemy}.'],
    peaceEnd: ['The peace is done. Let the flower war begin!', 'Beat the drums! The truce is over.'],
    god: ['{unit} descends on a road of feathers and fire!', 'Behold {unit}! The heavens open.'],
    titan: ['{unit} rises from the first sea! The earth hungers.', 'The great earth-beast wakes. Behold {unit}!'],
    godLost: ['{unit} has fallen! The sun dims.', '{unit} is gone. The drums will beat for them.'],
    beaten: ['Spare my temples! The sun must rise tomorrow!', 'My pyramids crumble... the sun grows dark.'],
    defeat: ['The Fifth Sun sets for me. Feed it well.', 'My heart goes to the sun. Fight on without me.'],
    victory: ['The sun drinks deeply today. Victory!', 'Huitzilopochtli is pleased.'],
    ackAttack: ['The sun is hungry. We go where you point.', 'Yes! The jaguars hunt where you show them.'],
    ackDefend: ['Hold on, friend. The eagles fly to you.', 'We come to your side. The sun will not set on you.'],
    ackBusy: ['Our own city is attacked. We come when it is safe.', 'Enemies at our pyramid! We come after them.'],
    ackPeace: ['The truce holds for now. When it ends, the jaguars hunt there.', 'Patience, friend. After the peace, we go there.'],
  },
  celtic: {
    greet: ['Well met, strangers. The druids say this ends badly for you.', 'May the wild lands welcome you... briefly.'],
    greetAlly: ['Well met, friends. The clans fight as one today.', 'Stand with us in the old woods. The beasts will regret coming.'],
    contact: ['Ah, {enemy} wanders into our forests. Unwise.', 'Strangers in the old woods. The trees whisper of them.'],
    struck: ['Raiding us, {enemy}? We will have your cattle for that.', 'You have woken the wild, {enemy}.'],
    peaceEnd: ['The peace is broken. Paint your faces!', 'The crows are circling. War has come.'],
    god: ['{unit} steps out of the mists!', 'The Otherworld opens. {unit} has come.'],
    titan: ['{unit} opens his terrible eye! Do not look.', 'The giant of the Fomorians walks. Behold {unit}!'],
    godLost: ['{unit} has fallen! Keen for them, my people.', '{unit} has gone back into the mists.'],
    beaten: ['Spare my groves! The oaks are older than you!', 'The forest burns... my clans scatter.'],
    defeat: ['I go to the Otherworld. Leave the oaks standing.', 'The clans fall. Tell our tales by the fire.'],
    victory: ['The wild prevails! Raise a cup to the Dagda.', 'Back to your boats, all of you.'],
    ackAttack: ['To the charge! We go where you point.', 'Ha! A raid. The clans are with you.'],
    ackDefend: ['Hold fast, friend. The clans are coming.', 'The woods march to you. Hold on!'],
    ackBusy: ['Our own hillfort is attacked. We come when it is safe.', 'First we drive them from our home, friend. Then we come.'],
    ackPeace: ['The truce still holds. When it ends, the clans charge there.', 'Not yet, friend. When the peace breaks, we go there.'],
  },
  mesopotamian: {
    greet: ['Greetings from the first city. We invented all this, you know.', 'The gods of Sumer are watching. They keep careful records.'],
    greetAlly: ['Greetings, allies. The scribes will record our stand together.', 'Behind the walls, friends. We built walls first, you know.'],
    contact: ['{enemy}! Your name is now written on my clay tablets.', 'Foreigners beyond the river. Tell the scribes.'],
    struck: ['An attack, {enemy}? The scribes will record your crimes.', 'You have angered the city\'s patron, {enemy}.'],
    peaceEnd: ['The peace treaty expires. Sharpen the bronze.', 'The tablets of peace are broken. To war!'],
    god: ['{unit} comes forth in splendour!', 'Behold {unit}, lord of the ziggurat!'],
    titan: ['{unit} rises from the first waters! Chaos is loose.', 'The mother of monsters wakes. Behold {unit}!'],
    godLost: ['{unit} has fallen! Mourn in sackcloth.', '{unit} has gone down to the underworld.'],
    beaten: ['Spare my ziggurats! They reach the heavens!', 'My walls crumble... like clay in the rain.'],
    defeat: ['Write it on the tablets: I fought well.', 'The first city falls. Others will rise.'],
    victory: ['Carve it in stone: we are victorious!', 'All the lands between the rivers are ours.'],
    ackAttack: ['It is written: we march where you point.', 'The scribes record the order. Forward!'],
    ackDefend: ['Hold the walls, friend. We are coming.', 'Help comes from the first city. Hold on.'],
    ackBusy: ['Our own walls are attacked. We come when they hold.', 'First we save our city, friend. Then we march.'],
    ackPeace: ['The truce is sealed for now. When it ends, we march there.', 'It is written: after the peace, we strike there.'],
  },
  west_african: {
    greet: ['Welcome, friends. Anansi has already told me your plans.', 'May the ancestors give us a good contest.'],
    greetAlly: ['Welcome, friends. The drums call us to stand together.', 'May the ancestors guard us all. Let the beasts come.'],
    contact: ['Ah, {enemy}. The drums told me you were coming.', 'Strangers near our villages. The drums speak of them.'],
    struck: ['You strike us, {enemy}? Shango\'s thunder answers.', 'Àṣẹ! You will regret this, {enemy}.'],
    peaceEnd: ['The peace is over. Let the war drums speak!', 'Ogun sharpens his blades. War has come.'],
    god: ['{unit} answers the drums!', 'The orisha have come. Behold {unit}!'],
    titan: ['{unit} rises from the river! Nothing escapes it.', 'The river beast is loose. Behold {unit}!'],
    godLost: ['{unit} has fallen. The griots will sing their name.', '{unit} returns to the ancestors.'],
    beaten: ['Spare my shrines! The ancestors live there!', 'My villages burn... the drums go quiet.'],
    defeat: ['I go to the ancestors. They will judge you.', 'The drums fall silent. Well played.'],
    victory: ['The drums beat for victory! Àṣẹ!', 'The ancestors smile on us today.'],
    ackAttack: ['The drums answer! We strike where you point.', 'Àṣẹ! The warriors go where you show them.'],
    ackDefend: ['Hold on, friend. The drums call us to you.', 'We are coming. The ancestors walk with us.'],
    ackBusy: ['Our own village is attacked. We come when it is safe.', 'First we guard our home, friend. Then the drums call us.'],
    ackPeace: ['The truce holds for now. When it ends, the warriors go there.', 'Patience, friend. After the peace, we strike there.'],
  },
};

/**
 * Fill a line's blanks, or null when it needs one that is not given.
 * @param {string} line
 * @param {{ unit?: string, enemy?: string }} vars
 */
export function fillLine(line, vars) {
  let missing = false;
  const out = line.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars && vars[k];
    if (typeof v !== 'string' || !v) {
      missing = true;
      return '';
    }
    return v;
  });
  return missing ? null : out;
}
