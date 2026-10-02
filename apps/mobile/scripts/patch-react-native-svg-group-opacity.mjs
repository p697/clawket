import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reviewed against react-native-svg 15.15.4 (15.15.3 and 15.15.5 carry the same GroupView).
// A <G> whose opacity is not 1 draws its children into an offscreen layer canvas (upstream
// #2450), but while its opacity is 1 it keeps the canvas it was drawn into in that same field.
// When its opacity leaves 1 again it calls setBitmap on that canvas. If the canvas is a
// translucent ancestor's layer, setBitmap empties the ancestor's save stack in the middle of
// its draw, and the ancestor's restore() throws "Underflow in restore - more restores than
// saves" (Fetch loading scene: a dirt <G> fading inside the hidden mound <G>). The patched
// group draws into a local canvas, so the field only ever holds the group's own layer canvas.
const before = `    final RectF groupRect = new RectF();

    if (mOpacity != 1) {
      if (mLayerBitmap == null) {
        mLayerBitmap =
            Bitmap.createBitmap(canvas.getWidth(), canvas.getHeight(), Bitmap.Config.ARGB_8888);
        mLayerCanvas = new Canvas(mLayerBitmap);
      } else {
        mLayerBitmap.recycle();
        mLayerBitmap =
            Bitmap.createBitmap(canvas.getWidth(), canvas.getHeight(), Bitmap.Config.ARGB_8888);
        mLayerCanvas.setBitmap(mLayerBitmap);
      }
      // Copy current matrix from original canvas
      mLayerCanvas.save();
      mLayerCanvas.setMatrix(canvas.getMatrix());
    } else {
      mLayerCanvas = canvas;
    }

    elements = new ArrayList<>();
    for (int i = 0; i < getChildCount(); i++) {
      View child = getChildAt(i);
      if (child instanceof MaskView || child instanceof ClipPathView) {
        ((RenderableView) child).mergeProperties(self);
        continue;
      }
      if (child instanceof VirtualView) {
        VirtualView node = ((VirtualView) child);
        if ("none".equals(node.mDisplay)) {
          continue;
        }
        if (node instanceof RenderableView) {
          ((RenderableView) node).mergeProperties(self);
        }

        int count = node.saveAndSetupCanvas(mLayerCanvas, mCTM);
        node.render(mLayerCanvas, paint, opacity);
        RectF r = node.getClientRect();

        if (r != null) {
          groupRect.union(r);
        }

        node.restoreCanvas(mLayerCanvas, count);

        if (node instanceof RenderableView) {
          ((RenderableView) node).resetProperties();
        }

        if (node.isResponsible()) {
          svg.enableTouchEvents();
        }

        if (node.elements != null) {
          elements.addAll(node.elements);
        }

      } else if (child instanceof SvgView) {
        SvgView svgView = (SvgView) child;
        // Merge properties with inner Svg element.
        if (svgView.getChildCount() > 0) {
          View viewNode = svgView.getChildAt(0);
          if (viewNode instanceof GroupView) {
            ((GroupView) viewNode).mergeProperties(self);
          }
        }
        svgView.drawChildren(canvas);
        if (svgView.isResponsible()) {
          svg.enableTouchEvents();
        }
      }
    }

    if (mOpacity != 1) {
      // Restore copied canvas and temporary reset original canvas matrix to draw bitmap 1:1
      mLayerCanvas.restore();
      int saveCount = canvas.save();
      canvas.setMatrix(null);
      mLayerPaint.setAlpha((int) (mOpacity * 255));
      if (mLayerBitmap != null) {
        canvas.drawBitmap(mLayerBitmap, 0, 0, mLayerPaint);
      }
      canvas.restoreToCount(saveCount);
    }
    this.setClientRect(groupRect);`;

const edits = [
  ['    if (mOpacity != 1) {\n      if (mLayerBitmap == null) {', `    // Clawket patch (apps/mobile/scripts/patch-react-native-svg-group-opacity.mjs): only this
    // group's own layer canvas may be reset; the canvas it draws into stays a local.
    final boolean offscreen = mOpacity != 1;
    final Canvas layerCanvas;
    if (offscreen) {
      if (mLayerBitmap == null) {`],
  ['      // Copy current matrix from original canvas\n      mLayerCanvas.save();\n      mLayerCanvas.setMatrix(canvas.getMatrix());\n    } else {\n      mLayerCanvas = canvas;\n    }',
    '      layerCanvas = mLayerCanvas;\n      // Copy current matrix from original canvas\n      layerCanvas.save();\n      layerCanvas.setMatrix(canvas.getMatrix());\n    } else {\n      layerCanvas = canvas;\n    }'],
  ['node.saveAndSetupCanvas(mLayerCanvas, mCTM);\n        node.render(mLayerCanvas, paint, opacity);',
    'node.saveAndSetupCanvas(layerCanvas, mCTM);\n        node.render(layerCanvas, paint, opacity);'],
  ['node.restoreCanvas(mLayerCanvas, count);', 'node.restoreCanvas(layerCanvas, count);'],
  ['    if (mOpacity != 1) {\n      // Restore copied canvas and temporary reset original canvas matrix to draw bitmap 1:1\n      mLayerCanvas.restore();',
    '    if (offscreen) {\n      // Restore copied canvas and temporary reset original canvas matrix to draw bitmap 1:1\n      layerCanvas.restore();'],
];
const after = edits.reduce((text, [from, to]) => {
  if (text.split(from).length !== 2) throw new Error(`GroupView patch edit does not match exactly once: ${from.split('\n')[0]}`);
  return text.replace(from, to);
}, before);

export const GROUP_DRAW_BEFORE = before;
export const GROUP_DRAW_AFTER = after;

export function patchSvgGroupOpacity(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('react-native-svg GroupView source is missing or malformed.');
  const text = source.replaceAll('\r\n', '\n');
  const originalCount = text.split(before).length - 1;
  const patchedCount = text.split(after).length - 1;
  const drawGroupCount = text.split('  void drawGroup(final Canvas canvas, final Paint paint, final float opacity) {').length - 1;
  if (drawGroupCount !== 1 || originalCount + patchedCount !== 1) {
    throw new Error('react-native-svg GroupView.drawGroup drifted from the reviewed 15.15.4 source.');
  }
  return originalCount === 1 ? text.replace(before, after) : text;
}

export function applySvgGroupOpacityPatch(mobileRoot) {
  const relative = 'node_modules/react-native-svg/android/src/main/java/com/horcrux/svg/GroupView.java';
  const candidates = [path.join(mobileRoot, relative), path.resolve(mobileRoot, '../..', relative)];
  const files = [...new Set(candidates.filter(file => fs.existsSync(file)).map(file => fs.realpathSync(file)))];
  if (!files.length) throw new Error('react-native-svg GroupView source is missing. Install mobile dependencies first.');
  const patches = files.map(file => {
    const source = fs.readFileSync(file, 'utf8');
    return { file, source, patched: patchSvgGroupOpacity(source) };
  });
  for (const { file, source, patched } of patches) if (source !== patched) fs.writeFileSync(file, patched);
  return files.length;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const count = applySvgGroupOpacityPatch(process.env.CLAWKET_MOBILE_ROOT || path.resolve(path.dirname(scriptPath), '..'));
  console.log(`Verified react-native-svg Android group opacity layer patch: ${count} GroupView file(s).`);
}
