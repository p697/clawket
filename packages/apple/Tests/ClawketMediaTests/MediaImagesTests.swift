import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import Testing
@testable import ClawketMedia

@Suite(.serialized)
struct MediaImagesTests {
    @Test(arguments: [false, true])
    func rasterPreparationDownsamplesAndPreservesTransparency(_ transparent: Bool) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("clawket-image-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("source.png")
        let width = 2_000, height = 1_000
        let context = try #require(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: transparent ? CGImageAlphaInfo.premultipliedLast.rawValue : CGImageAlphaInfo.noneSkipLast.rawValue))
        context.setFillColor(CGColor(red: 0.2, green: 0.4, blue: 0.8, alpha: transparent ? 0.5 : 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = try #require(context.makeImage()), output = try #require(CGImageDestinationCreateWithURL(source as CFURL, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(output, image, nil); #expect(CGImageDestinationFinalize(output))
        let stager = try MediaImportStager(directory: root.appendingPathComponent("stage")), library = try MediaLibrary(directory: root.appendingPathComponent("library"))
        let resource = try await library.adopt(stager.stageFile(from: source, name: "source.png", mimeType: "image/png"))
        let prepared = try await library.preparePrompt(resource.id)
        #expect(prepared.isImage); #expect(prepared.data.count <= MediaLimits.promptBytes)
        #expect(prepared.thumbnail != nil); #expect(prepared.aspectRatio == 2)
        let decoded = try #require(CGImageSourceCreateWithData(prepared.data as CFData, nil))
        let raster = try #require(CGImageSourceCreateImageAtIndex(decoded, 0, nil))
        #expect(raster.width <= 1_600); #expect(raster.height <= 1_600)
        if transparent { #expect(prepared.mimeType == "image/png"); #expect(raster.alphaInfo != .none) }
    }

    @Test func EXIFRotationChangesPreviewAspectAndSVGNeverDecodesAsRaster() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("clawket-exif-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("rotated.jpg")
        let context = try #require(CGContext(data: nil, width: 40, height: 20, bitsPerComponent: 8, bytesPerRow: 40 * 4,
                                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        let image = try #require(context.makeImage()), output = try #require(CGImageDestinationCreateWithURL(source as CFURL, UTType.jpeg.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(output, image, [kCGImagePropertyOrientation: 6] as CFDictionary); #expect(CGImageDestinationFinalize(output))
        let stager = try MediaImportStager(directory: root.appendingPathComponent("stage")), library = try MediaLibrary(directory: root.appendingPathComponent("library"))
        let resource = try await library.adopt(stager.stageFile(from: source, name: "rotated.jpg", mimeType: "image/jpeg"))
        #expect(try await library.preparePrompt(resource.id).aspectRatio == 0.5)
        let svg = root.appendingPathComponent("image.svg"); try Data("<svg xmlns=\"http://www.w3.org/2000/svg\"/>".utf8).write(to: svg)
        let invalid = try await library.adopt(stager.stageFile(from: svg, name: "image.svg", mimeType: "image/svg+xml"))
        let document = try await library.preparePrompt(invalid.id)
        #expect(!document.isImage); #expect(document.thumbnail == nil); #expect(document.aspectRatio == nil)
        #expect(document.mimeType == "image/svg+xml"); #expect(document.data == Data(contentsOf: svg))
        await #expect(throws: MediaFailure.unsupported) { try await library.previewImage(invalid.id) }
    }

    @Test func GIFBytesRemainUnchanged() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("clawket-gif-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let bytes = try #require(Data(base64Encoded: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"))
        let source = root.appendingPathComponent("pixel.gif"); try bytes.write(to: source)
        let stager = try MediaImportStager(directory: root.appendingPathComponent("stage")), library = try MediaLibrary(directory: root.appendingPathComponent("library"))
        let resource = try await library.adopt(stager.stageFile(from: source, name: "pixel.gif", mimeType: "image/gif"))
        let prepared = try await library.preparePrompt(resource.id)
        #expect(prepared.data == bytes); #expect(prepared.mimeType == "image/gif")
    }
}
