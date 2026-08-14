// plugins/dungeon-maze/catalog/enemies.json
var enemies_default = {
  schemaVersion: 1,
  enemies: [
    {
      id: "goblin-skirmisher",
      name: "\u54E5\u5E03\u6797\u6563\u5175",
      role: "minion",
      hp: 7,
      ac: 13,
      initiativeMod: 2,
      attacks: [{ name: "\u5F2F\u5200", attackBonus: 4, damage: "1d6+2" }]
    },
    {
      id: "maze-dragon",
      name: "\u8FF7\u5BAB\u5E7C\u9F99",
      role: "boss",
      hp: 32,
      ac: 15,
      initiativeMod: 1,
      attacks: [{ name: "\u5229\u722A", attackBonus: 5, damage: "2d6+3" }]
    }
  ]
};

// plugins/dungeon-maze/catalog/equipment.json
var equipment_default = {
  schemaVersion: 1,
  equipment: [
    {
      id: "training-sword",
      name: "\u8BAD\u7EC3\u5251",
      category: "weapon",
      damage: "1d8+2",
      attackBonus: 4
    }
  ]
};

// plugins/dungeon-maze/src/catalog.ts
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validDiceExpression(value) {
  return typeof value === "string" && /^\d+d\d+(?:[+-]\d+)?$/i.test(value);
}
function requireString(value, path) {
  if (typeof value !== "string" || !value) throw new Error(`invalid_catalog:${path}`);
  return value;
}
function requireInteger(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`invalid_catalog:${path}`);
  return value;
}
function requireUniqueIds(entries, path) {
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error(`invalid_catalog:${path}.id`);
}
function parseDungeonCatalog(sources) {
  if (!isRecord(sources.enemies) || sources.enemies.schemaVersion !== 1 || !Array.isArray(sources.enemies.enemies)) {
    throw new Error("invalid_catalog:enemies");
  }
  if (!isRecord(sources.equipment) || sources.equipment.schemaVersion !== 1 || !Array.isArray(sources.equipment.equipment)) {
    throw new Error("invalid_catalog:equipment");
  }
  const enemies = sources.enemies.enemies.map((value, index) => {
    if (!isRecord(value) || !Array.isArray(value.attacks)) throw new Error(`invalid_catalog:enemies[${index}]`);
    const role = value.role;
    if (role !== "minion" && role !== "elite" && role !== "boss") throw new Error(`invalid_catalog:enemies[${index}].role`);
    const attacks = value.attacks.map((attack, attackIndex) => {
      if (!isRecord(attack) || !validDiceExpression(attack.damage)) throw new Error(`invalid_catalog:enemies[${index}].attacks[${attackIndex}]`);
      return {
        name: requireString(attack.name, `enemies[${index}].attacks[${attackIndex}].name`),
        attackBonus: requireInteger(attack.attackBonus, `enemies[${index}].attacks[${attackIndex}].attackBonus`),
        damage: attack.damage
      };
    });
    if (attacks.length === 0) throw new Error(`invalid_catalog:enemies[${index}].attacks`);
    return {
      id: requireString(value.id, `enemies[${index}].id`),
      name: requireString(value.name, `enemies[${index}].name`),
      role,
      hp: requireInteger(value.hp, `enemies[${index}].hp`, 1),
      ac: requireInteger(value.ac, `enemies[${index}].ac`, 1),
      initiativeMod: requireInteger(value.initiativeMod, `enemies[${index}].initiativeMod`),
      attacks
    };
  });
  const equipment = sources.equipment.equipment.map((value, index) => {
    if (!isRecord(value) || value.category !== "weapon" || !validDiceExpression(value.damage)) {
      throw new Error(`invalid_catalog:equipment[${index}]`);
    }
    return {
      id: requireString(value.id, `equipment[${index}].id`),
      name: requireString(value.name, `equipment[${index}].name`),
      category: "weapon",
      damage: value.damage,
      attackBonus: requireInteger(value.attackBonus, `equipment[${index}].attackBonus`)
    };
  });
  requireUniqueIds(enemies, "enemies");
  requireUniqueIds(equipment, "equipment");
  return { schemaVersion: 1, enemies, equipment };
}
var DEFAULT_DUNGEON_CATALOG = parseDungeonCatalog({
  enemies: enemies_default,
  equipment: equipment_default
});
function createEnemyCombatant(definition, instanceId) {
  const attack = definition.attacks[0];
  return {
    id: instanceId,
    name: definition.name,
    hp: definition.hp,
    hpMax: definition.hp,
    ac: definition.ac,
    initiativeMod: definition.initiativeMod,
    attackBonus: attack.attackBonus,
    damage: attack.damage
  };
}
function findDungeonEnemy(catalog, enemyId) {
  const enemy = catalog.enemies.find((candidate) => candidate.id === enemyId);
  if (!enemy) throw new Error(`unknown_dungeon_enemy:${enemyId}`);
  return enemy;
}

