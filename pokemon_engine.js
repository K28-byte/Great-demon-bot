const fs = require('fs');
const https = require('https');
const { TYPE_CHART, MOVES_DATABASE } = require('./pokedex');

const DB_FILE = './pokemon_db.json';
let db = { players: {}, activeSpawns: {}, pendingMoves: {}, activeBattles: {} };

if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { console.log('Initializing DB...'); }
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getPlayer(senderNum) {
    if (!db.players[senderNum]) {
        db.players[senderNum] = {
            coins: 1000,
            level: 1,
            xp: 0,
            deck: [],
            activeSlot: 0
        };
        saveDB();
    }
    return db.players[senderNum];
}

// Massive pool of Tier S Animated GIFs, SSR, and untiered normal cards
const DYNAMIC_POOL = [
    // --- TIER S ANIMATED GIF / SHINY CARDS ---
    { name: "Pain (Shinra Tensei)", tier: "TIER S 🌟", type: "dark", isAnimated: true, image: "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExaG13cmR0NGJzMW1zNXh6MTkya3NxbGpxaXVpd215bmR0eTZ6eW9mdCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ld77zD3fF3Rem8avEt/giphy.gif" },
    { name: "Gojo Satoru (Hollow Purple)", tier: "TIER S 🌟", type: "psychic", isAnimated: true, image: "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExOGx2aHJrcmN2Y3ZzNWg2cW1kZ3I2bnBxeW92bW5oN2QzaHY5ZjE5ZSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/4lu5FuhtrbaOQgKN57/giphy.gif" },
    { name: "Ichigo (Mugetsu)", tier: "TIER S 🌟", type: "dark", isAnimated: true, image: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExMWkyaWF0aTMyajB3OWJ6MmVjOHJmZ2Vncnk5NHd0cXlqdWdlZ2V4ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/10LKovKon8DENO/giphy.gif" },
    { name: "Goku (Super Saiyan Blue)", tier: "TIER S 🌟", type: "electric", isAnimated: true, image: "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExMXl6NG1jM2RpbDlkYmFxd2NwdTZucWNwbWhudnZreWp6OW9xeXFvZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3oKIPnAiaMCws8nOsE/giphy.gif" },

    // --- SSR CARDS ---
    { name: "Levi Ackerman", tier: "SSR", type: "fighting", isAnimated: false, image: "https://i.postimg.cc/qM0pLg3n/levi.jpg" },
    { name: "Naruto Uzumaki", tier: "SSR", type: "psychic", isAnimated: false, image: "https://i.postimg.cc/D0h9Gf7S/naruto.jpg" },
    { name: "Sasuke Uchiha", tier: "SSR", type: "electric", isAnimated: false, image: "https://i.postimg.cc/3wMvC2t7/sasuke.jpg" },

    // --- NORMAL / UNTIERED CARDS (Standard collection fillers) ---
    { name: "Standard Villager", tier: "NORMAL", type: "normal", isAnimated: false, image: "https://i.postimg.cc/KzT5fM8k/osamu.jpg" },
    { name: "Academy Student", tier: "NORMAL", type: "normal", isAnimated: false, image: "https://i.postimg.cc/26Z8PZ3n/thorfinn.jpg" },
    { name: "Recruit Soldier", tier: "NORMAL", type: "fighting", isAnimated: false, image: "https://i.postimg.cc/50R02Qk8/tanjiro.jpg" },
    { name: "Wild Rookie", tier: "NORMAL", type: "water", isAnimated: false, image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/7.png" }
];

function spawnWildPokemon(chatJid) {
    // Randomly pick from thousands of possibilities or dynamic pool
    const randCard = DYNAMIC_POOL[Math.floor(Math.random() * DYNAMIC_POOL.length)];
    
    db.activeSpawns[chatJid] = {
        name: randCard.name,
        category: randCard.tier.includes("TIER S") ? "Legendary Anime" : "Anime / Card",
        tier: randCard.tier,
        type: randCard.type,
        isAnimated: randCard.isAnimated,
        image: randCard.image,
        level: 5,
        xp: 0,
        hp: 250,
        maxHp: 250,
        atk: 85,
        spd: 90,
        moves: ["Tackle", "Scratch"]
    };
    saveDB();
    return db.activeSpawns[chatJid];
}

function catchPokemon(chatJid, senderNum, targetName) {
    const spawn = db.activeSpawns[chatJid];
    if (!spawn || spawn.name.toLowerCase() !== targetName.toLowerCase()) return null;

    delete db.activeSpawns[chatJid];
    const player = getPlayer(senderNum);
    const caught = { ...spawn, uid: Date.now().toString().slice(-5) };
    player.deck.push(caught);
    saveDB();
    return caught;
}

function addXPAndCheckMoves(player, pokemon, xpGained) {
    if (pokemon.level >= 100) {
        pokemon.level = 100;
        return { leveledUp: false, pendingMove: null };
    }

    pokemon.xp += xpGained;
    let neededXP = pokemon.level * 50;
    let leveledUp = false;
    let pendingMove = null;

    while (pokemon.xp >= neededXP && pokemon.level < 100) {
        pokemon.xp -= neededXP;
        pokemon.level += 1;
        pokemon.maxHp += 12;
        pokemon.hp = pokemon.maxHp;
        pokemon.atk += 4;
        leveledUp = true;
        neededXP = pokemon.level * 50;
    }

    if (pokemon.level >= 100) pokemon.level = 100;
    saveDB();
    return { leveledUp, pendingMove };
}

module.exports = {
    db, saveDB, getPlayer, spawnWildPokemon, catchPokemon, addXPAndCheckMoves,
    TYPE_CHART, MOVES_DATABASE
};
