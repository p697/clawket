// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ClawketApple",
    platforms: [.iOS("16.4"), .macOS(.v13)],
    products: [
        .library(name: "ClawketTransport", targets: ["ClawketTransport"]),
    ],
    targets: [
        .target(name: "ClawketTransport"),
        .testTarget(name: "ClawketTransportTests", dependencies: ["ClawketTransport"]),
    ]
)
