// Canvas 2D renderer: owns canvas lifecycle, input handling, and render pipeline orchestration.

import { getSheet } from "./sprite-sheet";
import type { Character } from "./character";
import {
  WORLD_HEIGHT,
  WORLD_WIDTH,
  TILE_SIZE,
  furnitureList,
  tileToPixel,
} from "./world";
import {
  getGatewayState,
  isOfficeActionDisabled,
  isOfficeCharacterDisabled,
  postToRN,
  triggerOfficeClockRecall,
  EVENING_START_HOUR,
  EVENING_END_HOUR,
} from "./bridge";
import {
  isMenuOpen,
  openCharacterMenu,
  handleMenuTap,
  handleMenuTouchStart,
  handleMenuTouchMove,
  handleMenuTouchEnd,
  drawMenu,
} from "./menu";
import { getActiveBubble, handleBubbleTap } from "./bubble-scheduler";
import { getFrameSafe, resolveDrawPosition } from "./renderer-shared";
import { drawScene, resolveDeskHitCharacter } from "./renderer-scene";
import { drawOverlays } from "./renderer-overlays";

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let latestCharacters: Character[] = [];
let lastTapAtMs = 0;
let seatedBobFrame = 0;
let seatedBobTimer = 0;
let screenAnimIndex = 0;
let screenAnimTimer = 0;
let sweatAnimFrame = 0;
let sweatAnimTimer = 0;

const VIRTUAL_WIDTH = WORLD_WIDTH;
const VIRTUAL_HEIGHT = WORLD_HEIGHT;
const TOP_GRASS_CROP_PX = 0;

export function initRenderer(canvasEl: HTMLCanvasElement): void {
  canvas = canvasEl;
  canvas.width = VIRTUAL_WIDTH;
  canvas.height = VIRTUAL_HEIGHT;
  ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  resizeCanvasForViewport();
  canvas.style.imageRendering = "pixelated";
  canvas.style.imageRendering = "crisp-edges";
  canvas.style.touchAction = "none";
  canvas.style.display = "block";

  const handleResize = () => resizeCanvasForViewport();
  window.addEventListener("resize", handleResize);
  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener("resize", handleResize);

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const p = toCanvasPoint(e.clientX, e.clientY);
    handleMenuTouchStart(p.x, p.y);
  });
  canvas.addEventListener("pointermove", (e) => {
    e.preventDefault();
    const p = toCanvasPoint(e.clientX, e.clientY);
    handleMenuTouchMove(p.x, p.y);
  });
  canvas.addEventListener("pointerup", (e) => {
    e.preventDefault();
    handleMenuTouchEnd();
    handleTap(e.clientX, e.clientY);
  });
  canvas.addEventListener("pointercancel", () => handleMenuTouchEnd());
}

function resizeCanvasForViewport(): void {
  if (!canvas) return;
  const viewportWidth = window.innerWidth || VIRTUAL_WIDTH;
  const scale = viewportWidth / VIRTUAL_WIDTH;
  const cssWidth = Math.max(1, Math.floor(VIRTUAL_WIDTH * scale));
  const cssHeight = Math.max(1, Math.floor(VIRTUAL_HEIGHT * scale));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
}