// plugins/dungeon-maze/src/combat.ts
var DICE_EXPRESSION = /^(\d+)d(\d+)([+-]\d+)?$/i;
function parseDiceExpression(expression) {
  const match = DICE_EXPRESSION.exec(expression.trim());
  if (!match) throw new Error(`invalid_dice_expression:${expression}`);
  const count2 = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(count2) || !Number.isSafeInteger(sides) || count2 < 1 || sides < 2) {
    throw new Error(`invalid_dice_expression:${expression}`);
  }
  return { count: count2, sides, modifier };
}
function rollDie(sides, random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("combat_random_out_of_range");
  return Math.floor(value * sides) + 1;
}
function rollDice(expression, random = Math.random) {
  const parsed = parseDiceExpression(expression);
  const dice = Array.from({ length: parsed.count }, () => rollDie(parsed.sides, random));
  const total = dice.reduce((sum, die) => sum + die, parsed.modifier);
  return { expression, dice, modifier: parsed.modifier, total };
}
function rollInitiative(combatants, random = Math.random) {
  return combatants.map((combatant) => {
    const roll = rollDie(20, random);
    return { actorId: combatant.id, roll, total: roll + combatant.initiativeMod };
  }).sort((a, b) => b.total - a.total || b.roll - a.roll || a.actorId.localeCompare(b.actorId));
}
function resolveCombatAttack(actor, target, random = Math.random) {
  const attackD20 = rollDie(20, random);
  const attackTotal = attackD20 + actor.attackBonus;
  const hit = attackTotal >= target.ac;
  const damage = hit ? rollDice(actor.damage, random) : void 0;
  const damageTotal = damage?.total ?? 0;
  const nextHp = Math.max(0, target.hp - damageTotal);
  return {
    target: { ...target, hp: nextHp },
    log: {
      actorId: actor.id,
      targetId: target.id,
      action: "attack",
      rolls: { attackD20, attackTotal, ...damage ? { damage } : {} },
      targetAc: target.ac,
      hit,
      damageTotal,
      hpAfter: nextHp,
      effectsApplied: []
    }
  };
}

// plugins/dungeon-maze/src/battle.ts
var HERO_COMBATANT_ID = "hero";
function createHeroCombatant(catalog) {
  const weapon = catalog.equipment[0];
  if (!weapon) throw new Error("missing_dungeon_weapon");
  return {
    id: HERO_COMBATANT_ID,
    name: "\u5192\u9669\u8005",
    hp: 18,
    hpMax: 18,
    ac: 14,
    initiativeMod: 2,
    attackBonus: weapon.attackBonus,
    damage: weapon.damage
  };
}
function combatantById(combat, id) {
  const combatant = combat.combatants.find((candidate) => candidate.id === id);
  if (!combatant) throw new Error(`unknown_combatant:${id}`);
  return combatant;
}
function beginDungeonCombat(state, catalog, random = Math.random) {
  if (state.activeCombat || state.activeEvent?.kind !== "combat") return null;
  const entity = state.entities.find((candidate) => candidate.id === state.activeEvent?.entityId);
  if (!entity?.catalogId) throw new Error(`missing_dungeon_enemy:${state.activeEvent.entityId}`);
  const combatants = [createHeroCombatant(catalog), createEnemyCombatant(findDungeonEnemy(catalog, entity.catalogId), entity.id)];
  return {
    ...state,
    activeCombat: {
      initiative: rollInitiative(combatants, random),
      currentTurn: 0,
      combatants,
      log: [],
      outcome: null
    }
  };
}
function advanceDungeonCombat(state, random = Math.random) {
  const combat = state.activeCombat;
  if (!combat || combat.outcome) return null;
  const actorId = combat.initiative[combat.currentTurn]?.actorId;
  if (!actorId) throw new Error("invalid_dungeon_initiative");
  const targetId = actorId === HERO_COMBATANT_ID ? combat.combatants.find((candidate) => candidate.id !== HERO_COMBATANT_ID)?.id : HERO_COMBATANT_ID;
  if (!targetId) throw new Error("missing_dungeon_combat_target");
  const result = resolveCombatAttack(combatantById(combat, actorId), combatantById(combat, targetId), random);
  const combatants = combat.combatants.map((candidate) => candidate.id === targetId ? result.target : candidate);
  const targetDefeated = result.target.hp === 0;
  return {
    ...state,
    activeCombat: {
      ...combat,
      combatants,
      log: [...combat.log, result.log],
      currentTurn: targetDefeated ? combat.currentTurn : (combat.currentTurn + 1) % combat.initiative.length,
      outcome: targetDefeated ? targetId === HERO_COMBATANT_ID ? "defeat" : "victory" : null
    }
  };
}

