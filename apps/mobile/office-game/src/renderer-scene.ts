import { getSheet } from './sprite-sheet';
import type { Character } from './character';
import {
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  TileType,
  deskAssignments,
  furnitureList,
  tileMap,
  tileToPixel,
  waypointMap,
} from './world';
import { getChannelConnectionStatus, getChannelLabelForSlot, isDeskLabelHidden } from './bridge';
import { drawSpriteAt, getFrameSafe } from './renderer-shared';

const tileToSpriteName: Record<number, string> = {
  [TileType.Floor]: 'floor_plain',
  [TileType.Carpet]: 'carpet',
  [TileType.Wall]: 'wall',
  [TileType.WallTop]: 'wall_top',
  [TileType.WallLeft]: 'wall_left',
  [TileType.WallRight]: 'wall_right',
  [TileType.WindowWall]: 'wall_window',
  [TileType.WindowWallRight]: 'wall_window_right',
  [TileType.WindowWallTop]: 'wall_window_top',
  [TileType.WindowWallBottom]: 'wall_window_bottom',
  [TileType.DoorWall]: 'wall_door',
  [TileType.KitchenTile]: 'kitchen_tile',
  [TileType.Grass]: 'grass',
  [TileType.Pavement]: 'pavement',
  [TileType.Tree]: 'tree',
};

const furnitureTypeToSprite: Record<string, string> = {
  desk_only: 'desk_only',
  boss_desk_only: 'boss_desk_only',
  secretary_desk_only: 'secretary_desk_only',
  monitor: 'monitor_standalone_blue',
  bookshelf: 'bookshelf',
  filing_cabinet: 'filing_cabinet',
  chair: 'chair_front',
  foosball: 'foosball',
  coffee_machine: 'coffee_machine',
  plant: 'plant_1',
  plant_1: 'plant_1',
  plant_2: 'plant_2',
  plant_3: 'plant_3',
  table: 'desk',
  tree: 'tree',
  car: 'car',
  bench: 'bench',
  signal_tower: 'signal_tower',
  office_clock: 'office_clock',
  whiteboard: 'whiteboard',
  mailbox: 'mailbox',
  wall_calendar: 'wall_calendar',
  toolbox: 'toolbox',
};

const monitorAnimFrames = ['monitor_standalone_blue', 'monitor_standalone_green', 'monitor_standalone_bright'];
const CHANNEL_WORKER_IDS: ReadonlySet<string> = new Set(['channel1', 'channel2', 'channel3', 'channel4']);

const fixedDeskLabels: Record<string, string> = {
  boss: 'Boss',
  assistant: 'Secy',
  subagent: 'Sub-agt',
  cron: 'Cron',
};

interface YSortable {
  sortY: number;
  draw: () => void;
}

interface Workstation {
  chairIdx: number;
  deskIdx: number;
  monitorIdx: number;
  characterId: string;
}

const workstations = buildWorkstations();
const workstationFurnitureIndices = new Set<number>();
for (const ws of workstations) {
  workstationFurnitureIndices.add(ws.chairIdx);
  workstationFurnitureIndices.add(ws.deskIdx);
  if (ws.monitorIdx >= 0) workstationFurnitureIndices.add(ws.monitorIdx);
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  screenAnimIndex: number,
  getSeatedBobOffset: (characterId: string) => number,
): void {
  drawFloor(ctx);
  drawFurnitureAndCharacters(ctx, characters, screenAnimIndex, getSeatedBobOffset);
}

export function resolveDeskHitCharacter(
  point: { x: number; y: number },
  characters: Character[],
): Character | null {
  for (const ws of workstations) {
    const wpKey = deskAssignments[ws.characterId];
    const wp = waypointMap[wpKey];
    if (!wp) continue;
    const desk = furnitureList[ws.deskIdx];
    if (!desk) continue;
    const left = desk.x * TILE_SIZE;
    const right = (desk.x + desk.tileWidth) * TILE_SIZE;
    const top = (wp.y + 1) * TILE_SIZE;
    const bottom = (wp.y + 2) * TILE_SIZE;
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
      return characters.find((c) => c.id === ws.characterId) ?? null;
    }
  }
  return null;
}

