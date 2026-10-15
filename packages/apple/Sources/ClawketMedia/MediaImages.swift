import Foundation
import ImageIO
import UniformTypeIdentifiers

enum MediaImages {
    static func preview(url: URL, pixels: Int) throws -> MediaImagePreview {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= MediaLimits.imagePixels / height else { throw MediaFailure.tooLarge }
        let raster = try image(source, pixels: pixels)
        let transparent = [.first, .last, .premultipliedFirst, .premultipliedLast].contains(raster.alphaInfo)
        guard let bytes = encode(raster, type: transparent ? .png : .jpeg, quality: 0.82), bytes.count <= MediaLimits.promptBytes else { throw MediaFailure.tooLarge }
        return MediaImagePreview(data: bytes, aspectRatio: Double(raster.width) / Double(raster.height))
    }

    static func prepare(resource: MediaResource, url: URL) throws -> PreparedMedia {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let kind = CGImageSourceGetType(source), let type = UTType(kind as String), type.conforms(to: .image),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 100_000_000 / height else { throw MediaFailure.unsupported }
        let thumbnail = try image(source, pixels: 320)
        let aspect = Double(thumbnail.width) / Double(thumbnail.height)
        let preview = encode(thumbnail, type: .jpeg, quality: 0.72).flatMap { $0.count <= 256 * 1_024 ? $0 : nil }
        if type == .gif {
            guard resource.byteCount <= MediaLimits.promptBytes, width <= MediaLimits.imagePixels / height,
                  CGImageSourceGetCount(source) <= 1_000 else { throw MediaFailure.tooLarge }
            return PreparedMedia(resource: resource, data: try Data(contentsOf: url), mimeType: "image/gif", isImage: true, thumbnail: preview, aspectRatio: aspect)
        }
        var candidate: (Data, String)?
        for (pixels, quality) in [(1_600, 0.82), (1_440, 0.76), (1_280, 0.70)] {
            try Task.checkCancellation()
            let image = try image(source, pixels: pixels)
            // Preserve alpha; never silently flatten a transparent PNG to JPEG.
            let transparent = [.first, .last, .premultipliedFirst, .premultipliedLast].contains(image.alphaInfo)
            let output: UTType = transparent ? .png : .jpeg
            guard let bytes = encode(image, type: output, quality: quality) else { throw MediaFailure.unsupported }
            if bytes.count <= MediaLimits.promptBytes { candidate = (bytes, transparent ? "image/png" : "image/jpeg") }
            if bytes.count <= 2 * 1_024 * 1_024 { break }
        }
        guard let (data, mime) = candidate else { throw MediaFailure.tooLarge }
        return PreparedMedia(resource: resource, data: data, mimeType: mime, isImage: true, thumbnail: preview, aspectRatio: aspect)
    }

    private static func image(_ source: CGImageSource, pixels: Int) throws -> CGImage {
        guard let value = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: pixels,
            kCGImageSourceShouldCacheImmediately: true,
        ] as CFDictionary), value.width > 0, value.height > 0,
              value.width <= MediaLimits.imagePixels / value.height else { throw MediaFailure.unsupported }
        return value
    }

    private static func encode(_ image: CGImage, type: UTType, quality: Double) -> Data? {
        let data = NSMutableData()
        guard let writer = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(writer, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(writer) else { return nil }
        return data as Data
    }
}