// plugins/dungeon-maze/src/maze.ts
var MAZE_SIZE = 21;
var DEFAULT_GENERATION_CONFIG = {
  minionDensity: 50,
  chestDensity: 110,
  trapDensity: 150,
  campDensity: 150
};
var COMBAT_MINUTES_PER_ROUND = 0.5;
function snapshotDungeonMazeBranch(states, parentPath, branchPath) {
  if (states[branchPath]) return states;
  const parent = states[parentPath];
  return parent ? { ...states, [branchPath]: structuredClone(parent) } : states;
}
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 1831565813;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}
function randomIndex(random, length) {
  return Math.floor(random() * length);
}
function samePoint(a, b) {
  return a.x === b.x && a.y === b.y;
}
function hasLineOfSight(cells, from, to) {
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const dy = Math.abs(to.y - y);
  const stepX = x < to.x ? 1 : -1;
  const stepY = y < to.y ? 1 : -1;
  let error = dx - dy;
  while (x !== to.x || y !== to.y) {
    const twiceError = error * 2;
    if (twiceError > -dy) {
      error -= dy;
      x += stepX;
    }
    if (twiceError < dx) {
      error += dx;
      y += stepY;
    }
    if (x === to.x && y === to.y) return true;
    if (cells[y]?.[x] !== 1) return false;
  }
  return true;
}
function revealAround(cells, explored, point) {
  const next = explored.map((row) => [...row]);
  for (let y = point.y - 2; y <= point.y + 2; y += 1) {
    for (let x = point.x - 2; x <= point.x + 2; x += 1) {
      if (next[y]?.[x] !== void 0 && hasLineOfSight(cells, point, { x, y })) next[y][x] = true;
    }
  }
  return next;
}
function selectEntranceAndExit(width, height, random) {
  const validCells = [];
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) validCells.push({ x, y });
  }
  const minimumDistance = Math.max(width, height);
  while (true) {
    const entrance = validCells[randomIndex(random, validCells.length)];
    const exits = validCells.filter(
      (candidate) => Math.abs(entrance.x - candidate.x) + Math.abs(entrance.y - candidate.y) >= minimumDistance
    );
    if (exits.length > 0) {
      return { entrance, exit: exits[randomIndex(random, exits.length)] };
    }
  }
}
function carveMaze(width, height, entrance, exit, random) {
  const cells = Array.from({ length: height }, () => Array(width).fill(0));
  const visited = Array.from({ length: height }, () => Array(width).fill(false));
  const stack = [];
  let current = { ...entrance };
  cells[current.y][current.x] = 1;
  visited[current.y][current.x] = true;
  const directions = [
    { x: 0, y: -2, wallX: 0, wallY: -1 },
    { x: 0, y: 2, wallX: 0, wallY: 1 },
    { x: -2, y: 0, wallX: -1, wallY: 0 },
    { x: 2, y: 0, wallX: 1, wallY: 0 }
  ];
  while (true) {
    if (samePoint(current, exit)) {
      if (stack.length === 0) break;
      current = stack.pop();
      continue;
    }
    const neighbors = directions.flatMap((direction) => {
      const x = current.x + direction.x;
      const y = current.y + direction.y;
      if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1 || visited[y][x]) {
        return [];
      }
      return [{ x, y, wallX: current.x + direction.wallX, wallY: current.y + direction.wallY }];
    });
    if (neighbors.length === 0) {
      if (stack.length === 0) break;
      current = stack.pop();
      continue;
    }
    const next = neighbors[randomIndex(random, neighbors.length)];
    cells[next.wallY][next.wallX] = 1;
    cells[next.y][next.x] = 1;
    visited[next.y][next.x] = true;
    stack.push(current);
    current = { x: next.x, y: next.y };
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (cells[y][x] !== 0) continue;
      const horizontal = cells[y][x - 1] === 1 && cells[y][x + 1] === 1;
      const vertical = cells[y - 1][x] === 1 && cells[y + 1][x] === 1;
      if ((horizontal || vertical) && random() < 0.2) cells[y][x] = 1;
    }
  }
  return cells;
}
function placeEntities(cells, entrance, exit, random, generation) {
  const available = [];
  for (let y = 1; y < cells.length - 1; y += 1) {
    for (let x = 1; x < cells[y].length - 1; x += 1) {
      if (cells[y][x] === 1 && !samePoint({ x, y }, entrance) && !samePoint({ x, y }, exit)) {
        available.push({ x, y });
      }
    }
  }
  const entities = [{ id: "boss-1", kind: "boss", catalogId: "maze-dragon", ...exit }];
  const take = (kind, density) => {
    const count2 = Math.min(available.length, Math.round(cells.length * cells[0].length / density));
    for (let index = 0; index < count2; index += 1) {
      const point = available.splice(randomIndex(random, available.length), 1)[0];
      entities.push({
        id: `${kind}-${index + 1}`,
        kind,
        ...kind === "minion" ? { catalogId: "goblin-skirmisher" } : {},
        ...point
      });
    }
  };
  take("minion", generation.minionDensity);
  take("chest", generation.chestDensity);
  take("trap", generation.trapDensity);
  take("camp", generation.campDensity);
  return entities;
}
function createDungeonMaze(seed = Math.floor(Math.random() * 4294967295), generation = DEFAULT_GENERATION_CONFIG) {
  const random = seededRandom(seed);
  const { entrance, exit } = selectEntranceAndExit(MAZE_SIZE, MAZE_SIZE, random);
  const cells = carveMaze(MAZE_SIZE, MAZE_SIZE, entrance, exit, random);
  return {
    version: 7,
    width: MAZE_SIZE,
    height: MAZE_SIZE,
    seed,
    generation: { ...generation },
    cells,
    entrance,
    exit,
    hero: { ...entrance },
    elapsedMinutes: 0,
    restedMinutes: 0,
    resolvedEntityIds: [],
    activeEvent: null,
    activeCombat: null,
    explored: revealAround(
      cells,
      Array.from({ length: MAZE_SIZE }, () => Array(MAZE_SIZE).fill(false)),
      entrance
    ),
    entities: placeEntities(cells, entrance, exit, random, generation)
  };
}
function isVisibleToHero(state, x, y) {
  return Math.abs(state.hero.x - x) <= 2 && Math.abs(state.hero.y - y) <= 2 && hasLineOfSight(state.cells, state.hero, { x, y });
}
function moveDungeonHero(state, destination) {
  const dx = Math.abs(destination.x - state.hero.x);
  const dy = Math.abs(destination.y - state.hero.y);
  if (state.activeEvent || dx + dy !== 1 || state.cells[destination.y]?.[destination.x] !== 1) return null;
  const entity = state.entities.find(
    (candidate) => candidate.x === destination.x && candidate.y === destination.y && !state.resolvedEntityIds.includes(candidate.id)
  );
  return {
    ...state,
    hero: { ...destination },
    elapsedMinutes: state.elapsedMinutes + 1,
    activeEvent: entity ? createDungeonMapEvent(entity) : null,
    explored: revealAround(state.cells, state.explored, destination)
  };
}
function createDungeonMapEvent(entity) {
  if (entity.kind === "boss" || entity.kind === "minion") {
    const rounds = entity.kind === "boss" ? 10 : 6;
    return {
      entityId: entity.id,
      kind: "combat",
      optional: false,
      rounds,
      minutes: rounds * COMBAT_MINUTES_PER_ROUND
    };
  }
  if (entity.kind === "chest") return { entityId: entity.id, kind: "check", optional: true, minutes: 3 };
  if (entity.kind === "trap") return { entityId: entity.id, kind: "check", optional: false, minutes: 3 };
  return { entityId: entity.id, kind: "camp", optional: true, minutes: 30 };
}
function setDungeonCampRestMinutes(state, minutes) {
  const event = state.activeEvent;
  if (!event || event.kind !== "camp") return null;
  const rounded = Math.max(30, Math.round(minutes / 30) * 30);
  return { ...state, activeEvent: { ...event, minutes: rounded } };
}
function resolveDungeonMapEvent(state, resolution) {
  const event = state.activeEvent;
  if (!event || resolution === "skip" && !event.optional) return null;
  return {
    ...state,
    elapsedMinutes: state.elapsedMinutes + (resolution === "resolve" ? event.minutes : 0),
    restedMinutes: state.restedMinutes + (resolution === "resolve" && event.kind === "camp" ? event.minutes : 0),
    resolvedEntityIds: resolution === "resolve" && event.kind !== "camp" ? [...state.resolvedEntityIds, event.entityId] : state.resolvedEntityIds,
    activeEvent: null
  };
}
function completeDungeonCombat(state) {
  const combat = state.activeCombat;
  const event = state.activeEvent;
  if (!combat?.outcome || event?.kind !== "combat") return null;
  if (combat.outcome === "defeat") return { ...state, activeCombat: null };
  return {
    ...state,
    elapsedMinutes: state.elapsedMinutes + event.minutes,
    resolvedEntityIds: [...state.resolvedEntityIds, event.entityId],
    activeEvent: null,
    activeCombat: null
  };
}
function findDungeonPath(state, destination) {
  if (state.cells[destination.y]?.[destination.x] !== 1 || !state.explored[destination.y]?.[destination.x]) {
    return null;
  }
  const startKey = `${state.hero.x},${state.hero.y}`;
  const targetKey = `${destination.x},${destination.y}`;
  const previous = /* @__PURE__ */ new Map([[startKey, null]]);
  const queue = [{ ...state.hero }];
  const directions = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 }
  ];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (`${current.x},${current.y}` === targetKey) break;
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const key = `${next.x},${next.y}`;
      if (previous.has(key) || state.cells[next.y]?.[next.x] !== 1 || !state.explored[next.y]?.[next.x]) continue;
      previous.set(key, current);
      queue.push(next);
    }
  }
  if (!previous.has(targetKey)) return null;
  const path = [];
  for (let point = { ...destination }; point && `${point.x},${point.y}` !== startKey; ) {
    path.unshift(point);
    point = previous.get(`${point.x},${point.y}`) ?? null;
  }
  return path;
}
function isDungeonMazeState(value) {
  if (!value || typeof value !== "object") return false;
  const state = value;
  return state.version === 7 && state.width === MAZE_SIZE && state.height === MAZE_SIZE && Array.isArray(state.cells) && state.cells.length === MAZE_SIZE && typeof state.hero?.x === "number" && typeof state.hero?.y === "number" && Array.isArray(state.explored) && state.explored.length === MAZE_SIZE && Array.isArray(state.entities) && state.entities.every(
    (entity) => entity && typeof entity.id === "string" && typeof entity.kind === "string" && (entity.kind !== "minion" && entity.kind !== "boss" || typeof entity.catalogId === "string")
  ) && typeof state.seed === "number" && typeof state.elapsedMinutes === "number" && Number.isFinite(state.elapsedMinutes) && state.elapsedMinutes >= 0 && typeof state.restedMinutes === "number" && Number.isFinite(state.restedMinutes) && state.restedMinutes >= 0 && Array.isArray(state.resolvedEntityIds) && (state.activeEvent === null || typeof state.activeEvent === "object") && (state.activeCombat === null || typeof state.activeCombat === "object") && typeof state.generation?.minionDensity === "number" && typeof state.generation?.chestDensity === "number" && typeof state.generation?.trapDensity === "number" && typeof state.generation?.campDensity === "number";
}