function drawFloor(ctx: CanvasRenderingContext2D): void {
  const sheet = getSheet('tiles');
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const spriteName = tileToSpriteName[tileMap[row][col]];
      if (!spriteName) continue;
      const frame = getFrameSafe('tiles', spriteName);
      if (!frame) continue;
      const { x, y } = tileToPixel(col, row);
      drawSpriteAt(ctx, sheet, frame, x, y);
    }
  }
}

function drawFurnitureAndCharacters(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  screenAnimIndex: number,
  getSeatedBobOffset: (characterId: string) => number,
): void {
  const furnitureSheet = getSheet('furniture');
  const charSheet = getSheet('characters');
  const charById = new Map<string, Character>();
  for (const c of characters) charById.set(c.id, c);

  const sortedWorkstations = [...workstations].sort((a, b) => furnitureList[a.deskIdx].y - furnitureList[b.deskIdx].y);
  for (const ws of sortedWorkstations) {
    const chair = furnitureList[ws.chairIdx];
    const desk = furnitureList[ws.deskIdx];
    const chairSprite = furnitureTypeToSprite[chair.type];
    if (chairSprite) {
      const chairFrame = getFrameSafe('furniture', chairSprite);
      if (!chairFrame) continue;
      const chairPos = tileToPixel(chair.x, chair.y);
      drawSpriteAt(
        ctx,
        furnitureSheet,
        chairFrame,
        chairPos.x + (chair.offsetX ?? 0),
        chairPos.y + TILE_SIZE - chairFrame.h + (chair.offsetY ?? 0),
      );
    }

    const character = charById.get(ws.characterId);
    if (character && character.visible && character.state === 'working' && character.currentFrame) {
      const frame = character.currentFrame;
      const dx = Math.round(character.px + (TILE_SIZE - frame.w) / 2);
      const dy = Math.round(character.py + getSeatedBobOffset(character.id));
      drawSpriteAt(ctx, charSheet, frame, dx, dy);
    }

    const deskSprite = furnitureTypeToSprite[desk.type];
    if (deskSprite) {
      const deskFrame = getFrameSafe('furniture', deskSprite);
      if (!deskFrame) continue;
      const deskPos = tileToPixel(desk.x, desk.y);
      const deskDx = deskPos.x + (desk.offsetX ?? 0);
      const deskDy = deskPos.y + TILE_SIZE - deskFrame.h + (desk.offsetY ?? 0);
      drawSpriteAt(ctx, furnitureSheet, deskFrame, deskDx, deskDy);

      const label = shortDeskLabel(ws.characterId);
      if (label) {
        ctx.save();
        ctx.font = 'bold 6px monospace';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, deskDx + deskFrame.w / 2, deskDy + deskFrame.h - 7);
        ctx.restore();
      }
    }

    if (ws.monitorIdx >= 0) {
      const monitor = furnitureList[ws.monitorIdx];
      const char = charById.get(ws.characterId);
      const monitorSpriteName = (char?.forceWork ?? false) ? monitorAnimFrames[screenAnimIndex] : 'monitor_standalone_off';
      const monitorFrame = getFrameSafe('furniture', monitorSpriteName) ?? getFrameSafe('furniture', 'monitor_standalone_blue');
      if (!monitorFrame) continue;
      const monitorPos = tileToPixel(monitor.x, monitor.y);
      drawSpriteAt(
        ctx,
        furnitureSheet,
        monitorFrame,
        monitorPos.x + (TILE_SIZE - monitorFrame.w) / 2 + (monitor.offsetX ?? 0),
        monitorPos.y + TILE_SIZE - monitorFrame.h - 6 + (monitor.offsetY ?? 0),
      );

      let lampSprite: string | null = null;
      if (CHANNEL_WORKER_IDS.has(ws.characterId)) {
        const connStatus = getChannelConnectionStatus(ws.characterId);
        lampSprite = connStatus === 'connected' ? 'desk_lamp_on'
          : connStatus === 'configured' ? 'desk_lamp_dim'
          : 'desk_lamp_off';
      } else if (ws.characterId === 'subagent' || ws.characterId === 'cron') {
        lampSprite = 'desk_lamp_on';
      }
      if (lampSprite) {
        const lampFrame = getFrameSafe('furniture', lampSprite);
        const deskFrame = getFrameSafe('furniture', deskSprite);
        if (lampFrame && deskFrame) {
          const deskPos = tileToPixel(desk.x, desk.y);
          const deskDx = deskPos.x + (desk.offsetX ?? 0);
          const deskDy = deskPos.y + TILE_SIZE - deskFrame.h + (desk.offsetY ?? 0);
          drawSpriteAt(ctx, furnitureSheet, lampFrame, deskDx + 2, deskDy - 3);
        }
      }
    }
  }

  const items: YSortable[] = [];
  for (let fi = 0; fi < furnitureList.length; fi++) {
    if (workstationFurnitureIndices.has(fi)) continue;
    const furniture = furnitureList[fi];
    let spriteName = furnitureTypeToSprite[furniture.type];
    if (!spriteName) continue;
    const frame = getFrameSafe('furniture', spriteName)
      ?? (furniture.type === 'office_clock' ? getFrameSafe('furniture', 'coffee_machine') : null);
    if (!frame) continue;

    const { x, y } = tileToPixel(furniture.x, furniture.y);
    const fx = x + (furniture.offsetX ?? 0);
    const fy = y + (furniture.offsetY ?? 0);
    items.push({
      sortY: fy + frame.h,
      draw: () => drawSpriteAt(ctx, furnitureSheet, frame, fx, fy),
    });
  }

  for (const character of characters) {
    if (character.state === 'working' || !character.visible || !character.currentFrame) continue;
    const frame = character.currentFrame;
    const dx = Math.round(character.px + (TILE_SIZE - frame.w) / 2);
    const dy = Math.round(character.py + TILE_SIZE - frame.h);
    items.push({
      sortY: character.py + TILE_SIZE,
      draw: () => drawSpriteAt(ctx, charSheet, frame, dx, dy),
    });
  }

  items.sort((a, b) => a.sortY - b.sortY);
  for (const item of items) item.draw();
}

