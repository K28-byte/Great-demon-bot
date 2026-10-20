/**
 * =====================================================================
 * 𝙂𝒓𝒆𝒂𝒕 𝒅𝒆𝒎𝒐𝒏 - Master Pokémon & Anime Card Engine v3.0
 * =====================================================================
 */

const fs = require('fs');
const { POKEMON_ROSTER } = require('./pokedex');

// Type Advantage Chart
const TYPE_CHART = {
    fire: { strongAgainst: ['grass', 'bug', 'steel'], weakAgainst: ['water', 'fire', 'rock', 'dragon'] },
    water: { strongAgainst: ['fire', 'ground', 'rock'], weakAgainst: ['water', 'grass', 'dragon'] },
    grass: { strongAgainst: ['water', 'ground', 'rock'], weakAgainst: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'] },
    electric: { strongAgainst: ['water', 'flying'], weakAgainst: ['electric', 'grass', 'dragon'], immuneTo: ['ground'] },
    psychic: { strongAgainst: ['fighting', 'poison'], weakAgainst: ['psychic', 'steel'], immuneTo: ['dark'] },
    fighting: { strongAgainst: ['normal', 'rock', 'steel', 'dark'], weakAgainst: ['poison', 'flying', 'psychic', 'bug', 'fairy'], immuneTo: ['ghost'] },
    dragon: { strongAgainst: ['dragon'], weakAgainst: ['steel'], immuneTo: ['fairy'] },
    ghost: { strongAgainst: ['psychic', 'ghost'], weakAgainst: ['dark'], immuneTo: ['normal'] },
    dark: { strongAgainst: ['psychic', 'ghost'], weakAgainst: ['fighting', 'dark', 'fairy'] },
    normal: { strongAgainst: [], weakAgainst: ['rock', 'steel'], immuneTo: ['ghost'] },
    anime: { strongAgainst: ['anime', 'monster'], weakAgainst: ['webnovel'] },
    webnovel: { strongAgainst: ['anime', 'monster', 'psychic'], weakAgainst: [] }
};

// Comprehensive Moves Database for Pokémon, Anime, and Web Novels
const MOVES_DATABASE = {
    fire: ["Flamethrower 🔥", "Fire Blast 💥", "Flame Charge ⚡", "Heat Wave 🌊"],
    water: ["Hydro Pump 🌊", "Surf 🏄‍♂️", "Water Gun 💧", "Waterfall 🌊"],
    grass: ["Solar Beam ☀️", "Vine Whip 🌿", "Energy Ball 🍃", "Leaf Blade ⚔️"],
    electric: ["Thunderbolt ⚡", "Thunder 🌩️", "Electro Ball ⚡", "Volt Tackle ⚡"],
    psychic: ["Psychic 🔮", "Shadow Ball 👻", "Psybeam ✨", "Future Sight 👁️"],
    fighting: ["Close Combat 👊", "Dynamic Punch 💥", "Aura Sphere 🌀", "Mach Punch ⚡"],
    dragon: ["Dragon Claw 🐉", "Outrage 🌀", "Dragon Pulse 💫", "Draco Meteor ☄️"],
    ghost: ["Shadow Ball 👻", "Shadow Claw 🗡️", "Night Shade 🌑", "Hex 🌀"],
    dark: ["Dark Pulse 🌌", "Crunch 🦷", "Night Slash 🗡️", "Sucker Punch ⚡"],
    normal: ["Tackle 🐾", "Quick Attack ⚡", "Hyper Beam 💥", "Body Slam 💢"],
    bug: ["Bug Buzz 🐝", "X-Scissor ✂️", "Megahorn 🦄", "String Shot 🧵"],
    rock: ["Rock Slide 🪨", "Stone Edge ⛰️", "Ancient Power ⏳", "Rock Throw 🪨"],
    steel: ["Iron Head 🦾", "Flash Cannon 💫", "Bullet Punch 🥊", "Metal Claw 🛡️"],
    poison: ["Sludge Bomb ☠️", "Poison Jab 🗡️", "Gunk Shot ☣️", "Acid 🧪"],
    flying: ["Air Slash 🦅", "Brave Bird 🕊️", "Hurricane 🌪️", "Wing Attack 🶶"],
    fairy: ["Moonblast 🌙", "Dazzling Gleam ✨", "Draining Kiss 💕", "Play Rough 🐾"],
    ground: ["Earthquake 🌍", "Earth Power 🌋", "Bulldoze TR", "Mud Slap 💩"],
    anime: ["Shinra Tensei 🌌", "Final Getsuga Tensho ⚔️", "Ultra Impact 💥", "Blade Whirlwind 🌀", "Domain Expansion ⛩️"],
    webnovel: ["Spring Autumn Cicada 🐛", "Fog of History 🌫️", "Chaos Sword Intent 🗡️", "Divination 🔮", "Aperture Refinement 💎"]
};

// Database Storage
let db = {};
if (fs.existsSync('./database.json')) {
    try {
        db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
    } catch (e) {
        db = {};
    }
}

function saveDB() {
    fs.writeFileSync('./database.json', JSON.stringify(db, null, 2));
}

function getPlayer(senderNum) {
    if (!db[senderNum]) {
        db[senderNum] = {
            coins: 1000,
            activeSlot: 0,
            deck: []
        };
        saveDB();
    }
    return db[senderNum];
}

let activeSpawns = {};

function spawnWildPokemon(from) {
    const randomCard = POKEMON_ROSTER[Math.floor(Math.random() * POKEMON_ROSTER.length)];
    
    // Assign random moves based on its type
    const typeMoves = MOVES_DATABASE[randomCard.type] || MOVES_DATABASE["normal"];
    const shuffled = [...typeMoves].sort(() => 0.5 - Math.random());
    const assignedMoves = shuffled.slice(0, 2);

    // 5% chance for a Shiny / Awakened variant card
    const isShiny = Math.random() < 0.05;
    const cardName = isShiny ? `✨ Shiny ${randomCard.name}` : randomCard.name;

    const wildCard = {
        name: cardName,
        tier: randomCard.tier,
        type: randomCard.type,
        image: randomCard.image,
        level: Math.floor(Math.random() * 15) + 1,
        xp: 0,
        moves: assignedMoves,
        isShiny: isShiny
    };
    
    activeSpawns[from] = wildCard;
    return wildCard;
}

function catchPokemon(from, senderNum, targetName) {
    const wild = activeSpawns[from];
    if (!wild) return null;
    
    // Clean target name check (ignores shiny prefix if user types base name)
    const cleanWildName = wild.name.replace('✨ Shiny ', '').toLowerCase();
    const cleanTarget = targetName ? targetName.replace('✨ Shiny ', '').toLowerCase() : '';

    if (targetName && cleanWildName !== cleanTarget) return null;

    const player = getPlayer(senderNum);
    player.deck.push({ ...wild });
    saveDB();
    delete activeSpawns[from];
    return wild;
}

function addXPAndCheckMoves(player, poke, xpGain) {
    poke.xp += xpGain;
    let leveledUp = false;
    const nextLevelXP = poke.level * 100;
    if (poke.xp >= nextLevelXP) {
        poke.level += 1;
        poke.xp = 0;
        leveledUp = true;

        // Learn a new move if available (up to 4 moves)
        const typeMoves = MOVES_DATABASE[poke.type] || MOVES_DATABASE["normal"];
        if (poke.moves.length < 4) {
            const availableMoves = typeMoves.filter(m => !poke.moves.includes(m));
            if (availableMoves.length > 0) {
                const newMove = availableMoves[Math.floor(Math.random() * availableMoves.length)];
                poke.moves.push(newMove);
            }
        }
    }
    saveDB();
    return { leveledUp };
}

module.exports = {
    db,
    saveDB,
    getPlayer,
    spawnWildPokemon,
    catchPokemon,
    addXPAndCheckMoves,
    TYPE_CHART,
    MOVES_DATABASE
};