// plugins/dungeon-maze/src/index.ts
var PLUGIN_ID = "dungeon-maze";
var PLACEMENT = "rightRail";
var STATE_KEY = "dungeonStates";
function tKey(host, key) {
  return host.pluginKey(key);
}
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function entityAt(state, x, y) {
  return state.entities.find((entity) => entity.x === x && entity.y === y && !state.resolvedEntityIds.includes(entity.id));
}
function entityGlyph(entity, state, x, y) {
  if (x === state.hero.x && y === state.hero.y) return "\u{1F9D9}";
  if (x === state.entrance.x && y === state.entrance.y) return "\u{1F6AA}";
  if (!entity) return "";
  if (entity.kind === "boss") return "\u{1F409}";
  if (entity.kind === "minion") return "\u{1F479}";
  if (entity.kind === "chest") return "\u{1F4E6}";
  if (entity.kind === "camp") return "\u{1F525}";
  return "\u{1FAA4}";
}
function renderMap(host, state) {
  const label = escapeHtml(host.t(tKey(host, "mapLabel")));
  return `<div class="dm-map-wrap"><canvas class="dm-map" width="420" height="420" tabindex="0" role="img" aria-label="${label}" data-plugin-canvas="maze" data-plugin-keyboard></canvas></div>`;
}
function count(state, kind) {
  return state.entities.filter((entity) => entity.kind === kind && !state.resolvedEntityIds.includes(entity.id)).length;
}
function renderActiveEvent(host, state) {
  const event = state.activeEvent;
  if (!event) return "";
  if (state.activeCombat) return renderCombat(host, state);
  const description = event.kind === "combat" ? host.t(tKey(host, "combatEvent"), { rounds: event.rounds ?? 1, minutes: event.minutes }) : event.kind === "check" ? host.t(tKey(host, "checkEvent"), { minutes: event.minutes }) : host.t(tKey(host, "campEvent"), { minutes: event.minutes });
  const resolveLabel = host.t(tKey(host, event.kind === "combat" ? "fight" : event.kind === "check" ? "check" : "rest"));
  const skip = event.optional ? `<button type="button" class="dm-secondary" data-plugin-action="event:skip">${escapeHtml(host.t(tKey(host, "skip")))}</button>` : "";
  const campControls = event.kind === "camp" ? `<div class="dm-rest-duration"><button type="button" class="dm-secondary" data-plugin-action="event:camp:-30">\u221230</button><span>${event.minutes}m</span><button type="button" class="dm-secondary" data-plugin-action="event:camp:+30">+30</button></div>` : "";
  return `<section class="dm-event"><p>${escapeHtml(description)}</p><div>${campControls}<button type="button" class="dm-primary" data-plugin-action="event:resolve">${escapeHtml(resolveLabel)}</button>${skip}</div></section>`;
}
function renderCombat(host, state) {
  const combat = state.activeCombat;
  const currentId = combat.initiative[combat.currentTurn]?.actorId;
  const current = combat.combatants.find((candidate) => candidate.id === currentId);
  const rows = combat.combatants.map(
    (combatant) => `<li>${escapeHtml(combatant.name)}: ${combatant.hp}/${combatant.hpMax} HP</li>`
  ).join("");
  const logs = combat.log.map(
    (entry) => `<li>${escapeHtml(entry.actorId)} \u2192 ${escapeHtml(entry.targetId)}: ${entry.hit ? `\u547D\u4E2D ${entry.damageTotal}` : "\u672A\u547D\u4E2D"}</li>`
  ).join("");
  const finished = combat.outcome !== null;
  const action = finished ? "combat:complete" : "combat:advance";
  const label = finished ? combat.outcome === "victory" ? "\u7ED3\u675F\u6218\u6597" : "\u7ED3\u675F\u6218\u6597\uFF08\u8D25\u5317\uFF09" : `${current?.name ?? "\u672A\u77E5"} \u884C\u52A8`;
  return `<section class="dm-event dm-combat"><p>\u6218\u6597${finished ? `\uFF1A${combat.outcome === "victory" ? "\u80DC\u5229" : "\u8D25\u5317"}` : "\u8FDB\u884C\u4E2D"}</p><ul>${rows}</ul><ol class="dm-combat-log">${logs}</ol><button type="button" class="dm-primary" data-plugin-action="${action}">${escapeHtml(label)}</button></section>`;
}
function renderPanel(host, state) {
  if (!state) {
    return [
      '<section class="dungeon-maze-panel">',
      `<p class="dm-empty">${escapeHtml(host.t(tKey(host, "empty")))}</p>`,
      `<button type="button" class="dm-primary" data-plugin-action="create">${escapeHtml(host.t(tKey(host, "create")))}</button>`,
      "</section>"
    ].join("\n");
  }
  return [
    '<section class="dungeon-maze-panel">',
    '<header class="dm-header">',
    `<div><h3>${escapeHtml(host.t(tKey(host, "title")))}</h3><p>${escapeHtml(host.t(tKey(host, "seed"), { seed: state.seed }))}</p></div>`,
    `<div class="dm-header-actions"><button type="button" class="dm-icon" data-plugin-action="reset" title="${escapeHtml(host.t(tKey(host, "reset")))}">\u21BB</button></div>`,
    "</header>",
    renderMap(host, state),
    renderActiveEvent(host, state),
    `<p class="dm-legend" data-plugin-live-text="elapsed">${escapeHtml(host.t(tKey(host, "elapsed"), { minutes: state.elapsedMinutes }))}</p>`,
    `<p class="dm-legend">${escapeHtml(host.t(tKey(host, "moveHint")))}</p>`,
    `<p class="dm-legend"><b>\u{1F9D9}</b> ${escapeHtml(host.t(tKey(host, "hero")))} \xB7 <b>\u{1F409}</b> ${escapeHtml(host.t(tKey(host, "boss")))} \xB7 <b>\u{1F479}</b> ${count(state, "minion")} \xB7 <b>\u{1F4E6}</b> ${count(state, "chest")} \xB7 <b>\u{1FAA4}</b> ${count(state, "trap")} \xB7 <b>\u{1F525}</b> ${count(state, "camp")}</p>`,
    "</section>"
  ].join("\n");
}
var STYLES = `
.dungeon-maze-panel{padding:10px;display:flex;flex-direction:column;gap:10px;min-width:0}
.dm-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.dm-header h3{margin:0;font-size:1rem}.dm-header p,.dm-legend,.dm-empty{margin:3px 0 0;font-size:.75rem;opacity:.7}
.dm-header-actions{display:flex;gap:4px}.dm-map-wrap{width:100%;min-width:0;overflow:hidden}.dm-map{display:block;box-sizing:border-box;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));background:oklch(.16 .015 55);cursor:pointer;touch-action:manipulation}.dm-map:focus-visible{outline:2px solid rgb(var(--v-theme-primary));outline-offset:2px}
.dm-event{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:6px;background:rgba(var(--v-theme-primary),.08)}.dm-event p{margin:0;font-size:.8rem}.dm-event>div,.dm-rest-duration{display:flex;align-items:center;gap:6px;flex-shrink:0}.dm-rest-duration span{min-width:36px;text-align:center;font-size:.75rem}.dm-primary,.dm-secondary,.dm-icon{border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:6px;color:rgb(var(--v-theme-on-surface));cursor:pointer}.dm-primary,.dm-icon{background:rgba(var(--v-theme-primary),.12)}.dm-primary,.dm-secondary{padding:7px 10px}.dm-icon{width:28px;height:28px;font-size:18px}.dm-secondary{background:transparent}.dm-primary:hover,.dm-icon:hover{background:rgba(var(--v-theme-primary),.22)}.dm-secondary:hover{background:rgba(var(--v-theme-on-surface),.08)}
`;
var revision = 0;
var keyboardMoveInFlight = false;
var autoMoveInFlight = false;
var autoMoveRun = 0;
var canvas = null;
var elapsedElement = null;
var canvasResizeObserver = null;
var pendingState = null;
var boundConversationId = "";
var boundBranchPath = "";
var stateWrite = Promise.resolve();
var combatHoldToken = null;
var ignoredStateSignatures = /* @__PURE__ */ new Set();
function discardTransientMaze() {
  autoMoveRun += 1;
  autoMoveInFlight = false;
  keyboardMoveInFlight = false;
  pendingState = null;
}
function acquireCombatHold(host) {
  if (!combatHoldToken) combatHoldToken = host.conversation.acquirePluginHold(PLUGIN_ID);
}
function releaseCombatHold(host) {
  if (!combatHoldToken) return;
  host.conversation.releasePluginHold(PLUGIN_ID, combatHoldToken);
  combatHoldToken = null;
}
function syncScope(conversationId, branchPath) {
  if (conversationId === boundConversationId && branchPath === boundBranchPath) return false;
  discardTransientMaze();
  boundConversationId = conversationId;
  boundBranchPath = branchPath;
  return true;
}
function fitCanvasToContainer() {
  if (!canvas) return;
  const container = canvas.parentElement;
  if (!container) return;
  const size = Math.max(210, container.clientWidth);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
}
function cancelAutoMove(host) {
  autoMoveRun += 1;
  autoMoveInFlight = false;
  if (pendingState && host.conversation.getId() === pendingState.conversationId) {
    void persistState(host, pendingState);
  }
}
function stateSignature(state) {
  return `${state.seed}:${state.hero.x}:${state.hero.y}:${state.elapsedMinutes}:${state.restedMinutes}:${state.resolvedEntityIds.join(",")}:${state.activeEvent?.entityId ?? ""}:${state.activeEvent?.minutes ?? ""}:${JSON.stringify(state.activeCombat)}:${state.explored.flat().map((value) => value ? "1" : "0").join("")}`;
}
function readStateBuckets(settings) {
  const raw = settings[STATE_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const states = {};
  for (const [branchPath, value] of Object.entries(raw)) {
    if (isDungeonMazeState(value)) states[branchPath] = value;
  }
  return states;
}
function persistState(host, scoped) {
  if (host.conversation.getId() !== scoped.conversationId) return stateWrite;
  pendingState = scoped;
  const signature = stateSignature(scoped.state);
  ignoredStateSignatures.add(signature);
  stateWrite = stateWrite.catch(() => void 0).then(async () => {
    if (host.conversation.getId() !== scoped.conversationId) return;
    const activeBranchPath = await host.conversation.getActiveBranchPath();
    if (host.conversation.getId() !== scoped.conversationId || activeBranchPath !== scoped.branchPath) return;
    const settings = await host.conversation.getPluginSettings();
    if (host.conversation.getId() !== scoped.conversationId) return;
    const states = readStateBuckets(settings);
    await host.conversation.patchPluginSettings({
      [STATE_KEY]: { ...states, [scoped.branchPath]: scoped.state }
    });
    if (host.conversation.getId() === scoped.conversationId && pendingState && pendingState.conversationId === scoped.conversationId && pendingState.branchPath === scoped.branchPath && stateSignature(pendingState.state) === signature) {
      pendingState = null;
    }
  });
  return stateWrite;
}
async function mutateState(host, mutate, after) {
  const scoped = await readState(host);
  if (!scoped || host.conversation.getId() !== scoped.conversationId) return;
  const next = mutate(scoped.state);
  if (!next) return;
  if (host.conversation.getId() !== scoped.conversationId) return;
  await persistState(host, { ...scoped, state: next });
  if (host.conversation.getId() !== scoped.conversationId) return;
  await after(next);
}
function drawMaze(host, state) {
  if (elapsedElement) elapsedElement.textContent = host.t(tKey(host, "elapsed"), { minutes: state.elapsedMinutes });
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const cellSize = canvas.width / state.width;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '16px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const left = x * cellSize;
      const top = y * cellSize;
      const explored = state.explored[y][x];
      const open = state.cells[y][x] === 1;
      context.fillStyle = !explored ? "oklch(.23 .018 55)" : open ? "oklch(.78 .05 82)" : "oklch(.16 .015 55)";
      context.fillRect(left, top, cellSize, cellSize);
      if (isVisibleToHero(state, x, y)) {
        context.strokeStyle = "oklch(.78 .04 82 / .2)";
        context.strokeRect(left + 0.5, top + 0.5, cellSize - 1, cellSize - 1);
      }
      const movable = open && isVisibleToHero(state, x, y) && Math.abs(state.hero.x - x) + Math.abs(state.hero.y - y) === 1;
      if (movable) {
        context.strokeStyle = "oklch(.65 .16 40)";
        context.lineWidth = 2;
        context.strokeRect(left + 1, top + 1, cellSize - 2, cellSize - 2);
      }
      if (!explored) continue;
      const glyph = entityGlyph(entityAt(state, x, y), state, x, y);
      if (glyph) context.fillText(glyph, left + cellSize / 2, top + cellSize / 2 + 1);
    }
  }
}
async function readState(host) {
  const conversationId = host.conversation.getId();
  const branchPath = await host.conversation.getActiveBranchPath();
  if (host.conversation.getId() !== conversationId) return null;
  if (syncScope(conversationId, branchPath)) releaseCombatHold(host);
  if (pendingState && pendingState.conversationId === conversationId && pendingState.branchPath === branchPath) return pendingState;
  const settings = await host.conversation.getPluginSettings();
  if (host.conversation.getId() !== conversationId) return null;
  const state = readStateBuckets(settings)[branchPath];
  return state ? { state, conversationId, branchPath } : null;
}
async function refreshPanel(host) {
  const scoped = await readState(host);
  if (scoped?.state.activeCombat) acquireCombatHold(host);
  host.ui.panel.setHtml(PLACEMENT, PLUGIN_ID, renderPanel(host, scoped?.state ?? null), { revision: ++revision });
}
async function createMaze(host) {
  const conversationId = host.conversation.getId();
  discardTransientMaze();
  const branchPath = await host.conversation.getActiveBranchPath();
  if (host.conversation.getId() !== conversationId) return;
  syncScope(conversationId, branchPath);
  const state = createDungeonMaze();
  await persistState(host, { state, conversationId, branchPath });
  if (host.conversation.getId() !== conversationId) return;
  await refreshPanel(host);
  host.ui.notify(host.t(tKey(host, "created")), void 0, { level: "success" });
}
async function moveHero(host, x, y) {
  await mutateState(host, (state) => moveDungeonHero(state, { x, y }), async (next) => {
    if (next.activeEvent) await refreshPanel(host);
    else drawMaze(host, next);
  });
}
async function resolveActiveEvent(host, resolution) {
  await mutateState(host, (state) => {
    if (state.activeEvent?.kind === "combat" && resolution === "resolve") {
      return beginDungeonCombat(state, DEFAULT_DUNGEON_CATALOG);
    }
    return resolveDungeonMapEvent(state, resolution);
  }, (next) => {
    if (next.activeCombat) acquireCombatHold(host);
    return refreshPanel(host);
  });
}
async function advanceCombat(host) {
  await mutateState(host, (state) => advanceDungeonCombat(state), () => refreshPanel(host));
}
async function completeCombat(host) {
  await mutateState(host, completeDungeonCombat, (next) => {
    if (!next.activeCombat) releaseCombatHold(host);
    return refreshPanel(host);
  });
}
async function adjustCampRest(host, delta) {
  await mutateState(host, (state) => {
    if (!state.activeEvent) return null;
    return setDungeonCampRestMinutes(state, state.activeEvent.minutes + delta);
  }, () => refreshPanel(host));
}
async function moveHeroToExplored(host, x, y) {
  const run = ++autoMoveRun;
  autoMoveInFlight = true;
  try {
    const scoped = await readState(host);
    if (!scoped || run !== autoMoveRun || host.conversation.getId() !== scoped.conversationId) return;
    const { conversationId, branchPath } = scoped;
    const path = findDungeonPath(scoped.state, { x, y });
    if (!path?.length) return;
    let next = scoped.state;
    for (const point of path) {
      if (run !== autoMoveRun || host.conversation.getId() !== conversationId) return;
      const moved = moveDungeonHero(next, point);
      if (!moved) return;
      next = moved;
      pendingState = { state: next, conversationId, branchPath };
      drawMaze(host, next);
      if (next.activeEvent) {
        await persistState(host, { state: next, conversationId, branchPath });
        if (host.conversation.getId() === conversationId) await refreshPanel(host);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
    if (run !== autoMoveRun || host.conversation.getId() !== conversationId) return;
    await persistState(host, { state: next, conversationId, branchPath });
    if (host.conversation.getId() === conversationId) drawMaze(host, next);
  } finally {
    if (run === autoMoveRun) autoMoveInFlight = false;
  }
}
function movementForKey(key) {
  switch (key.toLowerCase()) {
    case "w":
    case "arrowup":
      return { x: 0, y: -1 };
    case "s":
    case "arrowdown":
      return { x: 0, y: 1 };
    case "a":
    case "arrowleft":
      return { x: -1, y: 0 };
    case "d":
    case "arrowright":
      return { x: 1, y: 0 };
    default:
      return null;
  }
}
function register(host) {
  host.registerStyles(STYLES);
  host.ui.panel.register({
    placement: PLACEMENT,
    pluginId: PLUGIN_ID,
    tabIcon: "mdi-grid-large",
    tabLabelKey: tKey(host, "title"),
    interactive: true
  });
  host.registerSlotButton("composer-toolbar", {
    id: `${PLUGIN_ID}-open`,
    icon: "mdi-grid-large",
    tooltipKey: tKey(host, "open"),
    onClick: () => {
      host.ui.panel.open(PLACEMENT, PLUGIN_ID);
      void refreshPanel(host);
    }
  });
  host.lifecycle.onTurnDataChanged(() => {
    void refreshPanel(host);
  });
  host.lifecycle.onBranchCreated(async (event) => {
    if (event.conversationId !== host.conversation.getId()) return;
    const settings = await host.conversation.getPluginSettings();
    if (event.conversationId !== host.conversation.getId()) return;
    const states = readStateBuckets(settings);
    const nextStates = snapshotDungeonMazeBranch(
      states,
      event.parentBranchPath,
      event.branchPath
    );
    if (nextStates === states) return;
    await host.conversation.patchPluginSettings({ [STATE_KEY]: nextStates });
  });
  host.ui.panel.onEvent(PLACEMENT, PLUGIN_ID, {
    onAction: (event) => {
      if (event.action === "create" || event.action === "reset") void createMaze(host);
      if (event.action === "event:resolve") void resolveActiveEvent(host, "resolve");
      if (event.action === "event:skip") void resolveActiveEvent(host, "skip");
      if (event.action === "combat:advance") void advanceCombat(host);
      if (event.action === "combat:complete") void completeCombat(host);
      const campAdjustment = /^event:camp:([+-]\d+)$/.exec(event.action);
      if (campAdjustment) void adjustCampRest(host, Number(campAdjustment[1]));
      const match = /^move:(\d+):(\d+)$/.exec(event.action);
      if (match) void moveHero(host, Number(match[1]), Number(match[2]));
    },
    onKeydown: (event) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return false;
      if (event.key === "Escape" && autoMoveInFlight) {
        cancelAutoMove(host);
        return true;
      }
      const delta = movementForKey(event.key);
      if (!delta) return false;
      if (keyboardMoveInFlight) return true;
      if (autoMoveInFlight) {
        cancelAutoMove(host);
        return true;
      }
      keyboardMoveInFlight = true;
      void (async () => {
        try {
          const scoped = await readState(host);
          if (scoped) await moveHero(host, scoped.state.hero.x + delta.x, scoped.state.hero.y + delta.y);
        } finally {
          keyboardMoveInFlight = false;
        }
      })();
      return true;
    },
    onCanvasMounted: (event) => {
      if (event.canvasId !== "maze") return;
      canvasResizeObserver?.disconnect();
      canvas = event.canvas;
      fitCanvasToContainer();
      const container = canvas.parentElement;
      if (container && typeof ResizeObserver !== "undefined") {
        canvasResizeObserver = new ResizeObserver(() => fitCanvasToContainer());
        canvasResizeObserver.observe(container);
      }
      void readState(host).then((state) => {
        if (state) drawMaze(host, state.state);
      });
    },
    onLiveTextMounted: (event) => {
      if (event.textId !== "elapsed") return;
      elapsedElement = event.element;
      void readState(host).then((state) => {
        if (state) drawMaze(host, state.state);
      });
    },
    onPointer: (event) => {
      if (event.canvasId !== "maze") return;
      if (autoMoveInFlight) {
        cancelAutoMove(host);
        return;
      }
      void moveHeroToExplored(host, Math.floor(event.x / 20), Math.floor(event.y / 20));
    }
  });
  host.conversation.onPluginSettingsChanged((settings) => {
    const rawStates = readStateBuckets(settings);
    const state = rawStates[boundBranchPath];
    if (state && ignoredStateSignatures.delete(stateSignature(state))) drawMaze(host, state);
    void refreshPanel(host);
  });
  void refreshPanel(host);
}
export {
  register
};