function buildWorkstations(): Workstation[] {
  const result: Workstation[] = [];
  for (const [charId, wpKey] of Object.entries(deskAssignments)) {
    const wp = waypointMap[wpKey];
    if (!wp) continue;

    let chairIdx = -1;
    let deskIdx = -1;
    let monitorIdx = -1;
    for (let i = 0; i < furnitureList.length; i++) {
      const f = furnitureList[i];
      if (f.type === 'chair' && f.x === wp.x && f.y === wp.y) chairIdx = i;
      if (f.type.includes('desk_only') && f.y === wp.y + 1 && wp.x >= f.x && wp.x < f.x + f.tileWidth) deskIdx = i;
      if (f.type === 'monitor' && f.y === wp.y + 1 && f.x === wp.x) monitorIdx = i;
    }
    if (chairIdx >= 0 && deskIdx >= 0) {
      result.push({ chairIdx, deskIdx, monitorIdx, characterId: charId });
    }
  }
  return result;
}

function shortDeskLabel(characterId: string): string | null {
  if (isDeskLabelHidden(characterId)) return null;
  if (fixedDeskLabels[characterId]) return fixedDeskLabels[characterId];
  const channelLabel = getChannelLabelForSlot(characterId);
  if (!channelLabel || channelLabel === characterId) return null;
  if (channelLabel.toLowerCase() === 'telegram') return 'TG';
  if (channelLabel.length <= 8) return channelLabel;
  return `${channelLabel.slice(0, 7)}.`;
}
