const TYPE_CHART = {
    fire: { grass: 2.0, ice: 2.0, bug: 2.0, steel: 2.0, fire: 0.5, water: 0.5, rock: 0.5, dragon: 0.5 },
    water: { fire: 2.0, ground: 2.0, rock: 2.0, water: 0.5, grass: 0.5, dragon: 0.5 },
    grass: { water: 2.0, ground: 2.0, rock: 2.0, fire: 0.5, grass: 0.5, poison: 0.5, flying: 0.5, bug: 0.5, dragon: 0.5, steel: 0.5 },
    electric: { water: 2.0, flying: 2.0, electric: 0.5, grass: 0.5, dragon: 0.5, ground: 0.0 },
    psychic: { fighting: 2.0, poison: 2.0, psychic: 0.5, steel: 0.5, dark: 0.0 },
    fighting: { normal: 2.0, ice: 2.0, rock: 2.0, dark: 2.0, steel: 2.0, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, ghost: 0.0 },
    dark: { psychic: 2.0, ghost: 2.0, fighting: 0.5, dark: 0.5 }
};

const MOVES_DATABASE = {
    "Scratch": { power: 40, type: "normal" },
    "Tackle": { power: 40, type: "normal" },
    "Ember": { power: 45, type: "fire" },
    "Flamethrower": { power: 90, type: "fire" },
    "Fire Blast": { power: 110, type: "fire" },
    "Thunderbolt": { power: 90, type: "electric" },
    "Water Gun": { power: 40, type: "water" },
    "Hydro Pump": { power: 110, type: "water" },
    "Psychic": { power: 90, type: "psychic" },
    "Shinra Tensei": { power: 130, type: "dark" },
    "Almighty Push": { power: 100, type: "dark" },
    "Chibaku Tensei": { power: 150, type: "dark" },
    "Getsuga Tensho": { power: 95, type: "dark" },
    "Mugetsu": { power: 180, type: "dark" },
    "ODM Slash": { power: 85, type: "fighting" },
    "Beyblade Slash": { power: 120, type: "fighting" },
    "Hollow Purple": { power: 160, type: "psychic" },
    "Rasengan": { power: 95, type: "psychic" },
    "Chidori": { power: 95, type: "electric" },
    "Hinokami Kagura": { power: 140, type: "fire" },
    "Kamehameha": { power: 150, type: "electric" }
};

const CARD_ROSTER = [
    {
        id: "s001", name: "Pain (Almighty Push)", category: "Anime", tier: "TIER S 🌟", type: "dark", baseHp: 380, baseAtk: 130, baseSpd: 120,
        isAnimated: true,
        image: "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExaG13cmR0NGJzMW1zNXh6MTkya3NxbGpxaXVpd215bmR0eTZ6eW9mdCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ld77zD3fF3Rem8avEt/giphy.gif",
        movesByLevel: { 1: ["Almighty Push"], 25: "Shinra Tensei", 60: "Chibaku Tensei" }
    },
    {
        id: "s002", name: "Gojo Satoru (Hollow Purple)", category: "Anime", tier: "TIER S 🌟", type: "psychic", baseHp: 400, baseAtk: 140, baseSpd: 135,
        isAnimated: true,
        image: "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExOGx2aHJrcmN2Y3ZzNWg2cW1kZ3I2bnBxeW92bW5oN2QzaHY5ZjE5ZSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/4lu5FuhtrbaOQgKN57/giphy.gif",
        movesByLevel: { 1: ["Divergent Fist"], 30: "Hollow Purple" }
    },
    {
        id: "s003", name: "Ichigo (Mugetsu Final Form)", category: "Anime", tier: "TIER S 🌟", type: "dark", baseHp: 390, baseAtk: 135, baseSpd: 130,
        isAnimated: true,
        image: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExMWkyaWF0aTMyajB3OWJ6MmVjOHJmZ2Vncnk5NHd0cXlqdWdlZ2V4ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/10LKovKon8DENO/giphy.gif",
        movesByLevel: { 1: ["Getsuga Tensho"], 50: "Mugetsu" }
    },
    {
        id: "s004", name: "Goku (Super Saiyan Blue)", category: "Anime", tier: "TIER S 🌟", type: "electric", baseHp: 410, baseAtk: 145, baseSpd: 125,
        isAnimated: true,
        image: "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExMXl6NG1jM2RpbDlkYmFxd2NwdTZucWNwbWhudnZreWp6OW9xeXFvZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3oKIPnAiaMCws8nOsE/giphy.gif",
        movesByLevel: { 1: ["Tackle"], 40: "Kamehameha" }
    },
    {
        id: "a001", name: "Levi Ackerman", category: "Anime", tier: "SSR", type: "fighting", baseHp: 280, baseAtk: 105, baseSpd: 145,
        isAnimated: false,
        image: "https://i.postimg.cc/qM0pLg3n/levi.jpg",
        movesByLevel: { 1: ["ODM Slash"], 30: "Beyblade Slash" }
    },
    {
        id: "a002", name: "Naruto Uzumaki", category: "Anime", tier: "SSR", type: "psychic", baseHp: 320, baseAtk: 102, baseSpd: 115,
        isAnimated: false,
        image: "https://i.postimg.cc/D0h9Gf7S/naruto.jpg",
        movesByLevel: { 1: ["Tackle"], 25: "Rasengan" }
    },
    {
        id: "a003", name: "Sasuke Uchiha", category: "Anime", tier: "SSR", type: "electric", baseHp: 310, baseAtk: 106, baseSpd: 118,
        isAnimated: false,
        image: "https://i.postimg.cc/3wMvC2t7/sasuke.jpg",
        movesByLevel: { 1: ["Scratch"], 25: "Chidori" }
    },
    {
        id: "a004", name: "Thorfinn", category: "Anime", tier: "RARE", type: "fighting", baseHp: 250, baseAtk: 88, baseSpd: 125,
        isAnimated: false,
        image: "https://i.postimg.cc/26Z8PZ3n/thorfinn.jpg",
        movesByLevel: { 1: ["Tackle"] }
    },
    {
        id: "p001", name: "Charizard", category: "Pokémon", tier: "SSR", type: "fire", baseHp: 290, baseAtk: 90, baseSpd: 100,
        isAnimated: false,
        image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png",
        movesByLevel: { 1: ["Scratch", "Ember"], 20: "Flamethrower", 50: "Fire Blast" }
    }
];

module.exports = { TYPE_CHART, MOVES_DATABASE, POKEMON_ROSTER: CARD_ROSTER };
