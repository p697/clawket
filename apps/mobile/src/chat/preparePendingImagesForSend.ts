import { PendingImage } from "../types/chat";
import { readFileAsBase64 } from "./chatControllerUtils";

type PendingImageWithFile = PendingImage & { fileName?: string };

type PreparedImageResult = {
  images: PendingImageWithFile[];
  changed: boolean;
};

type CompressionPreset = {
  maxSide: number;
  quality: number;
};

const IMAGE_SEND_PRESETS: CompressionPreset[] = [
  { maxSide: 1600, quality: 0.82 },
  { maxSide: 1440, quality: 0.76 },
  { maxSide: 1280, quality: 0.7 },
];

const IMAGE_SOFT_TARGET_BYTES = 2 * 1024 * 1024;
const IMAGE_HARD_LIMIT_BYTES = 5 * 1024 * 1024;

function estimateBase64Bytes(base64: string): number {
  const trimmed = base64.trim();
  if (!trimmed) return 0;
  const padding =
    trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding);
}

function normalizedMimeType(mimeType: string | undefined): string {
  return mimeType?.trim().toLowerCase() || "image/jpeg";
}

function isGifMimeType(mimeType: string): boolean {
  return mimeType === "image/gif";
}

function shouldAttemptLocalCompression(image: PendingImageWithFile): boolean {
  const mimeType = normalizedMimeType(image.mimeType);
  if (!mimeType.startsWith("image/")) return false;
  return !isGifMimeType(mimeType);
}

function readImageDimensions(image: PendingImageWithFile): {
  width?: number;
  height?: number;
} {
  return {
    width:
      typeof image.width === "number" && image.width > 0 ? image.width : undefined,
    height:
      typeof image.height === "number" && image.height > 0 ? image.height : undefined,
  };
}

function buildResizeAction(
  width: number | undefined,
  height: number | undefined,
  maxSide: number,
): Array<{ resize: { width?: number; height?: number } }> {
  if (!width || !height) return [{ resize: { width: maxSide } }];
  if (width <= maxSide && height <= maxSide) return [];
  return width >= height
    ? [{ resize: { width: maxSide } }]
    : [{ resize: { height: maxSide } }];
}

async function encodeWithManipulator(
  uri: string,
  options: {
    width?: number;
    height?: number;
    maxSide: number;
    compress: number;
    format: "jpeg" | "png";
  },
): Promise<PendingImageWithFile> {
  const ImageManipulator = await import("expo-image-manipulator");
  const actions = buildResizeAction(options.width, options.height, options.maxSide);
  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    base64: true,
    compress: options.compress,
    format:
      options.format === "png"
        ? ImageManipulator.SaveFormat.PNG
        : ImageManipulator.SaveFormat.JPEG,
  });

  return {
    uri: result.uri,
    base64: result.base64 ?? "",
    mimeType: options.format === "png" ? "image/png" : "image/jpeg",
    width: result.width,
    height: result.height,
  };
}

async function readOriginalImage(
  image: PendingImageWithFile,
): Promise<PendingImageWithFile> {
  if (image.base64) return image;
  return {
    ...image,
    base64: await readFileAsBase64(image.uri),
  };
}

async function compressImageForSend(
  image: PendingImageWithFile,
): Promise<PendingImageWithFile> {
  const original = await readOriginalImage(image);
  const originalMimeType = normalizedMimeType(original.mimeType);
  const { width, height } = readImageDimensions(original);

  if (originalMimeType === "image/png") {
    const pngCandidate = await encodeWithManipulator(original.uri, {
      width,
      height,
      maxSide: IMAGE_SEND_PRESETS[0].maxSide,
      compress: 1,
      format: "png",
    });
    const pngBytes = estimateBase64Bytes(pngCandidate.base64);
    if (
      pngBytes > 0 &&
      pngBytes <= IMAGE_SOFT_TARGET_BYTES &&
      pngBytes <= IMAGE_HARD_LIMIT_BYTES
    ) {
      return {
        ...original,
        ...pngCandidate,
        fileName: image.fileName,
      };
    }
  }

  let bestCandidate = original;
  let bestBytes = estimateBase64Bytes(original.base64);

  for (const preset of IMAGE_SEND_PRESETS) {
    const candidate = await encodeWithManipulator(original.uri, {
      width,
      height,
      maxSide: preset.maxSide,
      compress: preset.quality,
      format: "jpeg",
    });
    const candidateBytes = estimateBase64Bytes(candidate.base64);
    if (candidateBytes > 0 && (bestBytes <= 0 || candidateBytes < bestBytes)) {
      bestCandidate = {
        ...original,
        ...candidate,
        fileName: image.fileName,
      };
      bestBytes = candidateBytes;
    }
    if (candidateBytes > 0 && candidateBytes <= IMAGE_SOFT_TARGET_BYTES) {
      return {
        ...original,
        ...candidate,
        fileName: image.fileName,
      };
    }
  }

  return bestCandidate;
}

export async function preparePendingImagesForSend(
  images: PendingImage[],
): Promise<PreparedImageResult> {
  let changed = false;
  const prepared = await Promise.all(
    images.map(async (image) => {
      const imageWithFile = image as PendingImageWithFile;
      if (!imageWithFile.mimeType.startsWith("image/")) {
        if (imageWithFile.base64) return imageWithFile;
        changed = true;
        return {
          ...imageWithFile,
          base64: await readFileAsBase64(imageWithFile.uri),
        };
      }

      const original = await readOriginalImage(imageWithFile);
      if (!shouldAttemptLocalCompression(original)) {
        if (original.base64 !== imageWithFile.base64) {
          changed = true;
        }
        return original;
      }

      try {
        const compressed = await compressImageForSend(original);
        if (
          compressed.base64 !== imageWithFile.base64 ||
          compressed.uri !== imageWithFile.uri ||
          compressed.mimeType !== imageWithFile.mimeType ||
          compressed.width !== imageWithFile.width ||
          compressed.height !== imageWithFile.height
        ) {
          changed = true;
        }
        return compressed;
      } catch {
        if (original.base64 !== imageWithFile.base64) {
          changed = true;
        }
        return original;
      }
    }),
  );

  return { images: prepared, changed };
}