export function render(characters: Character[]): void {
  latestCharacters = characters;
  advanceEffects();

  ctx.clearRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
  ctx.save();
  ctx.translate(0, -TOP_GRASS_CROP_PX);
  drawScene(ctx, characters, screenAnimIndex, getSeatedBobOffset);
  drawOverlays(
    ctx,
    characters,
    VIRTUAL_WIDTH,
    getSeatedBobOffset,
    sweatAnimFrame,
  );
  ctx.restore();
  drawEveningOverlay(ctx, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
  drawMenu(ctx, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
}

/**
 * Warm amber overlay for evening hours (18:00–22:00).
 * Fades in over 18:00–18:30 and fades out over 21:30–22:00.
 * Peak opacity ~10% so the scene stays readable.
 */
function drawEveningOverlay(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const date = new Date();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const minuteOfDay = hour * 60 + minute;

  const FADE_IN_START  = EVENING_START_HOUR * 60;
  const FADE_IN_END    = EVENING_START_HOUR * 60 + 30;
  const FADE_OUT_START = (EVENING_END_HOUR - 1) * 60 + 30;
  const FADE_OUT_END   = EVENING_END_HOUR * 60;
  const MAX_ALPHA = 0.1;

  let alpha = 0;
  if (minuteOfDay >= FADE_IN_START && minuteOfDay < FADE_IN_END) {
    alpha =
      ((minuteOfDay - FADE_IN_START) / (FADE_IN_END - FADE_IN_START)) *
      MAX_ALPHA;
  } else if (minuteOfDay >= FADE_IN_END && minuteOfDay < FADE_OUT_START) {
    alpha = MAX_ALPHA;
  } else if (minuteOfDay >= FADE_OUT_START && minuteOfDay < FADE_OUT_END) {
    alpha =
      ((FADE_OUT_END - minuteOfDay) / (FADE_OUT_END - FADE_OUT_START)) *
      MAX_ALPHA;
  }

  if (alpha <= 0) return;
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = "#ff8c40";
  c.fillRect(0, 0, w, h);
  c.restore();
}

function advanceEffects(): void {
  screenAnimTimer++;
  if (screenAnimTimer >= 15) {
    screenAnimTimer = 0;
    screenAnimIndex = (screenAnimIndex + 1) % 3;
  }

  seatedBobTimer++;
  if (seatedBobTimer >= 6) {
    seatedBobTimer = 0;
    seatedBobFrame = (seatedBobFrame + 1) % 2;
  }

  sweatAnimTimer++;
  if (sweatAnimTimer >= 3) {
    sweatAnimTimer = 0;
    sweatAnimFrame = (sweatAnimFrame + 1) % 3;
  }
}

function getSeatedBobOffset(characterId: string): number {
  const phase = (characterId.length + characterId.charCodeAt(0)) % 2;
  return (seatedBobFrame + phase) % 2 === 0 ? 0 : -1;
}

function toCanvasPoint(
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (VIRTUAL_WIDTH / rect.width),
    y: (clientY - rect.top) * (VIRTUAL_HEIGHT / rect.height),
  };
}

function handleTap(clientX: number, clientY: number): void {
  const now = Date.now();
  if (now - lastTapAtMs < 180) return;
  lastTapAtMs = now;

  const point = toCanvasPoint(clientX, clientY);
  if (handleBubbleTap(point.x, point.y)) return;
  if (isMenuOpen()) {
    handleMenuTap(point.x, point.y);
    return;
  }

  const scenePoint = {
    x: point.x,
    y: point.y + TOP_GRASS_CROP_PX,
  };

  if (hitTestOfficeClock(scenePoint)) {
    postToRN({ type: "HAPTIC" });
    triggerOfficeClockRecall();
    return;
  }

  const propAction = resolvePropAction(scenePoint);
  if (propAction && !isOfficeActionDisabled(propAction.action)) {
    postToRN({ type: "HAPTIC" });
    postToRN(propAction);
    return;
  }

  const character =
    hitTestCharacter(scenePoint) ?? resolveDeskHitCharacter(scenePoint, latestCharacters);
  if (!character) return;
  if (isOfficeCharacterDisabled(character.id)) return;
  postToRN({ type: "HAPTIC" });
  openCharacterMenu(character.id, character);
}

function hitTestCharacter(point: { x: number; y: number }): Character | null {
  const hitPadding = 4;
  let picked: { character: Character; depth: number } | null = null;

  for (const character of latestCharacters) {
    if (!character.visible || !character.currentFrame) continue;
    const { dx, dy } = resolveDrawPosition(
      character,
      character.currentFrame,
      getSeatedBobOffset(character.id),
    );
    const left = dx - hitPadding;
    const top = dy - hitPadding;
    const right = dx + character.currentFrame.w + hitPadding;
    const bottom = dy + character.currentFrame.h + hitPadding;
    if (point.x < left || point.x > right || point.y < top || point.y > bottom)
      continue;
    if (!picked || bottom >= picked.depth)
      picked = { character, depth: bottom };
  }

  return picked?.character ?? null;
}

function hitTestOfficeClock(point: { x: number; y: number }): boolean {
  const item = furnitureList.find((f) => f.type === "office_clock");
  const frame =
    getFrameSafe("furniture", "office_clock") ??
    getFrameSafe("furniture", "coffee_machine");
  return hitTestFurnitureItem(point, item, frame);
}

function resolvePropAction(point: {
  x: number;
  y: number;
}): { type: "MENU_ACTION"; action: string; characterId: string; source: "prop" } | null {
  const mappings: Array<{ type: string; action: string }> = [
    { type: "filing_cabinet", action: "memory" },
    { type: "mailbox", action: "connections" },
    {
      type: "whiteboard",
      action: getGatewayState() === "none" ? "status" : "status",
    },
    { type: "bookshelf", action: "skills" },
    { type: "coffee_machine", action: "logs" },
    { type: "wall_calendar", action: "management" },
    { type: "toolbox", action: "tools" },
    { type: "signal_tower", action: "node_devices" },
    { type: "car", action: "add_gateway" },
  ];

  for (const mapping of mappings) {
    const items = furnitureList.filter((f) => f.type === mapping.type);
    const frame = getFrameSafe("furniture", mapping.type);
    if (items.some((item) => hitTestFurnitureItem(point, item, frame))) {
      return {
        type: "MENU_ACTION",
        action: mapping.action,
        characterId: "assistant",
        source: "prop",
      };
    }
  }
  return null;
}

function hitTestFurnitureItem(
  point: { x: number; y: number },
  item: (typeof furnitureList)[number] | undefined,
  frame: ReturnType<typeof getFrameSafe>,
): boolean {
  if (!item || !frame) return false;
  const base = tileToPixel(item.x, item.y);
  const dx = base.x + (item.offsetX ?? 0);
  const dy = base.y + (item.offsetY ?? 0);
  const hitPadding = 3;
  return (
    point.x >= dx - hitPadding &&
    point.x <= dx + frame.w + hitPadding &&
    point.y >= dy - hitPadding &&
    point.y <= dy + frame.h + hitPadding
  );
}
